using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using GLTFast;
using GLTFast.Logging;
using UnityEngine;

namespace JiuQuest.Combat
{
    public sealed class JiuQuestBridge : MonoBehaviour
    {
        readonly PairedPlaybackClock clock = new PairedPlaybackClock();
        readonly List<Material> appearanceMaterials = new List<Material>();
        CancellationTokenSource lifetime;
        CancellationTokenSource loadCancellation;
        GltfImport currentImport;
        GameObject pair;
        Animation legacyAnimation;
        AnimationState animationState;
        DojoStage stage;
        FighterAppearance fighter;
        FighterAppearance opponent;
        string instanceId, requestId, moveId = "standing_stance", performerSide = "fighter";
        string status = "Waiting for JiuQuest…";
        int loadGeneration;
        bool configured, loading, desiredPlaying;
        float desiredProgress, nextState;

        [DllImport("__Internal")]
        static extern void JiuQuestEmit(string json);

        void Awake()
        {
            gameObject.name = "JiuQuestBridge";
            lifetime = new CancellationTokenSource();
            Application.targetFrameRate = 60;
            Application.runInBackground = false;
#if UNITY_WEBGL && !UNITY_EDITOR
            WebGLInput.captureAllKeyboardInput = false;
#endif
            stage = gameObject.AddComponent<DojoStage>();
            stage.Create();
        }

        public void ReceiveCommand(string json)
        {
            CombatCommand command = null;
            try
            {
                if (string.IsNullOrEmpty(json) || json.Length > 12000) throw new ArgumentException("Invalid bridge payload length.");
                command = CombatProtocol.ParseJson(json);
                if (!CombatProtocol.Validate(command, out var error)) throw new ArgumentException(error);
                if (configured && command.instanceId != instanceId) throw new ArgumentException("The command belongs to another Unity instance.");
                if (!configured && command.type != "configure") throw new ArgumentException("Configure the Unity instance before playing.");
                instanceId = command.instanceId;
                requestId = command.requestId;
                if (command.fighter != null) fighter = command.fighter;
                if (command.opponent != null) opponent = command.opponent;
                if (!string.IsNullOrEmpty(command.performerSide)) performerSide = command.performerSide;
                if (!string.IsNullOrEmpty(command.camera) && (command.type == "configure" || command.type == "play" || command.type == "setCamera")) stage.SetCamera(command.camera);
                if (command.type == "configure" || command.type == "play" || command.type == "setViewport") stage.SetViewport(command.compactViewport);
                switch (command.type)
                {
                    case "configure":
                        configured = true;
                        clock.Speed = command.speed;
                        _ = LoadMove(string.IsNullOrEmpty(command.moveId) ? "standing_stance" : command.moveId, command.progress, false, true, command.requestId);
                        break;
                    case "play":
                        clock.Speed = command.speed;
                        _ = LoadMove(command.moveId, command.progress, !command.paused, false, command.requestId);
                        break;
                    case "pause": desiredPlaying = false; clock.Playing = false; Emit("state"); break;
                    case "resume":
                        desiredPlaying = true;
                        if (!loading) { if (clock.Progress >= 1) clock.Seek(0); clock.Playing = true; }
                        Emit("state"); break;
                    case "seek": desiredProgress = command.progress; desiredPlaying = false; clock.Playing = false; clock.Seek(command.progress); Sample(); Emit("state"); break;
                    case "setSpeed": clock.Speed = command.speed; Emit("state"); break;
                    case "setCamera": Emit("state"); break;
                    case "setViewport": Emit("state"); break;
                    case "reset": desiredProgress = 0; desiredPlaying = false; clock.Seek(0); clock.Playing = false; Sample(); Emit("state"); break;
                    case "requestState": Emit("state"); break;
                }
                if (pair != null && !loading) ApplyAppearances();
            }
            catch (Exception exception)
            {
                Emit("error", exception.Message, command?.requestId, command?.instanceId, command?.moveId);
            }
        }

