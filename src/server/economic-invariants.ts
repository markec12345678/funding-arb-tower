// ---------------------------------------------------------------------------
// R7 economic invariants — the per-close mathematical decomposition test.
//
// Read-only measurement layer (review round 7, "polish audit"): for every
// successfully closed position, join the three recorded evidence sources —
//   ledger row   (qty, leg prices, trade_usd, opened_at / closed_at)
//   open action  (entry scanner row: funding rates, intervals, next-settle
//                 timestamps, leg fees — the snapshot the system had at open)
//   close action (executed legs: close ref_price per leg)
// and verify the eight invariant dimensions A–H:
//   A requested notional      = trade_usd (config value)
//   B long actual notional    = qty × long_price
//   C short actual notional   = qty × short_price
//   D price source            = futures ticker/last (NEW-16 — the price named
//                               "mark" in the code is get_futures_ticker)
//   E funding-rate source     = entry snapshot only (no per-position rate
//                               history exists — NEW-08/NEW-19 consequence)
//   F funding interval        = per-leg interval_h from the entry row
//   G next settlement         = per-leg settle timestamps + how many
//                               settlements actually fell inside the hold
//   H estimated funding       = per-leg: notional × rate × periods
//
// Then the decomposition identity is written out per close:
//   economic estimate = spread PnL + funding leg A + funding leg B − fees
// (spread PnL uses the SAME instrument as the primary report view; funding
// and fees are computed from the ACTUAL per-leg notionals — NEW-17 — not
// from trade_usd).
//
// SCOPE GUARD (the reason this exists): this is a DIAGNOSTIC decomposition,
// NOT a Phase-2 PnL instrument. The Day-5/7 verdict stays on the
// strategy-attributable paper SPREAD PnL; realized funding cashflow is not
// observed in paper mode (NEW-08/NEW-15). The estimate answers exactly one
// question — is the previously measured funding-component materiality
// (+1.03 % … +1.60 % for the attributable closes, R6 two-point estimate) of
// the right magnitude once computed per-leg, per-interval, per-notional?
// The measured system (0373f5d) is untouched.
// ---------------------------------------------------------------------------

export interface EconomicLegRow {
  position_id: string;
  base: string;
  direction: string;
  is_data_gap: boolean;
  closed_at: string | null;
  held_h: number | null;
  // A — requested notional (config trade_usd; NEW-18: stays the requested
  // value in the ledger even after flooring/spread execution)
  requested_usd: number | null;
  // B / C — actual per-leg notionals from ledger qty × leg price (NEW-17:
  // ref_px = max(long_px, short_px) makes one leg ≤ trade_usd by construction)
  long_notional_usd: number | null;
  short_notional_usd: number | null;
  // D / E — provenance constants for this row
  price_source: string;
  funding_rate_source: string;
  // F — per-leg settlement intervals (hours)
  long_interval_h: number | null;
  short_interval_h: number | null;
  // G — settlements that actually fell inside (opened_at, closed_at]
  long_settlements: number | null;
  short_settlements: number | null;
  long_next_settle_at: string | null;
  short_next_settle_at: string | null;
  // H — estimated funding cashflow per leg, entry-rate constant, linear accrual
  long_leg_funding_usd: number | null;
  short_leg_funding_usd: number | null;
  net_funding_usd: number | null;
  // settlement-count variant (stricter: 0 until a settlement actually lands)
  net_funding_sc_usd: number | null;
  // fees — round trip on the ACTUAL per-leg notionals (open + close × both legs)
  fee_usd: number | null;
  // the primary instrument's quantity, same formula as exit-classification
  spread_pnl_usd: number | null;
  // R8 (NEW-20): signed mark-to-market variant — (S_open − S_close) × qty,
  // S = short_venue_price − long_venue_price, SIGNED. The instrument's
  // abs()+direction-sign convention equals this only when sign_dir × S > 0.
  spread_signed_usd: number | null;
  // the decomposition: spread + funding − fees (instrument spread)
  economic_usd: number | null;
  economic_sc_usd: number | null;
  // decomposition with the SIGNED spread (R8 corrected reading)
  economic_signed_usd: number | null;
  // old-instrument comparison (R6 two-point estimate bounds, % of trade_usd):
  // entry spread × held/8h (constant) and half of it (linear decay)
  r6_upper_pct: number | null;
  r6_lower_pct: number | null;
  new_estimate_pct: number | null;
  // invariant A–H join completeness for this close
  components_complete: boolean;
}

