<!--
  App shell: header and a tiny hash router.
  Routes: `#/` (home), `#/tool/<action id>`, `#/share`, share links
  `#/s/<data>` / `#/q/<data>` (see core/share.ts), connected devices
  `#/connect[/…]` and `#/d/<invite>` (see connect/ConnectPage.svelte; the
  old `#/direct`, `#/direct/receive` and `#/scan` open it too), `#/pipeline[/<data>]`
  (see core/pipeline.ts) and `#/compare`. Hash routing works on any
  static host with no server configuration.

  The same app also serves the Video (`video/`), Screen recorder (`record/`)
  and IT tools (`it/`) sections (see ui/section.ts). `#/` is each section's
  home; in `it/`, `#/<tool id>[/<state>]` opens an IT tool (see
  it/registry.ts), and `#/tool/<video tool>/recording/<id>` opens a video
  tool with a saved recording loaded. Every other route works everywhere.

  `chat/` is unlisted (no link to it, unless this browser switched one on
  from the chat page, see chat-link.svelte.ts): its home page, and its
  `#/connect…` routes, are Connect with voice and video calls (see
  connect/calls.svelte.ts).

  In the native apps (src-tauri/) Connect has two more tabs (see
  connect/ConnectTabs.svelte): A2B, a page for browsers on the network
  (`#/lan`, connect/BrowserSharePage.svelte), and A2A, Local share with
  other apps (`#/local[/…]`, connect/LocalPage.svelte): devices on the same network, paired with
  a PIN, with chat, files and calls. Calls are on everywhere in the apps.
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
  import AskDialog from './connect/AskDialog.svelte';
  import PairPinDialog from './connect/PairPinDialog.svelte';
  import { localHub, startLocal } from './connect/local.svelte';
  import Notice from './connect/Notice.svelte';
  import TextEditor from './connect/TextEditor.svelte';
  import CallPanel from './connect/CallPanel.svelte';
  import { enableCalls } from './connect/calls.svelte';
  import { chatLink } from './chat-link.svelte';
  import ItHome from './it/ItHome.svelte';
  import ItTool from './it/ItTool.svelte';
  import VideoHome from './video/VideoHome.svelte';
  import RecordHome from './record/RecordHome.svelte';
  import { getItTool } from '../it/registry';
  import { CHAT_HOME, FILES_HOME, IT_HOME, RECORD_HOME, VIDEO_HOME, section, type Section } from './section';
  import { PIPELINE_ROUTE } from '../core/pipeline';
  import { LINK_ROUTE, QR_ROUTE } from '../core/share';
  import { DIRECT_ROUTE } from '../core/direct';
  import { getAction } from '../actions';
  import { connectedCount, hub, liveDevices } from './connect/devices.svelte';
  import { loadTheme, saveTheme, type Theme } from './settings';
  import { canInstall, install, isNativeApp } from '../pwa/install.svelte';

  const native = isNativeApp();
  let hash = $state(location.hash);
  if (section === 'chat' || native) enableCalls();
  if (native) startLocal();
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

  /** `#/tool/<id>` or `#/tool/<id>/recording/<recording id>`. */
  const toolRoute = $derived(/^#\/tool\/([^/]+)(?:\/recording\/([\w-]+))?$/.exec(hash));
  const action = $derived(toolRoute ? getAction(decodeURIComponent(toolRoute[1])) : undefined);
  const recordingId = $derived(toolRoute?.[2]);
  /** A recording opened in a tool: loaded from the library, then handed over like dropped files. */
  let opened = $state<{ id: string; ready: boolean; error?: string } | null>(null);
  $effect(() => {
    const id = recordingId;
    if (!id || untrack(() => opened?.id) === id) return;
    opened = { id, ready: false };
    import('./record/open')
      .then(({ recordingFile }) => recordingFile(id))
      .then((file) => {
        pending = [file];
        opened = { id, ready: true };
      })
      .catch((e: unknown) => (opened = { id, ready: false, error: e instanceof Error ? e.message : String(e) }));
  });
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
          : native && (hash === '#/local' || hash.startsWith('#/local/'))
          ? 'local'
          : native && hash === '#/lan'
          ? 'lan'
          : hash === '#/connect' || hash.startsWith('#/connect/') || hash === '#/scan' || hash.startsWith('#/direct') || hash.startsWith(`#${DIRECT_ROUTE}`)
          ? 'connect'
          : hash.startsWith(`#${LINK_ROUTE}`) || hash.startsWith(`#${QR_ROUTE}`) ? 'received' : section === 'chat' ? 'connect' : `${section}-home`,
  );

  const HOME_TITLES: Record<Section, string> = {
    files: 'Tools · PDF, image & IT tools in your browser',
    video: 'Video tools',
    record: 'Screen recorder',
    it: 'IT tools',
    chat: 'Chat',
  };

  $effect(() => {
    document.title = action
      ? `${action.title} · Tools`
      : itTool
      ? `${itTool.title} · IT tools`
      : page.endsWith('-home')
      ? HOME_TITLES[section]
      : page === 'pipeline'
        ? 'Pipeline · Tools'
        : page === 'compare'
        ? 'Compare PDFs · Tools'
        : page === 'share'
        ? 'Share as link or QR · Tools'
        : page === 'local'
        ? 'Local share · Tools'
        : page === 'lan'
        ? 'Share with a browser · Tools'
        : page === 'connect'
        ? section === 'chat' ? 'Chat' : 'Connect devices · Tools'
        : 'Shared file · Tools';
  });

  const SECTIONS: { id: Section; href: string; icon: string; label: string; short: string }[] = [
    { id: 'files', href: FILES_HOME, icon: '📄', label: 'PDF & Image', short: 'Files' },
    { id: 'video', href: VIDEO_HOME, icon: '🎬', label: 'Video', short: 'Video' },
    { id: 'record', href: RECORD_HOME, icon: '⏺️', label: 'Screen recorder', short: 'Record' },
    { id: 'it', href: IT_HOME, icon: '🛠️', label: 'IT tools', short: 'IT' },
  ];
  const CHAT = { id: 'chat' as const, href: CHAT_HOME, icon: '💬', label: 'Chat', short: 'Chat' };
  /** Chat joins the menu only in a browser that switched it on. */
  const shownSections = $derived(chatLink.shown ? [...SECTIONS, CHAT] : SECTIONS);

  const connected = $derived(connectedCount());
  const nearbyOnline = $derived(localHub.devices.filter((d) => d.linked).length);
  const live = $derived(liveDevices().length);

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
    <span class="mark" aria-hidden="true">T</span>
    <span class="name">Tools</span>
  </a>
  <nav class="sections" aria-label="Sections">
    {#each shownSections as s (s.id)}
      <a href={s.href} class:active={section === s.id} aria-current={section === s.id ? 'page' : undefined} title={s.label}>
        <span aria-hidden="true">{s.icon}</span> <span class="long">{s.label}</span><span class="short">{s.short}</span>
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
    class:active={page === 'connect' || page === 'local' || page === 'lan'}
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
  <button class="icon-btn" onclick={toggleTheme} aria-label="Switch to {theme === 'dark' ? 'light' : 'dark'} theme">
    {theme === 'dark' ? '☀️' : '🌙'}
  </button>
</header>

<main>
  {#if action && recordingId && !(opened?.id === recordingId && opened.ready)}
    <p class="muted loading">{opened?.error ? `Couldn't open the recording: ${opened.error}` : 'Opening recording…'}</p>
  {:else if action}
    {#key `${action.id}/${recordingId ?? ''}`}
      <Tool {action} initialFiles={pending} />
    {/key}
  {:else if itTool}
    {#key hash}
      <ItTool tool={itTool} payload={itRoute?.[2]} />
    {/key}
  {:else if page === 'it-home'}
    <ItHome />
  {:else if page === 'video-home'}
    <VideoHome onOpen={openTool} />
  {:else if page === 'record-home'}
    <RecordHome />
  {:else if page === 'pipeline'}
    {#key hash}
      <PipelinePage encoded={hash.slice(PIPELINE_ROUTE.length + 1)} />
    {/key}
  {:else if page === 'compare'}
    <Compare />
  {:else if page === 'share'}
    <Share />
  {:else if page === 'connect'}
    {#if native}<ConnectTabs active="connect" />{/if}
    {#key hash}
      <ConnectPage {hash} onOpen={openTool} calls={section === 'chat'} />
    {/key}
  {:else if page === 'lan'}
    <ConnectTabs active="lan" />
    <BrowserSharePage onOpen={openTool} />
  {:else if page === 'local'}
    <ConnectTabs active="local" />
    <LocalPage {hash} onOpen={openTool} />
  {:else if page === 'received'}
    <Received {hash} onOpen={openTool} />
  {:else}
    <Home onOpen={openTool} />
  {/if}
</main>

<Notice onOpen={openTool} />
{#if section === 'chat' || native}<CallPanel />{/if}
<AskDialog />
{#if native}<PairPinDialog />{/if}
{#if hub.editing}
  {#key hub.editing.file}
    <TextEditor file={hub.editing.file} device={hub.editing.device} />
  {/key}
{/if}

<footer class="muted">
  {#if section === 'it'}
    Open source, AGPL-3.0. Every tool runs in your browser; nothing you type is sent anywhere.
  {:else if section === 'video'}
    Open source, AGPL-3.0. Powered by WebCodecs (via Mediabunny), ffmpeg.wasm and gifenc.
  {:else if section === 'chat'}
    Open source, AGPL-3.0. Chat and calls go straight between your devices, end-to-end encrypted.
  {:else if section === 'record'}
    Open source, AGPL-3.0. Recorded with your browser's MediaRecorder and kept in its own storage.
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
  .sections .short {
    display: none;
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
  .loading {
    text-align: center;
    margin-top: 48px;
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
  @media (max-width: 980px) {
    .badge {
      display: none;
    }
    .scan {
      margin-left: auto;
    }
    .sections .long {
      display: none;
    }
    .sections .short {
      display: inline;
    }
  }
  /* Narrow phones: icons only, except the section you're in. */
  @media (max-width: 420px) {
    .sections a:not(.active) .short {
      display: none;
    }
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
    .scan .label,
    .install span {
      display: none;
    }
    .sections {
      overflow-x: auto;
      scrollbar-width: none;
    }
    .sections a {
      padding: 4px 8px;
      font-size: 13px;
    }
    .sections .long {
      display: none;
    }
    .sections .short {
      display: inline;
    }
    .scan {
      margin-left: auto;
      padding: 5px 9px;
    }
    .install {
      padding: 5px 9px;
    }
  }
</style>
