# 0.2.0: the v7 refactor, plan for the owner

Written 23 November 2026, after 0.1.10 shipped (develop = main = 5b9b9a0e) and orb3 3.0.2 was published on
aphesist/orb2 main (bfa4e8c).

## What is decided and only needs building

- **Design system v7:** `w31/design-system-v7` (8ec7ede3). It covers tokens, the 42-component kit (§21), the mark,
  the AskCard, the dock (§21.4), the Session tab (§20, SESSION-TAB.md) and the bots' look (§23).
- **Lab plan:** LAB-v7.md. It lists every defect class the owner found as a blocking check: wrap, row, contain,
  padding, align, concentric, inline-baseline, mark, sweep, same-component and align-btn.
- **Bots:** orb3 3.0.2, with home pose B at rest, the shared state table, and bigger, bolder eyes. The edge-flicker
  checks are in `w31/bot-character` (ORBS.md).
- **Onboarding:** one continuous first run (`w31/onboarding-design`, ONBOARDING.md).
- **Specs:**
  - `w31/specs`: host protections, rules engine, team ops, approval surfaces, feedforward, inline blanks
    (ADR-0051..0056).
  - `w32/session-specs`: session launch and permission scale, checkpoint rewind (ADR-0057, ADR-0058).
- **Session waves S1-S3:** PLAN-session-waves.md.
- **Already built, waiting to merge:**
  - `w30/governed-bots`
  - `w30/local-api-0.2`
  - `w30/macos` (green)
  - the notch design (approved, with the corner correction)

## Waves

One writer per area per wave, each in its own worktree. Review in a fresh context, then QA on a real engine. The
lead integrates on `w3N/integrate` and runs all gates on the merged code.

| Wave | Branches (parallel within a wave) | Area | Depends on |
|---|---|---|---|
| **A. 0.2.0 base** | `w32/integrate` takes `w30/governed-bots`, `w30/local-api-0.2`, `w30/macos`; ADR-0048 collision renumbered to 0050 | all | nothing |
| **B. Kit + lab** | `w32/lab-v7`: lab checks from LAB-v7.md first, so they guard everything after. `w32/kit-v7`: tokens.v7, the 42 components, orb3 3.0.2 swapped in for orb2, the mark, the AskCard, the dock component | UI kit, lab | A |
| **C. Surfaces on the kit** | `w33/shell-bots` (shell, sidebar/rail, Bots chat and rooms, Grok parity §19). `w33/session-s0` (S0: running sessions stay live on switch, launch settings, the 4-step scale, rewind; session-launch.md, checkpoint-rewind.md). `w33/dock` (Sessions-only, hidden until own bots). `w33/onboarding` (first run). `w33/settings-store` (Settings pages, Store, Connectors in v7) | UI modules, plus the plugin and host where S0 needs them | B |
| **D. Foundations** | `w34/host-protections`, `w34/rules-engine` (+ rules UI), `w34/team-ops`, `w34/feedforward-live`, `w34/blanks-inline` | plugin, host | A; UI parts after B |
| **E. macOS** | `w34/notch-helper` (Swift notch, aligned to v7); signing and notarisation | macOS | A, B |

**Release 0.2.0** = A + B + C + E. D goes in as each part is reviewed and passes on a real engine; whatever isn't
ready moves to 0.2.x. The Session waves S1-S3 (worktrees, follow-ups, inbox, git flows, terminal...) follow in 0.3.

## Gates (in addition to today's)

- Every LAB-v7 check is blocking in CI.
- No retired component names, and no loose values: a token check.
- orb flicker: 0 changed pixels at rest, and edge checks on the orb stories.
- e2e on a real engine for S0 (launch params, model switch, rewind) and for each D feature.
- Owner previews from the lab before each wave merges.

## Needed from the owner

1. **Scope:** is the split above right (D only as ready, S1+ in 0.3)?
2. **macOS signing secrets** for a signed, notarised dmg: APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD,
   APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID. Without them, 0.2.0's dmg ships unsigned.
3. **governed-bots** has defaults the owner already decided (no caps by default; tiers kept). Confirm nothing else
   needs a decision before it merges.
