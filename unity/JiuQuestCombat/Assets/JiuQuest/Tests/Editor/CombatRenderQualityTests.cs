using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace JiuQuest.Combat.Tests
{
    public class CombatRenderQualityTests
    {
        UniversalRenderPipelineAsset pipeline;
        GameObject cameraObject, lightObject;
        Camera camera;
        Light keyLight;
        CombatRenderQuality quality;

        [SetUp]
        public void SetUp()
        {
            pipeline = ScriptableObject.CreateInstance<UniversalRenderPipelineAsset>();
            pipeline.renderScale = 1;
            pipeline.msaaSampleCount = 2;
            pipeline.mainLightShadowmapResolution = 2048;
            cameraObject = new GameObject("Quality test camera");
            camera = cameraObject.AddComponent<Camera>();
            camera.enabled = false;
            camera.allowMSAA = true;
            lightObject = new GameObject("Quality test key");
            keyLight = lightObject.AddComponent<Light>();
            keyLight.enabled = false;
            keyLight.shadows = LightShadows.Soft;
        }

        [TearDown]
        public void TearDown()
        {
            quality?.Dispose();
            Object.DestroyImmediate(cameraObject);
            Object.DestroyImmediate(lightObject);
            Object.DestroyImmediate(pipeline);
        }

        [TestCase("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", true)]
        [TestCase("Google SwiftShader", true)]
        [TestCase("swiftshader", true)]
        [TestCase("ANGLE (Intel, Intel(R) Graphics, D3D11)", false)]
        [TestCase("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, D3D11)", false)]
        [TestCase("Google Inc. (Google)", false)]
        [TestCase("WebKit WebGL", false)]
        [TestCase("WebGL 2.0 (OpenGL ES 3.0 Chromium)", false)]
        [TestCase("Mesa Intel(R) Graphics", false)]
        [TestCase("Unknown GPU", false)]
        [TestCase("", false)]
        [TestCase(null, false)]
        public void OnlyExplicitSwiftShaderEvidenceSelectsReducedQuality(string renderer, bool expected)
            => Assert.That(CombatRenderQuality.IsSwiftShader(renderer), Is.EqualTo(expected));

        [TestCase("ANGLE (Intel, Intel(R) Graphics, D3D11)")]
        [TestCase("WebKit WebGL")]
        [TestCase(null)]
        public void HardwareAndUnknownKeepAuthoredQualityAcrossViewportChanges(string renderer)
        {
            quality = new CombatRenderQuality(renderer, pipeline, camera, keyLight);
            quality.ApplyViewport(false);
            Assert.That(camera.allowMSAA, Is.True);
            quality.ApplyViewport(true);
            Assert.That(camera.allowMSAA, Is.False);
            Assert.That(pipeline.mainLightShadowmapResolution, Is.EqualTo(1024));
            Assert.That(pipeline.renderScale, Is.EqualTo(1));
            Assert.That(pipeline.msaaSampleCount, Is.EqualTo(2));
            Assert.That(keyLight.shadows, Is.EqualTo(LightShadows.Soft));
            quality.ApplyViewport(false);
            Assert.That(camera.allowMSAA, Is.True);
            Assert.That(pipeline.mainLightShadowmapResolution, Is.EqualTo(2048));
        }

        [Test]
        public void SwiftShaderProfilePersistsAcrossResizeAndRepeatedViewportCommands()
        {
            quality = new CombatRenderQuality("Google SwiftShader", pipeline, camera, keyLight);
            foreach (bool compact in new[] { false, true, false, true })
            {
                Assert.That(quality.ApplyViewport(compact), Is.True);
                Assert.That(quality.ApplyViewport(compact), Is.False, "No repeated pipeline allocation/change for the same viewport.");
                Assert.That(pipeline.renderScale, Is.EqualTo(.75f));
                Assert.That(pipeline.msaaSampleCount, Is.EqualTo(1));
                Assert.That(pipeline.mainLightShadowmapResolution, Is.EqualTo(512));
                Assert.That(camera.allowMSAA, Is.False);
                Assert.That(keyLight.shadows, Is.EqualTo(LightShadows.Hard));
            }
        }

        [Test]
        public void TeardownRestoresChangedSettingsBeforeTheNextHardwareSession()
        {
            quality = new CombatRenderQuality("SwiftShader", pipeline, camera, keyLight);
            quality.ApplyViewport(true);
            quality.Dispose();
            quality.Dispose();
            Assert.That(pipeline.renderScale, Is.EqualTo(1));
            Assert.That(pipeline.msaaSampleCount, Is.EqualTo(2));
            Assert.That(pipeline.mainLightShadowmapResolution, Is.EqualTo(2048));
            Assert.That(camera.allowMSAA, Is.True);
            Assert.That(keyLight.shadows, Is.EqualTo(LightShadows.Soft));
            quality = new CombatRenderQuality("Intel(R) Graphics", pipeline, camera, keyLight);
            quality.ApplyViewport(false);
            Assert.That(pipeline.renderScale, Is.EqualTo(1));
            Assert.That(pipeline.msaaSampleCount, Is.EqualTo(2));
            Assert.That(camera.allowMSAA, Is.True);
        }

        [Test]
        public void TeardownPreservesLaterIndependentPipelineAndLightChanges()
        {
            quality = new CombatRenderQuality("SwiftShader", pipeline, camera, keyLight);
            quality.ApplyViewport(false);
            pipeline.renderScale = .9f;
            pipeline.msaaSampleCount = 4;
            pipeline.mainLightShadowmapResolution = 4096;
            keyLight.shadows = LightShadows.None;
            quality.Dispose();
            Assert.That(pipeline.renderScale, Is.EqualTo(.9f));
            Assert.That(pipeline.msaaSampleCount, Is.EqualTo(4));
            Assert.That(pipeline.mainLightShadowmapResolution, Is.EqualTo(4096));
            Assert.That(keyLight.shadows, Is.EqualTo(LightShadows.None));
        }

        [Test]
        public void DiagnosticReportsSuppliedCSharpNameAndActualSettingsWithoutClaimingReadiness()
        {
            const string name = "ANGLE (Google, SwiftShader Device, Vulkan)";
            quality = new CombatRenderQuality(name, pipeline, camera, keyLight);
            quality.ApplyViewport(true);
            var observed = JsonUtility.FromJson<CombatRenderQualityDiagnostic>(JsonUtility.ToJson(quality.Describe("OpenGLES3")));
            Assert.That(observed.graphicsDeviceName, Is.EqualTo(name));
            Assert.That(observed.profile, Is.EqualTo("swiftshader-reduced"));
            Assert.That(observed.pipelineAvailable, Is.True);
            Assert.That(observed.renderScale, Is.EqualTo(pipeline.renderScale));
            Assert.That(observed.pipelineMsaaSampleCount, Is.EqualTo(pipeline.msaaSampleCount));
            Assert.That(observed.mainLightShadowmapResolution, Is.EqualTo(pipeline.mainLightShadowmapResolution));
            Assert.That(observed.mainLightShadows, Is.EqualTo(keyLight.shadows.ToString()));
            Assert.That(observed.cameraAllowsMsaa, Is.EqualTo(camera.allowMSAA));
        }
    }
}
