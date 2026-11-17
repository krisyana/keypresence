# Colour palette and accessibility

Brand palette (from Coolors): graphite `#363636`, jet-black navy `#242f40`, golden-bronze `#cca43b`, alabaster `#e5e5e5`, white `#ffffff`.
Tokens live in `src/web/theme.css`; every pair below is asserted by `tests/contrast.test.ts` (WCAG 2.2 formula, run for light, dark-auto and dark-manual).

## Measured ratios of the raw palette

| Pair | Ratio | Verdict |
| --- | --- | --- |
| navy on white / alabaster | 13.5 / 10.7 | AAA text |
| graphite on white / alabaster | 12.1 / 9.6 | AAA text |
| alabaster or white on navy | 10.7 / 13.5 | AAA text |
| gold on navy / graphite | 5.75 / 5.14 | AA text |
| **gold on white / alabaster** | **2.35 / 1.86** | **fails text (4.5) and UI (3)** |

The finding that shapes the design: gold cannot be text or a thin line on a light surface.

## How the palette is applied

- **Navy** is body text (light), sidebar, hero, toasts and the dark-theme surface family (`#171e2a`, `#1d2635`, `#2b3950` are derived navy shades).
- **Gold** is a *fill* with navy text (primary button 5.75:1, count badge, active marker on navy, hero button) and the accent in dark mode.
- **Bronze `#7a5c0a`** (derived, 6.24:1 on white) is the gold stand-in for text on light: links, active tab, focus border. In dark mode that token is gold itself.
- **Alabaster** is the border colour and basis for surface tints. It is too faint for control borders (1.28:1 on white), so inputs use a separate `--input-border` that reaches 3:1.
- Status colours (red, green, amber) are deliberately outside the palette: error and success meaning should not depend on brand hue.

## Checks (all in `tests/contrast.test.ts`)

- 26 text/background pairs at ≥ 4.5:1 per theme (body, muted, link/bronze, soft badges, sidebar, hero, toast, button).
- 14 non-text pairs at ≥ 3:1 per theme (WCAG 1.4.11): input borders, focus ring, button edge, chart bars, gold marker on navy, toast icons.
- Late-arrival bars use a diagonal stripe as well as colour, because the dark-theme gold and the bar colour are nearly equal in luminance (1.07:1) so colour alone would not distinguish them.
- axe-core scans 13 pages in light and dark (`npm run test:e2e`): no serious or critical violations.

Not verified: colour-blindness simulation, forced-colors/high-contrast mode, and real-device rendering [UNVERIFIED].

## Buttons and dialogs

`Button` and `Modal` wrap `@kit/ui`'s `Button` and `Dialog` (see `vendor/kit-ui/README.md`). The kit gives `aria-busy` buttons that stay focusable and ignore clicks while busy, and a native `<dialog>` labelled by its title with backdrop-click close. Variants: primary (gold fill), secondary, ghost, danger (outline); sizes: default, sm, big. Hover, pressed, busy and focus states are defined in `theme.css`.
