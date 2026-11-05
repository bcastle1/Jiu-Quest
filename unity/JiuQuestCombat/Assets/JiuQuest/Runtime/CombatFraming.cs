using System;
using UnityEngine;

namespace JiuQuest.Combat
{
    // Fits the complete choreography envelope, including depth, instead of chasing limbs.
    public static class CombatFraming
    {
        public static float CameraYaw(string moveId, string preset, float orbitYaw = 27)
        {
            // This authored seated pair faces +Z. Its previous global front viewed the
            // performer's back and concealed the choke; rotate this clip's view basis.
            float basis = moveId == "rear_naked_choke" ? 180 : 0;
            float angle = preset == "side" ? 94 : preset == "overhead" ? 0 : preset == "orbit" ? orbitYaw : 27;
            return basis + angle;
        }

        public static float Distance(Bounds bounds, Quaternion orientation, float verticalFov, float aspect, float occupancy = .86f)
        {
            if (!CombatProtocol.Finite(aspect) || aspect <= 0) throw new ArgumentOutOfRangeException(nameof(aspect));
            if (!CombatProtocol.Finite(verticalFov) || verticalFov <= 0 || verticalFov >= 170) throw new ArgumentOutOfRangeException(nameof(verticalFov));
            if (!CombatProtocol.Finite(occupancy) || occupancy <= 0 || occupancy >= 1) throw new ArgumentOutOfRangeException(nameof(occupancy));
            float vertical = Mathf.Tan(verticalFov * Mathf.Deg2Rad * .5f) * occupancy;
            float horizontal = vertical * aspect;
            float distance = .25f;
            var inverse = Quaternion.Inverse(orientation);
            for (int index = 0; index < 8; index++)
            {
                var point = inverse * Vector3.Scale(bounds.extents,
                    new Vector3((index & 1) == 0 ? -1 : 1, (index & 2) == 0 ? -1 : 1, (index & 4) == 0 ? -1 : 1));
                distance = Mathf.Max(distance, Mathf.Abs(point.x) / horizontal - point.z);
                distance = Mathf.Max(distance, Mathf.Abs(point.y) / vertical - point.z);
                distance = Mathf.Max(distance, .2f - point.z);
            }
            return distance;
        }

        public static Vector3[] Corners(Bounds bounds)
        {
            var result = new Vector3[8];
            for (int index = 0; index < 8; index++)
                result[index] = bounds.center + Vector3.Scale(bounds.extents,
                    new Vector3((index & 1) == 0 ? -1 : 1, (index & 2) == 0 ? -1 : 1, (index & 4) == 0 ? -1 : 1));
            return result;
        }

        public static Bounds TransformBounds(Bounds local, Matrix4x4 matrix)
        {
            var corners = Corners(local);
            var bounds = new Bounds(matrix.MultiplyPoint3x4(corners[0]), Vector3.zero);
            for (int index = 1; index < corners.Length; index++) bounds.Encapsulate(matrix.MultiplyPoint3x4(corners[index]));
            return bounds;
        }
    }
}
