---
name: close-epic
description: Close an epic - check every Linear issue is finished, update the live masters it changed, and archive its folder. Use when a feature or Linear project is complete.
allowed-tools: Bash(node:*)
---

1. List the epic's issues in Linear (`list_issues` with the project). Stop if any is not Done or Canceled, and say which.
2. Read the epic's `index.md` and notes. For each live master in `masters/` the epic changed (architecture, decisions, roadmap and so on), update that master. Don't create a new master without Harry's approval.
3. Ask Harry to confirm the archive, then run `node <base>/../../scripts/ll.js close-epic <CODE> --confirm` with this skill's base directory.
4. Set the Linear project to Completed and post a project update with the summary.
5. Remind Harry that artifacts filed in the Claude project's folders must be moved by hand.
