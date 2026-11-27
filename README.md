# outerpale-devops

A Claude Code plugin for Outer-Pale project management in Linear. Each session works on one Linear issue, project or initiative in the **Outer-Pale workspace only**, or on none. Work is one PR per issue, and issues make up a project. It also sends every session to Langfuse. History is in [CHANGELOG.md](CHANGELOG.md).

## The workflow it holds

| Session | Works on | Produces |
|---|---|---|
| Design | A project or initiative, through its "Design: …" issue | A design doc in `docs/design/`, linked from the project (EGM's working files in `.work/egm/`) |
| Review and breakdown | A project | The project's issues, each with its implementation plan in the description (`break-down` skill) |
| Build | One issue | One PR, titled `OUT-123: …` with `Fixes OUT-123` in the body |
| Other | None | Anything; the plugin stands aside |

Linear's GitHub integration links each PR to its issue from the ID and moves the issue when the PR merges, so Claude doesn't set statuses by hand.

## What it enforces

| Thing | Rule | Enforced by |
| --- | --- | --- |
| Scope question | On the first prompt of an unscoped session, Claude asks one question: which issue, project or initiative, or "None". A prompt that opens with an issue ID (`OUT-401 …`, "switch to OUT-402") answers it. The answer is also read from the transcript, since the desktop app doesn't run PostToolUse for `AskUserQuestion` | UserPromptSubmit, PreToolUse, PostToolUse |
| One PR per issue | An issue session's PR must carry its own issue ID in the title. A project or initiative session's PR must carry some issue's ID, such as its design issue's. No PR before the scope question is answered. Covers the GitHub connector's `create_pull_request` and `gh pr create` | PreToolUse |
| Linear workspace | Writes only to Outer-Pale, whatever the scope, including "None". Fails closed if the hook errors | PreToolUse on Linear write tools, PostToolUse on `get_workspace` |
| Session title | `OUT-123 · description`, or `<project> · description`; untouched when unscoped or "None" | SessionStart and UserPromptSubmit set `sessionTitle` |
| Artifact ↔ issue | An artifact published in an issue session is attached to the issue (directly with a Linear key, otherwise via Claude) | PostToolUse on Artifact |
| Session telemetry | Turns, tokens, tools and plugin events to Langfuse, tagged with the scope, when configured | Stop |

Nothing is written into the project's repository. Session state lives in `~/.linear-link/sessions/`.

## Skills

`start-issue` (put the session on an issue, move it to In Progress, read its plan), `break-down` (design doc → issues with plans), `close-issue` (summary or handoff comment), `close-project` (all issues done, design checked, project Completed), `sweep` (report what's out of line in Linear).

## Install

Needs Node 18 or later on the machine that runs the session. From GitHub, in Claude Code:

```
/plugin marketplace add harry-burton-dev/outerpale-devops
/plugin install outerpale-devops@outerpale
```

To get new versions automatically, turn on auto-update for the `outerpale` marketplace in `/plugin` → Marketplaces. A new version is one with a higher `version` in `.claude-plugin/plugin.json`, so bump it with every release. To try a working copy instead: `claude --plugin-dir <path to this repo>`.

Options: team key (default `OUT`), Linear workspace ID and name (default Outer-Pale), an optional Linear API key, Langfuse URL and keys (or `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`), and `telemetry_content` (`full` or `metadata`).

Don't run it alongside endstate-ops or linear-link: they would all answer the same hooks.

## Tests

```
node --test tests/
```

`tests/contract.test.js` covers the scope question, one PR per issue, the workspace guard and Langfuse (against a local fake server).
