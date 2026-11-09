# Blue belt guide replacement

The blue belt catalog uses the approved `Jiu_Jitsu_Technique_Guide.docx` supplied on November 9, 2026. Its SHA-256 is `1c72bc9fd0d0a31193d043d5ea2b8ece060ea7a3d3b99abfbeb376c32dd78597`.

The catalog contains 36 techniques, 35 scenario paragraphs, and 141 step paragraphs. Names retain the source spelling and case after removal of the leading lesson identifier. Step wording, punctuation, emphasis, and paragraph boundaries are preserved. The heel-drag variation retains its source labels `1., 2., 2.`; ordering/scoring uses paragraph identity, never those labels. Source editorial text, including `[confirm arm wording]`, is retained as supplied.

`tools/import_blue_belt_guide.py <path-to-docx> --check` verifies the generated source against the original without modifying it. The importer reads Word numbering and text runs and rejects unhandled structures. `blueBeltGuide.js` contains source text; `blueBeltPositions.js` contains the separate app classifications and arena rules.

The 13 category headers describe the performing player's starting position. Standing classifications for the guillotine sequence are inferred from its bent-knee lift and jumping defense steps. The Kimura scenario remains the source's broad top-or-bottom statement, while the supplied sequence is grouped under bottom guard. The second back-take sequence starts in its own bottom-side setup, separate from being pinned under side mount.

Equivalent technique IDs retain saved repetitions. New variations and the split back take have separate IDs. Removed entries stay in saved history but do not count toward current progression or appear as playable moves. Blue belt completion now requires all 36 techniques.

Arena position starts make each guide setup reachable. Standing headlock, rear clinch, standing over guard, and the back-take intermediate setup preserve both players' roles. Their existing reference images are explicitly labeled as general references because exact setup artwork is unavailable. Unsupported variations do not reuse unrelated animation clips. Guide sequences receive 20–120 seconds based on paragraph length; basic techniques retain their existing timer.

Validation includes source comparison, rich-text rendering and escaping, progress compatibility, starting-position reachability, actor-relative outcomes, all-technique browser text/bold/numbering checks, and responsive layout checks. The production workflow retains the complete Unity and mobile browser gate.
