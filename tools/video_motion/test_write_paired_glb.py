"""Contracts of write_paired_glb.py on the published paired templates.

Run from the repository root (system python3; standard library and NumPy only):

    python3 -m unittest tools/video_motion/test_write_paired_glb.py

1. Round trip: double_leg's own motion, written and read back, gives every animated node
   the same translation, rotation and scale at every key, and everything but the animation
   is copied: the JSON of nodes, meshes, skins, materials, textures and images, and the
   bytes of every image, vertex attribute, index and inverse bind matrix.
2. A synthetic edit (the attacker's head turned 30 degrees about its local X, the attacker
   moved 0.5 m along X) is written, read back and shows in forward kinematics of the rig.
3. Malformed motion (wrong joint order, NaN, times that do not increase, ...) is refused
   before anything is written.
"""
import hashlib
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import rig  # noqa: E402
import write_paired_glb as writer  # noqa: E402

TEMPLATES = HERE.parents[1] / "public" / "animations" / "bjj"
TEMPLATE = TEMPLATES / "double_leg.glb"
ROLES = writer.ROLES
# The templates' constant scale keys hold the rest scale 1.0 with up to 1.37e-6 of float32
# export noise (double_leg: 1.07e-6). The writer writes the rest scale itself, so scale is
# compared exactly against the rest value and within this bound against the template.
TEMPLATE_SCALE_NOISE = 2e-6


def quat_error(a, b):
    """Largest component difference between two quaternion arrays, up to sign per quaternion
    (q and -q are the same rotation)."""
    return float(np.minimum(np.abs(a - b).max(-1), np.abs(a + b).max(-1)).max())


def forward(r, motion, role):
    return r.fk(motion[f"{role}__node_translation"], motion[f"{role}__node_rotation"],
                motion[f"{role}__joint_rotation"], motion[f"{role}__joint_translation"])


def view_bytes(gltf, binary, index):
    view = gltf["bufferViews"][index]
    start = view.get("byteOffset", 0)
    return binary[start:start + view["byteLength"]]


def accessor_bytes(gltf, binary, index):
    """The stored bytes of an accessor's elements."""
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    size = rig.COMPONENTS[acc["type"]] * np.dtype(rig.DTYPES[acc["componentType"]]).itemsize
    stride = view.get("byteStride") or size
    if stride == size:
        return binary[start:start + size * acc["count"]]
    return b"".join(binary[start + i * stride:start + i * stride + size] for i in range(acc["count"]))


def copied_parts(gltf, binary):
    """What the writer must copy, with every accessor and bufferView index replaced by what it
    points at (accessor JSON and a digest of its bytes), so that two files compare equal
    whatever order their accessors are in."""
    def resolve(index):
        acc = {k: v for k, v in gltf["accessors"][index].items() if k != "bufferView"}
        return [acc, hashlib.sha256(accessor_bytes(gltf, binary, index)).hexdigest()]

    parts = {k: gltf.get(k) for k in ("asset", "extensionsUsed", "extensionsRequired", "scene",
                                      "nodes", "materials", "textures", "samplers")}
    parts["scenes"] = [{k: v for k, v in s.items() if k != "extras"} for s in gltf["scenes"]]
    meshes = json.loads(json.dumps(gltf["meshes"]))
    for mesh in meshes:
        for prim in mesh["primitives"]:
            for table in [prim["attributes"]] + prim.get("targets", []):
                for name in table:
                    table[name] = resolve(table[name])
            if "indices" in prim:
                prim["indices"] = resolve(prim["indices"])
    parts["meshes"] = meshes
    skins = json.loads(json.dumps(gltf["skins"]))
    for skin in skins:
        skin["inverseBindMatrices"] = resolve(skin["inverseBindMatrices"])
    parts["skins"] = skins
    images = json.loads(json.dumps(gltf["images"]))
    for image in images:
        image["bufferView"] = hashlib.sha256(view_bytes(gltf, binary, image["bufferView"])).hexdigest()
    parts["images"] = images
    return parts


