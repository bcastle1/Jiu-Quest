# Background music

JiuQuest plays two kinds of background music:

- **Its own tracks**, listed in `defaultMusicTracks` in `src/storage.js`. Their files are in
  `public/assets/audio`. An admin can add, hide and point tracks to hosted files.
- **Licensed songs**, bought for the game. Each has three intensity levels of the same
  length: low, medium and full.

Music keeps playing while the player moves between screens. Only the music switch in the
header starts and stops it.

## The soundtrack

When a build carries licensed songs, the game has a soundtrack: each screen plays its own
song at its own intensity. The table is `PAGE_SOUNDTRACK` in `src/audio/musicLibrary.js`.

| Screen | Song | Intensity |
|---|---|---|
| Overview (home) | Fist Fight | medium |
| Profile and fighter creation | In The Storm | full |
| Training and the Lab | Sneak Attack | low |
| Arena | Binder | full |
| Any other screen | the home song | medium |

A change of screen crossfades to the next song. A song the player comes back to starts at
the place it would have reached had it played all along, so it never restarts. A build
that lacks one of these songs plays its first licensed song on that screen.

## What the player can choose

The track menu in the header lists the soundtrack, the licensed songs and the game's own
tracks.

- **JiuQuest soundtrack** puts the game in charge: a song for each page.
- **A song** plays in place of the soundtrack. A licensed song plays at the intensity of
  the screen the player is on. The game's own tracks keep the levels they always had (they
  set the tempo of the synth pulse): full in the Arena, medium in Training, low elsewhere.
- **Keep my song on every page** decides how long a picked song lasts. Ticked (the way it
  comes), the song plays on every screen and is saved as the player's choice. Unticked,
  the song lasts until the player changes screen, then the soundtrack is back; such a pick
  is not saved. Changing the option carries the song that is playing over to the new rule.

The first time a device sees licensed music, the soundtrack is selected. After that the
player's own choice stands. The choice and the option are saved with the rest of the
player's settings on the device. A build without licensed music (a fork, an old release)
leaves a saved soundtrack or licensed song alone and plays its first own track meanwhile,
so the choice is still there when the music is back. A saved track that no longer exists
is replaced by the soundtrack.

## Licensed audio is never in this repository

The licence allows the music in the game. It does not allow the audio to be handed out on
its own, and it asks that the files be part of the game and kept out of public
repositories. This repository is public, so:

- No licensed audio is committed, original or converted. `public/assets/audio/licensed/`
  is git-ignored, and so is any `.jqm` file anywhere. `tests/musicEngine.test.js` checks
  the ignore rules and that git tracks no pack. The two tools refuse to write music into
  the repository anywhere but that folder.
- The site carries licensed songs as **packs** (`.jqm`): the prepared audio, scrambled, so
  a pack is not a playable audio file until the game unpacks it (`src/audio/musicPack.js`).
  This is not protection; it keeps the files from being ordinary audio files on the server.
- A build finds the packs in `public/assets/audio/licensed/` together with an `index.json`.
  A build without that folder works and offers the game's own tracks only.

The deploy (`.github/workflows/deploy-pages.yml`) fetches the packs from the private
repository `bcastle1/jiuquest-music` (folder `packs`) with a read-only deploy key, stored
as the secret `MUSIC_DEPLOY_KEY`, places them, and runs `tools/check_licensed_music.mjs`,
which fails unless every song the index lists is complete and acceptable to the game.
Without the secret the step is skipped on a fork or a pull request. A release of the site
itself stops instead: it must not go out without its music.

## From a bought pack to the site

The originals stay on the owner's computer, outside the repository.

1. **Prepare loops.** `node tools/prepare_music_loops.mjs --pack <extracted pack> --out <folder outside the repo> --ffmpeg <ffmpeg bin folder>`
   Each song in a pack is a whole-bar loop followed by a reverb tail that fades to
   silence. The tool mixes the tail back onto the start of the loop, which makes the loop
   seamless, and writes one MP3 per intensity holding the last half second of the loop,
   the loop, and its first half second. It checks every loop point and reports the result.
2. **Pack the songs the site should carry.** `node tools/pack_licensed_music.mjs --from <prepared folder> --songs fist-fight,in-the-storm,sneak-attack,binder --collection "Hyper Action"`
   This writes the packs and `index.json` into `public/assets/audio/licensed/`, wherever it
   is run from. The folder then holds exactly the songs named: packs of other songs are
   removed. The songs appear in the track menu in the order given. A song the soundtrack
   names must keep its id (the name of its prepared folder).
3. **Publish.** Replace the contents of the `packs` folder in the private music repository
   with the contents of that folder. The next deploy carries them.

## How the game plays a licensed song

`src/audio/musicEngine.js` decodes the pack of the level it needs and loops the region
from the half-second mark to the half-second mark plus the loop length, with a Web Audio
buffer source. The sound on both sides of each loop point is the same repeating signal,
so the loop is seamless whatever delay a browser's decoder adds.

Every song has its own clock, started the first time it is heard after the music is
turned on. Another level of the same song starts at the place the clock has reached and
the two crossfade over 1.6 seconds. Another song fades in over 0.8 seconds while the one
before it fades out over 1.2 seconds. If the next song cannot be fetched, the current one
keeps playing and the engine tries again every few seconds, five times, while that song is
still wanted. If the first song cannot be fetched, the music switch goes off with a message.

With the music off the audio context is suspended after a second, and the press that
turns music on wakes it. On an iPhone the page declares itself a media player, so the
music is heard with the ring switch off, as a hosted file always was.

While the soundtrack plays, the packs of the other screens are fetched ahead, one after
another, so a change of screen only has to decode. Fetched packs are small (about 2 MB)
and up to twelve are kept; decoded audio is large (about 35 MB for a 90 second song) and
at most two decoded levels are kept.

`src/audio/musicLibrary.js` holds the rules: the soundtrack table, which tracks a player
is offered, and what should be playing given the screen, the saved choice and a pick made
for one screen.

`tools/vite_licensed_music.mjs` reads `index.json` when the site is built and writes the
list into the bundle. Only songs whose three packs are present are listed.

## Checks

- `tests/musicEngine.test.js`: the pack format, the soundtrack and track rules, the build
  plugin, the deploy steps and the engine against a stand-in for Web Audio.
- `tools/test_music_engine.mjs`: the built site in a browser, muted, with test tones packed
  the same way as licensed songs and carrying the ids the soundtrack names. It also works
  the track menu by keyboard and, at a phone size, by touch. When the build
  carries licensed music, its own home and Arena songs are loaded and checked too. Nobody
  listens in these checks: they measure loop regions and timing, not how the music sounds.
