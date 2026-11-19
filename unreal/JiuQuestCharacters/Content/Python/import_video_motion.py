"""Import ONE video-derived paired GLB into Unreal Engine 5.8 for review.

The GLB is a draft written by tools/video_motion/write_paired_glb.py: a paired template's two
athletes (JQ_Attacker, the performer, and JQ_Defender) with an animation fitted from a video.
It is reference motion that needs a qualified BJJ coach's review, not motion capture.

Run it in a fresh full Editor session with no unsaved work, with -ExecutePythonScript and not
the Python commandlet (creating a level needs the full Editor), as for import_pilot.py:

    UnrealEditor-Cmd.exe <project>.uproject
        -ExecutePythonScript="<this script> <absolute GLB path> [--clip leg_hook_takedown]"
        -unattended -nop4 -nosplash

Options (after the GLB path):
    --clip NAME                   names the content folder and the report; default: the GLB's
                                  file name with every run of other characters made "_"
    --hair STYLE                  Crew, Long, Mohawk, Slick or Spikes (default Spikes), shown on
                                  both athletes; the other four hair meshes are detached
    --retarget-target PATH        UNTESTED: a SkeletalMesh asset (e.g. a MetaHuman body) to
                                  retarget both imported animations onto with the IK Retargeter
    --retarget-target-ik-rig PATH UNTESTED: an existing IK Rig for that mesh; default: one is
                                  generated from UE's skeleton templates

How the arguments arrive. UE's Python plugin runs an -ExecutePythonScript value whose first
token ends in ".py" as that file and gives the remaining tokens to it as sys.argv[1:]
(sys.argv[0] is the script). The value is split at spaces, and the whole value has to sit in
one pair of double quotes right after the "=" (the form tools/unreal_pilot.ps1 uses), so a
path that contains spaces cannot be passed this way. The pilot scripts take no arguments, so
this form has not been run in this repository. When sys.argv carries no arguments the request
is read instead from the environment variables named in ENVIRONMENT (JQ_VIDEO_MOTION_GLB, ...)
or, failing those, from import_video_motion.json beside this script, a JSON object with the
keys of ENVIRONMENT. Arguments win over the environment, the environment over the file; the
report records which source was used and which others were present.

What it does, copying import_pilot.py's verified Editor calls wherever it can:
  1. Reads the GLB, checks that it is a JiuQuest paired GLB with one animation and records its
     SHA-256, key times and scene extras (no pinning: these are review drafts).
  2. Claims a new run: Saved/VideoMotion/<clip>/<UTC>/ and /Game/VideoMotion/<clip>/Run_<UTC>.
     An existing run directory or content folder is never overwritten.
  3. Detaches the unselected hair meshes with pilot_source.select_hair (animation, skins and
     binary data stay byte-for-byte) and imports that copy, kept in the run directory, with
     Interchange scene import into a new review map with a no-pawn review game mode.
  4. Binds both athletes' AnimSequences to one LevelSequence (the imported parent-motion
     sequence) that plays once and keeps its final pose, adds the pilot's floor and lights,
     and a CineCameraActor at the side of the pair, framed from the GLB's joint positions.
  5. Optionally retargets each athlete's AnimSequence onto --retarget-target. UNTESTED.

The JSON report is Saved/VideoMotion/<clip>/<UTC>/import-report.json, and
Saved/VideoMotion/latest-import.json names the newest report. "Saved" is the running project's.
Status "editor_import_completed_visual_validation_pending" means only that the scripted import
and setup (and the retarget, when asked for) completed. "failed" names the failing step and
holds the traceback. renderValidated, pairedMotionValidated, coachReviewed and
retargetValidated are always false here. See docs/video-motion.md.
"""
from pathlib import Path
import argparse
import bisect
import contextlib
import datetime
import hashlib
import json
import math
import os
import re
import struct
import sys
import traceback

import unreal

HERE = Path(__file__).resolve().parent
# The helper modules sit beside this script. Run against another project (for a retarget onto
# a MetaHuman that lives there), this directory is not on that project's Python path.
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
from pilot_source import select_hair  # noqa: E402

SUCCESS = "editor_import_completed_visual_validation_pending"
ROLES = ("Attacker", "Defender")
HAIR_STYLES = ("Crew", "Long", "Mohawk", "Slick", "Spikes")
SIDECAR = HERE / "import_video_motion.json"
ENVIRONMENT = {"glb": "JQ_VIDEO_MOTION_GLB", "clip": "JQ_VIDEO_MOTION_CLIP",
               "hair": "JQ_VIDEO_MOTION_HAIR",
               "retargetTarget": "JQ_VIDEO_MOTION_RETARGET_TARGET",
               "retargetTargetIkRig": "JQ_VIDEO_MOTION_RETARGET_TARGET_IK_RIG"}
# A clip name becomes a content folder and a file name: letters, digits and "_" only.
CLIP_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")
# /Root/Folder/Asset or /Root/Folder/Asset.Asset; Unreal package names have no spaces or dots.
ASSET_PATH_PATTERN = re.compile(r"/[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_\-]+)+(?:\.[A-Za-z0-9_\-]+)?")
LIMITS = [
    "Editor-only import and review-scene setup; nothing is rendered or reviewed by this script",
    "Video-derived draft motion: it needs a qualified BJJ coach's review and is not motion capture",
    "Interchange's default glTF materials; the pilot's look-development materials are not applied",
    "Imported poses, pairing, contact, timing and the camera framing require visual review",
    "The MetaHuman retarget path has never been run in an Editor (untested)"]

# import_pilot.add_stage's lights, unchanged apart from following the pair's centre. The
# rotation tuples go to unreal.Rotator(*rotation) exactly as there.
PILOT_LIGHTS = (("Video motion key", (-180., -180., 260.), (-35., 45., 0.), 12000.),
                ("Video motion fill", (-220., -180., 140.), (0., 0., 0.), 2500.),
                ("Video motion rim", (20., 180., 240.), (-35., -90., 0.), 7000.))
# import_pilot.add_stage's camera position, relative to the pair at the origin. Its lights
# face that side, so the side camera goes to the side of the pair nearer this direction.
PILOT_CAMERA_DIRECTION = (-360., -320.)
SENSOR_MM = (23.76, 13.365)  # "16:9 Digital Film" filmback, set explicitly on the camera
FOCAL_LENGTH_MM = 35.
CAMERA_ELEVATION_DEGREES = 10.
FRAMING_JOINTS = ("pelvis", "Head", "hand_l", "hand_r", "foot_l", "foot_r")
FRAMING_MARGIN_CM = 30.  # joint centres, not surfaces: room for heads, hands and feet
MAX_FRAMING_SAMPLES = 200


class UsageError(ValueError):
    """The request (arguments, environment or sidecar file) is missing or invalid."""


class RetargetError(RuntimeError):
    """The optional retarget could not be done; the import itself was completed and saved."""


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc)


# ---------------------------------------------------------------- request

class _Parser(argparse.ArgumentParser):
    def error(self, message):
        # argparse would print and call sys.exit, which must not end the Editor's Python.
        raise UsageError(message + "; usage: " + self.format_usage().strip())


