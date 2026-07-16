import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest config lives inline here (via `defineConfig` from 'vitest/config',
// which merges Vite's UserConfig with the `test` key's types) rather than in
// a separate vitest.config.ts — see foundation-plan.md §3.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
