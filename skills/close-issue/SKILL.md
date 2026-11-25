---
name: close-issue
description: Close out this thread's work on a Linear issue - post the summary, list what was made, and set the issue's status. Use when an issue's task is finished or the thread is stopping work on it.
allowed-tools: Bash(node:*)
---

1. Run `node <base>/../../scripts/ll.js close-issue <ISSUE>` with this skill's base directory. It lists the threads, artifacts and files recorded for the issue.
2. Post one comment on the Linear issue (`save_comment`):
   - what was done, in two or three sentences
   - the artifacts, as links
   - the files, as paths
   - anything left open
3. Ask Harry whether the issue is Done. Set the status only when he says so. If the thread stops mid-task, post a handoff note instead: current state, next step, links.
4. If every issue in the epic is now Done or Canceled, suggest the close-epic skill.
