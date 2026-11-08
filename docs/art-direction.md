# JiuQuest combat art direction

Erik's direction is a detailed game presentation inspired by Solo Leveling's anime theme and the texture/detail standards of Skyrim and Fortnite. The chosen treatment is an original dark-fantasy anime dojo with readable martial-arts athletes.

## Current studio refinement

Arena playback and supported 1 vs 1 training previews share the same Unity athlete materials and indoor studio. The current pass uses a lower overhead key with broader neutral fill and indirect bounce to reveal faces and dark gis. Reduced cotton normal strength and specular weight retain authored seams, maps and silhouette without making the weave appear crumpled or glossy. The mat uses shallower relief and narrower, lower-contrast edge wear so its grid stays behind the grappling action.

Keep the existing two-pass fighter rendering, three studio lights, cosmetic references, shadow ownership and camera cutaways. The studio lighting refinement adds no asset downloads or extra render passes. Review both athlete roles in standing, takedown and ground poses before release. Choreography remains a draft pending coach review.

The next preview adds restrained cotton fiber scatter driven by the existing key light and cast shadow. Skin, eyes, hair and embroidered patches retain their own response. Close-up uses a tighter 92 percent fit of the measured pose envelope; ordinary study cameras retain their existing framing. Continuous original stroke lettering replaces the pixel-grid studio signs, sharing the existing wall materials and cutaways without font assets or textures.

Erik's November 7 character reference calls for more defined adult anatomy, faces and hands, and visible garment tension and compression folds. Use it for character fidelity, not its background, costumes, tattoos, characters or choreography. Keep the BJJ gis and current indoor studio. Prioritize original modeled belt tension, elbow/cuff and knee folds plus panel-aligned surface relief over further background decoration. Review a standing pilot in the actual Unity player before replacing the full motion library; then inspect grounded poses and both athlete roles. Facial changes must move skin and eyes through the same continuous field and refit brows to the resulting face. Keep the existing hair attachment when the additional shaping is confined to the face.

## Retained face and fabric depth

The next pass seats the eyes and surrounding sockets slightly deeper beneath the retained brow ridge, with restrained lower-orbital and nasal sidewall planes. Skin and eyes share the same deformation; brow anchors, eye size and neutral expression are retained, and brows are refitted to the final skin. The combined source-to-final displacement remains capped at six millimeters. Source checks cover 13,380 body vertices, 96 eye vertices and 26,928 triangles, with no flipped or degenerate triangles. The sampled neck, scalp and ear region is unchanged, hair deformation is retained, and brow clearance remains about 1.2 millimeters. These measurements establish bounded rest geometry, not every-frame contact or a complete match to the reference.

The gi uses broader fold crowns and deeper, narrower valleys to suggest heavy cotton, with waist tension fans resolved more clearly on the existing mesh. The upper sleeve panel is slightly flattened and hangs asymmetrically instead of forming a uniform round tube. Existing body-clearance fitting follows that shaping. Right-sleeve fold geometry and UV1 panel coordinates are reflected together, including the cuff, so both inside-elbow compression patterns face forward and remain aligned with their normal-map detail. Existing fabric roughness coordinates are retained. The shared torso, sleeve and trouser fold fields remain smoothly bounded to 11.5 millimeters and fade before openings; that limit does not describe total garment clearance. The folds are modeled and baked, with no live cloth simulation.

## Next skin response and cuff drape candidate

The next pass retains those face shapes and adds restrained regional skin roughness. A new original 512-pixel numeric atlas gives the nose and forehead a slightly smoother response than the cheeks and lower face. Non-face skin retains the existing baseline. The green-channel values range from 0.459 to 0.612 and reach the glTF roughness input unchanged, without color-space conversion. Both athletes share the same image. Skin diffuse and eye textures, positions, normals, UVs and weights remain unchanged. Sparse skin tangent components differ by one export rounding unit, about 0.0001; skin has no normal map.

Trouser fitting now establishes the garment envelope before adding fold relief, retaining the nine-millimeter radial clearance floor. This prevents fuller thigh regions from flattening positive fold crowns. Hanging fold channels continue closer to the cuff while still fading before the opening; knee compression keeps its separate fade. The UV1 panel coordinates used by the normal map are saved before deformation, so the modeled folds and their surface relief share the same coordinates after fitting. All 1,449 saved panel samples retain their correspondence through triangulation. Torso and sleeve shaping are retained from the prior pass. These are modeled and baked folds, not live cloth simulation.

All 16 regenerated clips retain the exact PR #9 animation channels, rest rig and inverse bind data. The 248 local checks and 24 packaged-file checks pass. Fresh final-build browser review covers desktop standing/close-up and completed ground playback, plus completed reversed-performer black/gray takedown playback at a measured 390-by-844 viewport with no horizontal overflow or console errors. The 16 clips total 137,193,364 bytes; the largest is 8,624,152 bytes, below the existing 9 MiB cap. Each clip now embeds seven shared images, one more than the prior pass; the source skin roughness image is 6,362 bytes. Rendering passes and the runtime shader are unchanged. Hosted checks, every-frame cloth contact and physical-phone performance remain separate. The skin response is subtle at gameplay distance. This is incremental progress toward the right-hand reference's sculpted character fidelity; publication remains a separate step.

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
