using System;
using System.Collections;
using System.Collections.Generic;
using GLTFast;
using GLTFast.Materials;
using GLTFast.Schema;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.TestTools;
using Material = UnityEngine.Material;

namespace JiuQuest.Combat.Tests
{
    public class CombatMaterialTests
    {
        readonly List<UnityEngine.Object> owned = new List<UnityEngine.Object>();
        UniversalRenderPipelineAsset pipeline;
        CombatMaterialGenerator generator;

        [SetUp]
        public void SetUp()
        {
            pipeline = ScriptableObject.CreateInstance<UniversalRenderPipelineAsset>();
            owned.Add(pipeline);
            generator = new CombatMaterialGenerator(pipeline);
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var item in owned) if (item != null) UnityEngine.Object.DestroyImmediate(item);
            owned.Clear();
        }

        Material Generate(string slot, float roughness = .72f, string alphaMode = "OPAQUE")
        {
            var source = new GLTFast.Schema.Material {
                name = slot,
                alphaCutoff = .43f,
                doubleSided = alphaMode == "MASK",
                pbrMetallicRoughness = new PbrMetallicRoughness {
                    baseColorFactor = new[] { .23f, .37f, .51f, .8f },
                    metallicFactor = .12f,
                    roughnessFactor = roughness
                }
            };
            source.SetAlphaMode((MaterialBase.AlphaMode)Enum.Parse(typeof(MaterialBase.AlphaMode), alphaMode, true));
            var result = generator.GenerateMaterial(source, null);
            Assert.That(result, Is.Not.Null, "The official glTF URP shader must be available.");
            owned.Add(result);
            return result;
        }

        [TestCase("Skin", .47f)]
        [TestCase("Eyes", .30f)]
        [TestCase("Hair", .74f)]
        [TestCase("GiTop", .72f)]
        [TestCase("GiPants", .76f)]
        [TestCase("Belt", .64f)]
        public void FighterMaterialsRetainAuthoredSurfaceMetadata(string slot, float roughness)
        {
            var material = Generate("JQ_Attacker_" + slot, roughness);
            Assert.That(material.shader.name, Is.EqualTo(CombatMaterialGenerator.FighterShaderName));
            Assert.That(material.GetFloat(MaterialProperty.RoughnessFactor), Is.EqualTo(roughness).Within(.0001f));
            Assert.That(material.GetFloat(MaterialProperty.Metallic), Is.EqualTo(.12f).Within(.0001f));
            AssertColor(CombatMaterialAppearance.BaseColor(material), new Color(.23f, .37f, .51f, .8f).gamma);
        }

        [TestCase("DojoFloor", "OPAQUE")]
        [TestCase("JQ_Attacker_TransparentDetail", "BLEND")]
        public void DojoAndTransparentMaterialsRetainOfficialImporterShader(string slot, string alphaMode)
        {
            var material = Generate(slot, alphaMode: alphaMode);
            Assert.That(material.shader.name, Is.Not.EqualTo(CombatMaterialGenerator.FighterShaderName));
        }

        [TestCase("Skin_Ref_AA7755", .80f)]
        [TestCase("Skin", 1f)]
        [TestCase("Skin_Eyes_Ref_AA7755", 1f)]
        [TestCase("Iris_Ref_557799", 1f)]
        [TestCase("Brows_Ref_0D0605", 1f)]
        [TestCase("GiTop_Ref_E0E4E8", 1f)]
        public void SurfaceDetailPreservesFacialFeaturesAndUnreferencedMaps(string slot, float detail)
        {
            var material = Generate("JQ_Attacker_" + slot);
            Assert.That(material.GetFloat(CombatMaterialGenerator.DetailStrength), Is.EqualTo(detail));
            AssertColor((Color)material.GetVector(CombatMaterialGenerator.DetailBaseColor), CombatMaterialAppearance.ReferenceColor(slot));
            Assert.That(material.FindPass("AnimeForward"), Is.GreaterThanOrEqualTo(0));
            Assert.That(material.FindPass("ShadowCaster"), Is.GreaterThanOrEqualTo(0));
            Assert.That(material.passCount, Is.EqualTo(2), "Fighters use one color pass and their normal shadow pass, without extra outline geometry.");
        }

