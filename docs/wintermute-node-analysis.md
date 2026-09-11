# Wintermute NODE — deep analysis & build plan (parallel research track)

> **Status:** research plan only — zero code written, zero capital committed, funding-arb
> stays locked at `0373f5d`. This document exists so the plan is on GitHub *before* we
> decide whether to work on it. Decision owner: user. Research date: 2026-09-11.
> **Decision recorded 2026-09-11 → §0: the W0–W4 track is adopted; Route B (implied
> carry vs forward price) is the primary research direction.**
>
> **POVZETEK (SL):** Povezava, ki si jo delil, je prijavna povezava za **Wintermute NODE
> Trading** (`trade.wintermute.com`) — institucionalno OTC platformo enega največjih
> kripto market-makerjev (>15 milijard USD dnevne prostovoljne menjave). Ni menjalnica
> in **ni venue za našega funding-arb bota** (nima perpetual swapsov) — je RFQ mizа z
> spot, forwards, CFD, opcijami in po meri štrukturiranimi produkti, z **ničelnimi
> provizijami** (cena je v celoti v spreadu) in minimalnimi velikostmi reda
> 100–250 tisoč USD. Za večji zaslužek ima smisel **pogojno**, prek treh realnih poti:
> (A) izvedba velikih pozicij brez provizij/slippage, (B) zaklepanje basis-a z datiranimi
> forwards (deterministični carry brez negotovosti fundinga in brez tveganja likvidacije),
> (C) options-based yield — smer, kjer Wintermuteovi lastni podatki kažejo, da institucije
> dejansko zaslužijo. Odločilni predpogoj: kvalifikacija računa + 30–60 dni merjenja RFQ
> spreadov, preden se premakne kakšen kapital. Podroben verižni sklep v razdelku 7,
> načrt s fazami in kill-kriteriji v razdelku 8.

---

## 0. Decision record — 2026-09-11 (user decision, recorded before any work)

Two directions were on the table: (a) a direct push into a Wintermute/NODE
integration, (b) the phased, zero-capital track in §8. **Decision: (b) — the W0–W4
plan is adopted as written.** Reason recorded by the decision owner: it separates
NODE-the-OTC-product from Wintermute-the-quant-engine, and refuses to move capital
or code before evidence.

Three refinements from the decision discussion are now **binding parts of this plan**:

1. **Route B is elevated to the primary research direction.** The interesting object
   is not a funding bot and not a NODE bot — it is a scanner for the gap between
   *implied carry* and the *actual market price of the forward*:

   ```
   CEX funding observations   (funding-arb scanner — already built)
        ↓
   implied carry              (funding-implied forward premium)
        ↓
   forward RFQ quote          (W1 journal — to be built, zero capital)
        ↓
   compare
        ↓
   ALL-IN EDGE
   ```

   Long-term, this is the seed of a **multi-strategy arbitrage / quant engine**
   (funding spread + implied-vs-priced carry as the first two strategy modules).
   It is a *research direction*, not a feature sprint.

2. **Epistemic rule for the current number (canonical formulation).** The −0.281 %
   economic estimate is a diagnostic reconstruction — funding in paper mode is not a
   realized cashflow. The only permitted phrasing of the result:

   > “Na trenutnem vzorcu in uporabljeni rekonstrukciji ni dokaza za pozitiven edge.”

   Never “the strategy loses −0.281 % in real trading”.

3. **Unit discipline for the −0.281 % figure.** The aggregate is
   Σ(per-close % of trade_usd) over the **7** strategy-attributable closes — i.e.
   **−$1.41 in total across all 7 closes** (not per cycle). Per single $500 cycle the
   mean is ≈ **−0.040 % ≈ −$0.20**. Both numbers are diagnostic only; rule 2 applies
   to both. (Recorded because a per-cycle reading of the aggregate would overstate
   the loss by 7×.)

**Status board at decision time:**

| track | status |
|---|---|
| funding-arb | GREEN audit complete · GREEN baseline locked @ `0373f5d` · YELLOW economic edge NOT proven |
| Wintermute/NODE | GREEN worth researching · GREEN zero capital · GREEN W0/W1 justified · YELLOW not a replacement for funding-arb · RED no real capital until RFQ measurements show an edge |
| long term | funding-arb → multi-strategy arbitrage / quant engine (research direction, not a feature sprint) |

