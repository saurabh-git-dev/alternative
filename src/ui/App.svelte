<!--
  App shell: header and a tiny hash router.
  Routes: `#/` (home), `#/tool/<action id>`, `#/share`, share links
  `#/s/<data>` / `#/q/<data>` (see core/share.ts), `#/pipeline[/<data>]`
  (see core/pipeline.ts) and `#/compare`. Hash routing works on any
  static host with no server configuration.
-->
<script lang="ts">
  import Home from './pages/Home.svelte';
  import Tool from './pages/Tool.svelte';
  import Share from './pages/Share.svelte';
  import Received from './pages/Received.svelte';
  import PipelinePage from './pages/Pipeline.svelte';
  import Compare from './pages/Compare.svelte';
  import { PIPELINE_ROUTE } from '../core/pipeline';
  import { LINK_ROUTE, QR_ROUTE } from '../core/share';
  import { getAction } from '../actions';
  import { loadTheme, saveTheme, type Theme } from './settings';

  let hash = $state(location.hash);
  let theme = $state<Theme>(loadTheme());
  /** Files dropped on the home page, handed to the tool the user picks. */
  let pending = $state<File[]>([]);

  $effect(() => {
    const onHash = () => {
      hash = location.hash;
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  });

  const action = $derived(hash.startsWith('#/tool/') ? getAction(decodeURIComponent(hash.slice(7))) : undefined);

  const page = $derived(
    action
      ? 'tool'
      : hash === PIPELINE_ROUTE || hash.startsWith(`${PIPELINE_ROUTE}/`)
        ? 'pipeline'
        : hash === '#/compare'
          ? 'compare'
          : hash === '#/share'
          ? 'share'
          : hash.startsWith(`#${LINK_ROUTE}`) || hash.startsWith(`#${QR_ROUTE}`) ? 'received' : 'home',
  );

  $effect(() => {
    document.title = action
      ? `${action.title} · Formatter`
      : page === 'pipeline'
        ? 'Pipeline · Formatter'
        : page === 'compare'
        ? 'Compare PDFs · Formatter'
        : page === 'share'
        ? 'Share as link or QR · Formatter'
        : page === 'received'
          ? 'Shared file · Formatter'
          : 'Formatter · PDF & image tools';
  });

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    saveTheme(theme);
  }

  function openTool(id: string, files: File[] = []) {
    pending = files;
    location.hash = `#/tool/${id}`;
  }
</script>

<header>
  <a class="logo" href="#/">
    <span class="mark" aria-hidden="true">F</span>
    Formatter
  </a>
  <span class="badge" title="Every tool runs inside your browser using WebAssembly. Nothing is uploaded.">
    🔒 Files never leave your device
  </span>
  <button class="icon-btn" onclick={toggleTheme} aria-label="Switch to {theme === 'dark' ? 'light' : 'dark'} theme">
    {theme === 'dark' ? '☀️' : '🌙'}
  </button>
</header>

<main>
  {#if action}
    {#key action.id}
      <Tool {action} initialFiles={pending} />
    {/key}
  {:else if page === 'pipeline'}
    {#key hash}
      <PipelinePage encoded={hash.slice(PIPELINE_ROUTE.length + 1)} />
    {/key}
  {:else if page === 'compare'}
    <Compare />
  {:else if page === 'share'}
    <Share />
  {:else if page === 'received'}
    <Received {hash} onOpen={openTool} />
  {:else}
    <Home onOpen={openTool} />
  {/if}
</main>

<footer class="muted">
  Open source, AGPL-3.0. Powered by qpdf, MuPDF, Ghostscript, pdf-lib and the Squoosh codecs.
</footer>

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px max(16px, calc((100vw - 1120px) / 2));
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 18px;
    color: var(--text);
    text-decoration: none;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 800;
  }
  .badge {
    margin-left: auto;
    font-size: 13px;
    color: var(--success);
    background: var(--success-soft);
    padding: 4px 10px;
    border-radius: 999px;
  }
  main {
    max-width: 1120px;
    margin: 0 auto;
    padding: 24px 16px 64px;
  }
  footer {
    text-align: center;
    font-size: 13px;
    padding: 24px 16px 40px;
  }
  @media (max-width: 560px) {
    .badge {
      display: none;
    }
    header .icon-btn {
      margin-left: auto;
    }
  }
</style>
