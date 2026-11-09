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
from ready_hands import refine_ready_hands
from pilot_look import refine_look
from pilot_hair import refine_hair
from pilot_hair_shape import refine_hair_shape, refine_spikes_shape

PROJECT = Path(__file__).resolve().parents[2]
STAGING = PROJECT / "Saved/PilotStaging"
REVIEW = PROJECT / "Saved/PilotReview"
REPORT = {"status": "not_started", "renderValidated": False,
          "pairedMotionValidated": False, "pixelStreamingValidated": False,
          "clips": [], "materialGraphs": [], "limits": [
              "Editor-only import and material/scene setup; no runtime web receiver",
              "Imported poses, pairing, timing, hair selection and material output require visual review",
              "Original lower-face/cotton sculpt and selected hair shading require visual comparison",
              "Standing-only wrist/finger presentation; no cloth grasp simulation",
              "Authored gi folds; no Chaos cloth simulation"]}


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


def glb_with_selected_hair(source, destination, style="Spikes"):
    """Compose audited import-only passes; the approved source file stays exact."""
    check(style in ("Slick", "Spikes"), "Hair style has not passed the pilot shading review")
    original = source.read_bytes()
    result, selection = select_hair(original, style)
    result, hands = refine_ready_hands(result, source.stem)
    result, sculpt = refine_look(result)
    result, hair = refine_hair(result, style)
    applied = ['pilot_source.select_hair', 'ready_hands.refine_ready_hands',
               'pilot_look.refine_look', 'pilot_hair.refine_hair']
    if style == "Slick":
        result, shape = refine_hair_shape(result)
        shape.update(applied=True, selectedHair=style)
        applied.append('pilot_hair_shape.refine_hair_shape')
    else:
        # Separate inventory and bounds; the six-lock Slick guard stays exact.
        result, shape = refine_spikes_shape(result)
        shape.update(applied=True, selectedHair=style)
        applied.append('pilot_hair_shape.refine_spikes_shape')
    proof = {'sourceSha256': digest(original), 'importSha256': digest(result),
             'selectedHair': style, 'appliedHelpers': applied,
             'selection': selection, 'readyHands': hands, 'sculpt': sculpt, 'hairShading': hair, 'hairShape': shape,
             'recipeFiles': {name: digest(Path(__file__).with_name(name).read_bytes()) for name in
                             ('import_pilot.py', 'pilot_source.py', 'ready_hands.py', 'pilot_look.py', 'pilot_hair.py', 'pilot_hair_shape.py')},
             'derivedSource': str(destination),
             'scope': 'Original source retained; selected hair shading, explicit style-specific shape handling, face/gi sculpt and standing grip derivative'}
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

    # UE hides MP_CustomData0 from Python. The public MakeMaterialAttributes
    # ClearCoat input carries that same channel, used as the Cloth amount by
    # MSM_Cloth. Route cloth inputs through attributes instead of a hidden enum.
    attributes = node(unreal.MaterialExpressionMakeMaterialAttributes) if cloth else None
    if attributes:
        material.set_editor_property("use_material_attributes", True)
        check(edit.connect_material_property(attributes, "", unreal.MaterialProperty.MP_MATERIAL_ATTRIBUTES),
              "Material attributes connection failed")

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
        if attributes:
            inputs = {unreal.MaterialProperty.MP_BASE_COLOR: "BaseColor",
                      unreal.MaterialProperty.MP_ROUGHNESS: "Roughness",
                      unreal.MaterialProperty.MP_METALLIC: "Metallic",
                      unreal.MaterialProperty.MP_NORMAL: "Normal",
                      unreal.MaterialProperty.MP_SUBSURFACE_COLOR: "SubsurfaceColor"}
            check(target in inputs, "Unmapped cloth material input")
            connect(n, output, attributes, inputs[target])
        else:
            check(edit.connect_material_property(n, output, target), "Material property connection failed")

    def multiply(a, out_a, b):
        n = node(unreal.MaterialExpressionMultiply)
        connect(a, out_a, n, "A")
        connect(b, "", n, "B")
        return n

    def texture_asset(info, usage):
        check(info["uv"] in (0, 1), "Unexpected source UV channel")
        image = images[info["image"]]
        key = (image["sha256"], usage)
        if key not in cache:
            cache[key] = import_texture(inside(stage, image["file"]), folder + "/Textures/" + usage, usage)
        return cache[key]

    def sample(info, usage):
        n = node(unreal.MaterialExpressionTextureSample)
        n.set_editor_property("texture", texture_asset(info, usage))
        n.set_editor_property("const_coordinate", info["uv"])
        sampler = {"color": unreal.MaterialSamplerType.SAMPLERTYPE_COLOR,
                   "normal": unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL,
                   "data": unreal.MaterialSamplerType.SAMPLERTYPE_MASKS}[usage]
        n.set_editor_property("sampler_type", sampler)
        return n

    # Fixed review palette; no saved app appearance or runtime tint controls.
    factor = list(spec["baseColor"])
    if skin:
        # Keep the source skin hue while retaining facial planes under the
        # fixed review lights. This is linear albedo, not camera exposure.
        factor[:3] = [channel * .82 for channel in factor[:3]]
    elif "_Defender_Gi" in name:
        factor = [.025, .045, .09, 1.]
    elif "_Attacker_Gi" in name:
        factor = [.65, .67, .69, 1.]
    elif name.endswith("_Hair"):
        factor = [.009, .006, .004, 1.]
    elif name.endswith("_Belt"):
        factor = [.035, .08, .55, 1.] if "Attacker" in name else [.26, .035, .40, 1.]
    base = color(factor)
    if spec["colorTexture"]:
        base = multiply(sample(spec["colorTexture"], "color"), "RGB", base)
    prop(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
    rough = scalar(.82 if name.endswith("_Hair") else spec["roughness"])
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
        if cloth:
            # Cloth normals use the panel atlas, independently of the mesh's
            # UV0 tangent basis. Derive a world-space frame from the same UV1
            # coordinates used to sample the authored normal map.
            check(spec["normalTexture"]["uv"] == 1, "Cloth normal atlas must use UV1")
            function = unreal.load_asset(
                "/Engine/Functions/Engine_MaterialFunctions01/Texturing/DeriveTangentBasis")
            check(function is not None, "Engine DeriveTangentBasis function is missing")
            derived = node(unreal.MaterialExpressionMaterialFunctionCall)
            check(derived.set_material_function(function), "Could not bind DeriveTangentBasis")
            coordinates = node(unreal.MaterialExpressionTextureCoordinate)
            coordinates.set_editor_property("coordinate_index", 1)
            connect(coordinates, "", normal, "UVs")
            connect(coordinates, "", derived, "UVs")
            connect(normalized, "", derived, "Normal")
            material.set_editor_property("tangent_space_normal", False)
            prop(derived, "World Space Normal", unreal.MaterialProperty.MP_NORMAL)
        else:
            prop(normalized, "", unreal.MaterialProperty.MP_NORMAL)
    if skin:
        prop(scalar(.2), "", unreal.MaterialProperty.MP_OPACITY)
        prop(scalar(.25), "", unreal.MaterialProperty.MP_SPECULAR)
    elif name.endswith("_Hair"):
        prop(scalar(.1), "", unreal.MaterialProperty.MP_SPECULAR)
        # Reuse the original painted strand values as shallow shading relief.
        # Four repeats across UV0 add finer flow without a new bitmap or any
        # vertex displacement. The ordinary colour atlas stays at its old UVs.
        check(spec['colorTexture'] and spec['colorTexture']['uv'] == 0,
              'Hair detail requires the original UV0 strand atlas')
        check(not spec['normalTexture'], 'Review how an existing hair normal should be blended')
        hair_texture = node(unreal.MaterialExpressionTextureObject)
        hair_texture.set_editor_property('texture', texture_asset(spec['colorTexture'], 'data'))
        hair_texture.set_editor_property('sampler_type', unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
        coordinates = node(unreal.MaterialExpressionTextureCoordinate)
        coordinates.set_editor_property('coordinate_index', 0)
        coordinates.set_editor_property('u_tiling', 4.)
        coordinates.set_editor_property('v_tiling', 1.)
        function = unreal.load_asset('/Engine/Functions/Engine_MaterialFunctions03/Procedurals/NormalFromHeightmap')
        check(function is not None, 'Engine NormalFromHeightmap function is missing')
        detail = node(unreal.MaterialExpressionMaterialFunctionCall)
        check(detail.set_material_function(function), 'Could not bind strand normal function')
        check(set(edit.get_material_expression_input_names(detail)) ==
              {'Height Map', 'Coordinates', 'Height Map UV Offset', 'Normal Map Intensity', 'Height Map Channel Selector'},
              'NormalFromHeightmap inputs changed; review the installed function')
        connect(hair_texture, '', detail, 'Height Map')
        connect(coordinates, '', detail, 'Coordinates')
        connect(scalar(.0039), '', detail, 'Height Map UV Offset')
        connect(scalar(3.), '', detail, 'Normal Map Intensity')
        basis_function = unreal.load_asset('/Engine/Functions/Engine_MaterialFunctions01/Texturing/DeriveTangentBasis')
        check(basis_function is not None, 'Engine DeriveTangentBasis function is missing')
        basis = node(unreal.MaterialExpressionMaterialFunctionCall)
        check(basis.set_material_function(basis_function), 'Could not bind hair UV0 tangent basis')
        connect(coordinates, '', basis, 'UVs')
        connect(detail, 'Result', basis, 'Normal')
        material.set_editor_property('tangent_space_normal', False)
        prop(basis, 'World Space Normal', unreal.MaterialProperty.MP_NORMAL)
    elif cloth:
        prop(color([.08, .08, .07]), "", unreal.MaterialProperty.MP_SUBSURFACE_COLOR)
        connect(scalar(.16), "", attributes, "ClearCoat")
    edit.layout_material_expressions(material)
    edit.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material)
    REPORT["materialGraphs"].append({"source": name, "asset": material.get_path_name(),
        "colorUV": (spec["colorTexture"] or {}).get("uv"),
        "normalUV": 0 if name.endswith('_Hair') else (spec["normalTexture"] or {}).get("uv"),
        "normalBasis": ("UV0 derivative world space" if name.endswith('_Hair') else
                        "UV1 derivative world space" if cloth and spec["normalTexture"] else "mesh tangent space"),
        "roughnessUV": (spec["roughnessTexture"] or {}).get("uv"),
        "roughnessChannel": "G", "skinDefaultProfileUntuned": skin,
        "skinBaseColorScale": .82 if skin else None,
        "hairStrandRelief": ({'source': 'original grayscale colour atlas', 'uv': 0,
                              'tiling': [4., 1.], 'normalIntensity': 3., 'uvOffset': .0039}
                             if name.endswith('_Hair') else None)})
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
            ("Pilot fill", (-220., -180., 140.), (0., 0., 0.), 2500.),
            ("Pilot rim", (20., 180., 240.), (-35., -90., 0.), 7000.)):
        light = spawn(unreal.RectLight, name, xyz, rot)
        comp = light.get_component_by_class(unreal.RectLightComponent)
        comp.set_mobility(unreal.ComponentMobility.MOVABLE)
        comp.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
        comp.set_editor_property("intensity", intensity)
        comp.set_editor_property("source_width", 150.)
        comp.set_editor_property("source_height", 150.)
        if name == "Pilot fill":
            light.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(
                light.get_actor_location(), unreal.Vector(0., 0., 100.)), False)
            comp.set_editor_property("source_width", 250.)
            comp.set_editor_property("source_height", 250.)
    camera = spawn(unreal.CameraActor, "Pilot camera", (-360., -320., 185.))
    camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(camera.get_actor_location(), unreal.Vector(0., 0., 90.)), False)
    camera.camera_component.set_editor_property("field_of_view", 40.)
    # A black review backdrop must not drive adaptive exposure. The installed
    # Editor comparison retained face/white-cotton detail at this fixed value.
    post = camera.camera_component.get_editor_property("post_process_settings")
    for key, value in {"override_auto_exposure_method": True,
                       "auto_exposure_method": unreal.AutoExposureMethod.AEM_MANUAL,
                       "override_auto_exposure_apply_physical_camera_exposure": True,
                       "auto_exposure_apply_physical_camera_exposure": False,
                       "override_auto_exposure_bias": True, "auto_exposure_bias": -7.,
                       "override_bloom_intensity": True, "bloom_intensity": 0.}.items():
        post.set_editor_property(key, value)
    camera.camera_component.set_editor_property("post_process_settings", post)
    camera.camera_component.set_editor_property("post_process_blend_weight", 1.)
    camera.set_editor_property("auto_activate_for_player", unreal.AutoReceiveInput.PLAYER0)
    return camera


