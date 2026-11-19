"""Offline checks of import_video_motion.py against a stubbed unreal module.

They run the script's own request handling, run naming, refusal to overwrite, report writing,
GLB reading and step order against fakes. They do not import anything into Unreal, render, or
show that any real Editor API behaves as the fakes do. The retarget path in particular has
never run in an Editor; its tests only cover the script's own control flow and messages.
"""
import datetime
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "Content/Python/import_video_motion.py"
TEMPLATE = Path(__file__).resolve().parents[3] / "public/animations/bjj/double_leg.glb"
NOW = datetime.datetime(2026, 11, 19, 21, 30, 5, tzinfo=datetime.timezone.utc)
STAMP = "20261119_213005"
PARTS = ("Body", "Brows", "Eyes", "GiJacket", "GiPantsMesh") + tuple(
    "Hair" + style for style in ("Crew", "Long", "Mohawk", "Slick", "Spikes"))
# The 65 skin joints of the JiuQuest rig, in skin order.
JOINTS = ("root", "pelvis", "spine_01", "spine_02", "spine_03", "clavicle_l", "upperarm_l", "lowerarm_l",
          "hand_l") + tuple("%s_%s_l" % (finger, part) for finger in ("index", "middle", "pinky", "ring", "thumb")
                            for part in ("01", "02", "03", "04_leaf")) + (
    "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r") + tuple(
    "%s_%s_r" % (finger, part) for finger in ("index", "middle", "pinky", "ring", "thumb")
    for part in ("01", "02", "03", "04_leaf")) + (
    "neck_01", "Head", "thigh_l", "calf_l", "foot_l", "ball_l", "ball_leaf_l",
    "thigh_r", "calf_r", "foot_r", "ball_r", "ball_leaf_r")
SUFFIX = "_" + "0123456789abcdef" * 2  # Interchange's suffix on the Defender's duplicate joint names


