using GLTFast;
using GLTFast.Materials;
using GLTFast.Schema;
using UnityEngine;

namespace JiuQuest.Combat
{
    // Our reviewed source contract uses opaque semantic cosmetic slots, not textures.
    // Generate those with one retained URP shader rather than importing every glTF shader variant.
    public sealed class CombatMaterialGenerator : MaterialGenerator
    {
        readonly Shader shader;
        public CombatMaterialGenerator(Shader shader) => this.shader = shader;

        protected override UnityEngine.Material GenerateDefaultMaterial(bool pointsSupport = false)
            => NewMaterial("JiuQuestFallback");

        public override UnityEngine.Material GenerateMaterial(MaterialBase gltfMaterial, IGltfReadable gltf, bool pointsSupport = false)
            => NewMaterial(gltfMaterial.name ?? "JiuQuestFallback");

        UnityEngine.Material NewMaterial(string name)
        {
            var material = new UnityEngine.Material(shader) { name = name };
            material.SetColor("_BaseColor", Color.white);
            material.SetFloat("_Smoothness", .23f);
            material.SetFloat("_Metallic", 0);
            return material;
        }
    }
}
