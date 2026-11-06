using NUnit.Framework;
using UnityEngine;
using System.Linq;

namespace JiuQuest.Combat.Tests
{
    public class CombatProtocolTests
    {
        static CombatCommand Command() => new CombatCommand { protocolVersion = 1, instanceId = "preview", requestId = "preview:1", type = "play", moveId = "double_leg" };

        [Test]
        public void ExactAuthoredMovesOnly()
        {
            var command = Command();
            Assert.That(CombatProtocol.Validate(command, out _), Is.True);
            command.moveId = "kimura";
            Assert.That(CombatProtocol.Validate(command, out _), Is.False);
            command.moveId = "../../arbitrary";
            Assert.That(CombatProtocol.Validate(command, out _), Is.False);
            command.moveId = "knee_cut_pass";
            Assert.That(CombatProtocol.Validate(command, out _), Is.False);
        }

        [Test]
        public void InvalidVersionClockAndIdentityAreRejected()
        {
            var command = Command();
            command.protocolVersion = 2;
            Assert.That(CombatProtocol.Validate(command, out _), Is.False);
            command = Command(); command.instanceId = "";
            Assert.That(CombatProtocol.Validate(command, out _), Is.False);
            command = Command(); command.progress = float.NaN;
            Assert.That(CombatProtocol.Validate(command, out _), Is.False);
            command = Command(); command.speed = 0;
            Assert.That(CombatProtocol.Validate(command, out _), Is.False);
            command = Command(); command.performerSide = "winner";
            Assert.That(CombatProtocol.Validate(command, out _), Is.False);
        }

        [Test]
        public void OpponentPerformerRetainsBothActorIdentities()
        {
            var fighter = new FighterAppearance { name = "Player", giTop = "#eeeeee" };
            var opponent = new FighterAppearance { name = "Opponent", giTop = "#223366" };
            Assert.That(CombatProtocol.AppearanceForRoot("JQ_Attacker_GiTop", "opponent", fighter, opponent), Is.SameAs(opponent));
            Assert.That(CombatProtocol.AppearanceForRoot("JQ_Defender_GiTop", "opponent", fighter, opponent), Is.SameAs(fighter));
            Assert.That(CombatProtocol.AppearanceForRoot("JQ_Attacker_Skin", "fighter", fighter, opponent), Is.SameAs(fighter));
        }

        [TestCase("shadow spikes", "Spikes")]
        [TestCase("crew cut", "Crew")]
        [TestCase("short fade", "Crew")]
        [TestCase("mohawk", "Mohawk")]
        [TestCase("long hair", "Long")]
        [TestCase("storm tail", "Long")]
        [TestCase("braided top", "Long")]
        [TestCase("curly guard", "Long")]
        [TestCase("slicked back", "Slick")]
        [TestCase("wave cut", "Slick")]
        [TestCase("unknown style", "Spikes")]
        public void ExactlyOneAuthoredHairVariantIsVisible(string selectedStyle, string expectedNode)
        {
            var names = new[] { "Spikes", "Crew", "Mohawk", "Long", "Slick" };
            var visible = names.Where(name => CombatProtocol.IsHairVisible("JQ_Attacker_Hair" + name, selectedStyle)).ToArray();
            Assert.That(visible, Is.EqualTo(new[] { expectedNode }));
        }

        [Test]
        public void BaldAndLongHairRemainWithCorrectActorsWhenOpponentPerforms()
        {
            var fighter = new FighterAppearance { hairStyle = "bald" };
            var opponent = new FighterAppearance { hairStyle = "long hair" };
            var attacker = CombatProtocol.AppearanceForRoot("JQ_Attacker_Hair", "opponent", fighter, opponent);
            var defender = CombatProtocol.AppearanceForRoot("JQ_Defender_Hair", "opponent", fighter, opponent);
            Assert.That(CombatProtocol.IsHairVisible("JQ_Attacker_HairLong", attacker.hairStyle), Is.True);
            foreach (var variant in new[] { "Spikes", "Crew", "Mohawk", "Long", "Slick" })
                Assert.That(CombatProtocol.IsHairVisible("JQ_Defender_Hair" + variant, defender.hairStyle), Is.False);
        }

