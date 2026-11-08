"""Audit actual UE capture files and six world joints against pinned glTF data.

Standard-library-only; run after capture_pilot.py in a real Editor. This checks
three paused times per clip plus four standing closeups, not all-frame motion.
"""
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "unreal/JiuQuestCharacters"
BONES = ("Head", "hand_l", "hand_r")
ROLES = ("Attacker", "Defender")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def multiply(a, b):
    return [[sum(a[row][k] * b[k][column] for k in range(4))
             for column in range(4)] for row in range(4)]


def normalized(values):
    length = math.sqrt(sum(value * value for value in values))
    require(length > 0 and math.isfinite(length), "Invalid source quaternion")
    return [value / length for value in values]


def sample(times, values, seconds, interpolation, rotation):
    require(interpolation in ("LINEAR", "STEP"), "Unsupported source interpolation")
    right = bisect.bisect_right(times, seconds)
    if right == 0:
        return values[0]
    if right == len(times) or interpolation == "STEP":
        return values[right - 1]
    left = right - 1
    alpha = (seconds - times[left]) / (times[right] - times[left])
    a, b = values[left], values[right]
    if rotation:
        dot = sum(x * y for x, y in zip(a, b))
        if dot < 0:
            b, dot = [-value for value in b], -dot
        if dot < .9995:
            theta = math.acos(max(-1., min(1., dot)))
            return [(math.sin((1. - alpha) * theta) * x + math.sin(alpha * theta) * y)
                    / math.sin(theta) for x, y in zip(a, b)]
    result = [(1. - alpha) * x + alpha * y for x, y in zip(a, b)]
    return normalized(result) if rotation else result


def local_matrix(node, overrides):
    if "matrix" in node:
        require(not overrides, "Animated source matrix node is unsupported")
        return [[node["matrix"][column * 4 + row] for column in range(4)] for row in range(4)]
    x, y, z, w = normalized(overrides.get("rotation", node.get("rotation", [0., 0., 0., 1.])))
    rotation = [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]
    scale = overrides.get("scale", node.get("scale", [1., 1., 1.]))
    translation = overrides.get("translation", node.get("translation", [0., 0., 0.]))
    return [[rotation[row][column] * scale[column] for column in range(3)] + [translation[row]]
            for row in range(3)] + [[0., 0., 0., 1.]]


class Source:
    def __init__(self, pinned):
        data = (ROOT / pinned["source"]).read_bytes()
        require(len(data) == pinned["bytes"] and digest(data) == pinned["sha256"], "Pinned source changed")
        require(data[:4] == b"glTF" and struct.unpack_from("<I", data, 4)[0] == 2, "Invalid source GLB")
        size = struct.unpack_from("<I", data, 12)[0]
        self.gltf = json.loads(data[20:20 + size])
        self.binary = data[28 + size:]
        self.parents = {child: i for i, node in enumerate(self.gltf["nodes"]) for child in node.get("children", [])}
        self.channels = []
        for animation in self.gltf["animations"]:
            for channel in animation["channels"]:
                sampler = animation["samplers"][channel["sampler"]]
                self.channels.append((channel["target"]["node"], channel["target"]["path"],
                    sampler.get("interpolation", "LINEAR"),
                    [row[0] for row in self.accessor(sampler["input"])], self.accessor(sampler["output"])))

    def accessor(self, index):
        acc = self.gltf["accessors"][index]
        require(acc["componentType"] == 5126 and "sparse" not in acc, "Unsupported source animation accessor")
        view = self.gltf["bufferViews"][acc["bufferView"]]
        count = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[acc["type"]]
        offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        return [struct.unpack_from("<" + "f" * count, self.binary,
            offset + j * view.get("byteStride", 4 * count)) for j in range(acc["count"])]

    def world_positions(self, seconds):
        overrides = {}
        for index, path, interpolation, times, values in self.channels:
            require(path in ("rotation", "translation", "scale"), "Unsupported animation target")
            overrides.setdefault(index, {})[path] = sample(times, values, seconds, interpolation, path == "rotation")
        world = {}
        def transform(index):
            if index not in world:
                local = local_matrix(self.gltf["nodes"][index], overrides.get(index, {}))
                world[index] = multiply(transform(self.parents[index]), local) if index in self.parents else local
            return world[index]
        result = {}
        for role in ROLES:
            skin = next(s for s in self.gltf["skins"] if s["name"] == "JQ_" + role + "_Rig")
            result[role] = {}
            for name in BONES:
                indices = [i for i in skin["joints"] if self.gltf["nodes"][i].get("name") == name]
                require(len(indices) == 1, "Source joint is missing or ambiguous")
                matrix = transform(indices[0])
                result[role][name] = [matrix[axis][3] * 100. for axis in (0, 2, 1)]
        return result


