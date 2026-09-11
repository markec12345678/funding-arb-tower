// ---------------------------------------------------------------------------
// Passive exit classification — the E-04 contamination detector.
//
// Read-only evidence layer for the Phase-2 A/B/C baseline: classifies every
// closed position from the runner journal + positions ledger WITHOUT touching
// the runner (the measured system stays exactly as-is at the locked commit).
//
// Why this exists (R4 finding E-04): the runner closes a position when
// `row is None or edge <= exit_edge` — a missing scanner row (venue data gap)
// is indistinguishable from a genuine edge collapse and shows up in the
// journal as edge = -999. In the running baseline 5/11 closes carry this
// signature, so the raw exit statistics are measurably contaminated. The
// A/B/C verdict must therefore be read on TWO views:
//   raw baseline        — everything the system actually did;
//   diagnostic baseline — what remains when data-gap exits are held apart.
//
// Reporting contract (recorded 2026-09-11, review decision): the FINAL A/B/C
// report shows the strategy-attributable result (diagnostic baseline) as the
// PRIMARY number, with the raw result and the E-04 contamination split always
// alongside — never a single blended PnL. The arithmetic identity
//   attributable + contamination = raw
// is carried as a built-in integrity check so the split can never silently
// drift from the raw number it decomposes.
//
// PnL estimate mirrors the watcher's estimate_spread_pnl() exactly (same
// instrument as the measured system): sign × (open_spread − close_spread) ×
// qty, as % of trade_usd. Close prices come from the close action's executed
// trades (per-leg ref_price fetched by the executor at close time —
// independent of the scanner that produced the data gap).
// ---------------------------------------------------------------------------

export type ExitCategory =
  | "edge_collapse"
  | "stop_loss"
  | "funding_condition"
  | "safety"
  | "data_gap"
  | "other";

export interface ClassifiedExit {
  position_id: string;
  base: string;
  category: ExitCategory;
  edge_pct: number | null; // -999 = the data-gap sentinel
  held_h: number | null;
  pnl_pct: number | null; // watcher-formula spread PnL estimate (instrument mirror)
  // R8 (NEW-20): signed mark-to-market PnL — (S_open − S_close) × qty as % of
  // trade_usd, S = short_venue_price − long_venue_price, SIGNED. The fixed legs
  // (long on long_venue, short on short_venue) make this the mechanical PnL of
  // the position; the instrument's abs()+direction-sign convention equals it
  // only when sign_dir × S > 0 throughout the hold.
  pnl_signed_pct: number | null;
  mis_signed: boolean | null; // instrument reading ≠ signed reading (tolerance ½ of last digit)
  spread_crossed: boolean | null; // S changed sign between open and close
  opened_at: string | null;
  closed_at: string | null;
}

export interface ExitCategoryStat {
  category: ExitCategory;
  count: number;
  share: number; // fraction of raw closes
  avg_held_h: number | null;
  avg_pnl_pct: number | null;
  total_pnl_pct: number | null;
}

export interface ExitBaseline {
  closes: number;
  avg_pnl_pct: number | null;
  total_pnl_pct: number | null;
}

export interface ExitClassification {
  generated_at: string;
  journal_span: { from: string | null; to: string | null; cycles: number };
  categories: ExitCategoryStat[];
  raw_baseline: ExitBaseline;
  diagnostic_baseline: ExitBaseline; // data_gap held apart = strategy-attributable
  e04_contamination: ExitBaseline; // the data_gap group on its own
  attribution_check: {
    attributable_total_pct: number | null;
    contamination_total_pct: number | null;
    raw_total_pct: number | null;
    // |attributable + contamination − raw| within rounding tolerance
    consistent: boolean | null;
  };
  survival: {
    opened: number | null; // positions ledger rows (each = one opened position)
    closed_normal: number; // classified closes, non-data-gap
    closed_data_gap: number; // classified closes, data-gap
    still_open: number | null; // ledger rows with status "open"
  };
  // R8 sign-convention audit (NEW-20): the instrument (watcher formula,
  // abs spread + direction sign) vs the signed mark-to-market arithmetic.
  // Registered after the red-team round found 5/12 closes mis-signed.
  signed_check: {
    closes: number;
    mis_signed: number;
    crossed: number;
    instrument: { attributable_pct: number | null; contamination_pct: number | null; raw_pct: number | null };
    signed: { attributable_pct: number | null; contamination_pct: number | null; raw_pct: number | null };
    identity_signed: boolean | null; // attributable + contamination = raw on signed numbers
  };
  per_exit: ClassifiedExit[]; // newest first
  note: string;
}