def make_review_game_mode(content):
    # Edit only this run's generated Blueprint defaults, never the engine CDO.
    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", unreal.GameModeBase)
    blueprint = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        "BP_PilotReviewGameMode", content + "/Review", unreal.Blueprint, factory)
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
    REPORT["reviewGameMode"] = {"blueprint": blueprint.get_path_name(), "class": generated.get_path_name(),
                               "defaultPawnClass": None, "cameraAutoActivatePlayer": 0,
                               "gameplayReceiverImplemented": False}
    return generated


def make_shared_sequence(clip, assets, bindings, actors, world):
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
        parent_bindings.append({"name": binding.get_name(), "actor": objects[0].get_path_name()})
    check(len(parent_bindings) == 2 and {row["name"] for row in parent_bindings} == {"JQ_Attacker", "JQ_Defender"},
          "Imported fighter parent-motion bindings changed")
    rate = sequence.get_tick_resolution()
    tick_seconds = float(rate.denominator) / float(rate.numerator)
    duration = min(float(animation.get_editor_property("sequence_length")) for _, animation in bindings)
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
    sequence_actor.set_actor_label("Pilot shared character playback")
    playback = sequence_actor.get_editor_property("playback_settings")
    playback.set_editor_property("auto_play", True)
    playback.set_editor_property("loop_count", unreal.MovieSceneSequenceLoopCount(-1 if clip["name"] == "standing_stance" else 0))
    playback.set_editor_property("pause_at_end", clip["name"] != "standing_stance")
    playback.set_editor_property("disable_camera_cuts", True)
    playback.set_editor_property("disable_movement_input", True)
    playback.set_editor_property("disable_look_at_input", True)
    sequence_actor.set_editor_property("playback_settings", playback)
    sequence_actor.set_sequence(sequence)
    check(unreal.EditorAssetLibrary.save_loaded_asset(sequence, only_if_is_dirty=False), "Shared sequence save failed")
    return {"asset": sequence.get_path_name(), "actor": sequence_actor.get_path_name(),
            "durationSeconds": duration, "playbackEndSeconds": sequence.get_playback_end_seconds(),
            "tickResolution": {"numerator": rate.numerator, "denominator": rate.denominator},
            "parentBindings": parent_bindings, "skeletalBindingCount": len(bindings),
            "oneClockConfigured": True, "pairedMotionValidated": False}