        async Task LoadMove(string requestedMove, float progress, bool play, bool ready, string setupRequest)
        {
            if (!loading && pair != null && currentImport != null && legacyAnimation != null && requestedMove == moveId)
            {
                desiredProgress = progress;
                desiredPlaying = play;
                clock.Load(legacyAnimation.clip.length, CombatProtocol.IsLooping(moveId), progress, play);
                ApplyAppearances();
                Sample();
                if (ready) Emit("ready", "Unity URP paired animation ready.", setupRequest);
                else Emit("state");
                return;
            }
            int generation = ++loadGeneration;
            loadCancellation?.Cancel();
            loadCancellation?.Dispose();
            loadCancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            var token = loadCancellation.Token;
            desiredProgress = progress;
            desiredPlaying = play;
            clock.Playing = false;
            loading = true;
            status = "Loading paired 3D choreography…";
            GltfImport imported = null;
            GameObject loadedPair = null;
            try
            {
                var log = new CollectingLogger();
                imported = new GltfImport(materialGenerator: new CombatMaterialGenerator(stage.FighterShader), logger: log);
                var path = Path.Combine(Application.streamingAssetsPath, "Bjj", requestedMove + ".glb").Replace('\\', '/');
                if (!path.Contains("://")) path = new Uri(path).AbsoluteUri;
                if (path.StartsWith("http://", StringComparison.Ordinal) || path.StartsWith("https://", StringComparison.Ordinal))
                    path += "?build=" + Uri.EscapeDataString(string.IsNullOrEmpty(Application.buildGUID) ? Application.version : Application.buildGUID);
                bool success = await imported.Load(path, new ImportSettings { AnimationMethod = AnimationMethod.Legacy, NodeNameMethod = NameImportMethod.OriginalUnique }, token);
                token.ThrowIfCancellationRequested();
                if (!success) throw new InvalidOperationException("The paired GLB could not be loaded: " + requestedMove);
                loadedPair = new GameObject("Paired choreography - " + requestedMove);
                loadedPair.SetActive(false);
                var instantiator = new GameObjectInstantiator(imported, loadedPair.transform, logger: log);
                if (!await imported.InstantiateMainSceneAsync(instantiator, token)) throw new InvalidOperationException("The paired GLB could not be instantiated: " + requestedMove);
                token.ThrowIfCancellationRequested();
                if (log.Items != null)
                {
                    var errors = log.Items.Where(item => item.Type == LogType.Error || item.Type == LogType.Exception).Select(item => item.ToString()).ToArray();
                    if (errors.Length > 0) throw new InvalidOperationException("GLB import error: " + string.Join("; ", errors));
                    foreach (var item in log.Items.Where(item => item.Type == LogType.Warning)) Debug.LogWarning("JiuQuest GLB: " + item);
                }
                var animation = instantiator.SceneInstance.LegacyAnimation;
                if (animation == null || animation.clip == null || animation.clip.length <= 0) throw new InvalidOperationException("The paired GLB has no playable animation: " + requestedMove);
                var roots = loadedPair.GetComponentsInChildren<Transform>(true);
                if (!roots.Any(node => node.name == "JQ_Attacker") || !roots.Any(node => node.name == "JQ_Defender")) throw new InvalidOperationException("The authored attacker/defender identity roots are missing.");
                if (generation != loadGeneration) throw new OperationCanceledException();
                ReleaseCurrent();
                currentImport = imported;
                imported = null;
                pair = loadedPair;
                loadedPair = null;
                legacyAnimation = animation;
                legacyAnimation.playAutomatically = false;
                pair.SetActive(true);
                legacyAnimation.Stop();
                if (!legacyAnimation.Play(legacyAnimation.clip.name)) throw new InvalidOperationException("The paired legacy animation could not be started: " + requestedMove);
                animationState = legacyAnimation[legacyAnimation.clip.name];
                animationState.speed = 0;
                animationState.wrapMode = WrapMode.ClampForever;
                legacyAnimation.cullingType = AnimationCullingType.AlwaysAnimate;
                moveId = requestedMove;
                clock.Load(legacyAnimation.clip.length, CombatProtocol.IsLooping(moveId), desiredProgress, desiredPlaying);
                ApplyAppearances();
                Sample();
                stage.Frame(MeasureChoreography(), moveId);
                loading = false;
                status = "Authored animation · draft technique review";
                if (ready) Emit("ready", "Unity URP paired animation ready.", setupRequest);
                else Emit("state");
            }
            catch (OperationCanceledException) { }
            catch (Exception exception)
            {
                if (generation == loadGeneration && !lifetime.IsCancellationRequested)
                {
                    clock.Playing = false;
                    loading = false;
                    ReleaseCurrent();
                    status = "3D animation unavailable";
                    Emit("error", exception.Message, ready ? setupRequest : null, eventMove: requestedMove);
                }
            }
            finally
            {
                if (loadedPair != null) Destroy(loadedPair);
                imported?.Dispose();
            }
        }

