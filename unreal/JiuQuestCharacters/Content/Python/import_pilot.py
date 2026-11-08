"""Explicit UE 5.8 Editor import. No runtime browser control or publication.

Run in a fresh project session using -ExecutePythonScript, not the Python
commandlet: level creation requires the full Editor. See the project README.
"""
from pathlib import Path
import datetime
import hashlib
import json
import math
import traceback
import unreal
from pilot_source import select_hair

PROJECT = Path(__file__).resolve().parents[2]
STAGING = PROJECT / "Saved/PilotStaging"
REVIEW = PROJECT / "Saved/PilotReview"
REPORT = {"status": "not_started", "renderValidated": False,
          "pairedMotionValidated": False, "pixelStreamingValidated": False,
          "clips": [], "materialGraphs": [], "limits": [
              "Editor-only import and material/scene setup; no runtime web receiver",
              "Imported poses, pairing, timing, hair selection and material output require visual review",
              "Default Subsurface Profile needs tuning; no new face detail was fabricated",
              "Existing authored gi folds; no Chaos cloth simulation"]}


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inside(base, relative):
    p = (base / relative).resolve()
    check(p.is_relative_to(base.resolve()), "Path escaped its allowed directory")
    return p


def save_report():
    REVIEW.mkdir(parents=True, exist_ok=True)
    (REVIEW / "editor-import.json").write_text(json.dumps(REPORT, indent=2) + "\n")


def glb_with_selected_hair(source, destination, style="Slick"):
    """Local display derivative only: unchanged BIN, skin and animation data."""
    result, proof = select_hair(source.read_bytes(), style)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(result)
    return proof


def import_texture(file, folder, usage):
    task = unreal.AssetImportTask()
    for key, value in {"filename": str(file), "destination_path": folder,
                       "automated": True, "replace_existing": False,
                       "save": True}.items():
        task.set_editor_property(key, value)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    textures = [o for o in task.get_objects() if isinstance(o, unreal.Texture2D)]
    check(len(textures) == 1, "Texture import did not produce one Texture2D")
    texture = textures[0]
    texture.set_editor_property("srgb", usage == "color")
    if usage == "normal":
        texture.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        texture.set_editor_property("flip_green_channel", True)
    elif usage == "data":
        texture.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
    unreal.EditorAssetLibrary.save_loaded_asset(texture)
    return texture


