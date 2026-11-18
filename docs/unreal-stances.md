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

Published so far: `standing_stance` (both athletes, side and front views). For the player, all six named stances: `stance_sumo`, `stance_sambo` and `stance_boxing` in side and front views, and `stance_karate`, `stance_muay_thai` and `stance_capoeira` in the side view only, so the stage shows no camera buttons for those three. For a rival, `stance_sumo` and `stance_sambo` in the side view; a rival who holds any other stance is shown in the wrestling stance. No entry clip is published.

Every loop is 1280 by 720 at 30 frames a second. The boxer shell's is motion capture: 96 frames (3.2 seconds) in which the athlete's guard is alive while his feet stay planted (see The boxer shell's loop below). Every other loop is 54 frames (1.8 seconds) of a pose held nearly still. In `standing_stance` and in the boxer shell's loop the athlete in the wrestling stance has the ready hands Codex refined on November 16, 2026. The other named stances' loops (the player's sumo, sambo, karate, Muay Thai and capoeira, and the rival's sumo and sambo) were rendered from Codex's loops of before that day, so the athlete in the wrestling stance there has the earlier hands.

It also reports `exact`: whether the clip shows the player in the stance they chose. When it does not, the Arena says so in one line under the picker and keeps the choice. Nothing is substituted silently.

`stanceEntry(fighterStance, camera)` returns the entry clip for a stance when one is published. Nothing calls it yet, and no entry clip is published. No technique clip is accepted either. The one technique clip on the site that starts on the feet is the owner-published double-leg draft (see [Owner-published double-leg draft](unreal-integration.md#owner-published-double-leg-draft-2026-11-16)): after the player's own double leg from a standing start, the stage cuts from the stance loop to that clip in the same picture box, with no entry clip and no dissolve. An accepted technique clip will follow the loop the same way once it is published for every performer it needs; an entry clip between them is still to be built.

## The boxer shell's loop

Since November 18, 2026 the boxer shell plays a motion-captured loop, `stance_boxing`, in two views: the side view, which replaced the boxing loop published before, and a front view, the first for this stance, so the stage shows the Side and Front buttons for it. The loop it replaced was a crouched pose held nearly still, like the other named stances' loops.

**What it shows.** The white athlete, the player's, crouches in a boxer's guard and keeps it alive: the guard bobs lightly, about twice a second, while both feet stay planted where they stand. His knees are bent, his torso leans forward over his hips and his chin is down. His rear (right) fist is closed beside his right jaw, his lead (left) fist closed about 15 cm in front of his face at nose-to-mouth height, the two fists apart, the elbows down by his ribs. Seen from the side, the rear fist, nearer the camera, covers his lips at the top of each bob and sits at his chin the rest of the time; the front view shows it beside his jaw. The navy athlete holds the wrestling stance with the ready hands, as in `standing_stance`.

**The take.** The motion is the boxing idle `Box1_M3_Idle` of Punch Pro (MoCap Online), a motion-capture pack the owner bought on Fab, retargeted onto the athletes' MetaHuman body. It is the first motion from that pack on the site. The take repeats itself every 48 frames. The loop plays it at its own speed from take frame 8 for 96 frames, two of its cycles, so its last frame leads into its first as one frame of the take leads into the next, with nothing blended at the seam. The navy athlete plays two cycles of the 54-frame ready-hands loop at 1.125 times its speed, so his loop closes with the boxer's.

**Two adjustments, and why.** As captured, the boxer stands nearly upright, his knees almost straight, with both fists about 40 cm in front of his face: a long guard for gloves, not the shell. The owner asked for starting stances that crouch like wrestlers and named the stance pictures of the profile's picker as the examples; the boxer shell's picture shows the athlete in a long stance with his knees bent, his lead fist up in front of his face and his rear fist in front of his chin and chest, and the loop this one replaces was crouched. So two adjustments were made on every frame, the first and the last included, which keeps the seam exact:

- **Crouch.** The hips 8 cm lower and the torso turned 8 degrees forward about the hips, with both legs solved again by inverse kinematics so that each foot stays exactly where the capture plants it. The knees bend to 119 to 126 degrees (144 to 158 as captured), and the pelvis sits 82 to 84 cm above the mat (90 to 92 as captured), as low as in the loop this one replaces.
- **Guard.** Each fist moved by inverse kinematics of the arm: the lead (left) fist 19 cm back towards the face, 2 cm in and 3 cm up, the rear (right) fist 30 cm back, 9 cm in and 4 cm up. The hands keep their turn on the forearms and the fingers stay as closed as they were captured; the elbows drop by the ribs.

The loop's guard is tighter and higher than the picture's (the rear fist at the mouth and chin rather than in front of the chin and chest), and its stance is shorter (about 42 cm) and a little narrower: a high guard that still reads as boxing.

**On a wide stage.** Where the stage is 620 pixels wide or more, its picture box is two to one, so it trims 80 of a clip's 720 rows, and the usual trim shows rows 56 to 696 (see [Pre-rendered Unreal clips](unreal-integration.md#pre-rendered-unreal-clips-arena-standing-stance)). In the boxer shell's front view the near foot reaches row 706, so that view takes the whole trim from the empty top and shows rows 80 to 720 (`src/components/UnrealClipStage.css`); the athletes' heads start at row 110. The side view keeps the usual trim, and a narrower stage shows the whole picture.

How it was made and checked, and what the render's notes say of it, is in [The boxer shell's loop (motion capture)](unreal-integration.md#the-boxer-shells-loop-motion-capture). In short: Claude rendered both views in Unreal Engine 5.8.4 in the dojo set, the encoder proved the seam, and every frame of both views was looked at, by the operator who rendered them and by two reviewers, who passed both views. The owner has not seen it yet.

**The stances that keep their loops.** Muay Thai, capoeira, karate, sumo and sambo keep the loops published before:

- Muay Thai: the kickboxing take that was tried (Kubold's `KB_Idle_3`) twists the torso so that the gi jacket cuts through the black belt beside the knot. Other takes are being studied.
- Capoeira: the purchased ginga travels 180 to 187 cm along the line between the athletes, and the shared scene leaves about 110 cm there. Every shortened version stopped reading as a ginga.
- Karate: none of the kickboxing idles reads as a karate stance.
- Sumo and sambo: no motion capture that fits them has been bought.

## The pictures

The seven pictures in the pickers are illustrations of the Unreal athlete, not Unreal renders (`src/unreal/stancePictures.data.js`). They are the examples Unreal poses each stance from.

## Bringing in new stance clips

Stance clips arrive in the Unreal render pack's `clips/technique-clips.json` like any other clip, and `node tools/import_unreal_clips.mjs` imports them, with no acceptance line needed. The importer leaves out any entry marked `"draft": true` and lists what it left out. A stance loop must have `"loops": true` and an `enter_<id>` clip `"loops": false`.

The importer writes the whole clip list anew, so an import drops the row of the owner-published double-leg draft (its two files stay). Run `node tools/publish_unreal_clip_draft.mjs --restore` straight after it to put that row back; the importer says so when it leaves files without a row, and the unit tests fail until it is done (see [Owner-published double-leg draft](unreal-integration.md#owner-published-double-leg-draft-2026-11-16)).

Every published stance clip is listed in the pack manifest. The first sambo and sumo loops went on the site on November 13, 2026 a few hours before the pack listed them; the pack's own files replaced them the same day (the sambo take was corrected so the rear heel is off the mat, the sumo take is the same file).

After an import that adds a stance:

- `tests/unrealTechniqueClips.test.js` already accepts `stance_<id>` and `enter_<id>` as clip names in its "clips name real moves" test. Its "a looping clip is a stance held on the feet" test already allows a clip that plays once if it is a curriculum technique, by its clip id, an `enter_<id>` clip or a match moment (see [Match moments](unreal-integration.md#match-moments)), with `"posterFrame": 0`.
- `tests/unrealStances.test.js` asserts that no stance has an entry clip published yet. That line has to go when the first `enter_<id>` clip is imported. It also requires every view of one stance loop to have the same frame count and length, because the loops are no longer all 54 frames: when a stance gets a new take, import all its views together, or a stance could show one take from the side and another from the front.
- `tools/test_unreal_clip_stage.mjs` expects the Arena to open on `standing_stance`. The first rival's stance is the karate stance, so once `stance_karate/opponent-side` is published the Arena opens on that clip and the test's expected clip has to follow `stanceLoop`.
- `tools/test_stance_picker.mjs` works out what each stance should play from `stanceLoop`, and which camera buttons the stage shows from the views published for that clip, so a new stance or view needs no change there. It also plays the boxer shell's loop in its side and front views, each to the end of its loop and on into the next, and expects both views: if they change, that check has to follow. At 1440 by 900 it works out which rows of the clip the picture box shows, and expects the front view to show at least rows 100 to 712 (both heads, which start at row 110, and the whole near foot, which reaches row 706) and the side view to keep the usual trim. A new take of the front view needs its feet and heads measured again, and the rule in `src/components/UnrealClipStage.css` and this check changed with them.
- `tools/test_match_moments.mjs` expects the karate loop in the side view only (its test bundle checks that a loop without a front view shows from the side, with no camera buttons and no greeting), and checks in the release build that there is no greeting over the boxer shell's loop seen from the front, which it expects to be published. A front view of the karate loop, or a boxer shell without one, has to be followed there.