def build_parser():
    parser = _Parser(prog="import_video_motion.py", add_help=False, allow_abbrev=False)
    parser.add_argument("glb")
    parser.add_argument("--clip")
    parser.add_argument("--hair")
    parser.add_argument("--retarget-target", dest="retargetTarget")
    parser.add_argument("--retarget-target-ik-rig", dest="retargetTargetIkRig")
    return parser


def default_clip_name(path):
    name = re.sub(r"[^A-Za-z0-9_]+", "_", path.stem).strip("_")
    if not CLIP_PATTERN.fullmatch(name):
        raise UsageError("Cannot make a clip name from the file name %r; pass --clip with "
                         "letters, digits and '_' (starting with a letter)" % path.name)
    return name


def validate_request(values):
    """Check one request's values; returns the normalized request dict."""
    glb = values.get("glb")
    if not glb:
        raise UsageError("No GLB path given")
    path = Path(glb)
    if not path.is_absolute():
        raise UsageError("Give the GLB as an absolute path; the Editor does not run in your "
                         "shell's directory: " + glb)
    if path.suffix.lower() != ".glb":
        raise UsageError("Expected a .glb file written by tools/video_motion/write_paired_glb.py: " + glb)
    clip = values.get("clip")
    if clip:
        if not CLIP_PATTERN.fullmatch(clip):
            raise UsageError("Clip name %r must be letters, digits and '_', starting with a "
                             "letter, at most 64 characters" % clip)
    else:
        clip = default_clip_name(path)
    hair = values.get("hair") or "Spikes"
    styles = [style for style in HAIR_STYLES if style.lower() == hair.lower()]
    if not styles:
        raise UsageError("Hair style %r is not one of %s" % (hair, ", ".join(HAIR_STYLES)))
    target = values.get("retargetTarget") or None
    target_rig = values.get("retargetTargetIkRig") or None
    for label, value in (("--retarget-target", target), ("--retarget-target-ik-rig", target_rig)):
        if value and not ASSET_PATH_PATTERN.fullmatch(value):
            raise UsageError("%s must be an Unreal asset path such as "
                             "/Game/MetaHumans/Name/Body/Asset; got %r" % (label, value))
    if target_rig and not target:
        raise UsageError("--retarget-target-ik-rig needs --retarget-target")
    return {"glb": str(path), "clip": clip, "hair": styles[0],
            "retargetTarget": target, "retargetTargetIkRig": target_rig}


def read_sidecar(path):
    try:
        values = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise UsageError("Cannot read %s: %s" % (path, error)) from None
    if not isinstance(values, dict):
        raise UsageError("%s must hold a JSON object" % path)
    unknown = sorted(set(values) - set(ENVIRONMENT))
    if unknown:
        raise UsageError("%s has unknown keys %s; allowed: %s"
                         % (path, ", ".join(unknown), ", ".join(ENVIRONMENT)))
    if not all(value is None or isinstance(value, str) for value in values.values()):
        raise UsageError("%s values must be strings" % path)
    return values


def resolve_request(argv, environ, sidecar=SIDECAR):
    """(request, source, other sources present). Arguments win, then the environment, then
    the sidecar file; a source that is chosen but incomplete is an error, never skipped."""
    present = []
    if any(environ.get(name) for name in ENVIRONMENT.values()):
        present.append("environment")
    if sidecar.is_file():
        present.append("sidecar")
    if argv:
        source, values = "argv", vars(build_parser().parse_args(list(argv)))
    elif "environment" in present:
        source = "environment"
        values = {key: environ.get(name) for key, name in ENVIRONMENT.items()}
    elif "sidecar" in present:
        source, values = "sidecar", read_sidecar(sidecar)
    else:
        raise UsageError(
            "No GLB given. Put it after the script path inside -ExecutePythonScript=\"...\", or "
            "set %s (and optionally %s), or write %s with {\"glb\": \"<absolute path>\"}"
            % (ENVIRONMENT["glb"], ENVIRONMENT["clip"], sidecar))
    return validate_request(values), source, [name for name in present if name != source]


def run_stamp(now):
    """The run's UTC stamp, as import_pilot names its runs (one per second)."""
    return now.astimezone(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")


def content_root(clip, stamp):
    return "/Game/VideoMotion/" + clip + "/Run_" + stamp


def run_directory(project, clip, stamp):
    return Path(project) / "Saved" / "VideoMotion" / clip / stamp


# ---------------------------------------------------------------- GLB reading (stdlib only)

def parse_glb(raw):
    check(len(raw) >= 20, "Not a GLB: the file is shorter than a GLB header")
    magic, version, length = struct.unpack_from("<III", raw)
    check(magic == 0x46546C67 and version == 2, "Not a glTF 2.0 binary (GLB)")
    check(length == len(raw), "The GLB header length differs from the file size")
    json_length, kind = struct.unpack_from("<II", raw, 12)
    check(kind == 0x4E4F534A and 20 + json_length <= len(raw), "The GLB has no JSON chunk first")
    gltf = json.loads(raw[20:20 + json_length])
    binary, offset = b"", 20 + json_length
    if offset + 8 <= len(raw):
        bin_length, kind = struct.unpack_from("<II", raw, offset)
        if kind == 0x004E4942:
            binary = raw[offset + 8:offset + 8 + bin_length]
    return gltf, binary


def read_floats(gltf, binary, index):
    accessor = gltf["accessors"][index]
    widths = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}
    check(accessor.get("componentType") == 5126 and accessor.get("type") in widths
          and "sparse" not in accessor and "bufferView" in accessor,
          "Animation accessors must be plain float32 SCALAR, VEC3 or VEC4 data")
    width = widths[accessor["type"]]
    view = gltf["bufferViews"][accessor["bufferView"]]
    stride = view.get("byteStride") or 4 * width
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    count = accessor["count"]
    check(count > 0 and start + stride * (count - 1) + 4 * width <= len(binary),
          "An animation accessor runs past the GLB's binary chunk")
    return [struct.unpack_from("<%df" % width, binary, start + i * stride) for i in range(count)]


def _normalized(values):
    length = math.sqrt(sum(value * value for value in values))
    check(length > 0 and math.isfinite(length), "Invalid quaternion in the GLB")
    return [value / length for value in values]


def _sample(times, values, seconds, interpolation, rotation):
    """glTF LINEAR/STEP sampling, as tools/audit_unreal_capture.py samples the pilot GLBs."""
    check(interpolation in ("LINEAR", "STEP"), "Only LINEAR and STEP animation samplers are supported")
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
    return _normalized(result) if rotation else result


