"""Capture actual imported UE5.8 scenes; completion is explicitly unreviewed.

Run in a fresh full Editor using -ExecutePythonScript. No commandlet/NullRHI.
Slate ticks keep rendering alive; this script never sleeps or saves a map.
"""
from pathlib import Path
import datetime
import gc
import hashlib
import json
import math
import re
import struct
import time
import traceback
import unreal

PROJECT = Path(__file__).resolve().parents[2]
REVIEW = PROJECT / "Saved/PilotReview"
RESOLUTION = (1280, 720)
SHOT_TIMEOUT = 180.
TOTAL_TIMEOUT = 900.


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_import_report():
    raw = (REVIEW / "editor-import.json").read_bytes()
    report = json.loads(raw)
    pinned = json.loads((PROJECT / "pilot-assets.json").read_text())
    fingerprint = sha256(json.dumps(pinned, separators=(",", ":"), ensure_ascii=False).encode())
    check(report.get("status") == "editor_import_completed_visual_validation_pending", "A completed Editor import report is required")
    check(report.get("baselineCommit") == pinned["baselineCommit"], "Import baseline differs from pinned pilot")
    check(report.get("sourceFingerprint") == fingerprint, "Import source fingerprint differs from pinned pilot")
    check(str(report.get("engineVersion", "")).startswith("5.8."), "Import was not produced by UE5.8")
    root = report.get("contentRoot", "")
    check(re.fullmatch(r"/Game/Pilot/Run_[A-Za-z0-9_]+", root), "Unexpected imported content root")
    check([c["name"] for c in report["clips"]] == [c["name"] for c in pinned["clips"]], "Imported clip inventory changed")
    for clip in report["clips"]:
        check(clip["map"] == root + "/Maps/" + clip["name"], "Map escaped the reported import run")
        check(clip["camera"].startswith(clip["map"] + "."), "Camera is outside its reported map")
        check(clip.get("animationBindingsAssigned") is True and clip["components"], "Import has no validated animation assignment")
        sequence = clip.get("sharedSequence", {})
        check(sequence.get("asset", "").startswith(root + "/Clips/" + clip["name"] + "/"),
              "Imported shared sequence is missing or outside its clip")
        check(sequence.get("actor", "").startswith(clip["map"] + "."), "Shared sequence actor is outside its map")
        check(sequence.get("skeletalBindingCount") == len(clip["components"]), "Shared skeletal sequence bindings are incomplete")
        parents = sequence.get("parentBindings", [])
        check(len(parents) == 2 and {p["name"] for p in parents} == {"JQ_Attacker", "JQ_Defender"},
              "Shared parent-motion bindings are incomplete")
        check({row["role"] for row in clip["components"]} == {"Attacker", "Defender"}, "Both fighter bindings are required")
        for row in clip["components"]:
            check(row["component"].startswith(clip["map"] + "."), "Component is outside its reported map")
            check(row["animation"].startswith(root + "/Clips/" + clip["name"] + "/"), "Animation is outside its reported clip")
    return report, sha256(raw)


