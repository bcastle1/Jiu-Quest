# JiuQuest realistic athlete source

This directory contains redistributable **CC0 character output and texture
derivatives**, not the MPFB add-on. The app and normal animation regeneration do
not require MPFB. Final paired assets always clothe both athletes.

## Provenance

- Human generated with [MPFB 2.0.18](https://extensions.blender.org/add-ons/mpfb/versions/)
  using the MakeHuman core base and targets. The tool is GPL; its core assets
  and generated human output are CC0. See the official [license split](https://static.makehumancommunity.org/about/license.html)
  and [closed-source use guidance](https://static.makehumancommunity.org/mpfb/faq/use_in_closed_source.html).
- Official [MakeHuman system asset pack](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html):
  young Caucasian male skin, low-poly brown eyes, eyebrow001, short02, short04,
  and ponytail01. All selected assets are listed as CC0 by their publisher.
- Pack downloaded from the official secondary mirror:
  `https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip`.
  SHA-256: `b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107`.
- MPFB add-on archive SHA-256:
  `c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad`.
  The add-on archive/code is outside this repository and is not distributed.
- The stable 65-bone rest rig comes from the existing Quaternius Universal Base
  Characters CC0 source in `../universal-base-characters/`.
- Woven normal/roughness derivatives come from ambientCG Fabric042 CC0. The
  original maps and separate provenance remain in `../jiuquest-gi/Fabric042/`.

`source-manifest.json` records selected original texture hashes. Geometry is an
athletic adult male generated from macro parameters gender1, age.32, muscle.68,
weight.48, height.50, proportions.50; ancestry blend .55/.20/.25 is a fictional
character design, not a representation of any real person. Its native53-bone
game rig was fitted to the existing65-bone rest skeleton with weighted local
limb transforms, a smooth torso height map and shape-preserving head/palm
transforms. Original paired motion therefore keeps the same bone contract.

## Browser asset preparation

`athlete-cc0.blend` is Blender5.2 output with relative image paths and no add-on
dependency. It contains the fitted human, eyes, eyebrows, three original hair
meshes, and the stable rig. Maps are shared across both athletes. Skin remains
2K JPEG quality93; eyes256 JPEG; brows256 PNG; hair512 PNG; fabric normal512
JPEG and roughness256 JPEG. Original source files were not overwritten.

The generator adds independent uniforms and accessories, removes covered skin
only after garments have sampled the full body, and normalizes the strongest
four skin influences. Source geometry, maps and original reference values in
`material-reference.json` remain unchanged.

## Action-anime derivative

`../../anime_fighter.py` applies a deterministic rest-space warp to the fitted
adult face and eyes: wider eye sockets, a modestly larger cranium and a narrower
chin. The same warp keeps the face, eyeballs, eyebrows and hair fitted together.
The body proportions below the neck, 65-bone rig, four-influence skinning and
paired choreography are retained.

Hair and eyebrows in the runtime assets are new JiuQuest-authored solid meshes.
Crew and Spikes have swept clumps and a three-lock fringe; Slick sweeps back;
Mohawk has a narrow crest; Long uses a tied ponytail and face-framing locks.
Bald hides hair while retaining the brows. These meshes use opaque cosmetic
colors without additional textures or alpha overdraw. They are created during
export; the original source scalp/hair/brow meshes in the blend are not edited.

The next character-detail authoring pass gives those hair locks flattened
cross-sections oriented along each curve, asymmetric crest heights and short
temple locks. Existing style names, shared opaque hair materials and Head-bone
weights are preserved. No new hair textures or third-party assets are introduced.
The fitted source face, eye geometry and covered-body mask remain unchanged.

The final pair now shares **four embedded images**: skin 2K JPEG, eyes 256 JPEG,
cotton normal 512 JPEG and roughness 256 JPEG. Skin keeps its measured
`_Ref_RRGGBB` suffix for linear-light tinting. The runtime cel shader suppresses
skin texture variation while retaining the eye texture and cloth detail.
All runtime materials are opaque. No third-party requests or paid assets are
introduced by this derivative.

## Regenerate

Run Blender5.2 from the repository root:

```powershell
& '<Blender executable>' --background --python-exit-code 1 --python tools/generate_paired_bjj_glbs.py
```

Set `JQ_MOVE=rear_naked_choke` (or another canonical ID) to regenerate exactly one
clip. No internet access, account, MPFB add-on, or paid asset is required.
Run `node --test tests/unityAssets.test.js` afterwards, then the glTF validator
and the actual Unity/browser review before packaging.

These are authored choreography drafts, not motion capture or coach-approved
instruction. Natural anatomy does not establish technical correctness; final
techniques still require qualified BJJ review.
