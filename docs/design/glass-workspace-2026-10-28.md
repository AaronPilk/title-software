# Glass workspace reference and implementation

Visual reference: [code.xr Glasssy Dashboard V5](https://www.instagram.com/p/De_78COzoPO/). Direct browser review identified a room backdrop, smoked translucent panels, a narrow icon rail, compact floating navigation and softly tinted panel headings. Those structural elements now guide the implementation. Ballantyne's logo and real workflow data remain; no reference media, source code or invented analytics were copied.

## Composition and usability

- Original room photograph behind the workspace, served locally as a 176 KB WebP; no third-party image request.
- Narrow desktop rail retains visible labels, accessible names and current-page state. Mobile keeps a full labeled drawer.
- Agency/Production selector sits in the desktop toolbar. Dashboard companies and tasks precede secondary setup records; compact totals are informational.
- Dashboard and company browsing use smoked glass. Editing, documents and detailed records use light reading surfaces and near-opaque dialogs.
- High contrast and reduced transparency remove the photographic background and blur. Forced colors use system colors; reduced motion removes transitions.
- Dense Agency tasks have a labeled keyboard-scrollable desktop list with an All tasks action; phones use page scrolling.

## Original background asset

`web/public/brand/workspace-room-v1.webp` was generated with the built-in image-generation tool, then encoded as WebP without changing its scene. The original PNG remains in the local generated-images directory.

Prompt: “Use case: photorealistic-natural. Asset: original desktop software workspace background, wide landscape 16:9 composition. Create an understated architectural editorial photograph of a serene modern executive lounge at late afternoon. Floor-to-ceiling glass windows with slim black mullions, hazy distant green hills and soft city skyline, pale warm gray stone floor, cream sculptural sofa at far right, a low walnut table low in foreground, one leafy indoor tree near far left. Soft natural shadows, warm neutral tones, realistic materials, premium quiet interior, no people. Camera wide and level at eye height, room and window structure recognizable but visually quiet. Keep center and upper middle mostly broad gentle window/sky gradients with low detail so translucent dark glass dashboard panels overlaid later remain legible. The room should have slightly dark mid-tone exposure, muted charcoal/olive/beige palette, not stark bright white and not blue. Image fills whole frame, no text, no logos, no dashboard or UI, no screen or device frame, no watermark. Original scene, not a copy of any particular room.”

## Verification

The glass browser suite exercises the real sample application and shared controls: desktop and 320/390px navigation, both company directories, forms, keyboard focus, readable currency values, selected/unselected tabs, local image decoding and accessibility alternatives. Material contrast checks conservatively bound image brightness instead of assuming a uniform background. Screenshots use fictional local records.

Run `npm --prefix web run test:glass:ui`; optionally set `TITLE_GLASS_SCREENSHOTS` to an absolute private directory. Agency recording acceptance is documented separately in `docs/testing/agency-recording-feedback-2026-10-28.md`.
