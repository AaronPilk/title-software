# Ballantyne Title workspace branding

The local operations app now uses the identity from [Ballantyne Title's website](https://www.ballantynetitle.com/), inspected September 12, 2026. Its working layout and workflow status colors remain intact.

## Reference and assets

The [website stylesheet](https://www.ballantynetitle.com/styles.css) defines the palette and type pairing used here:

| Role | Value |
| --- | --- |
| Primary navy | `#00305B` |
| Navy hover | `#002145` |
| Soft sky | `#B5CFE6` |
| Accent blue | `#2F6DB0` |
| Tinted surface | `#EAF0F7` |
| Border | `#C8D6E5` |
| Muted text | `#5B6B7C` |
| Body / controls | Inter |
| Page and section headings | Source Serif Pro |

The [original circular logo](https://www.ballantynetitle.com/assets/bt-logo.png) is stored unmodified at `web/public/brand/ballantyne-title-logo.png`, with its original 500 × 500 dimensions. It appears in the sidebar and browser icon. The shell, browser title, accessible home control, and footer identify Ballantyne Title Company.

The Latin font subsets are self-hosted as WOFF2 assets under `web/public/brand/fonts`, downloaded from Google Fonts. No runtime Google Fonts request is required. Inter includes weights 400–700; Source Serif Pro includes 400, 600 and 700. Font license files accompany the assets; other characters retain system fallbacks.

## Application

Shared theme tokens, active navigation, primary buttons, review selections, generic illustrations, reporting charts and partner surfaces use the brand palette. Outline buttons retain a light surface and readable foreground. Status, warning, success, company-avatar and assigned-person colors retain their existing meaning.

This change does not alter saved records, export schemas, `titleos.workspace.v1`, or the uploaded-asset database identifier.

Verification: typecheck and production build, source/cascade review, font and logo asset checks, and calculated contrast for the principal brand pairs. White/navy is 13.34:1; navy/tinted selection is 11.42:1; muted text/tinted surface is 4.77:1. No browser interaction or screenshot pass was performed for this presentation update.
