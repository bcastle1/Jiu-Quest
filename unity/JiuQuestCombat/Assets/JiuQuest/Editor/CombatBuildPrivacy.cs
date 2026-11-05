using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace JiuQuest.Combat.Editor
{
    // Unity.Collections brings in the performance-testing package. Its order-zero build hook
    // creates machine/command-line JSON in Resources even for a normal player build.
    // Remove only those generated test assets after that hook, before player asset packing.
    public sealed class CombatBuildPrivacy : IPreprocessBuildWithReport
    {
        static readonly string[] PerformanceResources = {
            "Assets/Resources/PerformanceTestRunInfo.json",
            "Assets/Resources/PerformanceTestRunSettings.json"
        };

        public int callbackOrder => int.MaxValue;

        public void OnPreprocessBuild(BuildReport report)
        {
            if ((report.summary.options & BuildOptions.IncludeTestAssemblies) != 0) return;
            foreach (string path in PerformanceResources)
            {
                if (!File.Exists(path) && !File.Exists(path + ".meta")) continue;
                if (!AssetDatabase.DeleteAsset(path))
                {
                    // The package may have written a file before AssetDatabase imported it.
                    // These fixed paths are the package's generated files, never user content.
                    if (File.Exists(path)) File.Delete(path);
                    if (File.Exists(path + ".meta")) File.Delete(path + ".meta");
                }
                if (File.Exists(path) || File.Exists(path + ".meta"))
                    throw new BuildFailedException("Could not exclude generated performance-test resources from this player build.");
            }
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        }

        public static void VerifyPackedAssets(BuildReport report, string output)
        {
            var packed = report.packedAssets;
            if (packed == null || packed.Length == 0)
                throw new BuildFailedException("Packed-asset evidence is unavailable; refusing to publish the Unity build manifest.");
            int checkedAssets = 0;
            foreach (var archive in packed)
            {
                foreach (var asset in archive.contents)
                {
                    checkedAssets++;
                    string path = (asset.sourceAssetPath ?? "").Replace('\\', '/');
                    if (PerformanceResources.Any(expected => string.Equals(expected, path, StringComparison.OrdinalIgnoreCase)))
                        throw new BuildFailedException("Generated performance-test metadata was included in the player; refusing to publish its manifest.");
                }
            }
            var evidence = new PrivacyEvidence { packedAssetsChecked = checkedAssets, verifiedUtc = DateTime.UtcNow.ToString("O") };
            File.WriteAllText(Path.Combine(output, "build-privacy-check.json"), JsonUtility.ToJson(evidence, true) + "\n");
        }

        [Serializable]
        sealed class PrivacyEvidence
        {
            public bool generatedPerformanceMetadataExcluded = true;
            public int packedAssetsChecked;
            public string verifiedUtc;
        }
    }
}
