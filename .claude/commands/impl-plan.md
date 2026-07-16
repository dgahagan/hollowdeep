---
description: Generate an orchestrated implementation plan from a settled design plan doc
argument-hint: docs/<name>-plan.md
model: opus
---

You are turning a **settled design plan** into an **orchestrated implementation
plan**, following this repo's `docs/orchestration-playbook.md`. You are only
*writing the plan* here — do NOT start implementing.

## Input
Design plan: **$ARGUMENTS**
(If empty, ask the user which `docs/*-plan.md` to use, then stop and wait.)

## Steps

1. **Read, in full:**
   - the design plan at `$ARGUMENTS`,
   - `docs/orchestration-playbook.md` (the Rules of Engagement — do not restate
     them at length; link to it),
   - `CLAUDE.md` (architecture, the verification-gate commands, the test-DB
     caveats, conventions),
   - and enough of the actual codebase (the files the design plan names) to make
     the task graph concrete and the touch-sets accurate. Spot-check that files,
     endpoints, and symbols the design references still exist.

2. **Derive names** from the design plan's path `docs/<name>-plan.md`:
   - implementation plan → `docs/<name>-implementation-plan.md`
   - feature branch → `feat/<name>` (shorten a very long `<name>` sensibly and
     state the chosen branch name in the plan).

3. **Respect scope.** Include ONLY work the design plan marks active/ready.
   Sections marked **deferred, blocked, or pending sign-off** are OUT of scope:
   list them under a "Deferred / out of scope" heading with a one-line reason,
   and do not create tasks for them.

4. **Design the task graph.** Break the work into small, verifiable tasks
   (roughly one focused commit each), grouped into phases (e.g. backend
   foundation → frontend → integration). For **each task** specify:
   - a stable id (`T1`, `T2`, …) and a short title,
   - the **model** per the playbook's model policy (`opus` for orchestration /
     design-sensitive / final integration; `sonnet` for bulk + tests; `haiku`
     for mechanical edits),
   - the **exact files** it is expected to touch (subagents may discover more if
     it stays in scope),
   - crisp **acceptance criteria** (what makes it green — name the specific
     tests/gate),
   - the **conventional commit message**,
   - dependencies, and a **parallel-safe** marker only when its files are
     disjoint from the task(s) it could run beside.
   Order tasks so each builds on green predecessors. Put design-sensitive logic
   (tricky state, parser resolution, save migration, final integration +
   walkthrough + docs) on `opus`; put bulk implementation and test-writing on
   `sonnet`; put trivial mechanical edits on `haiku`.

5. **Think through cross-task consequences** and bake them into the ordering /
   task notes (e.g. a schema change forces every adventure module to re-validate;
   a new engine system shifts RNG consumption order and breaks seeded tests
   elsewhere). Flag anything the orchestrator must reconcile.

6. **Write `docs/<name>-implementation-plan.md`** with this structure:
   - Title + `Status: READY (<today's date>)`.
   - A one-line pointer: "Execution plan for `docs/<name>-plan.md` (the WHAT/WHY);
     rules live in `docs/orchestration-playbook.md`."
   - **Kickoff** — a short paragraph telling a fresh Opus session to run this via
     `/run-plan docs/<name>-implementation-plan.md` (or by reading the design
     plan + playbook + this file, then executing the graph).
   - **Scope & branch** — the `feat/<name>` branch, and the "Deferred / out of
     scope" list.
   - **Task graph** — the phased tasks as specified above.
   - **Progress Tracker** — a `- [ ]` checklist, one line per task
     (`- [ ] T1 — <title> (\`model\`)`), plus a "Done when" line.
   Keep the Rules of Engagement by reference (link the playbook); do not paste
   them in wholesale.

7. **Do not implement, branch, or commit.** After writing the file, print a
   concise summary: the task count, the phase breakdown, the model mix, anything
   deferred, and any assumptions or ambiguities the human should resolve before
   running `/run-plan`. Then stop.

Use today's date from the environment context. Match the repo's existing plan
docs in tone and formatting (see `docs/foundation-implementation-plan.md`).