export const EXIT_CATEGORY_LABELS: Record<ExitCategory, string> = {
  edge_collapse: "genuine edge collapse",
  stop_loss: "PnL stop-loss (watcher)",
  funding_condition: "funding condition (watcher)",
  safety: "manual / system safety",
  data_gap: "E-04 data-gap (edge=-999)",
  other: "other (edge above threshold)",
};

const TAXONOMY: ExitCategory[] = [
  "edge_collapse",
  "stop_loss",
  "funding_condition",
  "safety",
  "data_gap",
  "other",
];

const DATA_GAP_SENTINEL = -999.0;

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

// Watcher formula, verbatim semantics:
//   sign = direction === "forward" ? 1 : -1
//   spread_pnl = sign * (open_spread - close_spread) * qty
//   pct = spread_pnl / trade_usd * 100
function spreadPnlPct(pos: any, closeLongPx: number, closeShortPx: number): number | null {
  const longPrice = num(pos?.long_price);
  const shortPrice = num(pos?.short_price);
  const qty = num(pos?.qty);
  const tradeUsd = num(pos?.trade_usd);
  if (longPrice === null || shortPrice === null || !qty || !tradeUsd) return null;
  const sign = String(pos?.direction ?? "forward").toLowerCase() === "forward" ? 1 : -1;
  const openSpread = Math.abs(longPrice - shortPrice);
  const closeSpread = Math.abs(closeLongPx - closeShortPx);
  return (sign * (openSpread - closeSpread) * qty * 100) / tradeUsd;
}

// R8 signed mark-to-market (NEW-20): the mechanical PnL of the fixed legs —
// long leg (close_long − open_long) + short leg (open_short − close_short)
// = (S_open − S_close) × qty, S = short_venue_price − long_venue_price, signed.
// No abs(), no direction sign: the executor never flips legs by direction.
function signedPnlPct(pos: any, closeLongPx: number, closeShortPx: number): number | null {
  const longPrice = num(pos?.long_price);
  const shortPrice = num(pos?.short_price);
  const qty = num(pos?.qty);
  const tradeUsd = num(pos?.trade_usd);
  if (longPrice === null || shortPrice === null || !qty || !tradeUsd) return null;
  const sOpen = shortPrice - longPrice;
  const sClose = closeShortPx - closeLongPx;
  return ((sOpen - sClose) * qty * 100) / tradeUsd;
}

