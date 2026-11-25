# outerpale-devops

A Claude Code plugin for Outer-Pale dev-ops. It ties a project's threads, artifacts and files to Linear epics (projects) and issues in the **Outer-Pale workspace only**, keeps their names to one schema, asks up front whether a thread needs an epic or is Outer-Pale work at all, and sends every session to Langfuse. History is in [CHANGELOG.md](CHANGELOG.md).

## What it enforces

| Thing | Rule | Enforced by |
| --- | --- | --- |
| Thread title | `EPIC · ISSUE · description`, or `UNFILED · …` once the person chose "no epic". Built only from the person's words: subagent reports, notifications, slash commands, paths and URLs are dropped. An undecided thread keeps the app's title | SessionStart and UserPromptSubmit hooks set `sessionTitle` |
| Epic question | On the first prompt of an unfiled thread, Claude judges whether it is Outer-Pale engineering and asks one question: use an epic, open a new epic, "No epic" or "Not Outer-Pale work". Writes wait for the answer, which is read from the transcript (the desktop app doesn't run PostToolUse for `AskUserQuestion`) | UserPromptSubmit, PreToolUse, PostToolUse |
| Not Outer-Pale | "not Outer-Pale" (answered, or typed at the start of a prompt) stands the plugin aside: no titles, no folder rules. A folder with no `epics/` or `masters/` has no folder rules either | UserPromptSubmit, PreToolUse and PostToolUse hooks |
| Linear workspace | Writes only to Outer-Pale, whatever the policy or scope | PreToolUse on Linear write tools, PostToolUse on `get_workspace` |
| Current epic and issue | Taken from the message (`FE OUT-401 …`, "switch to OUT-402") or the start-issue skill. A passing mention ("blocked by OUT-82") doesn't switch. The epic must exist in this tree | UserPromptSubmit hook, state in `.linear-link/sessions/` |
| Thread ↔ issue log | Each issue a thread starts gets a "Thread started" comment | Hook prompts Claude, which posts with the Linear connector |
| Documents | `.md`/`.html` only in `masters/`, the current epic's folder, or `unfiled/` for a "no epic" thread | PreToolUse hook refuses other writes |
| Temporary outputs | `.md` in `epics/<E>-…/notes/` or an issue folder, listed in the epic's `index.md` when written | PreToolUse and PostToolUse hooks |
| Decisions | Numbered ADRs in `masters/decisions/` or `epics/<E>-…/decisions/` | PreToolUse hook |
| Artifacts | Published only from `masters/` or `epics/<E>-…/artifacts/`, titled to the schema | PreToolUse hook on Artifact and Claude Docs |
| Artifact ↔ issue | Link recorded in the epic's `index.md` and attached to the issue | PostToolUse hook (direct with a Linear key, otherwise via Claude) |
| Session telemetry | Turns, tokens, tools and plugin events to Langfuse, when configured | Stop hook |

## Layout

In the project's git repo:

```
masters/            live masters (MASTER · …), plus index.md
masters/decisions/  project-wide ADRs
epics/FE-frontend-redesign/
  index.md          code, name, Linear project, status, issues, notes, artifacts
  notes/            epic-level temporary outputs (.md)
  decisions/        the epic's ADRs (.md)
  artifacts/        sources of artifacts proper (.html)
  issues/OUT-401-nav-rail/   issue-level temporary outputs (.md)
archive/epics/…     closed epics
.linear-link/       per-thread state (add to .gitignore)
```

## Where the tree is

The nearest folder at or above the session's folder that holds `epics/` or `masters/`. So a session in `Augur/code/augur-kit` is held to `Augur/`'s tree. Files outside the tree are never policed. Neither is a git repo cloned inside the tree, such as `Augur/code/augur`: it keeps its own documents, and `sweep` skips it. The `root` option overrides this. A project not yet moved into a repo falls back to the Claude project's shared folder (`/mnt/project-files`), then to the session's folder.

## Install

Needs Node 18 or later on the machine that runs the session. From GitHub, in Claude Code:

```
/plugin marketplace add harry-burton-dev/outerpale-devops
/plugin install outerpale-devops@outerpale
```

To get new versions automatically, turn on auto-update for the `outerpale` marketplace in `/plugin` → Marketplaces. A new version is one with a higher `version` in `.claude-plugin/plugin.json`, so bump it with every release. To try a working copy instead: `claude --plugin-dir <path to this repo>`.

Options: team key (default `OUT`), Linear workspace ID and name (default Outer-Pale), policy (`block-outputs`, `unfiled` or `block`), `root`, an optional Linear API key, and Langfuse URL and keys (or `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`), and `telemetry_content` (`full` or `metadata`).

Don't run it alongside endstate-ops or linear-link: they would all answer the same hooks.

## Tests

```
node --test tests/*.test.js
```

`tests/plugin.test.js` is linear-link's suite: it proves every rule that was kept. `tests/base.test.js` covers what endstate-ops added. `tests/outerpale-devops.test.js` covers the workspace guard, "no epic" and Langfuse, against a local fake Langfuse server. `tests/scope-and-titles.test.js` covers titles and the epic question, and `tests/improvements.test.js` the 0.4.0 fixes.

## Project files to add

| File | Where | What it's for |
| --- | --- | --- |
| `templates/CLAUDE.md` | Project root, as `CLAUDE.md` | Why the rules exist, and this project's values: team key, epic codes, code location, masters |
| `templates/settings.json` | `.claude/settings.json` | Lets the skills run the CLI and the Linear calls without a permission prompt each time. The Linear tool names carry your connector's ID (`mcp__<id>__…`); change it if yours differs |
| `templates/masters-index.md` | `masters/index.md` | The fixed list of live masters |
| `templates/project-instructions.txt` | Claude project instructions (claude.ai) | The same rules for chat threads, where hooks don't run |
| `.gitignore` | Project root | Add `.linear-link/` |
