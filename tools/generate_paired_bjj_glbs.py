"""Generate JiuQuest-owned paired BJJ choreography GLBs.

The generated files are intentionally lightweight, self-contained GLB clips:
two articulated gi fighters, named material slots for profile customization,
and transform animation tracks that Three.js can play with AnimationMixer.

They are authored choreography, not motion capture.  The stable node/material
contract lets a future licensed two-actor mocap pack replace these files
one-for-one without changing the web app.
"""

from __future__ import annotations

import math
import os

import bpy


FPS = 30
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(ROOT, "public", "animations", "bjj")

MOVE_DURATIONS = {
    "standing_stance": 1.8,
    "grip_fighting": 2.2,
    "single_leg": 2.5,
    "double_leg": 2.5,
    "guard_pull": 2.2,
    "closed_guard": 2.2,
    "guard_pass": 2.6,
    "side_control": 2.2,
    "mount": 2.2,
    "back_control": 2.3,
    "armbar": 2.6,
    "triangle_choke": 2.7,
    "rear_naked_choke": 2.7,
    "tap_out": 1.6,
    "reset_neutral": 1.5,
}


def smooth(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def lerp(start: float, end: float, amount: float) -> float:
    return start + (end - start) * amount


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.actions, bpy.data.materials, bpy.data.meshes):
        for datablock in list(collection):
            collection.remove(datablock)


def make_material(name: str, color: tuple[float, float, float, float], roughness: float = 0.58) -> bpy.types.Material:
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    material.diffuse_color = color
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = 0.04
    return material


def add_empty(name: str, parent: bpy.types.Object | None = None, location=(0.0, 0.0, 0.0)) -> bpy.types.Object:
    empty = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(empty)
    empty.empty_display_type = "PLAIN_AXES"
    empty.empty_display_size = 0.08
    if parent:
        empty.parent = parent
    empty.location = location
    return empty


def apply_material(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def parent_local(obj: bpy.types.Object, parent: bpy.types.Object, location, rotation=(0.0, 0.0, 0.0)) -> bpy.types.Object:
    obj.parent = parent
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def add_sphere(name, parent, location, scale, material) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, location=(0.0, 0.0, 0.0))
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    apply_material(obj, material)
    return parent_local(obj, parent, location)


def add_box(name, parent, location, dimensions, material, bevel=0.03, rotation=(0.0, 0.0, 0.0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.0))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Soft edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    apply_material(obj, material)
    return parent_local(obj, parent, location, rotation)