        void ApplyAppearances()
        {
            // Imported material instances are replaced once, then tinted by semantic slot.
            // The performer root follows the selected actor; fighter identity never follows the camera.
            foreach (var renderer in pair.GetComponentsInChildren<Renderer>(true))
            {
                var materials = renderer.sharedMaterials;
                for (int i = 0; i < materials.Length; i++)
                {
                    var material = materials[i];
                    if (material == null) continue;
                    var slotName = material.name;
                    if (!slotName.StartsWith("JQ_", StringComparison.Ordinal)) continue;
                    if (!appearanceMaterials.Contains(material))
                    {
                        material = new Material(stage.FighterShader) { name = slotName };
                        material.SetFloat("_Smoothness", .23f);
                        material.SetFloat("_Metallic", 0);
                        appearanceMaterials.Add(material);
                        materials[i] = material;
                    }
                    var appearance = CombatProtocol.AppearanceForRoot(slotName, performerSide, fighter, opponent);
                    bool isFighter = slotName.StartsWith("JQ_Attacker", StringComparison.Ordinal) == (performerSide != "opponent");
                    if (slotName.Contains("_Hair"))
                    {
                        renderer.enabled = CombatProtocol.IsHairVisible(SemanticNodeName(renderer.transform, "Hair"), appearance?.hairStyle);
                    }
                    else if (slotName.Contains("_BeltStripe"))
                        renderer.enabled = CombatProtocol.IsBeltStripeVisible(SemanticNodeName(renderer.transform, "BeltStripe_"), appearance?.stripes ?? 0);
                    var tint = Tint(slotName, appearance, isFighter);
                    material.SetColor("_BaseColor", tint);
                    material.color = tint;
                }
                renderer.sharedMaterials = materials;
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                renderer.receiveShadows = true;
                if (renderer is SkinnedMeshRenderer skinned) skinned.updateWhenOffscreen = true;
            }
        }

        string SemanticNodeName(Transform node, string marker)
        {
            while (node.parent != null && node.parent != pair.transform && node.name.IndexOf(marker, StringComparison.OrdinalIgnoreCase) < 0)
                node = node.parent;
            return node.name;
        }

        static Color Tint(string slot, FighterAppearance appearance, bool isFighter)
        {
            string value = null;
            Color fallback = isFighter ? new Color(.83f, .9f, .93f) : new Color(.12f, .2f, .35f);
            if (slot.Contains("GiTop")) value = appearance?.giTop;
            else if (slot.Contains("GiPants")) value = appearance?.giPants;
            else if (slot.Contains("Skin")) { value = appearance?.skinTone; fallback = new Color(.64f, .42f, .28f); }
            else if (slot.Contains("Hair")) { value = appearance?.hairColor; fallback = new Color(.08f, .06f, .05f); }
            else if (slot.Contains("BeltStripe"))
            {
                bool whiteBelt = string.IsNullOrEmpty(appearance?.belt) || string.Equals(appearance.belt, "white", StringComparison.OrdinalIgnoreCase);
                if (ColorUtility.TryParseHtmlString(appearance?.belt ?? "", out var beltColor))
                    whiteBelt = beltColor.r > .9f && beltColor.g > .9f && beltColor.b > .9f;
                ColorUtility.TryParseHtmlString(whiteBelt ? "#182030" : "#f8fbff", out fallback);
            }
            else if (slot.Contains("Belt"))
            {
                value = appearance?.belt;
                switch (value?.ToLowerInvariant())
                {
                    case "white": return new Color(.91f, .9f, .83f);
                    case "blue": return new Color(.08f, .22f, .7f);
                    case "purple": return new Color(.39f, .16f, .56f);
                    case "brown": return new Color(.32f, .17f, .09f);
                    case "black": return new Color(.035f, .04f, .055f);
                }
                fallback = new Color(.91f, .9f, .83f);
            }
            else if (slot.Contains("Patch")) fallback = isFighter ? new Color(.12f, .8f, .68f) : new Color(.95f, .55f, .22f);
            return !string.IsNullOrEmpty(value) && ColorUtility.TryParseHtmlString(value, out var parsed) ? parsed : fallback;
        }

