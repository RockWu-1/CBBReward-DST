---
name: superpowers-workflow
description: Applies Superpowers-style development workflow: design before code, one-question brainstorming, bite-sized implementation plans, strict TDD (red-green-refactor), and review checkpoints. Use when planning features, starting implementation, debugging, or when the user asks for structured development, feature planning, or "help me build/plan this."
---

# Superpowers Workflow

Structured software development workflow: **design first**, then **plan**, then **implement with TDD**, then **review**. Do not jump into code before clarifying intent and getting design sign-off.

## When to Use This Workflow

- User wants to add a feature, build something, or change behavior
- User says "help me plan this," "let's build X," or "design/implement Y"
- Starting implementation without a written plan or spec
- Debugging (use systematic-debugging flow before proposing fixes)

**Core rule:** Check for this workflow before any creative or implementation task. Prefer design and plan before writing code.

---

## 1. Brainstorming (Before Any Code)

**Goal:** Turn the idea into a clear, validated design. No implementation until the user has signed off.

**Process:**

1. **Understand context** – Check project state (files, docs, recent commits).
2. **Refine the idea** – Ask **one question at a time**; prefer multiple choice when possible. Focus on: purpose, constraints, success criteria.
3. **Explore options** – Propose 2–3 approaches with trade-offs; give a recommendation and reasoning.
4. **Present the design** – In sections of ~200–300 words. After each section, ask: "Does this look right so far?" Cover: architecture, components, data flow, error handling, testing.
5. **Document** – Write the validated design to `docs/plans/YYYY-MM-DD-<short-name>-design.md` and commit.

**Principles:** One question per message. YAGNI: remove unnecessary features. Incremental validation. Be ready to go back and clarify.

**After design approval:** Ask "Ready to set up for implementation?" Then create an isolated branch/worktree and write the implementation plan (Step 2).

---

## 2. Writing the Implementation Plan

**Goal:** A plan that a junior engineer with no project context could follow. Bite-sized tasks (2–5 minutes each), exact paths, full code, and verification steps.

**When:** After design is approved; ideally in a dedicated branch/worktree.

**Save plans to:** `docs/plans/YYYY-MM-DD-<short-name>.md`

**Plan header (required):**

```markdown
# [Feature Name] Implementation Plan

**Goal:** [One sentence]

**Architecture:** [2–3 sentences]

**Tech Stack:** [Key technologies]

---
```

**Task structure (each task = one small action):**

- **Files:** Exact paths (create/modify/test), with line ranges when modifying.
- **Steps:** e.g. "Write failing test" → "Run to see it fail" → "Implement minimal code" → "Run to see it pass" → "Commit."
- **Code:** Include full snippets in the plan, not "add validation."
- **Verification:** Exact commands and expected output.

**Principles:** DRY, YAGNI, TDD, frequent commits. Every step is one action.

**After saving the plan:** Offer execution options (e.g. execute task-by-task in this session with review, or batch in another session with checkpoints).

---

## 3. Test-Driven Development (During Implementation)

**Iron law:** No production code without a **failing test first**. If code was written before the test, delete the code and start from the test.

**When:** All new features, bug fixes, refactors, behavior changes. Exceptions only with explicit user agreement (e.g. throwaway prototypes, generated/config-only code).

**Red–Green–Refactor:**

| Phase | Action | Verify |
|-------|--------|--------|
| **RED** | Write one minimal failing test for one behavior | Run test; confirm it fails for the right reason (missing behavior, not typo). |
| **GREEN** | Write the smallest amount of code to pass | Run test; confirm it passes; other tests still pass. |
| **REFACTOR** | Remove duplication, improve names, extract helpers | Tests stay green; no new behavior. |

**Rules:**

- Run the test and **watch it fail** before implementing. If you didn’t see it fail, you don’t know it tests the right thing.
- One behavior per test; clear test name; prefer real code over mocks.
- Minimal implementation to pass; no "while I'm here" features or refactors in the green step.
- If you wrote code before the test: delete that code and re-implement from the test.

**Bug fixes:** Reproduce with a failing test, then fix. Never fix without a test that proves the fix and prevents regression.

---

## 4. Executing the Plan

**When:** You have a written implementation plan and user has approved execution.

**Process:**

1. **Load and review** – Read the plan; note gaps or questions; raise with the user before starting.
2. **Execute in small batches** – e.g. first 3 tasks. For each task: follow steps exactly, run verifications as specified, mark complete.
3. **Report** – After each batch: show what was done and verification output; say you’re ready for feedback.
4. **Continue** – Apply feedback, then next batch until done.
5. **Finish** – When all tasks are done: run full test suite, then present options (merge/PR/keep branch/discard) and clean up as needed.

**Rules:** Follow plan steps exactly. Don’t skip verifications. If blocked or unclear, stop and ask; don’t guess. Prefer working on a branch; don’t start on main/master without explicit consent.

---

## 5. Systematic Debugging (Before Proposing Fixes)

**Iron law:** No fixes without **root cause investigation first**. Symptom-only fixes are not acceptable.

**When:** Any bug, test failure, or unexpected behavior. Especially when under time pressure or after failed fix attempts.

**Four phases (in order):**

1. **Root cause** – Read errors fully, reproduce consistently, check recent changes, trace data flow. In multi-component systems, add minimal diagnostics at boundaries to see where it breaks.
2. **Pattern** – Find working examples; compare with broken case; list differences; understand dependencies.
3. **Hypothesis** – State one clear hypothesis; make the smallest change to test it; verify. If wrong, form a new hypothesis; don’t pile on more fixes.
4. **Implementation** – Create a failing test that reproduces the bug, then fix the root cause (one change), then verify. If 3+ fix attempts failed, question the architecture with the user instead of trying another fix.

**Rules:** No "quick fix, investigate later." No multiple fixes at once. No skipping the failing test before the fix.

---

## 6. Review and Finishing

- **Between tasks/batches:** Review against the plan; report issues by severity; treat critical issues as blocking.
- **When all tasks are done:** Run tests, show status, present merge/PR/keep/discard options, then clean up branch/worktree as agreed.

---

## Philosophy

- **Test-Driven Development** – Tests first, always (except agreed exceptions).
- **Systematic over ad-hoc** – Process over guessing; same for debugging and implementation.
- **Complexity reduction** – Prefer simplicity; YAGNI; remove unnecessary scope.
- **Evidence over claims** – Verify with failing-then-passing tests and explicit verification steps; don’t declare success without running checks.

---

## Quick Checklist

Before writing implementation code:

- [ ] Design explored and validated with the user (brainstorming).
- [ ] Design documented (e.g. in `docs/plans/`).
- [ ] Implementation plan written with bite-sized tasks and exact paths/commands.
- [ ] Working on a branch (not main/master unless agreed).

During implementation:

- [ ] Each new behavior has a failing test first, then minimal code, then refactor.
- [ ] Verifications from the plan are run and pass.
- [ ] No production code written before a failing test for that behavior.

When debugging:

- [ ] Root cause investigated (reproduce, trace, evidence) before any fix.
- [ ] Failing test for the bug, then one focused fix, then verify.

For more detail and upstream reference, see [reference.md](reference.md).
