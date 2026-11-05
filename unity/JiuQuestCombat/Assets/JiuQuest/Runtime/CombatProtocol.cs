using System;
using System.Collections.Generic;

namespace JiuQuest.Combat
{
    [Serializable]
    public sealed class FighterAppearance
    {
        public string name;
        public string skinTone;
        public string hairColor;
        public string hairStyle;
        public string giTop;
        public string giPants;
        public string belt;
        public int stripes;
    }

    [Serializable]
    public sealed class CombatCommand
    {
        public int protocolVersion;
        public string instanceId;
        public string requestId;
        public string type;
        public string moveId;
        public string performerSide;
        public float progress;
        public float speed = 1;
        public string camera;
        public bool paused;
        public bool compactViewport;
        public FighterAppearance fighter;
        public FighterAppearance opponent;
    }

    [Serializable]
    public sealed class CombatEvent
    {
        public int protocolVersion = 1;
        public string instanceId;
        public string requestId;
        public string type;
        public string moveId;
        public float progress;
        public bool playing;
        public string message;
    }

    public static class CombatProtocol
    {
        public static CombatCommand ParseJson(string json)
        {
            // Overwrite a constructed command so omitted control fields keep documented defaults.
            var command = new CombatCommand();
            UnityEngine.JsonUtility.FromJsonOverwrite(json, command);
            return command;
        }

        // These IDs identify actual authored paired files, never a guessed substitute technique.
        public static readonly string[] MoveIds = {
            "standing_stance", "grip_fighting", "single_leg", "double_leg", "guard_pull",
            "closed_guard", "guard_pass", "side_control", "mount", "back_control", "armbar",
            "triangle_choke", "rear_naked_choke", "tap_out", "reset_neutral", "trap_roll_escape"
        };
        static readonly HashSet<string> Moves = new HashSet<string>(MoveIds, StringComparer.Ordinal);
        static readonly HashSet<string> Commands = new HashSet<string>(new[] {
            "configure", "play", "pause", "resume", "seek", "setSpeed", "setCamera", "setViewport", "reset", "requestState"
        }, StringComparer.Ordinal);
        static readonly HashSet<string> Cameras = new HashSet<string>(new[] { "front", "side", "overhead", "orbit" }, StringComparer.Ordinal);

        public static bool Validate(CombatCommand command, out string error)
        {
            error = null;
            if (command == null || command.protocolVersion != 1) error = "Unsupported bridge protocol; expected version 1.";
            else if (string.IsNullOrWhiteSpace(command.instanceId) || command.instanceId.Length > 160) error = "A valid instanceId is required.";
            else if (string.IsNullOrWhiteSpace(command.requestId) || command.requestId.Length > 180) error = "A valid requestId is required.";
            else if (command.type == null || !Commands.Contains(command.type)) error = "Unsupported bridge command.";
            else if ((command.type == "play" || !string.IsNullOrEmpty(command.moveId)) && !Moves.Contains(command.moveId ?? "")) error = "No authored Unity animation exists for this move ID.";
            else if (!string.IsNullOrEmpty(command.performerSide) && command.performerSide != "fighter" && command.performerSide != "opponent") error = "performerSide must be fighter or opponent.";
            else if ((command.type == "setCamera" || !string.IsNullOrEmpty(command.camera)) && !Cameras.Contains(command.camera ?? "")) error = "Unsupported camera preset.";
            else if (!Finite(command.progress) || command.progress < 0 || command.progress > 1) error = "progress must be between 0 and 1.";
            else if (!Finite(command.speed) || command.speed < .1f || command.speed > 2) error = "speed must be between 0.1 and 2.";
            return error == null;
        }

        public static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
        public static bool IsLooping(string moveId) => moveId == "standing_stance";
        public static string HairVariant(string hairStyle)
        {
            switch ((hairStyle ?? "shadow spikes").Trim().ToLowerInvariant())
            {
                case "bald": return "bald";
                case "crew cut": case "short fade": return "crew";
                case "mohawk": return "mohawk";
                case "long hair": case "storm tail": case "braided top": case "curly guard": return "long";
                case "slicked back": case "wave cut": return "slick";
                default: return "spikes";
            }
        }

        public static bool IsHairVisible(string nodeName, string hairStyle)
        {
            var selected = HairVariant(hairStyle);
            var name = (nodeName ?? "").ToLowerInvariant();
            foreach (var variant in new[] { "spikes", "crew", "mohawk", "long", "slick" })
                if (name.Contains("hair" + variant)) return selected != "bald" && variant == selected;
            // Only authored scalp variants are toggled. Brows and other details can
            // share a hair material without disappearing when the athlete is bald.
            return true;
        }

        public static bool IsBeltStripeVisible(string nodeName, int stripes)
        {
            if (string.IsNullOrEmpty(nodeName)) return false;
            const string marker = "BeltStripe_";
            int split = nodeName.LastIndexOf(marker, StringComparison.OrdinalIgnoreCase);
            if (split < 0) return false;
            string suffix = nodeName.Substring(split + marker.Length);
            int digits = 0;
            while (digits < suffix.Length && char.IsDigit(suffix[digits])) digits++;
            if (digits == 0 || !int.TryParse(suffix.Substring(0, digits), out int stripe)) return false;
            return stripe >= 1 && stripe <= Math.Max(0, Math.Min(4, stripes));
        }

        public static FighterAppearance AppearanceForRoot(string rootName, string performerSide, FighterAppearance fighter, FighterAppearance opponent)
        {
            bool attacker = rootName.StartsWith("JQ_Attacker", StringComparison.Ordinal);
            bool fighterAttacks = performerSide != "opponent";
            return attacker == fighterAttacks ? fighter : opponent;
        }
    }

    // One clock samples the entire paired scene. No animation event changes game state or scores.
    public sealed class PairedPlaybackClock
    {
        public float Duration { get; private set; } = 1;
        public float Time { get; private set; }
        public float Speed { get; set; } = 1;
        public bool Playing { get; set; }
        public bool Loop { get; private set; }
        public float Progress => Time / Duration;

        public void Load(float duration, bool loop, float progress, bool play)
        {
            if (!CombatProtocol.Finite(duration) || duration <= 0) throw new ArgumentOutOfRangeException(nameof(duration));
            Duration = duration;
            Loop = loop;
            Seek(progress);
            Playing = play;
        }

        public void Seek(float progress) => Time = Math.Max(0, Math.Min(1, progress)) * Duration;

        public bool Tick(float seconds)
        {
            if (!Playing || seconds <= 0 || !CombatProtocol.Finite(seconds)) return false;
            Time += seconds * Speed;
            if (Time < Duration) return false;
            if (Loop) { Time %= Duration; return false; }
            Time = Duration;
            Playing = false;
            return true;
        }
    }
}
