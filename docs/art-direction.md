# JiuQuest combat art direction

Erik's direction is a detailed game presentation inspired by Solo Leveling's anime theme and the texture/detail standards of Skyrim and Fortnite. The chosen treatment is an original dark-fantasy anime dojo with readable martial-arts athletes.

## Current studio refinement

Arena playback and supported 1 vs 1 training previews share the same Unity athlete materials and indoor studio. The current pass uses a lower overhead key with broader neutral fill and indirect bounce to reveal faces and dark gis. Reduced cotton normal strength and specular weight retain authored seams, maps and silhouette without making the weave appear crumpled or glossy. The mat uses shallower relief and narrower, lower-contrast edge wear so its grid stays behind the grappling action.

Keep the existing two-pass fighter rendering, three studio lights, cosmetic references, shadow ownership and camera cutaways. The studio lighting refinement adds no asset downloads or extra render passes. Review both athlete roles in standing, takedown and ground poses before release. Choreography remains a draft pending coach review.

The next preview adds restrained cotton fiber scatter driven by the existing key light and cast shadow. Skin, eyes, hair and embroidered patches retain their own response. Close-up uses a tighter 92 percent fit of the measured pose envelope; ordinary study cameras retain their existing framing. Continuous original stroke lettering replaces the pixel-grid studio signs, sharing the existing wall materials and cutaways without font assets or textures.

Erik's November 7 character reference calls for more defined adult anatomy, faces and hands, and visible garment tension and compression folds. Use it for character fidelity, not its background, costumes, tattoos, characters or choreography. Keep the BJJ gis and current indoor studio. Prioritize original modeled belt tension, elbow/cuff and knee folds plus panel-aligned surface relief over further background decoration. Review a standing pilot in the actual Unity player before replacing the full motion library; then inspect grounded poses and both athlete roles. Facial changes must move skin and eyes through the same continuous field and refit brows to the resulting face. Keep the existing hair attachment when the additional shaping is confined to the face.

## Cheek planes and collar tension candidate

The current candidate adds a broad diagonal transition beneath the cheekbone and a shallow crease beside the nasal ala, fading before the mouth corner. It refines cheek-to-muzzle separation without enlarging the approved jaw, chin or lips. The continuous skin/eye field retains the ten-millimeter combined cap; 282 source body vertices change by at most 2.111 millimeters, and maximum total displacement remains 8.835 millimeters. Eyes, brows, mouth/chin and protected neck, ear and scalp samples remain unchanged; hair deformation is exact. The rest-source audit finds no flipped or degenerate triangles, unchanged eye-aperture visibility and approximately 1.2-millimeter brow clearance. The visual gain is restrained, with a slightly leaner lower cheek rather than a new expression.

Short, unequal diagonal fold fans now connect the collar overlap toward the armholes, suggesting fabric held between collar and belt. The same field drives modeled relief and panel-aligned fold normals. Dense sampling measures at most 3.574 millimeters of added collar tension and 8.580 millimeters for the combined torso fold field, within its existing 11.5-millimeter bound. Actual torso vertex movement reaches 4.689 millimeters after the existing panel construction. Opening, back, hem and neck samples remain fixed, as do lapels, sleeves, cuffs, belt panels and UV coordinates. The source audit finds no reversed or degenerate torso triangles or newly penetrating sampled vertices; two pre-existing near-armhole samples remain slightly inside the original full body. These are rest-surface checks, not a guarantee of every-frame contact.

Keep the existing seven shared images, skin response, cosmetic tint behavior, rig, animation and rendering passes. Regenerated cloth surface maps follow the new fold field; no new map or runtime shader is added. Folds remain modeled and baked, without live cloth simulation.

All 251 local checks pass: 103 JavaScript, 136 Unity, nine fabric and three skin tests. Independent full-library review confirms exact rig, rest and animation data across all 16 clips, and the packaged release matches all 24 expected files. The clips total 138,232,592 bytes; the largest is 8,689,104 bytes, below the 9 MiB cap. The three-clip pilot covered standing/close-up, rear naked choke and armbar finishes. Fresh final-build review at 1440 by 1100 covers standing Side, settled Close-up and rear naked choke playback through 100 percent. A 390-by-844 phone viewport covers reversed-performer black/gray double-leg playback through 100 percent; measured client and scroll widths are both 375 pixels, with no horizontal overflow or console errors. Hosted checks remain separate. Physical-phone performance and every-frame cloth contact remain unverified. This is incremental progress toward the right-hand reference's character detail, not equivalent fidelity; publication requires separate approval.

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
