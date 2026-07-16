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
  plugins: [react(), copyAdventuresPlugin()],
  test: {
    environment: 'node',
  },
});
