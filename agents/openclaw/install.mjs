#!/usr/bin/env node
// OpenClaw runtime installer — wires the agents/openclaw skill into a coding-agent host.
// Usage:
//   node agents/openclaw/install.mjs <claude|copilot|codex|codebuddy|all>
//   node agents/openclaw/install.mjs --check                 # report only, write nothing
//   node agents/openclaw/install.mjs --uninstall <host|all>   # remove what we installed
// No deps, no network, no build. Safe to re-run (idempotent).
'use strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));   // .../agents/openclaw
const REPO = join(SKILL_DIR, '..', '..');                    // repo root
const WS = join(REPO, '.openclaw', 'workspace');             // simulated OpenClaw workspace
const HOSTS = ['claude', 'copilot', 'codex', 'codebuddy'];
const BEGIN = '<!-- BEGIN OPENCLAW (managed by agents/openclaw/install.mjs — do not edit by hand) -->';
const END = '<!-- END OPENCLAW -->';

const rel = (p) => p.replace(REPO + '/', '');
const log = (...a) => console.log(...a);
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
function write(p, s) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); }

// The compact pointer block injected into Copilot/Codex instruction files.
function managedBlock() {
  return [
    BEGIN,
    '## OpenClaw runtime ("be Claw")',
    'When the user says "act as OpenClaw" / "be Claw", emulate the OpenClaw personal-assistant',
    'runtime (https://openclaw.ai). Full skill: `agents/openclaw/SKILL.md`. Five subsystems:',
    '1. **Identity/channel** — persona "Claw": brief, warm, proactive; this chat is the channel.',
    '2. **Memory (first)** — read `.openclaw/workspace/memory/MEMORY.md`; append durable facts; never store secrets.',
    '3. **Skills** — match request → read `agents/*/SKILL.md` (e.g. pet-master, haqi-operator) → follow it verbatim.',
    '4. **Permissions** — auto (reads) do silently · ask (writes) state-then-do · confirm (spend/publish/irreversible) get explicit yes.',
    '5. **Autonomous loop** — run haqi-operator ticks on demand/schedule; record to `agent/ops-*`. No fake background work.',
    END,
  ].join('\n');
}

