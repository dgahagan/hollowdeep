# Orchestration Playbook — Rules of Engagement

How orchestrated implementation plans are written (`/impl-plan`) and executed
(`/run-plan`) in this repo. Design plans live at `docs/<name>-plan.md`,
implementation plans at `docs/<name>-implementation-plan.md`, work happens on
`feat/<name>`.

## Project bindings

**Verification gate** (run after every task, from the repo root):

```bash
npm run typecheck   # tsc --noEmit, strict — 0 errors
npm run lint        # ESLint (flat config) — 0 errors
npm test            # Vitest, headless — 100% pass
npm run validate    # module schema + consistency checks on adventures/*
npm run build       # vite build — succeeds
```

`npm run gate` runs all five in order and is the canonical gate. There is no
database or external service; tests must stay deterministic (seeded RNG only —
no `Date.now()`/`Math.random()` in engine code paths) and fast.

**Bootstrap caveat:** until the scaffold task of the first implementation plan
lands, these scripts do not exist. For pre-scaffold tasks the gate is defined
by that task's acceptance criteria; from the scaffold task onward the full gate
applies. The repo may also need `git init` — the first plan's setup task covers
this.

**Conventions** (see `CLAUDE.md` for architecture):

- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, …).
  **No `Co-Authored-By` lines.**
- TypeScript strict mode; no `any` (use `unknown` + narrowing/zod).
- `src/engine/**` is headless: no React, no DOM globals, no browser APIs
  (enforced by lint). All engine state is plain JSON-serializable data.
- Adventure content is data under `adventures/<id>/`; engine code must never
  reference a specific adventure except in tests/fixtures.

## Model policy

| Model | Use for |
|-------|---------|
| `opus` | Orchestration, design-sensitive logic (parser resolution, turn pipeline, save migration), final integration + docs. The orchestrator does `opus` tasks itself. |
| `sonnet` | Bulk implementation and test-writing. |
| `haiku` | Mechanical edits (renames, boilerplate wiring, doc touch-ups). |

## Task rules

- Tasks are small and verifiable — roughly one focused conventional commit each,
  with exact expected files, crisp acceptance criteria (name the tests/gate),
  and an explicit dependency order.
- `parallel-safe` may be marked only when a task's files are disjoint from the
  task(s) it could run beside. When in doubt, serialize.
- Scope comes from the design plan's active sections only. Deferred/blocked
  items are listed as out of scope, not tasked. A necessary mechanical
  consequence of an in-scope change is not new scope: make it, keep the gate
  green, note it in the commit.

## Execution loop (summary — `/run-plan` is authoritative)

1. Branch `feat/<name>`; establish a green baseline with the full gate before
   touching anything. Never proceed on red.
2. Per task: spawn a subagent of the task's model with scope, files, acceptance
   criteria, and the relevant design-plan section. Review the diff, then run the
   gate yourself — a subagent's self-report is never the gate.
3. Green → commit with the task's message, tick the task in the Progress
   Tracker with the commit's short SHA, commit the tracker update, push (if a
   remote exists; this repo may be local-only — skip push in that case).
   Red → send the failure back to the same-model subagent (or fix trivia
   yourself). **Never commit red.**
4. Stop and ask the human when acceptance can't be met, a design point is
   genuinely ambiguous, or a real product bug surfaces. Don't guess; don't
   expand scope.
5. Done = every box ticked, full gate green, design plan marked `IMPLEMENTED`,
   status reported. Opening a PR / merging is the human's call.

The committed Progress Tracker is the source of truth; a fresh session must be
able to resume from it alone.
