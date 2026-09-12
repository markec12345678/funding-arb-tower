"use client";

/**
 * Route-level error boundary (App Router).
 *
 * The tower is a READ-ONLY monitor: a render failure here means one VIEW of
 * the measured systems failed — the funding-arb runner, the engine, the
 * paper journal are all unaffected. The default Next.js failure mode is a
 * white "Application error" page, which for a 24/7 command center reads as
 * "everything is down" exactly when the operator most needs to know what is
 * actually down. This boundary degrades honestly instead:
 *   - it says what broke (this view, not the systems),
 *   - it offers the one actionable recovery (retry — re-mounts the view),
 *   - it shows the digest (the log correlation key),
 *   - it never pretends the failure didn't happen.
 */

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side visibility (terminal / log aggregators), client-side too.
    console.error("[tower] render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-10">
      <div className="w-full max-w-lg rounded-xl border border-amber-500/30 bg-zinc-900/60 p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400" aria-hidden />
          <h1 className="text-base font-semibold text-zinc-100">
            command center — view render error
          </h1>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-zinc-400">
          This view hit an unexpected error while rendering. The measured
          systems are <span className="text-zinc-200">unaffected</span> — the
          tower is a read-only monitor; the funding-arb runner, the paper
          journal and the quant engine keep running independently of this
          page. Retry re-mounts the view.
        </p>

        {error.digest && (
          <p className="mt-3 font-mono text-[10px] text-zinc-500">
            digest {error.digest}
          </p>
        )}

        <button
          onClick={reset}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-emerald-500/50 hover:bg-zinc-700 hover:text-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          retry view
        </button>

        <p className="mt-4 text-[10px] leading-relaxed text-zinc-600">
          If the error persists, the underlying data payload likely changed
          shape — check the dev/server log and the API response for
          <span className="font-mono"> /api/status</span>.
        </p>
      </div>
    </div>
  );
}
