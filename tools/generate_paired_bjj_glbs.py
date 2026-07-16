"""Generate JiuQuest's realistic, customizable paired BJJ choreography GLBs.

The anatomical base is the 65-bone CC0 Universal Base Characters rig by
Quaternius. JiuQuest adds a skinned gi, belt/stripe/patch slots, modular hair,
PBR materials, and paired technique choreography. The named material and node
contract is consumed by ``MoveAnimationManager`` at runtime.
"""

from __future__ import annotations

import math
import os
import subprocess

import bmesh
import bpy
from mathutils import Matrix, Vector


FPS = 30
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(ROOT, "public", "animations", "bjj")
SOURCE_DIR = os.path.join(ROOT, "tools", "assets", "universal-base-characters")
BASE_MODEL = os.path.join(SOURCE_DIR, "base", "Superhero_Male_FullBody.gltf")
HAIR_MODELS = {
    "Crew": os.path.join(SOURCE_DIR, "hair", "Hair_Buzzed.gltf"),
    "Long": os.path.join(SOURCE_DIR, "hair", "Hair_Long.gltf"),
    "Slick": os.path.join(SOURCE_DIR, "hair", "Hair_SimpleParted.gltf"),
}

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

ANIMATED_BONES = (
    "pelvis",
    "spine_01",
    "spine_02",
    "spine_03",
    "neck_01",
    "Head",
    "clavicle_l",
    "upperarm_l",
    "lowerarm_l",
    "hand_l",
    "clavicle_r",
    "upperarm_r",
    "lowerarm_r",
    "hand_r",
    "thigh_l",
    "calf_l",
    "foot_l",
    "ball_l",
    "thigh_r",
    "calf_r",
    "foot_r",
    "ball_r",
)


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def smooth(value: float) -> float:
    value = clamp(value)
    return value * value * (3.0 - 2.0 * value)


def lerp(start: float, end: float, amount: float) -> float:
    return start + (end - start) * amount


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.actions,
        bpy.data.materials,
        bpy.data.meshes,
        bpy.data.armatures,
        bpy.data.images,
    ):
        for datablock in list(collection):
            collection.remove(datablock)


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float = 0.58,
    sheen: float = 0.0,
    coat: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    material.diffuse_color = color
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = 0.0
    if shader.inputs.get("Sheen Weight"):
        shader.inputs["Sheen Weight"].default_value = sheen
    if shader.inputs.get("Coat Weight"):
        shader.inputs["Coat Weight"].default_value = coat
    if shader.inputs.get("Coat Roughness"):
        shader.inputs["Coat Roughness"].default_value = 0.42
    return material


def add_empty(name: str, parent: bpy.types.Object | None = None) -> bpy.types.Object:
    item = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(item)
    item.empty_display_type = "PLAIN_AXES"
    item.empty_display_size = 0.08
    item.parent = parent
    return item


