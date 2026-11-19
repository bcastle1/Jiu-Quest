"""The JiuQuest athlete rig, read from a paired choreography GLB.

A paired GLB (public/animations/bjj/*.glb) holds two athletes, JQ_Attacker (the
performer) and JQ_Defender, each a 65-joint skin on the Quaternius rest rig with
Unreal-mannequin joint names (pelvis, spine_01..03, neck_01, Head, clavicle_l,
upperarm_l, ..., ball_l). Each athlete hangs under JQ_Pair as

    JQ_Pair -> JQ_<Role> -> JQ_<Role>_Rig -> root -> pelvis -> ...

Every joint's local +Y axis points along its bone (Blender convention), and a
child joint sits at (0, length, 0) in its parent's frame.

This module reads that hierarchy and its rest pose, and gives forward
kinematics in NumPy and PyTorch, plus surface markers (nose, ears, heels, toes)
measured on the athlete's rest mesh, so 2D keypoints from a video can be
compared with the rig. Standard library and NumPy only; PyTorch is imported
lazily by the torch helpers.
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field

import numpy as np

COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
DTYPES = {5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1", 5122: "<i2", 5120: "i1"}


def read_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()
    magic, version, length = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67 and version == 2, "not a glTF 2.0 binary"
    json_len, json_type = struct.unpack("<II", data[12:20])
    assert json_type == 0x4E4F534A
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len
    bin_len, bin_type = struct.unpack("<II", data[bin_start:bin_start + 8])
    assert bin_type == 0x004E4942
    return gltf, data[bin_start + 8:bin_start + 8 + bin_len]


def accessor(gltf, binary, index):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    n = COMPONENTS[acc["type"]]
    dtype = np.dtype(DTYPES[acc["componentType"]])
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", 0)
    if stride and stride != n * dtype.itemsize:
        rows = [np.frombuffer(binary, dtype, n, start + i * stride) for i in range(acc["count"])]
        out = np.stack(rows)
    else:
        out = np.frombuffer(binary, dtype, acc["count"] * n, start).reshape(acc["count"], n)
    if acc.get("normalized"):
        out = out.astype(np.float32) / np.iinfo(dtype).max
    return out


# ---------------------------------------------------------------- quaternions (x, y, z, w)

def quat_to_mat(q):
    q = np.asarray(q, dtype=np.float64)
    q = q / np.linalg.norm(q, axis=-1, keepdims=True)
    x, y, z, w = q[..., 0], q[..., 1], q[..., 2], q[..., 3]
    m = np.empty(q.shape[:-1] + (3, 3))
    m[..., 0, 0] = 1 - 2 * (y * y + z * z)
    m[..., 0, 1] = 2 * (x * y - z * w)
    m[..., 0, 2] = 2 * (x * z + y * w)
    m[..., 1, 0] = 2 * (x * y + z * w)
    m[..., 1, 1] = 1 - 2 * (x * x + z * z)
    m[..., 1, 2] = 2 * (y * z - x * w)
    m[..., 2, 0] = 2 * (x * z - y * w)
    m[..., 2, 1] = 2 * (y * z + x * w)
    m[..., 2, 2] = 1 - 2 * (x * x + y * y)
    return m


def mat_to_quat(m):
    m = np.asarray(m, dtype=np.float64)
    shape = m.shape[:-2]
    m = m.reshape(-1, 3, 3)
    q = np.empty((m.shape[0], 4))
    for i, r in enumerate(m):
        t = np.trace(r)
        if t > 0:
            s = np.sqrt(t + 1.0) * 2
            q[i] = [(r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s, 0.25 * s]
        elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
            s = np.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
            q[i] = [0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s, (r[2, 1] - r[1, 2]) / s]
        elif r[1, 1] > r[2, 2]:
            s = np.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
            q[i] = [(r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s, (r[0, 2] - r[2, 0]) / s]
        else:
            s = np.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
            q[i] = [(r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s, (r[1, 0] - r[0, 1]) / s]
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    return q.reshape(shape + (4,))


def make_quat_continuous(q):
    """Flip signs along axis 0 so consecutive quaternions stay in one hemisphere."""
    q = np.array(q, dtype=np.float64, copy=True)
    for i in range(1, q.shape[0]):
        dots = np.sum(q[i] * q[i - 1], axis=-1)
        q[i][dots < 0] *= -1
    return q


def node_trs(node):
    t = np.array(node.get("translation", [0.0, 0.0, 0.0]), dtype=np.float64)
    r = np.array(node.get("rotation", [0.0, 0.0, 0.0, 1.0]), dtype=np.float64)
    s = np.array(node.get("scale", [1.0, 1.0, 1.0]), dtype=np.float64)
    if "matrix" in node:
        raise ValueError(f"node {node.get('name')} uses a matrix; expected TRS")
    return t, r, s


# ---------------------------------------------------------------- the rig

# Surface markers: name -> (joint, how it is measured on the rest mesh). Joint
# centres (shoulders, elbows, wrists, hips, knees, ankles) are joint heads and
# need no mesh.
JOINT_MARKERS = {
    "l_shoulder": "upperarm_l", "r_shoulder": "upperarm_r",
    "l_elbow": "lowerarm_l", "r_elbow": "lowerarm_r",
    "l_wrist": "hand_l", "r_wrist": "hand_r",
    "l_hip": "thigh_l", "r_hip": "thigh_r",
    "l_knee": "calf_l", "r_knee": "calf_r",
    "l_ankle": "foot_l", "r_ankle": "foot_r",
}


@dataclass
class Rig:
    role: str
    joint_names: list
    parents: np.ndarray            # (J,) parent index within the joint list, -1 for `root`
    node_index: np.ndarray         # (J,) glTF node index of each joint
    rest_t: np.ndarray             # (J,3) local translation
    rest_r: np.ndarray             # (J,4) local rotation, xyzw
    rest_s: np.ndarray             # (J,3) local scale
    role_node: int                 # glTF node JQ_<Role>
    role_rest_t: np.ndarray
    role_rest_r: np.ndarray
    rig_node: int                  # glTF node JQ_<Role>_Rig (identity in every published GLB)
    inverse_bind: np.ndarray       # (J,4,4)
    markers: dict = field(default_factory=dict)   # name -> (joint index, local offset (3,))

    def index(self, name):
        return self.joint_names.index(name)

    # ---- numpy forward kinematics (all transforms rigid; scales are 1 in the published rigs)
    def fk(self, role_t, role_r, local_r, local_t=None):
        """role_t (F,3), role_r (F,4 xyzw), local_r (F,J,4 xyzw) -> global joint positions (F,J,3)
        and rotation matrices (F,J,3,3) in JQ_Pair space."""
        role_t = np.atleast_2d(role_t)
        F = role_t.shape[0]
        J = len(self.joint_names)
        if local_t is None:
            local_t = np.broadcast_to(self.rest_t, (F, J, 3))
        R_role = quat_to_mat(role_r).reshape(F, 3, 3)
        R_local = quat_to_mat(local_r).reshape(F, J, 3, 3)
        G_R = np.empty((F, J, 3, 3))
        G_t = np.empty((F, J, 3))
        for j in range(J):
            p = self.parents[j]
            if p < 0:
                PR, Pt = R_role, role_t
            else:
                PR, Pt = G_R[:, p], G_t[:, p]
            G_R[:, j] = PR @ R_local[:, j]
            G_t[:, j] = Pt + np.einsum("fab,fb->fa", PR, local_t[:, j])
        return G_t, G_R

    def rest_globals(self):
        G_t, G_R = self.fk(self.role_rest_t[None], self.role_rest_r[None], self.rest_r[None])
        return G_t[0], G_R[0]

    def marker_positions(self, G_t, G_R):
        """Global positions (F,M,3) of `self.markers`, in their insertion order."""
        out = []
        for name, (j, off) in self.markers.items():
            out.append(G_t[:, j] + np.einsum("fab,b->fa", G_R[:, j], off))
        return np.stack(out, axis=1)


def load_rig(gltf, binary, role="JQ_Attacker"):
    names = [n.get("name") for n in gltf["nodes"]]
    role_node = names.index(role)
    rig_node = names.index(role + "_Rig")
    skin_index = None
    for ni, node in enumerate(gltf["nodes"]):
        if node.get("name") == role + "_Body" and "skin" in node:
            skin_index = node["skin"]
    if skin_index is None:
        raise ValueError(f"no skinned {role}_Body")
    skin = gltf["skins"][skin_index]
    joints = list(skin["joints"])
    parent_of = {}
    for ni, node in enumerate(gltf["nodes"]):
        for c in node.get("children", []):
            parent_of[c] = ni
    parents = []
    for ni in joints:
        p = parent_of.get(ni)
        parents.append(joints.index(p) if p in joints else -1)
    assert parents.count(-1) == 1 and names[joints[parents.index(-1)]] == "root"
    assert parent_of[joints[parents.index(-1)]] == rig_node and parent_of[rig_node] == role_node
    t_r_s = [node_trs(gltf["nodes"][ni]) for ni in joints]
    rt, rr, rs = node_trs(gltf["nodes"][role_node])
    rig_t, rig_r, rig_s = node_trs(gltf["nodes"][rig_node])
    if np.abs(rig_t).max() > 1e-9 or np.abs(rig_r - [0, 0, 0, 1]).max() > 1e-9 or np.abs(rig_s - 1).max() > 1e-9:
        raise ValueError(f"{role}_Rig must have an identity transform")
    ibm = accessor(gltf, binary, skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    rig = Rig(role=role, joint_names=[names[n] for n in joints], parents=np.array(parents),
              node_index=np.array(joints), rest_t=np.array([x[0] for x in t_r_s]),
              rest_r=np.array([x[1] for x in t_r_s]), rest_s=np.array([x[2] for x in t_r_s]),
              role_node=role_node, role_rest_t=rt, role_rest_r=rr, rig_node=rig_node, inverse_bind=ibm)
    return rig


def bind_pose_error(rig):
    """Max |G_bind @ inverse_bind - I| over joints. The published meshes were bound with
    JQ_<Role> at its rest transform (glTF ignores a skinned mesh node's own transform), so
    this checks the joint list, the hierarchy and FK together."""
    G_t, G_R = rig.fk(rig.role_rest_t[None], rig.role_rest_r[None], rig.rest_r[None])
    err = 0.0
    for j in range(len(rig.joint_names)):
        M = np.eye(4)
        M[:3, :3] = G_R[0, j]
        M[:3, 3] = G_t[0, j]
        err = max(err, np.abs(M @ rig.inverse_bind[j] - np.eye(4)).max())
    return err


def skinned_rest_vertices(gltf, binary, role):
    """Bind-pose positions (V,3) of JQ_<Role>_Body (scene space, JQ_<Role> at its rest
    transform), plus the joint index of each vertex's strongest influence."""
    for node in gltf["nodes"]:
        if node.get("name") == role + "_Body":
            mesh = gltf["meshes"][node["mesh"]]
            break
    pos, dom = [], []
    for prim in mesh["primitives"]:
        a = prim["attributes"]
        pos.append(accessor(gltf, binary, a["POSITION"]).astype(np.float64))
        jn = accessor(gltf, binary, a["JOINTS_0"]).astype(int)
        wt = accessor(gltf, binary, a["WEIGHTS_0"]).astype(np.float64)
        dom.append(jn[np.arange(len(jn)), wt.argmax(1)])
    return np.concatenate(pos), np.concatenate(dom)


def measure_markers(gltf, binary, rig):
    """Add surface markers measured on the rest mesh: nose, ears, heels and big toes. Offsets are
    stored in the frame of the joint they ride on."""
    V, dom = skinned_rest_vertices(gltf, binary, rig.role)
    G_t, G_R = rig.rest_globals()
    up = np.array([0.0, 1.0, 0.0])
    # forward: the direction the feet point (heel -> toe), projected on the floor.
    fwd = G_t[rig.index("ball_l")] - G_t[rig.index("foot_l")]
    fwd[1] = 0
    fwd /= np.linalg.norm(fwd)
    left = np.cross(up, fwd)   # athlete's left in a right-handed Y-up frame
    if np.dot(G_t[rig.index("thigh_l")] - G_t[rig.index("pelvis")], left) < 0:
        left = -left
    markers = {}
    for name, joint in JOINT_MARKERS.items():
        markers[name] = (rig.index(joint), np.zeros(3))
    head = rig.index("Head")
    hv = V[dom == head]
    if len(hv) == 0:
        hv = V[np.linalg.norm(V - G_t[head], axis=1) < 0.15]
    head_c = G_t[head]
    # nose: the most forward head vertex within 6 cm of the head's mid-sagittal plane, below the eyes
    side = (hv - head_c) @ left
    mid = hv[np.abs(side) < 0.02]
    nose = mid[np.argmax((mid - head_c) @ fwd)]
    # ears: most lateral head vertices near the height of the nose
    near = hv[np.abs((hv - nose) @ up) < 0.04]
    l_ear = near[np.argmax((near - head_c) @ left)]
    r_ear = near[np.argmin((near - head_c) @ left)]
    def local(j, p):
        return G_R[j].T @ (p - G_t[j])
    markers["nose"] = (head, local(head, nose))
    markers["l_ear"] = (head, local(head, l_ear))
    markers["r_ear"] = (head, local(head, r_ear))
    for s in "lr":
        foot = rig.index(f"foot_{s}")
        fv = V[np.isin(dom, [foot, rig.index(f"ball_{s}")])]
        heel = fv[np.argmin((fv - G_t[foot]) @ fwd + 0.5 * ((fv - G_t[foot]) @ up))]
        toe_side = 1 if s == "l" else -1
        # big toe: the most forward foot vertex on the inner (medial) half of the foot
        medial = fv[((fv - G_t[foot]) @ left) * toe_side < 0.0]
        bigtoe = (medial if len(medial) else fv)[np.argmax(((medial if len(medial) else fv) - G_t[foot]) @ fwd)]
        markers[f"{s}_heel"] = (foot, local(foot, heel))
        markers[f"{s}_bigtoe"] = (foot, local(foot, bigtoe))
    rig.markers = markers
    return markers


# ---------------------------------------------------------------- torch helpers

def torch_rotmat_from_6d(x):
    import torch
    a1, a2 = x[..., :3], x[..., 3:]
    b1 = torch.nn.functional.normalize(a1, dim=-1)
    b2 = torch.nn.functional.normalize(a2 - (b1 * a2).sum(-1, keepdim=True) * b1, dim=-1)
    b3 = torch.cross(b1, b2, dim=-1)
    return torch.stack((b1, b2, b3), dim=-1)


def torch_axis_angle_to_mat(v):
    import torch
    theta = torch.linalg.norm(v, dim=-1, keepdim=True).clamp_min(1e-8)
    k = v / theta
    K = torch.zeros(v.shape[:-1] + (3, 3), dtype=v.dtype, device=v.device)
    K[..., 0, 1], K[..., 0, 2] = -k[..., 2], k[..., 1]
    K[..., 1, 0], K[..., 1, 2] = k[..., 2], -k[..., 0]
    K[..., 2, 0], K[..., 2, 1] = -k[..., 1], k[..., 0]
    s = torch.sin(theta)[..., None]
    c = torch.cos(theta)[..., None]
    I = torch.eye(3, dtype=v.dtype, device=v.device).expand(K.shape)
    return I + s * K + (1 - c) * (K @ K)


class TorchFK:
    """Batched FK for one rig: global positions/rotations from the role node transform and a
    rotation delta per joint, applied on top of the rest local rotation (R_local = R_rest @ D)."""

    def __init__(self, rig, dtype=None):
        import torch
        self.torch = torch
        dtype = dtype or torch.float64
        self.rig = rig
        self.parents = [int(p) for p in rig.parents]
        self.rest_R = torch.tensor(quat_to_mat(rig.rest_r), dtype=dtype)
        self.rest_t = torch.tensor(rig.rest_t, dtype=dtype)
        self.dtype = dtype

    def __call__(self, role_t, role_R, delta_R):
        """role_t (B,3), role_R (B,3,3), delta_R (B,J,3,3) -> (B,J,3), (B,J,3,3)."""
        torch = self.torch
        B, J = delta_R.shape[:2]
        local_R = self.rest_R[None] @ delta_R
        Gs_R, Gs_t = [None] * J, [None] * J
        for j in range(J):
            p = self.parents[j]
            PR, Pt = (role_R, role_t) if p < 0 else (Gs_R[p], Gs_t[p])
            Gs_R[j] = PR @ local_R[:, j]
            Gs_t[j] = Pt + (PR @ self.rest_t[j][:, None])[..., 0]
        return torch.stack(Gs_t, 1), torch.stack(Gs_R, 1)
