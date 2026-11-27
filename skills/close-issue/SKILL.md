---
name: close-issue
description: Close out this session's work on a Linear issue - post what was done, the PR and anything left open. Use when an issue's PR is up or merged, or when the session stops partway.
allowed-tools: Bash(node:*)
---

1. Post one comment on the issue (`save_comment`):
   - what was done, in two or three sentences
   - the PR link, and any artifacts as links
   - anything left open
2. Don't set the status by hand: Linear's GitHub integration moves the issue when its PR merges. If the session stops partway, post a handoff note instead: current state, next step, links.
3. If every issue in the project is now Done or Canceled, suggest the close-project skill.
