// Shared helpers for the catalog browser-mode render tests (catalog-core lane).
// Tests assert computed styles against @loupe/tokens values — resolved through
// the generated --lp-* custom properties, so the theme CSS import below is
// load-bearing. Impls mount synchronously (createRoot + flushSync) into the
// real document so getComputedStyle resolves the vars.
import '@loupe/tokens/theme-classic.css';
import { createElement, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, vi } from 'vitest';
import type { ComponentImpl, ComponentImplArgs } from '@loupe/spec';

/** hex "#RRGGBB" -> the "rgb(r, g, b)" form getComputedStyle reports. */
export function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/**
 * The same color, spelled two ways. getComputedStyle reports `rgb(r, g, b)`
 * for a plain color and `color(srgb 0.86 0.33 0.26)` for anything that went
 * through color-mix() — which is how Badge asks the theme what `filled`
 * means. Compare channels (0–255, rounded), not spelling.
 */
export function channels(value: string): [number, number, number] {
  const nums = value.match(/[\d.]+/g)?.map(Number) ?? [];
  if (value.startsWith('color(')) {
    const [r = 0, g = 0, b = 0] = nums;
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  const [r = 0, g = 0, b = 0] = nums;
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/** channels(actual) vs channels(rgb(hex)) — use where color-mix is in play. */
export function sameColor(actual: string, hex: string): boolean {
  const a = channels(actual);
  const b = channels(rgb(hex));
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    root.unmount();
    container.remove();
  }
});

export interface Mounted<P = unknown> {
  el: HTMLElement;
  emit: ReturnType<typeof vi.fn>;
  q: (dataLp: string) => HTMLElement;
  css: (el?: HTMLElement) => CSSStyleDeclaration;
  /** Re-render the same mounted impl with new props (state/refs preserved). */
  rerender: (props: P) => void;
}

/** Mount one impl with resolved props + spy emit; return its root element. */
export function mount<P>(
  impl: ComponentImpl<ReactNode, P>,
  name: string,
  props: P,
  extra?: Partial<Pick<ComponentImplArgs<ReactNode, P>, 'children' | 'slots'>>,
): Mounted<P> {
  const emit = vi.fn();
  const args: ComponentImplArgs<ReactNode, P> = {
    props,
    emit,
    itemSlot: () => null,
    ...extra,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  flushSync(() => {
    // Mount as a real component (the renderer does the same via createElement)
    // so impls may use hooks; a plain impl(args) call would break the rules of
    // hooks for any impl that holds a ref/effect (e.g. Stack/Row scrollIntoView).
    root.render(createElement(impl, args));
  });
  const q = (dataLp: string) => {
    const found = container.querySelector(`[data-lp="${dataLp}"]`);
    if (!(found instanceof HTMLElement)) throw new Error(`no element [data-lp="${dataLp}"]`);
    return found;
  };
  const el = q(name);
  const rerender = (props: P): void => {
    flushSync(() => {
      root.render(createElement(impl, { ...args, props }));
    });
  };
  return { el, emit, q, css: (target = el) => getComputedStyle(target), rerender };
}

// ---------------------------------------------------------------------------
// Token color access for assertions. The @loupe/tokens JS barrel re-exports
// its node generator (node:fs) and cannot load in browser mode, so tests read
// the SAME values from the applied theme's --lp-* custom properties — the
// generated CSS is the token source of truth the components style through.
const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (v === '') throw new Error(`token var ${name} is not defined by theme-classic.css`);
  return v;
}

function group(prefix: string): Record<string, string> {
  return new Proxy(
    {},
    { get: (_t, prop: string) => cssVar(`--lp-${prefix}-${kebab(prop)}`) },
  ) as Record<string, string>;
}

export interface TokenColors {
  bg: Record<string, string>;
  border: Record<string, string>;
  text: Record<string, string>;
  accent: Record<string, string>;
  diff: Record<string, string>;
  claim: Record<string, string>;
  tone: Record<string, { fill: string; border: string; text: string }>;
}

/** Mirrors tokens.color paths (c.text.primary, c.tone.wait.border, …). */
export const tokenColors: TokenColors = {
  bg: group('bg'),
  border: group('border'),
  text: group('text'),
  accent: group('accent'),
  diff: group('diff'),
  claim: group('claim'),
  tone: new Proxy(
    {},
    { get: (_t, tone: string) => group(`tone-${kebab(tone)}`) },
  ) as TokenColors['tone'],
};
