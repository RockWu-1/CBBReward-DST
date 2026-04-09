# Superpowers Workflow – Reference

This skill is adapted from **[Superpowers](https://github.com/obra/superpowers)** by Jesse (obra): an agentic skills framework and development methodology for coding agents.

## Upstream Repository

- **Repo:** https://github.com/obra/superpowers  
- **License:** MIT  
- **Original target:** Claude Code (plugin), Codex, OpenCode. This Cursor skill condenses the workflow for use in Cursor’s agent/skills system.

## Original Skills Mapped Into This Workflow

| Phase            | Superpowers skill (upstream)     | Role in this skill                |
|-----------------|-----------------------------------|-----------------------------------|
| Design          | brainstorming                     | Section 1 – design before code    |
| Plan            | writing-plans                    | Section 2 – bite-sized plans      |
| Implement       | test-driven-development          | Section 3 – red-green-refactor    |
| Execute         | executing-plans / subagent-driven-development | Section 4 – batch execution & review |
| Debug           | systematic-debugging              | Section 5 – root cause then fix   |
| Finish          | finishing-a-development-branch    | Section 6 – verify, merge/PR      |

## Optional: Git Worktrees

Superpowers recommends **using-git-worktrees** after design approval: create an isolated worktree on a new branch, run project setup, verify a clean test baseline, then write and execute the plan there. In Cursor you can approximate this by working on a dedicated branch and avoiding main/master until the user agrees to merge.

## File Conventions Used Here

- Design docs: `docs/plans/YYYY-MM-DD-<short-name>-design.md`
- Implementation plans: `docs/plans/YYYY-MM-DD-<short-name>.md`

Adjust paths if your project uses a different structure (e.g. `doc/plans/`); keep the pattern consistent.

## Further Reading

- [Superpowers README](https://github.com/obra/superpowers#readme) – overview and workflow
- [Superpowers for Claude Code](https://blog.fsck.com/2025/10/09/superpowers/) – blog post on the methodology
