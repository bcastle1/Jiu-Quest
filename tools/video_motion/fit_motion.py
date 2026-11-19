"""Fit two JiuQuest athletes to 2D evidence from a video: camera and per-frame poses.

Inputs (see build_observations.py):
  obs.npz   2D observations of 19 body points for the performer and the receiver on every
            frame of a range, already mapped into ONE stabilised camera (the reference frame of
            stabilize.json), with a per-point sigma in pixels (0 or inf = no observation), plus
            per-frame hints from the keyframe annotations: which feet are planted, whether an
            athlete is lying, and which way he faces.
  template  a paired GLB (public/animations/bjj/*.glb) whose rig both athletes use.

The model is the rig itself: each athlete's pelvis has a free world position and orientation,
and 21 more joints (spine, neck, head, clavicles, shoulders, elbows, wrists, hips, knees,
ankles, toes) rotate relative to their rest pose. Knees and elbows are hinges (flexion about
the bone's local X, which is the anatomical flexion axis of this rig) with a little twist.
Bone lengths are the rig's. The camera is a pinhole (focal, principal point, height, pitch,
roll); world is Y-up with the mat at y = 0 and the camera above the origin looking along +Z.

Energy (all terms robust or bounded):
  2D reprojection of the 19 points (Geman-McClure on residual / sigma)
  floor: nothing below the mat; planted feet on the mat and not sliding
  no interpenetration between the two athletes (capsules)
  joint limits (soft), small spine/neck bends, temporal smoothness (acceleration)
  facing / lying hints from the annotations (weak, only to pick the right basin)

Output: motion.npz in the contract of write_paired_glb.py (performer -> JQ_Attacker,
receiver -> JQ_Defender), fit.json with the camera (in GLB pair space too) and per-frame
residual statistics.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rig import (load_rig, make_quat_continuous, mat_to_quat, measure_markers, quat_to_mat,  # noqa: E402
                 read_glb, accessor)

torch.set_default_dtype(torch.float64)

MARKERS = ['nose', 'l_ear', 'r_ear', 'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist',
           'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle', 'l_heel', 'r_heel', 'l_bigtoe', 'r_bigtoe']
FIT_BONES = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
             'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
             'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']
HINGES = {'calf_l', 'calf_r', 'lowerarm_l', 'lowerarm_r'}
# soft limit on the rotation magnitude (radians) of each ball joint relative to rest
LIMITS = {'spine_01': 0.55, 'spine_02': 0.45, 'spine_03': 0.45, 'neck_01': 0.7, 'Head': 0.7,
          'clavicle_l': 0.45, 'clavicle_r': 0.45, 'upperarm_l': 2.7, 'upperarm_r': 2.7,
          'hand_l': 1.2, 'hand_r': 1.2, 'thigh_l': 2.3, 'thigh_r': 2.3,
          'foot_l': 0.9, 'foot_r': 0.9, 'ball_l': 0.7, 'ball_r': 0.7}
# capsules: (name, from, to, radius m); 'head_top' is a point 20 cm along the Head bone
CAPSULES = [('hips', 'thigh_l', 'thigh_r', 0.10), ('abdomen', 'pelvis', 'spine_02', 0.12),
            ('chest', 'spine_02', 'neck_01', 0.13), ('shoulders', 'upperarm_l', 'upperarm_r', 0.065),
            ('head', 'Head', 'head_top', 0.095),
            ('uarm_l', 'upperarm_l', 'lowerarm_l', 0.05), ('farm_l', 'lowerarm_l', 'hand_l', 0.04),
            ('uarm_r', 'upperarm_r', 'lowerarm_r', 0.05), ('farm_r', 'lowerarm_r', 'hand_r', 0.04),
            ('thigh_l', 'thigh_l', 'calf_l', 0.075), ('shin_l', 'calf_l', 'foot_l', 0.055),
            ('thigh_r', 'thigh_r', 'calf_r', 0.075), ('shin_r', 'calf_r', 'foot_r', 0.055),
            ('foot_l', 'foot_l', 'ball_l', 0.045), ('foot_r', 'foot_r', 'ball_r', 0.045)]


def rot_x(a):
    c, s = torch.cos(a), torch.sin(a)
    o, z = torch.ones_like(a), torch.zeros_like(a)
    return torch.stack([torch.stack([o, z, z], -1), torch.stack([z, c, -s], -1), torch.stack([z, s, c], -1)], -2)


def rot_y(a):
    c, s = torch.cos(a), torch.sin(a)
    o, z = torch.ones_like(a), torch.zeros_like(a)
    return torch.stack([torch.stack([c, z, s], -1), torch.stack([z, o, z], -1), torch.stack([-s, z, c], -1)], -2)


def axis_angle(v):
    theta = torch.sqrt((v * v).sum(-1, keepdim=True) + 1e-12)
    k = v / theta
    K = torch.zeros(v.shape[:-1] + (3, 3))
    K[..., 0, 1], K[..., 0, 2] = -k[..., 2], k[..., 1]
    K[..., 1, 0], K[..., 1, 2] = k[..., 2], -k[..., 0]
    K[..., 2, 0], K[..., 2, 1] = -k[..., 1], k[..., 0]
    s, c = torch.sin(theta)[..., None], torch.cos(theta)[..., None]
    return torch.eye(3).expand(K.shape) + s * K + (1 - c) * (K @ K)


def sixd_to_mat(x):
    a1, a2 = x[..., :3], x[..., 3:]
    b1 = torch.nn.functional.normalize(a1, dim=-1)
    b2 = torch.nn.functional.normalize(a2 - (b1 * a2).sum(-1, keepdim=True) * b1, dim=-1)
    b3 = torch.cross(b1, b2, dim=-1)
    return torch.stack((b1, b2, b3), dim=-1)


def mat_to_sixd(m):
    return np.concatenate([m[..., :, 0], m[..., :, 1]], -1)


def seg_seg_dist(p1, q1, p2, q2):
    """Distance between segments p1q1 and p2q2 (broadcast over leading dims)."""
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a = (d1 * d1).sum(-1).clamp_min(1e-9)
    e = (d2 * d2).sum(-1).clamp_min(1e-9)
    f = (d2 * r).sum(-1)
    c = (d1 * r).sum(-1)
    b = (d1 * d2).sum(-1)
    den = (a * e - b * b).clamp_min(1e-9)
    s = ((b * f - c * e) / den).clamp(0, 1)
    t = ((b * s + f) / e)
    t_c = t.clamp(0, 1)
    s = torch.where(t != t_c, ((b * t_c - c) / a).clamp(0, 1), s)
    t = t_c
    c1 = p1 + d1 * s[..., None]
    c2 = p2 + d2 * t[..., None]
    return torch.sqrt(((c1 - c2) ** 2).sum(-1) + 1e-12)


class Body:
    """FK for the fitted subset of the rig, with the pelvis placed directly in world space."""

    def __init__(self, rig):
        self.rig = rig
        self.idx = [rig.index(b) for b in FIT_BONES]
        self.parent = []
        for b in FIT_BONES:
            p = rig.parents[rig.index(b)]
            self.parent.append(FIT_BONES.index(rig.joint_names[p]) if b != 'pelvis' else -1)
        self.rest_R = torch.tensor(quat_to_mat(rig.rest_r[self.idx]))
        self.rest_t = torch.tensor(rig.rest_t[self.idx])
        head = rig.index('Head')
        self.markers = []
        for m in MARKERS:
            j, off = rig.markers[m]
            self.markers.append((FIT_BONES.index(rig.joint_names[j]), torch.tensor(off)))
        self.head_top = torch.tensor([0.0, 0.20, 0.0])
        assert FIT_BONES.index('Head') == 5 and rig.index('Head') == head

    def fk(self, pelvis_t, pelvis_R, D):
        """pelvis_t (B,3), pelvis_R (B,3,3), D (B,22,3,3) delta rotations (D[:,0] unused)."""
        n = len(FIT_BONES)
        GR, Gt = [None] * n, [None] * n
        GR[0], Gt[0] = pelvis_R, pelvis_t
        for j in range(1, n):
            p = self.parent[j]
            GR[j] = GR[p] @ self.rest_R[j] @ D[:, j]
            Gt[j] = Gt[p] + (GR[p] @ self.rest_t[j][:, None])[..., 0]
        GR, Gt = torch.stack(GR, 1), torch.stack(Gt, 1)
        mk = torch.stack([Gt[:, j] + (GR[:, j] @ off[:, None])[..., 0] for j, off in self.markers], 1)
        pts = {b: Gt[:, i] for i, b in enumerate(FIT_BONES)}
        pts['head_top'] = Gt[:, 5] + (GR[:, 5] @ self.head_top[:, None])[..., 0]
        return Gt, GR, mk, pts


class Camera(torch.nn.Module):
    def __init__(self, W, H, f=1700.0, pitch_deg=32.0, height=3.2):
        super().__init__()
        self.log_f = torch.nn.Parameter(torch.tensor(math.log(f)))
        self.c = torch.nn.Parameter(torch.tensor([W / 2.0, H / 2.0]))
        self.pitch = torch.nn.Parameter(torch.tensor(math.radians(pitch_deg)))
        self.roll = torch.nn.Parameter(torch.tensor(0.0))
        self.height = torch.nn.Parameter(torch.tensor(height))

    def basis(self):
        p, r = self.pitch, self.roll
        fwd = torch.stack([torch.zeros(()), -torch.sin(p), torch.cos(p)])
        right0 = torch.tensor([-1.0, 0.0, 0.0])
        down0 = torch.cross(fwd, right0, dim=0)
        right = right0 * torch.cos(r) + down0 * torch.sin(r)
        down = -right0 * torch.sin(r) + down0 * torch.cos(r)
        return torch.stack([right, down, fwd])          # rows: camera x, y, z in world

    def center(self):
        return torch.stack([torch.zeros(()), self.height, torch.zeros(())])

    def project(self, X):
        R = self.basis()
        Xc = (X - self.center()) @ R.T
        z = Xc[..., 2].clamp_min(0.2)
        f = torch.exp(self.log_f)
        return torch.stack([f * Xc[..., 0] / z + self.c[0], f * Xc[..., 1] / z + self.c[1]], -1), Xc[..., 2]

    def backproject_to_height(self, uv, y):
        """World point on the horizontal plane at height y seen at pixel uv (numpy)."""
        with torch.no_grad():
            R = self.basis().numpy()
            f = float(torch.exp(self.log_f))
            cx, cy = self.c.numpy()
            ray = R.T @ np.array([(uv[0] - cx) / f, (uv[1] - cy) / f, 1.0])
            C = self.center().numpy()
            s = (y - C[1]) / ray[1]
            return C + s * ray


class Track(torch.nn.Module):
    """Per-frame parameters of one athlete."""

    def __init__(self, F, pelvis_t0, pelvis_R0, D0=None):
        super().__init__()
        n = len(FIT_BONES)
        self.pelvis_t = torch.nn.Parameter(torch.tensor(pelvis_t0))
        self.pelvis_r6 = torch.nn.Parameter(torch.tensor(mat_to_sixd(pelvis_R0)))
        self.aa = torch.nn.Parameter(torch.zeros(F, n, 3) if D0 is None else torch.tensor(D0))
        # hinge: [flexion, twist] for calf_l, calf_r, lowerarm_l, lowerarm_r
        self.hinge = torch.nn.Parameter(torch.tensor([[0.15, 0.0]] * 4).repeat(F, 1, 1) * 1.0)

    def deltas(self):
        F, n = self.aa.shape[:2]
        D = axis_angle(self.aa)
        hinge_bones = [FIT_BONES.index(b) for b in ('calf_l', 'calf_r', 'lowerarm_l', 'lowerarm_r')]
        Ds = list(D.unbind(1))
        for k, j in enumerate(hinge_bones):
            Ds[j] = rot_x(self.hinge[:, k, 0]) @ rot_y(self.hinge[:, k, 1])
        return torch.stack(Ds, 1)


def robust(r2, c2=1.0):
    """Geman-McClure on squared normalised residual."""
    return r2 / (r2 + c2)


def fit(obs, rigs, args, log=print):
    F = obs['xy'].shape[0]
    W, H = float(obs['image_size'][0]), float(obs['image_size'][1])
    bodies = [Body(rigs[0]), Body(rigs[1])]
    cam = Camera(W, H, f=args.focal, pitch_deg=args.pitch, height=args.cam_height)
    if args.camera_json:
        cj = json.load(open(args.camera_json))['camera']
        with torch.no_grad():
            cam.log_f.fill_(math.log(cj['focal_px']))
            cam.c.copy_(torch.tensor(cj['principal_point_px']))
            cam.pitch.fill_(math.radians(cj['pitch_deg']))
            cam.roll.fill_(math.radians(cj['roll_deg']))
            cam.height.fill_(cj['height_m'])
        log(f"camera from {args.camera_json}: f {cj['focal_px']:.0f} pitch {cj['pitch_deg']:.1f} h {cj['height_m']:.2f}" + (' (fixed)' if args.fix_camera else ''))
    xy = torch.tensor(obs['xy'])                      # (F,2,19,2)
    sig = torch.tensor(obs['sigma'])                  # (F,2,19)  inf = missing
    w2d = torch.where(torch.isfinite(sig), 1.0 / sig.clamp_min(1.0) ** 2, torch.zeros_like(sig))
    valid = torch.isfinite(sig)
    xy = torch.where(valid[..., None], xy, torch.zeros_like(xy))
    lying = torch.tensor(obs['lying'])                # (F,2) 0..1
    foot_contact = torch.tensor(obs['foot_contact'])  # (F,2,2) 0..1, [left,right]
    facing = obs['facing_yaw']                        # (F,2) radians or nan, world yaw of chest normal
    clasp = torch.tensor(obs['clasp']) if 'clasp' in obs else torch.zeros(F)   # performer's hands locked at receiver's lower back
    ldir = torch.tensor(obs['lying_dir']) if 'lying_dir' in obs else torch.zeros(F, 2)  # +1 face up, -1 face down

    # ---- initialisation: pelvis on the ray through the observed hip midpoint
    tracks = []
    for p in range(2):
        t0 = np.zeros((F, 3))
        R0 = np.zeros((F, 3, 3))
        last = None
        for f in range(F):
            hips = [obs['xy'][f, p, MARKERS.index(m)] for m in ('l_hip', 'r_hip') if np.isfinite(obs['sigma'][f, p, MARKERS.index(m)])]
            if hips:
                uv = np.mean(hips, 0)
                h = 0.92 * (1 - obs['lying'][f, p]) + 0.18 * obs['lying'][f, p]
                last = cam.backproject_to_height(uv, h)
            t0[f] = last if last is not None else np.array([0, 0.9, 6.0])
            yaw = facing[f, p] if np.isfinite(facing[f, p]) else (math.pi if p == 0 else 0.0)
            # standing pelvis: rest pelvis orientation turned to face `yaw`
            R_rest = rigs[p].rest_globals()[1][rigs[p].index('pelvis')]
            R_role = quat_to_mat(rigs[p].role_rest_r)
            # rest facing of this rig in world: +Z for the defender rest, -Z for the attacker rest
            rest_fwd_yaw = 0.0 if p == 1 else math.pi
            dy = yaw - rest_fwd_yaw
            Ry = np.array([[math.cos(dy), 0, math.sin(dy)], [0, 1, 0], [-math.sin(dy), 0, math.cos(dy)]])
            R0[f] = Ry @ R_rest
            if obs['lying'][f, p] > 0.5:
                # lying: tip the standing frame 90 degrees about its left axis, back for face up,
                # forward for face down
                left = Ry @ (R_role @ np.array([1.0, 0, 0]))
                if 'lying_dir' in obs and obs['lying_dir'][f, p] < -0.2:
                    left = -left
                K = np.array([[0, -left[2], left[1]], [left[2], 0, -left[0]], [-left[1], left[0], 0]])
                Rt = np.eye(3) + K + K @ K   # 90 deg (sin=1, 1-cos=1)
                R0[f] = Rt @ R0[f]
        # start arms down (shoulders rotated ~75 deg toward the body) and knees slightly bent
        aa0 = np.zeros((F, len(FIT_BONES), 3))
        for side, sgn in (('l', 1), ('r', -1)):
            # upper arm local frame: world-up = local -X (left) / +X (right); rotate about local Z
            aa0[:, FIT_BONES.index(f'upperarm_{side}')] = [0, 0, -sgn * 1.25]
        tracks.append(Track(F, t0, R0, aa0))
        tracks[-1].hinge.data[:, :2, 0] = 0.25
        tracks[-1].hinge.data[:, 2:, 0] = 0.6

    params_cam = list(cam.parameters())
    floor_r = {'thigh_l': 0.08, 'thigh_r': 0.08, 'calf_l': 0.05, 'calf_r': 0.05, 'foot_l': 0.04, 'foot_r': 0.04,
               'ball_l': 0.02, 'ball_r': 0.02, 'pelvis': 0.10, 'spine_02': 0.11, 'neck_01': 0.08, 'head_top': 0.04,
               'Head': 0.09, 'upperarm_l': 0.06, 'upperarm_r': 0.06, 'lowerarm_l': 0.04, 'lowerarm_r': 0.04,
               'hand_l': 0.03, 'hand_r': 0.03}
    heel_i = [MARKERS.index('l_heel'), MARKERS.index('r_heel')]
    toe_i = [MARKERS.index('l_bigtoe'), MARKERS.index('r_bigtoe')]

    state = {'c2': 4.0}

    def energy(stage):
        E = {}
        mks, ptss, Gts = [], [], []
        for p in range(2):
            tr = tracks[p]
            D = tr.deltas()
            Gt, GR, mk, pts = bodies[p].fk(tr.pelvis_t, sixd_to_mat(tr.pelvis_r6), D)
            mks.append(mk); ptss.append(pts); Gts.append(Gt)
        # 2D
        e2 = 0.0
        for p in range(2):
            uv, z = cam.project(mks[p])
            r2 = ((uv - xy[:, p]) ** 2).sum(-1) * w2d[:, p]
            # Geman-McClure scaled by c2 so the loss stays ~quadratic near 0 at any annealing stage
            e2 = e2 + (state['c2'] * robust(r2, state['c2']) * valid[:, p]).sum() / 4.0
        E['2d'] = e2 * args.w_2d
        # floor
        ef = 0.0
        for p in range(2):
            for b, r in floor_r.items():
                ef = ef + torch.relu(r - ptss[p][b][:, 1]).pow(2).sum()
            ef = ef + torch.relu(0.0 - mks[p][:, heel_i + toe_i, 1]).pow(2).sum()
        E['floor'] = ef * args.w_floor
        # planted feet: heel/toe on the mat and not sliding
        ec = 0.0
        for p in range(2):
            for s in range(2):
                c = foot_contact[:, p, s]
                for mi in (heel_i[s], toe_i[s]):
                    y = mks[p][:, mi, 1]
                    ec = ec + (c * torch.relu(y - 0.03).pow(2)).sum()
                    v = mks[p][1:, mi, [0, 2]] - mks[p][:-1, mi, [0, 2]]
                    cc = c[1:] * c[:-1]
                    ec = ec + (cc * (v ** 2).sum(-1)).sum() * 4.0
        E['contact'] = ec * args.w_contact
        # interpenetration
        P = [torch.stack([ptss[p][a] for _, a, _, _ in CAPSULES], 1) for p in range(2)]
        Q = [torch.stack([ptss[p][b] for _, _, b, _ in CAPSULES], 1) for p in range(2)]
        rr = torch.tensor([r for *_, r in CAPSULES])
        d = seg_seg_dist(P[0][:, :, None], Q[0][:, :, None], P[1][:, None, :], Q[1][:, None, :])
        lim = rr[:, None] + rr[None, :] - args.squash
        E['pen'] = torch.relu(lim - d).pow(2).sum() * args.w_pen
        # joint limits and pose prior
        el, ep = 0.0, 0.0
        for p in range(2):
            tr = tracks[p]
            mag = torch.sqrt((tr.aa ** 2).sum(-1) + 1e-12)
            for b, lmt in LIMITS.items():
                j = FIT_BONES.index(b)
                el = el + torch.relu(mag[:, j] - lmt).pow(2).sum()
            for b in ('spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'clavicle_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r', 'hand_l', 'hand_r'):
                ep = ep + (mag[:, FIT_BONES.index(b)] ** 2).sum()
            flex, twist = tr.hinge[..., 0], tr.hinge[..., 1]
            el = el + torch.relu(-flex).pow(2).sum() * 10 + torch.relu(flex - 2.6).pow(2).sum() * 10
            el = el + torch.relu(twist.abs() - torch.tensor([0.25, 0.25, 1.3, 1.3])).pow(2).sum() * 10
        E['limits'] = el * args.w_limits
        E['prior'] = ep * args.w_prior
        # smoothness: acceleration of every point
        es = 0.0
        for p in range(2):
            Gt = Gts[p]
            acc = Gt[2:] - 2 * Gt[1:-1] + Gt[:-2]
            es = es + (acc ** 2).sum()
            m = mks[p]
            es = es + ((m[2:] - 2 * m[1:-1] + m[:-2]) ** 2).sum()
            # also on the orientation 6D and joint params (keeps twists calm where unobserved)
            a = tracks[p].aa
            es = es + 0.02 * ((a[2:] - 2 * a[1:-1] + a[:-2]) ** 2).sum()
            h = tracks[p].hinge
            es = es + 0.02 * ((h[2:] - 2 * h[1:-1] + h[:-2]) ** 2).sum()
            r6 = tracks[p].pelvis_r6
            es = es + 0.05 * ((r6[2:] - 2 * r6[1:-1] + r6[:-2]) ** 2).sum()
        E['smooth'] = es * args.w_smooth
        # hints: facing (weak), lying (pelvis height)
        eh = 0.0
        for p in range(2):
            Gt = Gts[p]
            yaw_t = torch.tensor(np.nan_to_num(facing[:, p], nan=0.0))
            has = torch.tensor(np.isfinite(facing[:, p]).astype(float))
            # chest normal = forward of spine_03 frame ~ world-forward of the pelvis frame
            GRp = sixd_to_mat(tracks[p].pelvis_r6)
            fwd_local = torch.tensor(bodies[p].rig.rest_globals()[1][bodies[p].rig.index('pelvis')].T @ np.array(
                [0.0, 0.0, 1.0 if p == 1 else -1.0]))
            fwd = (GRp @ fwd_local[:, None])[..., 0]
            target = torch.stack([torch.sin(yaw_t), torch.zeros_like(yaw_t), torch.cos(yaw_t)], -1)
            stand = 1 - lying[:, p]
            horiz = fwd * torch.tensor([1.0, 0.0, 1.0])
            cos = (horiz * target).sum(-1) / (torch.sqrt((horiz ** 2).sum(-1) + 1e-6))
            eh = eh + (has * stand * (1 - cos)).sum()
            eh = eh + (lying[:, p] * torch.relu(Gt[:, 0, 1] - 0.5).pow(2)).sum() * 20
            # face up / face down: the chest normal points up or down
            eh = eh + (lying[:, p] * ldir[:, p].abs() * torch.relu(0.4 - ldir[:, p].sign() * fwd[:, 1]).pow(2)).sum() * 5
        E['hints'] = eh * args.w_hints
        # gravity priors for athletes who are not lying or falling: at least one foot on the mat
        # (soft-min of heel/toe heights) and a torso within ~45 degrees of vertical
        eg = 0.0
        for p in range(2):
            stand = torch.clamp(1 - 2 * lying[:, p], 0, 1)
            feet_y = mks[p][:, heel_i + toe_i, 1]
            softmin = -0.02 * torch.logsumexp(-feet_y / 0.02, dim=1)
            eg = eg + (stand * torch.relu(softmin - 0.02).pow(2)).sum() * 50
            spine = Gts[p][:, FIT_BONES.index('neck_01')] - Gts[p][:, 0]
            cosv = spine[:, 1] / torch.sqrt((spine ** 2).sum(-1) + 1e-9)
            eg = eg + (stand * torch.relu(0.7 - cosv).pow(2)).sum() * 20
        E['gravity'] = eg * args.w_gravity
        # body lock: the performer's wrists together, at the receiver's lower back
        ek = 0.0
        if float(clasp.max()) > 0:
            wl, wr = ptss[0]['hand_l'], ptss[0]['hand_r']
            GRr = sixd_to_mat(tracks[1].pelvis_r6)
            fwd_local_r = torch.tensor(bodies[1].rig.rest_globals()[1][bodies[1].rig.index('pelvis')].T @ np.array([0.0, 0.0, 1.0]))
            fwd_r = (GRr @ fwd_local_r[:, None])[..., 0]
            back_pt = ptss[1]['spine_01'] - 0.14 * fwd_r
            mid = (wl + wr) / 2
            ek = (clasp * torch.relu(torch.sqrt(((wl - wr) ** 2).sum(-1) + 1e-9) - 0.10).pow(2)).sum()
            ek = ek + (clasp * torch.relu(torch.sqrt(((mid - back_pt) ** 2).sum(-1) + 1e-9) - 0.08).pow(2)).sum()
        E['clasp'] = ek * args.w_clasp
        # camera priors
        f = torch.exp(cam.log_f)
        ecam = (torch.relu(cam.roll.abs() - 0.1) ** 2) * 100 + ((cam.c - torch.tensor([W / 2, H / 2])) / 400.0).pow(2).sum()
        ecam = ecam + torch.relu(0.8 - cam.height) ** 2 * 100 + torch.relu(cam.pitch - 1.2) ** 2 * 100
        E['cam'] = ecam * args.w_cam
        return E

    def run(stage, iters, lr, train, anneal=(4.0, 4.0)):
        for t in tracks:
            for prm in t.parameters():
                prm.requires_grad_(False)
        if args.fix_camera:
            train = set(train) - {'cam'}
        for prm in params_cam:
            prm.requires_grad_('cam' in train)
        groups = []
        if 'cam' in train:
            groups.append({'params': params_cam, 'lr': lr * 0.5})
        for t in tracks:
            if 'root' in train:
                t.pelvis_t.requires_grad_(True); t.pelvis_r6.requires_grad_(True)
                groups.append({'params': [t.pelvis_t, t.pelvis_r6], 'lr': lr})
            if 'pose' in train:
                t.aa.requires_grad_(True); t.hinge.requires_grad_(True)
                groups.append({'params': [t.aa, t.hinge], 'lr': lr})
        opt = torch.optim.Adam(groups)
        c2_start, c2_end = anneal
        for it in range(iters):
            # anneal the robust scale: far observations pull at first, outliers lose weight later
            state['c2'] = float(c2_start * (c2_end / c2_start) ** (it / max(1, iters - 1)))
            opt.zero_grad()
            E = energy(stage)
            tot = sum(E.values())
            tot.backward()
            opt.step()
            if it % max(1, iters // 5) == 0 or it == iters - 1:
                log(f'[{stage}] it {it:5d} total {float(tot):12.2f} ' + ' '.join(f'{k} {float(v):10.2f}' for k, v in E.items())
                    + f' | f {float(torch.exp(cam.log_f)):.0f} pitch {math.degrees(float(cam.pitch)):.1f} h {float(cam.height):.2f}')

    run('roots+camera', args.iters_root, 0.02, {'cam', 'root'}, anneal=(400.0, 100.0))
    run('all', args.iters_all, 0.01, {'cam', 'root', 'pose'}, anneal=(400.0, 6.0))
    run('polish', args.iters_polish, 0.003, {'root', 'pose'}, anneal=(6.0, 4.0))
    return cam, tracks, bodies


def residual_report(obs, cam, tracks, bodies):
    out = []
    with torch.no_grad():
        for p in range(2):
            tr = tracks[p]
            _, _, mk, _ = bodies[p].fk(tr.pelvis_t, sixd_to_mat(tr.pelvis_r6), tr.deltas())
            uv, _ = cam.project(mk)
            err = torch.sqrt(((uv - torch.tensor(obs['xy'][:, p])) ** 2).sum(-1)).numpy()
            v = np.isfinite(obs['sigma'][:, p])
            err[~v] = np.nan
            out.append(err)
    return np.stack(out, 1)   # (F,2,19)


def to_motion(obs, cam, tracks, bodies, rigs, template, frames, fps=30.0):
    """Convert the fit to the GLB motion contract, re-centred so the pair stands around the origin
    with the performer->receiver line along -Z at the first frame (as in the templates)."""
    g, binary = template
    with torch.no_grad():
        res = []
        for p in range(2):
            tr = tracks[p]
            Gt, GR, _, _ = bodies[p].fk(tr.pelvis_t, sixd_to_mat(tr.pelvis_r6), tr.deltas())
            res.append((Gt.numpy(), GR.numpy(), tr.deltas().numpy()))
    # world -> pair transform
    pe0, re0 = res[0][0][0, 0], res[1][0][0, 0]
    d = re0 - pe0
    yaw = math.atan2(d[0], d[2])          # current heading of performer->receiver
    a = math.pi - yaw                     # rotate so the heading becomes -Z
    Rw = np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])
    mid = (pe0 + re0) / 2
    shift = -Rw @ np.array([mid[0], 0.0, mid[2]])

    def xf(p):
        return p @ Rw.T + shift

    motion = {'fps': np.float64(fps), 'times': (np.arange(len(frames)) + 1) / fps, 'source_frames': np.array(frames)}
    first = accessor(g, binary, g['animations'][0]['samplers'][0]['input']) if g.get('animations') else None
    for p, role in enumerate(('JQ_Attacker', 'JQ_Defender')):
        rig = rigs[p]
        Gt, GR, D = res[p]
        F = Gt.shape[0]
        J = len(rig.joint_names)
        # local rotations: start from rest, fill fitted bones
        local = np.repeat(rig.rest_r[None], F, 0).astype(np.float64)
        # fingers: hold the template's first animation key (ready hands) if available
        if g.get('animations'):
            an = g['animations'][0]
            names = [n.get('name') for n in g['nodes']]
            for ch in an['channels']:
                node = ch['target']['node']
                if ch['target']['path'] == 'rotation' and node in list(rig.node_index):
                    j = list(rig.node_index).index(node)
                    if rig.joint_names[j] not in FIT_BONES:
                        local[:, j] = accessor(g, binary, an['samplers'][ch['sampler']]['output'])[0]
        R_role = quat_to_mat(rig.role_rest_r)
        root = rig.index('root')
        R_root_g = R_role @ quat_to_mat(rig.rest_r[root])
        # pelvis global in pair space
        GRp = np.einsum('ab,fbc->fac', Rw, GR[:, 0])
        Gtp = xf(Gt[:, 0])
        local[:, rig.index('pelvis')] = mat_to_quat(np.einsum('ab,fbc->fac', R_root_g.T, GRp))
        for i, b in enumerate(FIT_BONES[1:], start=1):
            j = rig.index(b)
            local[:, j] = mat_to_quat(np.einsum('ab,fbc->fac', quat_to_mat(rig.rest_r[j]), D[:, i]))
        # All travel rides on the pelvis (as in motion capture), so an Unreal retarget of the skeleton
        # alone keeps it. The role node stays at its rest transform for the whole clip.
        joint_t = np.repeat(rig.rest_t[None], F, 0).astype(np.float64)
        R_root_l = quat_to_mat(rig.rest_r[root])
        joint_t[:, rig.index('pelvis')] = np.einsum('ab,fb->fa', R_root_l.T,
                                                    np.einsum('ab,fb->fa', R_role.T, Gtp - rig.role_rest_t[None]) - rig.rest_t[root][None])
        motion[f'{role}__node_translation'] = np.repeat(rig.role_rest_t[None], F, 0)
        motion[f'{role}__node_rotation'] = np.repeat(rig.role_rest_r[None], F, 0)
        motion[f'{role}__joint_names'] = np.array(rig.joint_names)
        motion[f'{role}__joint_rotation'] = make_quat_continuous(local)
        motion[f'{role}__joint_translation'] = joint_t
    camera = {
        'world_to_pair': {'R': Rw.tolist(), 't': shift.tolist()},
        'focal_px': float(torch.exp(cam.log_f)), 'principal_point_px': cam.c.detach().numpy().tolist(),
        'image_size': [float(x) for x in obs['image_size']],
        'pitch_deg': math.degrees(float(cam.pitch)), 'roll_deg': math.degrees(float(cam.roll)),
        'height_m': float(cam.height),
    }
    C = cam.center().detach().numpy()
    Rc = cam.basis().detach().numpy()
    camera['pair_space'] = {'position': xf(C[None])[0].tolist(),
                            'forward': (Rw @ Rc[2]).tolist(), 'up': (Rw @ -Rc[1]).tolist(),
                            'vertical_fov_deg': math.degrees(2 * math.atan(obs['image_size'][1] / 2 / float(torch.exp(cam.log_f))))}
    return motion, camera


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--obs', required=True)
    ap.add_argument('--template', default=os.path.join(os.path.dirname(__file__), '../../public/animations/bjj/double_leg.glb'))
    ap.add_argument('--out', required=True, help='output directory')
    ap.add_argument('--focal', type=float, default=1700.0)
    ap.add_argument('--pitch', type=float, default=32.0)
    ap.add_argument('--cam-height', type=float, default=3.2)
    ap.add_argument('--iters-root', type=int, default=600)
    ap.add_argument('--iters-all', type=int, default=2500)
    ap.add_argument('--iters-polish', type=int, default=800)
    ap.add_argument('--w-2d', type=float, default=1.0)
    ap.add_argument('--w-floor', type=float, default=2000.0)
    ap.add_argument('--w-contact', type=float, default=400.0)
    ap.add_argument('--w-pen', type=float, default=3000.0)
    ap.add_argument('--w-limits', type=float, default=50.0)
    ap.add_argument('--w-prior', type=float, default=0.5)
    ap.add_argument('--w-smooth', type=float, default=60.0)
    ap.add_argument('--w-hints', type=float, default=2.0)
    ap.add_argument('--w-cam', type=float, default=10.0)
    ap.add_argument('--w-gravity', type=float, default=20.0)
    ap.add_argument('--w-clasp', type=float, default=500.0)
    ap.add_argument('--camera-json', default=None, help='fit.json of an earlier fit: start from its camera')
    ap.add_argument('--fix-camera', action='store_true', help='keep the camera from --camera-json fixed')
    ap.add_argument('--squash', type=float, default=0.03, help='allowed soft-tissue/cloth overlap per contact (m)')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    obs = dict(np.load(args.obs, allow_pickle=False))
    g, b = read_glb(args.template)
    rigs = []
    for role in ('JQ_Attacker', 'JQ_Defender'):
        r = load_rig(g, b, role)
        measure_markers(g, b, r)
        rigs.append(r)
    logf = open(os.path.join(args.out, 'fit.log'), 'w')

    def log(s):
        print(s, flush=True)
        logf.write(s + '\n')
    cam, tracks, bodies = fit(obs, rigs, args, log)
    err = residual_report(obs, cam, tracks, bodies)
    frames = [int(x) for x in obs['frames']]
    motion, camera = to_motion(obs, cam, tracks, bodies, rigs, (g, b), frames)
    np.savez(os.path.join(args.out, 'motion.npz'), **motion)
    stats = {'median_px': [float(np.nanmedian(err[:, p])) for p in range(2)],
             'p90_px': [float(np.nanpercentile(err[:, p], 90)) for p in range(2)],
             'per_frame_median_px': [[None if np.all(np.isnan(err[f, p])) else float(np.nanmedian(err[f, p])) for p in range(2)] for f in range(len(frames))]}
    json.dump({'camera': camera, 'residuals': stats, 'frames': frames, 'args': vars(args)},
              open(os.path.join(args.out, 'fit.json'), 'w'), indent=1)
    np.save(os.path.join(args.out, 'residual_px.npy'), err)
    with torch.no_grad():
        world = []
        for p in range(2):
            _, _, mk, _ = bodies[p].fk(tracks[p].pelvis_t, sixd_to_mat(tracks[p].pelvis_r6), tracks[p].deltas())
            uv, _ = cam.project(mk)
            world.append(uv.numpy())
    np.save(os.path.join(args.out, 'reprojected_uv.npy'), np.stack(world, 1))
    log(f"residual median px performer {stats['median_px'][0]:.1f} receiver {stats['median_px'][1]:.1f}")


if __name__ == '__main__':
    main()