Nothing else changes: funding-arb stays locked, the tower stays read-only, no
capital before the W2 gate, and W0 still requires the account owner's own onboarding
(the credentials are the user's, not the bot's).

---

## 1. What the link actually is (identity resolution)

The shared URL:

```
https://trade-login.wintermute.com/u/login?state=hKFo2SB3aVhKYVRIci0wZ096...
```

is an **Auth0 universal-login** continuation URL (the base64 `state` decodes to an
`auth0.com` universal-login transaction bound to client `7pi9sk0YAZD2GXZODE6m4qp52H7zzeF`).
Verified by headless browser session on 2026-09-11:

- the link redirects to **`https://trade.wintermute.com/`** — page title **“Welcome to
  Node Trading”**, with an email + password + Cloudflare “Verify you are human” login
  form and a **“Register interest”** link;
- the `state` token alone did **not** authenticate anything (we landed on the credential
  form, not an account) — but treat such links as sensitive: they are one-time login
  transactions addressed to your email.

So: `trade.wintermute.com` = the app surface of **Wintermute NODE**, the firm’s flagship
OTC trading platform. `node.wintermute.com` is the marketing/product page; the login the
user received is the account-access flow for it.

## 2. Fact base (what NODE is, with sources)

### 2.1 The firm

| fact | value | source |
|---|---|---|
| what | global algorithmic trading firm + leading digital-asset OTC desk + liquidity provider | wintermute.com |
| scale | **>$15 bn average daily trading volume**, liquidity across 60+ CEX/DEX | PRNewswire 2026-01-13 |
| entities | Wintermute Trading Ltd (UK, FCA MLR-registered, FRN 928764) for spot; **Wintermute Asia Pte. Ltd. (Singapore)** for crypto derivatives | wintermute.com footer |
| regulation | **neither entity is an authorised/regulated investment firm**; both trade as principal for own account; no custody of client assets; new **U.S. broker-dealer (SEC + FINRA) launched 2026-08-06** | wintermute.com disclaimer + announcement |
| clients | institutions + **qualified individuals**; content restricted to “investment professionals” (UK FPO Art. 19(5)); retail clients must not rely on it | 2022 launch coverage + site disclaimer |

### 2.2 The platform

| fact | value | source |
|---|---|---|
| history | NODE launched 2022-04 (250+ assets, zero fees, API + web); **major upgrade 2025-04-03**: end-to-end lifecycle — onboarding, instant credit, execution, settlement, treasury tools, web + mobile | wintermute.com announcements |
| products | **Spot** (hundreds of tokens, new tokens listed “moments after launch”) · **Options** (bespoke bilateral or exchange-cleared) · **Forwards** (flexible delivery, incl. cash-settled **NDFs**; hedging liquid *and locked* positions) · **CFDs** (leveraged exposure, single tokens or baskets, GMCI indices; also WTI crude 24/7, tokenized gold via Wintermute Asia) · **Tailored products** (swaps to exotic options on any underlying) | wintermute.com/otc |
| **not offered** | **perpetual swaps** — no perps product in the public set; the closest substitutes are dated forwards / NDFs / CFDs | product pages (absence) |
| fees | **zero fees or commission** — all cost is embedded in the quoted spread (“tightest spreads”) | wintermute.com/otc |
| minimum size | not published; third-party comparisons put institutional desks at **$100k–$250k/trade**, with Wintermute “typically $200k+” (⚠ unverified estimate) | OTC desk comparisons 2026 |
| access modes | **Node app** (web + mobile, self-service) · **FIX API** (programmatic liquidity, market data, reporting) · **chat trading** (white-glove, 24/7) | wintermute.com/otc |
| financing | apply for trading **credit**, margin trading, collateral posting — a dynamic risk model, “capital efficient trading” | wintermute.com/node |
| onboarding | individual **or** entity through a single access point; instant credit application; multi-entity/user management | 2025-04-03 announcement |

### 2.3 Market-structure data from Wintermute’s own reports (why this matters)

From *Digital Asset OTC Markets 2025* (2026-01-13) and *OTC flow: the institutional
effect* (2026-07-30):

- institutions drove a **record 72% of spot OTC flow in H1 2026** (59% a year earlier);
  retail on the sidelines;