class Capture:
    def __init__(self):
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        self.output = REVIEW / "captures" / stamp
        self.output.mkdir(parents=True, exist_ok=False)
        self.report = {"status": "starting", "renderValidated": False,
                       "pairedMotionValidated": False, "pixelStreamingValidated": False,
                       "resolution": list(RESOLUTION), "captures": [],
                       "limits": ["Actual Editor images require visual review; no quality approval",
                                  "Three shared paused times per clip, not an all-frame motion audit",
                                  "No browser streaming or app integration is exercised"]}
        self.handle = None
        self.keep_alive = None
        self.previous_warmup = None
        self.finished = False
        self.in_tick = False
        self.task = None
        self.loaded_clip = None
        self.bindings = []
        self.role_bodies = {}
        self.head_bones = {}
        self.resolved_bones = {}
        self.index = 0
        self.phase = "prepare"
        self.started = self.shot_started = time.monotonic()

    def save(self):
        (self.output / "capture-report.json").write_text(json.dumps(self.report, indent=2) + "\n")

    def stage(self, name):
        # Persist native-call boundaries because an Editor crash cannot be
        # caught by Python. Loading/streaming can pump nested Slate callbacks.
        self.report["lastStage"] = name
        self.save()
        unreal.log("JiuQuest capture stage: " + name)

    def finish(self, error=None):
        if self.finished:
            return
        level = getattr(self, "level", None)
        if level is not None and level.is_in_play_in_editor():
            if self.phase != "finish_game":
                self.pending_finish_error = error
                self.cleanup_started = time.monotonic()
                self.phase = "finish_game"
                unreal.EditorLevelLibrary.editor_end_play()
            return
        self.complete(error)

    def complete(self, error=None):
        if self.finished:
            return
        self.finished = True
        self.report["status"] = "failed" if error else "captured_unreviewed"
        self.report["finishedAtUtc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        if error:
            self.report.update(error=str(error), traceback=traceback.format_exc())
        try:
            if self.handle is not None:
                unreal.unregister_slate_post_tick_callback(self.handle)
                self.handle = None
        except Exception as exc:
            self.report.update(status="failed", cleanupError=str(exc))
        finally:
            try:
                if self.previous_warmup is not None:
                    try:
                        unreal.SystemLibrary.execute_console_command(self.editor.get_editor_world(),
                            "r.HighResScreenshotDelay " + str(self.previous_warmup))
                        check(unreal.SystemLibrary.get_console_variable_int_value("r.HighResScreenshotDelay")
                              == self.previous_warmup, "Screenshot warmup setting did not restore")
                        self.report["screenshotWarmup"]["restored"] = True
                    except Exception as exc:
                        self.report.update(status="failed", warmupCleanupError=str(exc))
                self.save()
                unreal.log("JiuQuest capture " + self.report["status"] + ": " + str(self.output))
            finally:
                # Release wrappers for the destroyed Simulate world while
                # Python and Unreal are both alive, before interpreter teardown.
                keep_alive = self.keep_alive
                self.keep_alive = None
                try:
                    for attribute in ("game_world", "camera", "original_camera", "bindings", "role_bodies",
                                      "sequence_actor", "sequence_player", "task", "actors", "editor", "level"):
                        setattr(self, attribute, None)
                    gc.collect()
                    self.report["pythonReferencesReleasedBeforeExit"] = True
                    self.save()
                except Exception as exc:
                    self.report.update(status="failed", referenceCleanupError=str(exc))
                    self.save()
                finally:
                    # Full-Editor command-line Python exits on the next tick.
                    if callable(keep_alive):
                        keep_alive(False)

    def start(self):
        check(Path(unreal.Paths.project_dir()).resolve() == PROJECT, "Wrong Unreal project")
        version = unreal.SystemLibrary.get_engine_version()
        check(version.startswith("5.8."), "Capture requires UE5.8")
        self.report["engineVersion"] = version
        scripting = getattr(unreal, "EditorPythonScripting", None)
        self.keep_alive = getattr(scripting, "set_keep_python_script_alive", None)
        check(callable(self.keep_alive), "UE keep-alive API unavailable; no capture was queued")
        for owner, method in ((unreal, "register_slate_post_tick_callback"),
                              (unreal, "unregister_slate_post_tick_callback"),
                              (unreal.AutomationLibrary, "take_high_res_screenshot"),
                              (unreal.AutomationLibrary, "finish_loading_before_screenshot")):
            check(callable(getattr(owner, method, None)), "Capture API unavailable: " + method)
        imported, report_hash = read_import_report()
        self.report.update(importReportSha256=report_hash, baselineCommit=imported["baselineCommit"],
                           sourceFingerprint=imported["sourceFingerprint"], contentRoot=imported["contentRoot"])
        self.report["importedSequenceInventory"] = {clip["name"]: clip["sharedSequence"] for clip in imported["clips"]}
        self.jobs = [(clip, label, fraction) for clip in imported["clips"]
                     for label, fraction in (("first", 0.), ("mid", .5), ("finish", 1.))]
        standing = next(c for c in imported["clips"] if c["name"] == "standing_stance")
        self.jobs.extend((standing, role + "-face", 0.) for role in ("Attacker", "Defender"))
        self.level = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
        self.actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        self.editor = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
        check(not self.level.is_in_play_in_editor(), "Use a fresh Editor session outside Play In Editor")
        # High-res captures create a new-resolution viewport. Its own run-up
        # frames warm Lumen/VSM history; the earlier Slate delay cannot do so.
        self.previous_warmup = unreal.SystemLibrary.get_console_variable_int_value("r.HighResScreenshotDelay")
        self.report["screenshotWarmup"] = {"frames": 64, "previous": self.previous_warmup, "restored": False}
        unreal.SystemLibrary.execute_console_command(self.editor.get_editor_world(), "r.HighResScreenshotDelay 64")
        check(unreal.SystemLibrary.get_console_variable_int_value("r.HighResScreenshotDelay") == 64,
              "Screenshot warmup setting was rejected")
        self.keep_alive(True)
        self.report["status"] = "capturing"
        self.save()
        self.handle = unreal.register_slate_post_tick_callback(self.tick)
        check(self.handle is not None, "Failed to register capture callback")

    def begin_clip(self, clip):
        self.bindings = []
        self.camera = None
        self.stage("load map " + clip["name"])
        check(self.level.load_level(clip["map"]), "Could not load reported map: " + clip["map"])
        # A real game world ticks AnimSequencerInstance. Slate-only Editor
        # playback can update the clock and scene parents while bones stay stale.
        self.stage("begin simulate " + clip["name"])
        self.level.editor_play_simulate()
        self.pending_clip = clip
        self.phase = "wait_game"

    def load_clip(self, clip):
        self.role_bodies = {}
        self.resolved_bones = {}
        self.stage("inspect simulated map " + clip["name"])
        actors = unreal.GameplayStatics.get_all_actors_of_class(self.game_world, unreal.Actor)
        by_name = {actor.get_name(): actor for actor in actors}
        check(len(by_name) == len(actors), "Ambiguous simulated actor names")
        cameras = [a for a in actors if a.get_name() == clip["camera"].rsplit(".", 1)[-1]
                   and isinstance(a, unreal.CameraActor)]
        check(len(cameras) == 1, "Reported camera is missing or ambiguous")
        self.camera = cameras[0]
        self.original_camera = (self.camera.get_actor_location(), self.camera.get_actor_rotation(),
                                float(self.camera.camera_component.get_editor_property("field_of_view")))
        components = {}
        for row in clip["components"]:
            actor = by_name.get(row["actor"].rsplit(".", 1)[-1])
            check(actor is not None, "Recorded fighter actor is missing from simulation")
            matches = [c for c in actor.get_components_by_class(unreal.SkeletalMeshComponent)
                       if c.get_name() == row["component"].rsplit(".", 1)[-1]]
            check(len(matches) == 1, "Recorded skeletal component is missing or ambiguous in simulation")
            components[row["component"]] = matches[0]
        actual_components = {c.get_path_name() for a in actors
                             for c in a.get_components_by_class(unreal.SkeletalMeshComponent)}
        check(actual_components == {c.get_path_name() for c in components.values()},
              "Simulated skeletal component inventory changed")
        sequence = clip["sharedSequence"]
        sequence_actors = [a for a in actors if a.get_name() == sequence["actor"].rsplit(".", 1)[-1]
                           and isinstance(a, unreal.LevelSequenceActor)]
        check(len(sequence_actors) == 1, "Reported shared sequence actor is missing or ambiguous")
        self.sequence_actor = sequence_actors[0]
        sequence_asset = self.sequence_actor.get_sequence()
        check(sequence_asset is not None and sequence_asset.get_path_name() == sequence["asset"], "Shared sequence asset changed")
        # The actual game world initializes this player's authoritative tracks.
        # BlueprintGetter is exposed as a Python property, not a method.
        self.sequence_player = self.sequence_actor.get_editor_property("sequence_player")
        check(self.sequence_player is not None, "Shared sequence player is unavailable in Editor")
        self.sequence_player.pause()
        rows = clip["components"]
        check(len({r["component"] for r in rows}) == len(rows), "Duplicate recorded component")
        check(set(components) == {r["component"] for r in rows}, "Imported skeletal component inventory changed")
        for row in rows:
            comp = components[row["component"]]
            mesh = comp.get_editor_property("skeletal_mesh_asset")
            check(mesh is not None and mesh.get_path_name() == row["mesh"], "Imported skeletal mesh changed")
            animation = unreal.load_asset(row["animation"])
            check(isinstance(animation, unreal.AnimSequence), "Recorded animation is missing")
            skeleton = mesh.get_editor_property("skeleton")
            check(skeleton is not None and skeleton.get_path_name() == row["skeleton"]
                  and animation.get_editor_property("skeleton") == skeleton, "Recorded animation/skeleton binding changed")
            duration = float(animation.get_editor_property("sequence_length"))
            check(math.isfinite(duration) and duration > 0 and abs(duration - row["durationSeconds"]) < 1e-4,
                  "Recorded animation duration changed")
            self.bindings.append((comp, animation, duration))
            if mesh.get_name() == "JQ_" + row["role"] + "_Body":
                check(row["role"] not in self.role_bodies, "Duplicate fighter body")
                self.role_bodies[row["role"]] = comp
        check(set(self.role_bodies) == {"Attacker", "Defender"}, "Both body components are required for face views")
        durations = [duration for _, _, duration in self.bindings]
        check(max(durations) - min(durations) <= 1. / 30. + 1e-4, "Actors no longer share the reported timeline")
        self.duration = min(durations)
        check(abs(self.duration - sequence["durationSeconds"]) < 1e-4, "Shared sequence duration differs from animation")
        check(sequence["playbackEndSeconds"] > self.duration, "Shared sequence excludes the final source sample")
        self.stage("pilot camera " + clip["name"])
        self.level.pilot_level_actor(self.camera)
        # Screenshot tasks drive rendering. In UE5.8 this subsystem's True
        # setting only removes a named override and asserts if none exists.
        self.stage("finish streaming " + clip["name"])
        unreal.AutomationLibrary.finish_loading_before_screenshot()
        self.stage("map ready " + clip["name"])
        self.loaded_clip = clip["name"]

    def restore_camera(self):
        location, rotation, fov = self.original_camera
        self.camera.set_actor_location(location, False, False)
        self.camera.set_actor_rotation(rotation, False)
        self.camera.camera_component.set_editor_property("field_of_view", fov)

    def resolve_bone(self, role, source_name):
        key = (role, source_name)
        if key not in self.resolved_bones:
            body = self.role_bodies[role]
            # Interchange disambiguates duplicate source joint names across
            # the two skins with a deterministic 32-hex suffix on Defender.
            candidates = [str(body.get_bone_name(i)) for i in range(body.get_num_bones())]
            pattern = re.escape(source_name) + r"(?:_[0-9a-f]{32})?"
            candidates = [bone for bone in candidates if re.fullmatch(pattern, bone)]
            check(len(candidates) == 1, "Required bone missing or ambiguous: " + role + "/" + source_name)
            bone = candidates[0]
            check(body.get_bone_index(bone) >= 0, "Resolved bone is unavailable")
            self.resolved_bones[key] = bone
        return self.resolved_bones[key]

    def bone_state(self):
        result = {}
        for role, body in self.role_bodies.items():
            result[role] = {}
            for name in ("Head", "hand_l", "hand_r"):
                bone = self.resolve_bone(role, name)
                point = body.get_socket_location(bone)
                rotation = body.get_socket_rotation(bone)
                values = (point.x, point.y, point.z, rotation.pitch, rotation.yaw, rotation.roll)
                check(all(math.isfinite(v) for v in values), "Non-finite evaluated bone transform")
                result[role][name] = {"importedBone": bone,
                    "locationCm": {key: float(getattr(point, key)) for key in ("x", "y", "z")},
                    "rotationDegrees": {key: float(getattr(rotation, key)) for key in ("pitch", "yaw", "roll")}}
        return result

    def frame_face(self, role):
        heads = {}
        for name, body in self.role_bodies.items():
            bone = self.resolve_bone(name, "Head")
            self.head_bones[name] = bone
            point = body.get_socket_location(bone)
            check(all(math.isfinite(v) for v in (point.x, point.y, point.z)), "Head location is not finite")
            heads[name] = point
        head = heads[role]
        other = heads["Defender" if role == "Attacker" else "Attacker"]
        dx, dy = other.x - head.x, other.y - head.y
        length = math.hypot(dx, dy)
        check(length > 1., "Fighter heads have no stable horizontal facing direction")
        dx, dy = dx / length, dy / length
        # Thirty degrees off the direction toward the partner shows the face
        # and collar without placing the camera directly behind that partner.
        side_x, side_y = .866025403784 * dx - .5 * dy, .866025403784 * dy + .5 * dx
        target = unreal.Vector(head.x, head.y, head.z + 3.)
        location = unreal.Vector(target.x + 150. * side_x, target.y + 150. * side_y, target.z + 10.)
        self.camera.set_actor_location(location, False, False)
        self.camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(location, target), False)
        self.camera.camera_component.set_editor_property("field_of_view", 28.)

    def camera_state(self):
        location = self.camera.get_actor_location()
        rotation = self.camera.get_actor_rotation()
        return {"locationCm": {key: float(getattr(location, key)) for key in ("x", "y", "z")},
                "rotationDegrees": {key: float(getattr(rotation, key)) for key in ("pitch", "yaw", "roll")},
                "fieldOfViewDegrees": float(self.camera.camera_component.get_editor_property("field_of_view"))}

    def seek_sequence(self, seconds):
        # The single imported sequence owns both animated scene parents and
        # skeletal sections. Per-component playback would lose parent motion
        # or fight Sequencer's evaluated pose.
        self.sequence_player.pause()
        rate = self.sequence_player.get_frame_rate()
        frame = round(seconds * rate.numerator / rate.denominator)
        check(abs(frame * rate.denominator / rate.numerator - seconds) < 1e-4,
              "Requested capture time is not aligned to the sequence display rate")
        # TIME converts float32 seconds to frames. For example 0.899999976*30
        # falls below 27 and a frame-locked player evaluates 26. Use the exact
        # authored display frame for these aligned pilot review times.
        params = unreal.MovieSceneSequencePlaybackParams(
            frame=unreal.FrameTime(frame_number=unreal.FrameNumber(value=frame), sub_frame=0.),
            position_type=unreal.MovieScenePositionType.FRAME,
            update_method=unreal.UpdatePositionMethod.JUMP)
        self.sequence_player.set_playback_position(params)
        actual = self.sequence_seconds()
        self.report["lastSeek"] = {"requestedSeconds": seconds, "immediateSeconds": actual,
            "requestedDisplayFrame": frame,
            "qualifiedTime": str(self.sequence_player.get_current_time()),
            "frameRate": str(self.sequence_player.get_frame_rate())}
        self.save()

    def sequence_seconds(self):
        return float(unreal.TimeManagementLibrary.conv_qualified_frame_time_to_seconds(
            self.sequence_player.get_current_time()))

    def tick(self, _delta):
        if self.finished or self.in_tick:
            return
        self.in_tick = True
        try:
            now = time.monotonic()
            if self.phase == "finish_game":
                if not self.level.is_in_play_in_editor():
                    self.complete(self.pending_finish_error)
                elif now - self.cleanup_started > 30.:
                    self.complete(RuntimeError("Simulation did not stop within30seconds"))
                return
            check(now - self.started <= TOTAL_TIMEOUT, "Capture run exceeded 900 seconds")
            check(now - self.shot_started <= SHOT_TIMEOUT, "Capture frame exceeded 180 seconds")
            clip, label, fraction = self.jobs[self.index]
            if self.phase == "wait_game":
                self.game_world = self.editor.get_game_world()
                if self.game_world is not None:
                    self.load_clip(self.pending_clip)
                    self.phase = "prepare"
                return
            if self.phase == "wait_end_game":
                if not self.level.is_in_play_in_editor():
                    self.loaded_clip = None
                    self.phase = "prepare"
                return
            if self.phase == "prepare":
                if self.loaded_clip != clip["name"]:
                    if self.level.is_in_play_in_editor():
                        unreal.EditorLevelLibrary.editor_end_play()
                        self.phase = "wait_end_game"
                    else:
                        self.begin_clip(clip)
                    return
                self.restore_camera()
                self.seconds = self.duration * fraction
                self.stage("pose " + clip["name"] + " " + label)
                for comp, animation, _ in self.bindings:
                    comp.set_update_animation_in_editor(True)
                self.seek_sequence(self.seconds)
                self.image = self.output / (clip["name"] + "-" + label + ".png")
                check(not self.image.exists(), "Refusing to overwrite capture")
                self.settled_at = time.monotonic()
                self.frames = 0
                self.phase = "settle"
                self.stage("settle " + clip["name"] + " " + label)
            elif self.phase in ("settle", "camera_settle"):
                self.frames += 1
                if self.phase == "settle" and self.frames == 1:
                    actual = self.sequence_seconds()
                    self.report["lastSeek"]["nextTickSeconds"] = actual
                    self.save()
                    check(math.isfinite(actual) and abs(actual - self.seconds) < 1e-4,
                          f"Shared sequence seek wanted {self.seconds:.9f}s, got {actual:.9f}s after one tick")
                if self.frames < 30 or now - self.settled_at < 2.:
                    return
                if self.phase == "settle" and label.endswith("-face"):
                    self.stage("frame face " + label)
                    self.frame_face(label.removesuffix("-face"))
                    self.frames = 0
                    self.settled_at = time.monotonic()
                    self.phase = "camera_settle"
                    return
                self.stage("request image " + clip["name"] + " " + label)
                self.task = unreal.AutomationLibrary.take_high_res_screenshot(
                    *RESOLUTION, str(self.image), camera=self.camera, force_game_view=True)
                check(self.task is not None and self.task.is_valid_task(), "Editor rejected screenshot task")
                self.phase = "image"
                self.stage("await image " + clip["name"] + " " + label)
            elif self.phase == "image":
                check(self.task.is_valid_task(), "Screenshot task became invalid")
                if not self.task.is_task_done() or not self.image.is_file():
                    return
                data = self.image.read_bytes()
                if len(data) < 33 or data[-12:] != b"\x00\x00\x00\x00IEND\xaeB\x60\x82":
                    return
                check(data[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", data[16:24]) == RESOLUTION,
                      "Screenshot is not the requested PNG resolution")
                sequence_seconds = self.sequence_seconds()
                check(math.isfinite(sequence_seconds) and abs(sequence_seconds - self.seconds) < 1e-4,
                      "Shared sequence advanced while capture was paused")
                self.report["captures"].append({"clip": clip["name"], "frame": label, "map": clip["map"],
                    "camera": clip["camera"], "sharedSeconds": self.seconds,
                    "sharedSequenceTimeSeconds": sequence_seconds, "skeletalComponentCount": len(self.bindings),
                    "animationAuthority": "shared_level_sequence",
                    "world": self.game_world.get_path_name(), "worldMode": "simulate_in_editor_game_world",
                    "runtimeCamera": self.camera.get_path_name(),
                    "viewLabel": label if label.endswith("-face") else "fullbody",
                    "cameraTransform": self.camera_state(),
                    "headBones": dict(self.head_bones) if label.endswith("-face") else {},
                    "evaluatedBoneTransforms": self.bone_state(),
                    "file": self.image.name, "bytes": len(data), "sha256": sha256(data), "reviewed": False})
                self.save()
                self.index += 1
                self.task = None
                if self.index == len(self.jobs):
                    self.finish()
                    return
                self.shot_started = time.monotonic()
                self.phase = "prepare"
        except Exception as exc:
            self.finish(exc)
        finally:
            self.in_tick = False


if __name__ == "__main__":
    # Keep the session and its delegate alive until completion or bounded failure.
    session = Capture()
    try:
        session.start()
    except Exception as exc:
        session.finish(exc)
        raise
