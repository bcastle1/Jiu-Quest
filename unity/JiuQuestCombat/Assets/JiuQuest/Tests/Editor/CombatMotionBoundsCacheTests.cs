using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace JiuQuest.Combat.Tests
{
    public class CombatMotionBoundsCacheTests
    {
        [Test]
        public void ColorChangesAndSameClipReplayReuseMeasuredGeometry()
        {
            var cache = new CombatMotionBoundsCache();
            int samples = 0;
            Bounds[] Measure(int[] ids) { samples += ids.Length; return ids.Select(BoundsFor).ToArray(); }
            var original = cache.GetEnvelope(10, new[] { 1, 2, 3 }, Measure);
            for (int replayOrTint = 0; replayOrTint < 8; replayOrTint++)
                Assert.That(cache.GetEnvelope(10, new[] { 1, 2, 3 }, Measure), Is.EqualTo(original));
            Assert.That(samples, Is.EqualTo(3));
        }

        [Test]
        public void NewlyVisibleHairIsMeasuredWithoutRebakingBodyAndBaldCanTightenFit()
        {
            var cache = new CombatMotionBoundsCache();
            var measured = new List<int>();
            Bounds[] Measure(int[] ids) { measured.AddRange(ids); return ids.Select(BoundsFor).ToArray(); }
            var shortHair = cache.GetEnvelope(10, new[] { 1, 2 }, Measure);
            var longHair = cache.GetEnvelope(10, new[] { 1, 3 }, Measure);
            Assert.That(measured, Is.EqualTo(new[] { 1, 2, 3 }));
            Assert.That(longHair.max.y, Is.GreaterThan(shortHair.max.y));
            var bald = cache.GetEnvelope(10, new[] { 1 }, Measure);
            Assert.That(bald, Is.EqualTo(BoundsFor(1)));
            Assert.That(cache.GetEnvelope(10, new[] { 1, 2 }, Measure), Is.EqualTo(shortHair));
            Assert.That(measured.Count, Is.EqualTo(3));
        }

        [Test]
        public void PerformerSwapMeasuresOnlyTheOtherActorsNewHairVariants()
        {
            var cache = new CombatMotionBoundsCache();
            var measured = new List<int>();
            Bounds[] Measure(int[] ids) { measured.AddRange(ids); return ids.Select(BoundsFor).ToArray(); }
            var fighter = new FighterAppearance { hairStyle = "crew cut" };
            var opponent = new FighterAppearance { hairStyle = "long hair" };
            var variants = new[] {
                (id: 3, name: "JQ_Attacker_HairCrew"), (id: 4, name: "JQ_Attacker_HairLong"),
                (id: 5, name: "JQ_Defender_HairCrew"), (id: 6, name: "JQ_Defender_HairLong")
            };
            int[] Visible(string performer) => new[] { 1, 2 }.Concat(variants.Where(variant =>
                CombatProtocol.IsHairVisible(variant.name, CombatProtocol.AppearanceForRoot(variant.name, performer, fighter, opponent).hairStyle))
                .Select(variant => variant.id)).ToArray();
            cache.GetEnvelope(10, Visible("fighter"), Measure);
            Assert.That(measured, Is.EqualTo(new[] { 1, 2, 3, 6 }));
            cache.GetEnvelope(10, Visible("opponent"), Measure);
            Assert.That(measured, Is.EqualTo(new[] { 1, 2, 3, 6, 4, 5 }));
            cache.GetEnvelope(10, Visible("fighter"), Measure);
            Assert.That(measured.Count, Is.EqualTo(6));
        }

        [Test]
        public void NewImportAndExplicitReleaseDiscardPreviousMeasurements()
        {
            var cache = new CombatMotionBoundsCache();
            int calls = 0;
            Bounds[] Measure(int[] ids) { calls++; return ids.Select(BoundsFor).ToArray(); }
            cache.GetEnvelope(10, new[] { 1, 2 }, Measure);
            cache.GetEnvelope(11, new[] { 1, 2 }, Measure);
            Assert.That(calls, Is.EqualTo(2));
            cache.Clear();
            Assert.That(cache.Count, Is.Zero);
            cache.GetEnvelope(11, new[] { 1, 2 }, Measure);
            Assert.That(calls, Is.EqualTo(3));
        }

        [Test]
        public void CapacityLimitDoesNotDropGeometryFromCurrentEnvelope()
        {
            var cache = new CombatMotionBoundsCache(2);
            var visible = new[] { 1, 2, 3, 4 };
            var actual = cache.GetEnvelope(10, visible, ids => ids.Select(BoundsFor).ToArray());
            var expected = BoundsFor(1);
            foreach (int id in visible.Skip(1)) expected.Encapsulate(BoundsFor(id));
            Assert.That(actual, Is.EqualTo(expected));
            Assert.That(cache.Count, Is.EqualTo(2));
        }

        [Test]
        public void InvalidMeasurementsAreNotCachedAsValidFraming()
        {
            var cache = new CombatMotionBoundsCache();
            Assert.Throws<InvalidOperationException>(() => cache.GetEnvelope(10, new[] { 1 }, _ => Array.Empty<Bounds>()));
            Assert.Throws<InvalidOperationException>(() => cache.GetEnvelope(10, new[] { 1 }, _ => new[] { new Bounds(new Vector3(float.NaN, 0, 0), Vector3.one) }));
            Assert.That(cache.Count, Is.Zero);
            Assert.That(cache.GetEnvelope(10, new[] { 1 }, ids => ids.Select(BoundsFor).ToArray()), Is.EqualTo(BoundsFor(1)));
        }

        [Test]
        public void NoVisibleGeometryFailsInsteadOfInventingAnEnvelope()
        {
            var cache = new CombatMotionBoundsCache();
            Assert.Throws<InvalidOperationException>(() => cache.GetEnvelope(10, Array.Empty<int>(), _ => Array.Empty<Bounds>()));
        }

        static Bounds BoundsFor(int id) => new Bounds(new Vector3(0, id * .4f, 0), new Vector3(1, .5f, 1));
    }
}
