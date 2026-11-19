"""Combine keyframe annotations and pose detections into the observations the fitter uses.

Inputs
  --votes      JSON list written by the annotation step: one entry per (batch, voter) with
               result.frames[*] = {frame, performer:{joints{name:[x,y,vis]}, facing, posture,
               feet_on_floor}, receiver:{...}, contacts, notes}
  --candidates track/candidates.json (per frame: detector skeletons with trouser-colour scores)
  --stabilize  track/stabilize.json (per frame homography to the reference frame)
  --frames     first:last (inclusive) source frames to emit

Per keyframe and athlete, the votes are made left/right-consistent (a voter whose whole body
fits the others better mirrored is mirrored), then each point is the median of the votes that
placed it; its sigma grows with the disagreement and with vis=1 (estimated, hidden).
Between keyframes points are interpolated linearly in the stabilised image (sigma grows with
the distance to the nearest keyframe). A detector point replaces the interpolation where the
detector skeleton of the right athlete (by trouser colour) agrees with it, which restores the
fine timing between keyframes.

Output obs.npz: frames, image_size, xy (F,2,19,2) in stabilised pixels, sigma (F,2,19) with inf
for no observation, lying (F,2), foot_contact (F,2,2), facing_yaw (F,2) (nan = unknown), and
keyframe annotations for review (kf_frames, kf_xy, kf_spread).
"""
from __future__ import annotations

import argparse
import json
import math
import re

import numpy as np

MARKERS = ['nose', 'l_ear', 'r_ear', 'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist',
           'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle', 'l_heel', 'r_heel', 'l_bigtoe', 'r_bigtoe']
MIRROR = [MARKERS.index(m.replace('l_', 'X_').replace('r_', 'l_').replace('X_', 'r_')) if m[:2] in ('l_', 'r_') else i
          for i, m in enumerate(MARKERS)]
