# Hosts — installing the OpenClaw runtime into each coding agent

The skill source of truth is [SKILL.md](SKILL.md). Each host discovers skills/instructions in
a different place, so `install.mjs` writes the right file for each. You can also wire any host
by hand using the table below.

Run the installer from the repo root:

```sh
node agents/openclaw/install.mjs claude       # one host
node agents/openclaw/install.mjs all          # every host
node agents/openclaw/install.mjs --check       # show what's installed, write nothing
node agents/openclaw/install.mjs --uninstall claude
```

Every host also gets the workspace side installed: the skill copied into
`.openclaw/workspace/skills/openclaw/` and registered in `installed.json`.

| Host | What the installer writes | How that host loads it |
|------|---------------------------|------------------------|
| **Claude Code** | `.claude/skills/openclaw/SKILL.md` (copy of this skill) | Claude Code auto-discovers `.claude/skills/*/SKILL.md`; invoke via the Skill tool / `/openclaw`. |
| **GitHub Copilot** | `.github/copilot-instructions.md` (managed OpenClaw block, append/replace) | Copilot Chat reads repo custom instructions automatically. |
| **OpenAI Codex** | `AGENTS.md` (managed OpenClaw section, append/replace) | Codex reads `AGENTS.md` from repo root as its instructions. |
| **Tencent CodeBuddy** | `.codebuddy/skills/openclaw/SKILL.md` + `.codebuddy/rules/openclaw.md` | CodeBuddy loads project skills from `.codebuddy/skills/` and rules from `.codebuddy/rules/`. |

## Managed block convention

For the file-appending hosts (Copilot, Codex) the installer writes content between markers so
re-running updates in place instead of duplicating, and `--uninstall` can remove just our part:

```md
<!-- BEGIN OPENCLAW (managed by agents/openclaw/install.mjs — do not edit by hand) -->
... pointer to agents/openclaw/SKILL.md + the five-subsystem summary ...
<!-- END OPENCLAW -->
```

For the skill-folder hosts (Claude Code, CodeBuddy) the installer copies `SKILL.md` whole, so
edit the source here and re-run to update.

## Notes per host

- **Claude Code** — the SKILL.md frontmatter (`name`, `description`) is exactly the format
  Claude Code expects, so the copy works as-is. Project skills also work from
  `.claude/skills/`; this repo's `agents/` is the authoring location.
- **Copilot** — keep the instruction block short; Copilot weights repo instructions but has a
  budget. The managed block is a pointer + the 5-subsystem checklist, not the whole spec.
- **Codex** — this repo already has a root `AGENTS.md` (MagicHaqi dev rules incl. "never
  `npm run build`"). The installer appends the OpenClaw section *after* the existing content;
  it never rewrites the build rules.
- **CodeBuddy** — uses the same `SKILL.md` shape as Claude Code under `.codebuddy/skills/`; the
  extra `rules/openclaw.md` is a one-line pointer so the persona is active even outside a
  skill invocation.

After installing, activate by telling the agent **"act as OpenClaw" / "be Claw"**, or invoke
the skill directly on hosts that support slash/skill invocation.
