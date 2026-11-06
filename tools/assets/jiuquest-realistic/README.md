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
four skin influences. Mohawk and restrained spiky variants are authored
derivatives of the CC0 Crew scalp. Long uses the long ponytail, Slick uses
short04, and Bald hides hair while retaining separate eyebrows.

Skin/Hair/Brows material names encode their measured source sRGB color using
`_Ref_RRGGBB`. Runtime tint is applied as a ratio in linear light; eyes keep
their authored texture. Hair and brows use MASK with cutoff0.5, not alpha
blending. Skin references use median cheek UV samples; hair references use
median opaque texture pixels. Reference values are recorded in
`material-reference.json`.

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
