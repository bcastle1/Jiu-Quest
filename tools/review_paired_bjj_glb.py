"""Independently import a paired GLB and render draft-review frames.

Run Blender --background --python-exit-code 1 --python tools/review_paired_bjj_glb.py -- <GLB> <output-dir>.
This does not modify the GLB. Coach review remains required for authored technique.
"""
import json
import os
import sys
import struct

import bpy
from mathutils import Vector


def main():
    path, output = sys.argv[sys.argv.index("--") + 1:]
    os.makedirs(output, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    with open(path, "rb") as stream:
        binary = stream.read()
    document = json.loads(binary[20:20 + struct.unpack_from("<I", binary, 12)[0]])
    colors = {material["name"]: material.get("pbrMetallicRoughness", {}).get("baseColorFactor", [1, 1, 1, 1])
              for material in document.get("materials", [])}
    end = max(action.frame_range[1] for action in bpy.data.actions)
    for material in bpy.data.materials:
        if material.node_tree:
            shader = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
            if shader:
                material.diffuse_color = shader.inputs["Base Color"].default_value
    for obj in scene.objects:
        if obj.type == "MESH" and obj.active_material:
            obj.color = colors.get(obj.active_material.name, [0.5, 0.5, 0.5, 1])
        if any(style in obj.name for style in ("HairLong", "HairSlick", "HairMohawk", "HairSpikes")):
            obj.hide_render = True
    bpy.ops.mesh.primitive_plane_add(size=5, location=(-0.25, 0.10, -0.025))
    floor = bpy.context.object
    floor.name = "ReviewMat"
    mat = bpy.data.materials.new("ReviewMat")
    mat.diffuse_color = (0.09, 0.18, 0.21, 1)
    floor.data.materials.append(mat)
    floor.color = mat.diffuse_color
    bpy.ops.object.camera_add(location=(-3.2, -3.5, 3.1))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((-0.20, 0.08, 0.45)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.8
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.display.shading.background_type = "WORLD"
    scene.world.color = (0.05, 0.07, 0.09)
    scene.render.resolution_x = 512
    scene.render.resolution_y = 448
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    samples = [(0.0, "Bottom mount"), (0.30, "Same-side traps"), (0.50, "Bridge"),
               (0.64, "Paired roll"), (0.80, "Landing"), (1.0, "Top inside guard")]
    report = {"asset": os.path.abspath(path), "review": "Authored draft; qualified BJJ coach review required", "frames": []}
    rigs = [bpy.data.objects.get(f"JQ_{role}_Rig") for role in ("Attacker", "Defender")]
    def joint(rig, name):
        return rig.matrix_world @ rig.pose.bones[name].head
    if os.path.basename(path) == "trap_roll_escape.glb" and all(rigs):
        performer, opponent = rigs
        contacts = []
        for frame in range(round(end * 0.30), round(end * 0.80) + 1):
            scene.frame_set(frame)
            wrist = joint(opponent, "hand_l")
            forearm = joint(opponent, "lowerarm_l").lerp(wrist, 0.76)
            contacts.append({
                "frame": frame,
                "wristGripGapMeters": (joint(performer, "hand_r") - wrist).length,
                "forearmGripGapMeters": (joint(performer, "hand_l") - forearm).length,
                "footTrapGapMeters": (joint(performer, "ball_r") - joint(opponent, "foot_l")).length,
            })
        report["contactChecks"] = {
            "sampleCount": len(contacts),
            "maxWristGripGapMeters": max(row["wristGripGapMeters"] for row in contacts),
            "maxForearmGripGapMeters": max(row["forearmGripGapMeters"] for row in contacts),
            "maxFootTrapGapMeters": max(row["footTrapGapMeters"] for row in contacts),
            "note": "Joint/contact distances validate continuity, not coach approval or full mesh collision freedom.",
        }
        checks = report["contactChecks"]
        checks["passed"] = (checks["maxWristGripGapMeters"] <= 0.06
                            and checks["maxForearmGripGapMeters"] <= 0.06
                            and checks["maxFootTrapGapMeters"] <= 0.07)
    for index, (progress, label) in enumerate(samples):
        frame = round(1 + (end - 1) * progress)
        scene.frame_set(frame)
        pelvis_heights = {rig.name: round(joint(rig, "pelvis").z, 5) for rig in rigs if rig}
        scene.render.filepath = os.path.join(output, f"{index:02d}-{label.replace(' ', '-')}.png")
        bpy.ops.render.render(write_still=True)
        report["frames"].append({"frame": frame, "progress": progress, "label": label, "pelvisHeightMeters": pelvis_heights,
                                 "image": scene.render.filepath})
    with open(os.path.join(output, "review-frames.json"), "w", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
    if report.get("contactChecks", {}).get("passed") is False:
        raise RuntimeError("Paired trap contacts exceeded the draft's continuity tolerances")


if __name__ == "__main__":
    main()
