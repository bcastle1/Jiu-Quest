"""Offline lifecycle regressions; these do not simulate or prove rendering."""
import importlib.util
import copy
import json
from pathlib import Path
import struct
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


class CaptureLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.unregistered = []
        self.keep_alive = []
        self.unreal = types.SimpleNamespace(log=lambda message: None,
            unregister_slate_post_tick_callback=self.unregistered.append,
            AutomationLibrary=types.SimpleNamespace())
        script = Path(__file__).resolve().parents[1] / "Content/Python/capture_pilot.py"
        spec = importlib.util.spec_from_file_location("capture_lifecycle_under_test", script)
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"unreal": self.unreal}):
            spec.loader.exec_module(self.module)
        self.module.REVIEW = Path(self.directory.name)
        self.session = self.module.Capture()
        self.session.handle = "registered delegate"
        self.session.keep_alive = self.keep_alive.append
        self.session.jobs = [({"name": "clip", "map": "/Game/Pilot/clip",
                              "camera": "/Game/Pilot/clip.camera"}, "mid", .5)]
        self.session.camera = types.SimpleNamespace(get_path_name=lambda: "test camera")
        self.session.game_world = types.SimpleNamespace(get_path_name=lambda: "test world")
        self.session.level = types.SimpleNamespace(is_in_play_in_editor=lambda: False)
        self.session.restore_camera = lambda: None
        self.session.camera_state = lambda: {"testCamera": True}
        self.position = 0.
        self.evaluated_position = 0.
        self.seeks = []
        self.session.bone_state = lambda: {"testEvaluatedPosition": self.evaluated_position}
        def seek(params):
            seconds = params.frame.frame_number.value / 30.
            self.seeks.append(seconds)
            self.position = self.evaluated_position = seconds
        self.unreal.MovieSceneSequencePlaybackParams = lambda **fields: types.SimpleNamespace(**fields)
        self.unreal.FrameTime = lambda **fields: types.SimpleNamespace(**fields)
        self.unreal.FrameNumber = lambda **fields: types.SimpleNamespace(**fields)
        self.unreal.MovieScenePositionType = types.SimpleNamespace(FRAME="frame")
        self.unreal.UpdatePositionMethod = types.SimpleNamespace(JUMP="jump")
        self.unreal.TimeManagementLibrary = types.SimpleNamespace(
            conv_qualified_frame_time_to_seconds=lambda value: value)
        self.session.sequence_player = types.SimpleNamespace(pause=lambda: None,
            set_playback_position=seek, get_current_time=lambda: self.position,
            get_frame_rate=lambda: types.SimpleNamespace(numerator=30, denominator=1))
        # No per-component seek API: all parts must share the same sequence.
        component = types.SimpleNamespace(set_update_animation_in_editor=lambda value: None)
        self.session.bindings = [(component, object(), 2.)]
        self.loads = 0
        def load_clip(clip):
            self.loads += 1
            # Native loading/streaming really pumps Slate; this was the crash.
            if self.loads > 1:
                raise AssertionError("Recursive map load")
            self.session.tick(0.)
            self.session.duration = 2.
            self.session.loaded_clip = clip["name"]
        self.session.begin_clip = load_clip

    def advance_to_screenshot(self):
        self.session.tick(0.)
        self.assertEqual(self.loads, 1)
        self.session.tick(0.)
        self.assertEqual(self.session.phase, "settle")
        self.session.frames = 30
        self.session.settled_at -= 3.
        self.session.tick(0.)

    def test_nested_native_ticks_queue_one_image_and_cleanup_once(self):
        requests = []
        task = types.SimpleNamespace(is_valid_task=lambda: True, is_task_done=lambda: True)
        def screenshot(width, height, filename, **kwargs):
            requests.append(filename)
            if len(requests) > 1:
                raise AssertionError("Recursive screenshot request")
            self.session.tick(0.)
            # Only the capture reader's required header/footer, not a render.
            Path(filename).write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 8
                + struct.pack(">II", width, height) + b"\0" * 9
                + b"\x00\x00\x00\x00IEND\xaeB\x60\x82")
            return task
        self.unreal.AutomationLibrary.take_high_res_screenshot = screenshot
        self.advance_to_screenshot()
        self.assertEqual(len(requests), 1)
        self.session.tick(0.)
        self.session.tick(0.)  # Late callback cannot queue or clean up again.
        self.assertEqual(self.session.report["status"], "captured_unreviewed")
        self.assertEqual(len(self.session.report["captures"]), 1)
        self.assertEqual(self.seeks, [1.])
        self.assertEqual(self.session.report["captures"][0]["sharedSequenceTimeSeconds"], 1.)
        self.assertEqual(self.session.report["captures"][0]["evaluatedBoneTransforms"],
                         {"testEvaluatedPosition": 1.})
        self.assertEqual(self.unregistered, ["registered delegate"])
        self.assertEqual(self.keep_alive, [False])
        self.assertFalse(self.session.in_tick)

    def test_rejected_task_records_failure_and_releases_delegate(self):
        console = {"warmup": 64}
        def execute(_world, command):
            console["warmup"] = int(command.rsplit(" ", 1)[1])
        self.unreal.SystemLibrary = types.SimpleNamespace(execute_console_command=execute,
            get_console_variable_int_value=lambda name: console["warmup"])
        self.session.editor = types.SimpleNamespace(get_editor_world=lambda: object())
        self.session.previous_warmup = 4
        self.session.report["screenshotWarmup"] = {"frames": 64, "previous": 4, "restored": False}
        self.unreal.AutomationLibrary.take_high_res_screenshot = lambda *a, **k: None
        self.advance_to_screenshot()
        self.session.tick(0.)
        report = json.loads((self.session.output / "capture-report.json").read_text())
        self.assertEqual(report["status"], "failed")
        self.assertIn("rejected screenshot task", report["error"])
        self.assertEqual(report["captures"], [])
        self.assertEqual(self.unregistered, ["registered delegate"])
        self.assertEqual(self.keep_alive, [False])
        self.assertFalse(self.session.in_tick)
        self.assertEqual(console["warmup"], 4)
        self.assertTrue(report["screenshotWarmup"]["restored"])

    def test_float_boundary_seeks_authored_frame_not_previous_frame(self):
        self.session.seek_sequence(.8999999761581421)
        self.assertEqual(self.session.report["lastSeek"]["requestedDisplayFrame"], 27)
        self.assertEqual(self.position, .9)
        self.assertLess(abs(self.position - .8999999761581421), 1e-4)

    def test_simulation_stops_before_delegate_and_keepalive_are_released(self):
        state = {"playing": True, "endRequests": 0}
        self.session.level.is_in_play_in_editor = lambda: state["playing"]
        def end_play():
            state["endRequests"] += 1
        self.unreal.EditorLevelLibrary = types.SimpleNamespace(editor_end_play=end_play)
        self.session.finish(RuntimeError("capture rejected"))
        self.session.tick(0.)
        self.assertEqual(state["endRequests"], 1)
        self.assertEqual(self.keep_alive, [])
        self.assertEqual(self.unregistered, [])
        state["playing"] = False
        self.session.tick(0.)
        self.assertEqual(self.keep_alive, [False])
        self.assertEqual(self.unregistered, ["registered delegate"])
        self.assertEqual(self.session.report["status"], "failed")

    def recipe_clip(self):
        directory = Path(self.module.__file__).parent
        names = ('import_pilot.py', 'pilot_source.py', 'ready_hands.py',
                 'pilot_look.py', 'pilot_hair.py', 'pilot_hair_shape.py')
        return {'characterRefinement': {'recipeFiles': {
            name:self.module.sha256((directory/name).read_bytes()) for name in names}}}

    def test_recipe_guard_accepts_current_six_files(self):
        self.module.validate_character_recipes(self.recipe_clip())

    def test_recipe_guard_rejects_legacy_partial_malformed_and_stale_reports(self):
        valid = self.recipe_clip()
        partial = copy.deepcopy(valid); partial['characterRefinement']['recipeFiles'].pop('pilot_hair_shape.py')
        extra = copy.deepcopy(valid); extra['characterRefinement']['recipeFiles']['unexpected.py'] = '0'*64
        invalid = copy.deepcopy(valid); invalid['characterRefinement']['recipeFiles']['pilot_hair.py'] = 42
        malformed = copy.deepcopy(valid); malformed['characterRefinement']['recipeFiles']['pilot_hair.py'] = 'not-a-sha256'
        stale = copy.deepcopy(valid); stale['characterRefinement']['recipeFiles']['pilot_hair.py'] = '0'*64
        for clip in ({}, {'characterRefinement':{}}, {'characterRefinement':{'recipeFiles':{}}},
                     partial, extra, invalid, malformed, stale):
            with self.subTest(clip=clip), self.assertRaises(RuntimeError):
                self.module.validate_character_recipes(clip)


if __name__ == "__main__":
    unittest.main()
