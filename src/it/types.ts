/**
 * The contract every IT tool follows.
 *
 * Two kinds of tool:
 *
 * - **Transform**: text in, text out, with a few options. Declared as data
 *   (`TransformSpec`); one generic page (`ui/it/TransformTool.svelte`) draws
 *   the input box, options and output for all of them. Most tools are this.
 * - **Custom**: a Svelte component, for tools that don't fit that shape
 *   (generators, calculators with several linked fields, the regex tester…).
 *
 * The registry (`registry.ts`) holds only light metadata for the home page
 * and search; each tool's code loads when it is opened.
 */
import type { Component } from 'svelte';

export type ItCategory = 'crypto' | 'convert' | 'web' | 'dev' | 'text' | 'network';

export interface ItToolInfo {
  /** URL id: the tool lives at `it/#/<id>`. */
  id: string;
  title: string;
  icon: string;
  /** One line shown on the home page and under the title. */
  description: string;
  /** Extra search words that aren't shown. */
  keywords?: string;
  category: ItCategory;
  /** Loads the implementation: a transform spec or a component. */
  load: () => Promise<ItToolModule>;
}

export type ItToolModule = { transform: TransformSpec } | { default: Component<ItToolProps> };

/** Props every custom tool component receives. */
export interface ItToolProps {
  /** Text handed over from another page (a share link, Received page …), if any. */
  initial?: string;
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export type OptionValue = string | number | boolean;
export type OptionValues = Record<string, OptionValue>;

export type OptionSpec =
  | { kind: 'choice'; label: string; default: string; choices: { value: string; label: string }[]; help?: string }
  | { kind: 'toggle'; label: string; default: boolean; help?: string }
  | { kind: 'number'; label: string; default: number; min?: number; max?: number; step?: number; help?: string }
  | {
      kind: 'text';
      label: string;
      default: string;
      placeholder?: string;
      /** Passwords and keys: drawn as a password field, never put in links or remembered. */
      secret?: boolean;
      help?: string;
    };

/** A labelled value in a multi-part output (e.g. one row per hash algorithm). */
export interface OutputRow {
  label: string;
  value: string;
}

export interface TransformSpec {
  input?: {
    label?: string;
    placeholder?: string;
    /** Filled in by the "Example" button, and shown on first open. */
    sample?: string;
    /** Single-line input instead of a text area. */
    singleLine?: boolean;
  };
  options?: Record<string, OptionSpec>;
  /**
   * Option that flips the direction of a two-way tool (e.g. encode/decode).
   * Its choices are drawn as a segmented switch, and "Swap" puts the output
   * back in the input with the other direction selected.
   */
  direction?: string;
  /** Text output, or rows with their own copy buttons. Throw an Error with a friendly message for bad input. */
  run: (input: string, options: OptionValues) => string | OutputRow[] | Promise<string | OutputRow[]>;
  output?: {
    label?: string;
    /** MIME type when the output is downloaded or shared; may depend on the options. */
    type?: string | ((options: OptionValues) => string);
    /** File name (without extension) for downloads and shares. */
    name?: string;
  };
  /** Input may hold secrets (tokens, keys): don't offer "link to this" with the input in it. */
  sensitive?: boolean;
}
