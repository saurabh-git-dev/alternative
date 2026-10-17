<!--
  Page for one IT tool: header, then the tool itself, loaded on demand.
  Transforms get the generic TransformTool page; custom tools are their own
  component. Starting input can come in the URL (`#/<id>/<payload>`, see
  it/links.ts): from "Copy link to this", or from another page such as a
  received share link ("Format JSON", "Decrypt" …).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { ItToolInfo, ItToolModule } from '../../it/types';
  import { decodeToolState } from '../../it/links';
  import { IT_HOME } from '../section';
  import TransformTool from './TransformTool.svelte';
  import './it.css';

  let { tool, payload = '' }: { tool: ItToolInfo; payload?: string } = $props();

  // Re-created per tool and payload (see App.svelte's {#key}), so read once.
  const initial = untrack(() => (payload ? decodeToolState(payload) : null));
  const badLink = untrack(() => !!payload && !initial);

  let loaded = $state<ItToolModule | null>(null);
  let failed = $state('');
  untrack(() => tool.load())
    .then((m) => (loaded = m))
    .catch(() => (failed = 'This tool could not be loaded. Check your connection and reload the page.'));
</script>

<a class="back" href={IT_HOME}>← All IT tools</a>
<div class="head">
  <span class="icon" aria-hidden="true">{tool.icon}</span>
  <div>
    <h1>{tool.title}</h1>
    <p class="muted">{tool.description}</p>
  </div>
</div>

{#if badLink}
  <p class="it-error">This link is incomplete or damaged, so the tool opened empty.</p>
{/if}

{#if failed}
  <p class="it-error">{failed}</p>
{:else if !loaded}
  <p class="muted">Loading…</p>
{:else if 'transform' in loaded}
  <TransformTool {tool} spec={loaded.transform} initial={initial ?? undefined} />
{:else}
  <loaded.default initial={initial?.input} />
{/if}

<style>
  .back {
    display: inline-block;
    margin: 0 0 10px;
    text-decoration: none;
    color: var(--text-2);
    font-size: 14px;
  }
  .head {
    display: flex;
    gap: 14px;
    align-items: center;
    margin-bottom: 16px;
  }
  .head h1 {
    margin: 0;
    font-size: 22px;
    line-height: 1.2;
  }
  .head p {
    margin: 2px 0 0;
    font-size: 14px;
  }
  .icon {
    font-size: 24px;
    width: 46px;
    height: 46px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: var(--accent-soft);
  }
  .it-error {
    margin-bottom: 12px;
  }
  @media (max-width: 560px) {
    .head {
      margin-bottom: 12px;
    }
    .head h1 {
      font-size: 19px;
    }
    .icon {
      width: 40px;
      height: 40px;
      font-size: 21px;
    }
  }
</style>