- **altcoin options notional ~3.4× in H1 2026 vs H2 2025**, “driven primarily by yield
  strategies” — for the first time options flow is dominated by **systematic yield and
  risk-management strategies**, not one-off directional bets; 2025 OTC options volume
  more than doubled YoY;
- 2024 OTC volume growth: **traditional financial institutions +284%**, retail brokers
  **+549%** YoY;
- liquidity concentrated in large caps: BTC+ETH ≈ 49% of notional (2025), altcoin rallies
  lasted on average **19 days in 2025 (vs 61 in 2024)** — the long tail thinned out;
- **electronic pricing for options-based yield across majors & 50+ altcoins** since
  2026-04-09; **custom baskets** (multi-asset strategies as one position) case study
  2026-08-26.

Reading: the desk is where institutional yield machinery actually runs — and its own
data says that machinery is increasingly **options-based yield**, not spot, and not
funding-rate arbitrage.

## 3. The honest baseline: what our own audit says about current economics

Any “bigger earnings” analysis must start from the measured system, not from hope.
The 8-round audit of funding-arb @ `0373f5d` (43 findings, closed) established on the
current 12-close paper sample:

```
signed spread PnL (strategy-attributable)   −0.313%
estimated funding income (per-leg, actual)  +1.599%
fees (round trip, both legs)                −1.567%
─────────────────────────────────────────────────────
economic estimate (diagnostic)               −0.281%   (net carry funding−fees = +0.032%)
```

Three structural lessons that directly shape the Wintermute question:

1. **Fees consume nearly all estimated funding** at CEX taker execution, at $500/pair
   size. The single biggest lever for bigger earnings is *cost structure*.
2. **The paper PnL instrument had five correctness defects** (price source, per-leg
   notionals, signed PnL, trade_usd semantics, interval normalization) before the number
   meant anything. Any new venue/measurement must carry those invariants from day one.
3. Funding economics were **estimated, never realized** in paper mode — the decisive
   number is still unobserved. A venue/instrument that makes carry *deterministic at
   inception* (a dated forward) converts this unknown into a contract term.

## 4. Chain of thought — the earnings question

The question: *“ali ima smisel za večji zaslužek?”* — does NODE make sense for bigger
earnings? Work it as a chain:

**Step 1 — What is the current edge, mechanically?**
Cross-venue perp–perp funding differential, harvested at taker execution, $500/pair.
Measured: funding income ≈ fees, spread component negative. The edge, if it exists, is
fee-dominated at this scale.

**Step 2 — Can the current strategy simply move to NODE?**
No. NODE has **no perpetual swaps** — no funding stream to arbitrage there — and RFQ
(one-shot quotes) is not a continuous book a scanner can sweep. Whatever NODE offers us,
it is a *different* instrument family, not a cheaper home for the same bot.
**Route E (port the bot) is rejected on product grounds.**

**Step 3 — Where does NODE change the cost structure?**
Zero commission, all-in spread, no exchange custody/withdrawal friction, and — critically
— **no market impact**: a $250k altcoin print is quoted as one price instead of eating a
thin CEX book (our own scanner runs venue depth checks for exactly this reason).
→ **Route A: execution at scale.** For majors the saving vs CEX taker (~20 bps round
trip both legs) is modest; for alts at size it can be decisive. Gated by capital ≥
minimums. Verdict: real, but only matters after the capital gate.

**Step 4 — Can NODE make the carry deterministic instead of estimated?**
Yes — this is the genuinely interesting one. A **dated forward** (or NDF) embeds the
funding/basis expectation as a fixed premium at inception:
- short forward + long spot = classic cash-and-carry: carry is *locked*, no funding
  uncertainty, no hourly mark noise (our NEW-16 class of problem disappears), no
  liquidation mechanics on the OTC leg (credit line + collateral instead of exchange
  margin, though that substitutes **counterparty credit risk** — see §6);
- the trade is profitable iff the desk’s implied funding (forward premium) under-prices
  realized funding over the tenor. Desks price forwards off their own models; in
  high-funding regimes long-dated forwards sometimes lag spot funding reality.
→ **Route B: basis lock via forwards.** Requires measuring forward premiums against
realized funding for 30–60 days before any trade. Our funding-arb scanner’s funding
data is directly reusable as the pricing benchmark — a real synergy between the two
tracks.