        [Test]
        public void SurfaceFamiliesKeepEyesGlossyClothMatteAndBrowsDark()
        {
            var eye = Generate("JQ_Attacker_Skin_Eyes_Ref_AA7755", .3f);
            var brows = Generate("JQ_Attacker_Eyebrows", .85f);
            var skin = Generate("JQ_Attacker_Skin_Ref_AA7755", .47f);
            var hair = Generate("JQ_Attacker_Hair", .8f);
            var cloth = Generate("JQ_Attacker_GiTop", .72f);
            Assert.That(eye.GetFloat(CombatMaterialGenerator.SpecularStrength),
                Is.GreaterThan(hair.GetFloat(CombatMaterialGenerator.SpecularStrength)));
            Assert.That(hair.GetFloat(CombatMaterialGenerator.SpecularStrength),
                Is.GreaterThan(skin.GetFloat(CombatMaterialGenerator.SpecularStrength)));
            Assert.That(skin.GetFloat(CombatMaterialGenerator.SpecularStrength),
                Is.GreaterThan(cloth.GetFloat(CombatMaterialGenerator.SpecularStrength)));
            Assert.That(brows.GetFloat(CombatMaterialGenerator.SpecularStrength),
                Is.LessThan(cloth.GetFloat(CombatMaterialGenerator.SpecularStrength)),
                "An Eyebrows slot must not inherit the glossy Eye surface.");
            Assert.That(skin.GetFloat(CombatMaterialGenerator.NormalDetailStrength),
                Is.LessThan(cloth.GetFloat(CombatMaterialGenerator.NormalDetailStrength)),
                "Facial pores are subdued; the gi retains more woven relief.");
            foreach (var material in new[] { eye, brows, skin, hair, cloth })
                Assert.That(material.GetVector(CombatMaterialGenerator.SurfaceMaps), Is.EqualTo(Vector4.zero),
                    "An untextured material must not sample shader-default surface maps.");
        }

        [TestCase("GiTop", true)]
        [TestCase("GiPants_Ref_E0E4E8", true)]
        [TestCase("Belt", true)]
        [TestCase("BeltStripe", true)]
        [TestCase("Skin", false)]
        [TestCase("Hair", false)]
        [TestCase("Eyes", false)]
        [TestCase("Eyebrows", false)]
        [TestCase("Patch", false)]
        public void CottonScatterStaysOnFabricThroughCosmeticChanges(string slot, bool fabric)
        {
            var material = Generate("JQ_Attacker_" + slot);
            float sheen = material.GetFloat(CombatMaterialGenerator.FabricSheen);
            if (fabric) Assert.That(sheen, Is.InRange(.01f, .2f));
            else Assert.That(sheen, Is.Zero, "Cotton scatter must not change facial features or hair.");
            var original = CombatMaterialAppearance.BaseColor(material);
            CombatMaterialAppearance.ApplyTint(material, original, material.name,
                new FighterAppearance { giTop = "#112a58", giPants = "#151922", hairColor = "#11131c", skinTone = "#a86b4d", belt = "blue" }, true);
            Assert.That(material.GetFloat(CombatMaterialGenerator.FabricSheen), Is.EqualTo(sheen));
            Assert.That(material.passCount, Is.EqualTo(2), "Fabric scatter shares the existing color pass.");
        }

