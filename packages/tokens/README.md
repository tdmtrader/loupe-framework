# @loupe/tokens

Design languages as data. A **theme** is one object filling the `Theme`
contract (`src/theme.ts`); `src/generate-css.ts` emits each as a flat block of
`--lp-*` custom properties (`pnpm --filter @loupe/tokens generate`, which
rewrites every file in `THEME_FILES`).

| theme | source | css | what it is |
| --- | --- | --- | --- |
| `modern` | `src/theme-modern.ts` | `theme-modern.css` | the host default |
| `tokens` | `src/tokens.ts` | `theme-classic.css` | the original design language, unchanged |

## The contract

`Theme` is deliberately wider than "colors and sizes", because that was the
part that made the v1 promise — *a future theme is a CSS file swap* — only
half true. Colors went through vars; the **chrome** did not. `borderRadius: 0`,
`textTransform: 'uppercase'`, `fontWeight: 700`, `boxShadow: 'none'` and the
pixel values of the type scale were literals inside the catalog impls, so no
CSS file could reach them. They are now theme keys:

- `font.family` / `font.familyMono` — the UI face and the code face. A
  one-typeface theme sets both to the same value and nothing changes.
- `font.weight` — semantic roles (`body`/`medium`/`strong`/`max`). Components
  ask for a role; classic answers 700 to both `medium` and `strong`.
- `font.scale` / `font.sizePx` — the scale NAMES stay frozen at
  10/11/12/14/16/18/24 (principle 1, and fabrials name them), while a theme
  re-pitches the pixels behind each name.
- `radii`, `shadows` — classic answers `0` and `none` throughout.
- `transform` — the casing of micro-labels, badges and buttons, separately.
  Uppercase-as-transform was the single loudest thing in the v1 screens.
- `badge` — two `color-mix` ratios deciding what `filled` MEANS: `100% / 0%`
  is the classic slab (bright fill, ink text), `0% / 100%` is a tinted chip.
- `color.tone.*.soft` — the fourth surface of each hue, the tinted ground the
  above mixes toward.

The two themes therefore differ only in their answers, and
`theme-classic.css` still renders exactly as before — there is a test for it.

## Using one

```ts
import '@loupe/tokens/theme-modern.css'; // or theme-classic.css
```

One import in `apps/host/src/main.tsx` is the whole switch. Everything
downstream (catalog impls, renderer chrome, host shell) references `--lp-*`
vars only; a raw hex in the catalog is a lint error, and so is a hard-coded
chrome decision in review.

Exports: `tokens`, `modern`, `generateCss`, `THEME_FILES`, the `Theme`
contract, and the token-name types (`ToneName`, `AccentName`, `TextTierName`,
`BgName`, `ClaimName`).

## Adding one

Copy `src/theme-modern.ts`, answer the contract, add it to `THEME_FILES`, and
regenerate. The drift test (`test/tokens.test.ts`) will hold the checked-in CSS
to the generator and check that your theme answers the *same var names* as
every other — a theme that quietly omits a key is a component that quietly
renders with no background.
