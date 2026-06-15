# openclaw/  — the "be OpenClaw" runtime skill

A **portable skill** that makes any coding agent — Claude Code, GitHub Copilot, OpenAI Codex,
or Tencent CodeBuddy — behave like an [OpenClaw](https://openclaw.ai) personal-assistant
runtime: persona, persistent memory, skill loading, permission-gated system/browser access,
and an autonomous loop.

> The other skills here (`pet-master`, `haqi-operator`) run **inside** OpenClaw. This one
> makes the host agent **act as** OpenClaw so those skills have a runtime to run in.

## Files
- [USAGE.md](USAGE.md) — 怎么开启（中文备忘）：下次让 Claude Code 模仿 OpenClaw 看这个。
- [SKILL.md](SKILL.md) — the runtime-emulation brain (5 subsystems + guardrails). This is the
  file that gets installed into each host.
- [runtime.md](runtime.md) — detailed spec: how to reproduce each subsystem with host tools,
  workspace layout, offline simulator mode, what we deliberately don't emulate.
- [hosts.md](hosts.md) — where each host loads skills/instructions and what the installer writes.
- [install.mjs](install.mjs) — the installer/uninstaller tool (no deps, no network, idempotent).

## Quick start
```sh
node agents/openclaw/install.mjs all        # wire into all four hosts
node agents/openclaw/install.mjs claude     # or just one
node agents/openclaw/install.mjs --check     # show status, write nothing
node agents/openclaw/install.mjs --uninstall all
```
Then tell the agent: **"act as OpenClaw"** / **"be Claw"**. To run it without installing, just
say that in any session inside this repo — the agent reads `agents/openclaw/SKILL.md` directly.

## What gets written per host
| Host | Target |
|------|--------|
| Claude Code | `.claude/skills/openclaw/SKILL.md` |
| GitHub Copilot | managed block in `.github/copilot-instructions.md` |
| OpenAI Codex | managed block appended to `AGENTS.md` (existing rules untouched) |
| Tencent CodeBuddy | `.codebuddy/skills/openclaw/SKILL.md` + `.codebuddy/rules/openclaw.md` |

Plus the workspace side: the skill is copied to `.openclaw/workspace/skills/openclaw/` and
registered in `installed.json`. Re-running updates in place; `--uninstall` removes only our part.