def shuffled_template(gltf, binary):
    """The template with its accessors and bufferViews in another order and its animation
    data at the start of the BIN chunk, so a writer must re-index and move every bufferView
    it keeps. In the published templates the animation comes last, and nothing moves. This
    is built independently of the writer."""
    g = json.loads(json.dumps(gltf))
    animated = sorted({i for s in g["animations"][0]["samplers"] for i in (s["input"], s["output"])})
    others = [i for i in range(len(g["accessors"])) if i not in set(animated)]
    accessor_order = animated + others[::-1]  # new index -> old index
    new_accessor = {old: new for new, old in enumerate(accessor_order)}
    view_order = list(range(len(g["bufferViews"])))[::-1]
    new_view = {old: new for new, old in enumerate(view_order)}
    animated_views = sorted({g["accessors"][i]["bufferView"] for i in animated})
    data, offsets = bytearray(), {}
    for v in animated_views + [v for v in range(len(g["bufferViews"])) if v not in animated_views]:
        data.extend(bytes(-len(data) % 4))
        offsets[v] = len(data)
        data.extend(view_bytes(gltf, binary, v))
    g["bufferViews"] = [dict(g["bufferViews"][old], byteOffset=offsets[old]) for old in view_order]
    g["accessors"] = [dict(g["accessors"][old], bufferView=new_view[g["accessors"][old]["bufferView"]])
                      for old in accessor_order]
    for image in g["images"]:
        image["bufferView"] = new_view[image["bufferView"]]
    for mesh in g["meshes"]:
        for prim in mesh["primitives"]:
            for table in [prim["attributes"]] + prim.get("targets", []):
                for name in table:
                    table[name] = new_accessor[table[name]]
            if "indices" in prim:
                prim["indices"] = new_accessor[prim["indices"]]
    for skin in g["skins"]:
        skin["inverseBindMatrices"] = new_accessor[skin["inverseBindMatrices"]]
    for sampler in g["animations"][0]["samplers"]:
        sampler["input"], sampler["output"] = new_accessor[sampler["input"]], new_accessor[sampler["output"]]
    g["buffers"][0]["byteLength"] = len(data)
    return g, bytes(data)


def pack_glb(gltf, data):
    text = json.dumps(gltf).encode("utf-8")
    text += b" " * (-len(text) % 4)
    data += bytes(-len(data) % 4)
    return b"".join((struct.pack("<III", 0x46546C67, 2, 28 + len(text) + len(data)),
                     struct.pack("<II", len(text), 0x4E4F534A), text,
                     struct.pack("<II", len(data), 0x004E4942), data))


class WritePairedGlbTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix="test_write_paired_glb-")
        cls.dir = Path(cls.scratch.name)
        cls.template = writer.read_glb(TEMPLATE)
        cls.rigs = {role: rig.load_rig(*cls.template, role) for role in ROLES}
        cls.motion = writer.read_motion_from_glb(TEMPLATE)
        cls.round_trip = cls.dir / "round_trip.glb"
        cls.summary = writer.write_paired_glb(TEMPLATE, cls.motion, cls.round_trip)
        cls.output = writer.read_glb(cls.round_trip)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def copy_motion(self):
        return {k: np.array(v, copy=True) for k, v in self.motion.items()}

    # ------------------------------------------------------------ 1. round trip

    def test_template_motion_reads_on_the_30_fps_grid(self):
        m = self.motion
        self.assertEqual(float(m["fps"]), 30.0)
        self.assertEqual(len(m["times"]), 126)
        np.testing.assert_allclose(m["times"], np.arange(1, 127) / 30.0, atol=1e-6)
        np.testing.assert_array_equal(m["source_frames"], np.arange(126))
        for role in ROLES:
            self.assertEqual(list(m[f"{role}__joint_names"]), self.rigs[role].joint_names)
            self.assertEqual(m[f"{role}__joint_rotation"].shape, (126, 65, 4))

    def test_round_trip_reproduces_every_node_trs_at_every_key(self):
        times0, trs0 = writer.sample_animation(*self.template)
        times1, trs1 = writer.sample_animation(*self.output)
        np.testing.assert_array_equal(times1, times0)  # float32 key times survive exactly
        self.assertEqual(len(trs0), 132)
        self.assertEqual(sorted(trs1), sorted(trs0))
        names = [n["name"] for n in self.template[0]["nodes"]]
        worst = {"translation": (0.0, ""), "rotation": (0.0, ""), "scale": (0.0, "")}
        for node in trs0:
            self.assertEqual(sorted(trs1[node]), ["rotation", "scale", "translation"])
            errors = {"translation": np.abs(trs1[node]["translation"] - trs0[node]["translation"]).max(),
                      "rotation": quat_error(trs1[node]["rotation"], trs0[node]["rotation"]),
                      "scale": np.abs(trs1[node]["scale"] - trs0[node]["scale"]).max()}
            for path, error in errors.items():
                worst[path] = max(worst[path], (float(error), names[node]))
            rest_scale = rig.node_trs(self.template[0]["nodes"][node])[2]
            np.testing.assert_array_equal(trs1[node]["scale"], np.broadcast_to(rest_scale, (126, 3)))
        self.assertLessEqual(worst["translation"][0], 1e-6, worst)
        self.assertLessEqual(worst["rotation"][0], 1e-6, worst)
        self.assertLessEqual(worst["scale"][0], TEMPLATE_SCALE_NOISE, worst)

    def test_round_trip_reads_back_the_same_motion_and_pose(self):
        back = writer.read_motion_from_glb(self.round_trip)
        self.assertEqual(sorted(back), sorted(self.motion))
        for key, value in self.motion.items():
            with self.subTest(key=key):
                if key.endswith("joint_names"):
                    self.assertEqual(list(back[key]), list(value))
                elif key.endswith("rotation"):
                    self.assertLessEqual(quat_error(back[key], value), 1e-6)
                else:
                    self.assertLessEqual(np.abs(back[key] - value).max(), 1e-6)
        for role in ROLES:
            r = self.rigs[role]
            t0, R0 = forward(r, self.motion, role)
            t1, R1 = forward(r, back, role)
            self.assertLess(np.abs(t1 - t0).max(), 1e-5, role)  # metres
            self.assertLess(np.abs(R1 - R0).max(), 1e-5, role)

    def test_round_trip_copies_everything_but_the_animation(self):
        g0, b0 = self.template
        g1, b1 = self.output
        for key in ("nodes", "meshes", "materials", "images", "skins", "textures", "samplers"):
            self.assertEqual(len(g1[key]), len(g0[key]), key)
        self.assertEqual(copied_parts(g1, b1), copied_parts(g0, b0))
        for im0, im1 in zip(g0["images"], g1["images"]):
            self.assertEqual(view_bytes(g1, b1, im1["bufferView"]), view_bytes(g0, b0, im0["bufferView"]),
                             im0.get("name"))
        compared = 0
        for mesh0, mesh1 in zip(g0["meshes"], g1["meshes"]):
            for p0, p1 in zip(mesh0["primitives"], mesh1["primitives"]):
                pairs = [(p0["attributes"][k], p1["attributes"][k]) for k in p0["attributes"]]
                if "indices" in p0:
                    pairs.append((p0["indices"], p1["indices"]))
                for a0, a1 in pairs:
                    self.assertEqual(accessor_bytes(g1, b1, a1), accessor_bytes(g0, b0, a0), mesh0["name"])
                    compared += 1
        self.assertGreater(compared, 100)
        for s0, s1 in zip(g0["skins"], g1["skins"]):
            self.assertEqual(accessor_bytes(g1, b1, s1["inverseBindMatrices"]),
                             accessor_bytes(g0, b0, s0["inverseBindMatrices"]))
        # Scene extras: the template's keys are kept; the motion type and review status change.
        extras0, extras1 = g0["scenes"][0]["extras"], g1["scenes"][0]["extras"]
        for key, value in extras0.items():
            if key not in ("JQ_motion_type", "JQ_review_status"):
                self.assertEqual(extras1[key], value, key)
        self.assertEqual(extras1["JQ_motion_type"], "video-reference-fit")
        self.assertEqual(extras1["JQ_review_status"], writer.DEFAULT_REVIEW_STATUS)
        self.assertNotIn("JQ_source_note", extras1)

    def test_new_animation_shape(self):
        g0, g1 = self.template[0], self.output[0]
        self.assertEqual(len(g1["animations"]), 1)
        anim = g1["animations"][0]
        self.assertEqual(anim["name"], "Animation")
        self.assertEqual(len(anim["channels"]), 396)
        targets = [(c["target"]["node"], c["target"]["path"]) for c in anim["channels"]]
        template_targets = [(c["target"]["node"], c["target"]["path"]) for c in g0["animations"][0]["channels"]]
        self.assertEqual(len(set(targets)), 396)
        self.assertEqual(set(targets), set(template_targets))
        self.assertEqual({s["interpolation"] for s in anim["samplers"]}, {"LINEAR"})
        inputs = {s["input"] for s in anim["samplers"]}
        self.assertEqual(len(inputs), 1)
        times = g1["accessors"][inputs.pop()]
        stored = rig.accessor(g1, self.output[1], anim["samplers"][0]["input"])[:, 0]
        self.assertEqual((times["type"], times["componentType"], times["count"]), ("SCALAR", 5126, 126))
        self.assertEqual(times["min"], [float(stored.min())])
        self.assertEqual(times["max"], [float(stored.max())])
        for sampler in anim["samplers"]:
            acc = g1["accessors"][sampler["output"]]
            self.assertEqual((acc["componentType"], acc["count"]), (5126, 126))
        # Every quaternion is a unit quaternion, and none flips hemisphere between keys.
        for channel in anim["channels"]:
            if channel["target"]["path"] == "rotation":
                q = rig.accessor(g1, self.output[1], anim["samplers"][channel["sampler"]]["output"])
                q = q.astype(np.float64)
                self.assertLess(np.abs(np.linalg.norm(q, axis=1) - 1).max(), 1e-6)
                self.assertTrue((np.sum(q[1:] * q[:-1], axis=1) >= 0).all())

    def test_glb_container_is_padded_and_aligned(self):
        data = self.round_trip.read_bytes()
        self.assertEqual(struct.unpack_from("<III", data), (0x46546C67, 2, len(data)))
        json_length, json_type = struct.unpack_from("<II", data, 12)
        self.assertEqual(json_type, 0x4E4F534A)
        self.assertEqual(json_length % 4, 0)
        text = data[20:20 + json_length]
        body = text.rstrip(b" ")
        self.assertTrue(body.endswith(b"}"))
        self.assertLess(len(text) - len(body), 4)
        gltf = json.loads(text)
        bin_length, bin_type = struct.unpack_from("<II", data, 20 + json_length)
        self.assertEqual(bin_type, 0x004E4942)
        self.assertEqual(bin_length % 4, 0)
        self.assertEqual(20 + json_length + 8 + bin_length, len(data))
        byte_length = gltf["buffers"][0]["byteLength"]
        self.assertTrue(byte_length <= bin_length < byte_length + 4)
        self.assertEqual(set(data[28 + json_length + byte_length:]), set() if bin_length == byte_length else {0})
        for view in gltf["bufferViews"]:
            self.assertEqual(view["byteOffset"] % 4, 0)
            self.assertLessEqual(view["byteOffset"] + view["byteLength"], byte_length)
        # Blender packed the template's data 4-byte aligned with the animation last, so every
        # byte before the old animation data is unchanged.
        g0 = self.template[0]
        old_start = min(g0["bufferViews"][g0["accessors"][i]["bufferView"]]["byteOffset"]
                        for s in g0["animations"][0]["samplers"] for i in (s["input"], s["output"]))
        self.assertEqual(old_start, 8438464)
        self.assertEqual(self.output[1][:old_start], self.template[1][:old_start])
        self.assertEqual(self.summary["bytes"], len(data))

    def test_reindexes_a_template_whose_animation_is_not_last(self):
        g, b = shuffled_template(*self.template)
        shuffled = self.dir / "shuffled_template.glb"
        shuffled.write_bytes(pack_glb(g, b))
        # The fixture holds double_leg's animation ...
        motion = writer.read_motion_from_glb(shuffled)
        for key, value in self.motion.items():
            np.testing.assert_array_equal(motion[key], value, key)
        out = self.dir / "from_shuffled_template.glb"
        writer.write_paired_glb(shuffled, self.motion, out)
        g1, b1 = writer.read_glb(out)
        # ... and once the writer has dropped that animation from the start of the BIN chunk
        # and re-indexed the rest, what it copied is double_leg's own content, byte for byte.
        self.assertEqual(copied_parts(g1, b1), copied_parts(*self.template))
        self.assertEqual(len(g1["accessors"]), len(self.output[0]["accessors"]))
        self.assertEqual(len(g1["bufferViews"]), len(self.output[0]["bufferViews"]))
        # The kept bufferViews are packed in the same byte order as from double_leg itself, so
        # nothing of the old animation is left behind.
        self.assertEqual(len(b1), len(self.output[1]))
        _, trs0 = writer.sample_animation(*self.output)
        _, trs1 = writer.sample_animation(g1, b1)
        self.assertEqual(sorted(trs1), sorted(trs0))
        for node in trs0:
            for path in trs0[node]:
                np.testing.assert_array_equal(trs1[node][path], trs0[node][path])

    def test_every_published_template_round_trips(self):
        for path in sorted(TEMPLATES.glob("*.glb")):
            with self.subTest(template=path.name):
                out = self.dir / f"all-{path.name}"
                writer.write_paired_glb(path, writer.read_motion_from_glb(path), out)
                _, trs0 = writer.sample_animation(*writer.read_glb(path))
                _, trs1 = writer.sample_animation(*writer.read_glb(out))
                self.assertEqual(sorted(trs1), sorted(trs0))
                for node in trs0:
                    self.assertLessEqual(np.abs(trs1[node]["translation"] - trs0[node]["translation"]).max(), 1e-6)
                    self.assertLessEqual(quat_error(trs1[node]["rotation"], trs0[node]["rotation"]), 1e-6)
                    self.assertLessEqual(np.abs(trs1[node]["scale"] - trs0[node]["scale"]).max(), TEMPLATE_SCALE_NOISE)
                out.unlink()

    def test_motion_without_joint_translation_holds_the_rest_translation(self):
        # The fitter's form: no joint_translation, and the source video's frame numbers.
        m = self.copy_motion()
        for role in ROLES:
            del m[f"{role}__joint_translation"]
        m["source_frames"] = np.arange(300, 426)
        out = self.dir / "rest_translation.glb"
        writer.write_paired_glb(TEMPLATE, m, out)
        _, trs = writer.sample_animation(*writer.read_glb(out))
        for role in ROLES:
            r = self.rigs[role]
            for j, node in enumerate(r.node_index):
                rest = np.broadcast_to(r.rest_t[j].astype(np.float32), (126, 3))
                np.testing.assert_array_equal(trs[int(node)]["translation"], rest, r.joint_names[j])

    # ------------------------------------------------------------ 2. a synthetic edit

    def test_synthetic_edit_moves_head_and_attacker(self):
        m = self.copy_motion()
        head = self.rigs["JQ_Attacker"].index("Head")
        a = np.radians(30.0)
        rx = np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])
        local = rig.quat_to_mat(m["JQ_Attacker__joint_rotation"][:, head])
        m["JQ_Attacker__joint_rotation"][:, head] = rig.mat_to_quat(local @ rx)  # about its own X
        m["JQ_Attacker__node_translation"][:, 0] += 0.5
        out = self.dir / "edit.glb"
        writer.write_paired_glb(TEMPLATE, m, out)
        g, b = writer.read_glb(out)
        back = writer.read_motion_from_glb(out)
        for role in ROLES:
            r = rig.load_rig(g, b, role)  # the rig as written
            self.assertEqual(r.joint_names, self.rigs[role].joint_names)
            self.assertLess(rig.bind_pose_error(r), 1e-5)
            t0, R0 = forward(r, self.motion, role)
            t1, R1 = forward(r, back, role)
            if role == "JQ_Defender":
                self.assertLess(np.abs(t1 - t0).max(), 1e-6)
                self.assertLess(np.abs(R1 - R0).max(), 1e-6)
                continue
            # The whole attacker, head included, moved 0.5 m along X at every key.
            np.testing.assert_allclose(t1 - t0, np.broadcast_to([0.5, 0, 0], t0.shape), atol=1e-5)
            # The head turned 30 degrees about its own X axis; no other joint turned.
            relative = np.swapaxes(R0[:, head], -1, -2) @ R1[:, head]
            np.testing.assert_allclose(relative, np.broadcast_to(rx, relative.shape), atol=1e-5)
            angle = np.degrees(np.arccos(np.clip((np.trace(relative, axis1=1, axis2=2) - 1) / 2, -1, 1)))
            np.testing.assert_allclose(angle, 30.0, atol=1e-3)
            others = [j for j in range(len(r.joint_names)) if j != head]
            self.assertLess(np.abs(R1[:, others] - R0[:, others]).max(), 1e-5)
            # So a point 10 cm along the head bone moved 2 * 0.1 * sin(15 deg) = 5.18 cm on top
            # of the 0.5 m.
            crown = np.array([0.0, 0.1, 0.0])
            p0 = t0[:, head] + R0[:, head] @ crown
            p1 = t1[:, head] + R1[:, head] @ crown
            moved = np.linalg.norm(p1 - p0 - [0.5, 0, 0], axis=1)
            np.testing.assert_allclose(moved, 0.2 * np.sin(np.radians(15.0)), atol=1e-5)

    # ------------------------------------------------------------ 3. refusals

    def test_refuses_malformed_motion(self):
        def swap_joints(m):
            names = m["JQ_Attacker__joint_names"]
            names[[3, 4]] = names[[4, 3]]

        def nan(m):
            m["JQ_Defender__joint_rotation"][40, 12, 2] = np.nan

        def repeated_time(m):
            m["times"][50] = m["times"][49]

        def decreasing_times(m):
            m["times"] = m["times"][::-1].copy()

        def one_key(m):
            for key in list(m):
                if key not in ("fps",) and not key.endswith("joint_names"):
                    m[key] = m[key][:1]

        def wrong_shape(m):
            m["JQ_Attacker__node_translation"] = m["JQ_Attacker__node_translation"][:, :2]

        def unknown_key(m):
            m["JQ_Attacker__joint_translations"] = m.pop("JQ_Attacker__joint_translation")

        def missing_key(m):
            del m["JQ_Defender__node_rotation"]

        def zero_quaternion(m):
            m["JQ_Attacker__node_rotation"][7] = 0.0

        def infinite_fps(m):
            m["fps"] = np.float64(np.inf)

        cases = [(swap_joints, "joint order.*position 3"), (nan, "non-finite.*\\(40, 12, 2\\)"),
                 (repeated_time, "strictly increase.*times\\[50\\]"), (decreasing_times, "strictly increase"),
                 (one_key, "at least 2"), (wrong_shape, "shape"), (unknown_key, "unknown keys"),
                 (missing_key, "lacks JQ_Defender__node_rotation"), (zero_quaternion, "zero-length"),
                 (infinite_fps, "fps")]
        for edit, pattern in cases:
            with self.subTest(edit.__name__):
                m = self.copy_motion()
                edit(m)
                out = self.dir / f"refused-{edit.__name__}.glb"
                with self.assertRaisesRegex(writer.MotionError, pattern):
                    writer.write_paired_glb(TEMPLATE, m, out)
                self.assertFalse(out.exists())

    def test_refuses_to_overwrite_its_template(self):
        copy = self.dir / "template-copy.glb"
        copy.write_bytes(TEMPLATE.read_bytes())
        with self.assertRaisesRegex(writer.TemplateError, "template itself"):
            writer.write_paired_glb(copy, self.motion, copy)
        self.assertEqual(copy.read_bytes(), TEMPLATE.read_bytes())

    # ------------------------------------------------------------ command line

    def test_command_line(self):
        motion = self.dir / "motion.npz"
        np.savez(motion, **self.motion)
        out = self.dir / "cli.glb"
        script = str(HERE / "write_paired_glb.py")
        run = subprocess.run([sys.executable, script, "--template", str(TEMPLATE), "--motion", str(motion),
                              "--out", str(out), "--source-note", "unit test note"],
                             capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("126 keys", run.stdout)
        self.assertIn("396 channels", run.stdout)
        extras = writer.read_glb(out)[0]["scenes"][0]["extras"]
        self.assertEqual(extras["JQ_source_note"], "unit test note")
        self.assertEqual(extras["JQ_motion_type"], "video-reference-fit")
        # The command line and the library write the same bytes.
        library = self.dir / "library.glb"
        writer.write_paired_glb(TEMPLATE, self.motion, library, {"JQ_source_note": "unit test note"})
        self.assertEqual(out.read_bytes(), library.read_bytes())

        bad = self.copy_motion()
        bad["JQ_Defender__joint_names"] = bad["JQ_Defender__joint_names"][::-1].copy()
        np.savez(motion, **bad)
        refused = self.dir / "cli-refused.glb"
        run = subprocess.run([sys.executable, script, "--template", str(TEMPLATE), "--motion", str(motion),
                              "--out", str(refused)], capture_output=True, text=True)
        self.assertEqual(run.returncode, 1)
        self.assertIn("joint order", run.stderr)
        self.assertFalse(refused.exists())


if __name__ == "__main__":
    unittest.main()
