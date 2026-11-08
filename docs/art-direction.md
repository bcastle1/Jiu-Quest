# JiuQuest combat art direction

Erik's direction is a detailed game presentation inspired by Solo Leveling's anime theme and the texture/detail standards of Skyrim and Fortnite. The chosen treatment is an original dark-fantasy anime dojo with readable martial-arts athletes.

## Current studio refinement

Arena playback and supported 1 vs 1 training previews share the same Unity athlete materials and indoor studio. The current pass uses a lower overhead key with broader neutral fill and indirect bounce to reveal faces and dark gis. Reduced cotton normal strength and specular weight retain authored seams, maps and silhouette without making the weave appear crumpled or glossy. The mat uses shallower relief and narrower, lower-contrast edge wear so its grid stays behind the grappling action.

Keep the existing two-pass fighter rendering, three studio lights, cosmetic references, shadow ownership and camera cutaways. The studio lighting refinement adds no asset downloads or extra render passes. Review both athlete roles in standing, takedown and ground poses before release. Choreography remains a draft pending coach review.

The next preview adds restrained cotton fiber scatter driven by the existing key light and cast shadow. Skin, eyes, hair and embroidered patches retain their own response. Close-up uses a tighter 92 percent fit of the measured pose envelope; ordinary study cameras retain their existing framing. Continuous original stroke lettering replaces the pixel-grid studio signs, sharing the existing wall materials and cutaways without font assets or textures.

Erik's November 7 character reference calls for more defined adult anatomy, faces and hands, and visible garment tension and compression folds. Use it for character fidelity, not its background, costumes, tattoos, characters or choreography. Keep the BJJ gis and current indoor studio. Prioritize original modeled belt tension, elbow/cuff and knee folds plus panel-aligned surface relief over further background decoration. Review a standing pilot in the actual Unity player before replacing the full motion library; then inspect grounded poses and both athlete roles. Facial changes must move skin and eyes through the same continuous field and refit brows to the resulting face. Keep the existing hair attachment when the additional shaping is confined to the face.

## Adult face and folded gi candidate

The current candidate shapes the actual chin and lower mandibular silhouette, which the earlier front-face cutoff left untouched. A forward chin plane, broader lower jaw and restrained bridge/cheek transition give the original athlete a stronger adult profile. The approved six-millimeter base warp is retained; the additional supported shaping has a ten-millimeter combined source-to-final cap. Measured maximum displacement is 8.835 millimeters. The shared continuous field moves skin and eyes, and brows are refitted to the final skin. Source checks cover 13,380 body vertices, 96 eye vertices and 26,928 triangles with no flipped or degenerate triangles. All 10,257 protected body samples, including substantial neck-weighted vertices, remain unchanged; hair deformation is exact, eye-aperture visibility is unchanged and brow clearance remains about 1.2 millimeters. These establish bounded rest geometry, not every-frame contact.

The lapel now has a broad folded face and tighter turned edges instead of a rounded rail. Its combined crown relief is bounded to 6.8 millimeters and blends back to the existing section at the neckline and tied waist. Twelve samples across the panel resolve the edge turns while preserving the opening trajectory, overlap and UVs. Sleeves use an area-normalized, gently squared section to suggest supported cotton panels, with the new section adjustment capped at seven millimeters before body fitting. The earlier top/lateral shaping is replaced, retaining shoulder fitting and the loose underside. The construction review found no reversed or degenerate lapel faces, unchanged openings/cuffs and approximately six-millimeter sampled sleeve clearance. Changed lapel samples retain at least 12.35 millimeters of clearance; four buried neckline samples are unchanged from the baseline. These measurements concern sampled rest surfaces, not inner solidified surfaces or animated contact.

Retain the existing torso tension fans, panel-aligned fold normals and cuff-reaching trouser drapes. Trouser fitting establishes garment ease before applying fold relief, with a nine-millimeter radial floor; saved pre-deformation panel coordinates keep the modeled folds aligned with their surface detail. Both athletes share the existing seven embedded images, including the original numeric skin roughness atlas. Texture content, cosmetic tint behavior, rendering passes and the runtime shader are unchanged. All folds are modeled and baked, without live cloth simulation.

All 16 regenerated clips retain the exact PR #10 animation channels, rest rig and inverse bind data. The 250 local checks and 24 packaged-file checks pass. A three-clip pilot covered standing, rear naked choke and armbar. Fresh final-build review covers desktop standing/close-up and completed ground playback, plus completed reversed-performer black/gray takedown playback at a measured 390-by-844 viewport with no horizontal overflow or console errors. The 16 clips total 138,009,744 bytes; the largest is 8,675,176 bytes, below the existing 9 MiB cap. Hosted checks and physical-phone performance remain separate. This is incremental progress toward the right-hand reference's sculpted character fidelity; publication requires separate approval.


## Visual targets

- Adult athletic silhouettes, angular cheek and jaw planes, expressive upper lids and layered asymmetric hair. Preserve customization and recognizable body mechanics.
- Distinct cotton panels, reinforced seams, woven belts and tonal hair strands. Large shapes establish the design before fine surface detail.
- Weathered basalt, cedar and bronze with different color and roughness responses. Cool blue-violet atmosphere contrasts with restrained warm lighting; faces, kit colors and mat contacts stay readable.
- Subtle environment movement follows the combat clock. Pause and reduced-motion study freeze the scene; no camera shake or flashing is needed.
- Keep the central mat clear. Detail belongs to materials, architecture and background depth, with no decorative effects hiding grips or feet.

## Review criteria

Review actual Unity browser captures and playback at desktop and 390-pixel phone widths. Inspect white and dark gi, all hair silhouettes, standing and grounded poses, tint behavior, surface seams and silhouette framing. Verify rig and motion contracts separately from art quality. Record downloads, rendering limits and remaining physical-device uncertainty with each preview.

Use a standing pilot before regenerating the complete clip library. Preserve an earlier verified package for comparison. A polished concept image does not establish in-game appearance.

## Reference material

Official [Solo Leveling character art and key visuals](https://www.crunchyroll.com/news/guides/2024/1/6/solo-leveling-anime-trailer-characters-cast-more) and [Bethesda's Skyrim screenshots](https://elderscrolls.bethesda.net/en-US/skyrim10/buy-now) provide visual references. Epic describes the use of painted texture, specularity and fine patterning for garments in its [Fortnite art-production example](https://www.unrealengine.com/spotlights/balenciaga-blurs-real-with-unreal-in-fortnite?lang=en-US). These are references for original JiuQuest art; franchise characters, logos and texture assets are not imported.
