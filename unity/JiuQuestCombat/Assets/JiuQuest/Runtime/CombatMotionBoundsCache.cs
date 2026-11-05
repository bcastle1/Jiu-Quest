using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace JiuQuest.Combat
{
    // One imported asset owns immutable meshes and one animation. Cosmetic colors
    // cannot change its geometry; visibility changes only select renderer envelopes.
    public sealed class CombatMotionBoundsCache
    {
        readonly int capacity;
        readonly Dictionary<int, Bounds> envelopes = new Dictionary<int, Bounds>();
        readonly Queue<int> insertionOrder = new Queue<int>();
        int? assetIdentity;

        public int Count => envelopes.Count;

        public CombatMotionBoundsCache(int capacity = 128)
        {
            if (capacity < 1) throw new ArgumentOutOfRangeException(nameof(capacity));
            this.capacity = capacity;
        }

        public Bounds GetEnvelope(int importedAssetIdentity, IReadOnlyList<int> visibleRenderers, Func<int[], Bounds[]> measureMissing)
        {
            if (visibleRenderers == null || visibleRenderers.Count == 0)
                throw new InvalidOperationException("The paired animation has no visible geometry to frame.");
            if (measureMissing == null) throw new ArgumentNullException(nameof(measureMissing));
            if (assetIdentity != importedAssetIdentity)
            {
                Clear();
                assetIdentity = importedAssetIdentity;
            }

            var ids = visibleRenderers.Distinct().ToArray();
            // Keep this request's values separate from the bounded cache. Even an
            // asset with more renderers than capacity must retain its complete fit.
            var requested = new Dictionary<int, Bounds>(ids.Length);
            var missing = new List<int>();
            foreach (int id in ids)
            {
                if (envelopes.TryGetValue(id, out var bounds)) requested.Add(id, bounds);
                else missing.Add(id);
            }
            if (missing.Count > 0)
            {
                var measured = measureMissing(missing.ToArray());
                if (measured == null || measured.Length != missing.Count)
                    throw new InvalidOperationException("Motion-bound measurements do not match the requested renderers.");
                foreach (var bounds in measured)
                    if (!Finite(bounds.center) || !Finite(bounds.extents) || bounds.extents.x < 0 || bounds.extents.y < 0 || bounds.extents.z < 0)
                        throw new InvalidOperationException("The paired animation produced invalid motion bounds.");
                for (int index = 0; index < missing.Count; index++)
                {
                    int id = missing[index];
                    requested.Add(id, measured[index]);
                    if (envelopes.Count == capacity) envelopes.Remove(insertionOrder.Dequeue());
                    envelopes.Add(id, measured[index]);
                    insertionOrder.Enqueue(id);
                }
            }
            var envelope = requested[ids[0]];
            for (int index = 1; index < ids.Length; index++) envelope.Encapsulate(requested[ids[index]]);
            return envelope;
        }

        public void Clear()
        {
            envelopes.Clear();
            insertionOrder.Clear();
            assetIdentity = null;
        }

        static bool Finite(Vector3 value)
            => CombatProtocol.Finite(value.x) && CombatProtocol.Finite(value.y) && CombatProtocol.Finite(value.z);
    }
}
