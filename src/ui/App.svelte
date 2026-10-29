<!--
  App shell: header and a tiny hash router.
  Routes: `#/` (the section's home), `#/tool/<action id>`, `#/share`, share
  links `#/s/<data>` / `#/q/<data>` (see core/share.ts), connected devices
  `#/connect[/…]` and `#/d/<invite>` (see connect/ConnectPage.svelte; the
  old `#/direct`, `#/direct/receive` and `#/scan` open it too),
  `#/pipeline[/<data>]` (see core/pipeline.ts) and `#/compare`. Hash routing
  works on any static host with no server configuration.

  The same app serves every section (see ui/section.ts): the Dashboard at the
  root, then `pdf/`, `image/`, `video/`, `record/` and `it/`. `#/` is each
  section's home; `#/<tool id>[/<state>]` opens an IT tool (see
  it/registry.ts), and `#/tool/<video tool>/recording/<id>` opens a video
  tool with a saved recording loaded. Every other route works everywhere,
  and the header highlights the section of whatever is open.

  Connect includes chat and voice and video calls (see
  connect/calls.svelte.ts). In the native apps (src-tauri/) it has two more
  tabs (see connect/ConnectTabs.svelte): A2B, a page for browsers on the
  network (`#/lan`, connect/BrowserSharePage.svelte), and A2A, Local share
  with other apps (`#/local[/…]`, connect/LocalPage.svelte): devices on the
  same network, paired with a PIN, with chat, files and calls.

  On narrow screens the section menu moves to a row of its own under the
  logo and scrolls sideways.
-->
<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import Route from './Route.svelte';
  import TabBar from './components/TabBar.svelte';
  import ShareDialog from './connect/ShareDialog.svelte';
  import { startIncomingShare } from './connect/incoming-share.svelte';
  import AskDialog from './connect/AskDialog.svelte';
  import PairPinDialog from './connect/PairPinDialog.svelte';
  import { localHub, startLocal } from './connect/local.svelte';
  import Notice from './connect/Notice.svelte';
  import TextEditor from './connect/TextEditor.svelte';
  import CallPanel from './connect/CallPanel.svelte';
  import { enableCalls } from './connect/calls.svelte';
  import { SECTIONS, SECTION_INFO, sectionHref, type Section } from './section';
  import { describeRoute, parseRoute, sectionOfRoute } from './routes';
  import { MAX_TABS, activate, currentTab, followHash, handFiles, navigate, openTab, shownTabs, workspace } from './tabs.svelte';
  import { connectedCount, hub, liveDevices } from './connect/devices.svelte';
  import { loadTheme, saveTheme, type Theme } from './settings';
  import { canInstall, install, isNativeApp } from '../pwa/install.svelte';

  const native = isNativeApp();
  enableCalls();
  if (native) {
    startLocal();
    startIncomingShare();
  }
  let theme = $state<Theme>(loadTheme());

  const tab = $derived(currentTab());
  const route = $derived(parseRoute(tab.hash, native));
  /** The section of what's open: highlighted in the menu, and picks the footer. */
  const current = $derived<Section>(sectionOfRoute(route, tab.section));

  // Split view needs room: two tabs side by side from 900px, three from 1500px.
  const wide = new MediaQuery('min-width: 900px');
  const wider = new MediaQuery('min-width: 1500px');
  const panes = $derived(wider.current ? 3 : wide.current ? 2 : 1);
  const shown = $derived(shownTabs(panes));
  const split = $derived(shown.length > 1);

  const scrollToTop = () => (split ? document.getElementById(`pane-${tab.id}`)?.scrollTo(0, 0) : scrollTo(0, 0));

  $effect(() => {
    const onHash = () => {
      followHash();
      scrollToTop();
    };
    // Back or forward to an entry with the same hash but another section (e.g. Dashboard ← IT tools).
    const onPop = () => followHash();
    addEventListener('hashchange', onHash);
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('hashchange', onHash);
      removeEventListener('popstate', onPop);
    };
  });

  /** Where each section's page is, to open its links in the tab instead of loading the page. */
  const sectionPaths = SECTIONS.map((s) => ({ section: s, path: new URL(sectionHref(s), location.href).pathname }));

  $effect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href);
      if (url.origin !== location.origin) return;
      // Menu links name their section; other links to `#/…` here stay ordinary hash links.
      const to = (a.dataset.section as Section | undefined) ?? (url.pathname !== location.pathname ? sectionPaths.find((p) => p.path === url.pathname)?.section : undefined);
      if (!to) return;
      e.preventDefault();
      navigate(to, url.hash || '#/');
      scrollToTop();
    };
    addEventListener('click', onClick);
    return () => removeEventListener('click', onClick);
  });

  const HOME_TITLES: Record<Section, string> = {
    home: 'Tools · PDF, image, video & IT tools in your browser',
    pdf: 'PDF tools',
    image: 'Image tools',
    video: 'Video tools',
    record: 'Screen recorder',
    it: 'IT tools',
  };

  $effect(() => {
    document.title = route.page === 'home' ? HOME_TITLES[tab.section] : `${describeRoute(route, tab.section).title} · ${route.itTool ? 'IT tools' : 'Tools'}`;
  });

  const connected = $derived(connectedCount());
  const nearbyOnline = $derived(localHub.devices.filter((d) => d.linked).length);
  const live = $derived(liveDevices().length);

  /** Sticky bars below the header (search boxes) sit under it: see --header-h. */
  let headerHeight = $state(55);
  $effect(() => {
    document.documentElement.style.setProperty('--header-h', `${headerHeight}px`);
    document.documentElement.style.setProperty('--chrome-h', `${headerHeight}px`);
  });

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    saveTheme(theme);
  }

  function openTool(id: string, files: File[] = []) {
    handFiles(files);
    location.hash = `#/tool/${id}`;
  }
