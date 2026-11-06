# JiuQuest gi material source

The normal and roughness textures in `Fabric042/` are the 1024 × 1024 maps from **ambientCG Fabric 042**, created by Lennart Demes. They are used with a neutral garment tint, authored garment geometry and cloth folds.

- Asset: https://ambientcg.com/view?id=Fabric042
- Official download: https://ambientcg.com/get?file=Fabric042_1K-JPG.zip
- License: CC0 1.0 Universal — https://docs.ambientcg.com/license/
- Retrieved: November 5, 2026
- Source archive SHA-256: `ef8e1aa03596214d02c5ad8bd257d5f0f5c01e875f9e1c45c5c60796c2cc9139`

The asset publisher explicitly permits commercial use and redistribution of raw asset files. No software from the source archive is executed or distributed. The optional source preview and color map are authoring references; only the normal/roughness maps are used by the neutral, recolorable gi materials.

The garment mesh is authored in `tools/realistic_gi.py`. It uses skinned cloth panels, open sleeves, loose trousers and a flat belt; it does not copy the athlete's skin surface.

The character-detail refinement adds rolled lapel faces, narrow lapel seams,
cuff and hem bands, and softly raised shoulder reinforcement to the existing
jacket mesh before its body-weight transfer. Broader waist/elbow folds and
knee/cuff relief are shaped into the garment surfaces. These are authored
geometry changes using the existing cotton material slots and texture maps;
they add no rigid chest attachments, extra texture downloads or cloth simulation.
The paired rig and choreography remain unchanged. Generated assets still require
the normal pose, vertex-budget and browser checks before release.
