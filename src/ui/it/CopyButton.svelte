<!-- Copies `text` and confirms with a tick for a moment. -->
<script lang="ts">
  let { text, label = 'Copy', primary = false }: { text: string; label?: string; primary?: boolean } = $props();
  let done = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Old browsers and some embedded views: fall back to a hidden text area.
      const area = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    done = true;
    setTimeout(() => (done = false), 1200);
  }
</script>

<button class="it-mini" class:primary disabled={!text} onclick={copy} title="Copy to clipboard">{done ? '✓ Copied' : label}</button>
