using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace JiuQuest.Combat
{
    public sealed class DojoStage : MonoBehaviour
    {
        readonly List<Material> materials = new List<Material>();
        readonly List<Mesh> stageMeshes = new List<Mesh>();
        readonly List<Texture2D> stageTextures = new List<Texture2D>();
        readonly HashSet<Material> distantMaterials = new HashSet<Material>();
        Camera sceneCamera;
        Transform environment;
        Material pennantMaterial;
        Material skyMaterial;
        Mesh pennantMesh;
        Vector3[] pennantRestVertices;
        Vector3[] pennantAnimatedVertices;
        Vector4[] pennantWindWeights;
        Bounds pennantMotionBounds;
        float ambientPhase = float.NaN;
        static readonly int CloudOffsetId = Shader.PropertyToID("_AmbientCloudOffset");
        Vector3 lookAt = new Vector3(0, .65f, 0);
        string preset = "front";
        string moveId = "standing_stance";
        float orbitAngle = 27;
        float orbitElevation = 25;
        Bounds motionBounds = new Bounds(new Vector3(0, .8f, 0), new Vector3(2.4f, 1.8f, 1.2f));
        Bounds currentPoseBounds = new Bounds(new Vector3(0, .8f, 0), new Vector3(2.4f, 1.8f, 1.2f));
        Quaternion cameraOrientation = Quaternion.Euler(25, 27, 0);
        bool compactViewport;
        bool dragging;
        Vector2 lastPointer;
        public Shader FighterShader { get; private set; }
        public bool UsesPoseBounds => preset == "focus";

        public void Create()
        {
            FighterShader = Shader.Find("Universal Render Pipeline/Lit");
            if (FighterShader == null) throw new System.InvalidOperationException("The Unity URP Lit shader is missing from the build.");
            environment = new GameObject("Summit Dojo").transform;
            environment.SetParent(transform, false);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(.43f, .55f, .68f);
            RenderSettings.ambientEquatorColor = new Color(.29f, .36f, .40f);
            RenderSettings.ambientGroundColor = new Color(.13f, .18f, .17f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = new Color(.36f, .49f, .60f);
            RenderSettings.fogDensity = .016f;
            var dark = Material("Dark basalt", new Color(.095f, .14f, .18f), .16f);
            var stone = Material("Hand-cut slate", new Color(.31f, .38f, .40f), .24f);
            var stoneLight = Material("Slate bevels", new Color(.41f, .47f, .46f), .21f);
            var timber = Material("Oiled cedar", new Color(.23f, .14f, .085f), .32f);
            var matA = Material("Woven jade tatami", new Color(.17f, .30f, .31f), .12f);
            var matB = Material("Woven blue tatami", new Color(.19f, .32f, .34f), .12f);
            var accent = Material("Jade inlay", new Color(.15f, .64f, .55f), .42f, true);
            var gold = Material("Aged bronze", new Color(.70f, .47f, .20f), .45f);
            var lantern = Material("Lantern paper", new Color(1f, .70f, .34f), .12f, true);
            var cloth = Material("Jade pennants", new Color(.06f, .30f, .32f), .05f);
            pennantMaterial = cloth;
            var farRock = Material("Far mountains", new Color(.39f, .48f, .57f), .02f);
            var nearRock = Material("Near mountains", new Color(.22f, .29f, .28f), .02f);
            var snow = Material("Summit snow", new Color(.73f, .82f, .84f), .10f);
            var pine = Material("Alpine pines", new Color(.09f, .22f, .17f), .02f);
            var moss = Material("Alpine moss verge", new Color(.20f, .30f, .18f), .025f);
            distantMaterials.UnionWith(new[] { farRock, nearRock, snow, pine, moss });
            var weave = WeaveTexture();
            matA.SetTexture("_BaseMap", weave);
            matB.SetTexture("_BaseMap", weave);
            matA.SetTextureScale("_BaseMap", new Vector2(3, 3));
            matB.SetTextureScale("_BaseMap", new Vector2(3, 3));
            timber.SetTexture("_BaseMap", SurfaceTexture(true));
            var slateTexture = SurfaceTexture(false);
            stone.SetTexture("_BaseMap", slateTexture);
            stoneLight.SetTexture("_BaseMap", slateTexture);
            dark.SetTexture("_BaseMap", slateTexture);
            moss.SetTexture("_BaseMap", slateTexture);
            CreateSky();

            // The center stays uncluttered for grappling. Detail belongs to the
            // chamfered edge, quiet tatami weave, and silhouettes behind the pair.
            Prism("Summit plateau", 12, 26, .60f, -2.3f, nearRock);
            Prism("Terrace footing", 8, 6.65f, 1.60f, -1.69f, dark);
            Prism("Terrace upper ledge", 8, 6.45f, .20f, -.32f, stoneLight);
            Prism("Terrace face", 8, 6.28f, .19f, -.18f, stone);
            BevelBox("Mat plinth", new Vector3(0, -.06f, 0), new Vector3(7.4f, .14f, 7.4f), .06f, dark);
            var tile = BeveledBoxMesh(new Vector3(.992f, .04f, .992f), .012f);
            for (int x = -3; x <= 3; x++)
                for (int z = -3; z <= 3; z++)
                    MeshObject("Tatami", tile, new Vector3(x, .007f, z), ((x + z) & 1) == 0 ? matA : matB);
            for (int edge = 0; edge < 4; edge++)
            {
                float angle = edge * 90;
                var rotation = Quaternion.Euler(0, angle, 0);
                Box("Bronze mat frame", rotation * new Vector3(0, .026f, 3.57f), new Vector3(7.2f, .025f, .10f), gold, rotation);
                Box("Jade perimeter", rotation * new Vector3(0, .042f, 3.54f), new Vector3(7.04f, .009f, .026f), accent, rotation);
                for (int block = -3; block <= 3; block++)
                    BevelBox("Terrace paver", rotation * new Vector3(block * 1.08f, -.036f, 4.30f), new Vector3(1.04f, .10f, 1.08f), .035f, ((block + edge) & 1) == 0 ? stone : stoneLight, rotation);
                // Short corner marks read as a sparring surface, not a spell circle.
                for (int corner = -1; corner <= 1; corner += 2)
                {
                    Box("Sparring corner", rotation * new Vector3(corner * 2.80f, .031f, 2.95f), new Vector3(.35f, .006f, .025f), gold, rotation);
                    Box("Sparring corner return", rotation * new Vector3(corner * 2.95f, .031f, 2.80f), new Vector3(.025f, .006f, .35f), gold, rotation);
                }
            }
            // A small original compass inlay remains beneath the athletes and
            // introduces scale without obscuring grips or their cast shadows.
            FloorRing(.57f, .585f, .029f, 64, gold);
            FloorRing(.61f, .622f, .029f, 64, dark);
            for (int quadrant = 0; quadrant < 4; quadrant++)
                Box("Center compass", Vector3.up * .030f, new Vector3(.025f, .003f, .28f), gold, Quaternion.Euler(0, quadrant * 90 + 45, 0));

            // Architecture sits outside every normal combat camera position.
            // It is symmetric so the reverse and orbit views remain intentional.
            for (int side = -1; side <= 1; side += 2)
            {
                for (int end = -1; end <= 1; end += 2)
                    Lantern(new Vector3(side * 5.25f, 0, end * 5.25f), stone, timber, gold, lantern);
                Gate(new Vector3(0, 0, side * 8.8f), side < 0 ? 180 : 0, stone, timber, gold, cloth);
            }
            AlpineBackdrop(farRock, nearRock, snow, pine, timber);
            NaturalVerge(moss, stone, dark);
            CombineArchitecture();

            // Keep colored dojo accents out of facial lighting so the authored
            // skin texture and selected tone remain natural from every camera.
            Light("Late afternoon key", new Vector3(48, -32, 0), new Color(1, .95f, .86f), 1.15f, true);
            Light("Sky fill", new Vector3(32, 132, 0), new Color(.76f, .86f, 1), .36f, false);
            Light("Summit rim", new Vector3(35, 210, 0), new Color(.90f, .97f, 1), .48f, false);
            sceneCamera = new GameObject("Combat Camera").AddComponent<Camera>();
            sceneCamera.transform.SetParent(environment, false);
            sceneCamera.tag = "MainCamera";
            sceneCamera.clearFlags = CameraClearFlags.SolidColor;
            sceneCamera.backgroundColor = RenderSettings.fogColor;
            sceneCamera.fieldOfView = 44;
            sceneCamera.nearClipPlane = .08f;
            sceneCamera.farClipPlane = 110;
            sceneCamera.allowHDR = false;
            sceneCamera.allowMSAA = true;
            var cameraData = sceneCamera.GetUniversalAdditionalCameraData();
            cameraData.renderPostProcessing = false;
            cameraData.antialiasing = AntialiasingMode.FastApproximateAntialiasing;
            PlaceCamera(true);
        }

        public void Frame(Bounds bounds, string authoredMoveId)
        {
            moveId = authoredMoveId;
            motionBounds = bounds;
            currentPoseBounds = bounds;
            lookAt = bounds.center;
            PlaceCamera(true);
        }

        public void SetPoseBounds(Bounds bounds)
        {
            if (Finite(bounds.center) && Finite(bounds.size) && bounds.size.x > 0 && bounds.size.y > 0 && bounds.size.z > 0)
                currentPoseBounds = CombatFraming.LimitPoseToMotion(bounds, motionBounds);
        }

        public void SampleAmbient(float playbackTime, float duration)
        {
            // The combat clock owns this setting too: Pause and reduced-motion
            // pose review never leave an independent wind animation running.
            float phase = SummitAmbientMotion.Phase(playbackTime, duration);
            if (phase == ambientPhase) return;
            ambientPhase = phase;
            var waves = SummitAmbientMotion.Waves(phase);
            if (skyMaterial != null)
                skyMaterial.SetVector(CloudOffsetId, new Vector4(waves.x * .025f, -waves.y * .075f, 0, 0));
            if (pennantMesh == null) return;
            for (int index = 0; index < pennantRestVertices.Length; index++)
                pennantAnimatedVertices[index] = pennantRestVertices[index] + SummitAmbientMotion.BannerOffset(pennantWindWeights[index], waves);
            pennantMesh.vertices = pennantAnimatedVertices;
            pennantMesh.RecalculateNormals();
            pennantMesh.bounds = pennantMotionBounds;
        }

        static bool Finite(Vector3 value) => !float.IsNaN(value.x) && !float.IsInfinity(value.x)
            && !float.IsNaN(value.y) && !float.IsInfinity(value.y) && !float.IsNaN(value.z) && !float.IsInfinity(value.z);

        public void SetViewport(bool compact)
        {
            compactViewport = compact;
            Application.targetFrameRate = compact ? 30 : 60;
            sceneCamera.allowMSAA = !compact;
            // The player has one active combat viewport. Resize changes its
            // single sun atlas only when the quality tier actually changes.
            var pipeline = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
            int shadowResolution = compact ? 1024 : 2048;
            if (pipeline != null && pipeline.mainLightShadowmapResolution != shadowResolution)
                pipeline.mainLightShadowmapResolution = shadowResolution;
            PlaceCamera(true);
        }

        public void SetCamera(string cameraPreset)
        {
            if (preset == cameraPreset) return;
            preset = cameraPreset;
            dragging = false;
            if (preset == "orbit") { orbitAngle = 27; orbitElevation = 25; }
        }

        void LateUpdate()
        {
            // Pointer drags are limited to this Unity canvas; React owns accessible controls.
            if (preset != "orbit") dragging = false;
            else if (Input.touchCount == 1)
            {
                var touch = Input.GetTouch(0);
                if (touch.phase == TouchPhase.Began) { dragging = true; lastPointer = touch.position; }
                else if (touch.phase == TouchPhase.Moved && dragging) Rotate(touch.position);
                else if (touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled) dragging = false;
            }
            else if (Input.touchCount == 0)
            {
                if (Input.GetMouseButtonDown(0)) { dragging = true; lastPointer = Input.mousePosition; }
                if (dragging && Input.GetMouseButton(0)) Rotate(Input.mousePosition);
                if (Input.GetMouseButtonUp(0)) dragging = false;
            }
            PlaceCamera(false);
        }

        void Rotate(Vector2 point)
        {
            var delta = point - lastPointer;
            lastPointer = point;
            if (delta.sqrMagnitude < .05f) return;
            orbitAngle += delta.x * .18f;
            orbitElevation = Mathf.Clamp(orbitElevation - delta.y * .13f, 12, 65);
        }

        void PlaceCamera(bool immediate)
        {
            if (sceneCamera == null) return;
            float yaw = CombatFraming.CameraYaw(moveId, preset, orbitAngle);
            float elevation = CombatFraming.CameraElevation(preset, orbitElevation);
            var targetOrientation = Quaternion.Euler(elevation, yaw, 0);
            cameraOrientation = immediate ? targetOrientation : Quaternion.Slerp(cameraOrientation, targetOrientation, 1 - Mathf.Exp(-8 * Time.unscaledDeltaTime));
            var framingBounds = preset == "focus" ? currentPoseBounds : motionBounds;
            lookAt = framingBounds.center;
            // Refit at the interpolated angle too: even a camera transition cannot crop a limb.
            float distance = CombatFraming.Distance(framingBounds, cameraOrientation, sceneCamera.fieldOfView,
                Mathf.Max(.1f, sceneCamera.aspect), compactViewport ? .9f : .85f);
            sceneCamera.transform.SetPositionAndRotation(lookAt + cameraOrientation * new Vector3(0, 0, -distance), cameraOrientation);
        }

        void CombineArchitecture()
        {
            // Static scenery uses one draw per material rather than a separate draw per tile.
            var filters = environment.GetComponentsInChildren<MeshFilter>();
            foreach (var material in materials)
            {
                var instances = new List<CombineInstance>();
                foreach (var filter in filters)
                {
                    var renderer = filter.GetComponent<MeshRenderer>();
                    if (renderer == null || renderer.sharedMaterial != material) continue;
                    instances.Add(new CombineInstance { mesh = filter.sharedMesh, transform = environment.worldToLocalMatrix * filter.transform.localToWorldMatrix });
                    renderer.enabled = false;
                    Destroy(filter.gameObject);
                }
                if (instances.Count == 0) continue;
                var mesh = new Mesh { name = "Dojo architecture - " + material.name };
                mesh.CombineMeshes(instances.ToArray(), true, true);
                if (material == pennantMaterial)
                {
                    // Retain independent rest and output arrays. Only this tiny
                    // existing material group changes; architecture stays static.
                    pennantMesh = mesh;
                    pennantRestVertices = mesh.vertices;
                    pennantAnimatedVertices = (Vector3[])pennantRestVertices.Clone();
                    pennantWindWeights = new Vector4[pennantRestVertices.Length];
                    for (int index = 0; index < pennantRestVertices.Length; index++)
                        pennantWindWeights[index] = SummitAmbientMotion.BannerWeights(pennantRestVertices[index]);
                    pennantMotionBounds = mesh.bounds;
                    pennantMotionBounds.Expand(SummitAmbientMotion.MaxDisplacement * 2);
                    mesh.bounds = pennantMotionBounds;
                    mesh.MarkDynamic();
                }
                stageMeshes.Add(mesh);
                var combined = new GameObject(mesh.name);
                combined.transform.SetParent(environment, false);
                combined.AddComponent<MeshFilter>().sharedMesh = mesh;
                var combinedRenderer = combined.AddComponent<MeshRenderer>();
                combinedRenderer.sharedMaterial = material;
                if (distantMaterials.Contains(material))
                {
                    combinedRenderer.shadowCastingMode = ShadowCastingMode.Off;
                    combinedRenderer.receiveShadows = false;
                }
            }
        }

        Material Material(string label, Color color, float smoothness, bool emissive = false)
        {
            var material = new Material(FighterShader) { name = label };
            material.SetColor("_BaseColor", color);
            material.SetFloat("_Smoothness", smoothness);
            if (emissive) { material.EnableKeyword("_EMISSION"); material.SetColor("_EmissionColor", color * .45f); }
            materials.Add(material);
            return material;
        }

        Texture2D WeaveTexture()
        {
            // Tiny, repeatable woven surface; no file request or image dependency.
            const int size = 128;
            var pixels = new Color32[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    int thread = ((x / 2 + y / 2) & 1) == 0 ? 5 : -5;
                    int fiber = ((x * 13 + y * 37) ^ (x * y)) & 7;
                    byte value = (byte)Mathf.Clamp(235 + thread + fiber - (x % 8 == 0 || y % 8 == 0 ? 9 : 0), 0, 255);
                    pixels[y * size + x] = new Color32(value, value, value, 255);
                }
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, true, false)
                { name = "Summit tatami weave", wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 2 };
            texture.SetPixels32(pixels);
            texture.Apply(true, true);
            stageTextures.Add(texture);
            return texture;
        }

        Texture2D SurfaceTexture(bool wood)
        {
            const int size = 128;
            var pixels = new Color32[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float u = x / 128f, v = y / 128f;
                    float noise = Mathf.PerlinNoise(u * 12, v * 12);
                    float grain = wood
                        ? Mathf.Sin(u * 105 + Mathf.Sin(v * 13 + u * 11) * 2 + Mathf.Sin(u * 23) * 3) * .07f
                        : Mathf.Sin(u * 18 + v * 9 + noise * 4) * .04f;
                    float value = Mathf.Clamp01(.79f + noise * .17f + grain);
                    byte c = (byte)Mathf.RoundToInt(value * 255);
                    pixels[y * size + x] = new Color32(c, c, c, 255);
                }
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, true, false)
                { name = wood ? "Cedar grain" : "Slate mineral grain", wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 2 };
            texture.SetPixels32(pixels); texture.Apply(true, true); stageTextures.Add(texture);
            return texture;
        }

        void CreateSky()
        {
            var shader = Shader.Find("JiuQuest/Summit Sky");
            if (shader == null) throw new System.InvalidOperationException("The Summit Sky shader is missing from the build.");
            var material = new Material(shader) { name = "Summit atmosphere" };
            skyMaterial = material;
            materials.Add(material); distantMaterials.Add(material);
            var dome = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            dome.name = "Summit sky dome";
            dome.transform.SetParent(environment, false);
            dome.transform.localScale = Vector3.one * 160;
            dome.GetComponent<Renderer>().sharedMaterial = material;
            Destroy(dome.GetComponent<Collider>());
        }

        void Lantern(Vector3 origin, Material stone, Material timber, Material bronze, Material paper)
        {
            BevelBox("Lantern stone pedestal", origin - Vector3.up * .85f, new Vector3(.84f, 1.7f, .84f), .08f, stone);
            BevelBox("Lantern foot", origin + Vector3.up * .14f, new Vector3(.68f, .28f, .68f), .06f, stone);
            BevelBox("Lantern post", origin + Vector3.up * .85f, new Vector3(.19f, 1.35f, .19f), .025f, timber);
            BevelBox("Lantern base", origin + Vector3.up * 1.48f, new Vector3(.65f, .12f, .65f), .045f, bronze);
            BevelBox("Warm paper", origin + Vector3.up * 1.79f, new Vector3(.46f, .53f, .46f), .025f, paper);
            for (int x = -1; x <= 1; x += 2)
                for (int z = -1; z <= 1; z += 2)
                    Box("Lantern frame", origin + new Vector3(x * .25f, 1.78f, z * .25f), new Vector3(.045f, .65f, .045f), timber);
            BevelBox("Lantern eave", origin + Vector3.up * 2.10f, new Vector3(.76f, .15f, .76f), .07f, timber);
            BevelBox("Lantern crown", origin + Vector3.up * 2.22f, new Vector3(.42f, .12f, .42f), .05f, bronze);
        }

        void Gate(Vector3 origin, float yaw, Material stone, Material timber, Material bronze, Material cloth)
        {
            var rotation = Quaternion.Euler(0, yaw, 0);
            for (int side = -1; side <= 1; side += 2)
            {
                Vector3 foot = origin + rotation * new Vector3(side * 3.0f, 0, 0);
                BevelBox("Gate foundation", foot - Vector3.up * .85f, new Vector3(1.20f, 1.7f, 1.20f), .10f, stone, rotation);
                BevelBox("Gate stone foot", foot + Vector3.up * .25f, new Vector3(.95f, .5f, .95f), .09f, stone, rotation);
                BevelBox("Gate cedar column", foot + Vector3.up * 2.20f, new Vector3(.47f, 4.1f, .47f), .035f, timber, rotation);
                BevelBox("Column bronze collar", foot + Vector3.up * .65f, new Vector3(.53f, .13f, .53f), .025f, bronze, rotation);
                BevelBox("Column capital", foot + Vector3.up * 3.74f, new Vector3(.72f, .20f, .67f), .05f, bronze, rotation);
                Banner(origin + rotation * new Vector3(side * 2.15f, 3.75f, -.19f), rotation, cloth, bronze);
            }
            BevelBox("Gate lower beam", origin + Vector3.up * 3.75f, new Vector3(7.4f, .30f, .42f), .07f, timber, rotation);
            BevelBox("Gate crown", origin + Vector3.up * 4.3f, new Vector3(8.25f, .40f, .65f), .11f, timber, rotation);
            BevelBox("Gate bronze reveal", origin + rotation * new Vector3(0, 4.18f, -.34f), new Vector3(7.90f, .055f, .035f), .012f, bronze, rotation);
        }

        void Banner(Vector3 top, Quaternion rotation, Material cloth, Material bronze)
        {
            // Authored folds, split tail and an original mountain-chevron crest.
            // The upper panel and crest stay fixed; two low subdivisions let the
            // split tails bend without moving their attachment or metalwork.
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            var uv = new List<Vector2>();
            const int strips = 8;
            for (int i = 0; i < strips; i++)
            {
                float x0 = -.43f + i * .1075f, x1 = x0 + .1075f;
                float depth0 = Mathf.Sin(i * 1.5f) * .045f;
                float depth1 = Mathf.Sin((i + 1) * 1.5f) * .045f;
                float bottom0 = -1.48f + (.43f - Mathf.Abs(x0)) * .52f;
                float bottom1 = -1.48f + (.43f - Mathf.Abs(x1)) * .52f;
                for (int row = 0; row < 3; row++)
                {
                    float upper = row == 0 ? 0 : row == 1 ? -.70f : -1.02f;
                    float lower0 = row == 0 ? -.70f : row == 1 ? -1.02f : bottom0;
                    float lower1 = row == 0 ? -.70f : row == 1 ? -1.02f : bottom1;
                    Quad(vertices, triangles, uv, new Vector3(x0, upper, depth0), new Vector3(x0, lower0, depth0), new Vector3(x1, lower1, depth1), new Vector3(x1, upper, depth1));
                    // Back face is geometry, avoiding a separate two-sided material.
                    Quad(vertices, triangles, uv, new Vector3(x1, upper, depth1), new Vector3(x1, lower1, depth1), new Vector3(x0, lower0, depth0), new Vector3(x0, upper, depth0));
                }
            }
            MeshObject("Folded pennant", Mesh("Summit pennant", vertices, triangles, uv), top, cloth, rotation);
            Box("Pennant rod", top + rotation * new Vector3(0, .035f, 0), new Vector3(1.07f, .065f, .065f), bronze, rotation);
            for (int sign = -1; sign <= 1; sign += 2)
            {
                var crestRotation = rotation * Quaternion.Euler(0, 0, sign * 38);
                Box("Summit crest", top + rotation * new Vector3(sign * .115f, -.48f, -.065f), new Vector3(.052f, .38f, .015f), bronze, crestRotation);
            }
        }

        void AlpineBackdrop(Material farRock, Material nearRock, Material snow, Material pine, Material timber)
        {
            // The low foreground falls away into a valley. Higher, pale peaks
            // remain distant instead of enclosing every camera in a rock wall.
            Ridge(33, 69, 11, -4.3f, 0, farRock, snow);
            Ridge(23, 38, 2.2f, -3.4f, 2.4f, nearRock, null);
            var treeMesh = PineBoughMesh();
            var trunkMesh = TaperedPrismMesh(7, .10f, .035f, 3.4f);
            for (int cluster = 0; cluster < 7; cluster++)
            {
                float center = cluster * Mathf.PI * 2 / 7 + Mathf.Sin(cluster * 3) * .19f;
                for (int member = 0; member < 5; member++)
                {
                    int seed = cluster * 11 + member;
                    float angle = center + (member - 2) * .07f + Mathf.Sin(seed * 7) * .035f;
                    float radius = 14.5f + (seed * 13 % 8);
                    var position = new Vector3(Mathf.Sin(angle) * radius, -1.8f, Mathf.Cos(angle) * radius);
                    float scale = .60f + (seed * 7 % 6) * .13f;
                    var rotation = Quaternion.Euler(0, seed * 71, 0);
                    MeshObject("Alpine pine trunk", trunkMesh, position, timber, rotation, new Vector3(scale, scale, scale));
                    MeshObject("Alpine pine boughs", treeMesh, position, pine, rotation, new Vector3(scale, scale, scale));
                }
            }
        }

        void Ridge(float inner, float outer, float height, float baseHeight, float phase, Material rock, Material snow)
        {
            const int around = 128, rows = 9, stride = around + 1;
            var vertices = new List<Vector3>(rows * stride); var uv = new List<Vector2>(rows * stride);
            var allTriangles = new List<int>(); var rockTriangles = new List<int>(); var snowTriangles = new List<int>();
            for (int row = 0; row < rows; row++)
                for (int column = 0; column <= around; column++)
                {
                    float angle = column * Mathf.PI * 2 / around;
                    float t = row / (float)(rows - 1);
                    float radius = Mathf.Lerp(inner, outer, t) + Mathf.Sin(angle * 11 + row * .45f) * 1.3f;
                    float peak = .57f + Mathf.Sin(angle * 5 + phase) * .24f + Mathf.Sin(angle * 11 - phase) * .13f + Mathf.Sin(angle * 19 + .7f) * .06f;
                    float valley = .64f + .36f * Mathf.Pow(Mathf.Sin(angle * 3 - 1.2f), 2);
                    float crossSection = Mathf.Max(0, Mathf.Sin(t * Mathf.PI));
                    float silhouette = Mathf.Pow(crossSection, .85f) * (height * peak * valley + 1.2f);
                    // Broad slopes have mild secondary relief, not straight
                    // rows of quads with separate flat normals.
                    silhouette += crossSection * Mathf.Sin(angle * 13 + t * 9) * height * .04f;
                    var point = new Vector3(Mathf.Sin(angle) * radius, baseHeight + silhouette, Mathf.Cos(angle) * radius);
                    vertices.Add(point); uv.Add(new Vector2(point.x, point.z) * .1f);
                }
            for (int row = 0; row < rows - 1; row++)
                for (int column = 0; column < around; column++)
                {
                    int a = row * stride + column, b = (row + 1) * stride + column, c = b + 1, d = a + 1;
                    var indices = new[] { a, b, c, a, c, d };
                    allTriangles.AddRange(indices);
                    bool snowFace = snow != null && (vertices[a].y + vertices[b].y + vertices[c].y + vertices[d].y) * .25f > baseHeight + height * .59f;
                    (snowFace ? snowTriangles : rockTriangles).AddRange(indices);
                }
            var terrain = Mesh("Continuous alpine terrain", vertices, allTriangles, uv);
            var normals = terrain.normals;
            for (int row = 0; row < rows; row++)
            {
                int first = row * stride, last = first + around;
                var seamNormal = (normals[first] + normals[last]).normalized;
                normals[first] = seamNormal; normals[last] = seamNormal;
            }
            terrain.SetTriangles(rockTriangles, 0); terrain.normals = normals;
            MeshObject("Distant alpine slopes", terrain, Vector3.zero, rock);
            if (snowTriangles.Count > 0)
            {
                var snowMesh = Mesh("High altitude snow", vertices, snowTriangles, uv);
                snowMesh.normals = normals;
                MeshObject("High snow fields", snowMesh, Vector3.zero, snow);
            }
        }

        void NaturalVerge(Material moss, Material stone, Material dark)
        {
            // Irregular low patches break up the terrace surround while keeping
            // all vegetation and rocks below the sparring surface.
            var vertices = new List<Vector3>(); var triangles = new List<int>(); var uv = new List<Vector2>();
            const int sections = 96;
            for (int i = 0; i < sections; i++)
            {
                float a = i * Mathf.PI * 2 / sections, b = (i + 1) * Mathf.PI * 2 / sections;
                float innerA = 7.4f + Mathf.Sin(a * 5) * .9f, innerB = 7.4f + Mathf.Sin(b * 5) * .9f;
                float outerA = 22.8f + Mathf.Sin(a * 9) * 1.3f, outerB = 22.8f + Mathf.Sin(b * 9) * 1.3f;
                // Narrow gaps provide exposed rock paths through the greenery.
                if (Mathf.Abs(Mathf.Sin(a * 4 + .4f)) < .13f) continue;
                Quad(vertices, triangles, uv, new Vector3(Mathf.Sin(a) * innerA, -1.665f, Mathf.Cos(a) * innerA),
                    new Vector3(Mathf.Sin(a) * outerA, -1.665f, Mathf.Cos(a) * outerA),
                    new Vector3(Mathf.Sin(b) * outerB, -1.665f, Mathf.Cos(b) * outerB),
                    new Vector3(Mathf.Sin(b) * innerB, -1.665f, Mathf.Cos(b) * innerB));
            }
            MeshObject("Alpine verge", Mesh("Moss and stone verge", vertices, triangles, uv), Vector3.zero, moss);
            var boulder = BoulderMesh();
            for (int cluster = 0; cluster < 9; cluster++)
            {
                float center = cluster * Mathf.PI * 2 / 9 + .16f;
                for (int member = 0; member < 3; member++)
                {
                    float angle = center + member * .045f;
                    float radius = 8.4f + (cluster * 7 % 4) + member * .55f;
                    float size = .45f + ((cluster * 3 + member * 7) % 6) * .14f;
                    var position = new Vector3(Mathf.Sin(angle) * radius, -1.67f, Mathf.Cos(angle) * radius);
                    MeshObject("Slate outcrop", boulder, position, member == 1 ? stone : dark,
                        Quaternion.Euler(0, cluster * 67 + member * 33, 0), new Vector3(size * 1.2f, size * .72f, size));
                }
            }
        }

        Mesh BoulderMesh()
        {
            const int sides = 9;
            var vertices = new List<Vector3>(); var triangles = new List<int>(); var uv = new List<Vector2>();
            var lower = new Vector3[sides]; var shoulder = new Vector3[sides];
            for (int i = 0; i < sides; i++)
            {
                float angle = -i * Mathf.PI * 2 / sides;
                float radius = .67f + Mathf.Sin(i * 7) * .14f;
                lower[i] = new Vector3(Mathf.Cos(angle) * radius, 0, Mathf.Sin(angle) * radius);
                shoulder[i] = new Vector3(Mathf.Cos(angle) * radius * .78f + .06f, .49f + Mathf.Sin(i * 3) * .09f, Mathf.Sin(angle) * radius * .82f);
            }
            for (int i = 0; i < sides; i++)
            {
                int next = (i + 1) % sides;
                Quad(vertices, triangles, uv, lower[i], lower[next], shoulder[next], shoulder[i]);
                Triangle(vertices, triangles, uv, shoulder[i], shoulder[next], new Vector3(.12f, .68f, -.07f));
            }
            return Mesh("Weathered slate boulder", vertices, triangles, uv);
        }

        Mesh PineBoughMesh()
        {
            var vertices = new List<Vector3>(); var triangles = new List<int>(); var uv = new List<Vector2>();
            const int layers = 6, branches = 11;
            for (int layer = 0; layer < layers; layer++)
                for (int branch = 0; branch < branches; branch++)
                {
                    float angle = branch * Mathf.PI * 2 / branches + layer * 1.15f;
                    float height = .70f + layer * .43f;
                    float radius = (1 - layer / 7f) * (.67f + Mathf.Sin(branch * 7 + layer * 3) * .17f);
                    var outward = new Vector3(Mathf.Cos(angle), 0, Mathf.Sin(angle));
                    var side = new Vector3(-outward.z, 0, outward.x) * radius * .35f;
                    var root = new Vector3(0, height + .56f, 0);
                    var tip = outward * radius + Vector3.up * height;
                    var left = tip * .72f + side; left.y = height + .12f;
                    var right = tip * .72f - side; right.y = height + .12f;
                    Triangle(vertices, triangles, uv, root, left, tip);
                    Triangle(vertices, triangles, uv, root, tip, right);
                    Triangle(vertices, triangles, uv, right, tip, left);
                }
            return Mesh("Layered pine boughs", vertices, triangles, uv);
        }

        void FloorRing(float inner, float outer, float y, int segments, Material material)
        {
            var vertices = new List<Vector3>(); var triangles = new List<int>(); var uv = new List<Vector2>();
            for (int i = 0; i < segments; i++)
            {
                float a = -i * Mathf.PI * 2 / segments, b = -(i + 1) * Mathf.PI * 2 / segments;
                Quad(vertices, triangles, uv, new Vector3(Mathf.Cos(a) * inner, y, Mathf.Sin(a) * inner),
                    new Vector3(Mathf.Cos(a) * outer, y, Mathf.Sin(a) * outer),
                    new Vector3(Mathf.Cos(b) * outer, y, Mathf.Sin(b) * outer),
                    new Vector3(Mathf.Cos(b) * inner, y, Mathf.Sin(b) * inner));
            }
            MeshObject("Compass inlay", Mesh("Compass ring", vertices, triangles, uv), Vector3.zero, material);
        }

        void Prism(string name, int sides, float radius, float height, float bottom, Material material)
            => MeshObject(name, TaperedPrismMesh(sides, radius, radius, height), Vector3.up * bottom, material, Quaternion.Euler(0, 22.5f, 0));

        Mesh TaperedPrismMesh(int sides, float bottomRadius, float topRadius, float height)
        {
            var vertices = new List<Vector3>(); var triangles = new List<int>(); var uv = new List<Vector2>();
            for (int i = 0; i < sides; i++)
            {
                float a = -i * Mathf.PI * 2 / sides, b = -(i + 1) * Mathf.PI * 2 / sides;
                var p = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                var q = new Vector3(Mathf.Cos(b), 0, Mathf.Sin(b));
                Quad(vertices, triangles, uv, p * bottomRadius, q * bottomRadius, q * topRadius + Vector3.up * height, p * topRadius + Vector3.up * height);
                Triangle(vertices, triangles, uv, Vector3.up * height, p * topRadius + Vector3.up * height, q * topRadius + Vector3.up * height);
            }
            return Mesh("Faceted summit stone", vertices, triangles, uv);
        }

        void BevelBox(string name, Vector3 position, Vector3 size, float bevel, Material material, Quaternion rotation = default)
            => MeshObject(name, BeveledBoxMesh(size, bevel), position, material, rotation);

        Mesh BeveledBoxMesh(Vector3 size, float bevel)
        {
            float x = size.x * .5f, y = size.y * .5f, z = size.z * .5f;
            float b = Mathf.Min(bevel, Mathf.Min(y * .8f, Mathf.Min(x, z) * .25f));
            var ring = new[] { new Vector2(-x + b, -z), new Vector2(-x, -z + b), new Vector2(-x, z - b), new Vector2(-x + b, z),
                new Vector2(x - b, z), new Vector2(x, z - b), new Vector2(x, -z + b), new Vector2(x - b, -z) };
            var vertices = new List<Vector3>(); var triangles = new List<int>(); var uv = new List<Vector2>();
            for (int i = 0; i < ring.Length; i++)
            {
                var a = ring[i]; var next = ring[(i + 1) % ring.Length];
                var p = new Vector3(a.x, y - b, a.y); var q = new Vector3(next.x, y - b, next.y);
                var pt = new Vector3(a.x * (x - b) / x, y, a.y * (z - b) / z);
                var qt = new Vector3(next.x * (x - b) / x, y, next.y * (z - b) / z);
                Quad(vertices, triangles, uv, new Vector3(a.x, -y, a.y), new Vector3(next.x, -y, next.y), q, p);
                Quad(vertices, triangles, uv, p, q, qt, pt);
                Triangle(vertices, triangles, uv, Vector3.up * y, pt, qt);
            }
            return Mesh("Chamfered stone", vertices, triangles, uv);
        }

        static void Quad(List<Vector3> vertices, List<int> triangles, List<Vector2> uv, Vector3 a, Vector3 b, Vector3 c, Vector3 d)
        {
            int start = vertices.Count;
            vertices.AddRange(new[] { a, b, c, d });
            var normal = Vector3.Cross(b - a, c - a);
            uv.AddRange(new[] { FaceUV(a, normal), FaceUV(b, normal), FaceUV(c, normal), FaceUV(d, normal) });
            triangles.AddRange(new[] { start, start + 1, start + 2, start, start + 2, start + 3 });
        }

        static void Triangle(List<Vector3> vertices, List<int> triangles, List<Vector2> uv, Vector3 a, Vector3 b, Vector3 c)
        {
            int start = vertices.Count;
            vertices.AddRange(new[] { a, b, c });
            var normal = Vector3.Cross(b - a, c - a);
            uv.AddRange(new[] { FaceUV(a, normal), FaceUV(b, normal), FaceUV(c, normal) });
            triangles.AddRange(new[] { start, start + 1, start + 2 });
        }

        static Vector2 FaceUV(Vector3 position, Vector3 normal)
        {
            float x = Mathf.Abs(normal.x), y = Mathf.Abs(normal.y), z = Mathf.Abs(normal.z);
            if (y >= x && y >= z) return new Vector2(position.x, position.z);
            return x > z ? new Vector2(position.z, position.y) : new Vector2(position.x, position.y);
        }

        Mesh Mesh(string name, List<Vector3> vertices, List<int> triangles, List<Vector2> uv)
        {
            var mesh = new Mesh { name = name };
            mesh.SetVertices(vertices); mesh.SetTriangles(triangles, 0); mesh.SetUVs(0, uv);
            mesh.RecalculateNormals(); mesh.RecalculateBounds();
            stageMeshes.Add(mesh);
            return mesh;
        }

        void MeshObject(string name, Mesh mesh, Vector3 position, Material material, Quaternion rotation = default, Vector3 scale = default)
        {
            var item = new GameObject(name);
            item.transform.SetParent(environment, false);
            item.transform.localPosition = position;
            item.transform.localRotation = rotation.Equals(default(Quaternion)) ? Quaternion.identity : rotation;
            item.transform.localScale = scale == default ? Vector3.one : scale;
            item.AddComponent<MeshFilter>().sharedMesh = mesh;
            item.AddComponent<MeshRenderer>().sharedMaterial = material;
        }

        void Box(string name, Vector3 position, Vector3 size, Material material, Quaternion rotation = default)
        {
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = name;
            cube.transform.SetParent(environment, false);
            cube.transform.localPosition = position;
            cube.transform.localRotation = rotation.Equals(default(Quaternion)) ? Quaternion.identity : rotation;
            cube.transform.localScale = size;
            cube.GetComponent<Renderer>().sharedMaterial = material;
            Destroy(cube.GetComponent<Collider>());
        }

        void Light(string label, Vector3 angles, Color color, float intensity, bool shadow)
        {
            var light = new GameObject(label).AddComponent<Light>();
            light.transform.SetParent(environment, false);
            light.transform.rotation = Quaternion.Euler(angles);
            light.type = LightType.Directional;
            light.color = color;
            light.intensity = intensity;
            light.shadows = shadow ? LightShadows.Soft : LightShadows.None;
            light.shadowBias = .04f;
            light.shadowNormalBias = .2f;
        }

        void OnDestroy()
        {
            foreach (var material in materials) if (material != null) Destroy(material);
            foreach (var mesh in stageMeshes) if (mesh != null) Destroy(mesh);
            foreach (var texture in stageTextures) if (texture != null) Destroy(texture);
        }
    }

    public static class SummitAmbientMotion
    {
        public const float MaxDisplacement = .10f;

        public static float Phase(float playbackTime, float duration)
        {
            if (!CombatProtocol.Finite(playbackTime) || !CombatProtocol.Finite(duration)
                || duration <= 0 || playbackTime <= 0 || playbackTime >= duration) return 0;
            return playbackTime / duration * Mathf.PI * 2;
        }

        public static Vector4 Waves(float phase)
            => new Vector4(Mathf.Sin(phase), Mathf.Cos(phase) - 1, Mathf.Sin(phase * 2), Mathf.Cos(phase * 2) - 1);

        public static Vector4 BannerWeights(Vector3 rest)
        {
            // All four pennants attach at y=3.75. Preserve their upper 0.70m,
            // including the crest, and strengthen movement toward the loose tips.
            float weight = Mathf.Clamp01((3.05f - rest.y) / .78f);
            weight *= weight;
            float spatialPhase = rest.x * .78f + rest.z * .13f;
            return new Vector4(Mathf.Cos(spatialPhase) * weight * .045f, Mathf.Sin(spatialPhase) * weight * .045f,
                Mathf.Cos(spatialPhase * .6f) * weight * .008f, Mathf.Sin(spatialPhase * .6f) * weight * .008f);
        }

        public static Vector3 BannerOffset(Vector4 weights, Vector4 waves)
            => new Vector3(weights.z * waves.z + weights.w * waves.w, 0, weights.x * waves.x + weights.y * waves.y);
    }
}
