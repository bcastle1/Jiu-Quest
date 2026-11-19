"""Write a paired choreography GLB whose animation comes from a motion file.

A paired template (public/animations/bjj/<clip>.glb) holds two athletes, JQ_Attacker and
JQ_Defender, each a 65-joint skin (see rig.py). write_paired_glb() copies a template and
replaces only its animation:

* Every animation of the template is removed, with every accessor and bufferView that only
  animations use. The other accessors and bufferViews keep their order and are re-indexed.
  Each kept bufferView keeps its exact bytes (images, vertex attributes, indices, inverse
  bind matrices); they are packed in their original byte order at 4-byte aligned offsets.
  Nodes, meshes, skins, materials, textures, images, samplers, the asset block and the
  extensions are copied unchanged apart from those indices.
* One animation named "Animation" is added. All of its samplers share one input accessor
  (the key times, with min and max) and interpolate LINEAR. It drives translation, rotation
  and scale of exactly the nodes the template animates: JQ_<Role> and the 65 joints of its
  skin, for both roles. Scale is each node's rest scale, held constant. A joint's
  translation is the motion's joint_translation when given, else its rest translation.
  Rotations are normalized and made sign-continuous over time. Values are float32.
* The default scene's extras keep their keys. JQ_motion_type and JQ_review_status are set
  (defaults below), and JQ_source_note when one is given.

The motion follows the motion file contract (motion.npz, written by the fitter):

    fps            float scalar, e.g. 30.0
    times          (F,) key times in seconds; F >= 2, strictly increasing. By convention
                   times[i] = (i + 1) / fps, as in the templates.
    source_frames  (F,) int, the source video frame of each key (informational; optional)
    for R in JQ_Attacker, JQ_Defender:
      R__node_translation  (F,3)    translation of node R (its parent JQ_Pair is identity)
      R__node_rotation     (F,4)    rotation (x, y, z, w) of node R
      R__joint_names       (J,) str joint names, in the order of the skin's joints
      R__joint_rotation    (F,J,4)  local rotation (x, y, z, w) of each joint node
      R__joint_translation (F,J,3)  optional; default: the template's rest translation

A motion that breaks the contract is refused with a MotionError that names the problem: a
missing or unknown key, a wrong shape, a non-finite value, a zero-length quaternion, joint
names that differ from the template skin's joint order, fewer than two keys, or times that
do not strictly increase. Nothing is written then.

read_motion_from_glb() goes the other way: it samples a paired GLB's animation at its key
times and returns a motion dict, for round-trip tests and as a starting point for a fit.

Command line, from the repository root:

    python3 tools/video_motion/write_paired_glb.py \\
        --template public/animations/bjj/double_leg.glb --motion motion.npz --out out.glb \\
        [--motion-type video-reference-fit] [--review-status "..."] [--source-note "..."]

Standard library and NumPy only.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import struct
import sys
import warnings

import numpy as np

try:  # imported as tools.video_motion.write_paired_glb
    from . import rig
except ImportError:  # run as a script, or imported with tools/video_motion on sys.path
    import rig

ROLES = ("JQ_Attacker", "JQ_Defender")
ANIMATION_NAME = "Animation"
PATHS = ("translation", "rotation", "scale")
DEFAULT_MOTION_TYPE = "video-reference-fit"
DEFAULT_REVIEW_STATUS = ("VIDEO-DERIVED DRAFT - fitted from a reference video; "
                         "requires qualified BJJ coach review")

ROLE_FIELDS = ("node_translation", "node_rotation", "joint_names", "joint_rotation",
               "joint_translation")
MOTION_KEYS = ("fps", "times", "source_frames") + tuple(
    f"{role}__{field}" for role in ROLES for field in ROLE_FIELDS)
OPTIONAL_KEYS = frozenset(["source_frames"] + [f"{role}__joint_translation" for role in ROLES])

FLOAT32 = 5126
GLB_MAGIC, GLB_VERSION = 0x46546C67, 2
CHUNK_JSON, CHUNK_BIN = 0x4E4F534A, 0x004E4942
ACCESSOR_TYPE = {1: "SCALAR", 3: "VEC3", 4: "VEC4"}

# Extensions whose JSON never refers to accessors, bufferViews or buffers, so dropping the
# animation's accessors cannot leave them pointing at the wrong data. A template that uses
# any other extension (Draco, meshopt, GPU instancing, ...) is refused.
SAFE_EXTENSIONS = ("KHR_materials_", "KHR_texture_transform", "KHR_texture_basisu",
                   "KHR_lights_punctual", "KHR_mesh_quantization", "EXT_texture_webp",
                   "EXT_texture_avif")


class MotionError(ValueError):
    """The motion breaks the motion file contract or does not fit the template."""


class TemplateError(ValueError):
    """The template is not a paired GLB this writer can copy."""


def read_glb(path):
    """rig.read_glb(path) -> (gltf, bin). rig.read_glb leaves its file for the garbage
    collector to close, which is harmless but warns under unittest; the warning is muted."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ResourceWarning)
        return rig.read_glb(os.fspath(path))


