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
        UnityEngine.Light keyLight;
        CombatRenderQuality renderQuality;
        Transform environment;
        Material pennantMaterial;
        Material skyMaterial;
        Material cedarMaterial;
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
            RenderSettings.ambientSkyColor = new Color(.46f, .53f, .66f);
            RenderSettings.ambientEquatorColor = new Color(.35f, .40f, .49f);
            RenderSettings.ambientGroundColor = new Color(.20f, .24f, .29f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = new Color(.48f, .56f, .66f);
            RenderSettings.fogDensity = .013f;
            var dark = Material("Weathered basalt", new Color(.15f, .19f, .24f), .12f);
            var stone = Material("Hand-cut slate", new Color(.39f, .43f, .47f), .18f);
            var stoneLight = Material("Slate bevels", new Color(.51f, .54f, .55f), .22f);
            var timber = Material("Oiled cedar", new Color(.43f, .29f, .18f), .24f);
            cedarMaterial = timber;
            var matA = Material("Woven jade tatami", new Color(.23f, .33f, .35f), .09f);
            var matB = Material("Woven blue tatami", new Color(.25f, .35f, .39f), .09f);
            var accent = Material("Jade inlay", new Color(.15f, .64f, .55f), .42f, true);
            var gold = Material("Aged bronze", new Color(.94f, .85f, .70f), .80f);
            var lantern = Material("Lantern paper", new Color(1f, .70f, .34f), .12f, true);
            var cloth = Material("Twilight pennants", Color.white, .05f);
            pennantMaterial = cloth;
            var farRock = Material("Far mountains", new Color(.49f, .56f, .66f), .02f);
            var nearRock = Material("Near mountains", new Color(.36f, .43f, .51f), .02f);
            var snow = Material("Summit snow", new Color(.79f, .84f, .90f), .06f);
            var pine = Material("Alpine pines", new Color(.10f, .22f, .21f), .02f);
            var moss = Material("Alpine moss verge", new Color(.30f, .37f, .35f), .025f);
            distantMaterials.UnionWith(new[] { farRock, nearRock, snow, pine, moss });
            // Shared maps keep surface detail independent of material/draw count.
            // With full mip chains these eleven RGBA maps occupy about 2.27 MB.
            var slate = SurfaceMaps(SummitSurface.Slate, 256);
            var cedar = SurfaceMaps(SummitSurface.Cedar, 256);
            var weave = SurfaceMaps(SummitSurface.Tatami, 128);
            var bronze = SurfaceMaps(SummitSurface.Bronze, 128);
            ApplySurface(stone, slate); ApplySurface(stoneLight, slate); ApplySurface(dark, slate);
            ApplySurface(timber, cedar); ApplySurface(matA, weave); ApplySurface(matB, weave);
            ApplySurface(gold, bronze);
            // Fine, low-contrast mineral layers soften distant slopes without
            // competing with the pair. Each material family shares one map.
            var alpine = SurfaceMaps(SummitSurface.Alpine, 256);
            ApplySurface(farRock, alpine); ApplySurface(nearRock, alpine);
            var boughPaint = SurfaceMaps(SummitSurface.Pine, 128);
            boughPaint.Color.wrapMode = TextureWrapMode.Clamp;
            ApplySurface(pine, boughPaint);
            matA.SetTextureOffset("_BaseMap", new Vector2(.5f, .5f));
            matB.SetTextureOffset("_BaseMap", new Vector2(.5f, .5f));
            moss.SetTexture("_BaseMap", slate.Color);
            moss.SetTextureScale("_BaseMap", new Vector2(.071f, .083f));
            cloth.SetTexture("_BaseMap", SurfaceMaps(SummitSurface.Banner, 128).Color);
            CreateSky();

            // The center stays uncluttered for grappling. Detail belongs to the
            // chamfered edge, quiet tatami weave, and silhouettes behind the pair.
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
            NaturalVerge(moss, stone, dark, nearRock, snow);
            CombineArchitecture();

            // Keep colored dojo accents out of facial lighting so the authored
            // skin texture and selected tone remain natural from every camera.
            keyLight = Light("Winter daylight key", new Vector3(48, -32, 0), new Color(1, .97f, .93f), 1.05f, true);
            Light("Sky fill", new Vector3(32, 132, 0), new Color(.77f, .85f, 1), .30f, false);
            Light("Summit rim", new Vector3(35, 210, 0), new Color(1, .86f, .70f), .34f, false);
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
            renderQuality = new CombatRenderQuality(SystemInfo.graphicsDeviceName,
                GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset, sceneCamera, keyLight);
            ApplyRenderQuality(false);
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
            ApplyRenderQuality(compact);
            PlaceCamera(true);
        }

        void ApplyRenderQuality(bool compact)
        {
            if (renderQuality != null && renderQuality.ApplyViewport(compact))
                Debug.Log("JiuQuest render quality: " + JsonUtility.ToJson(renderQuality.Describe(SystemInfo.graphicsDeviceType.ToString())));
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
                if (material.IsKeywordEnabled("_NORMALMAP")) mesh.RecalculateTangents();
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

        enum SummitSurface { Slate, Cedar, Tatami, Bronze, Banner, Alpine, Pine }

        struct StageSurfaceMaps
        {
            public Texture2D Color, Normal, Metallic;
        }

        void ApplySurface(Material material, StageSurfaceMaps surface)
        {
            material.SetTexture("_BaseMap", surface.Color);
            if (surface.Normal != null)
            {
                material.SetTexture("_BumpMap", surface.Normal);
                material.SetFloat("_BumpScale", 1);
                material.EnableKeyword("_NORMALMAP");
            }
            if (surface.Metallic != null)
            {
                material.SetTexture("_MetallicGlossMap", surface.Metallic);
                material.SetFloat("_Metallic", 1);
                material.EnableKeyword("_METALLICSPECGLOSSMAP");
            }
        }

        StageSurfaceMaps SurfaceMaps(SummitSurface surface, int size)
        {
            bool relief = surface == SummitSurface.Slate || surface == SummitSurface.Cedar || surface == SummitSurface.Tatami;
            var colors = new Color32[size * size];
            var heights = relief ? new float[size * size] : null;
            var metal = surface == SummitSurface.Bronze ? new Color32[size * size] : null;
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float u = x / (float)size, v = y / (float)size;
                    float broad = TileNoise(u, v, 4, 17), medium = TileNoise(u, v, 13, 43), grain = TileNoise(u, v, 53, 71);
                    float height = .5f;
                    Color color;
                    if (surface == SummitSurface.Slate)
                    {
                        float vein = Mathf.Abs(Mathf.Sin(Mathf.PI * 2 * (u * 2 + v) + broad * 1.8f + medium * .55f));
                        float crack = 1 - SmoothBand(.025f, .085f, vein);
                        float pores = Mathf.Pow(Mathf.Clamp01((grain - .62f) / .38f), 3);
                        float value = .61f + broad * .23f + medium * .08f - crack * .27f - pores * .13f;
                        float mineral = SmoothBand(.66f, .88f, medium) * .075f;
                        color = new Color(value + mineral, value + mineral * .67f, value + .025f);
                        height = .48f + broad * .11f + medium * .035f - crack * .11f - pores * .10f;
                    }
                    else if (surface == SummitSurface.Cedar)
                    {
                        float rings = Mathf.Sin(Mathf.PI * 2 * (u * 13 + Mathf.Sin(v * Mathf.PI * 2) * .16f + broad * .75f)) * .5f + .5f;
                        float groove = Mathf.Pow(rings, 7);
                        float weather = SmoothBand(.52f, .81f, medium);
                        float value = .78f + broad * .15f - groove * .23f - weather * .10f + (grain - .5f) * .035f;
                        color = new Color(value, value * .86f + weather * .045f, value * .69f + weather * .08f);
                        height = .52f + broad * .06f - groove * .075f - weather * .025f;
                    }
                    else if (surface == SummitSurface.Tatami)
                    {
                        float weave = Mathf.Sin(u * Mathf.PI * 64) * Mathf.Sin(v * Mathf.PI * 64);
                        float edge = Mathf.Min(Mathf.Min(u, 1 - u), Mathf.Min(v, 1 - v));
                        float edgeWear = 1 - SmoothBand(.012f, .060f, edge);
                        float value = .80f + broad * .14f + weave * .045f - edgeWear * .10f;
                        color = new Color(value, value + .015f, value + .020f);
                        height = .5f + weave * .032f - edgeWear * .020f;
                    }
                    else if (surface == SummitSurface.Bronze)
                    {
                        float patina = SmoothBand(.47f, .72f, broad * .72f + medium * .28f);
                        color = Color.Lerp(new Color(.92f, .70f, .39f), new Color(.24f, .43f, .39f), patina * .78f);
                        color *= .87f + grain * .13f;
                        metal[y * size + x] = new Color(Mathf.Lerp(.85f, .12f, patina), 0, 0, Mathf.Lerp(.78f, .28f, patina));
                    }
                    else if (surface == SummitSurface.Alpine)
                    {
                        // Weathered mineral deposits, not a network of thick dark
                        // seams. Fine layers soften naturally in the existing mip chain.
                        float warp = broad * 1.6f + medium * .35f;
                        float strata = Mathf.Sin(Mathf.PI * 2 * (v * 13 + u * 3) + warp) * .5f + .5f;
                        float channel = 1 - SmoothBand(.025f, .10f,
                            Mathf.Abs(Mathf.Sin(Mathf.PI * 2 * (u * 7 + v) + warp)));
                        float mineral = SmoothBand(.50f, .83f, medium * .75f + grain * .25f);
                        float value = .79f + broad * .11f + (strata - .5f) * .045f - channel * .030f;
                        color = new Color(value + mineral * .025f, value + mineral * .018f, value + .015f);
                    }
                    else if (surface == SummitSurface.Pine)
                    {
                        // The solid bough UVs run root-to-tip. A dark central spine,
                        // lighter growing tips and diagonal needle groups replace flat tiers.
                        float edge = Mathf.Abs(u - .5f) * 2;
                        float spine = 1 - SmoothBand(.025f, .16f, edge);
                        float needles = Mathf.Sin((v * 9 - edge * 3) * Mathf.PI * 2) * .5f + .5f;
                        float value = .60f + v * .20f + edge * .11f + broad * .10f + needles * .065f - spine * .12f;
                        color = new Color(value * .88f, value, value * .93f);
                    }
                    else
                    {
                        float border = 1 - SmoothBand(.030f, .055f, Mathf.Min(u, 1 - u));
                        float stitch = Mathf.Pow(Mathf.Sin(v * Mathf.PI * 48) * .5f + .5f, 5) * border;
                        float innerBorder = 1 - SmoothBand(.006f, .012f, Mathf.Abs(Mathf.Min(u, 1 - u) - .085f));
                        color = Color.Lerp(new Color(.13f, .18f, .31f), new Color(.44f, .59f, .63f), innerBorder * .50f);
                        color = Color.Lerp(color, new Color(.66f, .50f, .28f), border * (.62f + stitch * .24f));
                        color *= .86f + broad * .12f + (grain - .5f) * .035f;
                    }
                    color.a = 1;
                    colors[y * size + x] = color;
                    if (relief) heights[y * size + x] = height;
                }
            var result = new StageSurfaceMaps { Color = StageTexture(surface + " color", colors, size, false) };
            if (metal != null) result.Metallic = StageTexture("Bronze metal and polish", metal, size, true);
            if (relief)
            {
                var normals = new Color32[size * size];
                float strength = surface == SummitSurface.Slate ? 2.4f : surface == SummitSurface.Cedar ? 2.0f : 1.8f;
                for (int y = 0; y < size; y++)
                    for (int x = 0; x < size; x++)
                    {
                        float dx = heights[y * size + (x + size - 1) % size] - heights[y * size + (x + 1) % size];
                        float dy = heights[((y + size - 1) % size) * size + x] - heights[((y + 1) % size) * size + x];
                        var normal = new Vector3(dx * strength, dy * strength, 1).normalized;
                        // Linear RGBA with alpha=1 supports URP's RGB and RG-or-AG unpack paths.
                        normals[y * size + x] = new Color(normal.x * .5f + .5f, normal.y * .5f + .5f, normal.z * .5f + .5f, 1);
                    }
                result.Normal = StageTexture(surface + " relief", normals, size, true);
            }
            return result;
        }

        Texture2D StageTexture(string label, Color32[] pixels, int size, bool linear)
        {
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, true, linear)
                { name = "Summit " + label, wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 2 };
            texture.SetPixels32(pixels); texture.Apply(true, true); stageTextures.Add(texture);
            return texture;
        }

        static float TileNoise(float u, float v, int cells, int seed)
        {
            int x = Mathf.FloorToInt(u * cells), y = Mathf.FloorToInt(v * cells);
            float tx = Mathf.Repeat(u * cells, 1), ty = Mathf.Repeat(v * cells, 1);
            tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
            return Mathf.Lerp(Mathf.Lerp(TileValue(x, y, cells, seed), TileValue(x + 1, y, cells, seed), tx),
                Mathf.Lerp(TileValue(x, y + 1, cells, seed), TileValue(x + 1, y + 1, cells, seed), tx), ty);
        }

        static float SmoothBand(float lower, float upper, float value)
        {
            float t = Mathf.InverseLerp(lower, upper, value);
            return t * t * (3 - 2 * t);
        }

        static float TileValue(int x, int y, int cells, int seed)
        {
            unchecked
            {
                uint value = (uint)((x % cells + cells) % cells) * 374761393u
                    + (uint)((y % cells + cells) % cells) * 668265263u + (uint)seed * 2246822519u;
                value = (value ^ (value >> 13)) * 1274126177u;
                return (value & 0x00ffffff) / 16777215f;
            }
        }

        void CreateSky()
        {
            var shader = Shader.Find("JiuQuest/Summit Sky");
            if (shader == null) throw new System.InvalidOperationException("The Summit Sky shader is missing from the build.");
            var material = new Material(shader) { name = "Summit atmosphere" };
            skyMaterial = material;
            materials.Add(material); distantMaterials.Add(material);
            MeshObject("Summit sky dome", SkySphereMesh(), Vector3.zero, material);
        }

        Mesh SkySphereMesh()
        {
            // CreatePrimitive also requests a SphereCollider before we could
            // remove it. A sky has no physics, so own only the mesh and renderer.
            // Outward winding is intentional: SummitSky uses Cull Front inside.
            const int segments = 32, latitudes = 16;
            const float radius = 80;
            var vertices = new List<Vector3> { Vector3.up * radius };
            var uv = new List<Vector2> { new Vector2(.5f, 0) };
            var triangles = new List<int>();
            for (int latitude = 1; latitude < latitudes; latitude++)
            {
                float polar = latitude * Mathf.PI / latitudes;
                for (int longitude = 0; longitude < segments; longitude++)
                {
                    float azimuth = longitude * Mathf.PI * 2 / segments;
                    vertices.Add(new Vector3(Mathf.Sin(polar) * Mathf.Sin(azimuth), Mathf.Cos(polar),
                        Mathf.Sin(polar) * Mathf.Cos(azimuth)) * radius);
                    uv.Add(new Vector2(longitude / (float)segments, latitude / (float)latitudes));
                }
            }
            int south = vertices.Count;
            vertices.Add(Vector3.down * radius); uv.Add(new Vector2(.5f, 1));
            for (int longitude = 0; longitude < segments; longitude++)
            {
                int next = (longitude + 1) % segments;
                triangles.AddRange(new[] { 0, 1 + longitude, 1 + next });
                for (int latitude = 0; latitude < latitudes - 2; latitude++)
                {
                    int a = 1 + latitude * segments + longitude, b = a + segments;
                    int d = 1 + latitude * segments + next, c = d + segments;
                    triangles.AddRange(new[] { a, b, c, a, c, d });
                }
                int lastRing = 1 + (latitudes - 2) * segments;
                triangles.AddRange(new[] { south, lastRing + next, lastRing + longitude });
            }
            return Mesh("Collision-free summit sky sphere", vertices, triangles, uv);
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
            for (int index = 0; index < vertices.Count; index++)
                uv[index] = new Vector2((vertices[index].x + .43f) / .86f, -vertices[index].y / 1.48f);
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
            Ridge(37, 72, 12.5f, -4.8f, 0, farRock, snow);
            Ridge(29, 48, 5.2f, -4.1f, 1.7f, farRock, null);
            Ridge(23, 38, 2.2f, -3.4f, 2.4f, nearRock, null);
            var trees = new[] { PineBoughMesh(0), PineBoughMesh(1), PineBoughMesh(2) };
            var frostedBoughs = new[] { PineBoughMesh(0, true), PineBoughMesh(1, true), PineBoughMesh(2, true) };
            var trunkMesh = TaperedPrismMesh(7, .10f, .035f, 3.4f);
            for (int cluster = 0; cluster < 8; cluster++)
            {
                float center = cluster * Mathf.PI * 2 / 8 + Mathf.Sin(cluster * 3) * .19f;
                for (int member = 0; member < 6; member++)
                {
                    int seed = cluster * 11 + member;
                    float angle = center + (member - 2.5f) * .055f + Mathf.Sin(seed * 7) * .045f;
                    float radius = 14.5f + (seed * 13 % 9);
                    var position = ShelfPoint(angle, radius) - Vector3.up * .03f;
                    float scale = .56f + (seed * 5 % 9) * .065f;
                    float width = scale * (.78f + (seed % 4) * .12f);
                    var rotation = Quaternion.Euler(Mathf.Sin(seed) * 2, seed * 71, Mathf.Cos(seed * 3) * 2);
                    var proportions = new Vector3(width, scale, width);
                    MeshObject("Alpine pine trunk", trunkMesh, position, timber, rotation, proportions);
                    MeshObject("Branched alpine conifer", trees[seed % trees.Length], position, pine, rotation, proportions);
                    MeshObject("Settled bough snow", frostedBoughs[seed % frostedBoughs.Length], position, snow, rotation, proportions);
                }
            }
        }

        void Ridge(float inner, float outer, float height, float baseHeight, float phase, Material rock, Material snow)
        {
            const int around = 160, rows = 11, stride = around + 1;
            var vertices = new List<Vector3>(rows * stride); var uv = new List<Vector2>(rows * stride);
            var allTriangles = new List<int>(); var snowMask = new List<float>(rows * stride);
            for (int row = 0; row < rows; row++)
                for (int column = 0; column <= around; column++)
                {
                    float angle = column * Mathf.PI * 2 / around;
                    float t = row / (float)(rows - 1);
                    float radius = Mathf.Lerp(inner, outer, t) + Mathf.Sin(angle * 11 + row * .45f + phase) * 1.3f;
                    float peak = .60f + Mathf.Sin(angle * 5 + phase) * .21f + Mathf.Sin(angle * 11 - phase) * .12f
                        + Mathf.Sin(angle * 23 + .7f) * .065f + Mathf.Sin(angle * 37 + phase) * .025f;
                    float valley = .66f + .34f * Mathf.Pow(Mathf.Sin(angle * 3 - 1.2f), 2);
                    // Move each crest in depth. Unequal flanks and incised gullies
                    // produce overlapping mountain shoulders rather than one smooth wall.
                    float crest = .49f + Mathf.Sin(angle * 7 + phase) * .09f + Mathf.Sin(angle * 13) * .035f;
                    float crossSection = t < crest ? t / crest : (1 - t) / (1 - crest);
                    crossSection = Mathf.Pow(Mathf.Clamp01(crossSection), t < crest ? .72f : 1.2f);
                    float gully = Mathf.Pow(Mathf.Abs(Mathf.Sin(angle * 17 + t * 5 + phase)), 5);
                    float silhouette = crossSection * (height * peak * valley + 1.2f);
                    silhouette -= Mathf.Sin(t * Mathf.PI) * gully * height * .10f;
                    silhouette += crossSection * Mathf.Sin(angle * 31 - t * 7) * height * .028f;
                    var point = new Vector3(Mathf.Sin(angle) * radius, baseHeight + silhouette, Mathf.Cos(angle) * radius);
                    vertices.Add(point); uv.Add(new Vector2(point.x, point.z) * .1f);
                    float snowLine = baseHeight + height * (.47f + Mathf.Sin(angle * 9 + phase) * .065f
                        + Mathf.Sin(angle * 21 + t * 8) * .045f + gully * .07f);
                    snowMask.Add(point.y - snowLine);
                }
            for (int row = 0; row < rows - 1; row++)
                for (int column = 0; column < around; column++)
                {
                    int a = row * stride + column, b = (row + 1) * stride + column, c = b + 1, d = a + 1;
                    var indices = new[] { a, b, c, a, c, d };
                    allTriangles.AddRange(indices);
                }
            var terrain = Mesh("Continuous alpine terrain", vertices, allTriangles, uv);
            var normals = terrain.normals;
            for (int row = 0; row < rows; row++)
            {
                int first = row * stride, last = first + around;
                var seamNormal = (normals[first] + normals[last]).normalized;
                normals[first] = seamNormal; normals[last] = seamNormal;
            }
            terrain.normals = normals;
            MeshObject("Distant alpine slopes", terrain, Vector3.zero, rock);
            if (snow != null)
            {
                // Cut snow at a varying height inside each triangle. The old
                // whole-quad mask formed a straight, conspicuous white ribbon.
                var caps = new List<Vector3>(); var capUv = new List<Vector2>(); var capNormals = new List<Vector3>();
                var capTriangles = new List<int>(); var input = new TerrainPoint[3]; var clipped = new TerrainPoint[4];
                for (int triangle = 0; triangle < allTriangles.Count; triangle += 3)
                {
                    for (int corner = 0; corner < 3; corner++)
                    {
                        int index = allTriangles[triangle + corner];
                        input[corner] = new TerrainPoint { Position = vertices[index], Normal = normals[index], Uv = uv[index], Snow = snowMask[index] };
                    }
                    int count = ClipSnowTriangle(input, clipped);
                    int first = caps.Count;
                    for (int corner = 0; corner < count; corner++)
                    {
                        caps.Add(clipped[corner].Position + clipped[corner].Normal * .025f);
                        capUv.Add(clipped[corner].Uv); capNormals.Add(clipped[corner].Normal);
                    }
                    for (int corner = 1; corner < count - 1; corner++)
                        capTriangles.AddRange(new[] { first, first + corner, first + corner + 1 });
                }
                if (capTriangles.Count > 0)
                {
                    var snowMesh = Mesh("Broken alpine snow fields", caps, capTriangles, capUv);
                    snowMesh.SetNormals(capNormals);
                    MeshObject("High snow fields", snowMesh, Vector3.zero, snow);
                }
            }
        }

        struct TerrainPoint { public Vector3 Position, Normal; public Vector2 Uv; public float Snow; }

        static int ClipSnowTriangle(TerrainPoint[] input, TerrainPoint[] output)
        {
            int count = 0;
            var previous = input[2];
            foreach (var current in input)
            {
                if ((current.Snow >= 0) != (previous.Snow >= 0))
                {
                    float fraction = previous.Snow / (previous.Snow - current.Snow);
                    output[count++] = new TerrainPoint {
                        Position = Vector3.Lerp(previous.Position, current.Position, fraction),
                        Normal = Vector3.Lerp(previous.Normal, current.Normal, fraction).normalized,
                        Uv = Vector2.Lerp(previous.Uv, current.Uv, fraction), Snow = 0
                    };
                }
                if (current.Snow >= 0) output[count++] = current;
                previous = current;
            }
            return count;
        }

        void NaturalVerge(Material moss, Material stone, Material dark, Material ground, Material snow)
        {
            // Irregular low patches break up the terrace surround while keeping
            // all vegetation and rocks below the sparring surface.
            var vertices = new List<Vector3>(); var triangles = new List<int>(); var uv = new List<Vector2>();
            const int sections = 96;
            // A gently sloping shelf disappears into the foothills. There is no
            // regular polygon rim or floating horizontal cliff behind the trees.
            var shelf = new List<Vector3>(); var shelfUv = new List<Vector2>(); var shelfTriangles = new List<int>();
            const int shelfRows = 5, stride = sections + 1;
            for (int row = 0; row < shelfRows; row++)
                for (int column = 0; column <= sections; column++)
                {
                    float angle = column * Mathf.PI * 2 / sections;
                    float radius = row / (float)(shelfRows - 1) * (29 + Mathf.Sin(angle * 9) * .9f);
                    var point = ShelfPoint(angle, radius);
                    shelf.Add(point); shelfUv.Add(new Vector2(point.x, point.z) * .1f);
                }
            for (int row = 0; row < shelfRows - 1; row++)
                for (int column = 0; column < sections; column++)
                {
                    int a = row * stride + column, b = a + stride;
                    shelfTriangles.AddRange(new[] { a, b, b + 1, a, b + 1, a + 1 });
                }
            MeshObject("Natural mountain shelf", Mesh("Uneven basalt shelf", shelf, shelfTriangles, shelfUv), Vector3.zero, ground);
            for (int i = 0; i < sections; i++)
            {
                float a = i * Mathf.PI * 2 / sections, b = (i + 1) * Mathf.PI * 2 / sections;
                float innerA = 7.6f + Mathf.Sin(a * 5) * .65f, innerB = 7.6f + Mathf.Sin(b * 5) * .65f;
                float outerA = 27.4f + Mathf.Sin(a * 9) * 1.3f, outerB = 27.4f + Mathf.Sin(b * 9) * 1.3f;
                // Sheltered snow follows the uneven shelf. Gaps expose stone;
                // the inner edge stays outside the terrace and grappling mat.
                if (Mathf.Abs(Mathf.Sin(a * 4 + .4f)) < .13f) continue;
                for (int band = 0; band < 4; band++)
                {
                    float from = band / 4f, to = (band + 1) / 4f;
                    Quad(vertices, triangles, uv, SnowShelfPoint(a, Mathf.Lerp(innerA, outerA, from)),
                        SnowShelfPoint(a, Mathf.Lerp(innerA, outerA, to)),
                        SnowShelfPoint(b, Mathf.Lerp(innerB, outerB, to)),
                        SnowShelfPoint(b, Mathf.Lerp(innerB, outerB, from)));
                }
            }
            MeshObject("Sheltered snow drifts", Mesh("Irregular winter verge", vertices, triangles, uv), Vector3.zero, snow);
            var boulder = BoulderMesh();
            var boulderSnow = BoulderMesh(true);
            var planting = AlpinePlantMesh();
            for (int cluster = 0; cluster < 9; cluster++)
            {
                float center = cluster * Mathf.PI * 2 / 9 + .16f;
                for (int member = 0; member < 3; member++)
                {
                    float angle = center + member * .045f;
                    float radius = 7.5f + (cluster * 7 % 4) + member * .55f;
                    float size = .68f + ((cluster * 3 + member * 7) % 6) * .18f;
                    var position = ShelfPoint(angle, radius) - Vector3.up * .06f;
                    var rotation = Quaternion.Euler(0, cluster * 67 + member * 33, 0);
                    var proportions = new Vector3(size * 1.2f, size * .72f, size);
                    MeshObject("Slate outcrop", boulder, position, member == 1 ? stone : dark, rotation, proportions);
                    MeshObject("Outcrop snow crown", boulderSnow, position, snow, rotation, proportions);
                    for (int tuft = 0; tuft < 2; tuft++)
                    {
                        float plantAngle = angle + (tuft == 0 ? -.055f : .065f);
                        float plantRadius = radius + .55f + tuft * .43f;
                        var place = ShelfPoint(plantAngle, plantRadius);
                        float plantSize = .7f + ((cluster * 3 + tuft + member) % 5) * .12f;
                        MeshObject("Alpine edge planting", planting, place, moss,
                            Quaternion.Euler(0, cluster * 39 + member * 71 + tuft * 13, 0), Vector3.one * plantSize);
                    }
                }
            }
        }

        static Vector3 ShelfPoint(float angle, float radius)
        {
            float blend = Mathf.Clamp01(radius / 29);
            float height = -1.78f - blend * blend * .42f
                + Mathf.Sin(angle * 5 + blend * 4) * Mathf.Sin(blend * Mathf.PI) * .12f;
            return new Vector3(Mathf.Sin(angle) * radius, height, Mathf.Cos(angle) * radius);
        }

        static Vector3 SnowShelfPoint(float angle, float radius)
        {
            // Deterministic shallow drifts; no particles or changing snow surface.
            float drift = .040f + Mathf.Pow(Mathf.Sin(angle * 7 + radius * .34f), 2) * .065f;
            return ShelfPoint(angle, radius) + Vector3.up * drift;
        }

        Mesh AlpinePlantMesh()
        {
            var vertices = new List<Vector3>(); var triangles = new List<int>(); var uv = new List<Vector2>();
            for (int blade = 0; blade < 5; blade++)
            {
                float angle = blade * 2.39996f;
                var outward = new Vector3(Mathf.Cos(angle), 0, Mathf.Sin(angle));
                var width = new Vector3(-outward.z, 0, outward.x) * (.035f + blade * .003f);
                var root = outward * .04f;
                var middle = outward * (.10f + blade * .02f) + Vector3.up * (.20f + blade * .025f);
                var tip = outward * (.24f + blade * .025f) + Vector3.up * (.37f + blade * .018f);
                Quad(vertices, triangles, uv, root - width, root + width, middle + width * .65f, middle - width * .65f);
                Quad(vertices, triangles, uv, middle - width * .65f, middle + width * .65f, root + width, root - width);
                Triangle(vertices, triangles, uv, middle - width * .65f, middle + width * .65f, tip);
                Triangle(vertices, triangles, uv, tip, middle + width * .65f, middle - width * .65f);
            }
            return Mesh("Bent alpine leaves", vertices, triangles, uv);
        }

        Mesh BoulderMesh(bool snowCrown = false)
        {
            const int sides = 9;
            var vertices = new List<Vector3>(); var triangles = new List<int>(); var uv = new List<Vector2>();
            var lower = new Vector3[sides]; var shoulder = new Vector3[sides]; var crown = new Vector3[sides];
            for (int i = 0; i < sides; i++)
            {
                float angle = -i * Mathf.PI * 2 / sides;
                float radius = .67f + Mathf.Sin(i * 7) * .14f;
                lower[i] = new Vector3(Mathf.Cos(angle) * radius, 0, Mathf.Sin(angle) * radius);
                shoulder[i] = new Vector3(Mathf.Cos(angle) * radius * .78f + .06f, .49f + Mathf.Sin(i * 3) * .09f, Mathf.Sin(angle) * radius * .82f);
                crown[i] = new Vector3(Mathf.Cos(angle) * radius * .43f + .14f, .72f + Mathf.Sin(i * 5) * .11f, Mathf.Sin(angle) * radius * .52f - .05f);
            }
            if (snowCrown)
            {
                var center = new Vector3(.12f, .78f, -.07f);
                vertices.Add(center + Vector3.up * .035f); uv.Add(Vector2.one * .5f);
                for (int i = 0; i < sides; i++)
                {
                    vertices.Add(Vector3.Lerp(center, crown[i], .93f) + Vector3.up * .022f);
                    uv.Add(new Vector2(crown[i].x, crown[i].z));
                    triangles.AddRange(new[] { 0, i + 1, (i + 1) % sides + 1 });
                }
                return Mesh("Settled outcrop snow", vertices, triangles, uv);
            }
            for (int i = 0; i < sides; i++)
            {
                int next = (i + 1) % sides;
                Quad(vertices, triangles, uv, lower[i], lower[next], shoulder[next], shoulder[i]);
                Quad(vertices, triangles, uv, shoulder[i], shoulder[next], crown[next], crown[i]);
                Triangle(vertices, triangles, uv, crown[i], crown[next], new Vector3(.12f, .78f, -.07f));
            }
            return Mesh("Weathered slate boulder", vertices, triangles, uv);
        }

        Mesh PineBoughMesh(int variant, bool snowCaps = false)
        {
            var vertices = new List<Vector3>(); var triangles = new List<int>(); var uv = new List<Vector2>();
            const int layers = 7, branches = 7;
            for (int layer = 0; layer < layers; layer++)
                for (int branch = 0; branch < branches; branch++)
                {
                    int seed = layer * 11 + branch * 7 + variant * 23;
                    if ((seed % 13 == 0 && layer < 5) || (layer == 6 && branch > 3)) continue;
                    if (snowCaps && (layer < 1 || (branch + layer + variant) % 3 != 0)) continue;
                    float angle = branch * Mathf.PI * 2 / branches + layer * 1.37f + variant * .71f + Mathf.Sin(seed) * .19f;
                    float height = .46f + layer * .42f + Mathf.Sin(seed * 3) * .10f;
                    float radius = (1 - layer / 7.6f) * (.83f + Mathf.Sin(seed * 7) * .21f);
                    var outward = new Vector3(Mathf.Cos(angle), 0, Mathf.Sin(angle));
                    var side = new Vector3(-outward.z, 0, outward.x) * radius * .45f;
                    var root = new Vector3(Mathf.Sin(layer + variant) * .045f, height + .34f, Mathf.Cos(layer * 2) * .035f);
                    var elbow = root + outward * radius * .46f + Vector3.up * .025f;
                    var tip = root + outward * radius - Vector3.up * (.19f + layer * .007f);
                    // A bent, asymmetric solid bough has a raised spine and a
                    // broken edge, rather than another flat triangular cone tier.
                    int start = vertices.Count;
                    vertices.Add(root);
                    vertices.Add(elbow - side * .70f);
                    vertices.Add(Vector3.Lerp(elbow, tip, .48f) - side);
                    vertices.Add(tip);
                    vertices.Add(Vector3.Lerp(elbow, tip, .65f) + side * .83f);
                    vertices.Add(elbow + side * .80f);
                    vertices.Add(elbow + Vector3.up * (.17f - layer * .009f));
                    uv.AddRange(new[] { new Vector2(.5f, 0), new Vector2(.12f, .38f),
                        new Vector2(0, .72f), new Vector2(.5f, 1), new Vector2(1, .75f),
                        new Vector2(.88f, .38f), new Vector2(.5f, .48f) });
                    if (snowCaps)
                    {
                        // Keep a green border around an inset cap lying on the
                        // existing top fans. Three cached variants add 4,144
                        // vertices across all 48 trees, within the snow material.
                        var spine = vertices[start + 6];
                        for (int edge = 0; edge < 6; edge++)
                        {
                            float coverage = .69f + Mathf.Sin(seed + edge * 3) * .095f;
                            vertices[start + edge] = Vector3.Lerp(spine, vertices[start + edge], coverage) + Vector3.up * .018f;
                        }
                        vertices[start + 6] += Vector3.up * .034f;
                    }
                    for (int edge = 0; edge < 6; edge++)
                        triangles.AddRange(new[] { start + 6, start + (edge + 1) % 6, start + edge });
                    if (!snowCaps)
                        for (int edge = 1; edge < 5; edge++)
                            triangles.AddRange(new[] { start, start + edge, start + edge + 1 });
                }
            return Mesh((snowCaps ? "Frosted boughs " : "Branched conifer ") + variant, vertices, triangles, uv);
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
        {
            var mesh = BeveledBoxMesh(size, bevel);
            if (material.IsKeywordEnabled("_NORMALMAP"))
            {
                // This mesh is newly owned, never the shared tatami tile. Scatter
                // macro wear per stone/post without extra material instances.
                int x = Mathf.RoundToInt(position.x * 31), y = Mathf.RoundToInt(position.z * 31);
                float u = TileValue(x, y, 257, 113), v = TileValue(x, y, 257, 199);
                int turn = material == cedarMaterial ? (size.x > size.y && size.x > size.z ? 1 : 0)
                    : Mathf.FloorToInt(TileValue(x, y, 257, 397) * 4);
                var coordinates = mesh.uv;
                for (int index = 0; index < coordinates.Length; index++)
                {
                    var point = coordinates[index];
                    for (int quarter = 0; quarter < turn; quarter++) point = new Vector2(-point.y, point.x);
                    coordinates[index] = point + new Vector2(u, v);
                }
                mesh.uv = coordinates;
            }
            MeshObject(name, mesh, position, material, rotation);
        }

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

        UnityEngine.Light Light(string label, Vector3 angles, Color color, float intensity, bool shadow)
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
            return light;
        }

        void OnDestroy()
        {
            renderQuality?.Dispose();
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
