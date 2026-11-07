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
chin. The face, eyeballs and hair share that warp; brow/lid strips are fitted
to the resulting face surface afterward.
The body proportions below the neck, 65-bone rig, four-influence skinning and
paired choreography are retained.

Hair and eyebrows in the runtime assets are new JiuQuest-authored solid meshes.
Crew and Spikes have swept clumps, with three- and four-lock fringes respectively; Slick sweeps back;
Mohawk has a narrow crest; Long uses a tied ponytail and face-framing locks.
Bald hides hair while retaining the brows. These meshes use opaque cosmetic
materials without alpha overdraw. They are created during
export; the original source scalp/hair/brow meshes in the blend are not edited.

The next character-detail authoring pass gives those hair locks flattened
cross-sections oriented along each curve, asymmetric crest heights and short
temple locks. Existing style names, shared opaque hair materials and Head-bone
weights are preserved. That pass retained the covered-body mask and source blend.

The prior reviewed pair shared four embedded images: skin 2K JPEG, eyes 256 JPEG,
cotton normal 512 JPEG and roughness 256 export. Skin keeps its measured
`_Ref_RRGGBB` suffix for linear-light tinting. The runtime fighter shader retains
80% of referenced skin texture variation and the complete eye/cloth detail.
Its continuous URP light response uses authored roughness and restrained
material-specific highlights; this runtime change does not alter the GLBs.
All runtime materials are opaque. No third-party requests or paid assets are
introduced by this derivative.

## Original illustrated surface pass

`../../original_surface_maps.py` authors two additional neutral RGB PNG maps:
a 512px cloth construction atlas and a 256px root-to-tip hair paint map. They
are original mathematical game-asset artwork, not edits of the source skin
photograph or copies of a franchise costume. The original face and eye rasters
remain unchanged. The texture filenames contain the recipe source SHA-256
prefix; changed recipes cannot silently reuse an older derivative.

The cloth map places panel seams, reinforcement, piping, sparse stitching and
an original split-summit embroidered mark. Its UV1 coordinates are independent
of the existing repeating cotton UV0 normal/roughness maps. Hair gains UV0
coordinates following each solid lock, painted tonal planes and strand grooves,
and additional short layered blades around the sides/back. No alpha cards,
extra material slots, renderers or physics are added. Neutral atlas materials
use white source factors so the existing cosmetic tint is applied once; belt
colors and earned stripe visibility retain their existing semantics.

The face warp retains an adult athlete, with a more tapered jaw, restrained
cheek planes, narrower eye height and slightly raised outer corners. Thin
upper-lid accents join the brow mesh after projection onto the finished face.
These are geometry changes only; no facial photograph is modified.

The original illustrated-surface pass used six shared embedded images and added
1,946 vertices per athlete. Its largest paired clip was 6,614,380 bytes, below
the 7 MiB cap. After
desktop and phone pilot review, the measured maximum increase of 885,824 bytes
was accepted in place of the initial 0.6 MB target to retain the useful surface
detail without bespoke binary packing. Full-library motion, cosmetic and
browser checks remain required before release; these sizes alone do not prove
physical-phone performance or the quality of every contact pose.

## Hero silhouette and garment refinement

The subsequent head pass uses tapered six-sided locks with deliberate normal
breaks, a slimmer scalp shell fitted to the source head, and three separated
ponytail strands. The adult face has less eye-height expansion and restrained
cheek, nose-bridge and chin planes. Densely sampled brow/lid ribbons are projected
onto the finished face, with a small normal clearance; unfitted strips are
omitted as a whole instead of leaving disconnected dark segments. All five hair
slots and bald behavior remain available.

The layered-hair refinement adds eight broad swept ridges to the fitted scalp,
an irregular edge and style-specific hairlines. Crew retains a short fringe;
Spikes has a longer asymmetric fringe. Slick and Mohawk roots overlap the scalp
instead of sitting above it as a separate crest, and Long has wider forward
face-framing locks. Existing face/brow geometry, the hair UV mapping scheme,
opaque materials and Head-only skinning are retained; no new map or renderer
is introduced.

