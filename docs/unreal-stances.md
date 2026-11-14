# Starting stances

A fighter has one of seven fighting stances. It is chosen in the Fighter Creator, or in the Arena under the stage while the position is Standing and no exchange result is on screen. Both places change the same saved field, `fighter.stance`. The stance is where the fighter's standing animations begin.

## What plays

Unreal renders each stance to a video file and the page plays the file. `src/unreal/stances.js` maps a stance to its clips:

| Clip | What it shows |
| --- | --- |
| `standing_stance` | Both athletes in the wrestling stance. Every technique that starts on the feet starts from this pose. |
| `stance_<id>` | One athlete holds the named stance and the other the wrestling stance. `performerSide` says which athlete holds it: `fighter` is the player, `opponent` is the rival. |
| `enter_<id>` | That athlete settling from the named stance into the wrestling stance, so a technique clip can follow it. |

The ids are `wrestling`, `sumo`, `boxing`, `karate`, `muay_thai`, `sambo` and `capoeira`. The wrestling stance has no clips of its own: its loop is `standing_stance` and it needs no entry.

`stanceLoop(fighterStance, opponentStance)` picks the loop:

1. the player's stance, when Unreal has rendered it;
2. otherwise a rival's stance, but only beside a player in the wrestling stance, because one clip holds one named stance;
3. otherwise `standing_stance`.

Published so far: `standing_stance` (both athletes, side and front views). For the player, all six named stances: `stance_sumo` and `stance_sambo` in side and front views, and `stance_boxing`, `stance_karate`, `stance_muay_thai` and `stance_capoeira` in the side view only, so the stage shows no camera buttons for those four. For a rival, `stance_sumo` and `stance_sambo` in the side view; a rival who holds any other stance is shown in the wrestling stance. No entry clip is published.

It also reports `exact`: whether the clip shows the player in the stance they chose. When it does not, the Arena says so in one line under the picker and keeps the choice. Nothing is substituted silently.

`stanceEntry(fighterStance, camera)` returns the entry clip for a stance when one is published. Nothing calls it yet. No entry clip and no technique clip is published. When a technique clip is published for both performers, the stage cuts from the stance loop to the technique clip in the same picture box, with no entry clip and no dissolve; an entry clip between them is still to be built.

## The pictures

The seven pictures in the pickers are illustrations of the Unreal athlete, not Unreal renders (`src/unreal/stancePictures.data.js`). They are the examples Unreal poses each stance from.

## Bringing in new stance clips

Stance clips arrive in the Unreal render pack's `clips/technique-clips.json` like any other clip, and `node tools/import_unreal_clips.mjs` imports them, with no acceptance line needed. The importer leaves out any entry marked `"draft": true` and lists what it left out. A stance loop must have `"loops": true` and an `enter_<id>` clip `"loops": false`.

Every published stance clip is listed in the pack manifest. The first sambo and sumo loops went on the site on November 13, 2026 a few hours before the pack listed them; the pack's own files replaced them the same day (the sambo take was corrected so the rear heel is off the mat, the sumo take is the same file).

After an import that adds a stance:

- `tests/unrealTechniqueClips.test.js` already accepts `stance_<id>` and `enter_<id>` as clip names in its "clips name real moves" test. Its "a looping clip is a stance held on the feet" test already allows a clip that plays once if it is a curriculum technique, by its clip id, or an `enter_<id>` clip, with `"posterFrame": 0`.
- `tests/unrealStances.test.js` asserts that no stance has an entry clip published yet. That line has to go when the first `enter_<id>` clip is imported.
- `tools/test_unreal_clip_stage.mjs` expects the Arena to open on `standing_stance`. The first rival's stance is the karate stance, so once `stance_karate/opponent-side` is published the Arena opens on that clip and the test's expected clip has to follow `stanceLoop`.
- `tools/test_stance_picker.mjs` works out what each stance should play from `stanceLoop`, so it needs no change.
