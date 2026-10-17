<!--
  Regex tester: JavaScript regular expressions, matched live against sample
  text, with highlighted matches, capture groups and an optional replace.
-->
<script lang="ts">
  import { loadItOptions, saveItOptions } from '../../settings';
  import OutputActions from '../OutputActions.svelte';

  let { initial = '' }: { initial?: string } = $props();

  const saved = loadItOptions('regex');
  let pattern = $state(typeof saved.pattern === 'string' ? saved.pattern : '(\\w+)@(\\w+)\\.com');
  let flags = $state<Record<string, boolean>>({ g: true, i: false, m: false, s: false, u: false, ...(saved.flags as object) });
  // svelte-ignore state_referenced_locally
  let text = $state(initial || 'Write to ada@example.com or linus@kernel.com.\nNot an address: hello@world');
  let replacement = $state(typeof saved.replacement === 'string' ? saved.replacement : '');
  let replacing = $state(!!saved.replacing);

  $effect(() => saveItOptions('regex', { pattern, flags: $state.snapshot(flags), replacement, replacing }));

  const FLAG_HELP: Record<string, string> = { g: 'global: all matches', i: 'ignore case', m: 'multiline: ^ and $ per line', s: 'dot matches newlines', u: 'unicode' };
  /** Stop after this many matches so a pattern that matches everywhere can't hang the page. */
  const MAX = 1000;

  const regex = $derived.by(() => {
    try {
      return new RegExp(pattern, Object.keys(flags).filter((f) => flags[f]).join('') + 'd');
    } catch (e) {
      return e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : String(e);
    }
  });

  const matches = $derived.by(() => {
    if (typeof regex === 'string' || !pattern) return [];
    const out: RegExpExecArray[] = [];
    if (!regex.global) {
      const m = regex.exec(text);
      return m ? [m] : [];
    }
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) && out.length < MAX) {
      out.push(m);
      if (m[0] === '') regex.lastIndex++;
    }
    return out;
  });

  /** Text split into plain and matched pieces, for highlighting. */
  const pieces = $derived.by(() => {
    const out: { text: string; hit: boolean }[] = [];
    let at = 0;
    for (const m of matches) {
      if (m.index > at) out.push({ text: text.slice(at, m.index), hit: false });
      if (m[0]) out.push({ text: m[0], hit: true });
      at = m.index + m[0].length;
    }
    out.push({ text: text.slice(at), hit: false });
    return out;
  });

  const replaced = $derived(typeof regex === 'string' || !replacing ? '' : text.replace(regex, replacement));
</script>

<div class="it-panes">
  <section class="card it-pane">
    <div class="pattern">
      <span class="slash">/</span>
      <input class="it-input" bind:value={pattern} placeholder="pattern" spellcheck="false" aria-label="Regular expression" />
      <span class="slash">/{Object.keys(flags).filter((f) => flags[f]).join('')}</span>
    </div>
    <div class="it-options">
      {#each Object.keys(flags) as f (f)}
        <label class="it-field" title={FLAG_HELP[f]}><input type="checkbox" bind:checked={flags[f]} /> {f}</label>
      {/each}
    </div>
    {#if typeof regex === 'string'}<p class="it-error">{regex}</p>{/if}
    <textarea class="it-text" bind:value={text} spellcheck="false" aria-label="Test text"></textarea>
    <label class="it-field"><input type="checkbox" bind:checked={replacing} /> Replace with</label>
    {#if replacing}
      <input class="it-input" bind:value={replacement} placeholder="$1 at $2, $<name>, $&" spellcheck="false" aria-label="Replacement" />
    {/if}
  </section>

  <section class="card it-pane">
    <div class="it-pane-head">
      <h2>{matches.length}{matches.length === MAX ? '+' : ''} match{matches.length === 1 ? '' : 'es'}</h2>
    </div>
    <pre class="highlight">{#each pieces as p, i (i)}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</pre>
    {#if matches.length}
      <ol class="matches">
        {#each matches.slice(0, 100) as m, i (i)}
          <li>
            <code>{m[0] || '(empty)'}</code> <span class="it-help">at {m.index}</span>
            {#if m.length > 1}
              <div class="groups">
                {#each m.slice(1) as g, j (j)}<span><b>${j + 1}</b> {g ?? '—'}</span>{/each}
                {#each Object.entries(m.groups ?? {}) as [name, g] (name)}<span><b>{name}</b> {g ?? '—'}</span>{/each}
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
    {#if replacing && typeof regex !== 'string'}
      <div class="it-pane-head"><h2>Replaced</h2><OutputActions text={replaced} name="replaced" /></div>
      <textarea class="it-text" readonly value={replaced} aria-label="Replaced text"></textarea>
    {/if}
  </section>
</div>

<style>
  .pattern {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .slash {
    font: 600 16px ui-monospace, monospace;
    color: var(--text-3);
  }
  .highlight {
    margin: 0;
    padding: 10px 12px;
    max-height: 260px;
    overflow: auto;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font: 13.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }
  mark {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    color: inherit;
    border-radius: 3px;
  }
  .matches {
    margin: 0;
    padding-left: 22px;
    display: grid;
    gap: 6px;
    max-height: 300px;
    overflow: auto;
    font-size: 14px;
  }
  .groups {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font: 13px ui-monospace, monospace;
    color: var(--text-2);
  }
</style>
