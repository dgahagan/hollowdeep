import { afterEach, describe, expect, it, vi } from 'vitest';
import { preloadImages } from '../../src/app/preload';

// Headless coverage for preload.ts (T5, ui-plan §9's "Scene swap < 200 ms").
// Deliberately no jsdom/RTL (standing rule #2) — vitest's `node` environment
// (vite.config.ts) has no global `Image`, which is exactly the case the
// module's own `typeof Image === 'undefined'` guard exists for, so the first
// test below covers that path directly. The dedup test stubs a minimal
// `Image` in to observe the fetch-triggering side effect (`.src` assignment)
// without needing a real browser.

class FakeImage {
  src = '';
}

describe('preload — preloadImages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a safe no-op under node (no global Image)', () => {
    expect(() => preloadImages(['/adventures/x/art/a.webp'])).not.toThrow();
  });

  it('warms the cache for each URL exactly once, deduping repeats', () => {
    const created: FakeImage[] = [];
    vi.stubGlobal(
      'Image',
      class extends FakeImage {
        constructor() {
          super();
          created.push(this);
        }
      },
    );

    // A fresh URL per test run (the module-level `requested` Set persists for
    // the life of the process) so this test's assertions aren't polluted by
    // another test's calls.
    const unique = `/adventures/x/art/unique-${Math.random()}.webp`;
    preloadImages([unique, unique]);
    preloadImages([unique]);

    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe(unique);
  });

  it('requests each distinct URL in a batch', () => {
    const created: FakeImage[] = [];
    vi.stubGlobal(
      'Image',
      class extends FakeImage {
        constructor() {
          super();
          created.push(this);
        }
      },
    );

    const a = `/adventures/x/art/a-${Math.random()}.webp`;
    const b = `/adventures/x/art/b-${Math.random()}.webp`;
    preloadImages([a, b]);

    expect(created.map((image) => image.src).sort()).toEqual([a, b].sort());
  });
});
