// Hotkeys — renders nothing; routes window keydown to fabrial events (design §3.3).
//
// For each keys[] entry {key, when?} it emits the entry's literal `key` string
// as the event name when that key is pressed and `when` passes (`when` is
// authored as a Condition in the fabrial and arrives pre-resolved as a boolean
// each render; absent = always). `keys` is a literal array by the eventsFrom
// validation contract — plain data.
//
// - Modifier syntax: 'shift+b', 'ctrl+k', 'alt+…', 'meta+…' (aliases cmd/mod).
//   Declared modifiers must be held; undeclared ones must not be — so 'b' and
//   'shift+b' are distinct bindings.
// - Suspended while a text field has focus (input/textarea/select or
//   contenteditable) — design-language §4.1 "while editing, triage keys
//   suspended".
// - Listener attached while mounted, removed on unmount; props changes are
//   picked up via a ref (no re-subscribe churn).
import { useEffect, useRef, type ReactNode } from 'react';
import type { ComponentImplArgs } from '@loupe/spec';

export interface HotkeyEntry {
  key: string;
  when?: boolean;
}

interface ParsedKey {
  base: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

function parseKey(spec: string): ParsedKey {
  const parts = spec.split('+').map((p) => p.trim().toLowerCase());
  const base = parts[parts.length - 1] ?? '';
  const mods = new Set(parts.slice(0, -1));
  return {
    base,
    shift: mods.has('shift'),
    ctrl: mods.has('ctrl') || mods.has('control'),
    alt: mods.has('alt') || mods.has('option'),
    meta: mods.has('meta') || mods.has('cmd') || mods.has('mod'),
  };
}

function matches(e: KeyboardEvent, p: ParsedKey): boolean {
  return (
    e.key.toLowerCase() === p.base &&
    e.shiftKey === p.shift &&
    e.ctrlKey === p.ctrl &&
    e.altKey === p.alt &&
    e.metaKey === p.meta
  );
}

function textFieldFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

export function Hotkeys({ props, emit }: ComponentImplArgs<ReactNode>): ReactNode {
  const latest = useRef<{ keys: HotkeyEntry[]; emit: typeof emit }>({ keys: [], emit });
  latest.current = {
    keys: Array.isArray(props.keys) ? (props.keys as HotkeyEntry[]) : [],
    emit,
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (textFieldFocused()) return;
      for (const entry of latest.current.keys) {
        if (typeof entry.key !== 'string') continue;
        if (entry.when === false) continue;
        if (matches(e, parseKey(entry.key))) {
          e.preventDefault();
          latest.current.emit(entry.key);
          return; // first match wins; one event per keydown
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}