def load_script(fake_unreal):
    spec = importlib.util.spec_from_file_location("import_video_motion_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"unreal": fake_unreal}):
        spec.loader.exec_module(module)
    return module


def build_glb(path, keys=12, fps=30., attacker=(0., 0., .8), defender=(0., 0., -.3), extras=None):
    """A minimal paired GLB with the node, skin, hair and animation layout of the templates:
    JQ_Pair -> JQ_<Role> -> JQ_<Role>_Rig -> root -> pelvis -> (Head, hands, feet), ten skinned
    mesh nodes per role and one animation moving both JQ_<Role> nodes 1 cm per key along X."""
    nodes, accessors, views, data = [], [], [], bytearray()

    def add(rows, kind):
        flat = [v for row in rows for v in (row if isinstance(row, tuple) else (row,))]
        data.extend(bytes(-len(data) % 4))
        views.append({"buffer": 0, "byteOffset": len(data), "byteLength": 4 * len(flat)})
        data.extend(struct.pack("<%df" % len(flat), *flat))
        accessors.append({"bufferView": len(views) - 1, "componentType": 5126, "count": len(rows), "type": kind})
        return len(accessors) - 1

    def node(name, **fields):
        nodes.append({"name": name, **fields})
        return len(nodes) - 1
    pair = node("JQ_Pair", children=[])
    skins, role_nodes = [], {}
    for role, start in (("Attacker", attacker), ("Defender", defender)):
        role_nodes[role] = node("JQ_" + role, translation=list(start), children=[])
        rig = node("JQ_%s_Rig" % role, children=[])
        root = node("root", children=[])
        pelvis = node("pelvis", translation=[0., .95, 0.], children=[])
        joints = [root, pelvis]
        for name, offset in (("Head", [0., .7, 0.]), ("hand_l", [.75, .45, 0.]), ("hand_r", [-.75, .45, 0.]),
                             ("foot_l", [.1, -.9, 0.]), ("foot_r", [-.1, -.9, 0.])):
            joints.append(node(name, translation=offset))
            nodes[pelvis]["children"].append(joints[-1])
        nodes[pair]["children"].append(role_nodes[role])
        nodes[role_nodes[role]]["children"].append(rig)
        nodes[rig]["children"].append(root)
        nodes[root]["children"].append(pelvis)
        skins.append({"name": "JQ_%s_Rig" % role, "joints": joints})
    scene_nodes = [pair]
    for skin, role in enumerate(("Attacker", "Defender")):
        for part in PARTS:
            scene_nodes.append(node("JQ_%s_%s" % (role, part), mesh=0, skin=skin))
    times = add([(i + 1) / fps for i in range(keys)], "SCALAR")
    samplers, channels = [], []
    for role, start in (("Attacker", attacker), ("Defender", defender)):
        moved = [(start[0] + .01 * i, start[1], start[2]) for i in range(keys)]
        samplers.append({"input": times, "output": add(moved, "VEC3"), "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": role_nodes[role], "path": "translation"}})
    gltf = {"asset": {"version": "2.0"}, "scene": 0, "nodes": nodes,
            "scenes": [{"nodes": scene_nodes, "extras": extras if extras is not None else {
                "JQ_motion_type": "video-reference-fit",
                "JQ_review_status": "VIDEO-DERIVED DRAFT - requires qualified BJJ coach review"}}],
            "meshes": [{"name": "placeholder", "primitives": []}], "skins": skins,
            "animations": [{"name": "Animation", "samplers": samplers, "channels": channels}],
            "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(data)}]}
    text = json.dumps(gltf).encode()
    text += b" " * (-len(text) % 4)
    data.extend(bytes(-len(data) % 4))
    raw = (struct.pack("<III", 0x46546C67, 2, 28 + len(text) + len(data))
           + struct.pack("<II", len(text), 0x4E4F534A) + text
           + struct.pack("<II", len(data), 0x004E4942) + bytes(data))
    Path(path).write_bytes(raw)
    return raw


# ---------------------------------------------------------------- a fake Editor

class Vector:
    def __init__(self, x=0., y=0., z=0.):
        self.x, self.y, self.z = float(x), float(y), float(z)

    def __str__(self):
        return "X=%.3f Y=%.3f Z=%.3f" % (self.x, self.y, self.z)


class Rotator:
    def __init__(self, roll=0., pitch=0., yaw=0.):
        self.roll, self.pitch, self.yaw = roll, pitch, yaw


class Obj:
    """A UObject or struct stand-in with editor properties and a path."""

    def __init__(self, path="/Fake/Object", **properties):
        self.path, self.properties = path, dict(properties)

    def set_editor_property(self, name, value):
        self.properties[name] = value

    def get_editor_property(self, name):
        return self.properties[name]

    def get_path_name(self):
        return self.path

    def get_name(self):
        return self.path.rsplit("/", 1)[-1].split(".")[-1]


class AnimSequence(Obj):
    pass


class SkeletalMesh(Obj):
    pass


class LevelSequence(Obj):
    def __init__(self, path, bindings):
        super().__init__(path)
        self.bindings, self.possessables, self.end = bindings, [], None

    def get_bindings(self):
        return list(self.bindings)

    def locate_bound_objects(self, binding, world):
        return list(binding.objects)

    def get_tick_resolution(self):
        return types.SimpleNamespace(numerator=24000, denominator=1)

    def set_playback_start_seconds(self, seconds):
        self.start = seconds

    def set_playback_end_seconds(self, seconds):
        self.end = seconds

    def get_playback_end_seconds(self):
        return self.end

    def add_possessable(self, thing):
        binding = Binding(thing.get_name(), [thing], [])
        self.possessables.append(binding)
        return binding


class Binding:
    def __init__(self, name, objects, tracks):
        self.name, self.objects, self.tracks = name, objects, tracks

    def get_name(self):
        return self.name

    def get_tracks(self):
        return list(self.tracks)

    def add_track(self, kind):
        track = kind()
        self.tracks.append(track)
        return track


class TransformTrack(Obj):
    pass


class Section(Obj):
    def __init__(self):
        super().__init__("/Fake/Section", params=Obj("/Fake/Params"))

    def set_range_seconds(self, start, end):
        self.range = (start, end)

    def set_completion_mode(self, mode):
        self.completion = mode


class SkeletalTrack(Obj):
    def __init__(self):
        super().__init__("/Fake/SkeletalTrack")
        self.sections = []

    def add_section(self):
        self.sections.append(Section())
        return self.sections[-1]


class Component(Obj):
    def set_mobility(self, mobility):
        self.mobility = mobility

    def set_static_mesh(self, mesh):
        self.mesh = mesh


class SkeletalMeshComponent(Component):
    def __init__(self, path, mesh, bones):
        super().__init__(path, skeletal_mesh_asset=mesh)
        self.bones, self.override = bones, None

    def override_animation_data(self, animation, **settings):
        self.override = (animation, settings)

    def get_num_bones(self):
        return len(self.bones)

    def get_bone_name(self, index):
        return self.bones[index]


class Actor(Obj):
    def __init__(self, path, location=(0., 0., 0.), components=()):
        super().__init__(path)
        self.location, self.components = Vector(*location), list(components)
        self.rotation, self.scale, self.label = Rotator(), Vector(1., 1., 1.), None

    def get_components_by_class(self, kind):
        return [c for c in self.components if isinstance(c, kind)]

    def get_component_by_class(self, kind):
        found = self.get_components_by_class(kind)
        return found[0] if found else None

    def get_actor_location(self):
        return self.location

    def get_actor_rotation(self):
        return self.rotation

    def get_actor_scale3d(self):
        return self.scale

    def set_actor_label(self, label):
        self.label = label

    def set_actor_rotation(self, rotation, teleport):
        self.rotation = rotation

    def set_actor_scale3d(self, scale):
        self.scale = scale


class RectLightComponent(Component):
    pass


class StaticMeshActor(Actor):
    def __init__(self, path, location):
        super().__init__(path, location)
        self.static_mesh_component = Component(path + ".StaticMeshComponent0")


class RectLight(Actor):
    def __init__(self, path, location):
        super().__init__(path, location, [RectLightComponent(path + ".LightComponent0")])


class CineCameraActor(Actor):
    def __init__(self, path, location):
        super().__init__(path, location)
        self.camera_component = Component(
            path + ".CameraComponent", filmback=Obj("/Fake/Filmback"), focus_settings=Obj("/Fake/Focus"),
            post_process_settings=Obj("/Fake/PostProcess"))


class LevelSequenceActor(Actor):
    def __init__(self, path, location):
        super().__init__(path, location)
        self.properties["playback_settings"] = Obj("/Fake/PlaybackSettings")

    def set_sequence(self, sequence):
        self.sequence = sequence


class IKRigDefinition(Obj):
    pass


class IKRetargeter(Obj):
    pass


class RigController:
    def __init__(self, editor, rig):
        self.editor, self.rig = editor, rig

    def set_skeletal_mesh(self, mesh):
        self.rig.mesh = mesh
        return True

    def set_retarget_root(self, bone):
        self.rig.root = bone
        return True

    def add_retarget_chain(self, name, start, end, goal):
        if self.editor.refuse_chain_for and self.editor.refuse_chain_for in start:
            return None
        self.rig.chains = getattr(self.rig, "chains", []) + [(name, start, end)]
        return name

    def apply_auto_generated_retarget_definition(self):
        self.rig.auto = True
        return True

    def apply_auto_fbik(self):
        return True


class RetargeterController:
    def __init__(self, retargeter):
        self.retargeter = retargeter
        retargeter.calls = []

    def set_ik_rig(self, side, rig):
        self.retargeter.calls.append(("set_ik_rig", side, rig.get_path_name()))

    def auto_map_chains(self, kind, force):
        self.retargeter.calls.append(("auto_map_chains", kind, force))

    def add_default_ops(self):
        self.retargeter.calls.append(("add_default_ops",))


class FakeEditor:
    """Just enough of the unreal module for import_video_motion.main, recording what it did."""

    def __init__(self, project, version="5.8.4-0+++UE5+Release-5.8", duration=.4, retarget=None,
                 batch=("run_batch_retarget", "duplicate_and_retarget")):
        self.project, self.version, self.duration = Path(project), version, duration
        self.assets, self.existing, self.actors_in_level = {}, set(), []
        self.imports, self.new_levels, self.saved, self.logs = [], [], [], []
        self.import_result, self.refuse_chain_for, self.retarget_inputs = True, None, []
        self.world = Obj("/Game/Map.Map")
        self.world_settings = Obj("/Game/Map.Map:WorldSettings", default_game_mode=None)
        self.world.get_world_settings = lambda: self.world_settings
        self.unreal = self.module(retarget, batch)

    # -- the import fills a level and a content folder like Interchange's scene import did
    def populate(self, target):
        parents, animations = {}, {}
        for index, role in enumerate(("Attacker", "Defender")):
            skeleton = Obj("%s/JQ_%s_Rig_Skeleton.JQ_%s_Rig_Skeleton" % (target, role, role))
            animations[role] = AnimSequence("%s/JQ_%s_Anim.JQ_%s_Anim" % (target, role, role),
                                            skeleton=skeleton, sequence_length=self.duration)
            self.assets[animations[role].path] = animations[role]
            parents[role] = Actor("/Game/Map.JQ_%s" % role, (0., 80. - 110. * index, 0.))
            self.actors_in_level.append(parents[role])
            bones = [name + (SUFFIX if role == "Defender" else "") for name in JOINTS]
            for part in ("Body", "Brows", "Eyes", "GiJacket", "GiPantsMesh", "Belt", "BeltStripe_1",
                         "BeltStripe_2", "BeltStripe_3", "BeltStripe_4", "HairSpikes"):
                material = "JQ_%s_%s" % (role, "Skin_Ref_E9B28D" if part == "Body" else part)
                mesh = SkeletalMesh("%s/JQ_%s_%s.JQ_%s_%s" % (target, role, part, role, part),
                                    skeleton=skeleton, materials=[Obj("/Fake/Slot", imported_material_slot_name=material)])
                self.assets[mesh.path] = mesh
                actor = Actor("/Game/Map.JQ_%s_%s" % (role, part))
                actor.components.append(SkeletalMeshComponent(actor.path + ".SkeletalMeshComponent0", mesh, bones))
                self.actors_in_level.append(actor)
        sequence = LevelSequence("%s/%s.%s" % (target, "Scene", "Scene"),
                                 [Binding("JQ_" + role, [parents[role]], [TransformTrack()]) for role in parents])
        self.assets[sequence.path] = sequence
        self.sequence = sequence

    def module(self, retarget, batch):
        editor = self

        class ActorSubsystem:
            def get_all_level_actors(self):
                return list(editor.actors_in_level)

            def spawn_actor_from_class(self, kind, location, rotation=None):
                actor = kind("/Game/Map.%s_%d" % (kind.__name__, len(editor.actors_in_level)),
                             (location.x, location.y, location.z))
                editor.actors_in_level.append(actor)
                return actor

        class LevelSubsystem:
            def new_level(self, path):
                editor.new_levels.append(path)
                editor.actors_in_level = []
                return True

            def get_current_level(self):
                return "current level"

            def save_current_level(self):
                editor.saved.append("level")
                return True

        def create_asset(name, folder, kind, factory):
            path = "%s/%s.%s" % (folder, name, name)
            asset = kind(path) if isinstance(kind, type) else Obj(path)
            editor.assets[path] = asset
            return asset

        class Manager:
            def create_source_data(self, filename):
                return ("source", filename)

            def import_scene(self, target, source, parameters):
                editor.imports.append((target, source[1], dict(parameters.properties)))
                if editor.import_result:
                    editor.populate(target)
                return editor.import_result

        class AssetData:
            def __init__(self, path):
                self.path = path

            def get_asset(self):
                return editor.assets[self.path]

        def save_loaded_asset(asset, only_if_is_dirty=True):
            editor.saved.append(asset.get_path_name())
            return True

        def save_directory(path, only_if_is_dirty=True, recursive=True):
            editor.saved.append(path + "/")
            return True

        subsystems = {"LevelEditorSubsystem": LevelSubsystem(), "EditorActorSubsystem": ActorSubsystem(),
                      "UnrealEditorSubsystem": types.SimpleNamespace(get_editor_world=lambda: editor.world)}
        unreal = types.SimpleNamespace(
            log=editor.logs.append, Vector=Vector, Rotator=Rotator,
            Paths=types.SimpleNamespace(project_dir=lambda: str(editor.project) + "/"),
            SystemLibrary=types.SimpleNamespace(get_engine_version=lambda: editor.version),
            LevelEditorSubsystem="LevelEditorSubsystem", EditorActorSubsystem="EditorActorSubsystem",
            UnrealEditorSubsystem="UnrealEditorSubsystem", get_editor_subsystem=lambda name: subsystems[name],
            EditorAssetLibrary=types.SimpleNamespace(
                does_directory_exist=lambda path: path in editor.existing,
                list_assets=lambda path, recursive=True: [p for p in editor.assets if p.startswith(path + "/")],
                save_loaded_asset=save_loaded_asset, save_directory=save_directory,
                load_blueprint_class=lambda path: Obj(path.rsplit(".", 1)[0] + "." + path.rsplit(".", 1)[-1] + "_C"),
                find_asset_data=AssetData),
            load_asset=lambda path: editor.assets.get(path),
            AssetToolsHelpers=types.SimpleNamespace(
                get_asset_tools=lambda: types.SimpleNamespace(create_asset=create_asset)),
            BlueprintFactory=lambda: Obj("/Fake/BlueprintFactory"), GameModeBase="GameModeBase", Blueprint=Obj,
            BlueprintEditorLibrary=types.SimpleNamespace(compile_blueprint=lambda blueprint: True),
            get_default_object=lambda generated: Obj(generated.path + ":Default", default_pawn_class="DefaultPawn"),
            ImportAssetParameters=lambda: Obj("/Fake/ImportAssetParameters"),
            InterchangeManager=types.SimpleNamespace(get_interchange_manager_scripted=lambda: Manager()),
            AnimSequence=AnimSequence, LevelSequence=LevelSequence, SkeletalMeshComponent=SkeletalMeshComponent,
            Actor=Actor, MovieScene3DTransformTrack=TransformTrack, MovieSceneSkeletalAnimationTrack=SkeletalTrack,
            MovieSceneCompletionMode=types.SimpleNamespace(KEEP_STATE="KEEP_STATE"),
            MovieSceneSequenceLoopCount=lambda value: ("loop count", value),
            LevelSequenceActor=LevelSequenceActor, StaticMeshActor=StaticMeshActor, RectLight=RectLight,
            RectLightComponent=RectLightComponent, CineCameraActor=CineCameraActor,
            ComponentMobility=types.SimpleNamespace(MOVABLE="MOVABLE"),
            LightUnits=types.SimpleNamespace(CANDELAS="CANDELAS"),
            AutoExposureMethod=types.SimpleNamespace(AEM_MANUAL="AEM_MANUAL"),
            AutoReceiveInput=types.SimpleNamespace(PLAYER0="PLAYER0"),
            CameraFocusMethod=types.SimpleNamespace(DISABLE="DISABLE"),
            MathLibrary=types.SimpleNamespace(find_look_at_rotation=lambda start, end: ("look at", end.x, end.y, end.z)))
        if retarget:
            def run_batch_retarget(inputs):
                editor.retarget_inputs.append(dict(inputs.properties))
                source = inputs.properties["assets_to_retarget"][0].get_asset()
                target = inputs.properties["target_mesh"]
                path = "%s/%s%s.%s%s" % (inputs.properties["target_path"], source.get_name(),
                                         inputs.properties["suffix"], source.get_name(), inputs.properties["suffix"])
                editor.assets[path] = AnimSequence(path, skeleton=target.get_editor_property("skeleton"),
                                                   sequence_length=source.get_editor_property("sequence_length"))
                return [AssetData(path)]

            def duplicate_and_retarget(assets, source_mesh, target_mesh, retargeter, search, replace, prefix,
                                       suffix, include):
                editor.retarget_inputs.append({"positional": (search, replace, prefix, suffix, include)})
                source = assets[0].get_asset()
                path = source.path.rsplit(".", 1)[0] + suffix + "." + source.get_name() + suffix
                editor.assets[path] = AnimSequence(path, skeleton=target_mesh.get_editor_property("skeleton"),
                                                   sequence_length=source.get_editor_property("sequence_length"))
                return [AssetData(path)]
            operation = types.SimpleNamespace()
            if "run_batch_retarget" in batch:
                operation.run_batch_retarget = run_batch_retarget
                unreal.IKRetargetBatchOperationInputs = lambda: Obj("/Fake/IKRetargetBatchOperationInputs")
            if "duplicate_and_retarget" in batch:
                operation.duplicate_and_retarget = duplicate_and_retarget
            unreal.__dict__.update(
                SkeletalMesh=SkeletalMesh, IKRigDefinition=IKRigDefinition, IKRetargeter=IKRetargeter,
                IKRigDefinitionFactory=lambda: "IKRigDefinitionFactory", IKRetargetFactory=lambda: "IKRetargetFactory",
                IKRigController=types.SimpleNamespace(
                    get_controller=lambda rig: RigController(editor, rig), set_skeletal_mesh=1,
                    set_retarget_root=1, add_retarget_chain=1, apply_auto_generated_retarget_definition=1),
                IKRetargeterController=types.SimpleNamespace(
                    get_controller=RetargeterController, set_ik_rig=1, auto_map_chains=1),
                RetargetSourceOrTarget=types.SimpleNamespace(SOURCE="SOURCE", TARGET="TARGET"),
                AutoMapChainType=types.SimpleNamespace(FUZZY="FUZZY"),
                IKRetargetBatchOperation=operation)
            target = SkeletalMesh(retarget + "." + retarget.rsplit("/", 1)[-1],
                                  skeleton=Obj("/Game/MetaHumans/Common/metahuman_base_skel"))
            self.assets[retarget] = target
        return unreal


class ScriptTestCase(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.temp = Path(directory.name)
        self.project = self.temp / "Project"
        self.project.mkdir()
        self.glb = self.temp / "inbox" / "leg_hook_takedown.glb"
        self.glb.parent.mkdir()
        self.raw = build_glb(self.glb)
        self.editor = FakeEditor(self.project)
        self.module = load_script(self.editor.unreal)
        self.module.SIDECAR = self.temp / "no-sidecar.json"

    def use(self, editor):
        self.editor = editor
        self.module.unreal = editor.unreal

    def run_script(self, argv=None, environ=None):
        argv = [str(self.glb)] if argv is None else argv
        return self.module.run(argv, {} if environ is None else environ, NOW)

    def report_path(self, clip="leg_hook_takedown"):
        return self.project / "Saved/VideoMotion" / clip / STAMP / "import-report.json"

    def latest(self):
        pointer = json.loads((self.project / "Saved/VideoMotion/latest-import.json").read_text())
        return pointer, json.loads(Path(pointer["report"]).read_text())


class RequestTests(ScriptTestCase):
    def test_arguments_follow_the_script_path(self):
        request, source, others = self.module.resolve_request(
            [str(self.glb), "--clip", "leg_hook_takedown_v2", "--hair", "slick"], {})
        self.assertEqual(source, "argv")
        self.assertEqual(others, [])
        self.assertEqual(request, {"glb": str(self.glb), "clip": "leg_hook_takedown_v2", "hair": "Slick",
                                   "retargetTarget": None, "retargetTargetIkRig": None})

    def test_default_clip_name_is_the_file_name_made_safe(self):
        request, _, _ = self.module.resolve_request([str(self.temp / "Leg-hook takedown (v2).glb")], {})
        self.assertEqual(request["clip"], "Leg_hook_takedown_v2")
        self.assertEqual(request["hair"], "Spikes")
        with self.assertRaises(self.module.UsageError):
            self.module.resolve_request([str(self.temp / "2026.glb")], {})

    def test_invalid_requests_are_refused_with_a_usage_error(self):
        target = "/Game/MetaHumans/Ada/Body/m_med_nrw_body"
        for argv in (["leg_hook_takedown.glb"],                       # relative: not the shell's directory
                     [str(self.temp / "motion.npz")],                  # not a GLB
                     [str(self.glb), "--clip", "leg hook"],            # spaces in a folder name
                     [str(self.glb), "--clip", "1st_take"],
                     [str(self.glb), "--clip", "x" * 65],
                     [str(self.glb), "--hair", "Bald"],
                     [str(self.glb), "--retarget-target", "C:/MetaHuman.uasset"],
                     [str(self.glb), "--retarget-target", "/Game/Has Space/Body"],
                     [str(self.glb), "--retarget-target-ik-rig", "/Game/IK/IK_Body"],  # without a target
                     [str(self.glb), "--retarget-target", target, "--retarget-target-ik-rig", "IK_Body"],
                     [str(self.glb), "--unknown"], [str(self.glb), "-h"], [str(self.glb), str(self.glb)]):
            with self.subTest(argv=argv), self.assertRaises(self.module.UsageError):
                self.module.resolve_request(argv, {})

    def test_parser_errors_never_exit_the_editor_python(self):
        try:
            self.module.resolve_request(["--help"], {})
        except SystemExit:  # pragma: no cover - this is the failure being guarded against
            self.fail("argparse called sys.exit")
        except self.module.UsageError as error:
            self.assertIn("usage: import_video_motion.py", str(error))

    def test_environment_then_sidecar_when_no_arguments(self):
        sidecar = self.temp / "import_video_motion.json"
        sidecar.write_text(json.dumps({"glb": str(self.temp / "from_sidecar.glb"), "clip": "sidecar_clip"}))
        environ = {"JQ_VIDEO_MOTION_GLB": str(self.temp / "with space" / "from env.glb"),
                   "JQ_VIDEO_MOTION_CLIP": "env_clip", "JQ_VIDEO_MOTION_HAIR": "Crew"}
        request, source, others = self.module.resolve_request(["", "  "], environ, sidecar)
        self.assertEqual((source, others), ("environment", ["sidecar"]))
        self.assertEqual((request["glb"], request["clip"], request["hair"]),
                         (environ["JQ_VIDEO_MOTION_GLB"], "env_clip", "Crew"))
        request, source, others = self.module.resolve_request([], {}, sidecar)
        self.assertEqual((source, others, request["clip"]), ("sidecar", [], "sidecar_clip"))
        # Windows PowerShell 5.1's Set-Content -Encoding utf8 starts the file with a BOM.
        sidecar.write_bytes(b"\xef\xbb\xbf" + json.dumps({"glb": str(self.glb)}).encode())
        request, source, _ = self.module.resolve_request([], {}, sidecar)
        self.assertEqual((source, request["clip"]), ("sidecar", "leg_hook_takedown"))
        request, source, others = self.module.resolve_request([str(self.glb)], environ, sidecar)
        self.assertEqual((source, others, request["clip"]), ("argv", ["environment", "sidecar"], "leg_hook_takedown"))

    def test_a_chosen_but_incomplete_source_is_an_error_not_skipped(self):
        sidecar = self.temp / "import_video_motion.json"
        sidecar.write_text(json.dumps({"glb": str(self.glb)}))
        with self.assertRaises(self.module.UsageError):  # a clip without a GLB in the environment
            self.module.resolve_request([], {"JQ_VIDEO_MOTION_CLIP": "env_clip"}, sidecar)
        for content in ('{"glb": "%s", "extra": 1}' % self.glb.as_posix(), "[]", "{not json", '{"glb": 3}'):
            sidecar.write_text(content)
            with self.subTest(content=content), self.assertRaises(self.module.UsageError):
                self.module.resolve_request([], {}, sidecar)

    def test_no_request_names_all_three_ways(self):
        with self.assertRaises(self.module.UsageError) as caught:
            self.module.resolve_request([], {}, self.temp / "absent.json")
        message = str(caught.exception)
        for part in ("-ExecutePythonScript", "JQ_VIDEO_MOTION_GLB", "absent.json"):
            self.assertIn(part, message)


class NamingTests(ScriptTestCase):
    def test_run_folder_and_report_names_share_one_utc_stamp(self):
        self.assertEqual(self.module.run_stamp(NOW), STAMP)
        eastern = NOW.astimezone(datetime.timezone(datetime.timedelta(hours=-5)))
        self.assertEqual(self.module.run_stamp(eastern), STAMP)
        self.assertEqual(self.module.content_root("leg_hook_takedown", STAMP),
                         "/Game/VideoMotion/leg_hook_takedown/Run_20261119_213005")
        self.assertEqual(self.module.run_directory(self.project, "leg_hook_takedown", STAMP),
                         self.project / "Saved/VideoMotion/leg_hook_takedown/20261119_213005")


class GlbTests(ScriptTestCase):
    def test_summary_reads_keys_duration_and_extras(self):
        summary = self.module.summarize_glb(self.raw)
        self.assertEqual(summary["keyCount"], 12)
        self.assertEqual(summary["fps"], 30.)
        self.assertTrue(summary["keyTimesUniform"])
        self.assertAlmostEqual(summary["firstKeySeconds"], 1. / 30., places=6)
        self.assertAlmostEqual(summary["expectedDurationSeconds"], .4, places=6)
        self.assertEqual(summary["expectedFrameCount"], 12)
        self.assertTrue(summary["motionTypeIsVideoReferenceFit"])
        self.assertIn("coach review", summary["reviewStatus"])
        # glTF metres (x, y, z) are Unreal centimetres (x, z, y) * 100.
        rest = summary["roleNodes"]["JQ_Attacker"]["restTranslationCm"]
        self.assertEqual([round(v, 4) for v in rest], [0., 80., 0.])

    def assert_every_joint_in_view(self, raw, framing):
        """Project every sampled joint through the look-at camera and check the 16:9 frame."""
        gltf, binary = self.module.parse_glb(raw)
        animation = gltf["animations"][0]
        times = [t for (t,) in self.module.read_floats(gltf, binary, animation["samplers"][0]["input"])]
        location, target = framing["cameraLocationCm"], framing["lookAtCm"]
        forward = [b - a for a, b in zip(location, target)]
        length = math.sqrt(sum(v * v for v in forward))
        forward = [v / length for v in forward]
        right = [-forward[1], forward[0], 0.]
        length = math.hypot(right[0], right[1])
        right = [v / length for v in right]
        up = [-forward[2] * forward[0], -forward[2] * forward[1], 1. - forward[2] * forward[2]]
        length = math.sqrt(sum(v * v for v in up))
        up = [v / length for v in up]
        tan_h = framing["filmbackMm"][0] / (2. * framing["focalLengthMm"])
        tan_v = framing["filmbackMm"][1] / (2. * framing["focalLengthMm"])
        count = 0
        for sample in self.module.sample_positions(gltf, binary, animation, times):
            for key, point in sample.items():
                if key[1] == "node":
                    continue
                offset = [p - c for p, c in zip(point, location)]
                depth = sum(a * b for a, b in zip(offset, forward))
                self.assertGreater(depth, 0.)
                self.assertLess(abs(sum(a * b for a, b in zip(offset, right))) / depth, tan_h, key)
                self.assertLess(abs(sum(a * b for a, b in zip(offset, up))) / depth, tan_v, key)
                count += 1
        return count

    def test_side_camera_sees_the_pair_across_their_line_from_the_lit_side(self):
        framing = self.module.summarize_glb(self.raw)["framing"]
        # The athletes stand on the Unreal Y axis; the pilot's lights face the -X side.
        self.assertEqual([round(v, 6) for v in framing["cameraSide"]], [-1., 0.])
        location, target = framing["cameraLocationCm"], framing["lookAtCm"]
        self.assertLess(location[0], target[0] - 300.)
        self.assertAlmostEqual(location[1], target[1], places=6)
        self.assertGreater(location[2], target[2])
        self.assertTrue(300. <= framing["distanceCm"] <= 3000.)
        # Looking along +X, Unreal's image right is +Y, where the attacker starts.
        self.assertEqual(framing["attackerImageSideAtFirstKey"], "right")
        self.assertEqual(self.assert_every_joint_in_view(self.raw, framing), 12 * 12)

    def test_pair_along_x_puts_the_camera_on_the_minus_y_side(self):
        raw = build_glb(self.temp / "across.glb", attacker=(-.6, 0., 0.), defender=(.6, 0., 0.))
        framing = self.module.summarize_glb(raw)["framing"]
        self.assertEqual([round(v, 6) for v in framing["cameraSide"]], [0., -1.])
        # Looking along +Y, Unreal's (left-handed, Z up) image right is -X, where the attacker is.
        self.assertEqual(framing["attackerImageSideAtFirstKey"], "right")

    def test_stacked_pelvises_fall_back_to_a_stable_axis(self):
        raw = build_glb(self.temp / "stacked.glb", attacker=(0., 0., 0.), defender=(0., 0., 0.))
        framing = self.module.summarize_glb(raw)["framing"]
        self.assertTrue(framing["pairAxisSource"].startswith("template layout"))
        self.assertTrue(all(math.isfinite(v) for v in framing["cameraLocationCm"]))

    def test_files_that_are_not_paired_glbs_are_refused(self):
        gltf_bytes = self.raw
        size = struct.unpack_from("<I", gltf_bytes, 12)[0]
        document = json.loads(gltf_bytes[20:20 + size])

        def rebuilt(change):
            changed = json.loads(json.dumps(document))
            change(changed)
            text = json.dumps(changed).encode()
            text += b" " * (-len(text) % 4)
            tail = gltf_bytes[20 + size:]
            return struct.pack("<III", 0x46546C67, 2, 20 + len(text) + len(tail)) + \
                struct.pack("<II", len(text), 0x4E4F534A) + text + tail
        cases = {"truncated": gltf_bytes[:-4], "not glTF": b"PK\x03\x04" + gltf_bytes[4:],
                 "no pair": rebuilt(lambda d: d["nodes"][0].update(name="Pair")),
                 "two animations": rebuilt(lambda d: d["animations"].append(d["animations"][0])),
                 "no animation": rebuilt(lambda d: d.pop("animations")),
                 "cubic": rebuilt(lambda d: [s.update(interpolation="CUBICSPLINE") for s in d["animations"][0]["samplers"]])}
        for name, raw in cases.items():
            with self.subTest(name), self.assertRaises(RuntimeError):
                self.module.summarize_glb(raw)

    @unittest.skipUnless(TEMPLATE.is_file(), "published template not checked out")
    def test_published_template_reads_as_126_keys_of_4_2_seconds(self):
        summary = self.module.summarize_glb(TEMPLATE.read_bytes())
        self.assertEqual((summary["keyCount"], summary["fps"], summary["expectedFrameCount"]), (126, 30., 126))
        self.assertAlmostEqual(summary["expectedDurationSeconds"], 4.2, places=5)
        self.assertEqual(summary["channelCount"], 396)
        framing = summary["framing"]
        self.assertEqual(framing["sampledKeys"], 126)
        self.assertTrue(300. <= framing["distanceCm"] <= 3000.)
        self.assertLess(framing["cameraLocationCm"][0], 0.)
        raw = TEMPLATE.read_bytes()
        self.assertEqual(GlbTests.assert_every_joint_in_view(self, raw, framing), 126 * 12)


class ImportRunTests(ScriptTestCase):
    def test_completed_run_records_hashes_folders_steps_and_one_clock(self):
        data = self.run_script(["%s" % self.glb, "--clip", "leg_hook_takedown"])
        report = json.loads(self.report_path().read_text())
        self.assertEqual(report, data)
        self.assertEqual(report["status"], "editor_import_completed_visual_validation_pending")
        for flag in ("renderValidated", "pairedMotionValidated", "coachReviewed", "retargetValidated"):
            self.assertIs(report[flag], False)
        self.assertTrue(report["importCompleted"])
        self.assertEqual(report["request"]["source"], "argv")
        self.assertEqual(report["contentRoot"], "/Game/VideoMotion/leg_hook_takedown/Run_" + STAMP)
        self.assertEqual(report["map"], report["contentRoot"] + "/Maps/leg_hook_takedown")
        # SHA-256 of the exact source bytes and of the imported hair-selected copy.
        self.assertEqual(report["source"]["sha256"], hashlib.sha256(self.raw).hexdigest())
        self.assertEqual(self.glb.read_bytes(), self.raw)
        imported = Path(report["importSource"]["path"])
        self.assertEqual(imported, self.report_path().parent / "source/leg_hook_takedown.glb")
        self.assertEqual(report["importSource"]["sha256"], hashlib.sha256(imported.read_bytes()).hexdigest())
        selection = report["importSource"]["hairSelection"]
        self.assertEqual((selection["selectedHair"], len(selection["removedMeshAttachments"])), ("Spikes", 8))
        self.assertEqual(selection["sourceSha256"], report["source"]["sha256"])
        self.assertEqual(self.editor.imports, [(report["contentRoot"] + "/Clips/leg_hook_takedown", str(imported),
                                                {"is_automated": True, "replace_existing": False,
                                                 "import_level": "current level"})])
        self.assertEqual(self.editor.new_levels, [report["map"]])
        self.assertEqual(report["completedSteps"], [
            "read request", "check editor", "read source GLB", "claim run", "prepare import source",
            "create review game mode", "create review map", "Interchange scene import",
            "bind athlete animations", "shared level sequence", "review stage and camera", "save review map"])
        # One clock: 22 skeletal sections that play once and keep their final pose.
        shared = report["sharedSequence"]
        self.assertEqual((shared["skeletalBindingCount"], shared["framesAtSourceRate"]), (22, 12))
        self.assertAlmostEqual(shared["durationSeconds"], .4)
        self.assertAlmostEqual(shared["playbackEndSeconds"], .4 + 1. / 24000.)
        sections = [track.sections[0] for binding in self.editor.sequence.possessables for track in binding.tracks]
        self.assertEqual(len(sections), 22)
        self.assertTrue(all(s.completion == "KEEP_STATE" and s.range == (0., .4) for s in sections))
        playback_actor = next(a for a in self.editor.actors_in_level if isinstance(a, LevelSequenceActor))
        playback = playback_actor.properties["playback_settings"].properties
        self.assertEqual((playback["loop_count"], playback["pause_at_end"], playback["auto_play"]),
                         (("loop count", 0), True, True))
        self.assertEqual([a["framesAtSourceRate"] for a in report["animations"]], [12, 12])
        self.assertEqual(sorted(report["bodyComponents"]), ["Attacker", "Defender"])
        components = [c for a in self.editor.actors_in_level for c in a.components
                      if isinstance(c, SkeletalMeshComponent)]
        self.assertTrue(all(c.override[1]["is_playing"] is False and c.properties["disable_cloth_simulation"]
                            for c in components))
        # The pilot's no-pawn game mode, floor, three lights and the side CineCamera.
        self.assertEqual(self.editor.world_settings.properties["default_game_mode"].path,
                         report["reviewGameMode"]["class"])
        camera = next(a for a in self.editor.actors_in_level if isinstance(a, CineCameraActor))
        self.assertEqual(camera.properties["auto_activate_for_player"], "PLAYER0")
        lens = camera.camera_component.properties
        self.assertEqual((lens["current_focal_length"], lens["focus_settings"].properties["focus_method"]),
                         (35., "DISABLE"))
        self.assertEqual(lens["post_process_settings"].properties["auto_exposure_bias"], -7.)
        self.assertEqual(report["stage"]["camera"]["lensSettingsNotApplied"], {})
        self.assertEqual(len([a for a in self.editor.actors_in_level if isinstance(a, RectLight)]), 3)
        self.assertEqual(report["retarget"], {"requested": False})
        pointer, latest = self.latest()
        self.assertEqual((Path(pointer["report"]), pointer["status"]), (self.report_path(), report["status"]))
        self.assertEqual(latest, report)

    def test_existing_content_folder_is_never_overwritten(self):
        content = "/Game/VideoMotion/leg_hook_takedown/Run_" + STAMP
        self.editor.existing.add(content)
        with self.assertRaises(RuntimeError):
            self.run_script()
        report = json.loads(self.report_path().read_text())
        self.assertEqual((report["status"], report["failedStep"]), ("failed", "claim run"))
        self.assertIn("Refusing to overwrite an earlier import: " + content, report["error"])
        self.assertEqual((self.editor.imports, self.editor.new_levels), ([], []))
        self.assertFalse((self.report_path().parent / "source").exists())

    def test_existing_run_directory_and_its_report_are_left_untouched(self):
        earlier = self.report_path()
        earlier.parent.mkdir(parents=True)
        earlier.write_text('{"status": "earlier run"}\n')
        with self.assertRaises(RuntimeError):
            self.run_script()
        self.assertEqual(earlier.read_text(), '{"status": "earlier run"}\n')
        self.assertEqual(sorted(p.name for p in earlier.parent.iterdir()), ["import-report.json"])
        pointer, report = self.latest()
        self.assertEqual(Path(pointer["report"]).parents[1], self.project / "Saved/VideoMotion/_rejected")
        self.assertEqual((report["status"], report["failedStep"]), ("failed", "claim run"))
        self.assertIn("Refusing to overwrite an earlier run", report["error"])
        self.assertEqual(self.editor.imports, [])

    def test_failure_report_names_the_step_and_keeps_the_traceback(self):
        self.editor.import_result = False
        with self.assertRaises(RuntimeError):
            self.run_script()
        report = json.loads(self.report_path().read_text())
        self.assertEqual((report["status"], report["failedStep"]), ("failed", "Interchange scene import"))
        self.assertEqual(report["error"], "Interchange scene import failed")
        self.assertIn("Traceback (most recent call last)", report["traceback"])
        self.assertIn("import_glb", report["traceback"])
        self.assertIn("create review map", report["completedSteps"])
        self.assertFalse(report["importCompleted"])
        self.assertIs(report["renderValidated"], False)
        self.assertEqual(report["source"]["sha256"], hashlib.sha256(self.raw).hexdigest())

    def test_request_failures_are_reported_before_any_editor_work(self):
        with self.assertRaises(self.module.UsageError):
            self.run_script([], {})
        pointer, report = self.latest()
        self.assertEqual((report["status"], report["failedStep"], report["errorType"]),
                         ("failed", "read request", "UsageError"))
        self.assertIn("JQ_VIDEO_MOTION_GLB", report["error"])
        self.assertTrue(Path(pointer["report"]).is_relative_to(self.project / "Saved/VideoMotion/_rejected"))
        self.assertEqual((self.editor.imports, self.editor.new_levels), ([], []))

    def test_wrong_engine_and_wrong_duration_fail_at_their_steps(self):
        self.use(FakeEditor(self.project, version="5.7.2-0+++UE5+Release-5.7"))
        with self.assertRaises(RuntimeError):
            self.run_script()
        self.assertEqual(self.latest()[1]["failedStep"], "check editor")
        self.use(FakeEditor(self.project, duration=.4 + 2. / 30.))
        with self.assertRaises(RuntimeError):
            self.run_script()
        report = json.loads(self.report_path().read_text())
        self.assertEqual(report["failedStep"], "bind athlete animations")
        self.assertIn("differs from the GLB's last key", report["error"])

    def test_environment_request_reaches_the_report(self):
        self.run_script([], {"JQ_VIDEO_MOTION_GLB": str(self.glb), "JQ_VIDEO_MOTION_CLIP": "env_take"})
        report = json.loads(self.report_path("env_take").read_text())
        self.assertEqual((report["request"]["source"], report["clip"]), ("environment", "env_take"))
        self.assertEqual(report["request"]["argv"], [])


class RetargetTests(ScriptTestCase):
    TARGET = "/Game/MetaHumans/Test/Body/m_med_nrw_body"

    def retarget_argv(self):
        return [str(self.glb), "--retarget-target", self.TARGET]

    def test_missing_ik_apis_stop_with_their_names_and_the_manual_steps(self):
        with self.assertRaises(self.module.RetargetError):
            self.run_script(self.retarget_argv())
        report = json.loads(self.report_path().read_text())
        self.assertEqual((report["status"], report["failedStep"]), ("failed", "retarget"))
        self.assertTrue(report["importCompleted"])
        self.assertIn("save review map", report["completedSteps"])
        retarget = report["retarget"]
        self.assertEqual((retarget["status"], retarget["untested"]), ("unavailable", True))
        self.assertIn("unreal.IKRigController.get_controller", retarget["missingApis"])
        self.assertIn("unreal.IKRetargetBatchOperation.run_batch_retarget", report["error"])
        self.assertIn("Retarget Animations", report["error"])
        self.assertIn("The import itself completed and was saved", report["error"])

    def test_stubbed_retarget_maps_both_athletes_and_records_outputs(self):
        self.use(FakeEditor(self.project, retarget=self.TARGET))
        report = self.run_script(self.retarget_argv())
        self.assertEqual(report["status"], "editor_import_completed_visual_validation_pending")
        self.assertIs(report["retargetValidated"], False)
        retarget = report["retarget"]
        self.assertEqual((retarget["status"], retarget["batchApi"], retarget["untested"]),
                         ("completed", "run_batch_retarget", True))
        self.assertTrue(retarget["targetIkRig"]["generated"])
        for role in ("Attacker", "Defender"):
            row = retarget["roles"][role]
            suffix = SUFFIX if role == "Defender" else ""
            self.assertEqual(row["retargetRoot"], "pelvis" + suffix)
            self.assertIn({"chain": "LeftArm", "start": "upperarm_l" + suffix, "end": "hand_l" + suffix}, row["chains"])
            self.assertEqual(len(row["chains"]), 19)
            self.assertEqual(row["optionalSteps"]["add_default_ops"], "applied")
            self.assertEqual(row["optionalSteps"]["auto_align_all_bones(target)"], "not available in this Editor")
            self.assertEqual([o["framesAtSourceRate"] for o in row["outputs"]], [12])
            self.assertTrue(row["outputs"][0]["asset"].startswith(report["contentRoot"] + "/Retarget/Animations/"))
        inputs = self.editor.retarget_inputs[0]
        self.assertEqual((inputs["use_source_path"], inputs["overwrite_existing_files"], inputs["suffix"]),
                         (False, False, "_RT_m_med_nrw_body"))

    def test_older_batch_call_is_used_when_the_58_one_is_absent(self):
        self.use(FakeEditor(self.project, retarget=self.TARGET, batch=("duplicate_and_retarget",)))
        report = self.run_script(self.retarget_argv())
        self.assertEqual(report["retarget"]["batchApi"], "duplicate_and_retarget")
        self.assertEqual(self.editor.retarget_inputs[0]["positional"], ("", "", "", "_RT_m_med_nrw_body", False))

    def test_one_failed_athlete_fails_the_run_but_keeps_the_other(self):
        self.use(FakeEditor(self.project, retarget=self.TARGET))
        self.editor.refuse_chain_for = SUFFIX  # the Defender's bones
        with self.assertRaises(self.module.RetargetError) as caught:
            self.run_script(self.retarget_argv())
        self.assertIn("Retarget Animations", str(caught.exception))
        report = json.loads(self.report_path().read_text())
        roles = report["retarget"]["roles"]
        self.assertEqual((roles["Attacker"]["status"], roles["Defender"]["status"]), ("completed", "failed"))
        self.assertEqual((report["status"], report["failedStep"], report["retarget"]["status"]),
                         ("failed", "retarget", "failed"))

    def test_target_that_is_not_a_skeletal_mesh_is_refused(self):
        self.use(FakeEditor(self.project, retarget=self.TARGET))
        self.editor.assets[self.TARGET] = Obj(self.TARGET)
        with self.assertRaises(RuntimeError):
            self.run_script(self.retarget_argv())
        self.assertIn("is not a SkeletalMesh", self.latest()[1]["error"])


if __name__ == "__main__":
    unittest.main()
