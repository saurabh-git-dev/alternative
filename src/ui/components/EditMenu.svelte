<!--
  "Edit" menu for a file: every tool that accepts its type (PDF, image and
  video tools open right here with the file loaded; the direct-transfer
  session stays connected), plus IT tools for text, which open in a new tab
  with the text filled in.
-->
<script lang="ts">
  import { ALL_ACTIONS } from '../../actions';
  import { accepts, detectType } from '../../core/files';
  import { suggestItTools, type Suggestion } from '../../it/suggest';
  import { itToolHref } from '../section';

  let { file, onOpen }: { file: File; onOpen: (id: string, files: File[]) => void } = $props();

  /** Text up to this size is offered to the IT tools (it travels in their link). */
  const MAX_IT_TEXT = 200_000;

  let menu = $state<HTMLDetailsElement>();
  let panel = $state<HTMLDivElement>();
  let pos = $state({ top: 0, left: 0 });
  let opened = $state(false);
  /** Hidden until placed, so it never flashes in the corner. */
  let placed = $state(false);
  let text = $state('');
  let itTools = $state<Suggestion[]>([]);

  const type = $derived(detectType(file));
  const tools = $derived(ALL_ACTIONS.filter((a) => accepts(a, type)));
  const isText = $derived(/^text\/|^application\/json$/.test(type) || /\.(txt|csv|json|md|ya?ml|log)$/i.test(file.name));

  async function onToggle() {
    opened = !!menu?.open;
    if (!opened) placed = false;
    if (!menu?.open || !isText || text || file.size > MAX_IT_TEXT) return;
    text = await file.text();
    const t = /\.csv$/i.test(file.name) ? 'text/csv' : /\.json$/i.test(file.name) ? 'application/json' : type;
    itTools = suggestItTools(t, text);
  }

  // Fixed to the window, so it isn't cut off inside a scrolling list; above the button near the bottom.
  $effect(() => {
    void itTools.length;
    if (!opened || !menu || !panel) return;
    const b = menu.getBoundingClientRect();
    const h = panel.offsetHeight;
    const w = panel.offsetWidth;
    const below = b.bottom + 6 + h <= innerHeight || b.top < h + 6;
    pos = { top: below ? b.bottom + 6 : Math.max(8, b.top - 6 - h), left: Math.max(8, Math.min(b.right - w, innerWidth - w - 8)) };
    placed = true;
  });

  // Close when clicking elsewhere.
  $effect(() => {
    const onClick = (e: MouseEvent) => {
      if (menu?.open && !menu.contains(e.target as Node)) menu.open = false;
    };
    const onScroll = (e: Event) => {
      if (menu?.open && !panel?.contains(e.target as Node)) menu.open = false;
    };
    addEventListener('click', onClick);
    addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      removeEventListener('click', onClick);
      removeEventListener('scroll', onScroll, { capture: true });
    };
  });
</script>

{#if tools.length || isText}
  <details class="menu" bind:this={menu} ontoggle={onToggle}>
    <summary class="btn" title="Open this file in a tool">✏️ Edit</summary>
    <div class="panel card" role="menu" bind:this={panel} style:top="{pos.top}px" style:left="{pos.left}px" style:visibility={placed ? 'visible' : 'hidden'}>
      {#each tools as tool (tool.id)}
        <button role="menuitem" onclick={() => onOpen(tool.id, [file])}><span aria-hidden="true">{tool.icon}</span> {tool.title}</button>
      {/each}
      {#each itTools as s (s.tool)}
        <a role="menuitem" href={itToolHref(s.tool, { input: text, options: s.options ?? {} })} target="_blank" rel="noopener">{s.label} <span class="muted">↗</span></a>
      {/each}
      {#if !tools.length && !itTools.length}
        <p class="muted">{file.size > MAX_IT_TEXT ? 'Too large to open in the text tools.' : 'No tools for this kind of file.'}</p>
      {/if}
    </div>
  </details>
{/if}

<style>
  .menu {
    position: relative;
  }
  summary {
    list-style: none;
    white-space: nowrap;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .panel {
    position: fixed;
    z-index: 60;
    display: grid;
    min-width: 220px;
    max-height: 60vh;
    overflow: auto;
    padding: 6px;
    box-shadow: var(--shadow);
  }
  .panel button,
  .panel a {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 7px 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    text-align: left;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
  }
  .panel button:hover,
  .panel a:hover {
    background: var(--accent-soft);
  }
  .panel p {
    margin: 6px 10px;
    font-size: 13px;
  }
</style>
