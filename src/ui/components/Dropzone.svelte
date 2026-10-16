<!--
  Drop area + file picker. Also accepts pasted files (Ctrl/Cmd+V) when `paste` is set.
-->
<script lang="ts">
  let {
    accept,
    multiple = true,
    label = 'Drop files here',
    compact = false,
    paste = false,
    onFiles,
  }: {
    accept: string;
    multiple?: boolean;
    label?: string;
    compact?: boolean;
    paste?: boolean;
    onFiles: (files: File[]) => void;
  } = $props();

  let over = $state(false);
  let input: HTMLInputElement;

  function take(list: FileList | null | undefined) {
    const files = [...(list ?? [])];
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  }

  $effect(() => {
    if (!paste) return;
    const onPaste = (e: ClipboardEvent) => take(e.clipboardData?.files);
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  });
</script>

<div
  class="zone"
  class:over
  class:compact
  role="button"
  tabindex="0"
  ondragover={(e) => {
    e.preventDefault();
    over = true;
  }}
  ondragleave={() => (over = false)}
  ondrop={(e) => {
    e.preventDefault();
    over = false;
    take(e.dataTransfer?.files);
  }}
  onclick={() => input.click()}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && input.click()}
>
  <input bind:this={input} type="file" {accept} {multiple} hidden onchange={(e) => take(e.currentTarget.files)} />
  {#if !compact}<div class="big" aria-hidden="true">⬆</div>{/if}
  <div class="label">{label}</div>
  <div class="hint muted">or <span class="link">choose {multiple ? 'files' : 'a file'}</span>{paste ? ' · you can also paste' : ''}</div>
</div>

<style>
  .zone {
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 48px 20px;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .zone.compact {
    padding: 18px 20px;
  }
  .zone:hover,
  .zone.over {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .big {
    width: 56px;
    height: 56px;
    margin: 0 auto 12px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 26px;
  }
  .label {
    font-weight: 600;
    font-size: 17px;
  }
  .compact .label {
    font-size: 15px;
    font-weight: 500;
  }
  .hint {
    font-size: 14px;
    margin-top: 4px;
  }
  .link {
    color: var(--accent);
    text-decoration: underline;
  }
</style>
