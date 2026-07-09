# MagicHaqi · agents/

Agent layer for MagicHaqi. MagicHaqi is a pure front-end H5 game (no REST backend);
agents operate the **live website** via the KeepWork login REST, URL params, and a hidden
in-page command interface (`window.MagicHaqiAgent` + `#mh-agent-cmd` / `#mh-agent-result`
/ `#mh-agent-state`).

## pet-master/  (for ALL users)
The OpenClaw skill installed on every user's computer. Lets a user's own agent act as a
**co-parent**: adopt, care for, talk to, and share a MagicHaqi pet.
- `SKILL.md` — skill entry (triggers + playbooks).
- `commands.md` — command cheat sheet + state shape.
- `integration.md` — protocol reference (auth, nav, command interface, safety).

## game-maker/  (for ALL users)
A skill users export from the in-app Game Maker (游戏工坊 → 导入/导出) to hand off to an
external AI coding tool (e.g. Cursor). The tool co-designs a self-contained HTML5 mini-game;
the user pastes the finished HTML back into the Game Maker's Import tab to save/publish.
- `SKILL.md` — skill entry (workflow + constraints + rules of good conduct).

## haqi-operator/  (for DEVELOPERS / owner)
The 24/7 one-person-company operator agent. Runs marketing, content (BYOC), companionship,
and analytics autonomously. Not distributed to end users.
- `SKILL.md` — operator overview.
- `PLAYBOOK.md` — the recurring ops loop.
- `schedule.md` — 24/7 cadence.
- `tasks/` — per-lane prompts (care / content / marketing / analytics).

## In-app fallback
`MagicHaqi.html?view=ops` opens the **Ops Console** — a human dashboard showing agent
state, care to-dos, the audit log, and a manual command runner.
