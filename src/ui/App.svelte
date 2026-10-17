<!--
  App shell: header and a tiny hash router.
  Routes: `#/` (home), `#/tool/<action id>`, `#/share`, share links
  `#/s/<data>` / `#/q/<data>` (see core/share.ts), direct transfers
  `#/direct`, `#/direct/receive` and `#/d/<invite>` (see core/direct.ts),
  `#/scan` (in-app QR scanner), `#/pipeline[/<data>]`
  (see core/pipeline.ts) and `#/compare`. Hash routing works on any
  static host with no server configuration.

  The same app also serves the IT tools section at `it/` (see ui/section.ts):
  there `#/` is the IT home and `#/<tool id>[/<state>]` opens an IT tool
  (see it/registry.ts). Every other route works in both sections.
-->
<script lang="ts">
  import Home from './pages/Home.svelte';
  import Tool from './pages/Tool.svelte';
  import Share from './pages/Share.svelte';
  import Received from './pages/Received.svelte';
  import PipelinePage from './pages/Pipeline.svelte';
  import Compare from './pages/Compare.svelte';
  import Direct from './pages/Direct.svelte';
  import Scan from './pages/Scan.svelte';
  import ItHome from './it/ItHome.svelte';
  import ItTool from './it/ItTool.svelte';
  import { getItTool } from '../it/registry';
  import { FILES_HOME, IT_HOME, section } from './section';
  import { PIPELINE_ROUTE } from '../core/pipeline';
  import { LINK_ROUTE, QR_ROUTE } from '../core/share';
  import { DIRECT_ROUTE } from '../core/direct';
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
  /** `#/<id>` or `#/<id>/<state>` for an IT tool. */
  const itRoute = $derived(/^#\/([a-z0-9-]+)(?:\/(.+))?$/.exec(hash));
  const itTool = $derived(itRoute ? getItTool(itRoute[1]) : undefined);

  const page = $derived(
    action
      ? 'tool'
      : itTool
      ? 'it-tool'
      : hash === PIPELINE_ROUTE || hash.startsWith(`${PIPELINE_ROUTE}/`)
        ? 'pipeline'
        : hash === '#/compare'
          ? 'compare'
          : hash === '#/share'
          ? 'share'
          : hash === '#/scan'
          ? 'scan'
          : hash === '#/direct' || hash === '#/direct/receive' || hash.startsWith(`#${DIRECT_ROUTE}`)
          ? 'direct'
          : hash.startsWith(`#${LINK_ROUTE}`) || hash.startsWith(`#${QR_ROUTE}`) ? 'received' : section === 'it' ? 'it-home' : 'home',
  );

  $effect(() => {
    document.title = action
      ? `${action.title} · Formatter`
      : itTool
      ? `${itTool.title} · IT tools`
      : page === 'it-home'
      ? 'IT tools · Formatter'
      : page === 'pipeline'
        ? 'Pipeline · Formatter'
        : page === 'compare'
        ? 'Compare PDFs · Formatter'
        : page === 'share'
        ? 'Share as link or QR · Formatter'
        : page === 'scan'
        ? 'Scan to connect · Formatter'
        : page === 'direct'
        ? 'Send between devices · Formatter'
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
    <span class="name">Formatter</span>
  </a>
  <nav class="sections" aria-label="Sections">
    <a href={FILES_HOME} class:active={section === 'files'} aria-current={section === 'files' ? 'page' : undefined}><span aria-hidden="true">📄</span> PDF & Image</a>
    <a href={IT_HOME} class:active={section === 'it'} aria-current={section === 'it' ? 'page' : undefined}><span aria-hidden="true">🛠️</span> IT tools</a>
  </nav>
  <span class="badge" title="Every tool runs inside your browser using WebAssembly. Nothing is uploaded.">
    🔒 Files never leave your device
  </span>
  <a class="scan" href="#/scan" title="Scan a QR code from your other device to connect or open a shared file">📷 <span>Scan</span></a>
  <button class="icon-btn" onclick={toggleTheme} aria-label="Switch to {theme === 'dark' ? 'light' : 'dark'} theme">
    {theme === 'dark' ? '☀️' : '🌙'}
  </button>
</header>

<main>
  {#if action}
    {#key action.id}
      <Tool {action} initialFiles={pending} />
    {/key}
  {:else if itTool}
    {#key hash}
      <ItTool tool={itTool} payload={itRoute?.[2]} />
    {/key}
  {:else if page === 'it-home'}
    <ItHome />
  {:else if page === 'pipeline'}
    {#key hash}
      <PipelinePage encoded={hash.slice(PIPELINE_ROUTE.length + 1)} />
    {/key}
  {:else if page === 'compare'}
    <Compare />
  {:else if page === 'share'}
    <Share />
  {:else if page === 'scan'}
    <Scan />
  {:else if page === 'direct'}
    {#key hash}
      <Direct {hash} />
    {/key}
  {:else if page === 'received'}
    <Received {hash} onOpen={openTool} />
  {:else}
    <Home onOpen={openTool} />
  {/if}
</main>

<footer class="muted">
  {#if section === 'it'}
    Open source, AGPL-3.0. Every tool runs in your browser; nothing you type is sent anywhere.
  {:else}
    Open source, AGPL-3.0. Powered by qpdf, MuPDF, Ghostscript, pdf-lib, the Squoosh codecs and ONNX Runtime.
  {/if}
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
  .sections {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 999px;
    background: var(--surface-2);
  }
  .sections a {
    padding: 4px 12px;
    border-radius: 999px;
    color: var(--text-2);
    font-size: 14px;
    font-weight: 550;
    text-decoration: none;
    white-space: nowrap;
  }
  .sections a:hover {
    color: var(--text);
  }
  .sections a.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .badge {
    margin-left: auto;
    font-size: 13px;
    color: var(--success);
    background: var(--success-soft);
    padding: 4px 10px;
    border-radius: 999px;
  }
  .scan {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
    text-decoration: none;
  }
  .scan:hover {
    border-color: var(--accent);
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
    main {
      padding-top: 16px;
    }
    .badge {
      display: none;
    }
    header {
      gap: 8px;
    }
    .logo .name,
    .scan span {
      display: none;
    }
    .sections a {
      padding: 4px 9px;
      font-size: 13px;
    }
    .scan {
      margin-left: auto;
      padding: 5px 9px;
    }
  }
</style>
