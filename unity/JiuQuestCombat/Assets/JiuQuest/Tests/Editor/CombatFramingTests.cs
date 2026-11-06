using System;
using NUnit.Framework;
using UnityEngine;

namespace JiuQuest.Combat.Tests
{
    public class CombatFramingTests
    {
        [Test]
        public void CloseUpBoundsFollowTranslatedPoseWithSurfaceAllowance()
        {
            var points = new[] { new Vector3(12, .1f, -6), new Vector3(13, 1.2f, -5) };
            Assert.That(CombatFraming.TryPoseBounds(points, out var bounds), Is.True);
            Assert.That(Vector3.Distance(bounds.center, new Vector3(12.5f, .65f, -5.5f)), Is.LessThan(.0001f));
            Assert.That(bounds.size.x, Is.EqualTo(1.45f).Within(.0001f));
            foreach (var point in points) Assert.That(bounds.Contains(point + Vector3.up * .2f), Is.True);
            Assert.That(bounds.Contains(Vector3.zero), Is.False);
        }

        [Test]
        public void InvalidOrMissingJointsCannotCreateCloseUpCameraBounds()
        {
            Assert.That(CombatFraming.TryPoseBounds(null, out _), Is.False);
            Assert.That(CombatFraming.TryPoseBounds(Array.Empty<Vector3>(), out _), Is.False);
            Assert.That(CombatFraming.TryPoseBounds(new[] { Vector3.zero, new Vector3(float.NaN, 1, 1) }, out _), Is.False);
            Assert.That(CombatFraming.TryPoseBounds(new[] { new Vector3(0, float.PositiveInfinity, 0) }, out _), Is.False);
        }

        [Test]
        public void CloseUpCommandIsAcceptedAndPreservesAuthoredViewBasis()
        {
            var command = CombatProtocol.ParseJson("{\"protocolVersion\":1,\"instanceId\":\"phone\",\"requestId\":\"phone:7\",\"type\":\"setCamera\",\"camera\":\"focus\"}");
            Assert.That(CombatProtocol.Validate(command, out _), Is.True);
            Assert.That(CombatFraming.CameraYaw("rear_naked_choke", "focus"), Is.EqualTo(207));
            Assert.That(CombatFraming.CameraYaw("double_leg", "focus"), Is.EqualTo(27));
        }

        [TestCase("double_leg", .46f)]
        [TestCase("double_leg", .75f)]
        [TestCase("double_leg", 1.5f)]
        [TestCase("rear_naked_choke", .46f)]
        [TestCase("rear_naked_choke", .75f)]
        [TestCase("rear_naked_choke", 1.5f)]
        public void HiddenRigHelpersCannotMakeCloseUpWiderThanMeasuredMotion(string moveId, float aspect)
        {
            var motion = new Bounds(new Vector3(7, .8f, -4), new Vector3(2, 1.6f, 2));
            var pose = new Bounds(new Vector3(6, .4f, -3), new Vector3(7, 3, 4));
            var bounded = CombatFraming.LimitPoseToMotion(pose, motion);
            var frontOrientation = Quaternion.Euler(CombatFraming.CameraElevation("front"), CombatFraming.CameraYaw(moveId, "front"), 0);
            var focusOrientation = Quaternion.Euler(CombatFraming.CameraElevation("focus"), CombatFraming.CameraYaw(moveId, "focus"), 0);
            Assert.That(Quaternion.Angle(frontOrientation, focusOrientation), Is.LessThan(.001f));
            Assert.That(CombatFraming.Distance(bounded, focusOrientation, 44, aspect), Is.LessThanOrEqualTo(CombatFraming.Distance(motion, frontOrientation, 44, aspect)));
            Assert.That(bounded.min.x, Is.GreaterThanOrEqualTo(motion.min.x));
            Assert.That(bounded.max.z, Is.LessThanOrEqualTo(motion.max.z));
            var disjoint = new Bounds(new Vector3(30, 0, 0), Vector3.one);
            Assert.That(CombatFraming.LimitPoseToMotion(disjoint, motion), Is.EqualTo(motion));
        }

        [Test]
        public void RearNakedChokeFrontViewsFacesAndHoldInsteadOfPerformersBack()
        {
            float front = CombatFraming.CameraYaw("rear_naked_choke", "front");
            var cameraFromPair = Quaternion.Euler(25, front, 0) * Vector3.back;
            Assert.That(Vector3.Dot(cameraFromPair, Vector3.forward), Is.GreaterThan(.7f));
            Assert.That(CombatFraming.CameraYaw("rear_naked_choke", "side") - front, Is.EqualTo(67));
            Assert.That(CombatFraming.CameraYaw("rear_naked_choke", "orbit", 27), Is.EqualTo(front));
            Assert.That(CombatFraming.CameraYaw("rear_naked_choke", "overhead"), Is.EqualTo(180));
        }

        [TestCase("standing_stance")]
        [TestCase("double_leg")]
        [TestCase("trap_roll_escape")]
        [TestCase("back_control")]
        public void OtherAuthoredMovesKeepTheirReviewedCameraBasis(string moveId)
        {
            Assert.That(CombatFraming.CameraYaw(moveId, "front"), Is.EqualTo(27));
            Assert.That(CombatFraming.CameraYaw(moveId, "side"), Is.EqualTo(94));
            Assert.That(CombatFraming.CameraYaw(moveId, "orbit", -25), Is.EqualTo(-25));
        }

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