The latest reference pass narrows the lower hair cap, raises the side hairline
around the ears and shapes the nape. Seven overlapping closed rear locks replace
the exposed bowl-like silhouette with swept layers. Face, eye and eyebrow meshes
remain unchanged. Hair still uses the same opaque map and Head-only weighting.

The gi has slimmer upper sleeves and directional compression folds instead of
complete padded rings. The separate shoulder reinforcement shells are removed;
shallow sewn lines sit on the sleeve surface. Lapels taper toward the tied waist,
the unbelted hem hangs slightly, and knee reinforcement stays nearly flush.
The cloth construction atlas replaces heavy panel borders with fine stitching;
its layout, neutral tint reference and cotton normal/roughness maps are retained.
The recipe-derived hair filename changes, but its image payload is unchanged.
Sleeve rest-body clearance is
checked during export, but does not establish collision-free animated contact.
The existing cloth UV islands, color and stripe controls remain.
The exported cloth normal scale is reduced to keep the weave from reading as
padding. Its linked roughness map remains authoritative. Hair uses a restrained
runtime specular response so its painted planes do not sparkle like plastic.

Small dorsal knuckle and tendon relief is sculpted into existing hand vertices.
It adds no geometry or maps and leaves palm contact surfaces, wrist seams,
topology, UVs and weights unchanged. The rest-mesh safety check measured a
maximum 2.283 mm displacement; skinned poses still require visual review.

The following detail pass adds compact adult face shaping around the jaw,
chin, cheeks, bridge and brow. Its new offset is exactly zero outside the
bounded front-face region and capped at 6 mm. Skin, eyes and fitted lid anchors
share the offset; hair keeps the exact previous warp. Brows taper toward their
outer ends. This modifies solid geometry without adding maps or expressions.

Finger sides and palm backs receive bounded fullness on the existing mesh;
the additional hand offset is capped at 2.1 mm. The original underside/contact
vertices and the 35 mm wrist exclusion remain fixed. Finger bone lengths,
joint centers, skin weights and UVs are retained. The latest lapels use shallow
integrated stitching instead of four separate raised ribbons, with restrained
longitudinal sleeve folds and cuff edges. These rest-mesh checks do not prove
collision-free contact across every animated frame.

The covered-skin mask no longer exempts every rest-pose vertex above 1.49 m:
that height also includes the upper arms in the source T pose. The existing
head/neck, hands/feet and V-shaped chest-opening masks are retained. The source
comparison removes 259 covered vertices and 213 quads while preserving all
10,072 explicitly exposed vertices, surviving positions, UV corners, skin
weights and faces. Boundary normals are recalculated. This targets sleeve
intrusions without enlarging the garment; animated contact still needs review.

Original skin/eye photographs, the source blend, the 65-bone rest skeleton,
inverse binds and motion channels remain unchanged. Exported geometry and
normals change, so every release requires fresh clip-contract and actual Unity
rendering checks. Current sizes and visual evidence belong to the dated release
records, not the historical size figures above.

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

Ready-hand presentation uses the existing finger joints in standing stance, grip
fighting and reset-neutral only. Curl axes are derived from the anatomical palm
direction in the source T pose, including the differently oriented thumb bones.
Finger lengths, wrist poses and the other thirteen motion clips are protected.
The loose curl is an authored visual gesture, not a contact-aware cloth grasp.

Sleeve and cuff grids now weld their coincident longitudinal endpoints before
Solidify, after assigning deform groups. Per-loop UV coordinates stay split at
the texture seam. This removes duplicated internal wall faces and gives the
seam continuous surface normals without enlarging the outer garment.

The athletic-fit pass lowers the jacket crown by 20 mm and narrows its upper
envelope. Upper sleeves lose up to 8 mm of radius with a 3 mm top-only drop,
fading before the buried armhole and cuffs. The existing clearance bounds stay
in force. Broad chest relief remains part of the fabric surface.

Existing skin vertices receive bounded neck/lower-jaw, pectoral and distal
forearm definition. Joint lengths, wrist and palm contact regions, source UVs,
weights and all animation keys remain unchanged. The covered-body mask also
removes covered shoulder skin outside the 80 mm neck column below 1.59 m;
the head, actual neck column, open chest, hands and feet retain visibility.
Export verification checks that retained skin vertices keep their UV/weight
correspondence and that surviving triangles preserve their winding.
