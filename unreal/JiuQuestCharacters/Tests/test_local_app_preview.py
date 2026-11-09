"""Lifecycle and athlete identity without starting Unreal or saving assets."""
import ast
import copy
import gc
import hashlib
import json
import math
from pathlib import Path
import tempfile
import traceback
import types
import unittest
from unittest.mock import Mock


SCRIPT = Path(__file__).resolve().parents[1] / 'Content/Python/local_app_preview.py'


class LocalPreviewTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.clock = Mock(return_value=100.)
        self.unreal = types.SimpleNamespace(
            log_error=Mock(), unregister_slate_post_tick_callback=Mock(),
            EditorLevelLibrary=types.SimpleNamespace(editor_end_play=Mock()),
            PixelStreaming2Blueprints=types.SimpleNamespace(get_connected_players=Mock(return_value=[])))
        tree = ast.parse(SCRIPT.read_text())
        definitions = [node for node in tree.body if isinstance(node, ast.ClassDef)]
        def check(value, message):
            if not value: raise RuntimeError(message)
        self.namespace = dict(Path=Path, gc=gc, hashlib=hashlib, json=json, math=math,
            traceback=traceback, time=types.SimpleNamespace(monotonic=self.clock),
            unreal=self.unreal, check=check, STARTUP_TIMEOUT_SECONDS=90., END_TIMEOUT_SECONDS=10.,
            PROJECT=Path(self.directory.name))
        exec(compile(ast.Module(body=definitions, type_ignores=[]), str(SCRIPT), 'exec'), self.namespace)

    def preview(self):
        value = self.namespace['LocalPreview'].__new__(self.namespace['LocalPreview'])
        value.__dict__.update(output=Path(self.directory.name), phase='prepare', busy=False,
            finished=False, report={'commands': []}, started=100., end_started=None,
            level=None, editor=None, actors=None, world=None, camera=None, controller=None,
            streamer=None, capture_actor=None, capture_component=None,
            render_target=None, video_producer=None, last_capture=0.,
            input=None, input_bound=False, source_files=None, handle=7, keep=Mock(),
            players={}, material_copies={}, material_proof=[], pending=[], current=None,
            scene=None, active=None, completed=False, endpoint_requested=False, had_viewer=False, last_peer_poll=0.,
            stripe_counts={'Attacker': 0, 'Defender': 0})
        value.save = Mock()
        return value

    def test_early_prepare_error_cleans_up_without_overwriting_cause(self):
        value = self.preview()
        value.prepare = Mock(side_effect=RuntimeError('fixture import failure'))
        keep = value.keep
        value.tick(0.)
        self.assertEqual(value.phase, 'end')
        self.assertIn('fixture import failure', value.report['error'])
        value.tick(0.)
        self.assertTrue(value.finished)
        self.assertIn('fixture import failure', value.report['error'])
        self.assertNotIn('AttributeError', value.report['error'])
        self.assertIsNone(value.report['sourceAssetsUnchanged'])
        self.assertTrue(value.report['pythonReferencesReleasedBeforeExit'])
        self.unreal.unregister_slate_post_tick_callback.assert_called_once_with(7)
        keep.assert_called_once_with(False)
        for name in ('players', 'material_copies', 'material_proof', 'input', 'world', 'level'):
            self.assertIsNone(getattr(value, name))

    def test_stop_file_is_respected_in_every_startup_and_ready_phase(self):
        stop = Path(self.directory.name) / 'stop.txt'
        stop.touch()
        for phase in ('prepare', 'wait_game', 'ready'):
            with self.subTest(phase=phase):
                value = self.preview(); value.phase = phase
                value.prepare = Mock()
                value.tick(0.); value.tick(0.)
                self.assertTrue(value.finished)
                self.assertEqual(value.report['status'], 'stopped')
                value.prepare.assert_not_called()

    def test_streamer_stops_before_render_wrappers_are_released(self):
        value = self.preview()
        streamer = types.SimpleNamespace(stop_streaming=Mock())
        value.streamer = streamer
        value.render_target = object(); value.video_producer = object()
        keep = value.keep
        value.begin_end('stopped')
        streamer.stop_streaming.assert_called_once()
        keep.assert_not_called()
        value.tick(0.)
        self.assertIsNone(value.streamer)
        self.assertIsNone(value.render_target)
        self.assertIsNone(value.video_producer)
        keep.assert_called_once_with(False)

    def test_startup_and_end_waits_are_finite(self):
        value = self.preview(); value.phase = 'wait_game'
        value.editor = types.SimpleNamespace(get_game_world=Mock(return_value=None))
        editor = value.editor
        self.clock.return_value = 191.
        value.tick(0.); value.tick(0.)
        self.assertTrue(value.finished)
        self.assertIn('startup exceeded90 seconds', value.report['error'])
        editor.get_game_world.assert_not_called()
        value = self.preview(); value.phase = 'end'; value.end_started = 100.
        value.level = types.SimpleNamespace(is_in_play_in_editor=lambda: True)
        value.tick(0.)
        self.assertTrue(value.finished)
        self.assertIn('within10 seconds', value.report['cleanupError'])

    def test_last_viewer_departure_pauses_without_completion_or_auto_resume(self):
        value = self.preview(); value.phase = 'ready'
        player = types.SimpleNamespace(pause=Mock(), play=Mock())
        value.players = {'standing_stance': {'player': player}}
        value.scene = {'paused': False, 'progress': .1}
        value.current = {'requestId': 'session:1'}
        value.state = lambda: (.37, True)
        value.poll_viewers()
        player.pause.assert_not_called()
        self.clock.return_value = 101.
        self.unreal.PixelStreaming2Blueprints.get_connected_players.return_value = ['viewer']
        value.poll_viewers()
        self.clock.return_value = 102.
        self.unreal.PixelStreaming2Blueprints.get_connected_players.return_value = []
        value.poll_viewers()
        player.pause.assert_called_once()
        self.assertEqual(value.scene, {'paused': True, 'progress': .37})
        self.assertFalse(value.completed)
        self.assertIsNone(value.current)
        self.clock.return_value = 103.
        self.unreal.PixelStreaming2Blueprints.get_connected_players.return_value = ['new-viewer']
        value.poll_viewers()
        player.play.assert_not_called()

    def capture_lighting_fixture(self):
        class Properties:
            def __init__(self, **properties):self.properties=properties
            def get_editor_property(self, name):return copy.deepcopy(self.properties[name])
            def set_editor_property(self, name, value):self.properties[name]=copy.deepcopy(value)
            @property
            def show_flag_settings(self):return self.get_editor_property('show_flag_settings')
            @show_flag_settings.setter
            def show_flag_settings(self, value):self.set_editor_property('show_flag_settings',value)
        self.unreal.EngineShowFlagsSetting=Properties
        self.unreal.DynamicGlobalIlluminationMethod=types.SimpleNamespace(LUMEN='Lumen GI')
        self.unreal.ReflectionMethod=types.SimpleNamespace(LUMEN='Lumen reflection')
        original=dict(override_auto_exposure_method=True,auto_exposure_method='manual',
            override_auto_exposure_apply_physical_camera_exposure=True,
            auto_exposure_apply_physical_camera_exposure=False,
            override_auto_exposure_bias=True,auto_exposure_bias=-7.,
            override_bloom_intensity=True,bloom_intensity=0.,
            override_dynamic_global_illumination_method=False,dynamic_global_illumination_method='none',
            override_reflection_method=False,reflection_method='none',
            unrelated_color_grading=[.93,1.02,1.07])
        value=self.preview()
        value.camera=types.SimpleNamespace(camera_component=Properties(post_process_settings=Properties(**original)))
        value.capture_component=Properties(always_persist_rendering_state=True,show_flag_settings=[
            Properties(show_flag_name='MotionBlur',enabled=False),
            Properties(show_flag_name='TemporalAA',enabled=False),
            Properties(show_flag_name='Atmosphere',enabled=False)])
        value.render_target=Properties(target_gamma=0.)
        return value,original

    def test_capture_lumen_and_sdr_gamma_preserve_accepted_camera_settings(self):
        value,original=self.capture_lighting_fixture()
        value.configure_capture_lighting()
        unchanged=value.camera.camera_component.get_editor_property('post_process_settings').properties
        self.assertEqual(unchanged,original)
        actual=value.capture_component.get_editor_property('post_process_settings').properties
        expected={**original,'override_dynamic_global_illumination_method':True,
            'dynamic_global_illumination_method':'Lumen GI','override_reflection_method':True,
            'reflection_method':'Lumen reflection'}
        self.assertEqual(actual,expected)
        self.assertEqual(value.render_target.get_editor_property('target_gamma'),2.2)
        self.assertEqual(value.capture_component.get_editor_property('post_process_blend_weight'),1.)
        self.assertTrue(value.report['captureLighting']['acceptedExposureAndBloomPreserved'])
        self.assertTrue(value.report['captureLighting']['persistentRenderingState'])

    def test_capture_configuration_requires_actual_readback_and_persistent_state(self):
        value,_=self.capture_lighting_fixture()
        value.render_target.set_editor_property=lambda name,value:None
        with self.assertRaisesRegex(RuntimeError,'display gamma readback'):
            value.configure_capture_lighting()
        self.assertNotIn('captureLighting',value.report)
        value,_=self.capture_lighting_fixture()
        value.capture_component.set_editor_property('always_persist_rendering_state',False)
        with self.assertRaisesRegex(RuntimeError,'persistent Lumen state'):
            value.configure_capture_lighting()

    def test_capture_temporal_flag_preserves_other_flags_and_requires_readback(self):
        value,_=self.capture_lighting_fixture()
        value.configure_capture_lighting()
        flags=value.report['captureLighting']['showFlags']
        self.assertEqual(flags,[{'name':'MotionBlur','enabled':False},
            {'name':'TemporalAA','enabled':True},{'name':'Atmosphere','enabled':False}])
        value,_=self.capture_lighting_fixture()
        value.capture_component.set_editor_property('show_flag_settings',[])
        value.configure_capture_lighting()
        self.assertEqual(value.report['captureLighting']['showFlags'],[{'name':'TemporalAA','enabled':True}])
        value,_=self.capture_lighting_fixture()
        setter=value.capture_component.set_editor_property
        value.capture_component.set_editor_property=lambda name,data:None if name=='show_flag_settings' else setter(name,data)
        with self.assertRaisesRegex(RuntimeError,'show-flag readback'):
            value.configure_capture_lighting()

    def ready_completion_fixture(self, progress, paused=False):
        value=self.preview();value.phase='ready';value.active='standing_stance'
        value.last_capture=100.;value.last_state=0.
        player=types.SimpleNamespace(pause=Mock(),
            get_frame_rate=lambda:types.SimpleNamespace(numerator=30,denominator=1))
        value.players={'standing_stance':{'player':player,'duration':1.8}}
        value.scene=dict(paused=paused,camera='side',compactViewport=False,progress=progress)
        value.current=dict(type='play',requestId='session:final')
        value.state=lambda:(progress,False)
        value.seek=Mock();value.send=Mock()
        return value,player

    def test_stopped_final_authored_sample_completes_once_at_100_percent(self):
        value,_=self.ready_completion_fixture(53/54)
        value.tick(0.);value.tick(0.)
        self.assertNotIn('error',value.report)
        value.seek.assert_called_once_with(1.)
        completed=[call for call in value.send.call_args_list if call.args[0]=='completed']
        self.assertEqual(len(completed),1)
        self.assertEqual(completed[0].kwargs,dict(moveId='standing_stance',progress=1.,playing=False))
        self.assertTrue(value.completed)
        self.assertEqual(value.report['lastCompleted']['progress'],1.)

    def test_early_stop_paused_final_frame_and_disconnect_do_not_complete(self):
        for progress,paused in ((.5,False),(53/54,True)):
            with self.subTest(progress=progress,paused=paused):
                value,_=self.ready_completion_fixture(progress,paused)
                value.tick(0.)
                self.assertNotIn('error',value.report)
                self.assertFalse(value.completed)
                value.seek.assert_not_called()
                self.assertFalse(any(call.args[0]=='completed' for call in value.send.call_args_list))
        value,player=self.ready_completion_fixture(53/54)
        value.had_viewer=True
        value.tick(0.)
        player.pause.assert_called_once()
        self.assertFalse(value.completed)
        self.assertIsNone(value.current)
        self.assertEqual(value.scene['progress'],53/54)
        value.seek.assert_not_called();value.send.assert_not_called()

    def clamped_player_fixture(self, progress=53/54):
        value,_=self.ready_completion_fixture(progress)
        del value.state;del value.seek
        self.unreal.TimeManagementLibrary=types.SimpleNamespace(
            conv_qualified_frame_time_to_seconds=lambda seconds:seconds)
        for name in ('MovieSceneSequencePlaybackParams','FrameTime','FrameNumber'):
            setattr(self.unreal,name,types.SimpleNamespace)
        self.unreal.MovieScenePositionType=types.SimpleNamespace(FRAME='frame')
        self.unreal.UpdatePositionMethod=types.SimpleNamespace(JUMP='jump')
        position=[progress*1.8];playing=[False]
        def set_position(params):
            requested=(params.frame.frame_number.value+params.frame.sub_frame)/30.
            position[0]=min(53/30.,requested)
        player=types.SimpleNamespace(
            pause=Mock(side_effect=lambda:playing.__setitem__(0,False)),
            play=Mock(side_effect=lambda:playing.__setitem__(0,True)),set_play_rate=Mock(),
            get_current_time=lambda:position[0],is_playing=lambda:playing[0],
            get_frame_rate=lambda:types.SimpleNamespace(numerator=30,denominator=1),
            set_playback_position=Mock(side_effect=set_position))
        value.players['standing_stance']['player']=player
        value.players['standing_stance']['components']=[]
        value.gate=types.SimpleNamespace(accept=lambda command:True)
        value.set_camera=Mock()
        return value,player,position,playing

    def test_actual_state_distinguishes_clamped_endpoint_from_user_pause(self):
        value,_,position,playing=self.clamped_player_fixture()
        self.assertAlmostEqual(value.state()[0],53/54)
        value.scene['paused']=True
        self.assertAlmostEqual(value.state()[0],53/54)
        value.seek(1.)
        self.assertAlmostEqual(position[0],53/30.)
        self.assertFalse(value.completed)
        self.assertEqual(value.state(),(1.,False))
        position[0]=.9
        self.assertEqual(value.state(),(.5,False))
        position[0]=53/30.;playing[0]=True
        self.assertAlmostEqual(value.state()[0],53/54)

    def test_periodic_state_and_nonposition_controls_keep_completed_endpoint(self):
        value,_,_,_=self.clamped_player_fixture()
        value.tick(0.);value.tick(0.)
        self.assertNotIn('error',value.report)
        self.assertTrue(value.completed);self.assertTrue(value.endpoint_requested)
        self.assertEqual(value.state(),(1.,False))
        states=[call for call in value.send.call_args_list if call.args[0]=='state']
        self.assertTrue(states)
        self.assertTrue(all(call.kwargs['progress']==1. for call in states))
        for number,kind in enumerate(('setCamera','setSpeed','requestState','setViewport'),1):
            # Stale UI progress must not replace the actual endpoint marker.
            command=dict(type=kind,moveId='standing_stance',requestId='control:'+str(number),
                performerSide='fighter',progress=53/54,paused=False,speed=.5,
                camera='side',compactViewport=False)
            value.command(command);value.last_state=0.;value.tick(0.)
            self.assertNotIn('error',value.report)
            self.assertTrue(value.completed)
            self.assertEqual(value.state(),(1.,False))
        completed=[call for call in value.send.call_args_list if call.args[0]=='completed']
        states=[call for call in value.send.call_args_list if call.args[0]=='state']
        self.assertEqual(len(completed),1)
        self.assertTrue(all(call.kwargs['progress']==1. for call in states))

    def test_seek_and_reset_clear_endpoint_and_report_actual_position(self):
        for kind,progress in (('seek',.5),('seek',53/54),('reset',0.),('play',0.)):
            with self.subTest(kind=kind):
                value,_,_,_=self.clamped_player_fixture()
                value.tick(0.)
                value.command(dict(type=kind,moveId='standing_stance',requestId='control:1',
                    performerSide='fighter',fighter={'stripes':0},opponent={'stripes':0},
                    progress=progress,paused=True,speed=1.,
                    camera='side',compactViewport=False))
                self.assertFalse(value.endpoint_requested)
                self.assertFalse(value.completed)
                self.assertAlmostEqual(value.state()[0],progress)
                self.assertFalse(value.state()[1])
                self.assertLess(value.state()[0],1.)
                self.assertAlmostEqual(value.send.call_args.kwargs['progress'],progress)

    def test_capture_history_resets_on_discontinuities_not_continuous_orbit(self):
        value,_,_,_=self.clamped_player_fixture(.4)
        value.capture_component=types.SimpleNamespace(set_editor_property=Mock())
        cut=value.capture_component.set_editor_property
        value.seek(.3)
        cut.assert_called_once_with('camera_cut_this_frame',True)
        for kind in ('setCamera','setViewport','play'):
            cut.reset_mock()
            # This test isolates camera jumps; playback seek behavior is above.
            if kind=='play':value.activate=Mock()
            value.command(dict(type=kind,moveId='standing_stance',requestId='control:1',
                performerSide='fighter',fighter={'stripes':0},opponent={'stripes':0},
                progress=.3,paused=True,speed=1.,camera='orbit',compactViewport=False))
            self.assertTrue(cut.called)
            self.assertTrue(all(call.args==('camera_cut_this_frame',True) for call in cut.call_args_list))
        cut.reset_mock();value.orbit_angle=0.;value.last_state=0.
        value.tick(.02);value.tick(.02)
        self.assertNotIn('error',value.report)
        cut.assert_not_called()

    def test_performer_identity_controls_exact_stripe_mesh_visibility(self):
        value = self.preview(); components = {}
        for role in ('Attacker', 'Defender'):
            for suffix in ('Body', 'BeltStripe_1', 'BeltStripe_2', 'BeltStripe_3', 'BeltStripe_4'):
                owner = types.SimpleNamespace(set_actor_hidden_in_game=Mock())
                component = types.SimpleNamespace(set_visibility=Mock(), get_owner=lambda owner=owner: owner)
                row = {'role': role, 'mesh': '/Test/JQ_'+role+'_'+suffix+'.JQ_'+role+'_'+suffix}
                components[role, suffix] = (row, component)
        player = types.SimpleNamespace(pause=Mock(), play=Mock(), set_play_rate=Mock())
        value.players = {'standing_stance': {'player': player, 'components': list(components.values())}}
        value.gate = types.SimpleNamespace(accept=lambda command: True)
        value.seek = Mock(); value.set_camera = Mock(); value.state = lambda: (0., False)
        value.send = Mock()
        command = dict(type='play', moveId='standing_stance', performerSide='opponent',
            fighter={'stripes': 0}, opponent={'stripes': 3}, progress=0., paused=True,
            speed=1., camera='side', compactViewport=False, requestId='test:1')
        value.command(command)
        for role, count in (('Attacker', 3), ('Defender', 0)):
            components[role, 'Body'][1].set_visibility.assert_called_once_with(True, True)
            for stripe in range(1, 5):
                component = components[role, 'BeltStripe_'+str(stripe)][1]
                component.set_visibility.assert_called_once_with(stripe <= count, True)
                component.get_owner().set_actor_hidden_in_game.assert_called_once_with(stripe > count)


if __name__ == '__main__':
    unittest.main()