**Step 5 — Where does Wintermute’s own data say the money actually is?**
Not in spot, not in funding: in **options-based systematic yield** (3.4× altcoin options
notional in six months, “dominated by systematic yield strategies”, electronic pricing
since Apr 2026). Covered-call / cash-secured-put programs on inventory are a different
edge source (volatility risk premium) with a decades-long institutional track record,
defined risk if structured properly, and NODE now prices them electronically incl. 50+
alts. Custom baskets let the inventory itself be one position.
→ **Route C: options-based yield on inventory.** Highest documented earnings density on
the platform; different risk (short vol / tail); needs inventory and vol management.

**Step 6 — Is there a hybrid that keeps the funding edge?**
**Route D (niche, event-driven):** short CFD (pay the desk’s financing) + long perp on
a CEX (receive funding) when perp funding APR spikes far above CFD financing — a
funding-spike playbook. Desks quote CFD financing at benchmark + spread, and both widen
in stress; this only works in extreme dislocations and needs live quotes to evaluate.
Keep as a playbook, not a plan.

**Step 7 — What breaks / what could we lose?**
- **Counterparty risk is the structural cost of everything above**: principal-trading,
  effectively unregulated entities (until the new US BD matters), open forwards/CFDs are
  unsecured exposure to the desk. Not a reason to walk away from a top-tier desk — a
  reason for hard exposure caps, short tenors, prompt settlement, desk diversification.
- **Gating**: professional-client classification, min sizes ~$100k–250k. If capital is
  below the gate, NODE is a future-scaling option, not a current one.
- **Quote liquidity is not guaranteed liquidity**: RFQ spreads widen exactly when you
  need them; sampling must cover stressed hours.
- **No custody**: balances/credits sit against the desk.

**Step 8 — Conclusion of the chain.**
NODE does **not** offer a mechanical upgrade to the current strategy, and nothing on it
is “free money”. It offers **three real, measurable routes** (A: scale execution; B:
deterministic basis; C: options yield) whose profitability is *unknown until measured*
— plus one event-driven playbook (D). The correct posture, consistent with everything
this project has learned in eight audit rounds: **qualify, measure, gate, then decide.**
Hence the plan below.

## 5. Side-by-side: CEX perp venue (current) vs Wintermute NODE

| dimension | CEX perps (current track) | Wintermute NODE (OTC) |
|---|---|---|
| instruments | perpetual swaps (funding stream) | spot, dated forwards / NDFs, CFDs, options, tailored |
| fee model | taker/maker per leg, per side | **zero commission — all-in spread in the quote** |
| typical size | $5–$500 clips (our config $500) | est. **$100k–$250k+ minimums** (unverified) |
| execution | continuous book, maker possible, slippage at size | **RFQ one-shot** (app / FIX / chat), no market impact |
| carry mechanics | funding settles every 1–8 h, observable, uncertain | **premium fixed at inception** (forward) or quoted financing (CFD) |
| margin/credit | exchange margin, liquidation engine, insurance funds | credit line + collateral, no liquidation engine, **desk credit exposure** |
| counterparty | exchange (varies, mostly offshore) | single dealer, principal, unregulated UK/SG entities (+ new US BD) |
| automation | full (our bot, scanner + executor) | FIX API + RFQ lifecycle — gated by onboarding |
| market data | free public tickers/funding | quotes via relationship/API; **NODE Insights** research |
| our measurement history | 8 audit rounds, 43 findings, invariants hardened | none yet — invariants must be carried over (§10) |

## 6. Risk register (pre-decision)

| risk | nature | mitigation |
|---|---|---|
| **counterparty default** | open forwards/CFDs/credit are unsecured claims on the desk; entities not under investor-protection regimes | tenor ≤ 3 m; per-desk exposure cap (e.g. ≤ 5–10% of deployable capital); settle promptly; never park idle balances; diversify desks at scale |
| access gate | professional-client classification; min sizes possibly ≫ capital | W0 discovers actual terms; kill-switch if unreachable |
| quote quality | RFQ spreads widen in stress; indicative ≠ executable | sampling protocol must include stressed hours and size ladders |
| product complexity | bespoke/tailored quotes are hard to benchmark | stick to vanilla: forwards, listed-style options, simple CFDs |
| operational | FIX onboarding, quote journaling, settlement ops | reuse funding-arb journal discipline (§10 invariants) |
| login hygiene | shared Auth0 magic/state links are sensitive | regenerate; never paste state URLs into chats/repos |

