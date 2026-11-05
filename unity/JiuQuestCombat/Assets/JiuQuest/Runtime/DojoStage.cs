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
        Camera sceneCamera;
        Transform environment;
        Vector3 lookAt = new Vector3(0, .65f, 0);
        string preset = "front";
        float orbitAngle = 27;
        float orbitElevation = 25;
        Bounds motionBounds = new Bounds(new Vector3(0, .8f, 0), new Vector3(2.4f, 1.8f, 1.2f));
        Quaternion cameraOrientation = Quaternion.Euler(25, 27, 0);
        bool compactViewport;
        bool dragging;
        Vector2 lastPointer;
        public Shader FighterShader { get; private set; }

        public void Create()
        {
            FighterShader = Shader.Find("Universal Render Pipeline/Lit");
            if (FighterShader == null) throw new System.InvalidOperationException("The Unity URP Lit shader is missing from the build.");
            environment = new GameObject("JiuQuest dojo").transform;
            environment.SetParent(transform, false);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(.43f, .51f, .65f);
            RenderSettings.ambientEquatorColor = new Color(.25f, .31f, .39f);
            RenderSettings.ambientGroundColor = new Color(.13f, .16f, .21f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = new Color(.026f, .044f, .07f);
            RenderSettings.fogDensity = .028f;
            var dark = Material("Obsidian", new Color(.034f, .055f, .082f), .25f);
            var edge = Material("Charcoal trim", new Color(.065f, .09f, .125f), .38f);
            var matA = Material("Tatami blue", new Color(.14f, .24f, .31f), .06f);
            var matB = Material("Tatami slate", new Color(.17f, .28f, .35f), .06f);
            var accent = Material("Jade accent", new Color(.10f, .7f, .57f), .4f, true);
            var brass = Material("Warm light", new Color(1f, .65f, .31f), .3f, true);
            Cube("Floor", new Vector3(0, -.19f, 0), new Vector3(30, .2f, 30), dark);
            Cube("Floating mat base", new Vector3(0, -.075f, 0), new Vector3(7.65f, .16f, 7.65f), edge);
            for (int x = -3; x <= 3; x++)
                for (int z = -3; z <= 3; z++)
                    Cube("Tatami", new Vector3(x, .012f, z), new Vector3(.991f, .035f, .991f), ((x + z) & 1) == 0 ? matA : matB);
            Cube("North boundary", new Vector3(0, .035f, 3.52f), new Vector3(7.1f, .012f, .035f), accent);
            Cube("South boundary", new Vector3(0, .035f, -3.52f), new Vector3(7.1f, .012f, .035f), accent);
            Cube("East boundary", new Vector3(3.52f, .035f, 0), new Vector3(.035f, .012f, 7.1f), accent);
            Cube("West boundary", new Vector3(-3.52f, .035f, 0), new Vector3(.035f, .012f, 7.1f), accent);
            // Quiet arena architecture keeps the paired silhouettes readable on a phone.
            for (int side = -1; side <= 1; side += 2)
            {
                Cube("Dojo bench", new Vector3(side * 5.1f, .29f, 0), new Vector3(.8f, .55f, 7.5f), edge);
                Cube("Bench light", new Vector3(side * 4.69f, .42f, 0), new Vector3(.025f, .03f, 7.3f), brass);
                for (int z = -3; z <= 3; z += 2)
                    Cube("Architectural fin", new Vector3(side * 6.6f, 2, z), new Vector3(.15f, 4, .35f), edge);
            }
            Cube("Rear wall", new Vector3(0, 2, 7.1f), new Vector3(16, 4.2f, .35f), dark);
            Cube("Rear inset", new Vector3(0, 2.0f, 6.9f), new Vector3(4, 1.15f, .05f), edge);
            Cube("Jade wordmark bar", new Vector3(0, 2, 6.84f), new Vector3(2.2f, .06f, .015f), accent);
            Cube("Ceiling light", new Vector3(0, 4.5f, 0), new Vector3(5.2f, .035f, .08f), brass);
            CombineArchitecture();

            Light("Key", new Vector3(50, -30, 0), new Color(1, .91f, .78f), 2.0f, true);
            Light("Fill", new Vector3(32, 132, 0), new Color(.55f, .75f, 1), .7f, false);
            Light("Rim", new Vector3(35, 210, 0), new Color(.63f, 1f, .91f), .8f, false);
            sceneCamera = new GameObject("Combat Camera").AddComponent<Camera>();
            sceneCamera.transform.SetParent(environment, false);
            sceneCamera.tag = "MainCamera";
            sceneCamera.clearFlags = CameraClearFlags.SolidColor;
            sceneCamera.backgroundColor = new Color(.026f, .044f, .07f);
            sceneCamera.fieldOfView = 38;
            sceneCamera.nearClipPlane = .08f;
            sceneCamera.farClipPlane = 45;
            sceneCamera.allowHDR = false;
            sceneCamera.allowMSAA = true;
            var cameraData = sceneCamera.GetUniversalAdditionalCameraData();
            cameraData.renderPostProcessing = false;
            cameraData.antialiasing = AntialiasingMode.FastApproximateAntialiasing;
            PlaceCamera(true);
        }

        public void Frame(Bounds bounds)
        {
            motionBounds = bounds;
            lookAt = bounds.center;
            PlaceCamera(true);
        }

        public void SetViewport(bool compact)
        {
            compactViewport = compact;
            Application.targetFrameRate = compact ? 30 : 60;
            sceneCamera.allowMSAA = !compact;
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
            float yaw = preset == "side" ? 94 : preset == "orbit" ? orbitAngle : 27;
            float elevation = preset == "overhead" ? 76 : preset == "orbit" ? orbitElevation : 25;
            if (preset == "overhead") yaw = 0;
            var targetOrientation = Quaternion.Euler(elevation, yaw, 0);
            cameraOrientation = immediate ? targetOrientation : Quaternion.Slerp(cameraOrientation, targetOrientation, 1 - Mathf.Exp(-8 * Time.unscaledDeltaTime));
            // Refit at the interpolated angle too: even a camera transition cannot crop a limb.
            float distance = CombatFraming.Distance(motionBounds, cameraOrientation, sceneCamera.fieldOfView,
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
                stageMeshes.Add(mesh);
                var combined = new GameObject(mesh.name);
                combined.transform.SetParent(environment, false);
                combined.AddComponent<MeshFilter>().sharedMesh = mesh;
                combined.AddComponent<MeshRenderer>().sharedMaterial = material;
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

        void Cube(string label, Vector3 position, Vector3 scale, Material material)
        {
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = label;
            cube.transform.SetParent(environment, false);
            cube.transform.localPosition = position;
            cube.transform.localScale = scale;
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
        }
    }
}
