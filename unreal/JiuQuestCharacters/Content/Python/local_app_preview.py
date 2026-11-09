"""Local UE5.8 Editor receiver. Uses real sequence players and Pixel Streaming.

This is an Editor review tool, not a packaged production game server. It never
saves the accepted source maps and never reads/writes application progress.
"""
from pathlib import Path
import datetime
import gc
import hashlib
import json
import math
import time
import traceback
import unreal
from capture_pilot import read_import_report, check
from local_receiver_contract import parse_command, response, SessionGate, MOVES
from local_preview_materials import appearance_field, parameter_copy, linear_color

PROJECT = Path(__file__).resolve().parents[2]
REVIEW = PROJECT / 'Saved/LocalAppPreview'
STARTUP_TIMEOUT_SECONDS = 90.
END_TIMEOUT_SECONDS = 10.


class LocalPreview:
    def __init__(self):
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d_%H%M%S_%f')
        self.output=REVIEW/stamp
        self.output.mkdir(parents=True,exist_ok=False)
        self.report={'status':'starting','mode':'local_editor_preview','commands':[],
                     'limits':['Editor-only receiver; not a packaged or hosted service',
                               'Three imported pilot clips only; draft choreography',
                               'Selected Spikes hairstyle only; no hair simulation']}
        self.phase='prepare';self.busy=False;self.input=None;self.current=None
        self.scene=None;self.active=None;self.players={};self.gate=SessionGate()
        self.pending=[];self.started=time.monotonic();self.last_state=0.
        self.completed=False;self.orbit_angle=0.;self.request_started=0.
        self.level=None;self.editor=None;self.actors=None;self.world=None
        self.camera=None;self.controller=None;self.source_files=None
        self.streamer=None;self.capture_actor=None;self.capture_component=None
        self.render_target=None;self.video_producer=None;self.last_capture=0.
        self.finished=False;self.end_started=None;self.input_bound=False
        self.had_viewer=False;self.last_peer_poll=0.
        self.stripe_counts={'Attacker':0,'Defender':0}
        self.material_folder='/Game/LocalAppPreview/Run_'+stamp+'/Materials'
        self.material_copies={};self.material_proof=[]
        self.keep=unreal.EditorPythonScripting.set_keep_python_script_alive
        self.keep(True)
        self.handle=unreal.register_slate_post_tick_callback(self.tick)

    def save(self):
        (self.output/'runtime-report.json').write_text(json.dumps(self.report,indent=2)+'\n')

    def receive(self, descriptor):
        command=parse_command(descriptor)
        # Delegate dispatch queues bounded descriptors for the next game tick.
        if command is not None and len(self.pending)<64:
            self.pending.append(command)

    def send(self, kind, **values):
        if self.current is not None and self.input is not None:
            self.input.send_pixel_streaming2_response(response(self.current,kind,**values))

    def begin_end(self, status=None):
        if status is not None:self.report['status']=status
        if self.end_started is None:self.end_started=time.monotonic()
        self.phase='end';self.pending=[]
        for entry in self.players.values():
            try:entry['player'].pause()
            except Exception as exc:self.report.setdefault('cleanupErrors',[]).append(str(exc))
        if self.input_bound:
            try:self.input.on_input_event.remove_callable(self.receive)
            except Exception as exc:self.report.setdefault('cleanupErrors',[]).append(str(exc))
            self.input_bound=False
        if self.streamer is not None:
            try:self.streamer.stop_streaming()
            except Exception as exc:self.report.setdefault('cleanupErrors',[]).append(str(exc))
        try:
            if self.level is not None and self.level.is_in_play_in_editor():
                unreal.EditorLevelLibrary.editor_end_play()
        except Exception as exc:self.report.setdefault('cleanupErrors',[]).append(str(exc))

    def finish(self):
        if self.finished:return
        self.finished=True
        try:
            if self.handle is not None:
                unreal.unregister_slate_post_tick_callback(self.handle);self.handle=None
            if self.source_files is not None:
                self.report['sourceAssetsUnchanged']=all(
                    hashlib.sha256((PROJECT/path).read_bytes()).hexdigest()==digest
                    for path,digest in self.source_files.items())
            else:
                self.report['sourceAssetsUnchanged']=None
                self.report['sourceSnapshotUnavailable']=True
        except Exception as exc:
            self.report.update(status='failed',cleanupError=str(exc))
        finally:
            # Release destroyed PIE wrappers while both interpreters are alive.
            # Full-Editor command-line Python exits after keep-alive is cleared.
            keep_alive=self.keep;self.keep=None
            try:
                for name in ('input','world','camera','controller','editor','actors','level',
                             'players','material_copies','material_proof','streamer','capture_actor',
                             'capture_component','render_target','video_producer'):
                    setattr(self,name,None)
                self.pending=[]
                gc.collect()
                self.report['pythonReferencesReleasedBeforeExit']=True
                self.save()
            finally:
                if callable(keep_alive):keep_alive(False)

    def poll_viewers(self):
        now=time.monotonic()
        if now-self.last_peer_poll<.15:return
        self.last_peer_poll=now
        # This local component uses the default streamer ID. Only an observed
        # >0 to0 transition pauses playback; initial connection timing does not.
        count=len(unreal.PixelStreaming2Blueprints.get_connected_players())
        self.report['connectedViewers']=count
        if count:self.had_viewer=True
        elif self.had_viewer:
            for entry in self.players.values():entry['player'].pause()
            if self.scene is not None:
                progress,_=self.state()
                self.scene={**self.scene,'paused':True,'progress':progress}
            self.had_viewer=False;self.pending=[];self.current=None
            self.report['disconnectPauses']=self.report.get('disconnectPauses',0)+1
            self.save()

    def prepare(self):
        check(Path(unreal.Paths.project_dir()).resolve()==PROJECT,'Wrong preview project')
        check(unreal.SystemLibrary.get_engine_version().startswith('5.8.'),'UE5.8 required')
        self.imported,source_hash=read_import_report()
        check(tuple(c['name'] for c in self.imported['clips'])==MOVES,'Pilot inventory changed')
        root=PROJECT/'Content'/self.imported['contentRoot'].removeprefix('/Game/')
        self.source_files={str(p.relative_to(PROJECT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
        self.report.update(importReportSha256=source_hash,contentRoot=self.imported['contentRoot'],sourceFileCount=len(self.source_files))
        self.level=unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
        self.editor=unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
        self.actors=unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        check(not self.level.is_in_play_in_editor(),'Use a fresh Editor')
        check(self.level.load_level(self.imported['clips'][0]['map']),'Standing map missing')
        world=self.editor.get_editor_world()
        for clip in self.imported['clips'][1:]:
            check(unreal.EditorLevelUtils.add_level_to_world(world,clip['map'],unreal.LevelStreamingAlwaysLoaded) is not None,'Could not load pilot level')
        for existing in self.actors.get_all_level_actors():
            if isinstance(existing,unreal.LevelSequenceActor):
                settings=existing.get_editor_property('playback_settings')
                settings.set_editor_property('auto_play',False)
                settings.set_editor_property('loop_count',unreal.MovieSceneSequenceLoopCount(0))
                settings.set_editor_property('pause_at_end',True)
                existing.set_editor_property('playback_settings',settings)
            for component in existing.get_components_by_class(unreal.SkeletalMeshComponent):
                for index in range(component.get_num_materials()):
                    material=component.get_material(index)
                    if material is None or appearance_field(material.get_name()) is None:continue
                    path=material.get_path_name()
                    if path not in self.material_copies:
                        self.material_copies[path]=parameter_copy(material,self.material_folder,'M_Appearance_'+str(len(self.material_copies)))
                    component.set_material(index,self.material_copies[path])
        actor=self.actors.spawn_actor_from_class(unreal.Actor,unreal.Vector())
        actor.set_actor_label('JiuQuest local app receiver')
        self.receiver_name=actor.get_name()
        sub=unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
        handles=sub.k2_gather_subobject_data_for_instance(actor)
        _,reason=sub.add_new_subobject(unreal.AddNewSubobjectParams(parent_handle=handles[0],new_class=unreal.PixelStreaming2Input))
        check(len(actor.get_components_by_class(unreal.PixelStreaming2Input))==1,str(reason))
        _,reason=sub.add_new_subobject(unreal.AddNewSubobjectParams(parent_handle=handles[0],new_class=unreal.PixelStreaming2StreamerComponent))
        check(len(actor.get_components_by_class(unreal.PixelStreaming2StreamerComponent))==1,str(reason))
        capture_actor=self.actors.spawn_actor_from_class(unreal.SceneCapture2D,unreal.Vector())
        self.capture_name=capture_actor.get_name()
        capture_actor.get_component_by_class(unreal.SceneCaptureComponent2D).set_editor_property('capture_every_frame',False)
        self.phase='wait_game';self.save()
        self.level.editor_request_begin_play()

    def bind(self):
        all_actors=unreal.GameplayStatics.get_all_actors_of_class(self.world,unreal.Actor)
        receivers=[a for a in all_actors if a.get_name()==self.receiver_name]
        check(len(receivers)==1,'Ambiguous receiver actor')
        self.input=receivers[0].get_component_by_class(unreal.PixelStreaming2Input)
        check(self.input is not None,'Receiver did not enter game world')
        self.input.on_input_event.add_callable(self.receive)
        self.input_bound=True
        self.report['clips']=[]
        for clip in self.imported['clips']:
            name=clip['name']
            actors=[a for a in all_actors if a.get_level().get_path_name().endswith('.'+name+':PersistentLevel')]
            by_name={a.get_name():a for a in actors}
            check(len(by_name)==len(actors),'Ambiguous clip actors')
            sequence=by_name[clip['sharedSequence']['actor'].rsplit('.',1)[-1]]
            check(sequence.get_sequence().get_path_name()==clip['sharedSequence']['asset'],'Shared sequence changed')
            player=sequence.get_editor_property('sequence_player')
            check(player is not None,'Missing live sequence player')
            player.pause()
            components=[]
            for row in clip['components']:
                actor=by_name[row['actor'].rsplit('.',1)[-1]]
                matches=[c for c in actor.get_components_by_class(unreal.SkeletalMeshComponent) if c.get_name()==row['component'].rsplit('.',1)[-1]]
                check(len(matches)==1,'Missing skeletal component')
                comp=matches[0];mesh=comp.get_editor_property('skeletal_mesh_asset')
                check(mesh.get_path_name()==row['mesh'],'Skeletal mesh changed')
                check(mesh.get_editor_property('skeleton').get_path_name()==row['skeleton'],'Skeleton changed')
                components.append((row,comp))
                for index,slot in enumerate(row['materials']):
                    field=appearance_field(slot)
                    if field is not None:
                        dynamic=comp.create_dynamic_material_instance(index,comp.get_material(index))
                        check(dynamic is not None,'Dynamic appearance material missing')
                        self.material_proof.append((name,row['role'],field,dynamic))
            actual={c.get_path_name() for a in actors for c in a.get_components_by_class(unreal.SkeletalMeshComponent)}
            check(actual=={c.get_path_name() for _,c in components},'Clip component inventory differs')
            camera=by_name[clip['camera'].rsplit('.',1)[-1]]
            # Only the standing stage supplies floor/lights; duplicate stages
            # would brighten the scene and create coincident floor surfaces.
            for actor in actors:
                if not isinstance(actor,(unreal.WorldSettings,unreal.LevelSequenceActor)):
                    if name!='standing_stance':actor.set_actor_hidden_in_game(True)
            self.players[name]={'player':player,'sequence':sequence,'actors':actors,'components':components,
                'camera':camera,'duration':clip['sharedSequence']['durationSeconds']}
            self.report['clips'].append({'moveId':name,'skeletalBindings':len(components),'sharedSequence':sequence.get_sequence().get_path_name()})
        self.controller=unreal.GameplayStatics.get_player_controller(self.world,0)
        check(self.controller is not None,'Game camera controller missing')
        self.camera=self.players['standing_stance']['camera']
        self.controller.set_view_target_with_blend(self.camera,0.)
        self.activate('standing_stance')
        self.set_camera('side',False)
        captures=[a for a in all_actors if a.get_name()==self.capture_name]
        check(len(captures)==1,'Missing scene capture actor')
        self.capture_actor=captures[0]
        self.capture_component=self.capture_actor.get_component_by_class(unreal.SceneCaptureComponent2D)
        self.render_target=unreal.RenderingLibrary.create_render_target2d(self.world,1280,720,unreal.TextureRenderTargetFormat.RTF_RGBA8)
        check(self.render_target is not None,'Could not allocate Unreal video render target')
        self.capture_component.set_editor_property('texture_target',self.render_target)
        self.capture_component.set_editor_property('capture_source',unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
        self.capture_component.set_editor_property('capture_every_frame',False)
        self.capture_component.set_editor_property('capture_on_movement',False)
        self.capture_component.set_editor_property('always_persist_rendering_state',True)
        self.configure_capture_lighting()
        self.streamer=receivers[0].get_component_by_class(unreal.PixelStreaming2StreamerComponent)
        self.video_producer=unreal.PixelStreaming2VideoProducerRenderTarget(outer=self.streamer)
        self.video_producer.set_editor_property('target',self.render_target)
        self.streamer.set_editor_property('video_producer',self.video_producer)
        self.streamer.set_editor_property('streamer_id',unreal.PixelStreaming2Blueprints.get_default_streamer_id())
        self.streamer.set_editor_property('signalling_server_url','ws://127.0.0.1:49088')
        self.streamer.set_editor_property('use_pixel_streaming_url',False)
        self.streamer.set_editor_property('stream_fps_override',30)
        self.streamer.start_streaming()
        self.report['videoProducer']='Unreal SceneCapture2D render target,1280x720,30fps'
        self.phase='ready';self.report['status']='receiver_ready';self.save()

    def configure_capture_lighting(self):
        # Scene captures explicitly default Lumen off. Override only the local
        # capture while retaining the accepted camera's manual exposure.
        source=self.camera.camera_component.get_editor_property('post_process_settings')
        preserved=('override_auto_exposure_method','auto_exposure_method',
                   'override_auto_exposure_apply_physical_camera_exposure',
                   'auto_exposure_apply_physical_camera_exposure',
                   'override_auto_exposure_bias','auto_exposure_bias',
                   'override_bloom_intensity','bloom_intensity')
        expected={name:source.get_editor_property(name) for name in preserved}
        source.set_editor_property('override_dynamic_global_illumination_method',True)
        source.set_editor_property('dynamic_global_illumination_method',unreal.DynamicGlobalIlluminationMethod.LUMEN)
        source.set_editor_property('override_reflection_method',True)
        source.set_editor_property('reflection_method',unreal.ReflectionMethod.LUMEN)
        self.capture_component.set_editor_property('post_process_settings',source)
        self.capture_component.set_editor_property('post_process_blend_weight',1.)
        # Pixel Streaming consumes the target RHI texture directly. Match the
        # normal SDR display gamma instead of the linear RGBA8 target default.
        self.render_target.set_editor_property('target_gamma',2.2)
        actual=self.capture_component.get_editor_property('post_process_settings')
        gi=actual.get_editor_property('dynamic_global_illumination_method')
        reflection=actual.get_editor_property('reflection_method')
        check(actual.get_editor_property('override_dynamic_global_illumination_method') and
              gi==unreal.DynamicGlobalIlluminationMethod.LUMEN,'Capture Lumen GI readback failed')
        check(actual.get_editor_property('override_reflection_method') and
              reflection==unreal.ReflectionMethod.LUMEN,'Capture Lumen reflection readback failed')
        exposure_preserved=all(actual.get_editor_property(name)==value for name,value in expected.items())
        check(exposure_preserved,'Capture changed accepted exposure or bloom')
        gamma=float(self.render_target.get_editor_property('target_gamma'))
        check(abs(gamma-2.2)<1e-5,'Capture display gamma readback failed')
        check(self.capture_component.get_editor_property('post_process_blend_weight')==1.,'Capture post-process blend differs')
        check(self.capture_component.get_editor_property('always_persist_rendering_state'),'Capture needs persistent Lumen state')
        self.report['captureLighting']={'dynamicGlobalIllumination':str(gi),
            'reflectionMethod':str(reflection),'targetGamma':gamma,
            'postProcessBlendWeight':1.,'persistentRenderingState':True,
            'acceptedExposureAndBloomPreserved':exposure_preserved}

    def activate(self, move):
        for name,entry in self.players.items():
            entry['player'].pause()
            for row,component in entry['components']:
                mesh_name=row['mesh'].rsplit('.',1)[-1]
                prefix='JQ_'+row['role']+'_BeltStripe_'
                visible=name==move
                if mesh_name.startswith(prefix):
                    number=mesh_name.removeprefix(prefix)
                    check(number in ('1','2','3','4'),'Unexpected belt stripe mesh')
                    visible=visible and int(number)<=self.stripe_counts[row['role']]
                component.set_visibility(visible,True)
                component.get_owner().set_actor_hidden_in_game(not visible)
        self.active=move
        self.seek(0.)

    def seek(self, fraction):
        entry=self.players[self.active];player=entry['player'];rate=player.get_frame_rate()
        display_frames=fraction*entry['duration']*rate.numerator/rate.denominator
        whole=math.floor(display_frames+1e-6)
        sub=max(0.,display_frames-whole)
        player.pause()
        player.set_playback_position(unreal.MovieSceneSequencePlaybackParams(
            frame=unreal.FrameTime(frame_number=unreal.FrameNumber(value=whole),sub_frame=sub),
            position_type=unreal.MovieScenePositionType.FRAME,update_method=unreal.UpdatePositionMethod.JUMP))

    def state(self):
        entry=self.players[self.active];player=entry['player']
        seconds=float(unreal.TimeManagementLibrary.conv_qualified_frame_time_to_seconds(player.get_current_time()))
        return min(1.,max(0.,seconds/entry['duration'])),bool(player.is_playing())

    def set_camera(self, mode, compact):
        # Exact stage-centered presets for both athletes; no mouse/console input.
        standing=self.active=='standing_stance'
        target=unreal.Vector(0.,0.,95. if standing else 55.)
        presets={'side':(-360.,-320.,185.),'front':(-490.,0.,170.),
                 'focus':(-300.,-260.,155.),'overhead':(-20.,0.,600.)}
        if mode=='orbit':
            x,y,z=480.*math.cos(self.orbit_angle),480.*math.sin(self.orbit_angle),190.
        else:x,y,z=presets[mode]
        if not standing and mode!='overhead':z-=55.
        if compact:x*=1.15;y*=1.15
        location=unreal.Vector(x,y,z)
        self.camera.set_actor_location(location,False,False)
        self.camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(location,target),False)
        self.camera.camera_component.set_editor_property('field_of_view',40.)

    def command(self, command):
        if not self.gate.accept(command):return
        kind=command['type']
        if kind=='configure':
            for entry in self.players.values():entry['player'].pause()
            self.current=command
            self.send('ready',capabilities={'moves':list(self.players)})
            return
        if kind!='play' and (self.scene is None or command['moveId']!=self.active):
            self.current=command;self.send('error',moveId=command['moveId'],message='Load the requested animation before controlling it.')
            return
        self.current=command;self.completed=False
        if kind=='play':
            self.stripe_counts={role:command[
                command['performerSide'] if role=='Attacker' else
                ('opponent' if command['performerSide']=='fighter' else 'fighter')]['stripes']
                for role in ('Attacker','Defender')}
            self.activate(command['moveId'])
            appearance=[]
            for clip,role,field,material in self.material_proof:
                if clip!=self.active:continue
                side=command['performerSide'] if role=='Attacker' else ('opponent' if command['performerSide']=='fighter' else 'fighter')
                color=linear_color(command[side][field],field)
                material.set_vector_parameter_value('JQAppearance',color)
                actual=material.get_vector_parameter_value('JQAppearance')
                check(all(abs(getattr(actual,k)-getattr(color,k))<1e-6 for k in ('r','g','b')),'Appearance parameter readback failed')
                appearance.append({'role':role,'side':side,'field':field,'color':command[side][field]})
            self.report['lastAppearance']=appearance
        self.scene=command
        player=self.players[self.active]['player']
        if kind in ('play','seek','reset'):self.seek(command['progress'])
        if kind in ('play','setSpeed'):player.set_play_rate(command['speed'])
        if kind in ('play','setCamera','setViewport'):self.set_camera(command['camera'],command['compactViewport'])
        if kind in ('play','pause','resume','seek','reset'):
            if command['paused']:player.pause()
            elif self.state()[0]<1.:player.play()
        progress,playing=self.state()
        self.send('state',moveId=self.active,progress=progress,playing=playing)
        self.report['commands'].append({'type':kind,'moveId':self.active,'requestId':command['requestId'],
            'performerSide':command['performerSide'],'progress':progress,'playing':playing})
        self.report['commands']=self.report['commands'][-256:]
        self.save()

    def tick(self, delta):
        if self.busy or self.finished:return
        self.busy=True
        try:
            if self.phase!='end' and (self.output/'stop.txt').exists():
                self.begin_end('stopped');return
            if self.phase in ('prepare','wait_game'):
                check(time.monotonic()-self.started<STARTUP_TIMEOUT_SECONDS,
                      'Local preview startup exceeded90 seconds')
            if self.phase=='prepare':self.prepare()
            elif self.phase=='wait_game':
                self.world=self.editor.get_game_world()
                if self.world is not None:self.bind()
            elif self.phase=='ready':
                pending,self.pending=self.pending,[]
                for command in pending:self.command(command)
                self.poll_viewers()
                if time.monotonic()-self.last_capture>=1./30.:
                    self.capture_actor.set_actor_location(self.camera.get_actor_location(),False,False)
                    self.capture_actor.set_actor_rotation(self.camera.get_actor_rotation(),False)
                    self.capture_component.set_editor_property('fov_angle',self.camera.camera_component.get_editor_property('field_of_view'))
                    self.capture_component.capture_scene()
                    self.last_capture=time.monotonic()
                if self.scene and self.current and self.current['type']!='configure':
                    progress,playing=self.state()
                    if self.scene['camera']=='orbit':
                        self.orbit_angle+=min(delta,.1)*.18
                        self.set_camera('orbit',self.scene['compactViewport'])
                    # Clamp the one shared player at its last authored sample;
                    # standing's source loop must not wrap before completion.
                    entry=self.players[self.active]
                    rate=entry['player'].get_frame_rate()
                    final_frame=rate.denominator/(rate.numerator*entry['duration'])
                    ended=progress>=1.-1e-5 or (not playing and progress>=1.-final_frame-1e-5)
                    if not self.scene['paused'] and ended and not self.completed:
                        self.seek(1.);self.completed=True
                        self.send('completed',moveId=self.active,progress=1.,playing=False)
                        self.report['lastCompleted']={'moveId':self.active,'requestId':self.current['requestId'],'progress':1.}
                        self.save()
                    elif time.monotonic()-self.last_state>=.15:
                        self.send('state',moveId=self.active,progress=progress,playing=playing)
                        self.last_state=time.monotonic()
            elif self.phase=='end':
                playing=self.level is not None and self.level.is_in_play_in_editor()
                if playing and time.monotonic()-self.end_started>=END_TIMEOUT_SECONDS:
                    self.report.update(status='failed',cleanupError='PIE did not stop within10 seconds')
                    self.finish()
                elif not playing:self.finish()
        except Exception:
            error=traceback.format_exc()
            self.report['status']='failed';self.report.setdefault('error',error)
            unreal.log_error(error)
            if self.phase=='end':self.finish()
            else:self.begin_end()
            if not self.finished:self.save()
        finally:self.busy=False


preview=LocalPreview()
