// A `read(path)` adapter satisfying `loadAdventure`'s injected-reader contract
// (design plan §7, T6/T24). The loader never fetches or touches the DOM
// itself — it is under the engine-purity lint override — so the browser
// caller (this file) supplies the actual `fetch`.
//
// `loadAdventure(read, baseDir)` builds paths as `${baseDir}/${filename}`,
// e.g. `adventures/test-cave/manifest.json` for `baseDir = 'adventures/test-cave'`.
// Those documents are served from `public/adventures/` (copied there by
// `vite.config.ts`'s `copy-adventures` plugin), which Vite serves at the site
// root — so the path only needs a leading slash to become a real URL.

/** A `read(path)` function backed by `fetch`, for `loadAdventure` in the browser. */
export async function fetchReader(path: string): Promise<string> {
  const url = path.startsWith('/') ? path : `/${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch "${url}" failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}
