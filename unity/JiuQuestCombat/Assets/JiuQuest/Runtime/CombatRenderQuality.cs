using System;
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace JiuQuest.Combat
{
    // Renderer evidence selects a stable session profile, never OS, browser or CI.
    // Unknown/masked names retain the authored hardware profile.
    public sealed class CombatRenderQuality : IDisposable
    {
        readonly UniversalRenderPipelineAsset pipeline;
        readonly Camera camera;
        readonly Light keyLight;
        readonly float originalScale;
        readonly int originalMsaa, originalShadowAtlas;
        readonly bool originalCameraMsaa;
        readonly LightShadows originalKeyShadows;
        float lastScale;
        int lastMsaa, lastShadowAtlas;
        bool lastCameraMsaa, compactViewport, applied, disposed;
        LightShadows lastKeyShadows;
        bool ownsScale, ownsMsaa, ownsShadowAtlas, ownsCameraMsaa, ownsKeyShadows;
        public string GraphicsDeviceName { get; }
        public bool UsesSoftwareProfile { get; }

        public static bool IsSwiftShader(string graphicsDeviceName)
            => !string.IsNullOrEmpty(graphicsDeviceName)
                && graphicsDeviceName.IndexOf("SwiftShader", StringComparison.OrdinalIgnoreCase) >= 0;

        public CombatRenderQuality(string graphicsDeviceName, UniversalRenderPipelineAsset pipeline, Camera camera, Light keyLight)
        {
            GraphicsDeviceName = graphicsDeviceName ?? "";
            UsesSoftwareProfile = IsSwiftShader(graphicsDeviceName);
            this.pipeline = pipeline;
            this.camera = camera != null ? camera : throw new ArgumentNullException(nameof(camera));
            this.keyLight = keyLight != null ? keyLight : throw new ArgumentNullException(nameof(keyLight));
            originalScale = pipeline != null ? pipeline.renderScale : 1;
            originalMsaa = pipeline != null ? pipeline.msaaSampleCount : 1;
            originalShadowAtlas = pipeline != null ? pipeline.mainLightShadowmapResolution : 0;
            originalCameraMsaa = camera.allowMSAA;
            originalKeyShadows = keyLight.shadows;
        }

        public bool ApplyViewport(bool compact)
        {
            if (disposed) throw new ObjectDisposedException(nameof(CombatRenderQuality));
            if (applied && compactViewport == compact) return false;
            applied = true;
            compactViewport = compact;
            lastCameraMsaa = !UsesSoftwareProfile && !compact;
            ownsCameraMsaa |= camera.allowMSAA != lastCameraMsaa;
            camera.allowMSAA = lastCameraMsaa;
            if (UsesSoftwareProfile)
            {
                lastKeyShadows = LightShadows.Hard;
                ownsKeyShadows |= keyLight.shadows != lastKeyShadows;
                keyLight.shadows = lastKeyShadows;
            }
            if (pipeline == null) return true;
            if (UsesSoftwareProfile)
            {
                lastScale = .75f;
                lastMsaa = 1;
                ownsScale |= !Mathf.Approximately(pipeline.renderScale, lastScale);
                ownsMsaa |= pipeline.msaaSampleCount != lastMsaa;
                if (!Mathf.Approximately(pipeline.renderScale, lastScale)) pipeline.renderScale = lastScale;
                if (pipeline.msaaSampleCount != lastMsaa) pipeline.msaaSampleCount = lastMsaa;
            }
            lastShadowAtlas = UsesSoftwareProfile ? 512 : compact ? 1024 : 2048;
            ownsShadowAtlas |= pipeline.mainLightShadowmapResolution != lastShadowAtlas;
            if (pipeline.mainLightShadowmapResolution != lastShadowAtlas)
                pipeline.mainLightShadowmapResolution = lastShadowAtlas;
            return true;
        }

        public CombatRenderQualityDiagnostic Describe(string graphicsDeviceType) => new CombatRenderQualityDiagnostic {
            graphicsDeviceName = GraphicsDeviceName,
            graphicsDeviceType = graphicsDeviceType ?? "",
            profile = UsesSoftwareProfile ? "swiftshader-reduced" : "authored-default",
            compactViewport = compactViewport,
            pipelineAvailable = pipeline != null,
            renderScale = pipeline != null ? pipeline.renderScale : -1,
            pipelineMsaaSampleCount = pipeline != null ? pipeline.msaaSampleCount : -1,
            cameraAllowsMsaa = camera != null && camera.allowMSAA,
            mainLightShadowmapResolution = pipeline != null ? pipeline.mainLightShadowmapResolution : -1,
            mainLightShadows = keyLight != null ? keyLight.shadows.ToString() : "Unavailable"
        };

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            // Restore only values this owner changed and which still equal its
            // last write. Do not overwrite a later owner's independent changes.
            if (pipeline != null)
            {
                if (ownsScale && Mathf.Approximately(pipeline.renderScale, lastScale)) pipeline.renderScale = originalScale;
                if (ownsMsaa && pipeline.msaaSampleCount == lastMsaa) pipeline.msaaSampleCount = originalMsaa;
                if (ownsShadowAtlas && pipeline.mainLightShadowmapResolution == lastShadowAtlas)
                    pipeline.mainLightShadowmapResolution = originalShadowAtlas;
            }
            if (camera != null && ownsCameraMsaa && camera.allowMSAA == lastCameraMsaa) camera.allowMSAA = originalCameraMsaa;
            if (keyLight != null && ownsKeyShadows && keyLight.shadows == lastKeyShadows) keyLight.shadows = originalKeyShadows;
        }
    }

    [Serializable]
    public sealed class CombatRenderQualityDiagnostic
    {
        public string graphicsDeviceName, graphicsDeviceType, profile;
        public bool compactViewport, pipelineAvailable, cameraAllowsMsaa;
        public float renderScale;
        public int pipelineMsaaSampleCount, mainLightShadowmapResolution;
        public string mainLightShadows;
    }
}