def _local_matrix(node, overrides):
    if "matrix" in node:
        check(not overrides, "An animated node with a matrix transform is unsupported")
        m = node["matrix"]
        return [[m[column * 4 + row] for column in range(4)] for row in range(4)]
    x, y, z, w = _normalized(overrides.get("rotation", node.get("rotation", (0., 0., 0., 1.))))
    scale = overrides.get("scale", node.get("scale", (1., 1., 1.)))
    translation = overrides.get("translation", node.get("translation", (0., 0., 0.)))
    rotation = ((1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
                (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
                (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)))
    return [[rotation[row][column] * scale[column] for column in range(3)] + [translation[row]]
            for row in range(3)] + [[0., 0., 0., 1.]]


def _multiply(a, b):
    return [[sum(a[row][k] * b[k][column] for k in range(4)) for column in range(4)]
            for row in range(4)]


def unreal_cm(matrix):
    """glTF metres (Y up) to Unreal centimetres (Z up): (x, z, y) * 100. This is the mapping
    tools/audit_unreal_capture.py uses; in UE5.8.4 it matched the pilot's imported world joint
    positions within 0.006 cm."""
    return [matrix[0][3] * 100., matrix[2][3] * 100., matrix[1][3] * 100.]


def sample_positions(gltf, binary, animation, times):
    """World positions (Unreal cm) of FRAMING_JOINTS and of the JQ_<Role> nodes at `times`."""
    nodes = gltf["nodes"]
    parents = {child: i for i, node in enumerate(nodes) for child in node.get("children", [])}
    wanted = {}
    for role in ROLES:
        skins = [s for s in gltf.get("skins", []) if s.get("name") == "JQ_" + role + "_Rig"]
        check(len(skins) == 1, "Expected one skin named JQ_%s_Rig" % role)
        by_name = {}
        for joint in skins[0].get("joints", []):
            by_name.setdefault(nodes[joint].get("name"), []).append(joint)
        for name in FRAMING_JOINTS:
            check(len(by_name.get(name, ())) == 1,
                  "Joint %s is missing or ambiguous in the JQ_%s_Rig skin" % (name, role))
            wanted[(role, name)] = by_name[name][0]
        wanted[(role, "node")] = next(i for i, n in enumerate(nodes) if n.get("name") == "JQ_" + role)
    chain = set()  # only the nodes between those joints and the scene root matter
    for index in wanted.values():
        while index is not None and index not in chain:
            chain.add(index)
            index = parents.get(index)
    inputs, channels = {}, []
    for channel in animation.get("channels", []):
        target = channel.get("target", {})
        if target.get("node") not in chain or target.get("path") not in ("translation", "rotation", "scale"):
            continue
        sampler = animation["samplers"][channel["sampler"]]
        if sampler["input"] not in inputs:
            inputs[sampler["input"]] = [t for (t,) in read_floats(gltf, binary, sampler["input"])]
        channels.append((target["node"], target["path"], sampler.get("interpolation", "LINEAR"),
                         inputs[sampler["input"]], read_floats(gltf, binary, sampler["output"])))
    samples = []
    for seconds in times:
        overrides = {}
        for node, path, interpolation, keys, values in channels:
            overrides.setdefault(node, {})[path] = _sample(keys, values, seconds, interpolation,
                                                           path == "rotation")
        world = {}

        def transform(index):
            if index not in world:
                local = _local_matrix(nodes[index], overrides.get(index, {}))
                world[index] = (_multiply(transform(parents[index]), local)
                                if index in parents else local)
            return world[index]
        samples.append({key: unreal_cm(transform(index)) for key, index in wanted.items()})
    return samples


def review_framing(samples):
    """A fixed side camera for the whole clip and the stage centre, from sampled positions.

    The camera looks across the line between the athletes' pelvises at the first key (the
    mean line over the clip when they are within 10 cm), from the side of the pair nearer the
    pilot's camera, 10 degrees above level, far enough for every sampled joint plus a margin
    to stay inside a 35 mm lens on a 16:9 filmback."""
    count = len(samples)
    pelvis = {role: [sample[(role, "pelvis")] for sample in samples] for role in ROLES}
    cx = sum(p[0] for role in ROLES for p in pelvis[role]) / (2 * count)
    cy = sum(p[1] for role in ROLES for p in pelvis[role]) / (2 * count)
    first_a, first_d = pelvis["Attacker"][0], pelvis["Defender"][0]
    axis, axis_source = (first_d[0] - first_a[0], first_d[1] - first_a[1]), "pelvis line at the first key"
    if math.hypot(*axis) < 10.:
        axis = (sum(d[0] - a[0] for a, d in zip(pelvis["Attacker"], pelvis["Defender"])) / count,
                sum(d[1] - a[1] for a, d in zip(pelvis["Attacker"], pelvis["Defender"])) / count)
        axis_source = "mean pelvis line over the clip"
    if math.hypot(*axis) < 10.:
        axis, axis_source = (0., -1.), "template layout (pelvises never 10 cm apart)"
    length = math.hypot(*axis)
    ax, ay = axis[0] / length, axis[1] / length
    px, py = PILOT_CAMERA_DIRECTION
    sx, sy = max(((-ay, ax), (ay, -ax)), key=lambda side: side[0] * px + side[1] * py)
    joints = [p for sample in samples for key, p in sample.items() if key[1] != "node"]
    z_low, z_high = min(p[2] for p in joints), max(p[2] for p in joints)
    z_mid = (z_low + z_high) / 2.
    tan_h = SENSOR_MM[0] / (2. * FOCAL_LENGTH_MM)
    tan_v = SENSOR_MM[1] / (2. * FOCAL_LENGTH_MM)
    distance = 0.
    for x, y, z in joints:
        along = (x - cx) * ax + (y - cy) * ay
        toward = (x - cx) * sx + (y - cy) * sy  # positive: nearer the camera
        distance = max(distance, toward + (abs(along) + FRAMING_MARGIN_CM) / tan_h,
                       toward + (abs(z - z_mid) + FRAMING_MARGIN_CM) / tan_v)
    distance = min(max(distance * 1.1, 300.), 3000.)
    elevation = math.radians(CAMERA_ELEVATION_DEGREES)
    location = [cx + sx * distance * math.cos(elevation), cy + sy * distance * math.cos(elevation),
                z_mid + distance * math.sin(elevation)]
    # Unreal is left-handed with Z up: looking along (fx, fy, 0), image right is (-fy, fx, 0).
    right = (sy, -sx)
    attacker_side = "right" if (first_a[0] - cx) * right[0] + (first_a[1] - cy) * right[1] > 0 else "left"
    reach = max(max(abs(p[0] - cx), abs(p[1] - cy)) for p in joints) + 150.
    return {"pairCentreCm": [cx, cy], "pairAxis": [ax, ay], "pairAxisSource": axis_source,
            "cameraSide": [sx, sy], "cameraLocationCm": location, "lookAtCm": [cx, cy, z_mid],
            "distanceCm": distance, "elevationDegrees": CAMERA_ELEVATION_DEGREES,
            "focalLengthMm": FOCAL_LENGTH_MM, "filmbackMm": list(SENSOR_MM),
            "attackerImageSideAtFirstKey": attacker_side,
            "jointHeightRangeCm": [z_low, z_high], "floorScale": max(6., 2. * reach / 100.),
            "sampledKeys": count, "framedJoints": list(FRAMING_JOINTS)}


def summarize_glb(raw):
    """Check that `raw` is a JiuQuest paired GLB with one animation and describe it."""
    gltf, binary = parse_glb(raw)
    nodes = gltf.get("nodes", [])
    names = [node.get("name") for node in nodes]
    index = {}
    for name in ("JQ_Pair", "JQ_Attacker", "JQ_Defender"):
        found = [i for i, value in enumerate(names) if value == name]
        check(len(found) == 1, "Not a JiuQuest paired GLB: expected one node named " + name)
        index[name] = found[0]
    check({index["JQ_Attacker"], index["JQ_Defender"]} <= set(nodes[index["JQ_Pair"]].get("children", [])),
          "Not a JiuQuest paired GLB: JQ_Attacker and JQ_Defender must be children of JQ_Pair")
    animations = gltf.get("animations", [])
    check(len(animations) == 1, "Expected exactly one animation; the GLB has %d" % len(animations))
    animation = animations[0]
    samplers = animation.get("samplers", [])
    check(samplers, "The GLB's animation has no samplers")
    times = sorted({t for i in {s["input"] for s in samplers} for (t,) in read_floats(gltf, binary, i)})
    check(len(times) >= 2 and all(math.isfinite(t) for t in times) and times[0] >= 0,
          "The animation needs at least two finite, non-negative key times")
    steps = [b - a for a, b in zip(times, times[1:])]
    step = sorted(steps)[len(steps) // 2]
    fps = round(1. / step, 3)
    every = max(1, math.ceil(len(times) / MAX_FRAMING_SAMPLES))
    sampled = times[::every] if times[::every][-1] == times[-1] else times[::every] + [times[-1]]
    positions = sample_positions(gltf, binary, animation, sampled)
    scene = (gltf.get("scenes") or [{}])[gltf.get("scene", 0)]
    extras = scene.get("extras") if isinstance(scene.get("extras"), dict) else {}
    roles = {}
    for role in ROLES:
        node = nodes[index["JQ_" + role]]
        translation = node.get("translation", (0., 0., 0.))
        roles["JQ_" + role] = {
            "restTranslationCm": [translation[0] * 100., translation[2] * 100., translation[1] * 100.],
            "firstKeyTranslationCm": positions[0][(role, "node")]}
    return {"animationName": animation.get("name"), "channelCount": len(animation.get("channels", [])),
            "keyCount": len(times), "firstKeySeconds": times[0], "lastKeySeconds": times[-1],
            "fps": fps, "keyTimesUniform": max(abs(s - step) for s in steps) <= 1e-4,
            # The pilot's capture audit found an imported AnimSequence as long as the GLB's
            # last key time: glTF time 0 is the start, the first key (1/fps) is held before it.
            "expectedDurationSeconds": times[-1], "expectedFrameCount": int(round(times[-1] * fps)),
            "sceneExtras": extras, "motionType": extras.get("JQ_motion_type"),
            "motionTypeIsVideoReferenceFit": extras.get("JQ_motion_type") == "video-reference-fit",
            "reviewStatus": extras.get("JQ_review_status"), "roleNodes": roles,
            "framing": review_framing(positions)}


# ---------------------------------------------------------------- report

class Report:
    """The run's JSON report. Nothing is written into a run directory this run did not create:
    before the run is claimed, a failure goes to a new file under Saved/VideoMotion/_rejected."""

    def __init__(self, project, started):
        self.project = Path(project)
        self.root = self.project / "Saved" / "VideoMotion"
        self.path = None
        self.data = {"status": "not_started", "renderValidated": False, "pairedMotionValidated": False,
                     "coachReviewed": False, "retargetValidated": False, "importCompleted": False,
                     "startedAtUtc": started.isoformat(), "projectDir": str(self.project),
                     "projectIsJiuQuestCharacters": self.project == HERE.parents[1],
                     "recipeFiles": {name: digest((HERE / name).read_bytes())
                                     for name in ("import_video_motion.py", "pilot_source.py")},
                     "completedSteps": [], "currentStep": None, "limits": list(LIMITS)}

    def claim(self, directory):
        directory.parent.mkdir(parents=True, exist_ok=True)
        try:
            directory.mkdir()
        except FileExistsError:
            raise RuntimeError("Refusing to overwrite an earlier run: %s already exists; start "
                               "the import again in a new second" % directory) from None
        self.path = directory / "import-report.json"
        self.data["reportPath"] = str(self.path)

    def _write(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + ".%d.tmp" % os.getpid())
        temporary.write_text(json.dumps(self.data, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)
        pointer = {"report": str(path), "status": self.data["status"], "clip": self.data.get("clip"),
                   "contentRoot": self.data.get("contentRoot"), "updatedAtUtc": utc_now().isoformat()}
        latest = self.root / "latest-import.json"
        temporary = latest.with_name(latest.name + ".%d.tmp" % os.getpid())
        temporary.write_text(json.dumps(pointer, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, latest)

    def save(self):
        if self.path is not None:
            self._write(self.path)

    @contextlib.contextmanager
    def step(self, name):
        # Persisted before each native call: an Editor crash cannot be caught by Python.
        self.data["currentStep"] = name
        self.save()
        unreal.log("JiuQuest video motion import: " + name)
        yield
        self.data["completedSteps"].append(name)

    def fail(self, error):
        self.data.update(status="failed", failedStep=self.data.get("currentStep"),
                         error=str(error), errorType=type(error).__name__,
                         traceback=traceback.format_exc(), failedAtUtc=utc_now().isoformat())
        if self.path is None:
            stamp = utc_now().strftime("%Y%m%d_%H%M%S_%f")
            self.path = self.root / "_rejected" / ("%s_%d" % (stamp, os.getpid())) / "import-report.json"
            self.data["reportPath"] = str(self.path)
        self._write(self.path)
        unreal.log("JiuQuest video motion import failed at %s; report: %s" % (self.data["failedStep"], self.path))

    def complete(self):
        self.data.update(status=SUCCESS, currentStep=None, completedAtUtc=utc_now().isoformat())
        self.save()
        unreal.log("JiuQuest video motion import completed; visual, paired-motion and coach review "
                   "remain pending. Report: " + str(self.path))


# ---------------------------------------------------------------- Editor steps

def make_review_game_mode(report, content):
    # Edit only this run's generated Blueprint defaults, never the engine CDO (import_pilot).
    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", unreal.GameModeBase)
    blueprint = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        "BP_VideoMotionReviewGameMode", content + "/Review", unreal.Blueprint, factory)
    check(blueprint is not None, "Review game mode Blueprint creation failed")
    check(unreal.BlueprintEditorLibrary.compile_blueprint(blueprint), "Review game mode compilation failed")
    generated = unreal.EditorAssetLibrary.load_blueprint_class(blueprint.get_path_name())
    check(generated is not None and generated.get_path_name().startswith(content + "/Review/"),
          "Review game mode must belong to the new import run")
    defaults = unreal.get_default_object(generated)
    defaults.set_editor_property("default_pawn_class", None)
    check(defaults.get_editor_property("default_pawn_class") is None, "Review game mode still spawns a pawn")
    check(unreal.EditorAssetLibrary.save_loaded_asset(blueprint, only_if_is_dirty=False),
          "Review game mode save failed")
    report.data["reviewGameMode"] = {"blueprint": blueprint.get_path_name(), "class": generated.get_path_name(),
                                     "defaultPawnClass": None, "cameraAutoActivatePlayer": 0}
    return generated


def import_glb(level, content, clip, source_file):
    parameters = unreal.ImportAssetParameters()
    parameters.set_editor_property("is_automated", True)
    parameters.set_editor_property("replace_existing", False)
    parameters.set_editor_property("import_level", level.get_current_level())
    manager = unreal.InterchangeManager.get_interchange_manager_scripted()
    target = content + "/Clips/" + clip
    check(manager.import_scene(target, manager.create_source_data(str(source_file)), parameters),
          "Interchange scene import failed")
    assets = [unreal.load_asset(p) for p in unreal.EditorAssetLibrary.list_assets(target, recursive=True)]
    animations = [a for a in assets if isinstance(a, unreal.AnimSequence)]
    check(animations, "No skeletal animations imported; inspect Interchange results before proceeding")
    return target, assets, animations


def bind_animations(actors, animations, source):
    """import_pilot.import_clip's component binding, without its material rebuild."""
    tolerance = 1. / source["fps"] + 1e-4
    components, roles, bindings, bodies = [], set(), [], {}
    for actor in actors.get_all_level_actors():
        for comp in actor.get_components_by_class(unreal.SkeletalMeshComponent):
            mesh = comp.get_editor_property("skeletal_mesh_asset")
            if not mesh:
                continue
            names = [str(s.get_editor_property("imported_material_slot_name"))
                     for s in list(mesh.get_editor_property("materials"))]
            component_roles = {role for role in ROLES if any("JQ_" + role + "_" in n for n in names)}
            check(len(component_roles) == 1, "Cannot identify one source role for " + comp.get_path_name())
            role = next(iter(component_roles))
            roles.add(role)
            skeleton = mesh.get_editor_property("skeleton")
            matches = [a for a in animations if a.get_editor_property("skeleton") == skeleton]
            check(len(matches) == 1, "Ambiguous/missing animation binding for " + mesh.get_path_name())
            animation = matches[0]
            duration = float(animation.get_editor_property("sequence_length"))
            check(math.isfinite(duration) and abs(duration - source["expectedDurationSeconds"]) <= tolerance,
                  "Imported animation length %.6f s differs from the GLB's last key %.6f s"
                  % (duration, source["expectedDurationSeconds"]))
            # The saved LevelSequence controls parent transforms and all bones.
            # Independent component autoplay would create a second clock.
            comp.override_animation_data(animation, is_looping=False, is_playing=False, position=0., play_rate=1.)
            comp.set_editor_property("disable_cloth_simulation", True)
            bindings.append((comp, animation))
            if mesh.get_name() == "JQ_" + role + "_Body":
                check(role not in bodies, "Duplicate fighter body")
                bodies[role] = (comp, mesh, animation)
            components.append({"role": role, "actor": actor.get_path_name(), "component": comp.get_path_name(),
                               "mesh": mesh.get_path_name(), "skeleton": skeleton.get_path_name(),
                               "animation": animation.get_path_name(), "durationSeconds": duration,
                               "materials": names, "locationCm": str(actor.get_actor_location()),
                               "rotation": str(actor.get_actor_rotation()), "scale": str(actor.get_actor_scale3d())})
    check(roles == set(ROLES), "Both original fighter roles must be present")
    used = {}
    for row in components:
        entry = used.setdefault(row["animation"], {"asset": row["animation"], "skeleton": row["skeleton"],
                                                   "roles": [], "sequenceLengthSeconds": row["durationSeconds"]})
        if row["role"] not in entry["roles"]:
            entry["roles"].append(row["role"])
    for entry in used.values():
        entry["framesAtSourceRate"] = int(round(entry["sequenceLengthSeconds"] * source["fps"]))
    return components, bindings, bodies, list(used.values())


def make_shared_sequence(assets, bindings, actors, world, source):
    """import_pilot.make_shared_sequence for a clip that plays once and holds its last pose."""
    sequences = [asset for asset in assets if isinstance(asset, unreal.LevelSequence)]
    check(len(sequences) == 1, "Expected one imported parent-motion LevelSequence")
    sequence = sequences[0]
    parent_bindings = []
    for binding in sequence.get_bindings():
        tracks = binding.get_tracks()
        check(len(tracks) == 1 and isinstance(tracks[0], unreal.MovieScene3DTransformTrack),
              "Unexpected imported parent-motion track layout")
        objects = sequence.locate_bound_objects(binding, world)
        check(len(objects) == 1 and isinstance(objects[0], unreal.Actor), "Parent-motion binding did not resolve")
        name = binding.get_name()
        location = objects[0].get_actor_location()
        node = source["roleNodes"].get(name, {})
        # Informational: where the import put the parent actor against the GLB's node.
        parent_bindings.append({"name": name, "actor": objects[0].get_path_name(),
                                "importedLocationCm": [float(location.x), float(location.y), float(location.z)],
                                "glbRestTranslationCm": node.get("restTranslationCm"),
                                "glbFirstKeyTranslationCm": node.get("firstKeyTranslationCm")})
    check(len(parent_bindings) == 2 and {row["name"] for row in parent_bindings} == {"JQ_Attacker", "JQ_Defender"},
          "Imported fighter parent-motion bindings changed")
    rate = sequence.get_tick_resolution()
    tick_seconds = float(rate.denominator) / float(rate.numerator)
    durations = [float(animation.get_editor_property("sequence_length")) for _, animation in bindings]
    check(max(durations) - min(durations) <= 1. / source["fps"] + 1e-4, "Athletes do not share one timeline")
    duration = min(durations)
    # The playback window excludes its upper tick. Include the authored final
    # sample with one extra tick, not an extra display frame or a time offset.
    playback_end = (round(duration / tick_seconds) + 1) * tick_seconds
    sequence.set_playback_start_seconds(0.)
    sequence.set_playback_end_seconds(playback_end)
    for component, animation in bindings:
        binding = sequence.add_possessable(component)
        check(sequence.locate_bound_objects(binding, world) == [component], "Skeletal sequence binding did not resolve")
        track = binding.add_track(unreal.MovieSceneSkeletalAnimationTrack)
        check(track is not None, "Skeletal sequence track creation failed")
        section = track.add_section()
        params = section.get_editor_property("params")
        params.set_editor_property("animation", animation)
        params.set_editor_property("force_custom_mode", True)
        section.set_editor_property("params", params)
        # UE5.8 SetRangeSeconds gives sections an INCLUSIVE upper bound.
        # Adding another tick here makes the skeletal section loop at the end.
        section.set_range_seconds(0., duration)
        section.set_completion_mode(unreal.MovieSceneCompletionMode.KEEP_STATE)
    sequence_actor = actors.spawn_actor_from_class(unreal.LevelSequenceActor, unreal.Vector())
    check(sequence_actor is not None, "Shared sequence actor creation failed")
    sequence_actor.set_actor_label("Video motion shared playback")
    playback = sequence_actor.get_editor_property("playback_settings")
    playback.set_editor_property("auto_play", True)
    # Play once and pause on the final pose, as the pilot's ground clips do.
    playback.set_editor_property("loop_count", unreal.MovieSceneSequenceLoopCount(0))
    playback.set_editor_property("pause_at_end", True)
    playback.set_editor_property("disable_camera_cuts", True)
    playback.set_editor_property("disable_movement_input", True)
    playback.set_editor_property("disable_look_at_input", True)
    sequence_actor.set_editor_property("playback_settings", playback)
    sequence_actor.set_sequence(sequence)
    check(unreal.EditorAssetLibrary.save_loaded_asset(sequence, only_if_is_dirty=False), "Shared sequence save failed")
    return {"asset": sequence.get_path_name(), "actor": sequence_actor.get_path_name(),
            "durationSeconds": duration, "playbackEndSeconds": sequence.get_playback_end_seconds(),
            "framesAtSourceRate": int(round(duration * source["fps"])), "sourceFps": source["fps"],
            "tickResolution": {"numerator": rate.numerator, "denominator": rate.denominator},
            "parentBindings": parent_bindings, "skeletalBindingCount": len(bindings),
            "playsOnce": True, "completionMode": "KEEP_STATE", "pauseAtEnd": True,
            "oneClockConfigured": True, "pairedMotionValidated": False}


def add_side_camera(actors, framing):
    """A CineCameraActor at the side of the pair with the pilot camera's fixed exposure.

    UNVERIFIED: no CineCamera call has run in this project's Editor. The lens, filmback and
    focus settings are applied one by one; one that the Editor rejects is recorded in the
    report instead of failing the import."""
    camera = actors.spawn_actor_from_class(unreal.CineCameraActor,
                                           unreal.Vector(*framing["cameraLocationCm"]), unreal.Rotator(0., 0., 0.))
    check(camera is not None, "Review camera creation failed")
    camera.set_actor_label("Video motion side camera")
    camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(
        camera.get_actor_location(), unreal.Vector(*framing["lookAtCm"])), False)
    # ACineCameraActor makes its CameraComponent a UCineCameraComponent.
    component = camera.camera_component
    applied, unapplied = [], {}

    def lens(name, action):
        try:
            action()
            applied.append(name)
        except Exception as error:  # an unverified property must not undo a saved import
            unapplied[name] = "%s: %s" % (type(error).__name__, error)

    def filmback():
        settings = component.get_editor_property("filmback")
        settings.set_editor_property("sensor_width", SENSOR_MM[0])
        settings.set_editor_property("sensor_height", SENSOR_MM[1])
        component.set_editor_property("filmback", settings)

    def focus():
        settings = component.get_editor_property("focus_settings")
        settings.set_editor_property("focus_method", unreal.CameraFocusMethod.DISABLE)
        component.set_editor_property("focus_settings", settings)

    lens("filmback", filmback)
    lens("current_focal_length", lambda: component.set_editor_property("current_focal_length", FOCAL_LENGTH_MM))
    lens("focus_settings", focus)
    # A black review backdrop must not drive adaptive exposure: import_pilot's fixed values.
    post = component.get_editor_property("post_process_settings")
    for key, value in {"override_auto_exposure_method": True,
                       "auto_exposure_method": unreal.AutoExposureMethod.AEM_MANUAL,
                       "override_auto_exposure_apply_physical_camera_exposure": True,
                       "auto_exposure_apply_physical_camera_exposure": False,
                       "override_auto_exposure_bias": True, "auto_exposure_bias": -7.,
                       "override_bloom_intensity": True, "bloom_intensity": 0.}.items():
        post.set_editor_property(key, value)
    component.set_editor_property("post_process_settings", post)
    component.set_editor_property("post_process_blend_weight", 1.)
    camera.set_editor_property("auto_activate_for_player", unreal.AutoReceiveInput.PLAYER0)
    return camera, {"actor": camera.get_path_name(), "lensSettingsApplied": applied,
                    "lensSettingsNotApplied": unapplied, "autoActivatePlayer": 0}


def add_stage(actors, framing):
    """import_pilot.add_stage's floor and lights around the pair's centre, and the side camera."""
    cx, cy = framing["pairCentreCm"]

    def spawn(cls, name, xyz, rotation=(0., 0., 0.)):
        obj = actors.spawn_actor_from_class(cls, unreal.Vector(*xyz), unreal.Rotator(*rotation))
        check(obj is not None, "Stage actor creation failed")
        obj.set_actor_label(name)
        return obj
    floor = spawn(unreal.StaticMeshActor, "Video motion floor", (cx, cy, -3.))
    floor.static_mesh_component.set_static_mesh(unreal.load_asset("/Engine/BasicShapes/Cube"))
    floor.set_actor_scale3d(unreal.Vector(framing["floorScale"], framing["floorScale"], .04))
    for name, xyz, rot, intensity in PILOT_LIGHTS:
        light = spawn(unreal.RectLight, name, (cx + xyz[0], cy + xyz[1], xyz[2]), rot)
        comp = light.get_component_by_class(unreal.RectLightComponent)
        comp.set_mobility(unreal.ComponentMobility.MOVABLE)
        comp.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
        comp.set_editor_property("intensity", intensity)
        comp.set_editor_property("source_width", 150.)
        comp.set_editor_property("source_height", 150.)
        if name == "Video motion fill":
            light.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(
                light.get_actor_location(), unreal.Vector(cx, cy, 100.)), False)
            comp.set_editor_property("source_width", 250.)
            comp.set_editor_property("source_height", 250.)
    camera, camera_report = add_side_camera(actors, framing)
    return {"floor": floor.get_path_name(), "lights": [row[0] for row in PILOT_LIGHTS],
            "centreCm": [cx, cy], "floorScale": framing["floorScale"],
            "camera": {**camera_report, "framing": framing}}


# ---------------------------------------------------------------- MetaHuman retarget (UNTESTED)
#
# UNTESTED. Nothing below has run in an Unreal Editor. The calls follow Epic's Python API
# reference for UE 5.4 to 5.8 (IKRigController, IKRetargeterController and
# IKRetargetBatchOperation; run_batch_retarget is the 5.8 call, duplicate_and_retarget the older
# one it deprecates). Every call is looked up first, and a missing one stops the retarget with
# a message that names it and the manual steps. The import itself is saved before this runs.

RETARGET_APIS = ("SkeletalMesh", "IKRigDefinition", "IKRigDefinitionFactory",
                 "IKRigController.get_controller", "IKRigController.set_skeletal_mesh",
                 "IKRigController.set_retarget_root", "IKRigController.add_retarget_chain",
                 "IKRetargeter", "IKRetargetFactory", "IKRetargeterController.get_controller",
                 "IKRetargeterController.set_ik_rig", "IKRetargeterController.auto_map_chains",
                 "RetargetSourceOrTarget.SOURCE", "RetargetSourceOrTarget.TARGET",
                 "AutoMapChainType.FUZZY", "EditorAssetLibrary.find_asset_data")
BATCH_APIS = (("run_batch_retarget", ("IKRetargetBatchOperation.run_batch_retarget",
                                      "IKRetargetBatchOperationInputs")),
              ("duplicate_and_retarget", ("IKRetargetBatchOperation.duplicate_and_retarget",)))
# Retarget chains of the JiuQuest rig (Unreal-mannequin joint names), named like the chains UE
# generates for its mannequin templates so that fuzzy mapping can pair them. They are defined
# explicitly because the Defender's imported bone names carry a 32-hex suffix, which UE's
# skeleton-template recognition would not match.
SOURCE_CHAINS = (("Spine", "spine_01", "spine_03"), ("Neck", "neck_01", "neck_01"), ("Head", "Head", "Head"),
                 ("LeftClavicle", "clavicle_l", "clavicle_l"), ("LeftArm", "upperarm_l", "hand_l"),
                 ("RightClavicle", "clavicle_r", "clavicle_r"), ("RightArm", "upperarm_r", "hand_r"),
                 ("LeftLeg", "thigh_l", "ball_l"), ("RightLeg", "thigh_r", "ball_r")) + tuple(
    (("Left" if side == "l" else "Right") + finger.capitalize(), "%s_01_%s" % (finger, side), "%s_03_%s" % (finger, side))
    for side in ("l", "r") for finger in ("thumb", "index", "middle", "ring", "pinky"))
MANUAL_RETARGET = (
    "Retarget by hand: in the Content Browser select an athlete's AnimSequence under {clips}, "
    "right-click > Retarget Animations, choose that athlete's imported JQ_<Role>_Body as the "
    "source mesh and {target} as the target mesh, pick or let the dialog generate an IK "
    "Retargeter, and export to a new folder. The Defender's imported bone names carry a 32-hex "
    "suffix, so map its IK Rig chains by hand. See docs/video-motion.md.")


def missing_apis(names):
    """The dotted unreal.* names that this Editor does not have."""
    missing = []
    for name in names:
        owner = unreal
        for part in name.split("."):
            owner = getattr(owner, part, None)
            if owner is None:
                missing.append("unreal." + name)
                break
    return missing


def _optional(owner, method, *args):
    """Call an optional, version-dependent API; record what happened instead of failing."""
    function = getattr(owner, method, None)
    if function is None:
        return "not available in this Editor"
    try:
        result = function(*args)
    except Exception as error:
        return "failed: %s: %s" % (type(error).__name__, error)
    return "applied" if result is None or result is True else "returned %r" % (result,)


def _new_asset(tools, name, folder, asset_class, factory):
    asset = tools.create_asset(name, folder, asset_class, factory)
    check(asset is not None, "Could not create %s/%s" % (folder, name))
    return asset


def _batch_retarget(api, animation, source_mesh, target_mesh, retargeter, folder, suffix):
    data = unreal.EditorAssetLibrary.find_asset_data(animation.get_path_name())
    unapplied = []
    if api == "run_batch_retarget":
        inputs = unreal.IKRetargetBatchOperationInputs()
        for name, value in (("assets_to_retarget", [data]), ("source_mesh", source_mesh),
                            ("target_mesh", target_mesh), ("ik_retarget_asset", retargeter)):
            inputs.set_editor_property(name, value)
        for name, value in (("target_path", folder), ("use_source_path", False), ("suffix", suffix),
                            ("include_referenced_assets", False), ("overwrite_existing_files", False)):
            try:
                inputs.set_editor_property(name, value)
            except Exception:
                unapplied.append(name)
        created = unreal.IKRetargetBatchOperation.run_batch_retarget(inputs)
    else:
        created = unreal.IKRetargetBatchOperation.duplicate_and_retarget(
            [data], source_mesh, target_mesh, retargeter, "", "", "", suffix, False)
    assets = [item.get_asset() if hasattr(item, "get_asset") else item for item in (created or [])]
    return [asset for asset in assets if asset is not None], unapplied


def _retarget_role(role, body, target, target_rig, folder, tools, api, fps):
    component, mesh, animation = body
    bones = [str(component.get_bone_name(i)) for i in range(component.get_num_bones())]

    def bone(name):
        # Interchange gives the Defender's duplicate joint names a 32-hex suffix (capture_pilot).
        found = [b for b in bones if re.fullmatch(re.escape(name) + r"(?:_[0-9a-f]{32})?", b)]
        check(len(found) == 1, "Bone %s is missing or ambiguous on %s" % (name, mesh.get_path_name()))
        return found[0]
    rig = _new_asset(tools, "IK_JQ_" + role, folder, unreal.IKRigDefinition, unreal.IKRigDefinitionFactory())
    controller = unreal.IKRigController.get_controller(rig)
    check(controller.set_skeletal_mesh(mesh), "The source mesh could not be assigned to " + rig.get_path_name())
    check(controller.set_retarget_root(bone("pelvis")) is not False, "Could not set the retarget root")
    chains = []
    for chain, start, end in SOURCE_CHAINS:
        created = controller.add_retarget_chain(chain, bone(start), bone(end), "")
        check(str(created) not in ("", "None"), "Could not add retarget chain " + chain)
        chains.append({"chain": str(created), "start": bone(start), "end": bone(end)})
    retargeter = _new_asset(tools, "RTG_JQ_%s_To_%s" % (role, target.get_name()), folder,
                            unreal.IKRetargeter, unreal.IKRetargetFactory())
    rtg = unreal.IKRetargeterController.get_controller(retargeter)
    rtg.set_ik_rig(unreal.RetargetSourceOrTarget.SOURCE, rig)
    rtg.set_ik_rig(unreal.RetargetSourceOrTarget.TARGET, target_rig)
    optional = {
        # UE 5.6+ retargets with a stack of ops; this adds the default stack, keeping existing ops.
        "add_default_ops": _optional(rtg, "add_default_ops"),
        "assign_ik_rig_to_all_ops(source)": _optional(rtg, "assign_ik_rig_to_all_ops",
                                                      unreal.RetargetSourceOrTarget.SOURCE, rig),
        "assign_ik_rig_to_all_ops(target)": _optional(rtg, "assign_ik_rig_to_all_ops",
                                                      unreal.RetargetSourceOrTarget.TARGET, target_rig)}
    rtg.auto_map_chains(unreal.AutoMapChainType.FUZZY, True)
    # Bring the target's retarget pose to the source's (e.g. A pose against the rig's rest pose).
    optional["auto_align_all_bones(target)"] = _optional(rtg, "auto_align_all_bones",
                                                         unreal.RetargetSourceOrTarget.TARGET)
    for asset in (rig, retargeter):
        check(unreal.EditorAssetLibrary.save_loaded_asset(asset, only_if_is_dirty=False),
              "Could not save " + asset.get_path_name())
    outputs, unapplied = _batch_retarget(api, animation, mesh, target, retargeter, folder + "/Animations",
                                         "_RT_" + target.get_name())
    check(outputs, "The batch retarget returned no assets; look in %s/Animations and beside %s"
          % (folder, animation.get_path_name()))
    rows = []
    target_skeleton = target.get_editor_property("skeleton")
    for asset in outputs:
        check(isinstance(asset, unreal.AnimSequence), "The retarget made something other than an AnimSequence")
        check(asset.get_editor_property("skeleton") == target_skeleton,
              "A retargeted animation is not on the target's skeleton: " + asset.get_path_name())
        check(unreal.EditorAssetLibrary.save_loaded_asset(asset, only_if_is_dirty=False),
              "Could not save " + asset.get_path_name())
        length = float(asset.get_editor_property("sequence_length"))
        rows.append({"asset": asset.get_path_name(), "sequenceLengthSeconds": length,
                     "framesAtSourceRate": int(round(length * fps))})
    return {"status": "completed", "sourceAnimation": animation.get_path_name(),
            "sourceMesh": mesh.get_path_name(), "sourceIkRig": rig.get_path_name(),
            "retargetRoot": bone("pelvis"), "chains": chains, "retargeter": retargeter.get_path_name(),
            "optionalSteps": optional, "batchInputsNotApplied": unapplied, "outputs": rows}


def retarget_animations(report, request, content, clips, bodies, fps):
    """UNTESTED: retarget each athlete's AnimSequence onto request["retargetTarget"]."""
    result = report.data["retarget"] = {
        "requested": True, "untested": True, "status": "started", "target": request["retargetTarget"],
        "travelInAnimation": False,
        "note": "The athletes' travel and turn (the JQ_<Role> node motion) is on the actor transform "
                "tracks of the imported LevelSequence, not in the AnimSequences; retargeted "
                "animations play in place."}
    manual = MANUAL_RETARGET.format(clips=clips, target=request["retargetTarget"])
    required = list(RETARGET_APIS)
    if not request["retargetTargetIkRig"]:
        required.append("IKRigController.apply_auto_generated_retarget_definition")
    missing = missing_apis(required)
    api = next((name for name, names in BATCH_APIS if not missing_apis(names)), None)
    if api is None:
        missing.append("unreal.IKRetargetBatchOperation.run_batch_retarget "
                       "(or the older unreal.IKRetargetBatchOperation.duplicate_and_retarget)")
    if missing:
        result.update(status="unavailable", missingApis=missing)
        raise RetargetError("This Editor lacks the Python API the retarget needs: %s. The import itself "
                            "completed and was saved. %s" % (", ".join(missing), manual))
    result["batchApi"] = api
    check(set(bodies) == set(ROLES), "The retarget needs both athletes' imported JQ_<Role>_Body meshes")
    target = unreal.load_asset(request["retargetTarget"])
    check(isinstance(target, unreal.SkeletalMesh), "--retarget-target is not a SkeletalMesh: "
          + request["retargetTarget"])
    folder = content + "/Retarget"
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    if request["retargetTargetIkRig"]:
        target_rig = unreal.load_asset(request["retargetTargetIkRig"])
        check(isinstance(target_rig, unreal.IKRigDefinition),
              "--retarget-target-ik-rig is not an IK Rig: " + request["retargetTargetIkRig"])
        result["targetIkRig"] = {"asset": target_rig.get_path_name(), "generated": False}
    else:
        target_rig = _new_asset(tools, "IK_RetargetTarget", folder, unreal.IKRigDefinition,
                                unreal.IKRigDefinitionFactory())
        controller = unreal.IKRigController.get_controller(target_rig)
        check(controller.set_skeletal_mesh(target), "The target mesh could not be assigned to its IK Rig")
        check(controller.apply_auto_generated_retarget_definition(),
              "UE did not recognise the target's skeleton as one of its templates; make an IK Rig for "
              "it by hand and pass --retarget-target-ik-rig. " + manual)
        result["targetIkRig"] = {"asset": target_rig.get_path_name(), "generated": True,
                                 "autoFullBodyIk": _optional(controller, "apply_auto_fbik")}
        check(unreal.EditorAssetLibrary.save_loaded_asset(target_rig, only_if_is_dirty=False),
              "Could not save " + target_rig.get_path_name())
    roles, errors = {}, []
    for role in ROLES:
        try:
            roles[role] = _retarget_role(role, bodies[role], target, target_rig, folder, tools, api, fps)
        except Exception as error:
            roles[role] = {"status": "failed", "error": "%s: %s" % (type(error).__name__, error)}
            errors.append("%s (%s)" % (role, error))
        result["roles"] = roles
    unreal.EditorAssetLibrary.save_directory(folder, only_if_is_dirty=True, recursive=True)
    if errors:
        result["status"] = "failed"
        raise RetargetError("The retarget failed for %s. The import itself completed and was saved. %s"
                            % ("; ".join(errors), manual))
    result["status"] = "completed"
    return result


# ---------------------------------------------------------------- main

def main(report, argv, environ, now):
    with report.step("read request"):
        request, source, others = resolve_request(argv, environ)
        report.data["request"] = {**request, "source": source, "otherSourcesPresent": others,
                                  "argv": list(argv)}
    with report.step("check editor"):
        version = unreal.SystemLibrary.get_engine_version()
        report.data["engineVersion"] = version
        check(version.startswith("5.8."), "This script targets UE5.8; revalidate its APIs before changing version")
    with report.step("read source GLB"):
        glb = Path(request["glb"])
        check(glb.is_file(), "The GLB does not exist: " + str(glb))
        raw = glb.read_bytes()
        summary = summarize_glb(raw)
        framing = summary.pop("framing")
        report.data["source"] = {"path": str(glb), "bytes": len(raw), "sha256": digest(raw), **summary}
        unreal.log("JiuQuest video motion source review status: %s" % summary["reviewStatus"])
    clip, stamp = request["clip"], run_stamp(now)
    content = content_root(clip, stamp)
    with report.step("claim run"):
        report.claim(run_directory(report.project, clip, stamp))
        report.data.update(status="importing", clip=clip, runStamp=stamp, contentRoot=content)
        check(not unreal.EditorAssetLibrary.does_directory_exist(content),
              "Refusing to overwrite an earlier import: " + content)
    with report.step("prepare import source"):
        derived, selection = select_hair(raw, request["hair"])
        import_file = report.path.parent / "source" / (clip + ".glb")
        import_file.parent.mkdir()
        with open(import_file, "xb") as stream:
            stream.write(derived)
        report.data["importSource"] = {"path": str(import_file), "bytes": len(derived),
                                       "sha256": digest(derived), "hairSelection": selection}
    level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    with report.step("create review game mode"):
        game_mode = make_review_game_mode(report, content)
    with report.step("create review map"):
        map_path = content + "/Maps/" + clip
        check(level.new_level(map_path), "Could not create review map")
        world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
        settings = world.get_world_settings()
        settings.set_editor_property("default_game_mode", game_mode)
        check(settings.get_editor_property("default_game_mode") == game_mode, "Review game mode assignment failed")
        report.data["map"] = map_path
    with report.step("Interchange scene import"):
        target, assets, animations = import_glb(level, content, clip, import_file)
        report.data["clipFolder"] = target
    with report.step("bind athlete animations"):
        components, bindings, bodies, used = bind_animations(actors, animations, report.data["source"])
        report.data.update(components=components, animations=used,
                           bodyComponents={role: row[0].get_path_name() for role, row in bodies.items()})
    with report.step("shared level sequence"):
        report.data["sharedSequence"] = make_shared_sequence(assets, bindings, actors, world, report.data["source"])
    with report.step("review stage and camera"):
        report.data["stage"] = add_stage(actors, framing)
    with report.step("save review map"):
        check(level.save_current_level(), "Review map save failed")
        unreal.EditorAssetLibrary.save_directory(target, only_if_is_dirty=True, recursive=True)
        report.data.update(importCompleted=True, animationBindingsAssigned=True,
                           requiredReview="Play the map or the shared sequence and compare both athletes "
                                          "with the source video at every frame; check contact and timing")
    if request["retargetTarget"]:
        report.data["status"] = "retargeting"
        with report.step("retarget"):
            retarget_animations(report, request, content, target, bodies, report.data["source"]["fps"])
    else:
        report.data["retarget"] = {"requested": False}
    report.complete()


def project_directory():
    try:
        return Path(unreal.Paths.project_dir()).resolve()
    except Exception:
        return HERE.parents[1]


def run(argv=None, environ=None, now=None):
    """Run one import; returns the report data. Like import_pilot, a failure is written to the
    report with its step and traceback, then raised again so that the Editor log shows it."""
    argv = list(getattr(sys, "argv", [])[1:] if argv is None else argv)
    environ = os.environ if environ is None else environ
    now = now or utc_now()
    report = Report(project_directory(), now)
    try:
        main(report, argv, environ, now)
    except Exception as error:
        report.fail(error)
        raise
    return report.data


if __name__ == "__main__":
    run()