export interface EconomicAggregate {
  rows: number;
  summed_trade_usd: number | null;
  spread_pnl_usd: number | null;
  net_funding_usd: number | null;
  fee_usd: number | null;
  economic_usd: number | null;
  // Σ per-close pct of trade_usd — THE primary instrument's unit (Σ of the
  // per-exit spread pnl_pct values); comparable with the R6 estimate range
  spread_total_pct: number | null;
  // R8 (NEW-20): signed-spread aggregates — the corrected mark-to-market
  // reading of the same components (funding and fees are unaffected: their
  // per-leg formulas carry their own signs)
  spread_signed_total_pct: number | null;
  economic_signed_total_pct: number | null;
  net_funding_total_pct: number | null;
  fee_total_pct: number | null;
  economic_total_pct: number | null;
  // secondary: % of the summed requested capital ($3500 for 7 closes)
  economic_of_capital_pct: number | null;
  r6_upper_pct: number | null;
  r6_lower_pct: number | null;
}

export interface EconomicInvariants {
  generated_at: string;
  closes: number;
  attributable: EconomicAggregate;
  data_gap: EconomicAggregate;
  // Σspread + Σfunding − Σfees = Σeconomic on the attributable group,
  // carried in the primary instrument's unit (Σ per-close pct of trade_usd)
  identity_check: {
    spread_pct: number;
    funding_pct: number;
    fees_pct: number;
    economic_pct: number;
    spread_usd: number;
    funding_usd: number;
    fees_usd: number;
    economic_usd: number;
    consistent: boolean;
  } | null;
  completeness: { complete: number; incomplete: number };
  per_close: EconomicLegRow[];
  note: string;
}

const PRICE_SOURCE = "futures ticker/last (get_futures_ticker — NEW-16)";
const RATE_SOURCE = "entry snapshot only (no per-position rate history)";

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

// How many settlements fell inside (opened_at, closed_at] for one leg.
// first settle = the entry row's next_funding_ts; then every interval.
function settlementsIn(
  openedMs: number,
  closedMs: number,
  nextSettleMs: number | null,
  intervalH: number | null
): number | null {
  if (nextSettleMs === null || intervalH === null || intervalH <= 0) return null;
  if (closedMs <= nextSettleMs) return closedMs > openedMs && nextSettleMs <= closedMs ? 1 : 0;
  const intervalMs = intervalH * 3_600_000;
  return Math.floor((closedMs - nextSettleMs) / intervalMs) + 1;
}