COCO = ['nose', 'l_eye', 'r_eye', 'l_ear', 'r_ear', 'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist',
        'r_wrist', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle']
ROLES = ('performer', 'receiver')


def apply_h(H, xy):
    p = np.c_[xy, np.ones(len(xy))] @ np.asarray(H).T
    return p[:, :2] / p[:, 2:3]


def facing_to_yaw(text):
    """World yaw of the chest normal; camera looks along +Z, image-left is world +X."""
    t = (text or '').lower()
    if any(k in t for k in ('lying', ' up', 'face up', 'face-up', 'down (', 'face down', 'facedown')) and not any(k in t for k in ('toward', 'away', 'image')):
        return float('nan')
    toward = 'toward' in t or 'towards' in t or 'facing camera' in t
    away = 'away' in t
    left = 'image-left' in t or 'image left' in t or re.search(r'\bleft\b', t) is not None and 'image' in t
    right = 'image-right' in t or 'image right' in t or re.search(r'\bright\b', t) is not None and 'image' in t
    vx = (1.0 if left else 0.0) - (1.0 if right else 0.0)
    vz = (1.0 if away else 0.0) - (1.0 if toward else 0.0)
    if vx == 0 and vz == 0:
        return float('nan')
    return math.atan2(vx, vz)


def lying_score(person):
    t = (person.get('posture', '') + ' ' + person.get('facing', '')).lower()
    if any(k in t for k in ('lying', 'on his back', 'on back', 'supine', 'flat on', 'face down', 'prone')):
        return 1.0
    if any(k in t for k in ('falling', 'landing', 'sitting', 'seated', 'on the ground')):
        return 0.5
    return 0.0


def lying_direction(person):
    """+1 lying face up (on the back), -1 face down / chest down on top of the other athlete, 0 unknown."""
    t = (person.get('posture', '') + ' ' + person.get('facing', '')).lower()
    up = any(k in t for k in ('on his back', 'on back', 'supine', 'face up', 'face-up', 'facing up', 'up (lying', 'flat on his back'))
    down = any(k in t for k in ('face down', 'face-down', 'prone', 'chest down', 'chest-down', 'facing down', 'down (', 'on top', 'chest to chest', 'chest-to-chest'))
    return 1.0 if up and not down else (-1.0 if down and not up else 0.0)


def feet_flags(person):
    t = (person.get('feet_on_floor', '') or '').lower()
    t = t.replace('balls of', '').replace('ball of', '')
    if 'both feet' in t and not re.search(r'both feet (off|lifted|in the air)', t):
        return [1.0, 1.0]
    flags = []
    for side in ('left', 'right'):
        m = re.search(side + r' (foot|heel|toes|sole)([^,;.]*)', t)
        if not m:
            flags.append(0.0)
            continue
        tail = m.group(2)
        pre = t[max(0, m.start() - 8):m.start()]
        neg = re.search(r'(off|lifted|raised|in the air|not on|hooking|airborne|wrapped)', tail) or 'no ' in pre or 'not' in pre
        flags.append(0.0 if neg else 1.0)
    return flags


def consensus(votes_xyv):
    """votes_xyv: list of (19,3) arrays (x, y, vis; nan where missing). Returns xy (19,2),
    sigma (19,) and spread (19,) after making each voter left/right consistent with the rest."""
    V = [np.array(v, dtype=float) for v in votes_xyv]
    if len(V) >= 2:
        for i in range(len(V)):
            others = [V[k] for k in range(len(V)) if k != i]
            ref = np.nanmedian(np.stack([o[:, :2] for o in others]), 0)
            a = np.nanmean(np.linalg.norm(V[i][:, :2] - ref, axis=1))
            mirrored = V[i][MIRROR]
            b = np.nanmean(np.linalg.norm(mirrored[:, :2] - ref, axis=1))
            if np.isfinite(b) and np.isfinite(a) and b < 0.6 * a:
                V[i] = mirrored
    S = np.stack(V)                                # (n,19,3)
    xy = np.full((19, 2), np.nan)
    sigma = np.full(19, np.inf)
    spread = np.full(19, np.nan)
    for j in range(19):
        ok = np.isfinite(S[:, j, 0]) & (S[:, j, 2] >= 1)
        if ok.sum() == 0:
            continue
        pts = S[ok, j, :2]
        med = np.median(pts, 0)
        d = np.linalg.norm(pts - med, axis=1)
        if ok.sum() >= 3:                          # drop a single far outlier
            keep = d < max(3 * np.median(d), 40)
            pts = pts[keep]
            med = np.median(pts, 0)
            d = np.linalg.norm(pts - med, axis=1)
        xy[j] = med
        spread[j] = float(np.median(d)) if len(d) > 1 else 40.0
        vis = np.median(S[ok, j, 2])
        base = 14.0 if vis >= 1.5 else 32.0
        sigma[j] = math.sqrt(base ** 2 + (1.2 * spread[j]) ** 2) * (1.0 if ok.sum() >= 2 else 1.6)
    return xy, sigma, spread


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--votes', nargs='+', required=True)
    ap.add_argument('--candidates', required=True)
    ap.add_argument('--stabilize', required=True)
    ap.add_argument('--frames', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--image-size', default='1080,1920')
    args = ap.parse_args()
    f0, f1 = [int(x) for x in args.frames.split(':')]
    frames = list(range(f0, f1 + 1))
    F = len(frames)
    stab = json.load(open(args.stabilize))['frames']
    cands = json.load(open(args.candidates))

    # ---- keyframe consensus
    per_frame = {}
    for path in args.votes:
        for job in json.load(open(path)):
            for fr in (job.get('result') or job)['frames']:   # workflow job record or bare result
                per_frame.setdefault(int(fr['frame']), []).append(fr)
    kf = sorted(k for k in per_frame if f0 <= k <= f1)
    kf_xy = np.full((len(kf), 2, 19, 2), np.nan)
    kf_sig = np.full((len(kf), 2, 19), np.inf)
    kf_spread = np.full((len(kf), 2, 19), np.nan)
    kf_lying = np.zeros((len(kf), 2))
    kf_feet = np.zeros((len(kf), 2, 2))
    kf_yaw = np.full((len(kf), 2), np.nan)
    kf_ldir = np.zeros((len(kf), 2))
    kf_text = {}
    kf_clasp = np.zeros(len(kf))
    clasp_re = re.compile(r'(clasp|interlock|gable|grip|locked|lock)', re.I)
    back_re = re.compile(r'(back|waist|behind|body ?lock|around)', re.I)
    for i, k in enumerate(kf):
        votes_c = [any(clasp_re.search(c) and back_re.search(c) and 'performer' in c.lower() and 'hand' in c.lower()
                       for c in fr['contacts']) for fr in per_frame[k]]
        kf_clasp[i] = float(np.mean(votes_c)) if votes_c else 0.0
    for i, k in enumerate(kf):
        H = stab[str(k)]['H']
        for p, role in enumerate(ROLES):
            votes = []
            for fr in per_frame[k]:
                js = fr[role]['joints']
                v = np.array([[np.nan if js[m][0] is None else js[m][0], np.nan if js[m][1] is None else js[m][1],
                               js[m][2] if js[m][2] is not None else 0] for m in MARKERS], dtype=float)
                v[v[:, 2] < 1, :2] = np.nan
                votes.append(v)
            xy, sig, spread = consensus(votes)
            ok = np.isfinite(xy[:, 0])
            if ok.any():
                xy[ok] = apply_h(H, xy[ok])
            kf_xy[i, p], kf_sig[i, p], kf_spread[i, p] = xy, sig, spread
            kf_lying[i, p] = np.mean([lying_score(fr[role]) for fr in per_frame[k]])
            kf_feet[i, p] = np.mean([feet_flags(fr[role]) for fr in per_frame[k]], 0)
            kf_ldir[i, p] = np.mean([lying_direction(fr[role]) for fr in per_frame[k]])
            yaws = [facing_to_yaw(fr[role]['facing']) for fr in per_frame[k]]
            yaws = [y for y in yaws if np.isfinite(y)]
            if yaws:
                kf_yaw[i, p] = math.atan2(np.mean(np.sin(yaws)), np.mean(np.cos(yaws)))
        kf_text[k] = {'contacts': [c for fr in per_frame[k] for c in fr['contacts']],
                      'facing': [[fr[r]['facing'] for r in ROLES] for fr in per_frame[k]],
                      'feet': [[fr[r]['feet_on_floor'] for r in ROLES] for fr in per_frame[k]]}

    # ---- dense observations
    xy = np.full((F, 2, 19, 2), np.nan)
    sigma = np.full((F, 2, 19), np.inf)
    lying = np.zeros((F, 2))
    feet = np.zeros((F, 2, 2))
    yaw = np.full((F, 2), np.nan)
    ldir = np.zeros((F, 2))
    src = np.zeros((F, 2, 19), dtype=np.int8)        # 0 none, 1 keyframe, 2 interpolated, 3 detector
    clasp = np.zeros(F)
    kf_arr = np.array(kf)
    for fi, f in enumerate(frames):
        if len(kf):
            j1 = np.searchsorted(kf_arr, f)
            prev = j1 - 1 if j1 > 0 and (j1 == len(kf) or kf_arr[j1] != f) else (j1 if j1 < len(kf) and kf_arr[j1] == f else None)
            if j1 < len(kf) and kf_arr[j1] == f:
                a = b = j1
            else:
                a = j1 - 1 if j1 > 0 else None
                b = j1 if j1 < len(kf) else None
            if a is not None and b is not None:
                if a == b:
                    clasp[fi] = kf_clasp[a]
                elif kf_arr[b] - kf_arr[a] <= 14:
                    clasp[fi] = min(kf_clasp[a], kf_clasp[b]) if min(kf_clasp[a], kf_clasp[b]) > 0.5 else 0.0
            for p in range(2):
                if a is not None and b is not None and a == b:
                    xy[fi, p], sigma[fi, p] = kf_xy[a, p], kf_sig[a, p]
                    src[fi, p][np.isfinite(sigma[fi, p])] = 1
                    lying[fi, p], feet[fi, p], yaw[fi, p] = kf_lying[a, p], kf_feet[a, p], kf_yaw[a, p]
                    ldir[fi, p] = kf_ldir[a, p]
                elif a is not None and b is not None:
                    ka, kb = kf_arr[a], kf_arr[b]
                    if kb - ka > 14:
                        continue
                    t = (f - ka) / (kb - ka)
                    ok = np.isfinite(kf_sig[a, p]) & np.isfinite(kf_sig[b, p])
                    xy[fi, p][ok] = (1 - t) * kf_xy[a, p][ok] + t * kf_xy[b, p][ok]
                    gap = min(f - ka, kb - f)
                    sigma[fi, p][ok] = np.maximum(kf_sig[a, p][ok], kf_sig[b, p][ok]) + 6.0 * gap
                    src[fi, p][ok] = 2
                    lying[fi, p] = (1 - t) * kf_lying[a, p] + t * kf_lying[b, p]
                    feet[fi, p] = kf_feet[a, p] if t < 0.5 else kf_feet[b, p]
                    ya, yb = kf_yaw[a, p], kf_yaw[b, p]
                    yaw[fi, p] = ya if t < 0.5 else yb
                    ldir[fi, p] = kf_ldir[a, p] if t < 0.5 else kf_ldir[b, p]
        # detector evidence
        H = stab[str(f)]['H'] if str(f) in stab else None
        if H is None:
            continue
        for c in cands[str(f)]:
            k = np.array(c['kp'], dtype=float)
            if k[:, 2].mean() < 0.4:
                continue
            blue, white = c['blue'] or 0.0, c['white'] or 0.0
            role = 0 if blue > 0.3 and blue > white else (1 if white > 0.5 else None)
            if role is None:
                continue
            pts = np.full((19, 3), np.nan)
            for ci, name in enumerate(COCO):
                if name in MARKERS:
                    pts[MARKERS.index(name)] = k[ci]
            if c['src'] == 'mp' and 'feet' in c:
                fe = np.array(c['feet'])           # l_heel, r_heel, l_foot_index, r_foot_index
                for mi, name in zip(range(4), ('l_heel', 'r_heel', 'l_bigtoe', 'r_bigtoe')):
                    pts[MARKERS.index(name)] = fe[mi]
            ok = np.isfinite(pts[:, 0]) & (pts[:, 2] > 0.5)
            if ok.sum() < 6:
                continue
            uv = np.full((19, 2), np.nan)
            uv[ok] = apply_h(H, pts[ok, :2])
            ref = xy[fi, role]
            have_ref = np.isfinite(ref[:, 0])
            if have_ref.sum() >= 6:
                both = ok & have_ref
                d = np.nanmedian(np.linalg.norm(uv[both] - ref[both], axis=1)) if both.any() else np.inf
                dm = np.nanmedian(np.linalg.norm(uv[MIRROR][both] - ref[both], axis=1)) if both.any() else np.inf
                if dm < 0.7 * d:
                    uv, ok, pts = uv[MIRROR], ok[MIRROR], pts[MIRROR]
                    d = dm
                if not d < 45:
                    continue
                for j in np.where(ok & have_ref)[0]:
                    if np.linalg.norm(uv[j] - ref[j]) < 55 and src[fi, role, j] != 1:
                        xy[fi, role, j] = uv[j]
                        sigma[fi, role, j] = 16.0 / max(pts[j, 2], 0.5)
                        src[fi, role, j] = 3
            elif not len(kf):
                for j in np.where(ok)[0]:
                    xy[fi, role, j] = uv[j]
                    sigma[fi, role, j] = 18.0 / max(pts[j, 2], 0.5)
                    src[fi, role, j] = 3
    W, Hh = [float(x) for x in args.image_size.split(',')]
    np.savez(args.out, frames=np.array(frames), image_size=np.array([W, Hh]), xy=np.nan_to_num(xy), sigma=sigma,
             lying=lying, lying_dir=ldir, foot_contact=feet, facing_yaw=yaw, source=src, clasp=clasp, kf_frames=np.array(kf), kf_xy=kf_xy,
             kf_sigma=kf_sig, kf_spread=kf_spread)
    json.dump({str(k): v for k, v in kf_text.items()}, open(args.out.replace('.npz', '_kf_text.json'), 'w'), indent=1)
    have = np.isfinite(sigma)
    print('frames', F, 'keyframes', len(kf), 'observed points per athlete (mean/frame):', have.sum(-1).mean(0),
          'sources (kf, interp, det):', [(src == s).sum() for s in (1, 2, 3)])
    print('mean spread px (performer, receiver):', np.nanmean(kf_spread, axis=(0, 2)))
    print('clasp per keyframe:', dict(zip(kf, np.round(kf_clasp, 2))))


if __name__ == '__main__':
    main()
