# Changelog

## 0.4.2

- **Epic from the project's name.** A thread in a Claude project named for an epic (`E03`, or `E03 · Prove the host`) is filed on that epic from its first wake, so it isn't asked the epic question and its writes aren't held. Unattended runs no longer stall waiting for a person. Only an epic in this tree counts. "No epic", "not Outer-Pale" or naming another epic still win, and a thread already waiting on the question is filed by its next wake.
- **Tree found from above the repo.** When the session's folder holds no tree and none is above it (a cloud session in `/home/user`), the one folder directly below it that has `epics/` or `masters/` is used, before falling back to `/mnt/project-files`. Two or more such folders are not guessed between.

## 0.4.1

- **The Linear guard fails closed.** If the PreToolUse hook throws, a Linear write (`save_*`, `create_*`, `delete_*`, …) is refused with the error in the reason, where before the hook exited 0 and the write went through unchecked. Other tools and Linear reads still pass on an error.
- **Guard first.** The workspace check runs before any session-state work, so a failure there can't skip it.

## 0.4.0

- **Epic answer read from the transcript.** The desktop app doesn't run PostToolUse for `AskUserQuestion`, so 0.3.0 never saw the answer and kept refusing writes. While the question is open, the PreToolUse and UserPromptSubmit hooks now read the latest answer from the session transcript.
- **Session for the CLI.** `ll.js` acts on `CLAUDE_CODE_SESSION_ID`, the session running it, before the shared `~/.linear-link/last-session` pointer that parallel threads overwrite.
- **Epics belong to their tree.** A thread whose epic isn't in this tree (state carried from a title or another tree) is taken off it, so it can't create `epics/<other>-…` here.
- **Issues from `index.md`.** Issues listed under `## Issues` count as the epic's, even with no issue folder.
- **Passing mentions.** Only an issue ID that opens the prompt, or follows "on", "switch to", "start", "work on" or "pick up", switches the thread. Naming an epic after an issue keeps the issue.
- **Notes indexed.** A note written in an epic is listed under `## Notes` in its `index.md`.
- **Sweep** also flags artifact sources with no index line, Linear projects in another workspace, two epics sharing a Linear project, and issue IDs from another team.
- **ADRs** live in `masters/decisions/` and each epic's `decisions/`.
- **Vault removed.** The session log, daily note and session-start memory are gone (`lib/vault.js`, the `vault` option). Langfuse stays.
- **Old titles.** A description saved by an older version with markup in it is rebuilt from the person's words.
- **Permission template** names the real Linear connector.

## 0.3.1 (unreleased, folded into 0.4.0)

- **Titles from the person's words only.** Subagent reports, task notifications, reminders, slash commands, `[Local: …]` prefixes, full paths and URLs are dropped before the thread is described. A subagent report mentioning an issue no longer moves the thread onto it.
- **Epic question.** The first human prompt in an unfiled thread tells Claude to judge whether this is Outer-Pale engineering and ask one question: use an epic, open a new epic, "No epic" or "Not Outer-Pale work". Writes wait for the answer. Undecided threads keep the app's own title.
- **"Not Outer-Pale"** stands the plugin aside: no titles, no folder rules. The Linear guard still holds.
- Folders with no `epics/` or `masters/` aren't policed for documents.

## 0.3.0: from endstate-ops 0.2.0

- **Name.** `outerpale-devops`; skills are `outerpale-devops:*`; messages start `outerpale-devops:`. The state folder is still `.linear-link/`.
- **Outer-Pale only.** Team key defaults to `OUT`. Every Linear write through any connector is refused until that connector's `get_workspace` has been seen and matches the Outer-Pale workspace. A connector on another workspace is refused from then on. Checks are kept in `~/.linear-link/linear-connectors.json`. A direct Linear API key is used only if it belongs to Outer-Pale.
- **"No epic".** Saying "no epic" puts the thread in an unfiled mode: documents in `unfiled/`, artifacts titled `UNFILED · …`.
- **Langfuse.** On each Stop, the new turns are sent to Langfuse: one session per Claude session, one trace per turn (tagged with epic and issue), a generation per model reply, a span per tool call, and plugin events.

## endstate-ops 0.2.0: from linear-link 0.1.2

- The tree is found in the project's git repo, not assumed to be the Claude project's shared folder.
- Claude Docs are held to the schema under any connector name.
- The vault's session log, daily line and session-start memory became part of the plugin (removed again in 0.4.0).
- Messages started `endstate-ops:`. `LINEAR_LINK_ROOT` still works.
