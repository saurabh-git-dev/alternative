<!--
  IT tools home: every developer utility on one compact screen, grouped by
  category, with search ("/" to focus, Enter opens the first match).
  The last panel links to sharing and transfers, which work the same here as
  in the PDF & image section.
-->
<script lang="ts">
  import { IT_CATEGORIES, IT_TOOLS } from '../../it/registry';
  import { FILES_HOME } from '../section';

  interface Entry {
    key: string;
    icon: string;
    title: string;
    description: string;
    keywords?: string;
    group: string;
    href: string;
  }

  const SHARE: Entry[] = [
    { key: 'share', icon: '🔗', title: 'Share text as QR code', description: 'Put text, JSON or a small file into a QR code and link.', keywords: 'send phone qr', group: 'share', href: '#/share' },
    { key: 'direct', icon: '📡', title: 'Send to your phone', description: 'Any size, either way, end-to-end encrypted.', keywords: 'transfer airdrop', group: 'share', href: '#/direct' },
    { key: 'receive', icon: '📥', title: 'Get files from your phone', description: 'Scan a QR code with your phone and send files here.', keywords: 'receive transfer', group: 'share', href: '#/direct/receive' },
    { key: 'scan', icon: '📷', title: 'Scan a QR code', description: "Read a QR code with this device's camera.", keywords: 'camera scanner reader', group: 'share', href: '#/scan' },
  ];

  const entries: Entry[] = [
    ...IT_TOOLS.map((t) => ({ key: t.id, icon: t.icon, title: t.title, description: t.description, keywords: t.keywords, group: t.category, href: `#/${t.id}` })),
    ...SHARE,
  ];
  const GROUPS = [...IT_CATEGORIES, { id: 'share', label: 'Share & transfer', icon: '✨' }];

  let query = $state('');
  let search: HTMLInputElement;

  const visible = $derived.by(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter((e) => {
      const text = `${e.title} ${e.description} ${e.keywords ?? ''} ${e.group}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && visible[0]) location.hash = visible[0].href.slice(1);
    if (e.key === 'Escape') query = '';
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        search.focus();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
</script>

<section class="hero">
  <h1>Developer tools, right in your browser</h1>
  <p class="muted">Encoders, converters, generators and more. Everything runs on your device; nothing is sent anywhere.</p>
</section>

<div class="bar">
  <input
    bind:this={search}
    class="search"
    type="search"
    placeholder="Search tools, e.g. “json” or “uuid”"
    aria-label="Search IT tools"
    bind:value={query}
    onkeydown={onSearchKey}
  />
</div>

<div class="panels">
  {#each GROUPS as group (group.id)}
    {@const items = visible.filter((e) => e.group === group.id)}
    {#if items.length}
      <section class="panel card">
        <h2><span aria-hidden="true">{group.icon}</span> {group.label}</h2>
        <div class="group">
          {#each items as e (e.key)}
            <a class="tool" href={e.href} title={e.description}>
              <span class="icon" aria-hidden="true">{e.icon}</span>
              <span class="text"><span class="title">{e.title}</span><span class="desc">{e.description}</span></span>
            </a>
          {/each}
        </div>
      </section>
    {/if}
  {/each}
</div>

{#if visible.length === 0}
  <p class="empty muted">No tools match. Try another word, or look in the <a href={FILES_HOME}>PDF & image tools</a>.</p>
{/if}

<style>
  .hero {
    text-align: center;
    padding: 4px 0 0;
  }
  h1 {
    font-size: clamp(21px, 3vw, 30px);
    line-height: 1.2;
    margin: 0 0 4px;
    letter-spacing: -0.02em;
  }
  .hero p {
    margin: 0;
    font-size: 14.5px;
  }
  .bar {
    position: sticky;
    top: 55px;
    z-index: 5;
    max-width: 640px;
    margin: 0 auto;
    padding: 12px 0;
    background: var(--bg);
  }
  .search {
    width: 100%;
    padding: 10px 16px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    box-shadow: var(--shadow);
    font-size: 15px;
  }
  .panels {
    columns: 3 300px;
    column-gap: 16px;
  }
  .panel {
    break-inside: avoid;
    margin-bottom: 16px;
    padding: 12px 10px 10px;
  }
  h2 {
    font-size: 15px;
    margin: 0 6px 6px;
    letter-spacing: -0.01em;
  }
  .tool {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    color: inherit;
    text-decoration: none;
  }
  .tool:hover,
  .tool:focus-visible {
    background: var(--accent-soft);
  }
  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 18px;
    line-height: 1;
  }
  .text {
    display: grid;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    font-size: 14.5px;
    line-height: 1.25;
  }
  .desc {
    color: var(--text-2);
    font-size: 12.5px;
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty {
    text-align: center;
    margin-top: 32px;
  }
  /* Phones: two tiles per row, title only (the description is on the tool page). */
  @media (max-width: 560px) {
    .hero p {
      display: none;
    }
    .bar {
      padding: 10px 0;
    }
    .group {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px 4px;
    }
    .tool {
      padding: 7px 6px;
      gap: 8px;
    }
    .icon {
      width: 30px;
      height: 30px;
      font-size: 17px;
    }
    .title {
      font-size: 13.5px;
    }
    .desc {
      display: none;
    }
  }
</style>
