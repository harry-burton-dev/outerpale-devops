---
name: start-issue
description: Start or switch this thread onto a Linear issue inside an epic. Use at the start of any piece of work, and whenever the thread moves to a different issue.
allowed-tools: Bash(node:*)
---

A thread can work several issues, and an issue can be worked by several threads. The thread's title always shows the epic and the issue it is handling right now.

Linear here is the Outer-Pale workspace (team `OUT`) only. If the plugin refuses a Linear write because the connector is unchecked, call that connector's `get_workspace` and retry; if it says the connector is on another workspace, use the Outer-Pale connector instead.

If Harry doesn't want this work in an epic ("no epic"), don't push: skip this skill. The thread stays UNFILED, its documents go in `unfiled/`, and its artifacts are titled `UNFILED · …`. Naming an epic later files the thread.

1. Find the issue with the Linear connector. If it doesn't exist, create it (`save_issue`) in the epic's Linear project, with a short task title. Check first that a matching issue doesn't already exist.
2. Run, with this skill's base directory:
   `node <base>/../../scripts/ll.js start-issue <ISSUE> "<issue title>" [--epic <CODE>]`
   This creates the issue folder if needed and sets the thread's current epic and issue.
3. Post one comment on the Linear issue: `Thread started: <thread title> <this session's link>`. Skip it if this thread already posted one on this issue.
4. The thread's title updates on Harry's next message. Mention the new title in one line.

Temporary outputs for this issue (plans, reviews, notes) go as `.md` files in the issue folder. Artifacts proper are published from the epic's `artifacts/` folder.
