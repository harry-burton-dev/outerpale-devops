---
name: sweep
description: Check Outer-Pale's Linear projects and issues against the workflow, and report what's out of line. Use on a schedule or when Harry asks for a tidy-up check.
---

Report only. Change nothing without Harry's say-so. With the Linear connector, flag:

1. Issues In Progress with no linked PR and no comment in 48 hours (a missing handoff note).
2. Issues in a project's backlog with no implementation plan in their description.
3. Projects with a design issue that is Done but no design doc linked on the project.
4. Projects whose issues are all Done or Canceled but which aren't Completed.
5. PRs linked to more than one issue, or issues with more than one open PR.

Post the findings as one short list. If there are none, say "Sweep: nothing found."
