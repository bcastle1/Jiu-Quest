"""Import pre-rendered Unreal technique clips into the site.

Reads the render pack's clips/technique-clips.json, checks every video against
that manifest and against what the site can play, then:

  - copies each MP4 unchanged to public/assets/unreal-clips/<move>/<performer>-<camera>.mp4
  - encodes each lossless poster as a smaller lossy WebP beside it
  - writes src/unreal/techniqueClips.data.js, which pins every published file

An entry marked "draft": true is left out and listed in the summary.

Usage:
    python tools/import_unreal_clips.py <Unreal-render-pack/clips>

The render pack is not in this repository. Requires Pillow, and ffprobe on PATH.
"""
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys

from PIL import Image

PUBLIC = pathlib.Path("public/assets/unreal-clips")
DATA = pathlib.Path("src/unreal/techniqueClips.data.js")
NAME = re.compile(r"^[a-z][a-z_]*$")
PERFORMERS = ("fighter", "opponent")
CAMERAS = ("side", "front")
POSTER_QUALITY = 82


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def probe(path):
    """What the file actually contains, read by ffprobe with every frame counted."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-show_entries",
         "stream=codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_read_frames", "-of", "json", str(path)],
        check=True, capture_output=True, text=True).stdout
    streams = json.loads(out)["streams"]
    video = [stream for stream in streams if stream["codec_type"] == "video"]
    if len(video) != 1 or len(streams) != 1:
        raise SystemExit(f"{path.name}: expected one video stream and nothing else, found {[s['codec_type'] for s in streams]}")
    stream = video[0]
    rate = [int(part) for part in stream["r_frame_rate"].split("/")]
    data = path.read_bytes()
    return {
        "codec": stream["codec_name"], "profile": stream["profile"], "pixelFormat": stream["pix_fmt"],
        "width": stream["width"], "height": stream["height"], "fps": rate[0] / rate[1], "frames": int(stream["nb_read_frames"]),
        # A browser can start playing before the whole file arrives only if the index comes first.
        "faststart": 0 <= data.find(b"moov") < data.find(b"mdat"),
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    source = pathlib.Path(sys.argv[1])
    entries = json.loads((source / "technique-clips.json").read_text(encoding="utf-8"))
    seen, clips, held = set(), [], []
    for entry in entries:
        # A draft is a take its maker lists a visible flaw in. It waits for the
        # owner and never blocks the files around it.
        if entry.get("draft"):
            held.append(entry["file"])
            continue
        move, performer, camera = entry["moveId"], entry["performerSide"], entry["camera"]
        key = (move, performer, camera)
        if not NAME.match(move) or performer not in PERFORMERS or camera not in CAMERAS or key in seen:
            raise SystemExit(f"unexpected or repeated clip {key}")
        seen.add(key)
        stem = f"{move}/{performer}-{camera}"
        if entry["file"] != f"{stem}.mp4" or entry["poster"] != f"{stem}.webp":
            raise SystemExit(f"{key}: file names do not follow <move>/<performer>-<camera>")

        video = source / entry["file"]
        if video.stat().st_size != entry["bytes"] or sha256(video) != entry["sha256"]:
            raise SystemExit(f"{entry['file']} is not the file its manifest describes")
        found = probe(video)
        expected = {"codec": "h264", "profile": "High", "pixelFormat": "yuv420p", "width": entry["width"], "height": entry["height"],
                    "fps": float(entry["fps"]), "frames": entry["frames"], "faststart": True}
        if found != expected:
            raise SystemExit(f"{entry['file']}: found {found}, expected {expected}")
        if abs(entry["frames"] / entry["fps"] - entry["durationSeconds"]) > 0.001:
            raise SystemExit(f"{entry['file']}: duration does not match its frame count")

        poster_source = source / entry["poster"]
        poster = Image.open(poster_source).convert("RGB")
        if poster.size != (entry["width"], entry["height"]):
            raise SystemExit(f"{entry['poster']}: poster and video sizes differ")

        target = PUBLIC / f"{stem}.mp4"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(video, target)
        poster_target = PUBLIC / f"{stem}.webp"
        poster.save(poster_target, "WEBP", quality=POSTER_QUALITY, method=6)

        clips.append({
            "moveId": move, "performerSide": performer, "camera": camera,
            "video": f"/assets/unreal-clips/{stem}.mp4", "bytes": entry["bytes"], "sha256": entry["sha256"],
            "poster": f"/assets/unreal-clips/{stem}.webp", "posterBytes": poster_target.stat().st_size, "posterSha256": sha256(poster_target),
            "posterSourceSha256": sha256(poster_source),
            "width": entry["width"], "height": entry["height"], "fps": entry["fps"], "frames": entry["frames"],
            "durationSeconds": entry["durationSeconds"], "loops": bool(entry["loops"]),
            "choreographyReviewed": bool(entry["choreographyReviewed"]),
        })

    clips.sort(key=lambda clip: (clip["moveId"], PERFORMERS.index(clip["performerSide"]), CAMERAS.index(clip["camera"])))
    lines = ["// Generated by tools/import_unreal_clips.py from the Unreal render pack's", "// clips/technique-clips.json. Do not edit by hand: rerun the tool.",
             "export default Object.freeze(["]
    lines += [f"  Object.freeze({json.dumps(clip)})," for clip in clips]
    lines += ["]);", ""]
    DATA.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(json.dumps({"clips": len(clips), "moves": sorted({clip["moveId"] for clip in clips}), "draftsLeftOut": held,
                      "videoBytes": sum(clip["bytes"] for clip in clips), "posterBytes": sum(clip["posterBytes"] for clip in clips)}, indent=2))


if __name__ == "__main__":
    main()
