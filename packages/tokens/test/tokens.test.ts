import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateCss, THEME_FILES } from '../src/generate-css.ts';
import { modern } from '../src/theme-modern.ts';
import { tokens } from '../src/tokens.ts';

const read = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');

describe('@loupe/tokens', () => {
  it('every checked-in theme css matches the generator (no drift)', () => {
    for (const { file, theme, label } of THEME_FILES) {
      expect(read(file), file).toBe(generateCss(theme, label));
    }
  });

  it('emits the design-language anchor values', () => {
    const css = generateCss();
    expect(css).toContain('--lp-bg-page:#151515;');
    expect(css).toContain('--lp-tone-bad-fill:#DB5442;');
    expect(css).toContain('--lp-tone-bad-border:#912617;');
    expect(css).toContain('--lp-tone-bad-text:#F7B6AD;');
    expect(css).toContain('--lp-text-inverse:#151515;');
    expect(css).toContain('--lp-radius:0;');
    expect(css).toContain('--lp-shadow:none;');
    expect(css).toContain('--lp-letter-spacing:0.0425em;');
    expect(css).toContain("--lp-font-family:'Inconsolata', monospace;");
  });

  it('keeps the closed type scale and triad structure', () => {
    expect(tokens.font.scale).toEqual([10, 11, 12, 14, 16, 18, 24]);
    for (const triad of Object.values(tokens.color.tone)) {
      expect(Object.keys(triad).sort()).toEqual(['border', 'fill', 'soft', 'text']);
    }
    expect(tokens.radius).toBe(0);
    expect(tokens.accentWidth).toEqual({ atom: 2, structural: 3 });
  });

  it('classic keeps its chrome — the added contract keys did not restyle it', () => {
    const css = generateCss();
    expect(css).toContain("--lp-font-mono:'Inconsolata', monospace;"); // one face
    expect(css).toContain('--lp-radius-lg:0;');
    expect(css).toContain('--lp-shadow-panel:none;');
    expect(css).toContain('--lp-transform-micro:uppercase;');
    expect(css).toContain('--lp-badge-fill-alpha:100%;'); // filled is still the slab
    expect(css).toContain('--lp-weight-medium:700;');
    for (const size of tokens.font.scale) expect(css).toContain(`--lp-size-${size}:${size}px;`);
  });

  it('every theme answers the whole contract with the same var names', () => {
    // Declaration names only — a VALUE may mention a var the other theme does not.
    const names = (css: string) => [...css.matchAll(/^ {2}(--lp-[a-z0-9-]+):/gm)].map((m) => m[1]).sort();
    expect(names(generateCss(modern, 'modern'))).toEqual(names(generateCss()));
  });

  it('the modern theme keeps the scale NAMES while re-pitching the pixels', () => {
    expect(modern.font.scale).toEqual(tokens.font.scale);
    const css = generateCss(modern, 'modern');
    expect(css).toContain('--lp-size-12:13px;');
    expect(css).toContain('--lp-size-24:30px;');
    // Monotonic: a bigger name is never a smaller pixel.
    const px = modern.font.scale.map((n) => modern.font.sizePx[n]);
    expect(px).toEqual([...px].sort((a, b) => a - b));
  });
});
