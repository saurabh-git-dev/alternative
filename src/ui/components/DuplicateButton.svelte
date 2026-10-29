<!--
  "New copy": opens this tool again in a new tab (see tabs.svelte.ts), e.g.
  to decode two JWTs side by side. The copy starts empty.
-->
<script lang="ts">
  import { usePane } from '../pane';
  import { MAX_TABS, workspace } from '../tabs.svelte';

  const pane = usePane();
</script>

<button
  class="dup"
  onclick={pane.duplicate}
  disabled={workspace.tabs.length >= MAX_TABS}
  title="Open this tool again in a new tab, to work on two things at once or compare them side by side"
>
  <span aria-hidden="true">⧉</span> <span class="label">New copy</span>
</button>

<style>
  .dup {
    flex: none;
    margin-left: auto;
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    font-size: 13.5px;
    white-space: nowrap;
  }
  .dup:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .dup:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  @media (max-width: 560px) {
    .label {
      display: none;
    }
  }
</style>
