// The component-impl signature, kept React-free (Node is the render-node type
// parameter; @loupe/catalog and @loupe/renderer instantiate it with ReactNode).
import type { Json } from '@loupe/protocol';

export interface ComponentImplArgs<Node, P = Record<string, unknown>> {
  /** Resolved props (expressions already evaluated; uiPointer props resolved to UiBinding). */
  props: P;
  /** Rendered `children` subtree, if any. */
  children?: Node;
  /** Rendered named-slot subtrees, keyed by declared slot name. */
  slots?: Readonly<Record<string, Node>>;
  /** Translate a component event into the fabrial's declared actions. */
  emit: (event: string, payload?: Json) => void;
  /**
   * True when the fabrial bound at least one action to `event`. Impls may use
   * it to skip interactive affordances (click interception, cursor styles) on
   * unbound events so clicks bubble to an enclosing pressable element. Absent
   * when the impl is mounted outside the renderer (tests, styleguide) — treat
   * absent as bound.
   */
  hasAction?: (event: string) => boolean;
  /**
   * Render a declared itemSlot template once for a component-supplied scope
   * item (must match the def's scope schema). `key` keys the subtree.
   */
  itemSlot: (name: string, scopeItem: Json, key: string) => Node;
}

export type ComponentImpl<Node, P = Record<string, unknown>> = (
  args: ComponentImplArgs<Node, P>,
) => Node;

/** The impls record a renderer mounts (keyed by catalog component name). */
export type ImplRecord<Node> = Readonly<Record<string, ComponentImpl<Node, never>>>;
