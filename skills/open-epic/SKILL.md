---
name: open-epic
description: Open a new epic (a Linear project) with its folder in this Claude project. Use when Harry starts a new feature or piece of work that will span several issues or threads.
allowed-tools: Bash(node:*)
---

An epic is one Linear project in the Outer-Pale workspace. Its files live in `epics/<CODE>-<slug>/`.

Ask before opening one. If Harry says the work doesn't need an epic, stop: the thread works UNFILED, with documents in `unfiled/`.

1. Agree a short epic code with Harry: 2 to 6 capitals or digits, starting with a letter (for example `FE`, `KG`, `AC`). Reuse the prefix Linear titles already use for this work, if any.
2. Find or create the Linear project with the Linear connector (`list_projects`, then `save_project` if it doesn't exist). Use the epic's name as the project name.
3. Run, with this skill's base directory:
   `node <base>/../../scripts/ll.js open-epic <CODE> "<Name>" "<Linear project URL>"`
   This creates `index.md`, `notes/`, `issues/` and `artifacts/`, and puts this thread on the epic.
4. Put the folder path in the Linear project's description or resources, so the two link both ways.
5. Tell Harry in one line: the code, the folder and the Linear project.
