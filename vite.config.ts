import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

// Vitest config lives inline here (via `defineConfig` from 'vitest/config',
// which merges Vite's UserConfig with the `test` key's types) rather than in
// a separate vitest.config.ts — see foundation-plan.md §3.

/**
 * Publishes `adventures/` → `public/adventures/` (design plan §7, T24) so the
 * browser can `fetch()` module documents that `npm run validate` reads
 * straight off disk. `public/adventures/` is gitignored — it is generated,
 * never the source of truth — and `eslint.config.js` already ignores it.
 *
 * Runs from `buildStart`, which fires once for `vite build` AND once when the
 * dev server starts (Vite's plugin container invokes it during server
 * startup too), so both `npm run dev` and `npm run build` end up with a fresh
 * copy without a separate `npm run` step. The directory is wiped and
 * recreated each time rather than merged, so a document deleted from
 * `adventures/` doesn't linger as a stale file the browser can still fetch.
 */
function copyAdventuresPlugin(): Plugin {
  const srcDir = path.resolve(import.meta.dirname, 'adventures');
  const destDir = path.resolve(import.meta.dirname, 'public/adventures');

  return {
    name: 'copy-adventures',
    buildStart() {
      if (!existsSync(srcDir)) return;
      rmSync(destDir, { recursive: true, force: true });
      mkdirSync(destDir, { recursive: true });
      cpSync(srcDir, destDir, { recursive: true });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves this project site from a subpath
  // (https://dgahagan.github.io/hollowdeep/), so every asset and runtime
  // `fetch()` must be rooted at `/hollowdeep/`, not `/`. Setting `base` here
  // makes Vite rewrite index.html + bundled asset URLs, and exposes the prefix
  // to app code as `import.meta.env.BASE_URL` (used by fetchReader and the art
  // URL builders). It applies in dev and preview too, so paths behave
  // identically everywhere. Kept in sync with the `/hollowdeep/` prefix in
  // `src/app/fonts.css`; update both together if the repo is ever renamed.
  base: '/hollowdeep/',
  plugins: [react(), copyAdventuresPlugin()],
  test: {
    environment: 'node',
    // Defaults plus `.claude/**`: orchestration parks git worktrees under
    // .claude/worktrees/ during parallel tasks, and each contains a full
    // copy of tests/ that must not run (or double-count) from this checkout.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
