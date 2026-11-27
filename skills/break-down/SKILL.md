---
name: break-down
description: Review a Linear project's design doc and break it into issues, each with its implementation plan in the description. Use in a project-scoped session once the design is agreed, before anyone builds.
allowed-tools: Bash(node:*)
---

Run in a session on the project (`node <base>/../../scripts/ll.js scope project "<name>"` with this skill's base directory). Change nothing in Linear until Harry agrees the breakdown.

1. Find the design doc: the link on the Linear project, else `docs/design/` in the repository. If there is none, stop: the design comes first, on its own "Design: …" issue.
2. Review it for gaps a builder would hit: missing decisions, unclear interfaces, untestable parts. Raise them with Harry before splitting. EGM's review (`/egm:egm-review`) is the thorough version; its reports go in `.work/egm/`.
3. Propose the issues as a list: each one PR in size, in build order, with what it depends on. Agree it with Harry.
4. Create each issue in the project (`save_issue`), checking first that it doesn't exist. Put its implementation plan in the description:
   - **Goal:** one or two sentences.
   - **Design:** the link to the design doc, and the section it implements.
   - **Plan:** the steps, with the files or modules touched.
   - **Check:** the command or test that shows it's done.
   - **Depends on:** other issue IDs, also set as Linear relations.
5. Make sure the design doc is linked from the project. Post a project update listing the new issues.