# ---------------------------------------------------------------- motion validation

def _as_float(value, name, shape):
    try:
        array = np.array(value, dtype=np.float64)
    except (TypeError, ValueError) as error:
        raise MotionError(f"{name} must be numeric ({error})") from None
    if array.shape != shape:
        raise MotionError(f"{name} has shape {array.shape}; expected {shape}")
    bad = np.argwhere(~np.isfinite(array))
    if len(bad):
        where = tuple(int(i) for i in bad[0])
        raise MotionError(f"{name} has a non-finite value (NaN or infinity) at index {where}")
    return array


def _unit_quaternions(q, name):
    norm = np.linalg.norm(q, axis=-1, keepdims=True)
    small = np.argwhere(norm[..., 0] < 1e-6)
    if len(small):
        where = tuple(int(i) for i in small[0])
        raise MotionError(f"{name} has a zero-length quaternion at index {where}")
    return rig.make_quat_continuous(q / norm)


def _joint_names(value, name):
    array = np.asarray(value)
    if array.ndim != 1:
        raise MotionError(f"{name} must be a 1-D array of joint names; got shape {array.shape}")
    return [x.decode("utf-8") if isinstance(x, bytes) else str(x) for x in array.tolist()]


def validate_motion(motion, rigs):
    """Check a motion (dict or np.load result) against the contract and the template's rigs.

    Returns {"times": (F,), role: {"node_t", "node_r", "joint_t", "joint_r"}} as float64
    arrays, every quaternion normalized and sign-continuous over time, and the template's
    rest translation in joint_t where the motion gives none. Raises MotionError otherwise.
    """
    keys = set(motion.keys())
    missing = [k for k in MOTION_KEYS if k not in keys and k not in OPTIONAL_KEYS]
    if missing:
        raise MotionError(f"motion lacks {', '.join(missing)}")
    unknown = sorted(keys - set(MOTION_KEYS))
    if unknown:
        raise MotionError(f"motion has unknown keys {', '.join(unknown)}; "
                          f"the contract allows {', '.join(MOTION_KEYS)}")

    try:
        fps = np.array(motion["fps"], dtype=np.float64)
    except (TypeError, ValueError) as error:
        raise MotionError(f"fps must be a number ({error})") from None
    if fps.size != 1 or not np.isfinite(fps).all() or fps.item() <= 0:
        raise MotionError(f"fps must be one positive finite number; got {fps.tolist()!r}")

    times = np.asarray(motion["times"])
    if times.ndim != 1:
        raise MotionError(f"times must be 1-D; got shape {times.shape}")
    count = len(times)
    if count < 2:
        raise MotionError(f"times has {count} key(s); an animation needs at least 2")
    times = _as_float(times, "times", (count,))
    if times[0] < 0:
        raise MotionError(f"times[0] is {float(times[0])!r}; glTF key times must not be negative")
    steps = np.diff(times)
    if (steps <= 0).any():
        i = int(np.argmax(steps <= 0)) + 1
        raise MotionError(f"times must strictly increase; times[{i}] = {float(times[i])!r} "
                          f"follows times[{i - 1}] = {float(times[i - 1])!r}")
    if (np.diff(times.astype(np.float32)) <= 0).any():
        raise MotionError("times are too close together to stay strictly increasing as float32")
    if "source_frames" in keys:
        frames = _as_float(motion["source_frames"], "source_frames", (count,))
        if (frames != np.round(frames)).any():
            raise MotionError("source_frames must be whole frame numbers")

    clean = {"times": times}
    for role in ROLES:
        r = rigs[role]
        joints = len(r.joint_names)
        key = f"{role}__joint_names"
        names = _joint_names(motion[key], key)
        if names != r.joint_names:
            if len(names) != joints:
                detail = f"it has {len(names)} names; the template skin has {joints} joints"
            else:
                i = next(i for i, (a, b) in enumerate(zip(names, r.joint_names)) if a != b)
                detail = f"position {i} is {names[i]!r} where the skin has {r.joint_names[i]!r}"
            raise MotionError(
                f"{key} does not match the joint order of the template's {role} skin: {detail}. "
                f"Joint arrays must follow the skin's joint order "
                f"({', '.join(r.joint_names[:5])}, ...).")
        key = f"{role}__node_translation"
        node_t = _as_float(motion[key], key, (count, 3))
        key = f"{role}__node_rotation"
        node_r = _unit_quaternions(_as_float(motion[key], key, (count, 4)), key)
        key = f"{role}__joint_rotation"
        joint_r = _unit_quaternions(_as_float(motion[key], key, (count, joints, 4)), key)
        key = f"{role}__joint_translation"
        if key in keys:
            joint_t = _as_float(motion[key], key, (count, joints, 3))
        else:
            joint_t = np.broadcast_to(r.rest_t, (count, joints, 3))
        clean[role] = {"node_t": node_t, "node_r": node_r, "joint_t": joint_t, "joint_r": joint_r}
    return clean