def import_clip(clip, stage, content, level, actors, game_mode):
    map_path = content + "/Maps/" + clip["name"]
    check(level.new_level(map_path), "Could not create review map")
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    settings = world.get_world_settings()
    settings.set_editor_property("default_game_mode", game_mode)
    check(settings.get_editor_property("default_game_mode") == game_mode, "Review game mode assignment failed")
    derived = REVIEW / "ImportSources" / content.rsplit('/', 1)[-1] / (clip["name"] + ".glb")
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
    components = []; roles = set(); sequence_bindings = []
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
            # The saved LevelSequence controls parent transforms and all bones.
            # Independent component autoplay would create a second clock.
            comp.override_animation_data(animation, is_looping=False,
                                         is_playing=False, position=0., play_rate=1.)
            comp.set_editor_property("disable_cloth_simulation", True)
            sequence_bindings.append((comp, animation))
            components.append({"role": role, "actor": actor.get_path_name(), "component": comp.get_path_name(),
                "mesh": mesh.get_path_name(), "skeleton": skeleton.get_path_name(),
                "animation": animation.get_path_name(), "durationSeconds": duration,
                "materials": names, "locationCm": str(actor.get_actor_location()),
                "rotation": str(actor.get_actor_rotation()), "scale": str(actor.get_actor_scale3d())})
    check(roles == {"Attacker", "Defender"}, "Both original fighter roles must be present")
    shared_sequence = make_shared_sequence(clip, assets, sequence_bindings, actors, world)
    camera = add_stage(actors)
    check(level.save_current_level(), "Review map save failed")
    unreal.EditorAssetLibrary.save_directory(target, only_if_is_dirty=True, recursive=True)
    return {"name": clip["name"], "map": map_path, "camera": camera.get_path_name(),
            "gameMode": game_mode.get_path_name(),
            "sharedSequence": shared_sequence,
            "characterRefinement": selection, "components": components,
            "animationBindingsAssigned": True, "pairedMotionValidated": False,
            "requiredReview": "Check shared sequence playback against source world/root transforms and all-frame paired contact"}


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
    game_mode = make_review_game_mode(content)
    for clip in manifest["clips"]:
        REPORT["clips"].append(import_clip(clip, manifest_path.parent, content, level, actors, game_mode))
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
