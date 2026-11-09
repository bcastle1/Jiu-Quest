"""Bounded standing-only grip presentation; original GLBs remain untouched.

Only existing wrist/finger rotation samples change. Geometry, bind data, joint
translations, key times, all other channels and the complete JSON remain exact.
The wrist origin stays fixed; a bounded swing lifts the palm instead of forcing
the fingers into an unnatural backward bend. No contact technique is modified.
"""
import hashlib
import json
import math
import struct

DIGITS = ("index", "middle", "ring", "pinky", "thumb")
ROLES = ("Attacker", "Defender")
MAX_WRIST_SWING_DEGREES = 55.
TARGET_PITCH_DEGREES = 3.
CURL_SCALE = .60
THUMB_CURL_SCALE = .60


def _check(condition, message):
    if not condition:
        raise ValueError(message)


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _unit(a):
    length = math.sqrt(_dot(a, a))
    _check(length > 1e-10 and math.isfinite(length), "Invalid hand vector/quaternion")
    return tuple(x / length for x in a)


def _cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def _mul(a, b):
    x, y, z, w = a
    u, v, t, s = b
    return (w*u+x*s+y*t-z*v, w*v-x*t+y*s+z*u,
            w*t+x*v-y*u+z*s, w*s-x*u-y*v-z*t)


def _inverse(q):
    return (-q[0], -q[1], -q[2], q[3])


def _rotate(q, v):
    return _mul(_mul(q, (*v, 0.)), _inverse(q))[:3]


def _angle(a, b=(0., 0., 0., 1.)):
    return math.degrees(2 * math.acos(min(1., abs(_dot(_unit(a), _unit(b))))))


def _slerp(a, b, amount):
    a, b = _unit(a), _unit(b)
    dot = _dot(a, b)
    if dot < 0:
        b, dot = tuple(-v for v in b), -dot
    if dot > .9995:
        return _unit(tuple(x + amount * (y - x) for x, y in zip(a, b)))
    theta = math.acos(min(1., dot))
    return tuple((math.sin((1-amount)*theta)*x + math.sin(amount*theta)*y)
                 / math.sin(theta) for x, y in zip(a, b))


def _sample(times, values, seconds, rotation, step=False):
    if seconds <= times[0]:
        return values[0]
    for i in range(1, len(times)):
        if times[i] >= seconds:
            if step:
                return values[i] if times[i] == seconds else values[i-1]
            amount = (seconds-times[i-1])/(times[i]-times[i-1])
            return (_slerp(values[i-1], values[i], amount) if rotation else
                    tuple(a+amount*(b-a) for a, b in zip(values[i-1], values[i])))
    return values[-1]


class _Scene:
    def __init__(self, raw):
        _check(len(raw) >= 28 and struct.unpack_from("<III", raw) == (0x46546C67, 2, len(raw)),
               "Invalid standing GLB")
        size, kind = struct.unpack_from("<II", raw, 12)
        _check(kind == 0x4E4F534A and size % 4 == 0 and 28+size <= len(raw), "Invalid JSON chunk")
        self.doc = json.loads(raw[20:20+size])
        binary_size, kind = struct.unpack_from("<II", raw, 20+size)
        self.binary_start = 28+size
        _check(kind == 0x004E4942 and self.binary_start+binary_size == len(raw), "One embedded BIN required")
        self.raw = raw
        self.parents = {child: i for i, node in enumerate(self.doc["nodes"]) for child in node.get("children", [])}
        _check(len(self.doc["animations"]) == 1, "One standing animation required")
        self.animation = self.doc["animations"][0]
        self.values = {}
        self.channels = {}
        self.interpolations = {}
        for c in self.animation["channels"]:
            sampler = self.animation["samplers"][c["sampler"]]
            interpolation = sampler.get("interpolation", "LINEAR")
            _check(interpolation in ("LINEAR", "STEP"), "Unsupported standing interpolation")
            target = (c["target"]["node"], c["target"]["path"])
            _check(target not in self.channels, "Ambiguous animation target")
            times = [v[0] for v in self.array(sampler["input"])]
            self.channels[target] = (sampler["output"], times)
            self.interpolations[target] = interpolation
            self.values[sampler["output"]] = self.array(sampler["output"])
        self.joints = {}
        for role in ROLES:
            skins = [s for s in self.doc["skins"] if s["name"] == "JQ_"+role+"_Rig"]
            _check(len(skins) == 1 and len(skins[0]["joints"]) == 65, "Original fighter rig required")
            self.joints[role] = {self.doc["nodes"][i]["name"]: i for i in skins[0]["joints"]}
        _check(abs(max(t[-1] for _, t in self.channels.values())-1.8) < 1e-4, "Standing duration changed")

    def span(self, index):
        a = self.doc["accessors"][index]
        _check("sparse" not in a, "Sparse accessors unsupported")
        view = self.doc["bufferViews"][a["bufferView"]]
        _check(view.get("buffer", 0) == 0, "External buffer unsupported")
        count = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
        size = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[a["componentType"]]
        start = self.binary_start + view.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = view.get("byteStride", count*size)
        end = start + (a["count"]-1)*stride + count*size
        _check(start >= self.binary_start and end <= len(self.raw), "Accessor outside source BIN")
        return start, end, stride, count

    def array(self, index):
        a = self.doc["accessors"][index]
        _check(a["componentType"] == 5126, "Animation must use original float accessors")
        start, _, stride, count = self.span(index)
        return [struct.unpack_from("<"+"f"*count, self.raw, start+i*stride) for i in range(a["count"])]

    def pose(self, seconds, replacements=None):
        values = self.values if replacements is None else {**self.values, **replacements}
        overrides = {}
        for (node, path), (accessor, times) in self.channels.items():
            overrides.setdefault(node, {})[path] = _sample(
                times, values[accessor], seconds, path == "rotation", self.interpolations[(node, path)] == "STEP")
        world = {}
        def calculate(i):
            if i in world:
                return world[i]
            n, o = self.doc["nodes"][i], overrides.get(i, {})
            _check("matrix" not in n, "Standing matrix nodes unsupported")
            scale = o.get("scale", n.get("scale", (1., 1., 1.)))
            _check(all(abs(v-1.) < 1e-5 for v in scale), "Original unit-scale standing rig required")
            q = _unit(o.get("rotation", n.get("rotation", (0., 0., 0., 1.))))
            p = tuple(o.get("translation", n.get("translation", (0., 0., 0.))))
            if i in self.parents:
                pq, pp = calculate(self.parents[i])
                p = tuple(a+b for a, b in zip(pp, _rotate(pq, p)))
                q = _unit(_mul(pq, q))
            world[i] = q, p
            return world[i]
        for i in range(len(self.doc["nodes"])):
            calculate(i)
        return world


