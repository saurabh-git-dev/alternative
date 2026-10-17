/**
 * URLs of files served from /vendor/… (see VENDOR_FILES in vite.config.ts):
 * WASM cores and models that engines fetch at runtime rather than import.
 */

/** The app's root URL, valid from both pages (/ and /it/) and module workers. */
export function appRoot(): string {
  // Workers live under /assets/ in the build and /src/core/ in dev.
  const here = self.location.href;
  const cut = here.search(/\/(assets|src)\//);
  return cut >= 0 ? here.slice(0, cut + 1) : new URL('./', here).href.replace(/\/it\/$/, '/');
}

/** Absolute URL of a vendor path, e.g. `vendorUrl('ort/')`. */
export function vendorUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}vendor/${path}`, appRoot()).href;
}
