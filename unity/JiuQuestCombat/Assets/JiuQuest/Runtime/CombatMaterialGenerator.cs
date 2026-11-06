using System;
using GLTFast.Materials;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace JiuQuest.Combat
{
    // Let glTFast import the complete surface first, then render tagged fighters
    // with our cel shader. The dojo and any non-fighter materials keep their shader.
    public sealed class CombatMaterialGenerator : UniversalRPMaterialGenerator
    {
        public const string FighterShaderName = "JiuQuest/Anime Fighter";
        public static readonly int DetailStrength = Shader.PropertyToID("_DetailStrength");
        public static readonly int DetailBaseColor = Shader.PropertyToID("_DetailBaseColor");
        public static readonly int InkStrength = Shader.PropertyToID("_InkStrength");

        public CombatMaterialGenerator()
            : this(GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset) { }

        public CombatMaterialGenerator(UniversalRenderPipelineAsset pipeline)
            : base(pipeline ?? throw new ArgumentNullException(nameof(pipeline), "Combat materials require the configured URP pipeline.")) { }

        public override Material GenerateMaterial(GLTFast.Schema.MaterialBase gltfMaterial, GLTFast.IGltfReadable gltf, bool pointsSupport = false)
        {
            var material = base.GenerateMaterial(gltfMaterial, gltf, pointsSupport);
            string slot = gltfMaterial.name ?? "";
            if (material == null || !slot.StartsWith("JQ_", StringComparison.Ordinal)
                || gltfMaterial.GetAlphaMode() == GLTFast.Schema.MaterialBase.AlphaMode.Blend)
                return material;

            var shader = Shader.Find(FighterShaderName);
            if (shader == null) throw new InvalidOperationException("The anime fighter shader must be included in the Unity build.");
            int queue = material.renderQueue;
            bool cutout = gltfMaterial.GetAlphaMode() == GLTFast.Schema.MaterialBase.AlphaMode.Mask;
            // Matching glTF property names preserve imported texture objects, UV
            // transforms, factors and source metadata across the shader change.
            material.shader = shader;
            material.renderQueue = queue;
            material.SetFloat(MaterialProperty.Cull, (float)(gltfMaterial.doubleSided ? CullMode.Off : CullMode.Back));
            material.SetFloat(MaterialProperty.AlphaCutoff, cutout ? gltfMaterial.alphaCutoff : 0);
            if (cutout) material.EnableKeyword("_ALPHATEST_ON");
            else material.DisableKeyword("_ALPHATEST_ON");

            bool facialDetail = slot.IndexOf("Eye", StringComparison.OrdinalIgnoreCase) >= 0
                || slot.IndexOf("Iris", StringComparison.OrdinalIgnoreCase) >= 0
                || slot.IndexOf("Sclera", StringComparison.OrdinalIgnoreCase) >= 0
                || slot.IndexOf("Brow", StringComparison.OrdinalIgnoreCase) >= 0
                || slot.IndexOf("Lip", StringComparison.OrdinalIgnoreCase) >= 0
                || slot.IndexOf("Teeth", StringComparison.OrdinalIgnoreCase) >= 0;
            bool skin = !facialDetail && slot.IndexOf("Skin", StringComparison.OrdinalIgnoreCase) >= 0;
            bool hasReference = slot.IndexOf("_Ref_", StringComparison.OrdinalIgnoreCase) >= 0;
            // Flatten photographic skin variation against its authored reference;
            // eye ink and other small facial details keep their complete texture.
            material.SetFloat(DetailStrength, skin && hasReference ? .35f : 1f);
            material.SetVector(DetailBaseColor, CombatMaterialAppearance.ReferenceColor(slot));
            material.SetFloat(InkStrength, facialDetail ? .12f : skin ? .32f : .52f);
            return material;
        }
    }

    public static class CombatMaterialAppearance
    {
        static readonly int UrpBaseColor = Shader.PropertyToID("_BaseColor");
        static readonly int UrpBaseMap = Shader.PropertyToID("_BaseMap");

        public static Material ClonePreservingSurface(Material source)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            // The clone keeps all maps, roughness, normal scale, alpha mode, keywords,
            // UV transforms and render state. Only the selected cosmetic color changes.
            return new Material(source) { name = source.name };
        }

        public static Color BaseColor(Material material)
        {
            int property = BaseColorProperty(material);
            return property >= 0 ? (Color)material.GetVector(property) : Color.white;
        }

        static int BaseColorProperty(Material material)
            => material.HasProperty(MaterialProperty.BaseColor) ? MaterialProperty.BaseColor
             : material.HasProperty(UrpBaseColor) ? UrpBaseColor : -1;

        public static bool HasBaseColorTexture(Material material)
            => (material.HasProperty(MaterialProperty.BaseColorTexture) && material.GetTexture(MaterialProperty.BaseColorTexture) != null)
               || (material.HasProperty(UrpBaseMap) && material.GetTexture(UrpBaseMap) != null);

        public static bool ApplyTint(Material material, Color authoredBaseColor, string slot, FighterAppearance appearance, bool isFighter)
        {
            if (!TryCosmeticTint(slot, appearance, isFighter, out var tint)) return false;
            int property = BaseColorProperty(material);
            if (property < 0) return false;
            Color color;
            if (HasBaseColorTexture(material))
            {
                // glTFast exposes its baseColorFactor in sRGB shader-property space.
                // Recolor in linear space; never repeatedly multiply the last tint.
                Color reference = ReferenceColor(slot);
                var sourceLinear = authoredBaseColor.linear;
                var desiredLinear = tint.linear;
                var referenceLinear = reference.linear;
                color = new Color(
                    sourceLinear.r * desiredLinear.r / Mathf.Max(referenceLinear.r, .001f),
                    sourceLinear.g * desiredLinear.g / Mathf.Max(referenceLinear.g, .001f),
                    sourceLinear.b * desiredLinear.b / Mathf.Max(referenceLinear.b, .001f),
                    authoredBaseColor.a).gamma;
            }
            else color = tint;
            color.a = authoredBaseColor.a;
            material.SetVector(property, color);
            return true;
        }

        public static Color ReferenceColor(string slot)
        {
            // Textured cosmetic materials may declare the texture's unshaded color:
            // JQ_Attacker_Skin_Ref_AA7755. Missing reference means a neutral white map.
            const string marker = "_Ref_";
            int offset = slot.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
            if (offset >= 0 && slot.Length >= offset + marker.Length + 6
                && ColorUtility.TryParseHtmlString("#" + slot.Substring(offset + marker.Length, 6), out var reference))
                return reference;
            return Color.white;
        }

        public static bool TryCosmeticTint(string slot, FighterAppearance appearance, bool isFighter, out Color tint)
        {
            tint = Color.white;
            bool brows = slot.IndexOf("Brows", StringComparison.OrdinalIgnoreCase) >= 0
                         || slot.IndexOf("Eyebrow", StringComparison.OrdinalIgnoreCase) >= 0;
            // Eyes and other authored details are not clothing. Their albedo and color
            // remain unchanged even when a semantic parent name contains Skin or Hair.
            if (!brows && (slot.IndexOf("Eye", StringComparison.OrdinalIgnoreCase) >= 0
                || slot.IndexOf("Sclera", StringComparison.OrdinalIgnoreCase) >= 0
                || slot.IndexOf("Iris", StringComparison.OrdinalIgnoreCase) >= 0)) return false;
            string value = null;
            Color fallback = isFighter ? new Color(.83f, .9f, .93f) : new Color(.12f, .2f, .35f);
            if (slot.Contains("GiTop")) value = appearance?.giTop;
            else if (slot.Contains("GiPants")) value = appearance?.giPants;
            else if (slot.Contains("Skin")) { value = appearance?.skinTone; fallback = new Color(.64f, .42f, .28f); }
            else if (slot.Contains("Hair") || brows) { value = appearance?.hairColor; fallback = new Color(.08f, .06f, .05f); }
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
                    case "white": tint = new Color(.91f, .9f, .83f); return true;
                    case "blue": tint = new Color(.08f, .22f, .7f); return true;
                    case "purple": tint = new Color(.39f, .16f, .56f); return true;
                    case "brown": tint = new Color(.32f, .17f, .09f); return true;
                    case "black": tint = new Color(.035f, .04f, .055f); return true;
                }
                fallback = new Color(.91f, .9f, .83f);
            }
            else if (slot.Contains("Patch")) fallback = isFighter ? new Color(.12f, .8f, .68f) : new Color(.95f, .55f, .22f);
            else return false;
            tint = !string.IsNullOrEmpty(value) && ColorUtility.TryParseHtmlString(value, out var parsed) ? parsed : fallback;
            return true;
        }
    }
}
