---
name: close-project
description: Close a Linear project - check every issue is finished, check the design doc still matches what was built, and mark the project Completed. Use when a project's work is done.
---

1. List the project's issues in Linear (`list_issues` with the project). Stop if any is not Done or Canceled, and say which.
2. Check the design doc in `docs/design/` against what was built. EGM's drift report (`/egm:egm-drift-report`) does this. Raise any drift with Harry: fix the doc or open an issue.
3. Ask Harry to confirm, then set the project to Completed and post a project update with the summary and the PRs.
