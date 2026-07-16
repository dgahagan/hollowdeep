---
description: Execute an orchestrated implementation plan as the Opus orchestrator
argument-hint: docs/<name>-implementation-plan.md
model: opus
---

You are the **orchestrator** for executing an implementation plan, strictly
following this repo's `docs/orchestration-playbook.md`. You spawn
model-appropriate subagents, verify each task yourself, and commit after each
one. You stay in the loop the whole way.

## Input
Implementation plan: **$ARGUMENTS**
(If empty, ask the user which `docs/*-implementation-plan.md` to run, then stop
and wait.)

## Before you start — read, in full
1. The implementation plan at `$ARGUMENTS` (the task graph + Progress Tracker).
2. The design plan it references (`docs/<name>-plan.md`) — the settled WHAT/WHY.
3. `docs/orchestration-playbook.md` — the Rules of Engagement you must obey.
4. `CLAUDE.md` — architecture, the exact gate commands, conventions.

## Then execute the playbook loop
1. **Branch & baseline.** Create or check out `feat/<name>` (per the plan). If
   resuming, `git checkout` it and read the Progress Tracker to find the first
   unchecked task. Establish a **green baseline** — run the full verification gate
   (per CLAUDE.md / the playbook's Project bindings) before touching anything, and
   fix any environment issues (e.g. a stale `node_modules` needing `npm ci`) up
   front. Do not proceed on a red baseline; report it instead. **Bootstrap
   exception:** if the plan's early tasks predate the scaffold, `npm run gate`
   does not exist yet — those tasks' acceptance criteria are the gate, per the
   playbook's bootstrap caveat.
2. **For each unchecked task, in order** (respect `parallel-safe` markers only
   when files are disjoint):
   - Spawn a **subagent of the task's model** (`opus`/`sonnet`/`haiku`) with a
     focused prompt: the task scope, exact files, acceptance criteria, and a
     pointer to the relevant design-plan section. Do the **`opus`-tagged tasks
     yourself** rather than delegating.
   - Review the returned diff. Then **run the verification gate yourself** — never
     treat the subagent's self-report as the gate.
   - **Green →** commit with the task's commit message (no `Co-Authored-By`), tick
     the task's box in the Progress Tracker with the code commit's short SHA, and
     commit that. Push only if a remote exists — this repo is local-only for now,
     so skip it.
   - **Red →** send the failure back to the same-model subagent to fix, or fix
     trivial issues yourself. **Never commit red.**
3. **Stop and ask** the human if a task's acceptance can't be met, a design point
   is genuinely ambiguous, or a real product bug surfaces — do not guess or
   expand scope. A necessary mechanical consequence of an in-scope change is not
   new scope: make it, keep the gate green, note it in the commit.
4. **Finish.** When every box is ticked and the full gate (`npm run gate` —
   typecheck, lint, test, validate, build) is green, update any docs the final task names
   (e.g. mark the design plan `IMPLEMENTED`), then report status and propose next
   steps (open a PR / merge — the human's call; confirm before merging to a
   default branch).

Keep the Progress Tracker as the source of truth throughout — a future session
must be able to resume from it alone. Track your own progress with the task tools
if helpful, but the committed tracker is what matters.