def make_material(spec, images, stage, folder, cache):
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    edit = unreal.MaterialEditingLibrary
    name = spec["name"]
    material = tools.create_asset("M_" + name, folder, unreal.Material, unreal.MaterialFactoryNew())
    check(material is not None, "Material creation failed: " + name)
    skin = "_Skin_Ref_" in name
    cloth = any(token in name for token in ("_GiTop", "_GiPants", "_Belt"))
    model = (unreal.MaterialShadingModel.MSM_SUBSURFACE_PROFILE if skin else
             unreal.MaterialShadingModel.MSM_CLOTH if cloth else unreal.MaterialShadingModel.MSM_DEFAULT_LIT)
    material.set_editor_property("shading_model", model)
    material.set_editor_property("two_sided", spec["doubleSided"])
    edit.set_base_material_usage(material, unreal.MaterialUsage.MATUSAGE_SKELETAL_MESH, True)

    def node(kind):
        return edit.create_material_expression(material, kind)

    def scalar(value):
        n = node(unreal.MaterialExpressionConstant)
        n.set_editor_property("r", float(value))
        return n

    def color(value):
        n = node(unreal.MaterialExpressionConstant3Vector)
        n.set_editor_property("constant", unreal.LinearColor(*value[:3], 1.))
        return n

    def connect(a, output, b, input_name):
        check(edit.connect_material_expressions(a, output, b, input_name), "Material connection failed")

    def prop(n, output, target):
        check(edit.connect_material_property(n, output, target), "Material property connection failed")

    def multiply(a, out_a, b):
        n = node(unreal.MaterialExpressionMultiply)
        connect(a, out_a, n, "A")
        connect(b, "", n, "B")
        return n

    def sample(info, usage):
        check(info["uv"] in (0, 1), "Unexpected source UV channel")
        image = images[info["image"]]
        key = (image["sha256"], usage)
        if key not in cache:
            cache[key] = import_texture(inside(stage, image["file"]), folder + "/Textures/" + usage, usage)
        n = node(unreal.MaterialExpressionTextureSample)
        n.set_editor_property("texture", cache[key])
        n.set_editor_property("const_coordinate", info["uv"])
        sampler = {"color": unreal.MaterialSamplerType.SAMPLERTYPE_COLOR,
                   "normal": unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL,
                   "data": unreal.MaterialSamplerType.SAMPLERTYPE_MASKS}[usage]
        n.set_editor_property("sampler_type", sampler)
        return n

    # Fixed review palette; no saved app appearance or runtime tint controls.
    factor = list(spec["baseColor"])
    if "_Defender_Gi" in name:
        factor = [.025, .045, .09, 1.]
    elif name.endswith("_Hair"):
        factor = [.045, .030, .020, 1.]
    elif name.endswith("_Belt"):
        factor = [.035, .08, .55, 1.] if "Attacker" in name else [.26, .035, .40, 1.]
    base = color(factor)
    if spec["colorTexture"]:
        base = multiply(sample(spec["colorTexture"], "color"), "RGB", base)
    prop(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
    rough = scalar(spec["roughness"])
    if spec["roughnessTexture"]:
        rough = multiply(sample(spec["roughnessTexture"], "data"), "G", rough)
    prop(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    if not skin:
        prop(scalar(spec["metallic"]), "", unreal.MaterialProperty.MP_METALLIC)
    if spec["normalTexture"]:
        normal = sample(spec["normalTexture"], "normal")
        strength = spec["normalTexture"]["scale"]
        scaled = multiply(normal, "RGB", color([strength, strength, 1.]))
        normalized = node(unreal.MaterialExpressionNormalize)
        # Normalize has one input; the documented empty-name convention selects
        # its first pin without relying on a reflected/display label.
        connect(scaled, "", normalized, "")
        prop(normalized, "", unreal.MaterialProperty.MP_NORMAL)
    if skin:
        prop(scalar(.5), "", unreal.MaterialProperty.MP_OPACITY)
    elif cloth:
        prop(color([.08, .08, .07]), "", unreal.MaterialProperty.MP_SUBSURFACE_COLOR)
        prop(scalar(.16), "", unreal.MaterialProperty.MP_CUSTOM_DATA_0)
    edit.layout_material_expressions(material)
    edit.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material)
    REPORT["materialGraphs"].append({"source": name, "asset": material.get_path_name(),
        "colorUV": (spec["colorTexture"] or {}).get("uv"),
        "normalUV": (spec["normalTexture"] or {}).get("uv"),
        "roughnessUV": (spec["roughnessTexture"] or {}).get("uv"),
        "roughnessChannel": "G", "skinDefaultProfileUntuned": skin})
    return material


def add_stage(actors):
    def spawn(cls, name, xyz, rotation=(0., 0., 0.)):
        obj = actors.spawn_actor_from_class(cls, unreal.Vector(*xyz), unreal.Rotator(*rotation))
        check(obj is not None, "Stage actor creation failed")
        obj.set_actor_label(name)
        return obj
    floor = spawn(unreal.StaticMeshActor, "Pilot floor", (0., 0., -3.))
    floor.static_mesh_component.set_static_mesh(unreal.load_asset("/Engine/BasicShapes/Cube"))
    floor.set_actor_scale3d(unreal.Vector(6., 6., .04))
    for name, xyz, rot, intensity in (
            ("Pilot key", (-180., -180., 260.), (-35., 45., 0.), 12000.),
            ("Pilot fill", (180., -80., 200.), (-30., 150., 0.), 5000.),
            ("Pilot rim", (20., 180., 240.), (-35., -90., 0.), 7000.)):
        light = spawn(unreal.RectLight, name, xyz, rot)
        comp = light.get_component_by_class(unreal.RectLightComponent)
        comp.set_editor_property("intensity", intensity)
        comp.set_editor_property("source_width", 150.)
        comp.set_editor_property("source_height", 150.)
    camera = spawn(unreal.CameraActor, "Pilot camera", (-360., -320., 185.))
    camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(camera.get_actor_location(), unreal.Vector(0., 0., 90.)), False)
    camera.camera_component.set_editor_property("field_of_view", 40.)
    camera.set_editor_property("auto_activate_for_player", unreal.AutoReceiveInput.PLAYER0)
    return camera