def _directions(scene, world, role, side):
    joints = scene.joints[role]
    wrist = world[joints["hand_"+side]][1]
    other = "Defender" if role == "Attacker" else "Attacker"
    head = world[scene.joints[other]["Head"]][1]
    forward = _unit((head[0]-wrist[0], 0., head[2]-wrist[2]))
    rows = []
    for digit in DIGITS[:-1]:
        base = world[joints[f"{digit}_01_{side}"]][1]
        tip = world[joints[f"{digit}_04_leaf_{side}"]][1]
        direction = _unit(tuple(b-a for a, b in zip(base, tip)))
        rows.append({"digit": digit, "pitchDegrees": math.degrees(math.asin(max(-1., min(1., direction[1])))),
                     "forwardDot": _dot(direction, forward), "direction": direction})
    return rows, forward


def refine_ready_hands(raw, clip_name):
    """Return an import-only derivative and proof; every other clip is exact."""
    sha = lambda data: hashlib.sha256(data).hexdigest()
    if clip_name != "standing_stance":
        return raw, {"status": "unchanged_nonstanding_clip", "sourceSha256": sha(raw),
                     "importSha256": sha(raw), "changedChannels": []}
    scene = _Scene(raw)
    changed, records, selected = {}, [], set()
    for role in ROLES:
        for side in ("l", "r"):
            for digit in DIGITS:
                angles = (6., 10., 7.) if digit == "thumb" else (12., 24., 12.)
                stagger = {"index": .88, "middle": 1., "ring": 1.08, "pinky": 1.15, "thumb": 1.}[digit]
                for segment in (1, 2, 3):
                    name = f"{digit}_{segment:02d}_{side}"
                    _check(name in scene.joints[role], "Missing finger joint: "+name)
                    node = scene.joints[role][name]
                    accessor, times = scene.channels[(node, "rotation")]
                    rest = scene.doc["nodes"][node].get("rotation", (0., 0., 0., 1.))
                    source = scene.values[accessor]
                    _check(len(source) == 55 and abs(_angle(rest, source[0])-angles[segment-1]*stagger) < .02,
                           "Ready-hand source changed or refinement already applied: "+name)
                    amount = THUMB_CURL_SCALE if digit == "thumb" else CURL_SCALE
                    changed[accessor] = [_slerp(rest, q, amount) for q in source]
                    selected.add(accessor)
                    records.append({"role": role, "joint": name, "node": node, "accessor": accessor,
                                    "samples": len(source), "kind": "finger_curl", "curlScale": amount})
    base_world = scene.pose(0., changed)
    hands = []
    for role in ROLES:
        for side in ("l", "r"):
            node = scene.joints[role]["hand_"+side]
            rows, forward = _directions(scene, base_world, role, side)
            current = _unit(tuple(sum(row["direction"][k] for row in rows) for k in range(3)))
            pitch = math.radians(TARGET_PITCH_DEGREES)
            target = (forward[0]*math.cos(pitch), math.sin(pitch), forward[2]*math.cos(pitch))
            swing = _unit((*_cross(current, target), 1.+_dot(current, target)))
            degrees = _angle(swing)
            _check(degrees <= MAX_WRIST_SWING_DEGREES, "Grip requires an excessive wrist swing")
            parent_q = base_world[scene.parents[node]][0]
            local_swing = _mul(_mul(_inverse(parent_q), swing), parent_q)
            accessor, _ = scene.channels[(node, "rotation")]
            _check(len(scene.values[accessor]) == 2, "Standing wrist key inventory changed")
            changed[accessor] = [_unit(_mul(local_swing, q)) for q in scene.values[accessor]]
            selected.add(accessor)
            records.append({"role": role, "joint": "hand_"+side, "node": node, "accessor": accessor,
                            "samples": 2, "kind": "wrist_swing", "swingDegrees": degrees})
            hands.append({"role": role, "side": side, "wristSwingDegrees": degrees})
    _check(len(selected) == 64, "Aliased hand outputs are unsupported")
    selected_spans = [(i, scene.span(i)) for i in selected]
    for i, (start, end, stride, count) in selected_spans:
        a = scene.doc["accessors"][i]
        _check(count == 4 and stride == 16 and not any(k in a for k in ("min", "max")), "Unexpected rotation layout")
        for j in range(len(scene.doc["accessors"])):
            if i == j:
                continue
            other_start, other_end, _, _ = scene.span(j)
            _check(end <= other_start or start >= other_end, "Rotation bytes alias another source accessor")
    output = bytearray(raw)
    allowed = bytearray(len(raw))
    for accessor, (start, end, _, _) in selected_spans:
        for index, q in enumerate(changed[accessor]):
            struct.pack_into("<4f", output, start+index*16, *q)
        allowed[start:end] = b"\1"*(end-start)
    changed_bytes = sum(a != b for a, b in zip(raw, output))
    _check(all(a == b or allowed[i] for i, (a, b) in enumerate(zip(raw, output))), "Protected source bytes changed")
    output = bytes(output)
    result = _Scene(output)
    _check(result.doc == scene.doc, "Source JSON changed")
    key_times = sorted({time for accessor, times in scene.channels.values() if accessor in selected for time in times})
    times = sorted(set(key_times) | {(a+b)*.5 for a, b in zip(key_times, key_times[1:])})
    max_protected = 0.
    for hand in hands:
        hand.update(beforePitchDegrees=[], afterPitchDegrees=[], afterForwardDot=[], thumbIndexTipGapMeters=[])
    for seconds in times:
        before, after = scene.pose(seconds), result.pose(seconds)
        for role in ROLES:
            for name, node in scene.joints[role].items():
                if not name.startswith(tuple(d+"_" for d in DIGITS)):
                    max_protected = max(max_protected, math.dist(before[node][1], after[node][1]))
        for hand in hands:
            pre, _ = _directions(scene, before, hand["role"], hand["side"])
            post, _ = _directions(result, after, hand["role"], hand["side"])
            hand["beforePitchDegrees"].extend(row["pitchDegrees"] for row in pre)
            hand["afterPitchDegrees"].extend(row["pitchDegrees"] for row in post)
            hand["afterForwardDot"].extend(row["forwardDot"] for row in post)
            joints, side = result.joints[hand["role"]], hand["side"]
            hand["thumbIndexTipGapMeters"].append(math.dist(
                after[joints["thumb_04_leaf_"+side]][1], after[joints["index_04_leaf_"+side]][1]))
    for hand in hands:
        for key in ("beforePitchDegrees", "afterPitchDegrees", "afterForwardDot", "thumbIndexTipGapMeters"):
            hand[key] = {"min": min(hand[key]), "max": max(hand[key])}
        _check(hand["afterPitchDegrees"]["min"] >= 0. and hand["afterPitchDegrees"]["max"] <= 6.
               and hand["afterForwardDot"]["min"] >= .98, "Fingers do not form the intended forward ready grip")
        _check(hand["thumbIndexTipGapMeters"]["min"] >= .025, "Thumb opening is too narrow")
    _check(max_protected < 1e-9, "Protected wrist/arm/body position changed")
    return output, {"status": "standing_grip_authored_visual_review_pending",
        "sourceSha256": sha(raw), "importSha256": sha(output), "changedBytes": changed_bytes,
        "changedChannels": records, "authoredKeyTimes": len(key_times), "sampledTimes": len(times), "hands": hands,
        "maximumProtectedJointPositionChangeMeters": max_protected,
        "jsonHierarchyAndMeshDefinitionsUnchanged": True, "allOtherBytesUnchanged": True,
        "wristPositionsArmsAndChoreographyPreserved": True,
        "limits": ["Standing wrist orientation and finger curl only; no contact-aware cloth grasp",
                   "Actual Unreal hands, cuff clearance and finger intersections require rendered review",
                   "Ground techniques and all other clips return byte-for-byte unchanged"]}