export function decomposeEconomics(
  journalRaw: string | null,
  positionsRaw: string | null
): EconomicInvariants | null {
  if (!journalRaw || !positionsRaw) return null;

  // ledger rows by id (open-side record)
  const positions = new Map<string, any>();
  try {
    const rows = JSON.parse(positionsRaw);
    if (Array.isArray(rows)) for (const p of rows) if (p?.id) positions.set(p.id, p);
  } catch {
    return null;
  }

  // journal pass: open action (entry snapshot) + last successful close per id
  const openRow = new Map<string, any>();
  const closeById = new Map<string, { ts: string; action: any; thresholds: any }>();
  for (const line of journalRaw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let d: any;
    try {
      d = JSON.parse(t);
    } catch {
      continue;
    }
    if ((num(d?.scan_total) ?? 0) < 50) continue; // real-cycle filter (same as funnel)
    for (const a of Array.isArray(d?.actions) ? d.actions : []) {
      if (a?.action === "open") {
        const state = String(a?.result?.state ?? "");
        const id = String(a?.result?.position_id ?? "");
        if ((state === "simulated" || state === "filled") && id && !openRow.has(id)) {
          openRow.set(id, a?.candidate ?? null);
        }
      } else if (a?.action === "close") {
        const state = String(a?.result?.state ?? "");
        const id = String(a?.position_id ?? "");
        if ((state === "simulated" || state === "filled") && id) {
          closeById.set(id, { ts: String(d?.ts ?? ""), action: a, thresholds: d?.thresholds });
        }
      }
    }
  }

  const perClose: EconomicLegRow[] = [];
  for (const [id, { action, thresholds }] of closeById) {
    const pos = positions.get(id) ?? null;
    const cand = openRow.get(id) ?? null;

    const edge = num(action?.edge);
    const exitThr = num(thresholds?.exitThresholdPct) ?? 0.01;
    const isDataGap = edge === null || edge === -999.0;

    const qty = num(pos?.qty);
    const longPrice = num(pos?.long_price);
    const shortPrice = num(pos?.short_price);
    const tradeUsd = num(pos?.trade_usd);
    const openedMs = num(pos?.opened_at);
    const closedMs = num(pos?.closed_at);
    const heldH =
      openedMs !== null && closedMs !== null
        ? Math.max(0, (closedMs - openedMs) / 3_600_000)
        : null;

    // A / B / C
    const requestedUsd = tradeUsd;
    const longNotional = qty !== null && longPrice !== null ? qty * longPrice : null;
    const shortNotional = qty !== null && shortPrice !== null ? qty * shortPrice : null;

    // E / F / G — entry snapshot fields
    const longRate = num(cand?.long_rate_pct);
    const shortRate = num(cand?.short_rate_pct);
    const longInterval = num(cand?.long_interval_h);
    const shortInterval = num(cand?.short_interval_h);
    const longSettleMs = num(cand?.long_settle_ms);
    const shortSettleMs = num(cand?.short_settle_ms);
    const longFee = num(cand?.long_fee_pct);
    const shortFee = num(cand?.short_fee_pct);
    const feePair = num(cand?.fee_pct);
    const entrySpreadPct = num(cand?.spread_pct);

    const longSettlements =
      openedMs !== null && closedMs !== null && longSettleMs !== null && longInterval !== null
        ? settlementsIn(openedMs, closedMs, longSettleMs, longInterval)
        : null;
    const shortSettlements =
      openedMs !== null && closedMs !== null && shortSettleMs !== null && shortInterval !== null
        ? settlementsIn(openedMs, closedMs, shortSettleMs, shortInterval)
        : null;

    // H — linear accrual, entry-rate constant, ACTUAL per-leg notional.
    // long pays the rate (receives when negative); short receives it.
    const longPeriods =
      heldH !== null && longInterval !== null && longInterval > 0 ? heldH / longInterval : null;
    const shortPeriods =
      heldH !== null && shortInterval !== null && shortInterval > 0 ? heldH / shortInterval : null;
    const longLegFunding =
      longRate !== null && longNotional !== null && longPeriods !== null
        ? -(longRate / 100) * longNotional * longPeriods
        : null;
    const shortLegFunding =
      shortRate !== null && shortNotional !== null && shortPeriods !== null
        ? (shortRate / 100) * shortNotional * shortPeriods
        : null;
    const netFunding =
      longLegFunding !== null && shortLegFunding !== null
        ? longLegFunding + shortLegFunding
        : null;
    const netFundingSc =
      longRate !== null && shortRate !== null &&
      longNotional !== null && shortNotional !== null &&
      longSettlements !== null && shortSettlements !== null
        ? -(longRate / 100) * longNotional * longSettlements +
          (shortRate / 100) * shortNotional * shortSettlements
        : null;

    // fees — round trip (open+close) on both legs at their ACTUAL notionals
    const lf = longFee !== null ? longFee : feePair !== null ? feePair / 2 : null;
    const sf = shortFee !== null ? shortFee : feePair !== null ? feePair / 2 : null;
    const feeUsd =
      lf !== null && sf !== null && longNotional !== null && shortNotional !== null
        ? 2 * ((lf / 100) * longNotional + (sf / 100) * shortNotional)
        : null;
    // spread PnL — the primary instrument's formula, same as exit-classification
    const executed: any[] = Array.isArray(action?.result?.executed) ? action.result.executed : [];
    let closeLongPx: number | null = null;
    let closeShortPx: number | null = null;
    for (const e of executed) {
      const ref = num(e?.ref_price);
      if (ref === null) continue;
      if (e?.type === "close_long") closeLongPx = ref;
      if (e?.type === "close_short") closeShortPx = ref;
    }
    const spreadPnlUsd =
      longPrice !== null && shortPrice !== null && qty !== null &&
      closeLongPx !== null && closeShortPx !== null
        ? (String(pos?.direction ?? "forward").toLowerCase() === "forward" ? 1 : -1) *
          (Math.abs(longPrice - shortPrice) - Math.abs(closeLongPx - closeShortPx)) *
          qty
        : null;
    // R8 (NEW-20): signed mark-to-market — the mechanical PnL of the fixed legs
    const spreadSignedUsd =
      longPrice !== null && shortPrice !== null && qty !== null &&
      closeLongPx !== null && closeShortPx !== null
        ? (shortPrice - longPrice - (closeShortPx - closeLongPx)) * qty
        : null;

    // Per-row DISPLAY rounding first (3 dp), then the decomposition is built
    // FROM the rounded components — the identity holds exactly on the numbers
    // the report shows (definition, not an independent measurement).
    const spreadR = spreadPnlUsd === null ? null : Math.round(spreadPnlUsd * 1000) / 1000;
    const spreadSignedR = spreadSignedUsd === null ? null : Math.round(spreadSignedUsd * 1000) / 1000;
    const fundingR = netFunding === null ? null : Math.round(netFunding * 1000) / 1000;
    const fundingScR = netFundingSc === null ? null : Math.round(netFundingSc * 1000) / 1000;
    const feeR = feeUsd === null ? null : Math.round(feeUsd * 1000) / 1000;
    const economicUsd =
      spreadR !== null && fundingR !== null && feeR !== null
        ? Math.round((spreadR + fundingR - feeR) * 1000) / 1000
        : null;
    const economicScUsd =
      spreadR !== null && fundingScR !== null && feeR !== null
        ? Math.round((spreadR + fundingScR - feeR) * 1000) / 1000
        : null;
    const economicSignedUsd =
      spreadSignedR !== null && fundingR !== null && feeR !== null
        ? Math.round((spreadSignedR + fundingR - feeR) * 1000) / 1000
        : null;

    // old-instrument bounds (% of trade_usd): entry spread × held/8h, and
    // half of it (the R6 linear-decay lower bound)
    const r6Upper =
      entrySpreadPct !== null && heldH !== null ? (entrySpreadPct * heldH) / 8 : null;
    const r6Lower = r6Upper !== null ? r6Upper / 2 : null;
    const newEstimatePct =
      netFunding !== null && tradeUsd !== null && tradeUsd > 0 ? (netFunding / tradeUsd) * 100 : null;

    const complete =
      requestedUsd !== null &&
      longNotional !== null &&
      shortNotional !== null &&
      longRate !== null &&
      shortRate !== null &&
      longInterval !== null &&
      shortInterval !== null &&
      longSettleMs !== null &&
      shortSettleMs !== null &&
      netFunding !== null &&
      feeUsd !== null &&
      spreadPnlUsd !== null;

    perClose.push({
      position_id: id,
      base: String(pos?.base ?? cand?.base ?? ""),
      direction: String(pos?.direction ?? cand?.direction ?? "forward"),
      is_data_gap: isDataGap,
      closed_at: closedMs !== null ? new Date(closedMs).toISOString() : null,
      held_h: heldH === null ? null : Math.round(heldH * 10) / 10,
      requested_usd: requestedUsd,
      long_notional_usd: longNotional === null ? null : Math.round(longNotional * 100) / 100,
      short_notional_usd: shortNotional === null ? null : Math.round(shortNotional * 100) / 100,
      price_source: PRICE_SOURCE,
      funding_rate_source: RATE_SOURCE,
      long_interval_h: longInterval,
      short_interval_h: shortInterval,
      long_settlements: longSettlements,
      short_settlements: shortSettlements,
      long_next_settle_at:
        longSettleMs !== null && longSettleMs > 0 ? new Date(longSettleMs).toISOString() : null,
      short_next_settle_at:
        shortSettleMs !== null && shortSettleMs > 0 ? new Date(shortSettleMs).toISOString() : null,
      long_leg_funding_usd: longLegFunding === null ? null : Math.round(longLegFunding * 1000) / 1000,
      short_leg_funding_usd: shortLegFunding === null ? null : Math.round(shortLegFunding * 1000) / 1000,
      net_funding_usd: fundingR,
      net_funding_sc_usd: fundingScR,
      fee_usd: feeR,
      spread_pnl_usd: spreadR,
      spread_signed_usd: spreadSignedR,
      economic_usd: economicUsd,
      economic_sc_usd: economicScUsd,
      economic_signed_usd: economicSignedUsd,
      r6_upper_pct: r6Upper === null ? null : Math.round(r6Upper * 1000) / 1000,
      r6_lower_pct: r6Lower === null ? null : Math.round(r6Lower * 1000) / 1000,
      new_estimate_pct: newEstimatePct === null ? null : Math.round(newEstimatePct * 1000) / 1000,
      components_complete: complete,
    });
  }

  perClose.sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""));

  const agg = (rows: EconomicLegRow[]): EconomicAggregate => {
    const ok = rows.filter((r) => r.components_complete);
    const sum = (sel: (r: EconomicLegRow) => number | null) =>
      ok.length ? ok.reduce((s, r) => s + (sel(r) ?? 0), 0) : null;
    // Σ per-close pct of trade_usd — same unit as the exit-classification
    // total_pnl_pct (each close is its own trade_usd denominator)
    const sumPct = (sel: (r: EconomicLegRow) => number | null) =>
      ok.length
        ? ok.reduce((s, r) => {
            const v = sel(r);
            return s + (v !== null && r.requested_usd ? (v / r.requested_usd) * 100 : 0);
          }, 0)
        : null;
    const tradeSum = ok.length ? ok.reduce((s, r) => s + (r.requested_usd ?? 0), 0) : null;
    const spread = sum((r) => r.spread_pnl_usd);
    const funding = sum((r) => r.net_funding_usd);
    const fees = sum((r) => r.fee_usd);
    // aggregate estimate built FROM the rounded aggregate components — the
    // identity Σspread + Σfunding − Σfees = Σeconomic holds on displayed numbers
    const econ =
      spread !== null && funding !== null && fees !== null ? spread + funding - fees : null;
    const spreadPct = sumPct((r) => r.spread_pnl_usd);
    const spreadSignedPct = sumPct((r) => r.spread_signed_usd);
    const fundingPct = sumPct((r) => r.net_funding_usd);
    const feePct = sumPct((r) => r.fee_usd);
    const econPct =
      spreadPct !== null && fundingPct !== null && feePct !== null
        ? spreadPct + fundingPct - feePct
        : null;
    const econSignedPct =
      spreadSignedPct !== null && fundingPct !== null && feePct !== null
        ? spreadSignedPct + fundingPct - feePct
        : null;
    const r6u = ok.length ? ok.reduce((s, r) => s + (r.r6_upper_pct ?? 0), 0) : null;
    const r6l = ok.length ? ok.reduce((s, r) => s + (r.r6_lower_pct ?? 0), 0) : null;
    const r2 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);
    return {
      rows: rows.length,
      summed_trade_usd: tradeSum === null ? null : Math.round(tradeSum),
      spread_pnl_usd: spread === null ? null : Math.round(spread * 100) / 100,
      net_funding_usd: funding === null ? null : Math.round(funding * 100) / 100,
      fee_usd: fees === null ? null : Math.round(fees * 100) / 100,
      economic_usd: econ === null ? null : Math.round(econ * 100) / 100,
      spread_total_pct: r2(spreadPct),
      spread_signed_total_pct: r2(spreadSignedPct),
      economic_signed_total_pct: r2(econSignedPct),
      net_funding_total_pct: r2(fundingPct),
      fee_total_pct: r2(feePct),
      economic_total_pct: r2(econPct),
      economic_of_capital_pct:
        econ !== null && tradeSum !== null && tradeSum > 0
          ? Math.round((econ / tradeSum) * 100 * 1000) / 1000
          : null,
      r6_upper_pct: r6u === null ? null : Math.round(r6u * 1000) / 1000,
      r6_lower_pct: r6l === null ? null : Math.round(r6l * 1000) / 1000,
    };
  };

  const attributableRows = perClose.filter((r) => !r.is_data_gap);
  const gapRows = perClose.filter((r) => r.is_data_gap);
  const attributable = agg(attributableRows);
  const dataGap = agg(gapRows);

  const identity =
    attributable.spread_total_pct !== null &&
    attributable.net_funding_total_pct !== null &&
    attributable.fee_total_pct !== null &&
    attributable.economic_total_pct !== null
      ? {
          spread_pct: attributable.spread_total_pct,
          funding_pct: attributable.net_funding_total_pct,
          fees_pct: attributable.fee_total_pct,
          economic_pct: attributable.economic_total_pct,
          spread_usd: attributable.spread_pnl_usd ?? 0,
          funding_usd: attributable.net_funding_usd ?? 0,
          fees_usd: attributable.fee_usd ?? 0,
          economic_usd: attributable.economic_usd ?? 0,
          consistent:
            Math.abs(
              attributable.spread_total_pct +
                attributable.net_funding_total_pct -
                attributable.fee_total_pct -
                attributable.economic_total_pct
            ) <= 0.005,
        }
      : null;

  const complete = perClose.filter((r) => r.components_complete).length;

  return {
    generated_at: new Date().toISOString(),
    closes: perClose.length,
    attributable,
    data_gap: dataGap,
    identity_check: identity,
    completeness: { complete, incomplete: perClose.length - complete },
    // NEWEST 30 closes (bounded payload): perClose is sorted newest-first
    // (the sort above), so slice(0,30) = the newest 30 — the detail view
    // stays current as the experiment grows. The aggregates above cover ALL
    // closes; the UI labels the slice against closes and renders the payload
    // order as-is (already newest-row-first, same reading as the ledger).
    per_close: perClose.slice(0, 30),
    note:
      "R7 mathematical invariant test — DIAGNOSTIC decomposition only, NOT a Phase-2 PnL instrument (the Day-5/7 verdict stays on strategy-attributable paper SPREAD PnL; realized funding cashflow is not observed in paper mode — NEW-08/NEW-15). Per close: economic estimate = spread PnL + funding leg long + funding leg short − fees, with every component computed from the ACTUAL per-leg notionals (NEW-17: ref_px = max makes one leg ≤ trade_usd; NEW-18: trade_usd stays the requested value) and entry-snapshot funding rates (E — no rate history exists). Funding accrual shown linearly (held_h / interval_h × rate) and as settlement-count (0 until a settlement lands inside the hold). Prices are futures ticker/last throughout (NEW-16: the code's 'mark price' is the ticker price). Aggregates use the primary instrument's unit (Σ per-close pct of trade_usd — directly comparable with the R6 estimate range); the identity Σspread + Σfunding − Σfees = Σeconomic is built to hold on the displayed numbers. R8 (NEW-20): the signed aggregates carry the corrected mark-to-market spread (funding and fees are sign-correct per leg); both readings are shown. Read-only; the measured system stays untouched at 0373f5d.",
  };
}
