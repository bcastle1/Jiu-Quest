using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace JiuQuest.Combat.Editor
{
    public static class CombatPreviewBuild
    {
        const string ScenePath = "Assets/Generated/JiuQuestCombat.unity";

        [MenuItem("JiuQuest/Prepare combat preview")]
        public static void Prepare()
        {
            Directory.CreateDirectory("Assets/Generated");
            Directory.CreateDirectory("Assets/StreamingAssets/Bjj");
            StageAuthoredAssets();
            AssetDatabase.Refresh();
            var renderer = AssetDatabase.LoadAssetAtPath<UniversalRendererData>("Assets/Generated/CombatRenderer.asset");
            if (renderer == null)
            {
                renderer = ScriptableObject.CreateInstance<UniversalRendererData>();
                AssetDatabase.CreateAsset(renderer, "Assets/Generated/CombatRenderer.asset");
            }
            var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>("Assets/Generated/CombatURP.asset");
            if (pipeline == null)
            {
                pipeline = UniversalRenderPipelineAsset.Create(renderer);
                AssetDatabase.CreateAsset(pipeline, "Assets/Generated/CombatURP.asset");
            }
            pipeline.msaaSampleCount = 2;
            pipeline.renderScale = 1;
            pipeline.supportsHDR = false;
            pipeline.mainLightShadowmapResolution = 1024;
            pipeline.shadowDistance = 12;
            pipeline.shadowCascadeCount = 1;
            var pipelineSettings = new SerializedObject(pipeline);
            pipelineSettings.FindProperty("m_MainLightShadowsSupported").boolValue = true;
            pipelineSettings.FindProperty("m_SoftShadowsSupported").boolValue = true;
            pipelineSettings.FindProperty("m_AdditionalLightShadowsSupported").boolValue = false;
            pipelineSettings.ApplyModifiedPropertiesWithoutUndo();
            GraphicsSettings.defaultRenderPipeline = pipeline;
            QualitySettings.renderPipeline = pipeline;
            QualitySettings.vSyncCount = 0;
            QualitySettings.skinWeights = SkinWeights.FourBones;
            EditorUtility.SetDirty(pipeline);
            IncludeRuntimeShaders();

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("JiuQuestBridge").AddComponent<JiuQuestBridge>();
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            EditorSettings.serializationMode = SerializationMode.ForceText;
            PlayerSettings.companyName = "BROCO Technologies";
            PlayerSettings.productName = "JiuQuest Combat Preview";
            PlayerSettings.bundleVersion = "0.1.0";
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.runInBackground = false;
            PlayerSettings.defaultWebScreenWidth = 960;
            PlayerSettings.defaultWebScreenHeight = 600;
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Gzip;
            PlayerSettings.WebGL.decompressionFallback = true;
            PlayerSettings.WebGL.nameFilesAsHashes = true;
            PlayerSettings.WebGL.dataCaching = true;
            PlayerSettings.WebGL.template = "APPLICATION:Minimal";
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.WebGL, ScriptingImplementation.IL2CPP);
            PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.WebGL, ManagedStrippingLevel.Low);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        }

        [MenuItem("JiuQuest/Build WebGL preview")]
        public static void BuildWebGL()
        {
            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.WebGL)
                throw new BuildFailedException("Select the Web platform before building. For batch builds, start Unity with -buildTarget WebGL so platform assemblies load before compilation.");
            Prepare();
            var output = GetArgument("-jiuquestOutput") ?? Path.Combine(RepositoryRoot, "public", "unity");
            output = Path.GetFullPath(output);
            if (!output.StartsWith(RepositoryRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new BuildFailedException("Build output must be a dedicated directory inside this checkout.");
            var staging = Path.Combine(Directory.GetParent(Application.dataPath).FullName, "Temp", "WebBuild-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(staging);
            var snapshot = Path.Combine(staging, "build-source.json");
            RunSourceCheck("snapshot", snapshot);
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions {
                scenes = new[] { ScenePath }, locationPathName = staging,
                target = BuildTarget.WebGL, options = BuildOptions.DetailedBuildReport
            });
            if (report.summary.result != BuildResult.Succeeded)
                throw new BuildFailedException("JiuQuest WebGL build failed: " + report.summary.result);
            CombatBuildPrivacy.VerifyPackedAssets(report, staging);
            RunSourceCheck("verify-snapshot", snapshot);
            WriteManifest(staging);
            Publish(staging, output);
            Debug.Log("JiuQuest WebGL build succeeded: " + output);
        }

        public static string RepositoryRoot => Directory.GetParent(Application.dataPath).Parent.Parent.FullName;

        static void RunSourceCheck(string command, string snapshot)
        {
            var node = GetArgument("-jiuquestNode") ?? "node";
            var script = Path.Combine(RepositoryRoot, "tools", "unity_release.mjs");
            var info = new System.Diagnostics.ProcessStartInfo {
                FileName = node, Arguments = "\"" + script + "\" " + command + " --output \"" + snapshot + "\"",
                WorkingDirectory = RepositoryRoot, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            using var process = System.Diagnostics.Process.Start(info);
            if (process == null) throw new BuildFailedException("Could not start the Unity source provenance check.");
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(120000)) { process.Kill(); throw new BuildFailedException("Unity source provenance check timed out."); }
            if (process.ExitCode != 0) throw new BuildFailedException("Unity source provenance check failed: " + stderr.GetAwaiter().GetResult());
            Debug.Log(stdout.GetAwaiter().GetResult());
        }

        static void Publish(string staging, string output)
        {
            // Keep the previous complete build until the new source and packed-asset checks pass.
            // Move only known generated paths; unrelated files in the output folder are preserved.
            Directory.CreateDirectory(output);
            var backup = Path.Combine(Directory.GetParent(staging).FullName, "PreviousWebBuild-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(backup);
            var names = new[] { "Build", "StreamingAssets", "TemplateData", "index.html", "build-manifest.json", "build-privacy-check.json", "build-source.json", "build-sha256.txt" };
            var published = new System.Collections.Generic.List<string>();
            try
            {
                foreach (var name in names)
                {
                    var source = Path.Combine(staging, name);
                    var target = Path.Combine(output, name);
                    MoveIfPresent(target, Path.Combine(backup, name));
                    published.Add(name);
                    MoveIfPresent(source, target);
                }
            }
            catch
            {
                // Restore the last complete local output if a file is locked during publication.
                foreach (var name in published.AsEnumerable().Reverse())
                {
                    MoveIfPresent(Path.Combine(output, name), Path.Combine(staging, name));
                    MoveIfPresent(Path.Combine(backup, name), Path.Combine(output, name));
                }
                throw;
            }
        }

        static void MoveIfPresent(string source, string destination)
        {
            if (Directory.Exists(source)) Directory.Move(source, destination);
            else if (File.Exists(source)) File.Move(source, destination);
        }

        static string GetArgument(string argument)
        {
            var args = Environment.GetCommandLineArgs();
            int index = Array.IndexOf(args, argument);
            return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
        }

        static void StageAuthoredAssets()
        {
            var source = Path.Combine(RepositoryRoot, "public", "animations", "bjj");
            foreach (var move in CombatProtocol.MoveIds)
            {
                var path = Path.Combine(source, move + ".glb");
                if (!File.Exists(path)) throw new BuildFailedException("Missing authored paired source asset: " + move);
                var destination = Path.Combine(Application.streamingAssetsPath, "Bjj", move + ".glb");
                File.Copy(path, destination, true);
                using var sha = SHA256.Create();
                var original = sha.ComputeHash(File.ReadAllBytes(path));
                var copy = sha.ComputeHash(File.ReadAllBytes(destination));
                if (!original.SequenceEqual(copy)) throw new BuildFailedException("Asset staging hash mismatch: " + move);
            }
            File.Copy(Path.Combine(source, "manifest.json"), Path.Combine(Application.streamingAssetsPath, "Bjj", "manifest.json"), true);
        }

        static void IncludeRuntimeShaders()
        {
            // Runtime-only fighter imports are invisible to scene stripping. Keep
            // their cel shader, the official import/fallback shaders and the dojo shader.
            var shaders = new[] {
                Shader.Find("Universal Render Pipeline/Lit"),
                AssetDatabase.LoadAssetAtPath<Shader>("Assets/JiuQuest/Shaders/AnimeFighter.shader"),
                AssetDatabase.LoadAssetAtPath<Shader>("Packages/com.unity.cloud.gltfast/Runtime/Shader/glTF-pbrMetallicRoughness.shadergraph"),
                AssetDatabase.LoadAssetAtPath<Shader>("Packages/com.unity.cloud.gltfast/Runtime/Shader/URP/glTF-pbrMetallicRoughness-Clearcoat.shadergraph")
            };
            if (shaders.Any(shader => shader == null))
                throw new BuildFailedException("A required dojo, anime fighter or glTF import shader is missing.");
            var graphics = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset")[0]);
            var included = graphics.FindProperty("m_AlwaysIncludedShaders");
            foreach (var shader in shaders.Distinct())
            {
                bool exists = false;
                for (int index = 0; index < included.arraySize; index++)
                    if (included.GetArrayElementAtIndex(index).objectReferenceValue == shader) exists = true;
                if (exists) continue;
                int next = included.arraySize;
                included.InsertArrayElementAtIndex(next);
                included.GetArrayElementAtIndex(next).objectReferenceValue = shader;
            }
            graphics.ApplyModifiedPropertiesWithoutUndo();
        }

        [Serializable]
        sealed class BuildManifest
        {
            public int protocolVersion = 1;
            public string loaderUrl, dataUrl, frameworkUrl, codeUrl, streamingAssetsUrl;
            public string companyName = "BROCO Technologies";
            public string productName = "JiuQuest Combat Preview";
            public string productVersion = "0.1.0";
            public string unityVersion, generatedUtc;
            public string[] supportedMoves;
        }

        static void WriteManifest(string output)
        {
            string Asset(string suffix)
            {
                var files = Directory.GetFiles(Path.Combine(output, "Build"), "*" + suffix);
                if (files.Length != 1) throw new BuildFailedException("Expected exactly one Unity build file ending " + suffix);
                return "/unity/Build/" + Path.GetFileName(files[0]);
            }
            var manifest = new BuildManifest {
                loaderUrl = Asset(".loader.js"), dataUrl = Asset(".data.unityweb"), frameworkUrl = Asset(".framework.js.unityweb"), codeUrl = Asset(".wasm.unityweb"),
                streamingAssetsUrl = "/unity/StreamingAssets", unityVersion = Application.unityVersion,
                generatedUtc = DateTime.UtcNow.ToString("O"), supportedMoves = CombatProtocol.MoveIds
            };
            File.WriteAllText(Path.Combine(output, "build-manifest.json"), JsonUtility.ToJson(manifest, true) + "\n", new UTF8Encoding(false));
            using var sha = SHA256.Create();
            var lines = Directory.GetFiles(output, "*", SearchOption.AllDirectories)
                .Where(file => !file.EndsWith("build-sha256.txt", StringComparison.OrdinalIgnoreCase))
                .OrderBy(file => file, StringComparer.Ordinal)
                .Select(file => BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(file))).Replace("-", "").ToLowerInvariant() + "  " + Path.GetRelativePath(output, file).Replace('\\', '/'));
            File.WriteAllLines(Path.Combine(output, "build-sha256.txt"), lines, new UTF8Encoding(false));
        }
    }
}
