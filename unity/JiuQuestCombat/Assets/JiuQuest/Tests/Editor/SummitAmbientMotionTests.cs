using NUnit.Framework;
using UnityEngine;

namespace JiuQuest.Combat.Tests
{
    public class SummitAmbientMotionTests
    {
        [TestCase(4f)]
        [TestCase(6.5f)]
        [TestCase(18f)]
        public void ReplayStartsAtExactlyTheSameWindAndCloudStateAsItsFinish(float duration)
        {
            var start = SummitAmbientMotion.Waves(SummitAmbientMotion.Phase(0, duration));
            var finish = SummitAmbientMotion.Waves(SummitAmbientMotion.Phase(duration, duration));
            Assert.That(start, Is.EqualTo(Vector4.zero));
            Assert.That(finish, Is.EqualTo(start));
        }

        [Test]
        public void RepeatedPausedPoseAndSeekBackProduceIdenticalAmbientSamples()
        {
            var weights = SummitAmbientMotion.BannerWeights(new Vector3(2.4f, 2.3f, 8.61f));
            var first = SummitAmbientMotion.BannerOffset(weights, SummitAmbientMotion.Waves(SummitAmbientMotion.Phase(2, 6)));
            var elsewhere = SummitAmbientMotion.BannerOffset(weights, SummitAmbientMotion.Waves(SummitAmbientMotion.Phase(4, 6)));
            var paused = SummitAmbientMotion.BannerOffset(weights, SummitAmbientMotion.Waves(SummitAmbientMotion.Phase(2, 6)));
            Assert.That(first.sqrMagnitude, Is.GreaterThan(.00001f));
            Assert.That(elsewhere, Is.Not.EqualTo(first));
            Assert.That(paused, Is.EqualTo(first));
        }

        [Test]
        public void PennantAttachmentAndEntireCrestPanelRemainPinned()
        {
            foreach (float height in new[] { 3.75f, 3.4f, 3.05f })
                for (int index = 0; index <= 32; index++)
                {
                    var weights = SummitAmbientMotion.BannerWeights(new Vector3(-2.15f, height, -8.61f));
                    var offset = SummitAmbientMotion.BannerOffset(weights, SummitAmbientMotion.Waves(index * Mathf.PI / 16));
                    Assert.That(offset, Is.EqualTo(Vector3.zero));
                }
        }

        [Test]
        public void LooseTailsStayInsideTheExpandedCullingEnvelopeWithoutVerticalDrift()
        {
            foreach (float x in new[] { -2.58f, -1.72f, 1.72f, 2.58f })
                foreach (float z in new[] { -8.66f, -8.56f, 8.56f, 8.66f })
                    foreach (float height in new[] { 2.27f, 2.73f, 3.05f, 3.75f })
                        for (int index = 0; index < 64; index++)
                        {
                            var weights = SummitAmbientMotion.BannerWeights(new Vector3(x, height, z));
                            var offset = SummitAmbientMotion.BannerOffset(weights, SummitAmbientMotion.Waves(index * Mathf.PI / 32));
                            Assert.That(offset.magnitude, Is.LessThan(SummitAmbientMotion.MaxDisplacement));
                            Assert.That(offset.y, Is.Zero);
                        }
        }

        [TestCase(float.NaN, 6f)]
        [TestCase(float.PositiveInfinity, 6f)]
        [TestCase(1f, float.NaN)]
        [TestCase(1f, 0f)]
        [TestCase(-1f, 6f)]
        public void InvalidOrUnavailablePlaybackTimeLeavesTheSceneAtRest(float time, float duration)
        {
            Assert.That(SummitAmbientMotion.Waves(SummitAmbientMotion.Phase(time, duration)), Is.EqualTo(Vector4.zero));
        }
    }
}
