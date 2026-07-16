// @ts-check
// ESLint 9 flat config — see docs/foundation-plan.md §3 ("Repo scaffold &
// tooling" — engine purity enforcement, determinism) for the design this file
// implements.
//
// Layers, in order:
//   1. Global ignores.
//   2. Plain-JS handling for this file itself (no type-aware parsing needed).
//   3. Type-aware TypeScript linting (typescript-eslint) + React + React
//      Hooks rules for the whole TS/TSX source tree.
//   4. eslint-config-prettier, to turn off stylistic rules that would fight
//      Prettier. Prettier itself is never run as a lint rule.
//   5. The architectural contract as lint: an override for `src/engine/**`
//      and `src/loader.ts` that makes the engine-purity and determinism
//      rules from the design plan machine-enforced instead of merely
//      documented. `src/app/**` is deliberately untouched by this override —
//      React and DOM are legitimate there.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

/** Directories/files the engine-purity + determinism override applies to. */
const ENGINE_FILES = ['src/engine/**/*.{ts,tsx}', 'src/loader.ts'];

const DETERMINISM_HINT =
  'the engine is deterministic given its seed (design plan §3) — use the seeded RNG in GameState instead';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'public/adventures/**', 'coverage/**'],
  },

  // This config file is plain JS and isn't part of any tsconfig project, so
  // it gets ordinary (non-type-aware) linting rather than being pulled into
  // the type-aware TypeScript block below.
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
  },

  // Type-aware TypeScript linting + React rules for real project sources.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Disables ESLint stylistic rules that would conflict with Prettier.
  // Prettier itself is never run as a lint rule — formatting is `prettier
  // --write`'s job, not `eslint`'s.
  prettierConfig,

  // --- Engine purity + determinism guards (design plan §3) -----------------
  //
  // `src/engine/**` and `src/loader.ts` are the headless core: no React, no
  // DOM/browser globals, no wall-clock time, no unseeded randomness. Every
  // rule below names its escape hatch so a blocked import/call tells you
  // where the real fix lives instead of just saying no.
  {
    files: ENGINE_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                'the engine is headless (design plan §3) — React belongs in src/app, not src/engine or src/loader.ts',
            },
            {
              name: 'react-dom',
              message:
                'the engine is headless (design plan §3) — React DOM belongs in src/app, not src/engine or src/loader.ts',
            },
          ],
          patterns: [
            {
              group: ['react/*'],
              message:
                'the engine is headless (design plan §3) — React belongs in src/app, not src/engine or src/loader.ts',
            },
            {
              group: ['react-dom/*'],
              message:
                'the engine is headless (design plan §3) — React DOM belongs in src/app, not src/engine or src/loader.ts',
            },
            {
              group: ['src/app/*', '**/app/*'],
              message:
                'src/engine and src/loader.ts must not depend on src/app (design plan §3) — inject a reader/adapter from src/app into the engine instead, not the other way around',
            },
          ],
        },
      ],

      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message:
            'the engine is headless (design plan §3) — inject a reader/adapter from src/app rather than touching the DOM directly',
        },
        {
          name: 'document',
          message:
            'the engine is headless (design plan §3) — inject a reader/adapter from src/app rather than touching the DOM directly',
        },
        {
          name: 'localStorage',
          message:
            'the engine is headless (design plan §3) — save/load persistence is src/app/storage.ts\'s job; the engine only produces/consumes plain SaveBlob JSON',
        },
        {
          name: 'fetch',
          message:
            'the engine is headless (design plan §3) — src/loader.ts receives a `read(path)` function injected by the caller instead of fetching itself',
        },
      ],

      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: `Date.now() is non-deterministic — ${DETERMINISM_HINT}, or (for save timestamps) take the timestamp as a parameter from the caller`,
        },
        {
          object: 'Math',
          property: 'random',
          message: `Math.random() is non-deterministic — ${DETERMINISM_HINT}`,
        },
      ],

      'no-restricted-syntax': [
        'error',
        {
          // no-restricted-properties can't see `new Date()` — there's no
          // `.property` access to match, just a bare constructor call — so
          // it needs its own AST selector.
          selector: "NewExpression[callee.name='Date']",
          message: `new Date() is non-deterministic — ${DETERMINISM_HINT}, or (for save timestamps) take the timestamp as a parameter from the caller`,
        },
      ],
    },
  },
);