def audit(capture, tolerance):
    raw = (capture / "capture-report.json").read_bytes()
    report = json.loads(raw)
    pinned = json.loads((PROJECT / "pilot-assets.json").read_text())
    require(report["status"] == "captured_unreviewed", "Capture did not complete")
    require(report["baselineCommit"] == pinned["baselineCommit"], "Capture baseline changed")
    fingerprint = digest(json.dumps(pinned, separators=(",", ":"), ensure_ascii=False).encode())
    require(report["sourceFingerprint"] == fingerprint, "Capture source fingerprint changed")
    sources = {clip["name"]: Source(clip) for clip in pinned["clips"]}
    durations = {name: max(max(channel[3]) for channel in source.channels)
                 for name, source in sources.items()}
    expected = {(clip, frame) for clip in sources for frame in ("first", "mid", "finish")}
    expected |= {("standing_stance", role + detail) for role in ROLES for detail in ('-face', '-hands')}
    shots = report["captures"]
    require(len(shots) == len(expected) and {(s["clip"], s["frame"]) for s in shots} == expected,
            "Capture inventory changed")
    rows = []; grip_rows = []
    for shot in shots:
        require(Path(shot["file"]).name == shot["file"], "Capture image path escaped its directory")
        image = (capture / shot["file"]).read_bytes()
        require(len(image) == shot["bytes"] and digest(image) == shot["sha256"], "Captured image changed")
        require(image[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", image[16:24]) == tuple(report["resolution"]),
                "Captured image resolution changed")
        require(image[-12:] == b"\x00\x00\x00\x00IEND\xaeB\x60\x82", "Captured PNG is incomplete")
        seconds = shot["sharedSeconds"]
        fraction = {"first": 0., "mid": .5, "finish": 1.}.get(shot["frame"], 0.)
        require(abs(seconds - durations[shot["clip"]] * fraction) < 1e-4,
                "Capture label does not match its required source time")
        require(math.isfinite(seconds) and abs(shot["sharedSequenceTimeSeconds"] - seconds) < 1e-4,
                "Shared sequence time does not match requested time")
        require(shot["animationAuthority"] == "shared_level_sequence", "Capture used a different animation controller")
        inventory = report["importedSequenceInventory"][shot["clip"]]
        require(shot["skeletalComponentCount"] == inventory["skeletalBindingCount"] == 22,
                "Expected fighter components are not bound")
        require(len(inventory["parentBindings"]) == 2, "Expected source parent bindings are missing")
        if shot['clip'] == 'standing_stance':
            fingers = shot.get('readyHandDirections', [])
            expected_fingers = {(role, side, digit) for role in ROLES for side in ('l', 'r')
                                for digit in ('index', 'middle', 'ring', 'pinky')}
            require(len(fingers) == 16 and {(f['role'],f['side'],f['digit']) for f in fingers} == expected_fingers,
                    'Standing grip direction inventory changed')
            for finger in fingers:
                pitch, forward = finger['pitchDegrees'], finger['forwardDot']
                require(math.isfinite(pitch) and math.isfinite(forward), 'Non-finite grip direction')
                require(-5. <= pitch <= 25. and forward >= .85,
                        'Standing fingers are not directed forward in a ready grip')
                grip_rows.append({'frame': shot['frame'], **finger})
        expected_positions = sources[shot["clip"]].world_positions(seconds)
        require(set(shot["evaluatedBoneTransforms"]) == set(ROLES), "Evaluated fighter roles changed")
        for role in ROLES:
            bones = shot["evaluatedBoneTransforms"][role]
            require(set(bones) == set(BONES), "Evaluated joint inventory changed")
            for name in BONES:
                observed = [bones[name]["locationCm"][axis] for axis in ("x", "y", "z")]
                require(all(math.isfinite(v) for v in observed), "Non-finite evaluated joint position")
                expected_position = expected_positions[role][name]
                rows.append({"clip": shot["clip"], "frame": shot["frame"], "role": role, "bone": name,
                    "sourceWorldCm": expected_position, "actualWorldCm": observed,
                    "errorCm": math.dist(expected_position, observed)})
    maximum = max(row["errorCm"] for row in rows)
    return {"status": "passed" if maximum <= tolerance else "failed",
        "captureDirectory": str(capture.resolve()), "captureReportSha256": digest(raw),
        "baselineCommit": pinned["baselineCommit"], "sourceFingerprint": fingerprint,
        "imageIntegrity": "passed", "imageCount": len(shots), "sampleCount": len(rows),
        "maximumWorldPositionErrorCm": maximum, "toleranceCm": tolerance, "samples": rows,
        "gripDirectionSamples": len(grip_rows),
        "minimumGripPitchDegrees": min(row['pitchDegrees'] for row in grip_rows),
        "maximumGripPitchDegrees": max(row['pitchDegrees'] for row in grip_rows),
        "minimumGripForwardDot": min(row['forwardDot'] for row in grip_rows),
        "limits": ["Six joints: head and both hands for each fighter, at three paused times per clip plus four standing closeups",
                   "Not an all-frame, full-rig, cloth collision or paired-contact audit",
                   "Grip direction uses knuckle-to-distal-joint vectors; it does not prove cloth contact or finger collision clearance",
                   "World positions compared; recorded rotations are not numerically validated here",
                   "Does not establish browser streaming, app integration or production behavior"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture_dir", type=Path)
    parser.add_argument("--max-error-cm", type=float, default=.1)
    args = parser.parse_args()
    require(math.isfinite(args.max_error_cm) and args.max_error_cm > 0, "Tolerance must be positive and finite")
    try:
        result = audit(args.capture_dir, args.max_error_cm)
    except (OSError, ValueError, KeyError, TypeError, struct.error, StopIteration) as exc:
        # Replace any earlier success evidence when inputs become invalid.
        result = {"status": "failed", "captureDirectory": str(args.capture_dir.resolve()),
                  "error": str(exc), "limits": ["Input validation failed; no pose or image approval"]}
    output = args.capture_dir / "source-pose-comparison.json"
    if args.capture_dir.is_dir():
        output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key != "samples"}, indent=2))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
