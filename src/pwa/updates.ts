/**
 * The app's version, its source code, and whether a newer release is out.
 * Each merge to main publishes a GitHub release with the apps
 * (.github/workflows/release.yml); the footer links to it when it is newer
 * than the version running here, e.g. an installed app or a site still
 * served from an old offline copy.
 *
 * Checking asks GitHub's API for the latest release's version, at most twice
 * a day, and sends nothing about you or your files.
 */
export const APP_VERSION = __APP_VERSION__;
export const REPO_URL = 'https://github.com/saurabh-git-dev/alternative';
export const RELEASES_URL = `${REPO_URL}/releases/latest`;

const LATEST_API = 'https://api.github.com/repos/saurabh-git-dev/alternative/releases/latest';
const CACHE_KEY = 'tools.latest-release';
const CHECK_EVERY = 12 * 60 * 60 * 1000;

/** Compare two versions like "1.10.2" and "v1.9.0": negative if a is older. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** The latest release's version (without the "v"), or null when offline or unknown. */
async function latestVersion(): Promise<string | null> {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { version: string; at: number } | null;
    if (cached && Date.now() - cached.at < CHECK_EVERY) return cached.version;
  } catch {
    // Storage blocked or garbled: just ask again.
  }
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const { tag_name } = (await res.json()) as { tag_name?: string };
    if (!tag_name) return null;
    const version = tag_name.replace(/^v/, '');
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ version, at: Date.now() }));
    } catch {
      // Not saved; the next visit asks again.
    }
    return version;
  } catch {
    return null;
  }
}

/** The newer release's version, if there is one. */
export async function newerRelease(): Promise<string | null> {
  const latest = await latestVersion();
  return latest && compareVersions(latest, APP_VERSION) > 0 ? latest : null;
}
