import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';

// These tests prove the engine-purity + determinism lint guards from
// `eslint.config.js` (design plan §3 "Engine purity enforcement" /
// "Determinism") actually fire, by running ESLint's Node API against
// in-memory code snippets — never against real files on disk. A
// deliberately-bad fixture file committed under `src/engine/` would turn
// `npm run lint` (and therefore `npm run gate`) red for real, so everything
// here is a virtual `filePath` passed to `lintText`.
//
// Crucially, this harness lints against the REAL `eslint.config.js` — it
// does not duplicate or re-derive the engine-purity rules. ESLint resolves
// that file itself from `cwd` (we never `import` it from this TS file: that
// would fail `tsc --noEmit` with TS7016, since `eslint.config.js` is plain
// untyped JS and this project has no `allowJs`). Resolving it as ESLint's
// own config file, rather than re-implementing its rules here, is what
// makes this a real regression guard: if the engine-purity override block
// is ever weakened or deleted from `eslint.config.js`, these tests fail.
//
// The only thing layered on top of the real config is `disableTypeChecked`
// plus turning off `projectService`, scoped to `**/*.{ts,tsx}` — this
// neutralizes type-aware parsing so the virtual, on-disk-nonexistent
// `filePath`s below can be linted at all (`projectService` would otherwise
// insist on finding each path in a real tsconfig project). None of the
// rules under test (`no-restricted-imports`/`-globals`/`-properties`/
// `-syntax`) need type information, so this costs nothing.

const repoRoot = path.resolve(import.meta.dirname, '..');

function createLinter(): ESLint {
  const overrideConfig: Linter.Config[] = [
    { files: ['**/*.{ts,tsx}'], ...tseslint.configs.disableTypeChecked },
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: { parserOptions: { projectService: false, project: null } },
    },
  ];

  return new ESLint({ cwd: repoRoot, overrideConfig });
}

async function lint(code: string, filePath: string): Promise<Linter.LintMessage[]> {
  const eslint = createLinter();
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages ?? [];
}

function ruleIds(messages: Linter.LintMessage[]): (string | null)[] {
  return messages.map((message) => message.ruleId);
}

describe('engine purity + determinism lint guards', () => {
  it('flags a react import under src/engine/', async () => {
    const messages = await lint(
      "import React from 'react';\nexport const version = React.version;\n",
      'src/engine/example.ts',
    );
    expect(ruleIds(messages)).toContain('no-restricted-imports');
  });

  it('allows the same react import under src/app/', async () => {
    const messages = await lint(
      "import React from 'react';\nexport const version = React.version;\n",
      'src/app/Example.tsx',
    );
    expect(ruleIds(messages)).not.toContain('no-restricted-imports');
  });

  it('flags Math.random() under src/engine/', async () => {
    const messages = await lint(
      'export function roll(): number {\n  return Math.random();\n}\n',
      'src/engine/rng.ts',
    );
    expect(ruleIds(messages)).toContain('no-restricted-properties');
  });

  it('allows the same Math.random() call under src/app/', async () => {
    const messages = await lint(
      'export function roll(): number {\n  return Math.random();\n}\n',
      'src/app/random.ts',
    );
    expect(ruleIds(messages)).not.toContain('no-restricted-properties');
  });

  it('flags a localStorage reference in src/loader.ts', async () => {
    const messages = await lint(
      "export function readSomething(): string | null {\n  return localStorage.getItem('key');\n}\n",
      'src/loader.ts',
    );
    expect(ruleIds(messages)).toContain('no-restricted-globals');
  });

  it('allows the same localStorage reference under src/app/', async () => {
    const messages = await lint(
      "export function readSomething(): string | null {\n  return localStorage.getItem('key');\n}\n",
      'src/app/storage.ts',
    );
    expect(ruleIds(messages)).not.toContain('no-restricted-globals');
  });

  it('flags new Date() under src/engine/', async () => {
    const messages = await lint(
      'export function now(): Date {\n  return new Date();\n}\n',
      'src/engine/clock.ts',
    );
    expect(ruleIds(messages)).toContain('no-restricted-syntax');
  });

  it('allows the same new Date() call under src/app/', async () => {
    const messages = await lint(
      'export function now(): Date {\n  return new Date();\n}\n',
      'src/app/clock.ts',
    );
    expect(ruleIds(messages)).not.toContain('no-restricted-syntax');
  });

  it('flags Date.now() under src/engine/', async () => {
    const messages = await lint(
      'export function nowMs(): number {\n  return Date.now();\n}\n',
      'src/engine/clock-ms.ts',
    );
    expect(ruleIds(messages)).toContain('no-restricted-properties');
  });

  it('allows the same Date.now() call under src/app/', async () => {
    const messages = await lint(
      'export function nowMs(): number {\n  return Date.now();\n}\n',
      'src/app/clock-ms.ts',
    );
    expect(ruleIds(messages)).not.toContain('no-restricted-properties');
  });

  it('flags an src/app import reached from engine code', async () => {
    const messages = await lint(
      "import { helper } from '../app/helper';\nexport const value = helper;\n",
      'src/engine/imports-app.ts',
    );
    expect(ruleIds(messages)).toContain('no-restricted-imports');
  });

  it('allows the same relative import from within src/app/ itself', async () => {
    const messages = await lint(
      "import { helper } from '../app/helper';\nexport const value = helper;\n",
      'src/app/consumer.ts',
    );
    expect(ruleIds(messages)).not.toContain('no-restricted-imports');
  });
});
