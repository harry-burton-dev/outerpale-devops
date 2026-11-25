# <Project name>

<!-- Copy to the project root. Fill the <…> parts. The outerpale-devops plugin enforces the rules below; this file says why, and holds this project's values. -->

<One or two sentences: what this project is and who it's for.>

## Where things live

- **Tracking:** Linear, team `OUT` (Outer-Pale workspace). An epic is a Linear project; an issue is one task.
- **Epics:** `epics/<CODE>-<slug>/`. Each has an `index.md` linking to its Linear project, plus `notes/`, `issues/` and `artifacts/`.
- **Live masters:** `masters/`, listed in `masters/index.md`. Update a master in place. Never make a second version of one, and never add a new master without asking.
- **Code:** <where the code lives, e.g. `src/`>. The plugin never blocks code or data files.

## How a thread works

1. Name the epic and issue in the first message (`FE OUT-401 …`), or run the start-issue skill. The thread's title follows automatically.
2. Switching task means naming the new issue. A thread may work several issues.
3. Answer in the reply by default. Write a temporary output (plan, review, notes) as `.md` in the epic's `notes/` or the issue folder. Make an artifact only for something kept and returned to, and update an existing one rather than making a new round.
4. Before stopping, run close-issue: a summary, or a handoff note if the work isn't finished.

## Decisions

A decision gets a record only if it cuts across parts of the system and is costly to reverse. Anything else is a line on the Linear issue. Records are numbered ADRs (`0001-<slug>.md`): `masters/decisions/` for project-wide ones, `epics/<CODE>-…/decisions/` for one epic's own. Each has context, decision, consequences and status. A decision is changed by a new ADR that supersedes it, never by editing the old one. Only entries marked as needing Harry get a Linear issue asking him to accept them.

## Project values

- Epic codes in use: <FE = Frontend redesign, …>
- Masters: see `masters/index.md`