def add_cylinder(name, parent, location, radius, depth, material, rotation=(0.0, 0.0, 0.0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=radius, depth=depth, location=(0.0, 0.0, 0.0))
    obj = bpy.context.object
    obj.name = name
    apply_material(obj, material)
    return parent_local(obj, parent, location, rotation)


def add_torus(name, parent, location, major_radius, minor_radius, material, rotation=(0.0, 0.0, 0.0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=24,
        minor_segments=6,
        location=(0.0, 0.0, 0.0),
    )
    obj = bpy.context.object
    obj.name = name
    apply_material(obj, material)
    return parent_local(obj, parent, location, rotation)


def make_fighter(role: str, colors: dict[str, tuple[float, float, float, float]]) -> dict:
    prefix = f"JQ_{role}"
    materials = {
        "gi_top": make_material(f"{prefix}_GiTop", colors["gi_top"], 0.5),
        "gi_pants": make_material(f"{prefix}_GiPants", colors["gi_pants"], 0.64),
        "skin": make_material(f"{prefix}_Skin", colors["skin"], 0.55),
        "hair": make_material(f"{prefix}_Hair", colors["hair"], 0.78),
        "belt": make_material(f"{prefix}_Belt", colors["belt"], 0.5),
        "stripe": make_material(f"{prefix}_BeltStripe", colors["stripe"], 0.56),
        "patch": make_material(f"{prefix}_Patch", (1.0, 1.0, 1.0, 1.0), 0.44),
    }
    root = add_empty(prefix)
    root["JQ_role"] = role.lower()
    pelvis = add_empty(f"{prefix}_Pelvis", root, (0.0, 0.0, 0.92))
    torso = add_empty(f"{prefix}_Torso", pelvis, (0.0, 0.0, 0.12))
    head = add_empty(f"{prefix}_Head", torso, (0.0, 0.0, 0.82))

    add_sphere(f"{prefix}_Hips", pelvis, (0.0, 0.0, 0.0), (0.29, 0.20, 0.16), materials["gi_pants"])
    add_box(f"{prefix}_Jacket", torso, (0.0, 0.0, 0.34), (0.66, 0.38, 0.72), materials["gi_top"], bevel=0.07)
    add_box(f"{prefix}_Lapel_L", torso, (-0.13, 0.205, 0.33), (0.09, 0.035, 0.5), materials["gi_top"], bevel=0.012, rotation=(0.0, -0.34, 0.0))
    add_box(f"{prefix}_Lapel_R", torso, (0.13, 0.205, 0.33), (0.09, 0.035, 0.5), materials["gi_top"], bevel=0.012, rotation=(0.0, 0.34, 0.0))
    add_torus(f"{prefix}_Belt", torso, (0.0, 0.0, 0.11), 0.32, 0.04, materials["belt"], rotation=(math.pi / 2, 0.0, 0.0))
    add_box(f"{prefix}_Belt_Knot", torso, (0.0, 0.23, 0.11), (0.14, 0.07, 0.09), materials["belt"], bevel=0.018)
    for index in range(4):
        add_box(
            f"{prefix}_BeltStripe_{index + 1}",
            torso,
            (0.075 + index * 0.03, 0.257, 0.11),
            (0.018, 0.012, 0.05),
            materials["stripe"],
            bevel=0.003,
        )
    add_cylinder(
        f"{prefix}_ChestPatch",
        torso,
        (0.0, 0.213, 0.43),
        0.085,
        0.012,
        materials["patch"],
        rotation=(math.pi / 2, 0.0, 0.0),
    )

    add_cylinder(f"{prefix}_Neck", head, (0.0, 0.0, -0.13), 0.085, 0.16, materials["skin"])
    add_sphere(f"{prefix}_HeadMesh", head, (0.0, 0.0, 0.10), (0.21, 0.19, 0.24), materials["skin"])
    add_sphere(f"{prefix}_HairMesh", head, (0.0, -0.018, 0.20), (0.215, 0.195, 0.13), materials["hair"])

    left_shoulder = add_empty(f"{prefix}_Shoulder_L", torso, (-0.40, 0.0, 0.52))
    left_elbow = add_empty(f"{prefix}_Elbow_L", left_shoulder, (0.0, 0.0, -0.43))
    right_shoulder = add_empty(f"{prefix}_Shoulder_R", torso, (0.40, 0.0, 0.52))
    right_elbow = add_empty(f"{prefix}_Elbow_R", right_shoulder, (0.0, 0.0, -0.43))
    for side, shoulder, elbow in (
        ("L", left_shoulder, left_elbow),
        ("R", right_shoulder, right_elbow),
    ):
        add_sphere(f"{prefix}_Sleeve_{side}", shoulder, (0.0, 0.0, -0.20), (0.12, 0.12, 0.25), materials["gi_top"])
        add_sphere(f"{prefix}_Forearm_{side}", elbow, (0.0, 0.0, -0.16), (0.085, 0.085, 0.20), materials["skin"])
        add_sphere(f"{prefix}_Hand_{side}", elbow, (0.0, 0.02, -0.35), (0.09, 0.07, 0.10), materials["skin"])

    left_hip = add_empty(f"{prefix}_Hip_L", pelvis, (-0.20, 0.0, -0.05))
    left_knee = add_empty(f"{prefix}_Knee_L", left_hip, (0.0, 0.0, -0.43))
    right_hip = add_empty(f"{prefix}_Hip_R", pelvis, (0.20, 0.0, -0.05))
    right_knee = add_empty(f"{prefix}_Knee_R", right_hip, (0.0, 0.0, -0.43))
    for side, hip, knee in (
        ("L", left_hip, left_knee),
        ("R", right_hip, right_knee),
    ):
        add_sphere(f"{prefix}_Thigh_{side}", hip, (0.0, 0.0, -0.20), (0.15, 0.15, 0.23), materials["gi_pants"])
        add_sphere(f"{prefix}_Shin_{side}", knee, (0.0, 0.0, -0.19), (0.11, 0.11, 0.22), materials["gi_pants"])
        add_sphere(f"{prefix}_Foot_{side}", knee, (0.0, 0.10, -0.43), (0.12, 0.19, 0.07), materials["skin"])

    controls = [
        root,
        pelvis,
        torso,
        head,
        left_shoulder,
        left_elbow,
        right_shoulder,
        right_elbow,
        left_hip,
        left_knee,
        right_hip,
        right_knee,
    ]
    base = {
        control.name: (
            control.location.copy(),
            control.rotation_euler.copy(),
            control.scale.copy(),
        )
        for control in controls
    }
    return {
        "role": role,
        "root": root,
        "pelvis": pelvis,
        "torso": torso,
        "head": head,
        "arm_l": (left_shoulder, left_elbow),
        "arm_r": (right_shoulder, right_elbow),
        "leg_l": (left_hip, left_knee),
        "leg_r": (right_hip, right_knee),
        "controls": controls,
        "base": base,
    }


def reset_fighter(fighter: dict) -> None:
    for control in fighter["controls"]:
        location, rotation, scale = fighter["base"][control.name]
        control.location = location
        control.rotation_euler = rotation
        control.scale = scale


def set_arm(fighter: dict, side: str, x: float, y: float, z: float, elbow: float = 0.0) -> None:
    shoulder, wrist = fighter[f"arm_{side.lower()}"]
    shoulder.rotation_euler = (x, y, z)
    wrist.rotation_euler = (elbow, 0.0, 0.0)


def set_leg(fighter: dict, side: str, x: float, y: float, z: float, knee: float = 0.0) -> None:
    hip, knee_joint = fighter[f"leg_{side.lower()}"]
    hip.rotation_euler = (x, y, z)
    knee_joint.rotation_euler = (knee, 0.0, 0.0)


def facing_angle(face: int) -> float:
    return -math.pi / 2 if face > 0 else math.pi / 2


def stance(fighter: dict, x: float, y: float, face: int, crouch: float = 0.0, lean: float = 0.0, stride: float = 0.0) -> None:
    root = fighter["root"]
    root.location = (x, y, -crouch * 0.1)
    root.rotation_euler = (0.0, 0.0, facing_angle(face))
    root.scale = (1.0 - crouch * 0.05,) * 3
    fighter["torso"].rotation_euler.x = -crouch * 0.34 + lean * 0.18
    fighter["head"].rotation_euler.x = crouch * 0.1 - lean * 0.06
    set_arm(fighter, "L", 0.64 + crouch * 0.46, 0.04, 0.34, 0.54)
    set_arm(fighter, "R", 0.64 + crouch * 0.46, -0.04, -0.34, 0.54)
    set_leg(fighter, "L", 0.10 + stride, 0.0, 0.13, 0.25 + crouch * 0.2)
    set_leg(fighter, "R", 0.10 - stride, 0.0, -0.13, 0.25 + crouch * 0.2)


def kneel(fighter: dict, x: float, y: float, face: int, lean: float = 0.0, roll: float = 0.0) -> None:
    root = fighter["root"]
    root.location = (x, y, -0.13)
    root.rotation_euler = (0.05 + lean * 0.08, 0.0, facing_angle(face) + roll)
    root.scale = (0.91, 0.91, 0.91)
    fighter["torso"].rotation_euler.x = 0.30 + lean
    fighter["head"].rotation_euler.x = -0.14
    set_arm(fighter, "L", 0.95 + lean * 0.26, 0.10, 0.38, 0.70)
    set_arm(fighter, "R", 0.95 + lean * 0.26, -0.10, -0.38, 0.70)
    set_leg(fighter, "L", 1.10, 0.0, 0.22, 1.34)
    set_leg(fighter, "R", 1.10, 0.0, -0.22, 1.34)


def ground(fighter: dict, x: float, y: float, face: int, roll: float = 0.0, scale: float = 0.96) -> None:
    root = fighter["root"]
    root.location = (x, y, 0.22)
    root.rotation_euler = (math.pi / 2, 0.0 if face > 0 else math.pi, roll)
    root.scale = (scale, scale, scale)
    fighter["torso"].rotation_euler.x = 0.12
    fighter["head"].rotation_euler.x = -0.12
    set_arm(fighter, "L", 0.58, 0.14, 0.60 * face, 0.80)
    set_arm(fighter, "R", 0.64, -0.14, -0.60 * face, 0.74)
    set_leg(fighter, "L", 0.74, 0.0, 0.40 * face, 0.92)
    set_leg(fighter, "R", 0.68, 0.0, -0.40 * face, 0.90)


def pose_pair(key: str, attacker: dict, defender: dict, progress: float) -> None:
    reset_fighter(attacker)
    reset_fighter(defender)
    p = smooth(progress)
    pulse = math.sin(progress * math.pi * 4.0) * 0.05

    if key == "standing_stance":
        stance(attacker, -0.90, 0.08, 1, 0.12 + abs(pulse), -0.03, 0.04)
        stance(defender, 0.90, -0.02, -1, 0.10 + abs(pulse), 0.03, -0.04)
    elif key == "grip_fighting":
        stance(attacker, lerp(-1.12, -0.42, p), 0.09, 1, 0.22 * p, -0.12 * p, 0.06)
        stance(defender, lerp(1.12, 0.42, p), -0.02, -1, 0.20 * p, 0.12 * p, -0.06)
        set_arm(attacker, "R", 1.20 + pulse, -0.20, -0.72, 1.05)
        set_arm(attacker, "L", 0.96, 0.18, 0.48, 0.76)
        set_arm(defender, "L", 1.18 - pulse, 0.20, 0.72, 1.05)
        set_arm(defender, "R", 0.96, -0.18, -0.48, 0.76)
    elif key in {"single_leg", "double_leg"}:
        if p < 0.64:
            q = smooth(p / 0.64)
            stance(attacker, lerp(-1.18, -0.08, q), 0.10, 1, (0.78 if key == "single_leg" else 0.88) * q, -0.18 * q, 0.18)
            stance(defender, lerp(1.10, 0.24, q), -0.04, -1, 0.18, 0.50 * q, -0.10)
            set_arm(attacker, "L", 1.52, 0.25, 0.35, 1.20)
            set_arm(attacker, "R", 1.48, -0.25, -0.35, 1.20)
        else:
            q = smooth((p - 0.64) / 0.36)
            kneel(attacker, lerp(-0.08, -0.24, q), 0.05, 1, 0.36, -0.08)
            ground(defender, lerp(0.24, 0.38, q), -0.02, -1, 0.32 * q, 0.95)
            set_arm(attacker, "L", 1.35, 0.22, 0.48, 1.15)
            set_arm(attacker, "R", 1.35, -0.22, -0.48, 1.15)
    elif key == "guard_pull":
        ground(attacker, lerp(-0.96, -0.08, p), 0.15, 1, -0.12, 0.98)
        kneel(defender, lerp(0.88, 0.30, p), -0.08, -1, 0.14 * p, 0.08)
        set_leg(attacker, "L", 1.26, 0.0, 1.12, 1.12)
        set_leg(attacker, "R", 1.22, 0.0, -1.12, 1.12)
        set_arm(attacker, "L", 1.08, 0.10, 0.62, 1.0)
        set_arm(attacker, "R", 1.10, -0.10, -0.62, 1.0)
    elif key == "closed_guard":
        ground(attacker, -0.06, 0.16, 1, -0.08 + pulse, 0.99)
        kneel(defender, 0.20, -0.02, -1, 0.28, 0.03)
        set_leg(attacker, "L", 1.48, 0.0, 1.22, 1.22)
        set_leg(attacker, "R", 1.48, 0.0, -1.22, 1.22)
        set_arm(defender, "L", 1.18, 0.10, 0.34, 0.95)
        set_arm(defender, "R", 1.18, -0.10, -0.34, 0.95)
    elif key == "guard_pass":
        kneel(attacker, lerp(-0.12, -0.52, p), -0.08, 1, 0.36, -0.18 * p)
        ground(defender, lerp(0.06, 0.38, p), 0.15, -1, 0.26 * p, 0.95)
        set_arm(attacker, "L", 1.28, 0.18, 0.56, 1.08)
        set_arm(attacker, "R", 1.48, -0.22, -0.54, 1.14)
        set_leg(attacker, "L", 1.34, 0.0, 0.28, 1.44)
    elif key == "side_control":
        ground(defender, 0.15, 0.14, -1, 0.0, 0.96)
        ground(attacker, -0.10, -0.04, 1, math.pi / 2 + pulse, 0.92)
        attacker["root"].location.z += 0.22
        set_arm(attacker, "L", 1.34, 0.22, 0.75, 1.10)
        set_arm(attacker, "R", 1.16, -0.28, -0.52, 1.02)
    elif key == "mount":
        ground(defender, 0.05, 0.10, -1, 0.0, 0.96)
        kneel(attacker, 0.02, -0.08, 1, 0.22, 0.0)
        attacker["root"].location.z += 0.06
        set_arm(attacker, "L", 1.32, 0.10, 0.32, 1.02)
        set_arm(attacker, "R", 1.32, -0.10, -0.32, 1.02)
        set_leg(attacker, "L", 1.34, 0.0, 0.82, 1.36)
        set_leg(attacker, "R", 1.34, 0.0, -0.82, 1.36)
    elif key == "back_control":
        kneel(defender, 0.18, 0.02, -1, 0.08, 0.0)
        kneel(attacker, -0.22, 0.08, 1, 0.10, 0.0)
        attacker["root"].rotation_euler.z -= 0.04
        defender["root"].rotation_euler.z -= 0.04
        set_arm(attacker, "R", 1.46, -0.12, -1.05, 1.16)
        set_arm(attacker, "L", 1.28, 0.15, 0.78, 1.08)
        set_leg(attacker, "L", 1.38, 0.0, 0.76, 1.42)
        set_leg(attacker, "R", 1.38, 0.0, -0.76, 1.42)
    elif key == "armbar":
        ground(defender, 0.20, 0.05, -1, 0.0, 0.95)
        ground(attacker, -0.12, -0.08, 1, math.pi / 2, 0.92)
        attacker["root"].location.z += 0.08
        set_leg(attacker, "L", 1.42, 0.0, 0.84, 1.32)
        set_leg(attacker, "R", 1.38, 0.0, -0.78, 1.32)
        set_arm(defender, "R", 1.46, -0.10, -1.08, 1.20)
        set_arm(attacker, "L", 1.34, 0.18, 0.72, 1.05)
    elif key == "triangle_choke":
        ground(attacker, -0.08, 0.16, 1, -0.12, 0.97)
        kneel(defender, 0.22, -0.04, -1, 0.46, 0.04)
        set_leg(attacker, "L", 1.58, 0.0, 1.35, 1.38)
        set_leg(attacker, "R", 1.52, 0.0, -1.26, 1.38)
        set_arm(attacker, "L", 1.26, 0.18, 0.60, 1.05)
        set_arm(attacker, "R", 1.26, -0.18, -0.60, 1.05)
        defender["root"].location.z -= 0.10 * p
    elif key == "rear_naked_choke":
        kneel(defender, 0.16, 0.02, -1, 0.10, 0.0)
        kneel(attacker, -0.16, 0.08, 1, 0.10, 0.0)
        attacker["root"].rotation_euler.z -= 0.06
        defender["root"].rotation_euler.z -= 0.06
        set_arm(attacker, "R", 1.58, -0.04, -1.22, 1.22)
        set_arm(attacker, "L", 1.34, 0.12, 0.96, 1.12)
        set_arm(defender, "R", 1.12 + 0.22 * p, -0.08, -0.45, 0.92)
    elif key == "tap_out":
        kneel(attacker, -0.20, 0.06, 1, 0.05, 0.0)
        kneel(defender, 0.18, 0.02, -1, 0.12, 0.0)
        set_arm(defender, "R", 1.55 + abs(math.sin(progress * math.pi * 8.0)) * 0.28, -0.10, -0.96, 0.88)
        set_arm(defender, "L", 1.05, 0.10, 0.30, 0.80)
    elif key == "reset_neutral":
        stance(attacker, lerp(-0.28, -0.90, p), 0.06, 1, 0.22 * (1.0 - p), 0.0, 0.06)
        stance(defender, lerp(0.28, 0.90, p), 0.02, -1, 0.20 * (1.0 - p), 0.0, -0.06)


def keyframe_fighter(fighter: dict, frame: int) -> None:
    for control in fighter["controls"]:
        control.keyframe_insert(data_path="location", frame=frame)
        control.keyframe_insert(data_path="rotation_euler", frame=frame)
        control.keyframe_insert(data_path="scale", frame=frame)


def name_actions(key: str, fighter: dict) -> None:
    for control in fighter["controls"]:
        action = control.animation_data.action if control.animation_data else None
        if not action:
            continue
        action.name = f"JQ_{key}_{control.name}"
        for curve in action.fcurves:
            for point in curve.keyframe_points:
                point.interpolation = "BEZIER"


def build_move(key: str, duration: float) -> None:
    clear_scene()
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = max(2, round(duration * FPS))
    scene["JQ_asset_version"] = "1"
    scene["JQ_motion_type"] = "authored-paired-choreography"

    pair = add_empty("JQ_Pair")
    attacker = make_fighter(
        "Attacker",
        {
            "gi_top": (0.78, 0.90, 1.0, 1.0),
            "gi_pants": (0.49, 0.67, 0.86, 1.0),
            "skin": (0.74, 0.42, 0.25, 1.0),
            "hair": (0.05, 0.035, 0.025, 1.0),
            "belt": (0.08, 0.12, 0.18, 1.0),
            "stripe": (0.96, 0.96, 0.96, 1.0),
        },
    )
    defender = make_fighter(
        "Defender",
        {
            "gi_top": (0.15, 0.22, 0.38, 1.0),
            "gi_pants": (0.10, 0.16, 0.29, 1.0),
            "skin": (0.86, 0.60, 0.40, 1.0),
            "hair": (0.30, 0.12, 0.05, 1.0),
            "belt": (0.82, 0.15, 0.12, 1.0),
            "stripe": (0.98, 0.85, 0.22, 1.0),
        },
    )
    attacker["root"].parent = pair
    defender["root"].parent = pair

    samples = (0.0, 0.25, 0.58, 0.82, 1.0)
    for progress in samples:
        frame = 1 + round(progress * (scene.frame_end - 1))
        scene.frame_set(frame)
        pose_pair(key, attacker, defender, progress)
        keyframe_fighter(attacker, frame)
        keyframe_fighter(defender, frame)

    name_actions(key, attacker)
    name_actions(key, defender)
    scene.frame_set(1)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUTPUT_DIR, f"{key}.glb"),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_animations=True,
        export_animation_mode="ACTIVE_ACTIONS",
        export_nla_strips=True,
        export_force_sampling=True,
        export_frame_range=True,
        export_optimize_animation_size=True,
        export_materials="EXPORT",
        export_extras=True,
    )


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for key, duration in MOVE_DURATIONS.items():
        build_move(key, duration)
        print(f"Generated {key}.glb")


if __name__ == "__main__":
    main()
