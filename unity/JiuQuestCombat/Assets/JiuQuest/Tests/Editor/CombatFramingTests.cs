using System;
using NUnit.Framework;
using UnityEngine;

namespace JiuQuest.Combat.Tests
{
    public class CombatFramingTests
    {
        [TestCase(.75f, 25, 27)]
        [TestCase(.75f, 25, 94)]
        [TestCase(.75f, 76, 0)]
        [TestCase(1.6f, 25, 27)]
        [TestCase(2.1f, 12, 180)]
        [TestCase(2.1f, 65, -120)]
        public void AllMotionCornersFitWithPerspectiveDepth(float aspect, float elevation, float yaw)
        {
            var bounds = new Bounds(new Vector3(.4f, .95f, -.2f), new Vector3(2.7f, 2.0f, 2.1f));
            var orientation = Quaternion.Euler(elevation, yaw, 0);
            const float occupancy = .9f;
            float distance = CombatFraming.Distance(bounds, orientation, 38, aspect, occupancy);
            foreach (var corner in CombatFraming.Corners(bounds))
            {
                var point = Quaternion.Inverse(orientation) * (corner - bounds.center) + Vector3.forward * distance;
                float halfHeight = point.z * Mathf.Tan(19 * Mathf.Deg2Rad);
                Assert.That(point.z, Is.GreaterThan(.08f));
                Assert.That(Mathf.Abs(point.y) / halfHeight, Is.LessThanOrEqualTo(occupancy + .0001f));
                Assert.That(Mathf.Abs(point.x) / (halfHeight * aspect), Is.LessThanOrEqualTo(occupancy + .0001f));
            }
        }

        [Test]
        public void GroundPairIsTightWithoutOldFourPointFiveMeterMinimum()
        {
            var bounds = new Bounds(new Vector3(0, .5f, 0), new Vector3(1.5f, .8f, 1.4f));
            float distance = CombatFraming.Distance(bounds, Quaternion.Euler(25, 27, 0), 38, 1.6f);
            Assert.That(distance, Is.LessThan(3.4f));
            Assert.That(CombatFraming.Distance(bounds, Quaternion.Euler(25, 27, 0), 38, .75f), Is.GreaterThan(distance));
        }

        [Test]
        public void TransformedBoundsContainRotatedAndScaledGeometry()
        {
            var original = new Bounds(new Vector3(.2f, .3f, -.4f), new Vector3(1, 2, 3));
            var matrix = Matrix4x4.TRS(new Vector3(7, -2, 1), Quaternion.Euler(25, 65, 12), new Vector3(2, .5f, 1.4f));
            var transformed = CombatFraming.TransformBounds(original, matrix);
            transformed.Expand(.0001f);
            foreach (var corner in CombatFraming.Corners(original)) Assert.That(transformed.Contains(matrix.MultiplyPoint3x4(corner)), Is.True);
        }

        [Test]
        public void InvalidViewportCannotCreateInvalidCameraPosition()
        {
            var bounds = new Bounds(Vector3.zero, Vector3.one);
            Assert.Throws<ArgumentOutOfRangeException>(() => CombatFraming.Distance(bounds, Quaternion.identity, 38, 0));
            Assert.Throws<ArgumentOutOfRangeException>(() => CombatFraming.Distance(bounds, Quaternion.identity, 38, float.NaN));
            Assert.Throws<ArgumentOutOfRangeException>(() => CombatFraming.Distance(bounds, Quaternion.identity, 180, 1));
        }

        [Test]
        public void ViewportCommandPreservesExplicitCompactAndDefaultClock()
        {
            var command = CombatProtocol.ParseJson("{\"protocolVersion\":1,\"instanceId\":\"phone\",\"requestId\":\"phone:4\",\"type\":\"setViewport\",\"compactViewport\":true}");
            Assert.That(CombatProtocol.Validate(command, out _), Is.True);
            Assert.That(command.compactViewport, Is.True);
            Assert.That(command.speed, Is.EqualTo(1));
            Assert.That(command.moveId, Is.Null);
        }
    }
}