        [Test]
        public void BaldKeepsBrowsVisibleEvenWhenTheyShareHairMaterials()
        {
            foreach (var name in new[] { "JQ_Attacker_Brows", "JQ_Attacker_Eyebrows", "JQ_Attacker_HairBrows" })
                Assert.That(CombatProtocol.IsHairVisible(name, "bald"), Is.True);
            Assert.That(CombatProtocol.IsHairVisible("JQ_Attacker_HairCrew", "bald"), Is.False);
            Assert.That(CombatProtocol.IsHairVisible("JQ_Attacker_HairLong", "bald"), Is.False);
        }

        [TestCase(-1, 0)]
        [TestCase(0, 0)]
        [TestCase(2, 2)]
        [TestCase(4, 4)]
        [TestCase(99, 4)]
        public void BeltStripeCountNeverInventsExtraRanks(int stripes, int expectedVisible)
        {
            int visible = Enumerable.Range(1, 4).Count(index => CombatProtocol.IsBeltStripeVisible("JQ_Attacker_BeltStripe_" + index, stripes));
            Assert.That(visible, Is.EqualTo(expectedVisible));
            Assert.That(CombatProtocol.IsBeltStripeVisible("JQ_Attacker_BeltStripe_5", stripes), Is.False);
        }

        [Test]
        public void StripesStayWithCorrectActorWhenOpponentPerforms()
        {
            var fighter = new FighterAppearance { stripes = 0 };
            var opponent = new FighterAppearance { stripes = 3 };
            var attacker = CombatProtocol.AppearanceForRoot("JQ_Attacker_BeltStripe", "opponent", fighter, opponent);
            var defender = CombatProtocol.AppearanceForRoot("JQ_Defender_BeltStripe", "opponent", fighter, opponent);
            Assert.That(CombatProtocol.IsBeltStripeVisible("JQ_Attacker_BeltStripe_3", attacker.stripes), Is.True);
            Assert.That(CombatProtocol.IsBeltStripeVisible("JQ_Defender_BeltStripe_1", defender.stripes), Is.False);
        }

        [Test]
        public void SharedClockPauseSeekAndSpeedDoNotAdvanceIndependently()
        {
            var clock = new PairedPlaybackClock();
            clock.Load(4, false, 0, true);
            clock.Speed = .5f;
            Assert.That(clock.Tick(2), Is.False);
            Assert.That(clock.Progress, Is.EqualTo(.25f));
            clock.Playing = false;
            clock.Tick(5);
            Assert.That(clock.Progress, Is.EqualTo(.25f));
            clock.Seek(.75f);
            Assert.That(clock.Time, Is.EqualTo(3));
            clock.Playing = true;
            Assert.That(clock.Tick(2), Is.True);
            Assert.That(clock.Progress, Is.EqualTo(1));
            Assert.That(clock.Playing, Is.False);
            Assert.That(clock.Tick(2), Is.False, "Completion is emitted only once.");
        }

        [Test]
        public void StanceLoopsWithoutCompletion()
        {
            var clock = new PairedPlaybackClock();
            clock.Load(2, true, .75f, true);
            Assert.That(clock.Tick(1), Is.False);
            Assert.That(clock.Progress, Is.EqualTo(.25f));
            Assert.That(clock.Playing, Is.True);
        }

        [Test]
        public void NonSeamlessGripEntryDoesNotTeleportBackToStart()
        {
            Assert.That(CombatProtocol.IsLooping("grip_fighting"), Is.False);
            var clock = new PairedPlaybackClock();
            clock.Load(2, CombatProtocol.IsLooping("grip_fighting"), 0, true);
            Assert.That(clock.Tick(2.1f), Is.True);
            Assert.That(clock.Progress, Is.EqualTo(1));
            Assert.That(clock.Playing, Is.False);
        }

        [Test]
        public void JsonControlDefaultsAndReducedMotionAreCompatible()
        {
            var pause = CombatProtocol.ParseJson("{\"protocolVersion\":1,\"instanceId\":\"preview\",\"requestId\":\"preview:2\",\"type\":\"pause\"}");
            Assert.That(CombatProtocol.Validate(pause, out var error), Is.True, error);
            var play = CombatProtocol.ParseJson("{\"protocolVersion\":1,\"instanceId\":\"preview\",\"requestId\":\"preview:3\",\"type\":\"play\",\"moveId\":\"armbar\",\"speed\":0.5,\"paused\":true}");
            Assert.That(play.paused, Is.True);
            Assert.That(CombatProtocol.Validate(play, out _), Is.True);
        }
    }
}