# ---------------------------------------------------------------- template surgery

def _check_template(gltf):
    buffers = gltf.get("buffers") or []
    if len(buffers) != 1 or "uri" in buffers[0]:
        raise TemplateError("the template must be a GLB whose only buffer is its BIN chunk")
    unknown = [e for e in gltf.get("extensionsUsed", []) if not e.startswith(SAFE_EXTENSIONS)]
    if unknown:
        raise TemplateError(f"the template uses {', '.join(unknown)}; this writer re-indexes "
                            "core glTF accessors and bufferViews only and refuses extensions "
                            "that may refer to them")
    if not gltf.get("scenes"):
        raise TemplateError("the template has no scene")


def _animated_nodes(gltf, rigs):
    """The nodes the template animates, in the order of its channels, as (node, role, joint);
    joint is None for the role node. They must be exactly JQ_<Role> and its skin's joints."""
    contract = {}
    for role in ROLES:
        r = rigs[role]
        contract[r.role_node] = (role, None)
        for j, node in enumerate(r.node_index):
            contract[int(node)] = (role, j)
    order = []
    for animation in gltf.get("animations", []):
        for channel in animation.get("channels", []):
            node = channel.get("target", {}).get("node")
            if node not in order:
                order.append(node)
    names = [n.get("name") for n in gltf["nodes"]]
    extra = [names[n] if isinstance(n, int) else repr(n) for n in order if n not in contract]
    missing = [names[n] for n in contract if n not in order]
    if extra or missing:
        raise TemplateError("the template must animate exactly JQ_Attacker, JQ_Defender and "
                            f"their skin joints; it also animates {extra or 'nothing else'} "
                            f"and leaves out {missing or 'none'}")
    return [(node,) + contract[node] for node in order]


def _accessors_outside_animations(gltf):
    used = set()
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            used.update(prim.get("attributes", {}).values())
            if "indices" in prim:
                used.add(prim["indices"])
            for target in prim.get("targets", []):
                used.update(target.values())
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            used.add(skin["inverseBindMatrices"])
    return used


def _views_of(accessor):
    views = {accessor["bufferView"]} if "bufferView" in accessor else set()
    sparse = accessor.get("sparse")
    if sparse:
        views.update((sparse["indices"]["bufferView"], sparse["values"]["bufferView"]))
    return views


def _reindex(gltf, accessor_map, view_map):
    for accessor in gltf.get("accessors", []):
        if "bufferView" in accessor:
            accessor["bufferView"] = view_map[accessor["bufferView"]]
        sparse = accessor.get("sparse")
        if sparse:
            for part in ("indices", "values"):
                sparse[part]["bufferView"] = view_map[sparse[part]["bufferView"]]
    for image in gltf.get("images", []):
        if "bufferView" in image:
            image["bufferView"] = view_map[image["bufferView"]]
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            for table in [prim.get("attributes", {})] + prim.get("targets", []):
                for name in table:
                    table[name] = accessor_map[table[name]]
            if "indices" in prim:
                prim["indices"] = accessor_map[prim["indices"]]
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = accessor_map[skin["inverseBindMatrices"]]


