<!--
  QR code generator for text, links and Wi-Fi logins (scan to join the
  network). Reuses the Share page's QR component: full screen view and PNG
  download included.
-->
<script lang="ts">
  import QRCode from 'qrcode';
  import QrCode from '../../components/QrCode.svelte';
  import type { QrErrorCorrection } from '../../../core/share';
  import { loadItOptions, saveItOptions } from '../../settings';

  let { initial = '' }: { initial?: string } = $props();

  const saved = loadItOptions('qr');
  let mode = $state<'text' | 'wifi'>(saved.mode === 'wifi' ? 'wifi' : 'text');
  // svelte-ignore state_referenced_locally
  let text = $state(initial || 'https://saurabh-git-dev.github.io/alternative/it/');
  let ssid = $state('');
  let wifiPassword = $state('');
  let security = $state<'WPA' | 'WEP' | 'nopass'>('WPA');
  let hidden = $state(false);
  let level = $state<QrErrorCorrection>((['L', 'M', 'Q'] as const).includes(saved.level as QrErrorCorrection) ? (saved.level as QrErrorCorrection) : 'M');

  $effect(() => saveItOptions('qr', { mode, level }));

  /** Wi-Fi QR format (as read by Android and iOS cameras); \ ; , : " are escaped. */
  const esc = (s: string) => s.replace(/([\;,:"])/g, '\\$1');
  const content = $derived(
    mode === 'text'
      ? text
      : ssid
        ? `WIFI:T:${security};S:${esc(ssid)};${security !== 'nopass' ? `P:${esc(wifiPassword)};` : ''}${hidden ? 'H:true;' : ''};`
        : '',
  );
  const tooBig = $derived.by(() => {
    if (!content) return false;
    try {
      QRCode.create(content, { errorCorrectionLevel: level });
      return false;
    } catch {
      return true;
    }
  });
</script>

<div class="it-panes">
  <section class="card it-pane">
    <div class="it-segmented">
      <button class:active={mode === 'text'} onclick={() => (mode = 'text')}>Text or link</button>
      <button class:active={mode === 'wifi'} onclick={() => (mode = 'wifi')}>Wi-Fi</button>
    </div>
    {#if mode === 'text'}
      <textarea class="it-text" bind:value={text} placeholder="Text or https:// link" spellcheck="false" aria-label="QR code content"></textarea>
    {:else}
      <label class="it-field col"><span>Network name (SSID)</span><input class="it-input plain" bind:value={ssid} autocomplete="off" /></label>
      <label class="it-field col">
        <span>Security</span>
        <select bind:value={security}>
          <option value="WPA">WPA / WPA2 / WPA3</option>
          <option value="WEP">WEP</option>
          <option value="nopass">None (open)</option>
        </select>
      </label>
      {#if security !== 'nopass'}
        <label class="it-field col"><span>Password</span><input class="it-input plain" type="password" bind:value={wifiPassword} autocomplete="off" /></label>
      {/if}
      <label class="it-field"><input type="checkbox" bind:checked={hidden} /> Hidden network</label>
      <p class="it-help">Guests point their phone camera at the code to join. Nothing leaves this device.</p>
    {/if}
    <label class="it-field">
      <span>Sturdiness</span>
      <select bind:value={level}>
        <option value="L">Normal (holds most)</option>
        <option value="M">Sturdier</option>
        <option value="Q">Sturdiest (for print)</option>
      </select>
    </label>
  </section>
  <section class="card it-pane">
    {#if !content}
      <p class="it-help">{mode === 'wifi' ? 'Enter the network name to get a code.' : 'Type something to get a code.'}</p>
    {:else if tooBig}
      <p class="it-error">Too much for one QR code. Shorten the text, or lower the sturdiness. For larger content, use “Share text as QR code”, which compresses it.</p>
    {:else}
      <QrCode prefix={content} payload="" {level} name={mode === 'wifi' ? `wifi-${ssid}` : 'qr-code'} />
    {/if}
  </section>
</div>

<style>
  .col {
    display: grid;
    gap: 4px;
  }
</style>