// Inject/replace the managed block in an instruction file, preserving everything else.
function upsertBlock(file, { remove = false } = {}) {
  const cur = read(file);
  const stripped = cur.includes(BEGIN)
    ? cur.replace(new RegExp(`\\n*${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}\\n*`), '\n').replace(/\n{3,}/g, '\n\n')
    : cur;
  if (remove) {
    if (!cur.includes(BEGIN)) return 'absent';
    write(file, stripped.replace(/\s+$/, '') + '\n');
    return 'removed';
  }
  const body = stripped.trim();
  write(file, (body ? body + '\n\n' : '') + managedBlock() + '\n');
  return cur.includes(BEGIN) ? 'updated' : 'added';
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Copy this skill's SKILL.md into a host's skill folder.
function copySkill(destDir, { remove = false } = {}) {
  const dest = join(destDir, 'SKILL.md');
  if (remove) { if (existsSync(destDir)) { rmSync(destDir, { recursive: true, force: true }); return 'removed'; } return 'absent'; }
  write(dest, read(join(SKILL_DIR, 'SKILL.md')));
  return 'installed';
}

// Register the openclaw skill into the simulated workspace registry.
function syncWorkspace({ remove = false } = {}) {
  const skillsDir = join(WS, 'skills');
  const regPath = join(skillsDir, 'installed.json');
  let reg = { installed: [] };
  try { reg = JSON.parse(read(regPath)) || reg; } catch { /* keep default */ }
  reg.installed = (reg.installed || []).filter((s) => s.name !== 'openclaw');
  if (!remove) {
    copySkill(join(skillsDir, 'openclaw'));
    reg.installed.push({
      name: 'openclaw', version: '1.0.0', source: 'agents/openclaw',
      entry: 'skills/openclaw/SKILL.md', installedAt: new Date().toISOString(),
      scope: 'runtime', description: 'OpenClaw runtime emulation — turns the host coding agent into an OpenClaw-like personal assistant (memory, skills, permissions, autonomous loop).',
    });
  } else {
    copySkill(join(skillsDir, 'openclaw'), { remove: true });
  }
  write(regPath, JSON.stringify(reg, null, 2) + '\n');
  return remove ? 'unregistered' : 'registered';
}

const hasBlock = (f) => read(join(REPO, f)).includes(BEGIN);
const hasSkill = (d) => existsSync(join(REPO, d, 'SKILL.md'));

const TARGETS = {
  claude: { label: 'Claude Code', file: '.claude/skills/openclaw/', present: () => hasSkill('.claude/skills/openclaw'), go: (rm) => copySkill(join(REPO, '.claude/skills/openclaw'), { remove: rm }) },
  copilot: { label: 'GitHub Copilot', file: '.github/copilot-instructions.md', present: () => hasBlock('.github/copilot-instructions.md'), go: (rm) => upsertBlock(join(REPO, '.github/copilot-instructions.md'), { remove: rm }) },
  codex: { label: 'OpenAI Codex', file: 'AGENTS.md', present: () => hasBlock('AGENTS.md'), go: (rm) => upsertBlock(join(REPO, 'AGENTS.md'), { remove: rm }) },
  codebuddy: {
    label: 'Tencent CodeBuddy', file: '.codebuddy/skills/openclaw/ + .codebuddy/rules/openclaw.md',
    present: () => hasSkill('.codebuddy/skills/openclaw'),
    go: (rm) => {
      const a = copySkill(join(REPO, '.codebuddy/skills/openclaw'), { remove: rm });
      const rulePath = join(REPO, '.codebuddy/rules/openclaw.md');
      if (rm) { if (existsSync(rulePath)) rmSync(rulePath); }
      else write(rulePath, '# OpenClaw\nWhen asked to "act as OpenClaw"/"be Claw", follow `.codebuddy/skills/openclaw/SKILL.md` (source: `agents/openclaw/`).\n');
      return a;
    },
  },
};

function run() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const uninstall = args.includes('--uninstall');
  const names = args.filter((a) => !a.startsWith('--'));
  const want = names.includes('all') || (names.length === 0 && !check) ? HOSTS : names;

  if (check) {
    log('OpenClaw runtime — install status:');
    for (const h of HOSTS) {
      const t = TARGETS[h];
      log(`  ${t.present() ? '✓' : '·'} ${t.label.padEnd(18)} ${t.file}`);
    }
    const reg = (() => { try { return JSON.parse(read(join(WS, 'skills/installed.json'))); } catch { return { installed: [] }; } })();
    log(`  workspace registry: ${reg.installed?.some((s) => s.name === 'openclaw') ? '✓ openclaw registered' : '· not registered'}`);
    return;
  }

  const bad = want.filter((h) => !HOSTS.includes(h));
  if (bad.length) { log(`Unknown host(s): ${bad.join(', ')}. Valid: ${HOSTS.join(', ')}, all.`); process.exit(1); }

  log(`OpenClaw runtime — ${uninstall ? 'uninstalling from' : 'installing into'}: ${want.join(', ')}`);
  for (const h of want) {
    const t = TARGETS[h];
    const r = t.go(uninstall);
    log(`  ${uninstall ? '−' : '+'} ${t.label.padEnd(18)} ${rel(join(REPO, t.file.split(' + ')[0]))}  [${r}]`);
  }
  const w = syncWorkspace({ remove: uninstall });
  log(`  ${uninstall ? '−' : '+'} workspace registry   .openclaw/workspace/skills/installed.json  [${w}]`);
  log(uninstall ? 'Done. Removed OpenClaw runtime wiring.' : 'Done. Activate by telling the agent: "act as OpenClaw" / "be Claw".');
}

run();
