---
name: build-issue
description: Build one Linear issue in this session - ask which issue if none is named, find or create it, move it to In Progress, post this session's link, and find its GSD phase and plan. Use at the start of any build or design work, and whenever the session moves to a different issue.
allowed-tools: Bash(node:*)
---

A session works on one issue and opens one PR for it. One Linear issue is one GSD phase. Linear here is the Outer-Pale workspace (team `OUT`).

0. If the invocation or the prompt doesn't name the issue, ask in one AskUserQuestion call on its own: which Linear issue is this for? Look up likely open issues with the Linear connector first, put your recommendation first, and label the options "Issue OUT-123: <title>".
1. Find the issue with the Linear connector. If it doesn't exist, check for a matching one first, then create it (`save_issue`) in the right project with a short task title, its goal and its acceptance criteria. Design work is an issue too: "Design: <topic>" in its project.
2. Run, with this skill's base directory: `node <base>/../../scripts/ll.js scope issue <ISSUE> --title "<issue title>"`.
3. Move the issue to In Progress, and post one comment: `Session started: <session title> <this session's link>`. Skip the comment if this session already posted one on it.
4. Find the issue's GSD phase: the phase linked from the issue, or the one in `.planning/ROADMAP.md` whose `CONTEXT.md` links this issue. If there is none, add one (`/gsd-phase "<issue title>"`), put the issue's link in its `CONTEXT.md`, and link the phase back from the issue. Its plan is the phase's `PLAN.md`; if it has none yet, plan it with `/gsd-plan-phase`.
5. Work the phase with GSD (`/gsd-execute-phase`, then `/gsd-verify-work`). Before opening the PR, run the `outerpale-startup:intent-reviewer` agent with the issue's goal and acceptance criteria, the phase's `PLAN.md`, the repository path and the base branch. Fix what it reports that matters, and mention what you left and why in the PR body.
6. Open one PR (`/gsd-ship`, or directly), titled `<ISSUE>: …`, with `Fixes <ISSUE>` in the body. Linear's GitHub integration links it and moves the issue to Done when it merges.

GSD's `.planning/` is committed with the work. Scratch goes in `.work/` (not committed).