        [Test]
        public void CloneAndRetintPreserveMapsTransformsRoughnessAndHairCutout()
        {
            var source = Generate("JQ_Attacker_Hair", .68f, "MASK");
            var texture = new Texture2D(2, 2);
            owned.Add(texture);
            var mapProperties = new[] { MaterialProperty.BaseColorTexture, MaterialProperty.NormalTexture, MaterialProperty.MetallicRoughnessMap, MaterialProperty.OcclusionTexture };
            foreach (int property in mapProperties) source.SetTexture(property, texture);
            source.SetVector(MaterialProperty.BaseColorTextureScaleTransform, new Vector4(2, 3, .1f, .2f));
            source.SetVector(MaterialProperty.BaseColorTextureRotation, new Vector4(.25f, -.5f, 0, 0));
            source.SetFloat(MaterialProperty.BaseColorTextureTexCoord, 1);
            source.SetFloat(MaterialProperty.NormalTextureScale, .6f);
            var clone = CombatMaterialAppearance.ClonePreservingSurface(source);
            owned.Add(clone);
            var originalColor = CombatMaterialAppearance.BaseColor(source);
            Assert.That(CombatMaterialAppearance.ApplyTint(clone, originalColor, source.name, new FighterAppearance { hairColor = "#936b42" }, true), Is.True);
            Assert.That(clone, Is.Not.SameAs(source));
            Assert.That(clone.shader, Is.SameAs(source.shader));
            foreach (int property in mapProperties) Assert.That(clone.GetTexture(property), Is.SameAs(texture));
            Assert.That(clone.GetVector(MaterialProperty.BaseColorTextureScaleTransform), Is.EqualTo(new Vector4(2, 3, .1f, .2f)));
            Assert.That(clone.GetVector(MaterialProperty.BaseColorTextureRotation), Is.EqualTo(new Vector4(.25f, -.5f, 0, 0)));
            Assert.That(clone.GetFloat(MaterialProperty.BaseColorTextureTexCoord), Is.EqualTo(1));
            Assert.That(clone.GetFloat(MaterialProperty.NormalTextureScale), Is.EqualTo(.6f));
            Assert.That(clone.GetFloat(MaterialProperty.RoughnessFactor), Is.EqualTo(.68f));
            Assert.That(clone.GetFloat(CombatMaterialGenerator.SpecularStrength), Is.EqualTo(source.GetFloat(CombatMaterialGenerator.SpecularStrength)));
            Assert.That(clone.GetFloat(CombatMaterialGenerator.RimStrength), Is.EqualTo(source.GetFloat(CombatMaterialGenerator.RimStrength)));
            Assert.That(clone.GetFloat(CombatMaterialGenerator.FabricSheen), Is.EqualTo(source.GetFloat(CombatMaterialGenerator.FabricSheen)));
            Assert.That(clone.renderQueue, Is.EqualTo((int)RenderQueue.AlphaTest));
            Assert.That(clone.GetFloat(MaterialProperty.AlphaCutoff), Is.EqualTo(.43f));
            Assert.That(clone.IsKeywordEnabled("_ALPHATEST_ON"), Is.True);
            Assert.That(clone.GetFloat(MaterialProperty.Cull), Is.EqualTo((float)CullMode.Off));
            AssertColor(CombatMaterialAppearance.BaseColor(source), originalColor);
        }

        [TestCase("Eyes")]
        [TestCase("Sclera")]
        [TestCase("Iris")]
        [TestCase("Skin_Eyes")]
        [TestCase("Teeth")]
        public void AuthoredEyeAndUnknownDetailColorsDoNotBecomeGiColors(string slot)
        {
            var material = Generate("JQ_Defender_" + slot, .3f);
            var original = CombatMaterialAppearance.BaseColor(material);
            Assert.That(CombatMaterialAppearance.ApplyTint(material, original, material.name,
                new FighterAppearance { giTop = "#ff0000", skinTone = "#00ff00", hairColor = "#0000ff" }, false), Is.False);
            AssertColor(CombatMaterialAppearance.BaseColor(material), original);
        }

        [Test]
        public void TexturedSkinReferenceRecolorUsesLinearRatioWithoutAccumulating()
        {
            var material = Generate("JQ_Attacker_Skin_Ref_AA7755", .47f);
            material.SetVector(MaterialProperty.BaseColor, Color.white);
            var texture = new Texture2D(2, 2);
            owned.Add(texture);
            material.SetTexture(MaterialProperty.BaseColorTexture, texture);
            var authored = CombatMaterialAppearance.BaseColor(material);
            var appearance = new FighterAppearance { skinTone = "#AA7755" };
            CombatMaterialAppearance.ApplyTint(material, authored, material.name, appearance, true);
            AssertColor(CombatMaterialAppearance.BaseColor(material), Color.white);
            appearance.skinTone = "#C89977";
            CombatMaterialAppearance.ApplyTint(material, authored, material.name, appearance, true);
            var first = CombatMaterialAppearance.BaseColor(material);
            var reference = CombatMaterialAppearance.ReferenceColor(material.name).linear;
            ColorUtility.TryParseHtmlString(appearance.skinTone, out var selected);
            var desired = selected.linear;
            AssertColor(first, new Color(desired.r / reference.r, desired.g / reference.g, desired.b / reference.b, 1).gamma);
            CombatMaterialAppearance.ApplyTint(material, authored, material.name, appearance, true);
            AssertColor(CombatMaterialAppearance.BaseColor(material), first);
            Assert.That(material.GetTexture(MaterialProperty.BaseColorTexture), Is.SameAs(texture));
        }