def _strip_animations(gltf, binary):
    """Empty gltf["animations"], drop the accessors and bufferViews only animations use,
    re-index the rest and return the BIN data of the kept bufferViews as a bytearray. Each
    keeps its exact bytes, in the original byte order, at a 4-byte aligned offset; where
    the template was packed that way (Blender's exporter does) the offsets do not change."""
    accessors, views = gltf.get("accessors", []), gltf.get("bufferViews", [])
    animated = set()
    for animation in gltf.get("animations", []):
        for sampler in animation.get("samplers", []):
            animated.update((sampler["input"], sampler["output"]))
    gltf["animations"] = []
    dropped = animated - _accessors_outside_animations(gltf)
    kept = [i for i in range(len(accessors)) if i not in dropped]
    still_used = set().union(*(_views_of(accessors[i]) for i in kept))
    still_used.update(im["bufferView"] for im in gltf.get("images", []) if "bufferView" in im)
    dropped_views = set().union(*(_views_of(accessors[i]) for i in dropped)) - still_used
    kept_views = [v for v in range(len(views)) if v not in dropped_views]

    data, offsets = bytearray(), {}
    for v in sorted(kept_views, key=lambda v: (views[v].get("byteOffset", 0), v)):
        data.extend(bytes(-len(data) % 4))
        start = views[v].get("byteOffset", 0)
        offsets[v] = len(data)
        data.extend(binary[start:start + views[v]["byteLength"]])
    for v in kept_views:
        if "byteOffset" in views[v] or offsets[v]:
            views[v]["byteOffset"] = offsets[v]
    gltf["accessors"] = [accessors[i] for i in kept]
    gltf["bufferViews"] = [views[v] for v in kept_views]
    _reindex(gltf, {old: new for new, old in enumerate(kept)},
             {old: new for new, old in enumerate(kept_views)})
    return data


def _append_animation(gltf, data, targets, clean):
    """Add the animation "Animation" to gltf, its float32 data appended to `data`."""
    accessors, views = gltf.setdefault("accessors", []), gltf.setdefault("bufferViews", [])

    def add(values, bounds=False):
        values = np.ascontiguousarray(values, dtype="<f4")
        data.extend(bytes(-len(data) % 4))
        views.append({"buffer": 0, "byteLength": values.nbytes, "byteOffset": len(data)})
        data.extend(values.tobytes())
        accessor = {"bufferView": len(views) - 1, "componentType": FLOAT32, "count": len(values)}
        if bounds:  # the stored float32 values, so the bounds match the data exactly
            accessor["max"] = [float(values.max())]
            accessor["min"] = [float(values.min())]
        accessor["type"] = ACCESSOR_TYPE[1 if values.ndim == 1 else values.shape[1]]
        accessors.append(accessor)
        return len(accessors) - 1

    count = len(clean["times"])
    times = add(clean["times"], bounds=True)
    channels, samplers = [], []
    for node, role, joint in targets:
        motion = clean[role]
        if joint is None:
            translation, rotation = motion["node_t"], motion["node_r"]
        else:
            translation, rotation = motion["joint_t"][:, joint], motion["joint_r"][:, joint]
        scale = np.broadcast_to(rig.node_trs(gltf["nodes"][node])[2], (count, 3))
        for path, values in zip(PATHS, (translation, rotation, scale)):
            samplers.append({"input": times, "interpolation": "LINEAR", "output": add(values)})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})
    gltf["animations"] = [{"channels": channels, "name": ANIMATION_NAME, "samplers": samplers}]
    return len(channels)


def _set_scene_extras(gltf, extras):
    scene = gltf["scenes"][gltf.get("scene", 0)]
    merged = scene.get("extras", {})
    if not isinstance(merged, dict):
        raise TemplateError("the template's scene extras are not an object")
    merged = dict(merged)
    merged["JQ_motion_type"] = DEFAULT_MOTION_TYPE
    merged["JQ_review_status"] = DEFAULT_REVIEW_STATUS
    for key, value in (extras or {}).items():
        if value is not None:
            merged[key] = value
    scene["extras"] = merged


