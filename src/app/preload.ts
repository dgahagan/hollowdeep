// Headless art-preloading helper (T5, ui-plan §9: "Scene swap < 200 ms:
// preload the art of every exit-adjacent location on arrival"). `ScenePanel`
// calls this on every arrival with the URLs of every location one exit away;
// warming the browser's image cache for those is what makes the NEXT swap
// (whichever exit the player actually takes) instant instead of a network
// round trip.
//
// Deliberately not a React hook: there is nothing here that reads component
// state or needs a cleanup function — it is a fire-and-forget cache warm,
// so a plain function keeps it testable headlessly (standing rule #2) and
// keeps `ScenePanel` from needing an effect dependency on anything but the
// URL list itself.
//
// `new Image()` (rather than a `<link rel="preload">` tag) is the mechanism:
// setting `.src` starts the fetch and drops it straight into the browser's
// image cache under a real `<img>` element's URL-matching rules, with no DOM
// node to mount, track, or ever clean up — the object can be discarded the
// instant its request is in flight.
//
// `typeof Image === 'undefined'` guards the vitest/node environment this
// project's gate runs under (no jsdom harness — see eslint.config.js's header
// and standing rule #2, which keeps the gate fast): importing this module
// under `npm test` must be a safe no-op, not a ReferenceError.

/** URLs already requested this page load — preloading is idempotent per URL. */
const requested = new Set<string>();

/**
 * Warm the browser's image cache for every URL not already requested.
 * Safe to call repeatedly with overlapping lists (e.g. re-entering a
 * location whose neighbors were already preloaded) — already-seen URLs are
 * skipped rather than re-fetched.
 */
export function preloadImages(urls: readonly string[]): void {
  if (typeof Image === 'undefined') return; // non-browser environment — no-op
  for (const url of urls) {
    if (requested.has(url)) continue;
    requested.add(url);
    const image = new Image();
    image.src = url;
  }
}