## 7. Verdict

**Pogojni DA / conditional yes — as a measured parallel track, not a profit engine.**

- It makes sense **only** as: qualification (W0) → zero-capital measurement (W1) →
  pre-registered strategy gate (W2) → minimal defined-risk pilot (W3). No capital moves
  before W2 passes.
- The strongest candidates in order of *documented* earnings density on the platform:
  **C (options yield)** > **B (forward basis lock)** > **A (execution at scale)** >
  D (event playbook). In order of *fit with our existing machinery*: **B** first (our
  scanner’s funding data becomes the forward-pricing benchmark), then C.
- It does **not** replace, upgrade or touch the CEX funding-arb track: different
  instruments, different counterparty model, different risk. The two tracks are
  complementary: funding-arb measures realized funding; NODE lets that measurement be
  monetized via forwards *if* the desk under-prices it.

Binding per the §0 decision record (2026-09-11): the W0–W4 track is adopted; Route B
is the primary research direction; the long-term frame is funding-arb → multi-strategy
arbitrage / quant engine.

## 8. The plan (phases, gates, kill criteria)

> Naming: **W-phases** to keep them distinct from funding-arb phases (P0–P3).
> Every phase has: entry condition, zero-or-defined capital, deliverable, kill criteria.
> Nothing below touches the funding-arb repo or the tower’s read-only contract.

### W0 — Qualification (0 capital, ~1 week)

- complete the login/onboarding flow (individual or entity) through the Node app;
- discover *account-level* facts: which products are actually enabled (forwards? CFDs?
  electronic options?), real minimum sizes per instrument, credit/margin terms,
  collateral options, FIX/API availability and its onboarding requirements;
- deliverable: **capability sheet** appended to this doc (products × mins × credit × API)
  plus the capital check;
- **kill:** if minimums ≫ capital (cannot run even one pilot trade at defined risk) →
  archive as a scaling option; revisit when the capital gate opens. No capital spent.

### W1 — Measurement (0 capital, 30–60 days, the decisive phase)

Systematic RFQ sampling, journaled exactly like the funding-arb paper runner
(JSONL, append-only, one record per quote):

1. **Spot execution cost curve** — BTC/ETH + 2–3 liquid alts; sizes in a ladder
   (min, 2×, 5×); 2–4 quotes/day spanning calm and stressed hours; each record:
   `ts, instrument, side, size, quote_px, ref_mid (Binance+OKX composite), all_in_bps,
   fee_equivalent_bps, quote_age_s`;
2. **Forward basis tracker** (**primary W1 deliverable** — §0 decision record) — 1m and 3m forward mids vs funding-implied premium:
   `implied_funding_apr = (forward_annualized_premium)`, benchmarked against the
   funding-arb scanner’s realized funding series for the same underlying;
   the edge signal is `realized_implied_gap = realized_funding_apr − implied_apr`,
   persistent ≥ 30 days and ≥ 2σ before route B unlocks;
3. **CFD financing quotes** — quoted financing APR vs concurrent perp funding APR
   (route D signal);
4. **Options indicative vol** — electronic quotes on majors vs Deribit ATMF (route C
   signal: are OTC vols at/above exchange vols after the zero-fee structure?).

Deliverable: cost curves + gap time-series + a written W2 recommendation.
**Kill:** if OTC all-in cost at our reachable sizes ≥ CEX composite cost (taker +
slippage) on majors *and* the forward gap does not persist → archive track; the
measurement itself remains a reusable asset.

### W2 — Strategy-selection gate (pre-registered, no discretion at decision time)

Decision matrix, fixed now:

| signal (from W1) | unlocks | pilot |
|---|---|---|
| `realized_implied_gap ≥ 2σ, ≥30 d` on a major | **Route B** | 1× 1m-forward cash-and-carry at minimum size |
| electronic options + inventory feasible, OTC vol ≥ exchange vol | **Route C** | 1× covered call / cash-secured put, 1 expiry |
| capital ≥ 2× min trade + alt inventory needs | **Route A** | one block execution comparison (split: OTC vs CEX TWAP) |
| funding spike ≥ 2× CFD financing, persists ≥ 24 h | **Route D** | event playbook (manual, capped) |
| none of the above | archive | — |

Hard constraints at this gate: counterparty exposure cap set; tenor cap ≤ 3 m;
success/kill criteria for the pilot pre-registered in this doc **before** execution.

