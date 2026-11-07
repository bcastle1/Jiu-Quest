using NUnit.Framework;
using UnityEngine;

namespace JiuQuest.Combat.Tests
{
    public class StudioCutawayTests
    {
        // This occupied envelope includes inward benches, padding and soffits,
        // not just the wall center. It is independent of the visibility plane.
        const float NearestWallGeometry = 5.675f;
        const float OuterWallGeometry = 6.98f;
        const float WallHeight = 3.9f;
        const float CameraNearClip = .08f;
        static readonly Vector3[] WallNormals =
        {
            Vector3.forward, Vector3.right, Vector3.back, Vector3.left
        };

        [TestCase(.46f)]
        [TestCase(.75f)]
        [TestCase(1.6f)]
        [TestCase(2.1f)]
        public void FittedOrbitAndOverheadCamerasKeepVisibleWallsOutOfAthleteSightlines(float aspect)
        {
            var poses = new[]
            {
                new Bounds(new Vector3(.4f, .95f, -.2f), new Vector3(2.7f, 2, 2.1f)),
                new Bounds(new Vector3(0, .5f, 0), new Vector3(1.5f, .8f, 1.4f))
            };
            int hiddenWallSamples = 0;
            foreach (var pose in poses)
                foreach (float elevation in new[] { 12f, 14f, 25f, 65f, 76f })
                    for (int yaw = 0; yaw < 360; yaw += 15)
                    {
                        var orientation = Quaternion.Euler(elevation, yaw, 0);
                        float distance = CombatFraming.Distance(pose, orientation, 44, aspect, .9f);
                        var camera = pose.center + orientation * Vector3.back * distance;
                        int visibleWalls = 0;
                        foreach (var normal in WallNormals)
                        {
                            if (!DojoStage.IsStudioWallVisible(camera, normal, DojoStage.StudioCutawayDistance))
                            {
                                hiddenWallSamples++;
                                continue;
                            }
                            visibleWalls++;
                            var occupiedWall = WallEnvelope(normal);
                            foreach (var corner in CombatFraming.Corners(pose))
                                Assert.That(SegmentIntersects(occupiedWall, camera, corner), Is.False,
                                    $"Visible wall {normal} blocks an athlete at aspect {aspect}, yaw {yaw}, elevation {elevation}.");
                        }
                        Assert.That(visibleWalls, Is.GreaterThanOrEqualTo(2),
                            "Cutaways must retain the far room instead of hiding the whole studio.");
                    }
            if (aspect < .5f)
                Assert.That(hiddenWallSamples, Is.GreaterThan(0),
                    "The narrow-phone case must exercise a camera beyond the studio cutaway plane.");
        }

        [Test]
        public void NearWallDisappearsBeforeCameraEntersInwardFurnitureWhileFarWallStaysVisible()
        {
            Assert.That(DojoStage.StudioCutawayDistance + CameraNearClip,
                Is.LessThan(NearestWallGeometry), "A wall-center threshold leaves its inward furniture in front of the camera.");
            foreach (var normal in WallNormals)
            {
                // Still inside the architectural wall center, but already in
                // the volume occupied by a bench or other inward wall detail.
                var camera = normal * (NearestWallGeometry + .05f) + Vector3.up * .5f;
                Assert.That(SegmentIntersects(WallEnvelope(normal), camera, Vector3.up * .5f), Is.True);
                Assert.That(DojoStage.IsStudioWallVisible(camera, normal, DojoStage.StudioCutawayDistance), Is.False);
                Assert.That(DojoStage.IsStudioWallVisible(camera, -normal, DojoStage.StudioCutawayDistance), Is.True);
            }
        }

        static Bounds WallEnvelope(Vector3 normal)
        {
            float depth = OuterWallGeometry - NearestWallGeometry;
            var center = normal * ((NearestWallGeometry + OuterWallGeometry) * .5f) + Vector3.up * (WallHeight * .5f);
            var size = Mathf.Abs(normal.x) > .5f
                ? new Vector3(depth, WallHeight, OuterWallGeometry * 2)
                : new Vector3(OuterWallGeometry * 2, WallHeight, depth);
            return new Bounds(center, size);
        }

        static bool SegmentIntersects(Bounds occupied, Vector3 start, Vector3 end)
        {
            if (occupied.Contains(start)) return true;
            var delta = end - start;
            return occupied.IntersectRay(new Ray(start, delta.normalized), out float entryDistance)
                && entryDistance >= 0 && entryDistance < delta.magnitude - .001f;
        }
    }
}
