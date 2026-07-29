# AGENTS.md — GammaDesk development rules

Cursor (and any coding agent) must follow these rules for the life of this repo. Product truth lives in `docs/`; private vision in `docs/BACKBONE.md` (gitignored — read locally when present, never commit it).

---

## 1. Product invariants (do not violate)

1. **Reasoning chain, not dashboard soup.** Features must serve: Driver → Catalyst → Structure → Confirmation → Updated View.
2. **Gamma is an amplifier/compressor, not a directional predictor.** Never ship UI/copy that treats GEX as a standalone “buy/sell SPX” signal.
3. **Anomaly over raw moves.** Macro comparisons use relative volatility / z-scores (or equivalent), not bare % alone.
4. **Flow language is gated.** Use `reported_flow` only with real flow data; otherwise `inferred_rotation` with confidence + basis. Never write “资金流入/inflows into X” as fact from price alone.
5. **Interpret, don’t dump.** User-facing surfaces end in an interpreted state (`DominantDriver`, `MarketStructureState`, close validation, `ViewUpdate`).

---

## 2. Source of truth

| Concern | Doc |
| --- | --- |
| Positioning, MVP scope, users | `docs/product.md` |
| Module boundaries, data flow | `docs/architecture.md` |
| Module I/O shapes | `docs/data-contracts.md` |
| Phases, DoD, current focus | `docs/tasks.md` |
| Private narrative detail | `docs/BACKBONE.md` (local only) |

If code and docs disagree, **fix docs or update docs in the same change**. Do not silently diverge contracts.

---

## 3. Engineering norms

- Prefer small, reviewable diffs; no drive-by refactors.
- Keep compute **deterministic** and separate from LLM interpretation.
- Validate AI outputs against contracts; reject/repair on schema or guardrail failure.
- No secrets in git, client bundles, or docs. Use env/secret managers.
- Do not commit `docs/BACKBONE.md` or other gitignored private files.
- Do not expand MVP scope (e.g. 20Y, multi-user, order routing) without explicit user approval and `product.md` / `tasks.md` updates.

---

## 4. UI / UX constraints for this product

- Structure desk is the primary surface: Positive/Negative/Near Flip, Spot/Flip/Call Wall/Put Wall/Expected Range, Since Open, one-line AI interpretation.
- Avoid generic “AI SaaS dashboard” clutter: no card spam in the hero/primary viewport; one job per section.
- AI copy must include evidence bullets where the contract provides them.

---

## 5. Working style with the human

- Default language with the user may be Chinese; **market/AI output strings** in contracts and UI may stay English unless asked otherwise.
- Before large implementation phases, confirm stack choices recorded in `architecture.md` (Phase 0).
- Update `docs/tasks.md` when finishing a phase task or changing current focus.
- Only commit when the user asks.

---

## 6. Quick checklist before claiming “done”

- [ ] Output matches `data-contracts.md` (or types generated from it)
- [ ] No illegal flow claims
- [ ] Gamma edge is conditional on levels / structure
- [ ] `tasks.md` reflects status
- [ ] Private backbone still gitignored