def import_clip(clip, stage, content, level, actors):
    map_path = content + "/Maps/" + clip["name"]
    check(level.new_level(map_path), "Could not create review map")
    derived = REVIEW / "ImportSources" / (clip["name"] + ".glb")
    selection = glb_with_selected_hair(stage / (clip["name"] + ".glb"), derived)
    parameters = unreal.ImportAssetParameters()
    parameters.set_editor_property("is_automated", True)
    parameters.set_editor_property("replace_existing", False)
    parameters.set_editor_property("import_level", level.get_current_level())
    manager = unreal.InterchangeManager.get_interchange_manager_scripted()
    target = content + "/Clips/" + clip["name"]
    check(manager.import_scene(target, manager.create_source_data(str(derived)), parameters), "Interchange scene import failed")
    assets = [unreal.load_asset(p) for p in unreal.EditorAssetLibrary.list_assets(target, recursive=True)]
    animations = [a for a in assets if isinstance(a, unreal.AnimSequence)]
    check(animations, "No skeletal animations imported; inspect Interchange results before proceeding")
    materials = {}; cache = {}
    for spec in clip["materials"]:
        materials[spec["name"]] = make_material(spec, clip["images"], stage, target + "/Lookdev", cache)
    components = []; roles = set()
    for actor in actors.get_all_level_actors():
        for comp in actor.get_components_by_class(unreal.SkeletalMeshComponent):
            mesh = comp.get_editor_property("skeletal_mesh_asset")
            if not mesh:
                continue
            slot_rows = list(mesh.get_editor_property("materials"))
            names = [str(s.get_editor_property("imported_material_slot_name")) for s in slot_rows]
            component_roles = {role for role in ("Attacker", "Defender") if any("JQ_" + role + "_" in n for n in names)}
            check(len(component_roles) == 1, "Cannot identify one source role for " + comp.get_path_name())
            role = next(iter(component_roles)); roles.add(role)
            for i, name in enumerate(names):
                check(name in materials, "Unrecognized imported material slot: " + name)
                comp.set_material(i, materials[name])
            skeleton = mesh.get_editor_property("skeleton")
            matches = [a for a in animations if a.get_editor_property("skeleton") == skeleton]
            check(len(matches) == 1, "Ambiguous/missing animation binding for " + mesh.get_path_name())
            animation = matches[0]
            duration = float(animation.get_editor_property("sequence_length"))
            check(math.isfinite(duration) and abs(duration - clip["durationSeconds"]) <= 1. / 30. + 1e-4,
                  "Imported animation length differs from source")
            comp.override_animation_data(animation, is_looping=clip["name"] == "standing_stance",
                                         is_playing=True, position=0., play_rate=1.)
            comp.set_editor_property("disable_cloth_simulation", True)
            components.append({"role": role, "actor": actor.get_path_name(), "component": comp.get_path_name(),
                "mesh": mesh.get_path_name(), "skeleton": skeleton.get_path_name(),
                "animation": animation.get_path_name(), "durationSeconds": duration,
                "materials": names, "locationCm": str(actor.get_actor_location()),
                "rotation": str(actor.get_actor_rotation()), "scale": str(actor.get_actor_scale3d())})
    check(roles == {"Attacker", "Defender"}, "Both original fighter roles must be present")
    camera = add_stage(actors)
    check(level.save_current_level(), "Review map save failed")
    unreal.EditorAssetLibrary.save_directory(target, only_if_is_dirty=True, recursive=True)
    return {"name": clip["name"], "map": map_path, "camera": camera.get_path_name(),
            "hairSelection": selection, "components": components,
            "animationBindingsAssigned": True, "pairedMotionValidated": False,
            "requiredReview": "Check imported world/root transforms and all-frame paired contact; single-node bindings are not a shared-clock runtime controller"}


def main():
    check(Path(unreal.Paths.project_dir()).resolve() == PROJECT, "Wrong Unreal project")
    version = unreal.SystemLibrary.get_engine_version()
    check(version.startswith("5.8."), "This pilot targets UE5.8; revalidate APIs before changing version")
    pointer = json.loads((STAGING / "current.json").read_text())
    manifest_path = inside(STAGING, pointer["manifest"])
    manifest = json.loads(manifest_path.read_text())
    pinned = json.loads((PROJECT / "pilot-assets.json").read_text())
    check(manifest["baselineCommit"] == pinned["baselineCommit"], "Staging baseline changed")
    check(manifest["fingerprint"] == pointer["fingerprint"], "Staging pointer mismatch")
    check([c["name"] for c in manifest["clips"]] == ["standing_stance", "rear_naked_choke", "armbar"], "Pilot allowlist changed")
    for clip, expected in zip(manifest["clips"], pinned["clips"]):
        check(clip["sha256"] == expected["sha256"] and clip["bytes"] == expected["bytes"], "Pinned asset changed")
        file = manifest_path.parent / (clip["name"] + ".glb")
        check(file.stat().st_size == clip["bytes"] and digest(file.read_bytes()) == clip["sha256"], "Staged source hash mismatch")
        for image in clip["images"]:
            check(digest(inside(manifest_path.parent, image["file"]).read_bytes()) == image["sha256"], "Staged image hash mismatch")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")
    content = "/Game/Pilot/Run_" + stamp
    check(not unreal.EditorAssetLibrary.does_directory_exist(content), "Refusing to overwrite an earlier import")
    REPORT.update(status="importing", engineVersion=version, baselineCommit=manifest["baselineCommit"],
                  sourceFingerprint=manifest["fingerprint"], contentRoot=content)
    save_report()
    level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for clip in manifest["clips"]:
        REPORT["clips"].append(import_clip(clip, manifest_path.parent, content, level, actors))
        save_report()
    REPORT["status"] = "editor_import_completed_visual_validation_pending"
    REPORT["completedAtUtc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save_report()
    unreal.log("JiuQuest pilot import completed. Visual, paired-motion and streaming validation remain pending.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        REPORT.update(status="failed", error=str(exc), traceback=traceback.format_exc())
        save_report()
        raise