def _write_glb(path, gltf, data):
    text = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    text = text.encode("utf-8")
    text += b" " * (-len(text) % 4)          # JSON chunk: pad with spaces
    data = bytes(data) + bytes(-len(data) % 4)  # BIN chunk: pad with zeros
    length = 12 + 8 + len(text) + 8 + len(data)
    blob = b"".join((struct.pack("<III", GLB_MAGIC, GLB_VERSION, length),
                     struct.pack("<II", len(text), CHUNK_JSON), text,
                     struct.pack("<II", len(data), CHUNK_BIN), data))
    # Write beside the target and rename, so a failure never leaves a half-written GLB.
    temporary = f"{path}.{os.getpid()}.tmp"
    try:
        with open(temporary, "wb") as stream:
            stream.write(blob)
        os.replace(temporary, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)
        raise
    return length


def write_paired_glb(template_path, motion, out_path, extras=None):
    """Copy the paired template GLB with its animation replaced by `motion` (see the module
    docstring). `extras` are scene extras to set on top of the defaults (JQ_motion_type,
    JQ_review_status, JQ_source_note, ...); keys whose value is None are ignored. The motion
    is validated before anything is written. Returns a summary dict."""
    template_path, out_path = os.fspath(template_path), os.fspath(out_path)
    if os.path.exists(out_path) and os.path.samefile(template_path, out_path):
        raise TemplateError(f"the output path is the template itself ({template_path}); "
                            "write to another path")
    gltf, binary = read_glb(template_path)
    _check_template(gltf)
    rigs = {role: rig.load_rig(gltf, binary, role) for role in ROLES}
    targets = _animated_nodes(gltf, rigs)
    clean = validate_motion(motion, rigs)
    data = _strip_animations(gltf, binary)
    channels = _append_animation(gltf, data, targets, clean)
    gltf["buffers"][0]["byteLength"] = len(data)
    _set_scene_extras(gltf, extras)
    size = _write_glb(out_path, gltf, data)
    times = clean["times"].astype(np.float32)
    return {"path": out_path, "keys": len(times), "start": float(times[0]),
            "end": float(times[-1]), "channels": channels, "bytes": size,
            "template_bytes": os.path.getsize(template_path)}


# ---------------------------------------------------------------- sampling and reading

def _slerp(a, b, u):
    a = a / np.linalg.norm(a, axis=-1, keepdims=True)
    b = b / np.linalg.norm(b, axis=-1, keepdims=True)
    dot = np.sum(a * b, axis=-1)
    b = np.where(dot[:, None] < 0, -b, b)  # the shorter arc
    theta = np.arccos(np.clip(np.abs(dot), 0.0, 1.0))
    sin = np.sin(theta)
    near = sin < 1e-6
    safe = np.where(near, 1.0, sin)
    wa = np.where(near, 1.0 - u, np.sin((1.0 - u) * theta) / safe)
    wb = np.where(near, u, np.sin(u * theta) / safe)
    q = wa[:, None] * a + wb[:, None] * b
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def _evaluate(key_times, values, interpolation, path, times):
    """glTF 2.0 sampling: the end values hold before the first and after the last key, STEP
    holds the previous key, LINEAR interpolates linearly (rotation: slerp)."""
    count = len(key_times)
    if interpolation == "CUBICSPLINE":
        raise NotImplementedError("CUBICSPLINE samplers are not supported; "
                                  "the paired templates use LINEAR and STEP")
    if interpolation not in ("LINEAR", "STEP"):
        raise ValueError(f"unknown interpolation {interpolation!r}")
    values = values.reshape(count, -1)
    before = np.searchsorted(key_times, times, side="right") - 1  # last key at or before
    if interpolation == "STEP" or count == 1:
        return values[np.clip(before, 0, count - 1)]
    i = np.clip(before, 0, count - 2)
    u = np.clip((times - key_times[i]) / (key_times[i + 1] - key_times[i]), 0.0, 1.0)
    if path == "rotation":
        return _slerp(values[i], values[i + 1], u)
    return values[i] + (values[i + 1] - values[i]) * u[:, None]


