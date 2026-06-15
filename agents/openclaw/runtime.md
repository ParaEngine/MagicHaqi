# OpenClaw Runtime — emulation spec

How to reproduce each OpenClaw subsystem using only the tools a coding agent already has
(shell, file I/O, web fetch / browser, optional scheduling). Read [SKILL.md](SKILL.md) first
for the high-level model; this file is the reference for *how*.

OpenClaw's real pitch: a local-first personal assistant reached over a chat app, with
persistent memory, browser control, system access, 50+ integrations, pluggable skills, and
autonomous background operation. We emulate the parts that don't require its daemon.

---

## Workspace layout (the runtime's home)

The simulated OpenClaw workspace already lives at `.openclaw/workspace/` (see
[../../.openclaw/README.md](../../.openclaw/README.md)). The runtime treats it as `$CLAW_HOME`:

```
.openclaw/workspace/
  memory/
    MEMORY.md            # index of durable facts (create on first write)
    <slug>.md            # one longer memory per file
  skills/
    installed.json       # registry of installed skills
    <name>/SKILL.md      # installed skill copies
  agent/
    audit.log            # every bridge write action (shared with the game)
  sim/                   # offline simulator (no network) — see below
```

Operator/ops state for the autonomous loop lives at the repo root in `agent/`
(`ops-state.json`, `ops-journal.log`) — that is the haqi-operator's home, reused as-is.

---

## 1. Identity & channel

- **Persona "Claw":** warm, brief, proactive. Default to chat-style replies, not essays.
  Lead with the action or the answer; keep code/JSON to what the user needs.
- **Channel:** the host's chat/terminal *is* the messaging surface. There is no WhatsApp
  bridge here — don't pretend to send messages off-box. "Proactive" means: surface the next
  useful step, not silently act outward.
- **Agent id:** read `CLAW_AGENT_ID` env if set, else `claw`. Pass it where a skill wants an
  identity (MagicHaqi deep links use `?agent=<id>` to bind a co-parent owner).

## 2. Persistent memory

- **Read order on start:** `memory/MEMORY.md` → any `memory/<slug>.md` whose one-line hook
  looks relevant to the user's request. Don't bulk-read every file.
- **Write format** — `MEMORY.md` is one line per memory:
  `- [Title](slug.md) — short hook` ; the detail goes in `memory/<slug>.md`.
- **What to keep:** stable user preferences, the pet(s) being raised, naming/voice choices,
  recurring goals. **What not to keep:** anything derivable from the repo, one-off chatter, or
  secrets.
- Memory is plain Markdown on disk — fully local, user-owned, matching OpenClaw's local-first
  promise.

## 3. Skills loader

A skill = a folder with `SKILL.md` (frontmatter `name`, `description`; body = triggers +
playbook). Matching algorithm:

1. Collect candidates: every `agents/*/SKILL.md` + everything in `installed.json`.
2. Compare the user's intent against each `description` + keyword list.
3. Pick the single best match; **open and follow its SKILL.md verbatim.** If none matches,
   handle it as a normal assistant request (no skill).

Installing a skill (what `install.mjs` does for the workspace side): copy
`agents/<name>/*.md` into `.openclaw/workspace/skills/<name>/` and add/update its entry in
`installed.json` (`name`, `version`, `source`, `entry`, `installedAt`, `scope`,
`description`). Re-running is idempotent.

## 4. Permission model

| Tier | Examples | Behavior |
|------|----------|----------|
| auto | read file/state, screenshot, GET, open page to read | do it silently |
| ask | edit/delete file, effecting shell cmd, bridge write (`feed`/`clean`/`play`/`say`/`share`), mutating nav | state intent, then do it; batch a session, don't nag per step |
| confirm | `buy` (spends coins), publish to a real external service, `rm -rf`, force-push, anything leaving the machine | stop, get explicit "yes" first |

Tie-break rule: if an action could fit two tiers, choose the **stricter** one. Audit every
bridge write to `.openclaw/workspace/agent/audit.log` (the game writes the same log).

## 5. Autonomous loop (haqi-operator)

This is OpenClaw's "runs 24/7, acts without prompting" capability, scoped to the owner.

**One tick:**
1. Sense — `getState()` (or sim) + `agent/ops-state.json` + tail of `agent/audit.log`.
2. Decide — pick the highest-value action across the four lanes (care / content / marketing /
   analytics); see [../haqi-operator/PLAYBOOK.md](../haqi-operator/PLAYBOOK.md) and
   `../haqi-operator/tasks/*.md`.
3. Act — within the permission tiers (spending/publishing still `confirm`).
4. Record — append a narrative line to `agent/ops-journal.log`, bump counters in
   `agent/ops-state.json`.

**Cadence:** follow [../haqi-operator/schedule.md](../haqi-operator/schedule.md). Run a tick
when scheduled, or on demand ("do your rounds"). Never run two ticks back-to-back to "catch
up" — one per cadence.

---

## Offline mode (no network / no live site)

When there's no KeepWork token or the live site is unreachable, drive the bundled simulator
instead of the real game — same command shape, no network:

```sh
node .openclaw/workspace/sim/run-pet-master.cjs      # runs the pet-master playbooks
```

`sim/magichaqi-sim.cjs` mimics `window.MagicHaqiAgent.exec()` / `getState()`. Mark any
journal/audit note written in this mode as `(simulated)` so it isn't mistaken for live state —
exactly how the existing `agent/ops-journal.log` entry is tagged.

## What we deliberately do NOT emulate

- Real chat-app bridges (WhatsApp/Telegram/etc.) — the host's own chat is the channel.
- The 50+ third-party integrations — only the skills present in `agents/` exist here.
- A persistent background daemon — "autonomous" means scheduled/on-demand ticks in this
  session, not a process that keeps running after the agent exits.
