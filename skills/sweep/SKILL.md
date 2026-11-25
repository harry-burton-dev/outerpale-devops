---
name: sweep
description: Check this Claude project against its Linear links and naming schema, and report what's out of line. Use on a schedule or when Harry asks for a tidy-up check.
allowed-tools: Bash(node:*)
---

Report only. Change nothing without Harry's say-so.

1. Run `node <base>/../../scripts/ll.js sweep --json` with this skill's base directory. It finds:
   - documents outside `masters/` and the epic folders
   - closed epics that aren't archived
   - epics with no Linear link
   - artifact titles that break the schema
   - threads still unfiled
2. With the artifact tool's list action, list recent artifacts. Flag any whose title doesn't match `MASTER · …` or `EPIC · ISSUE · …`, and any epic-coded artifact missing from its epic's `index.md`.
3. With the Linear connector, for each open epic's issues that are In Progress, flag any with no "Thread started" comment, and any with no comment in 48 hours (a missing handoff note).
4. Flag Linear projects that are Completed while their folder is still open.
5. Post the findings as one short list. If there are none, say "Sweep: nothing found."
