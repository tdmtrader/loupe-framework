import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { LinkProps } from '../../defs/index.ts';
import { accentVar, fontBase, sizeVar, tierVar, weight } from './style.ts';

/**
 * An in-app anchor to another fabrial — a real `<a href>`, the launcher's own
 * form (`apps/host/src/main.tsx`), so the BROWSER does the navigating. No
 * event, no verb, no action kind: "the grammar has no navigation action"
 * stays true; what changed is that an element may be a link.
 *
 * IT RE-CHECKS THE HREF AT RUNTIME, and that is not belt-and-braces. The
 * validator sees literals only — a `$bind` is resolved long after validation,
 * out of a projection that reads documents this repository does not own. So a
 * resolved href that is not a string beginning `#/` renders the label as a
 * plain `<span>` and NO ANCHOR AT ALL: no `javascript:`, no off-origin URL,
 * and nothing for a reader to click by accident. Two guards, one at each end
 * of the wire, because either alone leaves a door.
 */
export const Link: ComponentImpl<ReactNode, LinkProps> = ({ props }) => {
  const { href, label, tone } = props;
  const color = accentVar(tone) ?? tierVar('primary');
  const base = {
    ...fontBase,
    fontSize: sizeVar(12),
    fontWeight: weight.strong,
    color,
  } as const;
  // Deliberately a string test and not a URL parse: `#/` is the whole of the
  // permitted shape, and a parser would invite a scheme allow-list next.
  if (typeof href !== 'string' || !href.startsWith('#/')) {
    return (
      <span data-lp="Link-inert" style={{ ...base, color: tierVar('muted') }}>
        {label}
      </span>
    );
  }
  return (
    <a
      data-lp="Link"
      href={href}
      style={{
        ...base,
        textDecoration: 'none',
        borderBottom: '1px solid var(--lp-border-idle)',
      }}
    >
      {label}
    </a>
  );
};
