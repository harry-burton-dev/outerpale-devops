---
name: start-issue
description: Put this session on one Linear issue - find or create it, move it to In Progress, post this session's link, and read its implementation plan. Use at the start of any build or design work, and whenever the session moves to a different issue.
allowed-tools: Bash(node:*)
---

A session works on one issue and opens one PR for it. Linear here is the Outer-Pale workspace (team `OUT`) only. If the plugin refuses a Linear write because the connector is unchecked, call that connector's `get_workspace` and retry.

1. Find the issue with the Linear connector. If it doesn't exist, check for a matching one first, then create it (`save_issue`) in the right project with a short task title. Design work is an issue too: "Design: <topic>" in its project.
2. Run, with this skill's base directory: `node <base>/../../scripts/ll.js scope issue <ISSUE> --title "<issue title>"`.
3. Move the issue to In Progress, and post one comment: `Session started: <session title> <this session's link>`. Skip the comment if this session already posted one on it.
4. Read the issue's description. Its implementation plan is there. If there is none, say so in one line and offer to write one with Harry, or to run the break-down skill for its project.
5. Work on one branch. Before opening the PR, run the `outerpale-startup:intent-reviewer` agent with the issue's goal and plan, the design section if any, the repository path and the base branch. Fix what it reports that matters, and mention what you left and why in the PR body.
6. Open one PR, titled `<ISSUE>: …`, with `Fixes <ISSUE>` in the body. Linear's GitHub integration links it and moves the issue to Done when it merges.

Working files go in `.work/` (not committed). A design issue's finished doc goes in `docs/design/<slug>.md` in its PR, and is linked from the Linear project.