### W3 — Minimal defined-risk pilot (capital = one minimum-size position)

- exactly one instrument, minimum size, vanilla structure;
- full journal: every quote (incl. rejected/expired), fills, settlement events;
- measurement invariants from §10 enforced from the first record;
- pre-registered success criteria (examples — to be finalized at W2): realized carry ≥
  80% of locked premium over the tenor; all-in cost within 120% of the W1 cost curve;
  settlement completed within the desk’s stated SLA; zero unauthorized requotes;
- **kill:** any counterparty signal (requote pressure, settlement delay > SLA,
  quote withdrawal in calm markets), or realized economics < 50% of modeled.

### W4 — Scale / integration decision (only if W3 passes)

- FIX API automation of the RFQ lifecycle (quote → execute → settle) with the same
  fail-closed posture as phase3-lab (never submit without an accepted quote; every
  state transition journaled; recovery states enumerated);
- second-desk quoting (diversify counterparty) before size grows;
- tower: a **read-only `wm-desk` monitoring card** (quote freshness, exposure vs cap,
  tenor ladder, realized vs implied funding) — separate data plane, tower still never
  trades;
- revisit this document with measured numbers; the plan above is then replaced by
  an operating manual.

### What we will NOT do (guards)

1. no changes to funding-arb @ `0373f5d` (Phase-2 A/B/C continues undisturbed);
2. no capital at risk before the W2 gate passes on 30+ days of journaled quotes;
3. no tailored/exotic products — vanilla only;
4. no idle balances on the desk — exposure exists only as open contracts;
5. no automation without the fail-closed RFQ state machine (W4, phase3-lab patterns);
6. login/magic links with live `state` tokens never enter repos or chats.

## 9. Security note on the shared link

The URL you shared is an Auth0 login transaction (magic-link style) addressed to your
email. Opening it in our sandbox browser landed on the credential form — the state
alone granted nothing — but these links can be single-sign-on continuations depending
on timing. Treat them like passwords: don’t paste them anywhere; if in doubt, navigate
to `trade.wintermute.com` directly.

## 10. Measurement invariants (audit lessons carried into the new track)

The 8-round audit’s correctness findings become the OTC journal’s schema requirements:

| audit lesson (finding) | OTC journal invariant |
|---|---|
| NEW-16 — “mark price” was actually ticker/last | **I-1: every price field carries an explicit source tag** (`ref_mid_composite`, `desk_quote`, `settlement_print`); no field named by euphemism |
| NEW-17 — per-leg notionals ≠ requested | **I-2: per-leg notional recorded as executed** (quote px × executed qty), requested size kept separate |
| NEW-20 — sign convention inverted 5/12 closes | **I-3: PnL computed as signed `(entry − exit) × qty × direction` from recorded legs only**; no `abs()` anywhere |
| fee audit — fees counted once | **I-4: all-in cost recorded once per quote** (the spread *is* the fee); never added again at settlement |
| quantity chain — 15/15 consistent | **I-5: executed quantity chain quote → fill → settlement must match exactly**; any mismatch = hard error, not a warning |
| NEW-18 — requested-vs-actual ambiguity | **I-6: `requested_size` and `executed_size` are distinct schema fields, both always written** |

## 11. Sources (accessed 2026-09-11)

- wintermute.com — `/otc`, `/node`, announcements: NODE launch (2022-04-06 coverage),
  “New NODE is reshaping how counterparties navigate crypto markets” (2025-04-03),
  NODE Insights (2025-09-17), electronic options pricing (2026-04-09), 24/7 WTI CFDs
  (2026-03-24), US broker-dealer (2026-08-06), custom baskets (2026-08-26);
- PRNewswire — *Digital Asset OTC Markets 2025* report release (2026-01-13);
- wintermute.com — *Digital asset OTC flow: the institutional effect* (2026-07-30);
- trade.wintermute.com — headless-browser verification of the login surface (this doc);
- third-party OTC desk comparisons (min-size estimates, 2026) — flagged unverified;
- this repo — `docs/funding-arb-audit.md` (R1–R8), README (measurement context).

---

*This document is a research plan, not financial advice, and commits nothing. It is
versioned here so that if we decide to work on the Wintermute track, the plan — with
its gates, kill criteria and invariants — already exists on GitHub, dated before any
measurement or capital.*