</script>

<header bind:clientHeight={headerHeight}>
  <a class="logo" href={sectionHref('home')} data-section="home">
    <span class="mark" aria-hidden="true">T</span>
    <span class="name">Tools</span>
  </a>
  <nav class="sections" aria-label="Sections">
    {#each SECTIONS as s (s)}
      <a
        href={sectionHref(s)}
        data-section={s}
        class:active={current === s}
        aria-current={current === s ? 'page' : undefined}
        title={SECTION_INFO[s].home}
        {@attach (el) => {
          if (current === s) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }}
      >
        <span aria-hidden="true">{SECTION_INFO[s].icon}</span> {SECTION_INFO[s].label}
      </a>
    {/each}
  </nav>
  <span class="badge" title="Every tool runs inside your browser using WebAssembly. Nothing is uploaded.">
    🔒 Files never leave your device
  </span>
  <!-- Connected devices stay connected across pages; a green dot (or a count, for several) shows it. -->
  <a
    class="scan"
    class:live={connected + nearbyOnline > 0}
    class:active={route.page === 'connect' || route.page === 'local' || route.page === 'lan'}
    href="#/connect"
    title={connected + nearbyOnline ? `${connected + nearbyOnline} device${connected + nearbyOnline > 1 ? 's' : ''} connected` : live ? 'Reconnecting to your device' : 'Connect your phone or another computer to send files and text'}
  >
    <span class="link-icon" aria-hidden="true">🔗</span>
    <span class="label">Connect</span>
    {#if connected + nearbyOnline > 1}
      <span class="count">{connected + nearbyOnline}</span>
    {:else if connected + nearbyOnline === 1}
      <span class="dot" aria-hidden="true"></span>
    {:else if live}
      <span class="dot waiting" aria-hidden="true"></span>
    {/if}
  </a>
  {#if canInstall()}
    <button class="install" onclick={install} title="Install Tools as an app. It opens in its own window and works offline.">
      ⬇️ <span>Install</span>
    </button>
  {/if}
  {#if workspace.tabs.length < 2}
    <button class="icon-btn" onclick={() => openTab()} disabled={workspace.tabs.length >= MAX_TABS} aria-label="New tab" title="New tab: keep this page open and use another tool beside it">＋</button>
  {/if}
  <button class="icon-btn" onclick={toggleTheme} aria-label="Switch to {theme === 'dark' ? 'light' : 'dark'} theme">
    {theme === 'dark' ? '☀️' : '🌙'}
  </button>
  {#if workspace.tabs.length > 1}
    <TabBar {native} canSplit={panes > 1} {shown} />
  {/if}
</header>

<!-- Every tab stays mounted so it keeps its state; only the ones on screen are shown. -->
<main class:split style:--panes={shown.length}>
  {#each workspace.tabs as t (t.id)}
    {@const visible = shown.includes(t)}
    <!-- svelte-ignore a11y_no_static_element_interactions (pointer only: picks the tab in use, as a click on its tab would) -->
    <div
      class="pane"
      class:current={t.id === workspace.active}
      id="pane-{t.id}"
      hidden={!visible}
      onpointerdowncapture={() => activate(t.id)}
      ondragentercapture={() => activate(t.id)}
    >
      <Route tab={t} active={t.id === workspace.active} {native} onOpen={openTool} />
    </div>
  {/each}
</main>

<Notice onOpen={openTool} />
<CallPanel />
<AskDialog />
{#if native}
  <PairPinDialog />
  <ShareDialog onOpen={openTool} />
{/if}
{#if hub.editing}
  {#key hub.editing.file}
    <TextEditor file={hub.editing.file} device={hub.editing.device} />
  {/key}
{/if}

<footer class="muted">
  {#if current === 'it'}
    Open source, AGPL-3.0. Every tool runs in your browser; nothing you type is sent anywhere.
  {:else if current === 'video'}
    Open source, AGPL-3.0. Powered by WebCodecs (via Mediabunny), ffmpeg.wasm and gifenc.
  {:else if current === 'record'}
    Open source, AGPL-3.0. Recorded with your browser's MediaRecorder and kept in its own storage.
  {:else if current === 'image'}
    Open source, AGPL-3.0. Powered by the Squoosh codecs, Tesseract and ONNX Runtime.
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
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
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
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .sections::-webkit-scrollbar {
    display: none;
  }
  .sections a {
    flex: none;
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
    white-space: nowrap;
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
  .install {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
  }
  .install:hover {
    border-color: var(--accent);
  }
  .scan.live {
    border-color: var(--success);
  }
  .scan.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .scan .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 0 3px var(--success-soft);
  }
  .scan .dot.waiting {
    background: var(--warning);
    box-shadow: none;
  }
  .scan .count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 99px;
    background: var(--success);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    text-align: center;
  }
  main {
    max-width: 1120px;
    margin: 0 auto;
    padding: 24px 16px 64px;
  }
  /* Split view: tabs side by side, each scrolling on its own, using the whole width. */
  main.split {
    max-width: none;
    display: grid;
    grid-template-columns: repeat(var(--panes), minmax(0, 1fr));
    gap: 12px;
    padding: 12px;
  }
  .split .pane {
    /* Sticky bars inside a pane stick to its top, not under the header. */
    --header-h: 0px;
    height: calc(100dvh - var(--chrome-h, 55px) - 24px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px 14px 32px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }
  .split .pane.current {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .pane[hidden] {
    display: none;
  }
  footer {
    text-align: center;
    font-size: 13px;
    padding: 24px 16px 40px;
  }
  @media (max-width: 1180px) {
    .badge {
      display: none;
    }
    .scan {
      margin-left: auto;
    }
  }
  /*
   * Narrow screens: logo and buttons on top, the section menu on a row of its
   * own below, full width and scrolling sideways (the open section is
   * scrolled into view).
   */
  @media (max-width: 860px) {
    header {
      flex-wrap: wrap;
      gap: 8px 10px;
      padding-bottom: 8px;
    }
    .sections {
      order: 1;
      width: 100%;
      border-radius: 12px;
      scroll-snap-type: x proximity;
    }
    .sections a {
      scroll-snap-align: start;
      padding: 6px 12px;
      border-radius: 9px;
    }
  }
  @media (max-width: 560px) {
    main {
      padding-top: 16px;
    }
    header {
      padding-top: 10px;
    }
    .scan .label,
    .install span {
      display: none;
    }
    .scan {
      padding: 5px 9px;
    }
    .install {
      padding: 5px 9px;
    }
    .sections a {
      font-size: 13.5px;
      padding: 6px 10px;
    }
  }
</style>
