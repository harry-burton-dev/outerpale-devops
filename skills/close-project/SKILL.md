---
name: close-project
description: Close a Linear project - check every issue is finished, check what was built against GSD's plan, and mark the project Completed. Use when a project's work is done.
---

1. List the project's issues in Linear (`list_issues` with the project). Stop if any is not Done or Canceled, and say which.
2. Check what was built against the plan: GSD's `/gsd-audit-milestone` and `/gsd-complete-milestone` do this and archive the milestone in `.planning/`. Raise any gap with Harry: fix it or open an issue.
3. Ask Harry to confirm, then set the project to Completed and post a project update with the summary and the PRs.