def assign_material(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.material_index = 0
        polygon.use_smooth = True


def skin_rigid(
    obj: bpy.types.Object,
    root: bpy.types.Object,
    armature: bpy.types.Object,
    bone_name: str,
) -> bpy.types.Object:
    # glTF requires the armature to be the direct parent of skinned meshes.
    # The armature itself is parented to the stable JQ_<role> root.
    obj.parent = armature
    group = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    modifier = obj.modifiers.new("JiuQuest rig attachment", "ARMATURE")
    modifier.object = armature
    return obj


def add_box(
    name: str,
    dimensions,
    location,
    material: bpy.types.Material,
    root: bpy.types.Object,
    armature: bpy.types.Object,
    bone_name: str,
    rotation=(0.0, 0.0, 0.0),
    bevel: float = 0.012,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Tailored soft edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    assign_material(obj, material)
    return skin_rigid(obj, root, armature, bone_name)


def add_torus(
    name: str,
    location,
    major_radius: float,
    minor_radius: float,
    material: bpy.types.Material,
    root: bpy.types.Object,
    armature: bpy.types.Object,
    bone_name: str,
    scale=(1.0, 1.0, 1.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=36,
        minor_segments=8,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign_material(obj, material)
    return skin_rigid(obj, root, armature, bone_name)


def add_patch(
    name: str,
    location,
    material: bpy.types.Material,
    root: bpy.types.Object,
    armature: bpy.types.Object,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=32,
        radius=0.075,
        depth=0.012,
        location=location,
        rotation=(math.pi / 2, 0.0, 0.0),
    )
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, material)
    return skin_rigid(obj, root, armature, "spine_02")


def duplicate_body_region(
    source: bpy.types.Object,
    name: str,
    material: bpy.types.Material,
    allowed_bones: set[str],
    thickness: float,
) -> bpy.types.Object:
    garment = source.copy()
    garment.data = source.data.copy()
    garment.name = name
    bpy.context.collection.objects.link(garment)

    allowed_indices = {group.index for group in garment.vertex_groups if group.name in allowed_bones}
    keep = {
        vertex.index
        for vertex in garment.data.vertices
        if any(link.group in allowed_indices and link.weight >= 0.08 for link in vertex.groups)
    }
    mesh = bmesh.new()
    mesh.from_mesh(garment.data)
    mesh.verts.ensure_lookup_table()
    bmesh.ops.delete(mesh, geom=[vertex for vertex in mesh.verts if vertex.index not in keep], context="VERTS")
    mesh.to_mesh(garment.data)
    mesh.free()
    assign_material(garment, material)

    solidify = garment.modifiers.new("Pearl weave shell", "SOLIDIFY")
    solidify.thickness = thickness
    solidify.offset = 1.0
    bpy.context.view_layer.objects.active = garment
    garment.select_set(True)
    while garment.modifiers.find(solidify.name) > 0:
        bpy.ops.object.modifier_move_up(modifier=solidify.name)
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    garment.select_set(False)
    return garment


def import_hair(
    path: str,
    name: str,
    material: bpy.types.Material,
    root: bpy.types.Object,
    armature: bpy.types.Object,
) -> bpy.types.Object:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No hair mesh imported from {path}")
    hair = max(meshes, key=lambda obj: len(obj.data.polygons))
    for obj in imported:
        if obj is not hair:
            bpy.data.objects.remove(obj, do_unlink=True)
    hair.name = name
    assign_material(hair, material)
    return skin_rigid(hair, root, armature, "Head")


def add_mohawk(
    name: str,
    material: bpy.types.Material,
    root: bpy.types.Object,
    armature: bpy.types.Object,
) -> bpy.types.Object:
    pieces = []
    positions = (-0.13, -0.085, -0.04, 0.005, 0.05, 0.095, 0.14)
    for position in positions:
        height = 0.13 + (1.0 - abs(position) / 0.15) * 0.055
        bpy.ops.mesh.primitive_cone_add(
            vertices=12,
            radius1=0.042,
            radius2=0.010,
            depth=height,
            location=(0.0, position, 1.825 + height * 0.5),
        )
        piece = bpy.context.object
        assign_material(piece, material)
        pieces.append(piece)
    bpy.ops.object.select_all(action="DESELECT")
    for piece in pieces:
        piece.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    mohawk = bpy.context.object
    mohawk.name = name
    return skin_rigid(mohawk, root, armature, "Head")


def add_spikes(
    name: str,
    material: bpy.types.Material,
    root: bpy.types.Object,
    armature: bpy.types.Object,
) -> bpy.types.Object:
    pieces = []
    placements = (
        ((-0.11, -0.09, 1.86), (-0.12, -0.08, -0.16), 0.10),
        ((0.00, -0.12, 1.88), (-0.15, 0.00, 0.00), 0.12),
        ((0.11, -0.09, 1.86), (-0.12, 0.08, 0.16), 0.10),
        ((-0.14, 0.00, 1.85), (0.00, -0.18, -0.22), 0.11),
        ((-0.05, 0.00, 1.90), (0.02, -0.06, -0.08), 0.14),
        ((0.06, 0.00, 1.90), (0.02, 0.06, 0.08), 0.14),
        ((0.14, 0.00, 1.85), (0.00, 0.18, 0.22), 0.11),
        ((-0.09, 0.10, 1.85), (0.14, -0.08, -0.12), 0.10),
        ((0.02, 0.12, 1.87), (0.16, 0.02, 0.03), 0.11),
        ((0.11, 0.09, 1.85), (0.14, 0.08, 0.12), 0.10),
    )
    for location, rotation, height in placements:
        bpy.ops.mesh.primitive_cone_add(
            vertices=10,
            radius1=0.038,
            radius2=0.006,
            depth=height,
            location=location,
            rotation=rotation,
        )
        piece = bpy.context.object
        assign_material(piece, material)
        pieces.append(piece)
    bpy.ops.object.select_all(action="DESELECT")
    for piece in pieces:
        piece.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    spikes = bpy.context.object
    spikes.name = name
    return skin_rigid(spikes, root, armature, "Head")


def make_fighter(role: str, colors: dict[str, tuple[float, float, float, float]]) -> dict:
    prefix = f"JQ_{role}"
    materials = {
        "skin": make_material(f"{prefix}_Skin", colors["skin"], 0.47, sheen=0.08, coat=0.02),
        "eyes": make_material(f"{prefix}_Eyes", (0.10, 0.18, 0.22, 1.0), 0.30, coat=0.16),
        "hair": make_material(f"{prefix}_Hair", colors["hair"], 0.74, sheen=0.08, coat=0.02),
        "gi_top": make_material(f"{prefix}_GiTop", colors["gi_top"], 0.72, sheen=0.24, coat=0.015),
        "gi_pants": make_material(f"{prefix}_GiPants", colors["gi_pants"], 0.76, sheen=0.18, coat=0.01),
        "belt": make_material(f"{prefix}_Belt", colors["belt"], 0.64, sheen=0.12),
        "stripe": make_material(f"{prefix}_BeltStripe", colors["stripe"], 0.58),
        "patch": make_material(f"{prefix}_Patch", (1.0, 1.0, 1.0, 1.0), 0.50, coat=0.04),
    }

    root = add_empty(prefix)
    root["JQ_role"] = role.lower()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=BASE_MODEL)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    armature = next(obj for obj in imported if obj.type == "ARMATURE")
    meshes = [obj for obj in imported if obj.type == "MESH"]
    body = max(meshes, key=lambda obj: len(obj.data.polygons))
    eyes = next(obj for obj in meshes if "eye" in obj.name.lower() and obj is not body)
    brows = next(obj for obj in meshes if "eyebrow" in obj.name.lower() and obj is not body)
    for obj in meshes:
        if obj not in {body, eyes, brows}:
            bpy.data.objects.remove(obj, do_unlink=True)

    root.scale = (1.05, 1.05, 1.05)
    armature.name = f"{prefix}_Rig"
    armature.parent = root
    body.name = f"{prefix}_Body"
    eyes.name = f"{prefix}_Eyes"
    brows.name = f"{prefix}_Brows"
    assign_material(body, materials["skin"])
    assign_material(eyes, materials["eyes"])
    assign_material(brows, materials["hair"])

    top_bones = {
        "pelvis",
        "spine_01",
        "spine_02",
        "spine_03",
        "clavicle_l",
        "upperarm_l",
        "lowerarm_l",
        "clavicle_r",
        "upperarm_r",
        "lowerarm_r",
    }
    pants_bones = {"pelvis", "thigh_l", "calf_l", "thigh_r", "calf_r"}
    jacket = duplicate_body_region(body, f"{prefix}_GiJacket", materials["gi_top"], top_bones, 0.016)
    pants = duplicate_body_region(body, f"{prefix}_GiPantsMesh", materials["gi_pants"], pants_bones, 0.018)
    jacket.parent = armature
    pants.parent = armature

    add_box(
        f"{prefix}_Lapel_L",
        (0.050, 0.020, 0.34),
        (-0.095, -0.150, 1.31),
        materials["gi_top"],
        root,
        armature,
        "spine_02",
        rotation=(0.0, -0.34, -0.02),
    )
    add_box(
        f"{prefix}_Lapel_R",
        (0.050, 0.020, 0.34),
        (0.095, -0.150, 1.31),
        materials["gi_top"],
        root,
        armature,
        "spine_02",
        rotation=(0.0, 0.34, 0.02),
    )
    add_torus(
        f"{prefix}_Belt",
        (0.0, 0.0, 0.985),
        0.228,
        0.026,
        materials["belt"],
        root,
        armature,
        "pelvis",
        scale=(1.0, 0.60, 1.0),
    )
    add_box(
        f"{prefix}_Belt_Knot",
        (0.105, 0.055, 0.075),
        (0.0, -0.164, 0.985),
        materials["belt"],
        root,
        armature,
        "pelvis",
        bevel=0.02,
    )
    add_box(
        f"{prefix}_BeltTail_L",
        (0.045, 0.024, 0.20),
        (-0.025, -0.205, 0.88),
        materials["belt"],
        root,
        armature,
        "pelvis",
        rotation=(0.06, -0.05, -0.08),
    )
    add_box(
        f"{prefix}_BeltTail_R",
        (0.045, 0.024, 0.17),
        (0.03, -0.202, 0.895),
        materials["belt"],
        root,
        armature,
        "pelvis",
        rotation=(-0.05, 0.04, 0.10),
    )
    for index in range(4):
        add_box(
            f"{prefix}_BeltStripe_{index + 1}",
            (0.016, 0.010, 0.052),
            (0.065 + index * 0.026, -0.220, 0.985),
            materials["stripe"],
            root,
            armature,
            "pelvis",
            bevel=0.002,
        )
    add_patch(f"{prefix}_ChestPatch", (0.18, -0.205, 1.36), materials["patch"], root, armature)

    import_hair(HAIR_MODELS["Crew"], f"{prefix}_HairCrew", materials["hair"], root, armature)
    import_hair(HAIR_MODELS["Long"], f"{prefix}_HairLong", materials["hair"], root, armature)
    import_hair(HAIR_MODELS["Slick"], f"{prefix}_HairSlick", materials["hair"], root, armature)
    add_mohawk(f"{prefix}_HairMohawk", materials["hair"], root, armature)
    add_spikes(f"{prefix}_HairSpikes", materials["hair"], root, armature)

    for bone in armature.pose.bones:
        bone.rotation_mode = "QUATERNION"
    base_root = (root.location.copy(), root.rotation_euler.copy(), root.scale.copy())
    return {
        "role": role,
        "root": root,
        "armature": armature,
        "base_root": base_root,
        "pose_bones": [armature.pose.bones[name] for name in ANIMATED_BONES],
    }


def reset_fighter(fighter: dict) -> None:
    root = fighter["root"]
    location, rotation, scale = fighter["base_root"]
    root.location = location
    root.rotation_euler = rotation
    root.scale = scale
    for bone in fighter["armature"].pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
        bone.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()


def aim_bone(fighter: dict, bone_name: str, target) -> None:
    bone = fighter["armature"].pose.bones[bone_name]
    direction = Vector(target) - bone.head
    if direction.length < 0.001:
        return
    matrix = direction.normalized().to_track_quat("Y", "Z").to_matrix().to_4x4()
    matrix.translation = bone.head
    bone.matrix = matrix
    bpy.context.view_layer.update()


def bone_world_point(fighter: dict, bone_name: str, endpoint: str = "head") -> Vector:
    """Return a live pose-bone endpoint in world space for paired contacts."""
    bpy.context.view_layer.update()
    bone = fighter["armature"].pose.bones[bone_name]
    point = bone.tail if endpoint == "tail" else bone.head
    return fighter["armature"].matrix_world @ point


def aim_bone_world(fighter: dict, bone_name: str, target) -> None:
    """Aim a bone at a world-space contact while preserving the role hierarchy."""
    bpy.context.view_layer.update()
    local_target = fighter["armature"].matrix_world.inverted() @ Vector(target)
    aim_bone(fighter, bone_name, local_target)


def aim_arm_world(fighter: dict, side: str, elbow_target, hand_target) -> None:
    suffix = side.lower()
    aim_bone_world(fighter, f"upperarm_{suffix}", elbow_target)
    aim_bone_world(fighter, f"lowerarm_{suffix}", hand_target)


def aim_leg_world(fighter: dict, side: str, knee_target, ankle_target) -> None:
    suffix = side.lower()
    aim_bone_world(fighter, f"thigh_{suffix}", knee_target)
    aim_bone_world(fighter, f"calf_{suffix}", ankle_target)


def between(start, end, amount: float, offset=(0.0, 0.0, 0.0)) -> Vector:
    point = Vector(start).lerp(Vector(end), clamp(amount))
    return point + Vector(offset)


def set_arm(fighter: dict, side: str, x: float, y: float, z: float, elbow: float = 0.0) -> None:
    suffix = side.lower()
    sign = 1.0 if suffix == "l" else -1.0
    reach = clamp((x - 0.45) / 1.15)
    spread = clamp(abs(z) / 1.35)
    elbow_target = (
        sign * (0.34 + 0.055 * (1.0 - clamp(elbow / 1.5))),
        -0.16 - 0.08 * reach + y * 0.05,
        1.24 + 0.08 * reach,
    )
    hand_target = (
        sign * (0.14 + 0.10 * spread),
        -0.28 - 0.18 * reach + y * 0.08,
        1.31 + 0.13 * reach + 0.035 * spread,
    )
    aim_bone(fighter, f"upperarm_{suffix}", elbow_target)
    aim_bone(fighter, f"lowerarm_{suffix}", hand_target)


def set_leg(fighter: dict, side: str, x: float, y: float, z: float, knee: float = 0.0) -> None:
    suffix = side.lower()
    sign = 1.0 if suffix == "l" else -1.0
    flex = clamp(x / 1.6)
    spread = clamp(abs(z) / 1.35)
    knee_target = (
        sign * (0.14 + 0.11 * spread),
        0.02 + 0.08 * flex + y * 0.04,
        0.54 - 0.23 * flex,
    )
    ankle_target = (
        sign * (0.16 + 0.13 * spread),
        0.04 + 0.17 * flex,
        0.075 + 0.035 * clamp(knee / 1.5),
    )
    aim_bone(fighter, f"thigh_{suffix}", knee_target)
    aim_bone(fighter, f"calf_{suffix}", ankle_target)


def facing_angle(face: int) -> float:
    # The CC0 avatar faces -Y in Blender space.
    return math.pi / 2 if face > 0 else -math.pi / 2


def stance(
    fighter: dict,
    x: float,
    y: float,
    face: int,
    crouch: float = 0.0,
    lean: float = 0.0,
    stride: float = 0.0,
) -> None:
    root = fighter["root"]
    root.location = (x, y, -crouch * 0.045)
    root.rotation_euler = (lean * 0.08, 0.0, facing_angle(face))
    scale = 1.05 - crouch * 0.025
    root.scale = (scale, scale, scale)
    set_arm(fighter, "L", 0.74 + crouch * 0.42, 0.04, 0.48, 0.72)
    set_arm(fighter, "R", 0.74 + crouch * 0.42, -0.04, -0.48, 0.72)
    set_leg(fighter, "L", 0.12 + crouch * 0.5 + stride, 0.0, 0.16 + stride, 0.32 + crouch * 0.2)
    set_leg(fighter, "R", 0.12 + crouch * 0.5 - stride, 0.0, -0.16 - stride, 0.32 + crouch * 0.2)


def kneel(fighter: dict, x: float, y: float, face: int, lean: float = 0.0, roll: float = 0.0) -> None:
    root = fighter["root"]
    root.location = (x, y, -0.13)
    root.rotation_euler = (0.10 + lean * 0.10, 0.0, facing_angle(face) + roll)
    root.scale = (0.98, 0.98, 0.98)
    set_arm(fighter, "L", 1.02 + lean * 0.22, 0.10, 0.60, 0.94)
    set_arm(fighter, "R", 1.02 + lean * 0.22, -0.10, -0.60, 0.94)
    aim_bone(fighter, "thigh_l", (0.25, 0.05, 0.34))
    aim_bone(fighter, "calf_l", (0.27, 0.28, 0.16))
    aim_bone(fighter, "thigh_r", (-0.25, -0.01, 0.34))
    aim_bone(fighter, "calf_r", (-0.27, 0.28, 0.16))


def ground(fighter: dict, x: float, y: float, face: int, roll: float = 0.0, scale: float = 0.96) -> None:
    root = fighter["root"]
    root.location = (x, y, 0.25)
    root.rotation_euler = (math.pi / 2, 0.0 if face > 0 else math.pi, roll)
    root.scale = (scale, scale, scale)
    set_arm(fighter, "L", 0.92, 0.14, 0.72 * face, 0.92)
    set_arm(fighter, "R", 0.96, -0.14, -0.72 * face, 0.90)
    set_leg(fighter, "L", 0.82, 0.0, 0.64 * face, 1.0)
    set_leg(fighter, "R", 0.78, 0.0, -0.64 * face, 0.98)


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
        ground(attacker, lerp(-0.96, -0.08, p), 0.15, -1, -0.12, 0.98)
        kneel(defender, lerp(0.88, 0.30, p), -0.08, -1, 0.14 * p, 0.08)
        set_leg(attacker, "L", 1.26, 0.0, 1.12, 1.12)
        set_leg(attacker, "R", 1.22, 0.0, -1.12, 1.12)
        set_arm(attacker, "L", 1.08, 0.10, 0.62, 1.0)
        set_arm(attacker, "R", 1.10, -0.10, -0.62, 1.0)
    elif key == "closed_guard":
        ground(attacker, lerp(-0.18, -0.06, p), lerp(0.26, 0.16, p), -1, lerp(-0.02, -0.08, p) + pulse, 0.99)
        kneel(defender, lerp(0.16, -0.01, p), lerp(0.04, -0.32, p), -1, lerp(0.08, 0.28, p), 0.03)
        defender["root"].rotation_euler.z = lerp(-0.20, 0.0, p)
        defender["root"].location.z -= lerp(0.06, 0.25, p)
        set_leg(attacker, "L", lerp(1.10, 1.48, p), 0.0, lerp(0.76, 1.22, p), lerp(0.92, 1.22, p))
        set_leg(attacker, "R", lerp(1.10, 1.48, p), 0.0, lerp(-0.76, -1.22, p), lerp(0.92, 1.22, p))
        set_arm(attacker, "L", lerp(0.92, 1.26, p), 0.14, 0.52, lerp(0.76, 1.02, p))
        set_arm(attacker, "R", lerp(0.92, 1.26, p), -0.14, -0.52, lerp(0.76, 1.02, p))
        set_arm(defender, "L", lerp(0.88, 1.18, p), 0.10, 0.34, lerp(0.72, 0.95, p))
        set_arm(defender, "R", lerp(0.88, 1.18, p), -0.10, -0.34, lerp(0.72, 0.95, p))
    elif key == "guard_pass":
        kneel(attacker, lerp(-0.12, -0.52, p), lerp(-0.02, -0.16, p), 1, lerp(0.16, 0.40, p), -0.18 * p)
        ground(defender, lerp(0.06, 0.38, p), 0.15, -1, lerp(-0.06, 0.26, p), 0.95)
        set_arm(attacker, "L", lerp(0.96, 1.28, p), 0.18, 0.56, lerp(0.82, 1.08, p))
        set_arm(attacker, "R", lerp(1.04, 1.48, p), -0.22, -0.54, lerp(0.84, 1.14, p))
        set_leg(attacker, "L", lerp(0.96, 1.34, p), 0.0, lerp(0.62, 0.28, p), lerp(1.02, 1.44, p))
        set_leg(defender, "R", lerp(0.66, 1.02, p), 0.0, lerp(-0.52, -0.86, p), lerp(0.82, 1.18, p))
    elif key == "side_control":
        ground(defender, lerp(0.04, 0.15, p), lerp(0.20, 0.14, p), -1, -0.08 * p, 0.96)
        ground(attacker, lerp(-0.48, -0.10, p), lerp(0.18, -0.04, p), 1, lerp(0.88, math.pi / 2, p) + pulse, 0.92)
        attacker["root"].location.z += lerp(0.10, 0.22, p)
        set_arm(attacker, "L", lerp(0.92, 1.34, p), 0.22, 0.75, lerp(0.76, 1.10, p))
        set_arm(attacker, "R", lerp(0.88, 1.16, p), -0.28, -0.52, lerp(0.72, 1.02, p))
        set_arm(defender, "L", lerp(0.78, 1.12, p), 0.12, 0.64, lerp(0.70, 0.96, p))
        set_arm(defender, "R", lerp(0.80, 1.08, p), -0.12, -0.64, lerp(0.70, 0.94, p))
    elif key == "mount":
        ground(defender, lerp(0.0, 0.05, p), 0.10, -1, 0.05 * p, 0.96)
        kneel(attacker, lerp(-0.24, 0.02, p), lerp(-0.12, -0.50, p), 1, lerp(0.08, 0.22, p), 0.0)
        attacker["root"].rotation_euler.z = lerp(-0.26, 0.0, p)
        attacker["root"].location.z -= lerp(0.04, 0.20, p)
        set_arm(attacker, "L", lerp(0.88, 1.32, p), 0.10, 0.32, lerp(0.72, 1.02, p))
        set_arm(attacker, "R", lerp(0.88, 1.32, p), -0.10, -0.32, lerp(0.72, 1.02, p))
        set_leg(attacker, "L", lerp(0.92, 1.34, p), 0.0, lerp(0.46, 0.82, p), lerp(0.94, 1.36, p))
        set_leg(attacker, "R", lerp(0.92, 1.34, p), 0.0, lerp(-0.46, -0.82, p), lerp(0.94, 1.36, p))
        set_arm(defender, "L", lerp(0.72, 1.10, p), 0.10, 0.58, lerp(0.66, 0.98, p))
        set_arm(defender, "R", lerp(0.72, 1.10, p), -0.10, -0.58, lerp(0.66, 0.98, p))
    elif key == "back_control":
        kneel(defender, lerp(0.20, 0.14, p), 0.02, 1, lerp(0.02, 0.10, p), 0.0)
        kneel(attacker, lerp(-0.64, -0.30, p), 0.08, 1, lerp(0.02, 0.12, p), 0.0)
        attacker["root"].rotation_euler.z -= 0.04 * p
        defender["root"].rotation_euler.z -= 0.04 * p
        set_arm(attacker, "R", lerp(0.86, 1.46, p), -0.12, -1.05, lerp(0.72, 1.16, p))
        set_arm(attacker, "L", lerp(0.82, 1.28, p), 0.15, 0.78, lerp(0.70, 1.08, p))
        set_leg(attacker, "L", lerp(0.92, 1.38, p), 0.0, lerp(0.42, 0.76, p), lerp(0.94, 1.42, p))
        set_leg(attacker, "R", lerp(0.92, 1.38, p), 0.0, lerp(-0.42, -0.76, p), lerp(0.94, 1.42, p))
        set_arm(defender, "L", lerp(0.82, 1.14, p), 0.08, 0.44, lerp(0.72, 0.96, p))
        set_arm(defender, "R", lerp(0.82, 1.14, p), -0.08, -0.44, lerp(0.72, 0.96, p))
    elif key == "armbar":
        # The defender lies north/south while the attacker pivots perpendicular
        # at the shoulder line. Their shared contact points drive the captured
        # wrist, two-hand grip, face-side leg, and chest-side leg.
        ground(defender, lerp(0.08, 0.12, p), lerp(0.03, 0.0, p), -1, -0.05 * p, 0.96)
        ground(attacker, lerp(-0.18, -0.42, p), lerp(-0.48, -1.02, p), -1, lerp(0.96, math.pi / 2, p), 0.93)
        attacker["root"].location.z -= lerp(0.02, 0.12, p)
        bpy.context.view_layer.update()

        attacker_chest = bone_world_point(attacker, "spine_02")
        defender_shoulder = bone_world_point(defender, "upperarm_r")
        captured_wrist_goal = attacker_chest + Vector((0.02, -0.02, 0.05))
        captured_elbow_goal = between(defender_shoulder, captured_wrist_goal, 0.54, (0.0, 0.0, 0.07))
        aim_arm_world(defender, "R", captured_elbow_goal, captured_wrist_goal)
        captured_wrist = bone_world_point(defender, "hand_r")

        for side, lateral in (("L", 0.07), ("R", -0.07)):
            shoulder = bone_world_point(attacker, f"upperarm_{side.lower()}")
            grip = captured_wrist + Vector((0.0, lateral, 0.015))
            elbow = between(shoulder, grip, 0.52, (0.0, lateral * 1.3, 0.10))
            aim_arm_world(attacker, side, elbow, grip)

        defender_head = bone_world_point(defender, "Head")
        defender_chest = bone_world_point(defender, "spine_03")
        head_knee = defender_head + Vector((0.30, 0.18, lerp(0.24, 0.12, p)))
        head_ankle = defender_head + Vector((-0.20, -0.10, 0.08))
        chest_knee = defender_chest + Vector((-0.27, 0.20, lerp(0.22, 0.10, p)))
        chest_ankle = defender_chest + Vector((0.18, -0.12, 0.07))
        aim_leg_world(attacker, "L", head_knee, head_ankle)
        aim_leg_world(attacker, "R", chest_knee, chest_ankle)
        set_arm(defender, "L", lerp(0.78, 1.08, p), 0.12, 0.52, lerp(0.70, 0.94, p))
    elif key == "triangle_choke":
        # Keep the defender centered over the hips, then cross both calves
        # around the live neck point so the triangle closes visibly on camera.
        ground(attacker, lerp(-0.14, -0.05, p), lerp(0.18, 0.10, p), -1, lerp(-0.02, -0.08, p), 0.98)
        kneel(defender, lerp(0.16, 0.02, p), lerp(-0.10, -0.25, p), -1, lerp(0.16, 0.40, p), 0.03)
        defender["root"].rotation_euler.z = lerp(-0.16, 0.0, p)
        defender["root"].location.z -= lerp(0.04, 0.28, p)
        bpy.context.view_layer.update()

        neck = bone_world_point(defender, "neck_01")
        left_knee = neck + Vector((0.34, 0.10, lerp(0.24, 0.10, p)))
        left_ankle = neck + Vector((-0.18, -0.10, 0.13))
        right_knee = neck + Vector((-0.34, 0.12, lerp(0.22, 0.10, p)))
        right_ankle = neck + Vector((0.18, -0.12, 0.18))
        aim_leg_world(attacker, "L", left_knee, left_ankle)
        aim_leg_world(attacker, "R", right_knee, right_ankle)

        defender_head = bone_world_point(defender, "Head")
        for side, lateral in (("L", 0.11), ("R", -0.11)):
            shoulder = bone_world_point(attacker, f"upperarm_{side.lower()}")
            hand = defender_head + Vector((-0.08, lateral, 0.02))
            elbow = between(shoulder, hand, 0.52, (0.0, lateral * 1.5, 0.06))
            aim_arm_world(attacker, side, elbow, hand)

        attacker_chest = bone_world_point(attacker, "spine_03")
        defender_right_shoulder = bone_world_point(defender, "upperarm_r")
        inside_hand = attacker_chest + Vector((0.02, -0.02, 0.06))
        aim_arm_world(defender, "R", between(defender_right_shoulder, inside_hand, 0.52, (0.0, -0.08, 0.06)), inside_hand)
        set_arm(defender, "L", lerp(0.82, 1.16, p), 0.10, 0.48, lerp(0.70, 0.98, p))
    elif key == "rear_naked_choke":
        # Close the back-control gap, put the choking forearm across the live
        # neck point, lock the support hand to the biceps, and make the defender
        # fight that same forearm instead of reaching generically forward.
        kneel(defender, lerp(0.14, 0.10, p), 0.02, 1, lerp(0.02, 0.10, p), 0.0)
        kneel(attacker, lerp(-0.46, -0.18, p), 0.05, 1, lerp(0.02, 0.10, p), 0.0)
        attacker["root"].rotation_euler.z -= 0.035 * p
        defender["root"].rotation_euler.z -= 0.035 * p
        bpy.context.view_layer.update()

        neck = bone_world_point(defender, "neck_01")
        choke_elbow = neck + Vector((-0.04, -0.25, -0.02))
        choke_hand = neck + Vector((0.07, 0.19, -0.01))
        aim_arm_world(attacker, "R", choke_elbow, choke_hand)
        choking_forearm = bone_world_point(attacker, "lowerarm_r", "tail")

        support_elbow = neck + Vector((-0.05, 0.27, -0.07))
        support_hand = between(choking_forearm, neck, 0.45, (-0.07, -0.05, 0.10))
        aim_arm_world(attacker, "L", support_elbow, support_hand)

        for side, lateral in (("L", 0.065), ("R", -0.065)):
            shoulder = bone_world_point(defender, f"upperarm_{side.lower()}")
            hand = choking_forearm + Vector((0.01, lateral, -0.03))
            elbow = between(shoulder, hand, 0.48, (0.03, lateral * 1.6, -0.04))
            aim_arm_world(defender, side, elbow, hand)

        defender_hip = bone_world_point(defender, "pelvis")
        aim_leg_world(attacker, "L", defender_hip + Vector((-0.10, 0.28, -0.34)), defender_hip + Vector((0.22, 0.18, -0.58)))
        aim_leg_world(attacker, "R", defender_hip + Vector((-0.10, -0.28, -0.34)), defender_hip + Vector((0.22, -0.18, -0.58)))
    elif key == "tap_out":
        tap = abs(math.sin(progress * math.pi * 8.0))
        kneel(attacker, lerp(-0.52, -0.30, p), 0.06, 1, lerp(0.0, 0.08, p), 0.0)
        kneel(defender, lerp(0.20, 0.14, p), 0.02, 1, lerp(0.04, 0.14, p), 0.0)
        set_arm(attacker, "R", lerp(0.84, 1.30, p), -0.12, -0.72, lerp(0.70, 1.04, p))
        set_arm(attacker, "L", lerp(0.84, 1.22, p), 0.12, 0.68, lerp(0.70, 1.0, p))
        set_arm(defender, "R", lerp(1.08, 1.55, p) + tap * 0.28, -0.10, -0.96, lerp(0.72, 0.96, p))
        set_arm(defender, "L", lerp(0.78, 1.05, p), 0.10, 0.30, lerp(0.66, 0.80, p))
    elif key == "reset_neutral":
        stance(attacker, lerp(-0.28, -0.90, p), 0.06, 1, 0.22 * (1.0 - p), 0.0, 0.06)
        stance(defender, lerp(0.28, 0.90, p), 0.02, -1, 0.20 * (1.0 - p), 0.0, -0.06)


def keyframe_fighter(fighter: dict, frame: int) -> None:
    root = fighter["root"]
    root.keyframe_insert(data_path="location", frame=frame)
    root.keyframe_insert(data_path="rotation_euler", frame=frame)
    root.keyframe_insert(data_path="scale", frame=frame)
    for bone in fighter["pose_bones"]:
        bone.keyframe_insert(data_path="location", frame=frame)
        bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)
        bone.keyframe_insert(data_path="scale", frame=frame)


def name_actions(key: str, fighter: dict) -> None:
    for control in (fighter["root"], fighter["armature"]):
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
    scene["JQ_asset_version"] = "2"
    scene["JQ_motion_type"] = "rigged-paired-choreography"
    scene["JQ_anatomy_source"] = "Quaternius Universal Base Characters CC0"

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

    samples = (0.0, 0.14, 0.30, 0.48, 0.66, 0.84, 1.0)
    for progress in samples:
        frame = 1 + round(progress * (scene.frame_end - 1))
        scene.frame_set(frame)
        pose_pair(key, attacker, defender, progress)
        keyframe_fighter(attacker, frame)
        keyframe_fighter(defender, frame)

    name_actions(key, attacker)
    name_actions(key, defender)
    scene.frame_set(1)
    # The glTF specification requires skinned mesh nodes to be scene roots.
    # Keep authoring under each armature, then detach at export while preserving
    # world transforms; skin joints still drive every mesh through modifiers.
    for obj in list(scene.objects):
        if obj.type != "MESH" or not obj.find_armature():
            continue
        world_matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world_matrix
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
        export_lights=False,
        export_cameras=False,
    )


def main() -> None:
    if not os.path.exists(BASE_MODEL):
        raise FileNotFoundError(f"Missing CC0 anatomy source: {BASE_MODEL}")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    requested = os.environ.get("JQ_MOVE", "").strip()
    if requested in MOVE_DURATIONS:
        build_move(requested, MOVE_DURATIONS[requested])
        print(f"Generated {requested}.glb")
        return

    # Each export runs in a clean Blender process. This prevents imported rig
    # data from one clip leaking into later glTF scenes and keeps all files
    # structurally identical for runtime cloning and validation.
    for key in MOVE_DURATIONS:
        environment = os.environ.copy()
        environment["JQ_MOVE"] = key
        subprocess.run(
            [bpy.app.binary_path, "--background", "--python", os.path.abspath(__file__)],
            check=True,
            env=environment,
        )


if __name__ == "__main__":
    main()
