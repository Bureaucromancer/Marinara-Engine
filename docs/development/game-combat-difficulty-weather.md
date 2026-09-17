# Combat difficulty and weather

Implementation plan for [#6305](https://github.com/Pasta-Devs/Marinara-Engine/issues/6305), following the combat director in #6302. This document describes the agreed scope; validation results will be recorded as implementation completes.

## Setup and difficulty

Remove the Battlefield Seed field and summary, while retaining Battlefield Size. New encounters receive internal random seeds. Ignore obsolete campaign seed preferences when starting future battles; retain accepted battle seeds, grids and restart behavior. Change Classic's description to “Cinematic menu battles.”

Normalize difficulty through one shared helper, including title-case older setups. Keep enemy damage multipliers Casual 0.6, Normal 1, Hard 1.3 and Brutal 1.6. Classic must scale only enemy damage, like Tactical. Audit encounters and loot for the same casing bug. Pin difficulty at encounter creation, rather than changing it when settings change during combat.

## Weather

Use existing campaign weather and grounded encounter exposure. Save accepted weather with the encounter; an absent field in an old combat save means neutral mechanics. Unknown exposure is neutral. Enclosed environments are sheltered. Current weather aliases must normalize to the existing weather types, and setting a type must generate compatible wind and visibility.

Initial rules apply equally to both sides: rain modestly reduces fire damage and increases lightning damage; strong wind penalizes explicitly tagged projectile attacks; poor visibility penalizes explicitly sight-dependent attacks; snow increases walking costs in Tactical. Flying and teleportation retain their movement semantics. Untagged abilities receive no inferred projectile/sight trait based on names. Clear/cloudy weather is normally neutral. Shared helpers must drive forecasts, resolution and AI estimates without consuming future combat rolls.

Show accepted conditions and effects in both combat interfaces. Cosmetic weather settings cannot disable mechanics. Weather stays fixed during an encounter; weather-changing abilities, periodic weather transitions, random lightning strikes and heat attrition are deferred. Summoning and future rulesets can reuse the shared weather contract without adding an unfinished UI mode.

## Enemy decisions

Preserve role, adjective, proficiency, legality and resource accounting. Difficulty changes bounded seeded decision variation: Casual allows more plausible mistakes, Normal stays near the current baseline, Hard is more consistent and Brutal minimizes mistakes while retaining proficiency differences. Companion decision tuning uses a fixed Normal baseline at every difficulty; companions still respond to real weather and danger. Mindless restrictions remain intact.

Use weather-aware scores for attacks, support, positioning and reactions. Counterspell and guard compete with passing according to threat, cost and personality. No difficulty grants hidden commands, future rolls, free resources or additional actions. The GM boss prompt receives accepted difficulty/weather and guidance on pressure and opportunity selection; the engine still enforces the offered legal choices and budgets. Provider failure retains the local fallback.

## Validation and delivery

Implement setup/correctness, weather, and AI integration in that order. Add runnable regression proof for difficulty casing; enemy-only damage; weather exposure, aliases, forecasts and movement; save/restore; deterministic enemy choices and companion tuning; reaction costs and boss prompt boundaries. Update existing setup/terrain fixtures for the obsolete seed preference. Exercise desktop/mobile and both themes, including weather animations disabled. Run baseline checks, relevant prompt and browser regressions, and local CodeRabbit before marking the draft ready.

Tuning values are initial game-design values, not proven balance. Automated fixtures establish mechanics and invariants; real-provider boss quality and extended campaign balance require playtesting. Deferred issues remain unassigned unless work actually starts on them.