export function classifyExits(journalRaw: string | null, positionsRaw: string | null): ExitClassification | null {
  if (!journalRaw) return null;

  // positions ledger → open-side record per position_id (prices, qty, times).
  // Each ledger row is one successfully opened position — the survival denominator.
  const positions = new Map<string, any>();
  let stillOpen = 0;
  if (positionsRaw) {
    try {
      const rows = JSON.parse(positionsRaw);
      if (Array.isArray(rows)) {
        for (const p of rows) {
          if (p && typeof p.id === "string") {
            positions.set(p.id, p);
            if (String(p?.status ?? "").toLowerCase() === "open") stillOpen++;
          }
        }
      }
    } catch {
      /* unreadable ledger — classify without PnL attribution */
    }
  }

  // One classification per successfully closed position (the runner can retry
  // a failed close on later cycles — keep the last successful action).
  const byId = new Map<string, { cycleTs: string; action: any; thresholds: any }>();
  let cycles = 0;
  let from: string | null = null;
  let to: string | null = null;

  for (const line of journalRaw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let d: any;
    try {
      d = JSON.parse(t);
    } catch {
      continue;
    }
    // Same real-cycle filter as the funnel (unit-test noise has tiny scans).
    if ((num(d?.scan_total) ?? 0) < 50) continue;
    cycles++;
    const ts = String(d?.ts ?? "");
    if (ts) {
      if (from === null) from = ts;
      to = ts;
    }
    const actions: any[] = Array.isArray(d?.actions) ? d.actions : [];
    for (const a of actions) {
      if (a?.action !== "close") continue;
      const state = String(a?.result?.state ?? "");
      if (state !== "simulated" && state !== "filled") continue; // failed close → retried later
      const id = String(a?.position_id ?? "");
      if (id) byId.set(id, { cycleTs: ts, action: a, thresholds: d?.thresholds });
    }
  }

  const perExit: ClassifiedExit[] = [];
  for (const [id, { action, thresholds }] of byId) {
    const edge = num(action?.edge);
    const exitThr = num(thresholds?.exitThresholdPct) ?? 0.01;
    let category: ExitCategory;
    if (edge === null || edge === DATA_GAP_SENTINEL) category = "data_gap";
    else if (edge <= exitThr) category = "edge_collapse";
    else category = "other";

    // Close prices from the executed legs (executor's own market fetch —
    // independent of the scanner gap that produced edge=-999).
    const executed: any[] = Array.isArray(action?.result?.executed) ? action.result.executed : [];
    let closeLongPx: number | null = null;
    let closeShortPx: number | null = null;
    for (const e of executed) {
      const ref = num(e?.ref_price);
      if (ref === null) continue;
      if (e?.type === "close_long") closeLongPx = ref;
      if (e?.type === "close_short") closeShortPx = ref;
    }

    const pos = positions.get(id) ?? null;
    const pnlPct =
      pos && closeLongPx !== null && closeShortPx !== null
        ? spreadPnlPct(pos, closeLongPx, closeShortPx)
        : null;
    const pnlSignedPct =
      pos && closeLongPx !== null && closeShortPx !== null
        ? signedPnlPct(pos, closeLongPx, closeShortPx)
        : null;
    let crossed: boolean | null = null;
    if (pos) {
      const lp = num(pos?.long_price);
      const sp = num(pos?.short_price);
      if (lp !== null && sp !== null && closeLongPx !== null && closeShortPx !== null) {
        crossed = sp - lp > 0 !== closeShortPx - closeLongPx > 0;
      }
    }
    const misSigned =
      pnlPct !== null && pnlSignedPct !== null
        ? Math.abs(pnlPct - pnlSignedPct) > 0.005
        : null;
    const heldH =
      pos && num(pos?.opened_at) && num(pos?.closed_at)
        ? Math.max(0, (num(pos.closed_at)! - num(pos.opened_at)!) / 3_600_000)
        : null;

    perExit.push({
      position_id: id,
      base: String(pos?.base ?? action?.candidate?.base ?? ""),
      category,
      edge_pct: edge,
      held_h: heldH === null ? null : Math.round(heldH * 10) / 10,
      pnl_pct: pnlPct === null ? null : Math.round(pnlPct * 1000) / 1000,
      pnl_signed_pct: pnlSignedPct === null ? null : Math.round(pnlSignedPct * 1000) / 1000,
      mis_signed: misSigned,
      spread_crossed: crossed,
      opened_at: pos?.opened_at ? new Date(num(pos.opened_at)!).toISOString() : null,
      closed_at: pos?.closed_at ? new Date(num(pos.closed_at)!).toISOString() : null,
    });
  }

  perExit.sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""));

  const stat = (cat: ExitCategory): ExitCategoryStat => {
    const rows = perExit.filter((e) => e.category === cat);
    const pnls = rows.map((e) => e.pnl_pct).filter((p): p is number => p !== null);
    const helds = rows.map((e) => e.held_h).filter((h): h is number => h !== null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const r2 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);
    return {
      category: cat,
      count: rows.length,
      share: perExit.length ? rows.length / perExit.length : 0,
      avg_held_h: r2(avg(helds)),
      avg_pnl_pct: r2(avg(pnls)),
      total_pnl_pct: r2(pnls.length ? pnls.reduce((s, x) => s + x, 0) : null),
    };
  };

  const rawPnls = perExit.map((e) => e.pnl_pct).filter((p): p is number => p !== null);
  const diagPnls = perExit
    .filter((e) => e.category !== "data_gap")
    .map((e) => e.pnl_pct)
    .filter((p): p is number => p !== null);
  const gapPnls = perExit
    .filter((e) => e.category === "data_gap")
    .map((e) => e.pnl_pct)
    .filter((p): p is number => p !== null);
  const baseline = (pnls: number[], closes: number): ExitBaseline => ({
    closes,
    avg_pnl_pct: pnls.length ? Math.round((pnls.reduce((s, x) => s + x, 0) / pnls.length) * 1000) / 1000 : null,
    total_pnl_pct: pnls.length ? Math.round(pnls.reduce((s, x) => s + x, 0) * 1000) / 1000 : null,
  });

  const rawB = baseline(rawPnls, perExit.length);
  const diagB = baseline(diagPnls, perExit.filter((e) => e.category !== "data_gap").length);
  const gapB = baseline(gapPnls, perExit.filter((e) => e.category === "data_gap").length);

  // Integrity check on the displayed (rounded) totals: the split must decompose
  // the raw number exactly, within the 3-decimal rounding tolerance.
  const identitySum =
    diagB.total_pnl_pct !== null && gapB.total_pnl_pct !== null ? diagB.total_pnl_pct + gapB.total_pnl_pct : null;
  const consistent =
    identitySum !== null && rawB.total_pnl_pct !== null
      ? Math.abs(identitySum - rawB.total_pnl_pct) <= 0.002
      : null;

  const closedNormal = perExit.filter((e) => e.category !== "data_gap").length;
  const closedGap = perExit.filter((e) => e.category === "data_gap").length;

  // R8 signed aggregates (NEW-20): same per-close denominators (pct of
  // trade_usd, 3-dp rounded) as the instrument, computed from the signed
  // mark-to-market instead of the abs+direction-sign convention.
  const r2 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);
  const sumSigned = (sel: (e: ClassifiedExit) => boolean) => {
    const xs = perExit
      .filter(sel)
      .map((e) => e.pnl_signed_pct)
      .filter((p): p is number => p !== null);
    return xs.length ? r2(xs.reduce((s, x) => s + x, 0)) : null;
  };
  const signedAttr = sumSigned((e) => e.category !== "data_gap");
  const signedGap = sumSigned((e) => e.category === "data_gap");
  const signedRaw = sumSigned(() => true);
  const identitySigned =
    signedAttr !== null && signedGap !== null && signedRaw !== null
      ? Math.abs(signedAttr + signedGap - signedRaw) <= 0.002
      : null;
  const misSignedCount = perExit.filter((e) => e.mis_signed === true).length;
  const crossedCount = perExit.filter((e) => e.spread_crossed === true).length;

  return {
    generated_at: new Date().toISOString(),
    journal_span: { from, to, cycles },
    categories: TAXONOMY.map(stat),
    raw_baseline: rawB,
    diagnostic_baseline: diagB,
    e04_contamination: gapB,
    attribution_check: {
      attributable_total_pct: diagB.total_pnl_pct,
      contamination_total_pct: gapB.total_pnl_pct,
      raw_total_pct: rawB.total_pnl_pct,
      consistent,
    },
    survival: {
      opened: positionsRaw === null ? null : positions.size,
      closed_normal: closedNormal,
      closed_data_gap: closedGap,
      still_open: positionsRaw === null ? null : stillOpen,
    },
    signed_check: {
      closes: perExit.length,
      mis_signed: misSignedCount,
      crossed: crossedCount,
      instrument: {
        attributable_pct: diagB.total_pnl_pct,
        contamination_pct: gapB.total_pnl_pct,
        raw_pct: rawB.total_pnl_pct,
      },
      signed: {
        attributable_pct: signedAttr,
        contamination_pct: signedGap,
        raw_pct: signedRaw,
      },
      identity_signed: identitySigned,
    },
    per_exit: perExit.slice(0, 30),
    note:
      "Passive read-only classification — the runner and the measured system are untouched (0373f5d locked). PnL mirrors the watcher's estimate_spread_pnl (PRICE-spread convergence ± fees — realized funding cashflow is NOT observed in paper mode); close prices come from the executor's own leg fetch, independent of the scanner gap. Reporting contract: the strategy-attributable result is PRIMARY; raw and E-04 contamination are always shown alongside — never a single blended PnL. Naming rule (NEW-15): report as strategy-attributable paper SPREAD PnL, never as funding-arbitrage profitability. R8 (NEW-20): the instrument's abs()+direction-sign convention is NOT the position's mark-to-market — the signed column is the corrected arithmetic; both readings are shown, and the final A/B/C report carries the signed one as the corrected spread-PnL view.",
  };
}
