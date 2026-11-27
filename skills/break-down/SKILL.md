---
name: break-down
description: Turn a Linear project's GSD roadmap into Linear issues, one per GSD phase, each with its goal and acceptance criteria and a link to its phase. Use in a project-scoped session once the roadmap is agreed, before anyone builds.
allowed-tools: Bash(node:*)
---

Run in a session on the project (`node <base>/../../scripts/ll.js scope project "<name>"` with this skill's base directory). Change nothing in Linear until Harry agrees the breakdown.

1. Find the roadmap: `.planning/ROADMAP.md`. If there is none, the planning comes first: GSD's `/gsd-new-project` or `/gsd-new-milestone`, through its discuss step, on the project's "Design: …" issue.
2. Review the phases for what a builder would hit: missing decisions, unclear interfaces, phases too big for one PR. Raise them with Harry before creating anything. GSD's `/gsd-review` is the thorough version.
3. Propose one Linear issue per phase, in build order, with what each depends on. Agree it with Harry.
4. Create each issue in the project (`save_issue`), checking first that it doesn't exist:
   - **Goal:** one or two sentences, from the phase.
   - **Acceptance criteria:** what shows it is done.
   - **Phase:** the phase number and a link to its folder in `.planning/`. Detailed planning happens in the phase (`/gsd-plan-phase`), not in the issue.
   - **Depends on:** other issue IDs, also set as Linear relations.
5. Put each issue's link in its phase's `CONTEXT.md`, and post a project update listing the new issues.
