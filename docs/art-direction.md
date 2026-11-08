# JiuQuest combat art direction

Erik's direction is a detailed game presentation inspired by Solo Leveling's anime theme and the texture/detail standards of Skyrim and Fortnite. The chosen treatment is an original dark-fantasy anime dojo with readable martial-arts athletes.

## Current studio refinement

Arena playback and supported 1 vs 1 training previews share the same Unity athlete materials and indoor studio. The current pass uses a lower overhead key with broader neutral fill and indirect bounce to reveal faces and dark gis. Reduced cotton normal strength and specular weight retain authored seams, maps and silhouette without making the weave appear crumpled or glossy. The mat uses shallower relief and narrower, lower-contrast edge wear so its grid stays behind the grappling action.

Keep the existing two-pass fighter rendering, three studio lights, cosmetic references, shadow ownership and camera cutaways. This refinement adds no asset downloads or extra render passes. Review both athlete roles in standing, takedown and ground poses before release. Choreography remains a draft pending coach review.

The next preview adds restrained cotton fiber scatter driven by the existing key light and cast shadow. Skin, eyes, hair and embroidered patches retain their own response. Close-up uses a tighter 92 percent fit of the measured pose envelope; ordinary study cameras retain their existing framing. Continuous original stroke lettering replaces the pixel-grid studio signs, sharing the existing wall materials and cutaways without font assets or textures.

Erik's November 7 character reference calls for more defined adult anatomy, faces and hands, and visible garment tension and compression folds. Use it for character fidelity, not its background, costumes, tattoos, characters or choreography. Keep the BJJ gis and current indoor studio. Prioritize original modeled belt tension, elbow/cuff and knee folds plus panel-aligned surface relief over further background decoration. Review a standing pilot in the actual Unity player before replacing the full motion library; then inspect grounded poses and both athlete roles. Facial changes must move skin and eyes through the same continuous field and refit brows to the resulting face. Keep the existing hair attachment when the additional shaping is confined to the face.

## Next facial detail and cotton candidate

The next candidate keeps the broader mandibular silhouette and moves closer to the November 7 right-hand white-gi reference by reducing the drawn-on eye treatment. The separate dark upper-eyelid ribbons are removed; the source's modeled and textured eyelids remain. Lower, flatter, tapered brows reduce the dark overlay area by approximately 54 percent. Brows are projected onto the final skin with about 1.2 millimeters of clearance. Source-face review located the nasal tip near z=1.604 meters and the mouth near z=1.575 meters. The shaping now follows those landmarks, removes the earlier lip inflation labeled as chin projection, and adds clearer cheekbone and lower-cheek planes. The actual lower chin and neck below z=1.550 remain protected.

Skin and eyes share the same continuous deformation and brows are refitted afterward. The combined source-to-final facial displacement, including earlier base styling, remains capped at six millimeters. Actual-source checks cover 13,380 body vertices, 96 eye vertices and 26,928 triangles, with no flipped or degenerate triangles. The sampled neck, scalp and ear region is unchanged; the previous hair warp is retained. These checks establish bounded rest geometry, not every animated-frame contact or final likeness.

The cotton pass gives waist folds narrower origins that open into curved valleys above and below the belt, adds a localized branching inside-elbow crease, and joins diagonal upper-knee/thigh pulls to the longer trouser drapes. Calm panel areas remain between the folds. Torso, sleeve and trouser fold contributions now share a smooth 11.5-millimeter bound and fade before garment openings. This bound applies to the shared fold field, not total garment clearance or all existing geometry. The folds are modeled and baked into the panel normal map; they do not simulate changing cloth tension during movement.

The pilot and rebuilt 16-asset library have been reviewed in Unity. All 16 exact animation/rig comparisons, 242 local checks and 24 packaged-file checks pass. Browser sampling covers desktop white/navy standing and ground playback, plus 390-pixel black/gray reversed-performer takedown playback. Hosted checks remain separate. Check both athlete roles, white and dark gis, eye/brow fit, lapel clearance and fold behavior through ground movement. Keep the current rig, authored motion, texture count and rendering passes. Record regenerated download sizes and physical-device limits separately. Publication remains a separate step; the pilot does not establish reference-quality faces or every-frame cloth contact.

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
