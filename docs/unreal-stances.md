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

Published so far: `standing_stance` (both athletes, side and front views). For the player, all six named stances: `stance_sumo`, `stance_sambo`, `stance_boxing` and `stance_muay_thai` in side and front views, and `stance_karate` and `stance_capoeira` in the side view only, so the stage shows no camera buttons for those two. For a rival, `stance_sumo` and `stance_sambo` in the side view; a rival who holds any other stance is shown in the wrestling stance. No entry clip is published.

Every loop is 1280 by 720 at 30 frames a second. Two are motion capture, in which the athlete's guard is alive: the boxer shell's, 96 frames (3.2 seconds), with both feet planted, and the Muay Thai guard's, 87 frames (2.9 seconds), with the rear foot planted and the lead knee lifted twice (see The boxer shell's loop and The Muay Thai guard's loop below). Every other loop is 54 frames (1.8 seconds) of a pose held nearly still. In `standing_stance` and in the boxer shell's and the Muay Thai guard's loops the athlete in the wrestling stance has the ready hands Codex refined on November 16, 2026. The other named stances' loops (the player's sumo, sambo, karate and capoeira, and the rival's sumo and sambo) were rendered from Codex's loops of before that day, so the athlete in the wrestling stance there has the earlier hands.

It also reports `exact`: whether the clip shows the player in the stance they chose. When it does not, the Arena says so in one line under the picker and keeps the choice. Nothing is substituted silently.

