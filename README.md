# outerpale-devops

A Claude Code plugin for Outer-Pale project management in Linear. Each session works on one Linear issue, project or initiative in the **Outer-Pale workspace only**, or on none. Work is one PR per issue, and issues make up a project. History is in [CHANGELOG.md](CHANGELOG.md).

## The workflow it holds

| Session | Works on | Produces |
|---|---|---|
| Design | A project or initiative, through its "Design: …" issue | GSD's roadmap and phases in `.planning/` (committed), through its discuss and plan steps |
| Review and breakdown | A project | One Linear issue per GSD phase, with goal, acceptance criteria and a link to the phase (`break-down` skill) |
| Build | One issue | One PR, titled `OUT-123: …` with `Fixes OUT-123` in the body |
| Other | None | Anything; the plugin stands aside |

Linear's GitHub integration links each PR to its issue from the ID and moves the issue when the PR merges, so Claude doesn't set statuses by hand.

## What it enforces

| Thing | Rule | Enforced by |
| --- | --- | --- |
| Scope | A session starts unscoped, and the plugin stands aside. The `build-issue` skill sets the scope (asking which issue if none is named), as does a prompt that opens with an issue ID (`OUT-401 …`, "switch to OUT-402") or a launch prompt whose first line is `Project: <name>` or `Initiative: <name>`. `break-down` sets its project | UserPromptSubmit, `scripts/ll.js` |
| One PR per issue | An issue session's PR must carry its own issue ID in the title. A project or initiative session's PR must carry some issue's ID, such as its design issue's. An unscoped session has no PR rule. Covers the GitHub connector's `create_pull_request` and `gh pr create` | PreToolUse |
| Session title | `OUT-123 · description`, or `<project> · description`; untouched when unscoped or "None" | SessionStart and UserPromptSubmit set `sessionTitle` |
| Artifact ↔ issue | An artifact published in an issue session is attached to the issue (directly with a Linear key, otherwise via Claude) | PostToolUse on Artifact |

Nothing is written into the project's repository. Session state lives in `~/.linear-link/sessions/`.

## Skills

`build-issue` (put the session on an issue, asking which if none is named, move it to In Progress, find its GSD phase and plan), `break-down` (GSD roadmap → one Linear issue per phase), `close-issue` (summary or handoff comment), `close-project` (all issues done, design checked, project Completed), `sweep` (report what's out of line in Linear).

## Install

Needs Node 18 or later on the machine that runs the session. From GitHub, in Claude Code:

```
/plugin marketplace add harry-burton-dev/outerpale-devops
/plugin install outerpale-devops@outerpale
```

To get new versions automatically, turn on auto-update for the `outerpale` marketplace in `/plugin` → Marketplaces. A new version is one with a higher `version` in `.claude-plugin/plugin.json`, so bump it with every release. To try a working copy instead: `claude --plugin-dir <path to this repo>`.

Options: team key (default `OUT`), Linear workspace ID and name (default Outer-Pale), and an optional Linear API key. Session tracing comes from Claude Code's own OpenTelemetry export, not from this plugin.

Don't run it alongside endstate-ops or linear-link: they would all answer the same hooks.

## Tests

```
node --test tests/
```

`tests/contract.test.js` covers the scope and one PR per issue.