        [Test]
        public void BrowSlotsUseHairColorWithoutRecoloringEyes()
        {
            var appearance = new FighterAppearance { hairStyle = "bald", hairColor = "#73543b", skinTone = "#c9a089" };
            ColorUtility.TryParseHtmlString(appearance.hairColor, out var expected);
            foreach (var slot in new[] { "JQ_Attacker_Brows_Ref_0D0605", "JQ_Attacker_Eyebrows", "JQ_Attacker_HairBrows" })
            {
                Assert.That(CombatMaterialAppearance.TryCosmeticTint(slot, appearance, true, out var tint), Is.True);
                AssertColor(tint, expected);
            }
            Assert.That(CombatMaterialAppearance.TryCosmeticTint("JQ_Attacker_Eyes", appearance, true, out _), Is.False);
        }

        [Test]
        public void OpponentPerformerGetsItsOwnTextureTintAndFlatAssetsStillRecolor()
        {
            var material = Generate("JQ_Attacker_GiTop");
            var fighter = new FighterAppearance { giTop = "#e0e4e8" };
            var opponent = new FighterAppearance { giTop = "#334455" };
            var appearance = CombatProtocol.AppearanceForRoot(material.name, "opponent", fighter, opponent);
            CombatMaterialAppearance.ApplyTint(material, CombatMaterialAppearance.BaseColor(material), material.name, appearance, false);
            ColorUtility.TryParseHtmlString(opponent.giTop, out var desired);
            desired.a = .8f;
            AssertColor(CombatMaterialAppearance.BaseColor(material), desired);
            Assert.That(material.GetFloat(MaterialProperty.RoughnessFactor), Is.EqualTo(.72f));
        }

        [UnityTest, Timeout(20000)]
        public IEnumerator EmbeddedPbrTextureChannelsAreImportedByOfficialGenerator()
        {
            var image = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            owned.Add(image);
            image.SetPixels(new[] { Color.white, Color.red, Color.green, Color.blue });
            image.Apply();
            string png = Convert.ToBase64String(ImageConversion.EncodeToPNG(image));
            string json = "{\"asset\":{\"version\":\"2.0\"},\"scene\":0,\"scenes\":[{}],"
                + "\"images\":[{\"uri\":\"data:image/png;base64," + png + "\"}],"
                + "\"textures\":[{\"source\":0},{\"source\":0}],\"materials\":[{\"name\":\"JQ_Attacker_GiTop\","
                + "\"pbrMetallicRoughness\":{\"baseColorTexture\":{\"index\":0},\"metallicRoughnessTexture\":{\"index\":1},\"roughnessFactor\":0.7,\"metallicFactor\":0.2},"
                + "\"normalTexture\":{\"index\":1,\"scale\":0.6},\"occlusionTexture\":{\"index\":1,\"strength\":0.8}}]}";
            using var importer = new GltfImport(deferAgent: new UninterruptedDeferAgent(), materialGenerator: generator);
            var task = importer.LoadGltfJson(json);
            while (!task.IsCompleted) yield return null;
            Assert.That(task.GetAwaiter().GetResult(), Is.True);
            var material = importer.GetMaterial();
            Assert.That(material.GetTexture(MaterialProperty.BaseColorTexture), Is.SameAs(importer.GetTexture(0)));
            Assert.That(material.GetTexture(MaterialProperty.MetallicRoughnessMap), Is.SameAs(importer.GetTexture(1)));
            Assert.That(material.GetTexture(MaterialProperty.NormalTexture), Is.SameAs(importer.GetTexture(1)));
            Assert.That(material.GetTexture(MaterialProperty.OcclusionTexture), Is.SameAs(importer.GetTexture(1)));
            Assert.That(material.GetFloat(MaterialProperty.NormalTextureScale), Is.EqualTo(.6f));
            Assert.That(material.GetFloat(MaterialProperty.OcclusionTextureStrength), Is.EqualTo(.8f));
            Assert.That(material.GetFloat(MaterialProperty.RoughnessFactor), Is.EqualTo(.7f));
            Assert.That(material.GetVector(CombatMaterialGenerator.SurfaceMaps), Is.EqualTo(new Vector4(1, 1, 1, 0)),
                "Authored normal, roughness and occlusion maps must participate in the fighter's shading.");
        }

        static void AssertColor(Color actual, Color expected)
        {
            Assert.That(actual.r, Is.EqualTo(expected.r).Within(.0001f));
            Assert.That(actual.g, Is.EqualTo(expected.g).Within(.0001f));
            Assert.That(actual.b, Is.EqualTo(expected.b).Within(.0001f));
            Assert.That(actual.a, Is.EqualTo(expected.a).Within(.0001f));
        }
    }
}
