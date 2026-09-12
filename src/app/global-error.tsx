"use client";

/**
 * Root error boundary — last resort (root layout itself failed).
 *
 * Next.js requires global-error.tsx to render its own <html> and <body>.
 * Same honesty as the route-level boundary: name the blast radius (the whole
 * command center surface — never the measured systems), offer reload, show
 * the digest.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[tower] root render error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
          color: "#e4e4e7",
          fontFamily: "system-ui, sans-serif",
          padding: "1rem",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            maxWidth: "480px",
            border: "1px solid rgba(245,158,11,0.3)",
            borderRadius: "12px",
            background: "rgba(24,24,27,0.6)",
            padding: "24px",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
            command center — root layout error
          </h1>
          <p
            style={{
              marginTop: "12px",
              fontSize: "12px",
              lineHeight: 1.6,
              color: "#a1a1aa",
            }}
          >
            The command center surface itself failed to render. The measured
            systems are unaffected — the tower is read-only; the runner, the
            journal and the engine run independently of this page.
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: "12px",
                fontSize: "10px",
                fontFamily: "monospace",
                color: "#71717a",
              }}
            >
              digest {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: "20px",
              minHeight: "44px",
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid #52525b",
              background: "#27272a",
              color: "#e4e4e7",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            retry
          </button>
        </div>
      </body>
    </html>
  );
}