        void Update()
        {
            if (!configured || loading || pair == null) return;
            if (!clock.Playing) return;
            bool completed = clock.Tick(Time.unscaledDeltaTime);
            Sample();
            if (completed) Emit("completed");
            else if (Time.unscaledTime >= nextState && clock.Playing) { nextState = Time.unscaledTime + .15f; Emit("state"); }
        }

        void Sample()
        {
            if (animationState == null || legacyAnimation == null) return;
            animationState.enabled = true;
            animationState.weight = 1;
            animationState.time = clock.Time;
            legacyAnimation.Sample();
        }

        Bounds MeasureChoreography()
        {
            // Imported skinned bounds can include every hair variant or a loose bind pose.
            // Bake actual visible geometry across the shared clip once; playback never rebakes.
            var renderers = pair.GetComponentsInChildren<Renderer>().Where(renderer => renderer.enabled).ToArray();
            var baked = new Mesh { name = "Temporary choreography bounds" };
            Bounds envelope = default;
            bool measured = false;
            try
            {
                const int intervals = 32;
                for (int sample = 0; sample <= intervals; sample++)
                {
                    animationState.time = legacyAnimation.clip.length * sample / intervals;
                    legacyAnimation.Sample();
                    foreach (var renderer in renderers)
                    {
                        Bounds world;
                        if (renderer is SkinnedMeshRenderer skinned)
                        {
                            baked.Clear();
                            skinned.BakeMesh(baked);
                            baked.RecalculateBounds();
                            world = CombatFraming.TransformBounds(baked.bounds, skinned.localToWorldMatrix);
                        }
                        else world = renderer.bounds;
                        if (!measured) { envelope = world; measured = true; }
                        else envelope.Encapsulate(world);
                    }
                }
            }
            finally { Destroy(baked); Sample(); }
            if (!measured) throw new InvalidOperationException("The paired animation has no visible geometry to frame.");
            // A small fixed allowance covers interpolation between sampled poses and cosmetics.
            envelope.Expand(.16f);
            return envelope;
        }

        void Emit(string type, string message = "", string eventRequest = null, string eventInstance = null, string eventMove = null)
        {
            var json = JsonUtility.ToJson(new CombatEvent {
                instanceId = eventInstance ?? instanceId ?? "", requestId = eventRequest ?? requestId ?? "",
                type = type, moveId = eventMove ?? moveId, progress = clock.Progress, playing = !loading && clock.Playing, message = message
            });
#if UNITY_WEBGL && !UNITY_EDITOR
            JiuQuestEmit(json);
#else
            Debug.Log("JiuQuest bridge: " + json);
#endif
        }

        void OnGUI()
        {
            if (loading || pair == null)
            {
                GUI.color = new Color(1, 1, 1, .88f);
                var style = new GUIStyle(GUI.skin.label) { alignment = TextAnchor.MiddleCenter, fontSize = 16 };
                GUI.Label(new Rect(0, Screen.height * .48f, Screen.width, 30), status, style);
            }
        }

        void ReleaseCurrent()
        {
            if (pair != null) { pair.SetActive(false); Destroy(pair); }
            foreach (var material in appearanceMaterials) if (material != null) Destroy(material);
            appearanceMaterials.Clear();
            currentImport?.Dispose();
            currentImport = null;
            pair = null;
            animationState = null;
            legacyAnimation = null;
        }

        void OnDestroy()
        {
            lifetime?.Cancel();
            loadCancellation?.Cancel();
            loadCancellation?.Dispose();
            lifetime?.Dispose();
            ReleaseCurrent();
        }
    }
}
