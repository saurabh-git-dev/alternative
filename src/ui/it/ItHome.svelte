<!--
  IT tools home: every developer utility on one compact screen, grouped by
  category, with search (see ToolCatalog).
  The last panel links to sharing and transfers, which work the same here as
  in the PDF & image section.
-->
<script lang="ts">
  import { IT_CATEGORIES, IT_TOOLS } from '../../it/registry';
  import { FILES_HOME } from '../section';
  import ToolCatalog, { type CatalogEntry } from '../components/ToolCatalog.svelte';
  import { otherSectionTools } from '../other-tools';

  const SHARE: CatalogEntry[] = [
    { key: 'share', icon: '🔗', title: 'Share text as QR code', description: 'Put text, JSON or a small file into a QR code and link.', keywords: 'send phone qr', group: 'share', href: '#/share' },
    { key: 'connect', icon: '🔗', title: 'Connect a device', description: 'Send files and text to your phone or another computer, any size, either way.', keywords: 'transfer airdrop receive phone scan qr camera chat', group: 'share', href: '#/connect' },
  ];

  const entries: CatalogEntry[] = [
    ...IT_TOOLS.map((t) => ({ key: t.id, icon: t.icon, title: t.title, description: t.description, keywords: t.keywords, group: t.category, href: `#/${t.id}` })),
    ...SHARE,
  ];
  const GROUPS = [...IT_CATEGORIES, { id: 'share', label: 'Share & transfer', icon: '✨' }];
</script>

<section class="hero">
  <h1>Developer tools, right in your browser</h1>
  <p class="muted">Encoders, converters, generators and more. Everything runs on your device; nothing is sent anywhere.</p>
</section>

<ToolCatalog {entries} groups={GROUPS} others={otherSectionTools()} placeholder="Search tools, e.g. “json” or “uuid”" label="Search IT tools">
  {#snippet empty()}look in the <a href={FILES_HOME}>PDF & image tools</a>{/snippet}
</ToolCatalog>

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
  @media (max-width: 560px) {
    .hero p {
      display: none;
    }
  }
</style>
