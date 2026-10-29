<!--
  The page one tab shows (see tabs.svelte.ts and routes.ts). `#/` is the home
  page of the tab's section, so a tab can show IT tools' home inside the
  Dashboard's page, and so on.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Home from './pages/Home.svelte';
  import Tool from './pages/Tool.svelte';
  import Share from './pages/Share.svelte';
  import Received from './pages/Received.svelte';
  import PipelinePage from './pages/Pipeline.svelte';
  import Compare from './pages/Compare.svelte';
  import ConnectPage from './connect/ConnectPage.svelte';
  import LocalPage from './connect/LocalPage.svelte';
  import ConnectTabs from './connect/ConnectTabs.svelte';
  import BrowserSharePage from './connect/BrowserSharePage.svelte';
  import ItHome from './it/ItHome.svelte';
  import ItTool from './it/ItTool.svelte';
  import VideoHome from './video/VideoHome.svelte';
  import RecordHome from './record/RecordHome.svelte';
  import { PIPELINE_ROUTE } from '../core/pipeline';
  import { parseRoute } from './routes';
  import { providePane } from './pane';
  import { openTab, takeFiles, type Tab } from './tabs.svelte';

  let { tab, active, native, onOpen }: { tab: Tab; active: boolean; native: boolean; onOpen: (id: string, files?: File[]) => void } = $props();

  providePane({
    get active() {
      return active;
    },
    duplicate: () => openTab(tab.hash, tab.section),
  });

  const hash = $derived(tab.hash);
  const route = $derived(parseRoute(hash, native));
  const action = $derived(route.action);
  const recordingId = $derived(route.recordingId);
  const toolKey = $derived(action ? `${action.id}/${recordingId ?? ''}` : '');
  /** Files handed over with the tool just opened in this tab (read once per tool). */
  const handed = $derived.by(() => (toolKey ? untrack(takeFiles) : []));

  /** A recording opened in a tool: loaded from the library, then handed over like dropped files. */
  let opened = $state<{ id: string; ready: boolean; files: File[]; error?: string } | null>(null);
  $effect(() => {
    const id = recordingId;
    if (!id || untrack(() => opened?.id) === id) return;
    opened = { id, ready: false, files: [] };
    import('./record/open')
      .then(({ recordingFile }) => recordingFile(id))
      .then((file) => (opened = { id, ready: true, files: [file] }))
      .catch((e: unknown) => (opened = { id, ready: false, files: [], error: e instanceof Error ? e.message : String(e) }));
  });
</script>

{#if action && recordingId && !(opened?.id === recordingId && opened.ready)}
  <p class="muted loading">{opened?.error ? `Couldn't open the recording: ${opened.error}` : 'Opening recording…'}</p>
{:else if action}
  {#key toolKey}
    <Tool {action} initialFiles={recordingId ? (opened?.files ?? []) : handed} />
  {/key}
{:else if route.itTool}
  {#key hash}
    <ItTool tool={route.itTool} payload={route.itPayload} />
  {/key}
{:else if route.page === 'pipeline'}
  {#key hash}
    <PipelinePage encoded={hash.slice(PIPELINE_ROUTE.length + 1)} />
  {/key}
{:else if route.page === 'compare'}
  <Compare />
{:else if route.page === 'share'}
  <Share />
{:else if route.page === 'connect'}
  {#if native}<ConnectTabs active="connect" />{/if}
  {#key hash}
    <ConnectPage {hash} {onOpen} />
  {/key}
{:else if route.page === 'lan'}
  <ConnectTabs active="lan" />
  <BrowserSharePage {onOpen} />
{:else if route.page === 'local'}
  <ConnectTabs active="local" />
  <LocalPage {hash} {onOpen} />
{:else if route.page === 'received'}
  <Received {hash} {onOpen} />
{:else if tab.section === 'it'}
  <ItHome />
{:else if tab.section === 'video'}
  <VideoHome {onOpen} />
{:else if tab.section === 'record'}
  <RecordHome />
{:else if tab.section === 'pdf' || tab.section === 'image'}
  {#key tab.section}
    <Home {onOpen} view={tab.section} />
  {/key}
{:else}
  <Home {onOpen} view="dashboard" />
{/if}

<style>
  .loading {
    text-align: center;
    margin-top: 48px;
  }
</style>
