# Promo Campaign Maker — Scheduled Automation

This skill can run as a daily marketing-material generator. It is not a posting bot.
Scheduled mode produces fresh screenshots, platform-specific copy, and a human review pack.

## State Files

Keep persistent campaign context here:

| Path | Purpose |
| --- | --- |
| `agents/promo-campaign-maker/context/campaign-state.md` | Current product URL, audience priority, active source docs, approved claims, blocked claims, target platforms, and last run. |
| `agents/promo-campaign-maker/context/source-docs/` | Saved user-provided plans, specs, business docs, and campaign briefs when they are not already workspace files. |
| `agents/promo-campaign-maker/context/run-log.md` | Append-only record of scheduled runs and blockers. |
| `promo/YYYY-MM-DD/` | Screenshots for each run. |
| `docs/promo-posting-pack-YYYY-MM-DD.md` | Human-reviewable daily posting pack. |

Never store passwords, cookies, tokens, API keys, private account identifiers, or unpublished
third-party IP assets in the context files.

## Suggested Cadence

| Mode | Interval | Output |
| --- | --- | --- |
| Daily light run | Once per day | 6-8 screenshots, 1 posting pack, top 3 recommended posts. |
| Campaign launch run | Once before launch or major update | 10-14 screenshots, larger platform matrix, B2B/IP partner pitch. |
| Weekly refresh | Once per week | Review prior packs, remove stale claims, update message map and screenshot route. |

Do not create more than one daily posting pack unless the owner explicitly asks. Avoid flooding
the team with repetitive drafts.

## Daily Run Algorithm

1. Read `campaign-state.md`.
2. Read all active source docs listed in the state file.
3. Confirm the product URL exists. If missing, add `Needs owner input` to `campaign-state.md`
   and stop.
4. Open the product URL in a browser.
5. Capture a fresh screenshot set under `promo/YYYY-MM-DD/`:
   - 2 stable baseline shots, such as landing and main loop.
   - 2-4 feature proof shots, such as AI pet result, story card, collection, event, or share view.
   - 1-2 audience-specific shots, such as parent-friendly, nostalgia, creator, or B2B/IP proof.
6. Match every screenshot to the active plan: feature, user benefit, platform role, and risk note.
7. Generate `docs/promo-posting-pack-YYYY-MM-DD.md` with platform-specific copy.
8. Mark uncertain claims as `需确认`; do not invent metrics.
9. Append a run summary to `run-log.md`:
   - date/time,
   - URL,
   - source docs used,
   - screenshot folder,
   - posting pack path,
   - top 3 recommended posts,
   - blockers or owner approvals needed.

## Human Review Gate

Scheduled mode must stop at draft generation. A human must approve before anything is posted.

Require human approval when content includes:

- External IP, character names, screenshots, logos, or partner materials.
- Child-facing claims, parent-safety claims, paid features, discounts, or scarcity language.
- Any metric, endorsement, launch date, platform availability, or partnership claim.
- Screenshots that include real user data or private account information.

## Recovery Rules

- If the website fails to load, create a short failure entry in `run-log.md` and do not generate
  fake screenshots or generic copy.
- If login is required, ask the owner to log in through the browser. Do not request secrets in
  chat and do not save credentials.
- If today already has a posting pack, update it only when the owner asks or when the previous
  run failed before completion.
- If three scheduled runs fail in a row, stop scheduled automation and surface the blocker.