`stanceEntry(fighterStance, camera)` returns the entry clip for a stance when one is published. Nothing calls it yet, and no entry clip is published. No technique clip is accepted either. The one technique clip on the site that starts on the feet is the owner-published double-leg draft (see [Owner-published double-leg draft](unreal-integration.md#owner-published-double-leg-draft-2026-11-16)): after the player's own double leg from a standing start, the stage cuts from the stance loop to that clip in the same picture box, with no entry clip and no dissolve. An accepted technique clip will follow the loop the same way once it is published for every performer it needs; an entry clip between them is still to be built.

## The boxer shell's loop

Since November 18, 2026 the boxer shell plays a motion-captured loop, `stance_boxing`, in two views: the side view, which replaced the boxing loop published before, and a front view, the first for this stance, so the stage shows the Side and Front buttons for it. The loop it replaced was a crouched pose held nearly still, like the other named stances' loops.

**What it shows.** The white athlete, the player's, crouches in a boxer's guard and keeps it alive: the guard bobs lightly, about twice a second, while both feet stay planted where they stand. His knees are bent, his torso leans forward over his hips and his chin is down. His rear (right) fist is closed in front of his right jaw, his lead (left) fist closed about 15 cm in front of his face at nose-to-mouth height, the two fists apart, the elbows down by his ribs. Seen from the side, the rear fist, nearer the camera, sits in front of his jaw and neck: its top reaches the line of his chin at the top of each bob and stays a little under it the rest of the time, so his mouth shows in every frame. The front view shows the rear fist beside his jaw and neck, with the lead fist above and behind it. The navy athlete holds the wrestling stance with the ready hands, as in `standing_stance`.

**Rendered again, the rear fist lower.** The loop first published on November 18, 2026 held the rear fist about 5 cm higher and 2 cm nearer the face, so that from the side it covered the athlete's lips at the top of each bob. Both reviewers of that render, and a reviewer of the site, named lowering it. The loop was rendered again the same day with that one change, in both views; the crouch, the lead fist, the feet, the frames and the framing are as they were.

**The take.** The motion is the boxing idle `Box1_M3_Idle` of Punch Pro (MoCap Online), a motion-capture pack the owner bought on Fab, retargeted onto the athletes' MetaHuman body. It is the first motion from that pack on the site. The take repeats itself every 48 frames. The loop plays it at its own speed from take frame 8 for 96 frames, two of its cycles, so its last frame leads into its first as one frame of the take leads into the next, with nothing blended at the seam. The navy athlete plays two cycles of the 54-frame ready-hands loop at 1.125 times its speed, so his loop closes with the boxer's.

**Two adjustments, and why.** As captured, the boxer stands nearly upright, his knees almost straight, with both fists about 40 cm in front of his face: a long guard for gloves, not the shell. The owner asked for starting stances that crouch like wrestlers and named the stance pictures of the profile's picker as the examples; the boxer shell's picture shows the athlete in a long stance with his knees bent, his lead fist up in front of his face and his rear fist in front of his chin and chest, and the loop this one replaces was crouched. So two adjustments were made on every frame, the first and the last included, which keeps the seam exact:

- **Crouch.** The hips 8 cm lower and the torso turned 8 degrees forward about the hips, with both legs solved again by inverse kinematics so that each foot stays exactly where the capture plants it. The knees bend to 119 to 126 degrees (144 to 158 as captured), and the pelvis sits 82 to 84 cm above the mat (90 to 92 as captured), as low as in the loop this one replaces.
- **Guard.** Each fist moved by inverse kinematics of the arm: the lead (left) fist 19 cm back towards the face, 2 cm in and 3 cm up, the rear (right) fist 28 cm back, 9 cm in and 1 cm down (in the first render, 30 cm back and 4 cm up). The hands keep their turn on the forearms and the fingers stay as closed as they were captured; the elbows drop by the ribs.

The loop's rear fist sits just under the chin, close to where the picture's sits, in front of the chin and chest. Otherwise its guard is tighter and higher than the picture's, and its stance is shorter (about 42 cm) and a little narrower: a high guard that still reads as boxing.

**On a wide stage.** Where the stage is 620 pixels wide or more, its picture box is two to one, so it trims 80 of a clip's 720 rows, and the usual trim shows rows 56 to 696 (see [Pre-rendered Unreal clips](unreal-integration.md#pre-rendered-unreal-clips-arena-standing-stance)). In the boxer shell's front view the near foot reaches row 708, counting the shaded undersides of the toes, so that view takes the whole trim from the empty top and shows rows 80 to 720 (`src/components/UnrealClipStage.css`); the athletes' heads start at row 108. The side view keeps the usual trim, and a narrower stage shows the whole picture.

How it was made and checked, and what the render's notes say of it, is in [The boxer shell's loop (motion capture)](unreal-integration.md#the-boxer-shells-loop-motion-capture). In short: Claude rendered both views in Unreal Engine 5.8.4 in the dojo set, the encoder proved the seam, and every frame of both views of each render was looked at, by the operator who rendered them and by two reviewers, who passed both views each time. No review by the owner is recorded.

## The Muay Thai guard's loop

Since November 18, 2026 the Muay Thai guard plays a motion-captured loop, `stance_muay_thai`, in two views: the side view, which replaced the Muay Thai loop published before, and a front view, the first for this stance, so the stage shows the Side and Front buttons for it. The loop it replaced was a guard held nearly still at eyebrow height, like the other named stances' loops.

**What it shows.** The white athlete, the player's, stands tall in a Thai guard and keeps it alive. His stance is long and bladed, on soft knees. Both fists are closed and high in front of his face, the lead (left) fist at eye-to-nose height about a fist ahead of the rear (right) one, which is at nose height; his elbows are down in front of his ribs and his chin is tucked. His weight moves, and twice in each loop he lifts his lead knee: a small lift, the lead leg's Thai rhythm, and a big one, a check with the thigh level and the toes pointed, the guard high and his head bowed into it. The leg never kicks out towards the navy athlete, and the knee stays well short of the middle between them. His rear foot stays planted on one spot. After the small lift the lead foot comes down about 2 cm ahead of where it rose; after the big lift, as its heel drops, it settles back those 2 cm to where it first stood. The navy athlete holds the wrestling stance with the ready hands, as in `standing_stance`, breathing a little more quickly.

**The take.** The motion is the kickboxing idle `KB_Idle_6` of Fighting Animset Pro (Kubold), an animation pack the owner bought on Fab, retargeted onto the athletes' MetaHuman body. It is the first motion from that pack on the site. The take is a loop of its own, 86 frames long. The loop plays one whole cycle of it from take frame 37, at 0.983 of the take's own speed, so that its 86 frames fill the loop's 87; the loop's last frame then leads into its first as one frame of the take leads into the next, with nothing blended at the seam. The navy athlete plays two cycles of the 54-frame ready-hands loop at 1.241 times its speed, so his loop closes with the Muay Thai athlete's.

**Why this take.** The kickboxing take tried first, `KB_Idle_3`, turns the chest against the hips so far that the gi jacket cuts through the black belt beside the knot in about a third of its frames, and no crouch or guard changes that. The pack's other idles were then measured by that twist, of the upper spine against the hips, before anything more was rendered. `KB_Idle_6`'s chest never turns that far, its fists stay closed, and its belt is whole in every frame of both views. The other idles were left out: their lead hand opens or drops to the chest, their feet slide along the mat, or their chest turns far enough to risk the same split.

**Three adjustments, and why.** As captured, the kickboxer stands tall on a nearly straight rear leg (its knee at 140 to 168 degrees), with his lead fist 33 to 44 cm in front of his face at chin height and his rear fist below his chin and out to the side: a long, low guard. The picker's Muay Thai picture shows the athlete standing tall in a long stance, his knees a little bent, his lead fist up in front of his nose and his rear fist at his chin. So three adjustments were made on every frame, the first and the last included, which keeps the seam exact:

- **Crouch.** The hips 6 cm lower, with both legs solved again by inverse kinematics so that each foot stays where the capture puts it, and no forward lean: a Muay Thai guard stands tall, as the picture does. The rear knee bends to 121 to 136 degrees (140 to 168 as captured), and the lead knee bends between 96 and 133 degrees as it lifts and lands (106 to 160 as captured).
- **Guard.** Each fist moved by inverse kinematics of the arm: the lead (left) fist 7 cm back towards the face and 11 cm up, the rear (right) fist 9 cm forward, 8 cm in and 11 cm up. Both end closed and high in front of the face, the elbows down. The hands keep their turn on the forearms and the fingers stay as closed as they were captured. In the previews the reviewers judged, each fist was 3 cm nearer the face and 3 cm higher; one of them found the forehead meeting the fists at the big knee lift, so the final render holds them that much further out and lower.
- **Place.** The athlete stands 8 cm further along the line between the two athletes, towards the navy one, than the take puts him, so that his rear foot stays inside the front view's picture.

The loop's guard is higher than the picture's (the lead fist between the eyes and the nose rather than at the nose, the rear fist at the nose rather than the chin), though lower than the eyebrow-high guard of the loop it replaced: a Thai high guard.

**On a wide stage.** As in the boxer shell's front view, the near foot in the Muay Thai guard's front view, his planted rear foot, reaches row 709 of 720, counting the shaded undersides of the toes, so that view also takes the whole trim from the empty top and shows rows 80 to 720 (`src/components/UnrealClipStage.css`); the athletes' heads start at row 105. The side view keeps the usual trim (rows 56 to 696: its heads start at row 138 and its feet reach row 626), and a narrower stage shows the whole picture.

How it was made and checked, and what the render's notes say of it, is in [The Muay Thai guard's loop (motion capture)](unreal-integration.md#the-muay-thai-guards-loop-motion-capture). In short: Claude rendered both views in Unreal Engine 5.8.4 in the dojo set, the encoder proved the seam, and every frame of both views was looked at, by the operator who rendered them and by two reviewers, who had judged every frame of the previews too and passed both views. The owner has not seen it yet.

## The stances that keep their loops

Capoeira, karate, sumo and sambo keep the loops published before, each a pose held nearly still:

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
- `tools/test_stance_picker.mjs` works out what each stance should play from `stanceLoop`, and which camera buttons the stage shows from the views published for that clip. It also checks every stance whose loop has a front view, and expects exactly these: the wrestling stance, sumo base, the boxer shell, the Muay Thai guard and the sambo crouch. For each it plays the side view, then the front view, then the side view again, each to the end of its loop and on into the next, and at 1440 by 900 it works out which rows of the clip the picture box shows. They must run from 10 rows above the highest head to 6 rows below the lowest foot, as measured on that view's own file (`MEASURED_ROWS`, which names each file by its SHA-256), with the usual trim, or with the trim from the top where the feet reach below row 690. So a new take of any view of those stances, or a front view for another stance, fails the suite until its rows are measured on its decoded frames and added there; if its feet reach below row 690, the rule in `src/components/UnrealClipStage.css` has to cover it too, and its heads must not start above row 90.
- `tools/test_match_moments.mjs` expects the karate loop in the side view only (its test bundle checks that a loop without a front view shows from the side, with no camera buttons and no greeting), and checks in the release build that there is no greeting over the boxer shell's or the Muay Thai guard's loop seen from the front, which it expects to be published. A front view of the karate loop, or a boxer shell or Muay Thai guard without one, has to be followed there.