def sample_animation(gltf, binary, times=None):
    """Evaluate the GLB's animation (the one named "Animation", else the first) at `times`.

    By default `times` are its key times: the union of its sampler inputs, with times less
    than a microsecond apart merged. Returns (times (F,), {node: {path: (F, n) float64}})
    for every node a channel drives; rotations are unit quaternions (x, y, z, w)."""
    animations = gltf.get("animations") or []
    if not animations:
        raise ValueError("the GLB has no animation")
    names = [a.get("name") for a in animations]
    animation = animations[names.index(ANIMATION_NAME) if ANIMATION_NAME in names else 0]
    inputs = {}

    def key_times(index):
        if index not in inputs:
            inputs[index] = rig.accessor(gltf, binary, index)[:, 0].astype(np.float64)
        return inputs[index]

    if times is None:
        merged = np.unique(np.concatenate([key_times(s["input"]) for s in animation["samplers"]]))
        times = merged[np.concatenate(([True], np.diff(merged) > 1e-6))]
    times = np.asarray(times, dtype=np.float64)
    sampled = {}
    for channel in animation["channels"]:
        target = channel["target"]
        if "node" not in target:
            continue
        sampler = animation["samplers"][channel["sampler"]]
        values = rig.accessor(gltf, binary, sampler["output"]).astype(np.float64)
        value = _evaluate(key_times(sampler["input"]), values,
                          sampler.get("interpolation", "LINEAR"), target["path"], times)
        if target["path"] == "rotation":
            value = value / np.linalg.norm(value, axis=-1, keepdims=True)
        sampled.setdefault(target["node"], {})[target["path"]] = value
    return times, sampled


def read_motion_from_glb(path):
    """Sample a paired GLB's animation at its key times as a motion dict (the contract in the
    module docstring, joint_translation included). Nodes or paths the animation does not
    drive get their rest values. fps is 1 / the median key step, rounded to 3 decimals. A
    GLB stores no source video frames, so source_frames is each key's frame number on that
    grid under the times[i] = (i + 1) / fps convention (0, 1, 2, ... for the templates)."""
    gltf, binary = read_glb(path)
    rigs = {role: rig.load_rig(gltf, binary, role) for role in ROLES}
    times, sampled = sample_animation(gltf, binary)
    count = len(times)
    fps = round(1.0 / float(np.median(np.diff(times))), 3) if count > 1 else 30.0
    motion = {"fps": np.float64(fps), "times": times,
              "source_frames": np.rint(times * fps).astype(np.int64) - 1}

    def channel(node, path, rest):
        values = sampled.get(int(node), {}).get(path)
        return np.tile(np.asarray(rest, dtype=np.float64), (count, 1)) if values is None else values

    for role in ROLES:
        r = rigs[role]
        motion[f"{role}__node_translation"] = channel(r.role_node, "translation", r.role_rest_t)
        motion[f"{role}__node_rotation"] = channel(r.role_node, "rotation", r.role_rest_r)
        motion[f"{role}__joint_names"] = np.array(r.joint_names)
        motion[f"{role}__joint_rotation"] = np.stack(
            [channel(n, "rotation", r.rest_r[j]) for j, n in enumerate(r.node_index)], axis=1)
        motion[f"{role}__joint_translation"] = np.stack(
            [channel(n, "translation", r.rest_t[j]) for j, n in enumerate(r.node_index)], axis=1)
    return motion


# ---------------------------------------------------------------- command line

def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Write a paired choreography GLB: the template with its animation "
                    "replaced by a fitted motion (motion.npz).")
    parser.add_argument("--template", required=True,
                        help="paired template GLB, e.g. public/animations/bjj/double_leg.glb")
    parser.add_argument("--motion", required=True, help="motion.npz (motion file contract)")
    parser.add_argument("--out", required=True, help="output GLB")
    parser.add_argument("--motion-type", default=DEFAULT_MOTION_TYPE,
                        help=f"scene extra JQ_motion_type (default {DEFAULT_MOTION_TYPE!r})")
    parser.add_argument("--review-status", default=DEFAULT_REVIEW_STATUS,
                        help="scene extra JQ_review_status (default: the video-derived draft notice)")
    parser.add_argument("--source-note", help="scene extra JQ_source_note, e.g. the source video")
    args = parser.parse_args(argv)
    extras = {"JQ_motion_type": args.motion_type, "JQ_review_status": args.review_status,
              "JQ_source_note": args.source_note}
    try:
        with np.load(args.motion, allow_pickle=False) as motion:
            summary = write_paired_glb(args.template, motion, args.out, extras)
    except (MotionError, TemplateError) as error:
        print(f"write_paired_glb: refused: {error}", file=sys.stderr)
        return 1
    print(f"wrote {summary['path']}: {summary['keys']} keys "
          f"({summary['start']:.4f} to {summary['end']:.4f} s), {summary['channels']} channels, "
          f"{summary['bytes']:,} bytes (template {summary['template_bytes']:,})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
