import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionContinuity } from "./RunEvidence";

describe("saved research lifecycle", () => {
  it("shows an automatic boundary as continuing work after legacy cumulative limits", () => {
    const html = renderToStaticMarkup(
      <SessionContinuity
        session={{
          status: "waiting",
          wait_for: { type: "work_round" },
          lifecycle: {
            state: "checkpointed",
            round_index: 401,
            checkpoints: [
              { checkpoint_id: "saved-round-401", reason: "round_boundary" },
            ],
          },
        }}
      />,
    );
    expect(html).toContain("Work round 401");
    expect(html).toContain("next work round continues automatically");
    expect(html).toContain("saved-round-401");
    expect(html).not.toContain("exhausted");
  });

  it("retains explicit blocker diagnostics without describing process waiting as a round", () => {
    const html = renderToStaticMarkup(
      <SessionContinuity
        session={{
          wait_for: { type: "process", process_id: "training" },
          lifecycle: {
            state: "blocked",
            round_index: 3,
            recovery: {
              reason: "Validation data authorization requires owner action",
            },
          },
        }}
      />,
    );
    expect(html).toContain("Research lifecycle: blocked");
    expect(html).toContain(
      "Validation data authorization requires owner action",
    );
    expect(html).not.toContain("continues automatically");
  });

  it("accepts legacy checkpoints without lifecycle metadata", () => {
    const html = renderToStaticMarkup(
      <SessionContinuity session={{ status: "running" }} />,
    );
    expect(html).not.toContain("Research lifecycle:");
    expect(html).not.toContain("Work round");
  });

  it("reports an unreadable ledger without claiming zero consumption", () => {
    const html = renderToStaticMarkup(
      <SessionContinuity
        session={{
          usage: null,
          usage_error: {
            code: "LEDGER_UNREADABLE",
            message: "Reconnect the original supervisor",
          },
        }}
      />,
    );
    expect(html).toContain("Resource usage unavailable");
    expect(html).toContain("Reconnect the original supervisor");
    expect(html).not.toContain("0 seconds");
  });

  it("shows the preserved reason when restored execution needs reconciliation", () => {
    const html = renderToStaticMarkup(
      <SessionContinuity
        session={{
          status: "waiting_input",
          lifecycle: { state: "blocked", recovery: {} },
          reconciliation_reason: "Completed checkpoint artifacts changed",
        }}
      />,
    );
    expect(html).toContain("Research lifecycle: blocked");
    expect(html).toContain("Completed checkpoint artifacts changed");
    expect(html).not.toContain("continues automatically");
  });

  it("does not promise continuation from a stale round wait on blocked or cancelled work", () => {
    for (const status of ["waiting_input", "cancelled", "paused"]) {
      const html = renderToStaticMarkup(
        <SessionContinuity
          session={{
            status,
            wait_for: { type: "work_round" },
            lifecycle: { state: "blocked", round_index: 7 },
            reconciliation_reason:
              "Original supervisory ledger requires reconciliation",
          }}
        />,
      );
      expect(html).toContain("Work round 7");
      expect(html).toContain(
        "Original supervisory ledger requires reconciliation",
      );
      expect(html).not.toContain("continues automatically");
    }
    const blockedWaiting = renderToStaticMarkup(
      <SessionContinuity
        session={{
          status: "waiting",
          wait_for: { type: "work_round" },
          lifecycle: { state: "blocked" },
        }}
      />,
    );
    expect(blockedWaiting).not.toContain("continues automatically");
  });
});

describe("recorded session token usage", () => {
  const renderUsage = (session: Record<string, unknown>) =>
    renderToStaticMarkup(<SessionContinuity session={session} />);

  it("shows all four counters from the summary usage ledger", () => {
    const html = renderUsage({
      usage: {
        totals: {
          input_tokens: 1234,
          output_tokens: 56,
          cached_input_tokens: 789,
          reasoning_tokens: 12,
        },
      },
    });
    expect(html).toContain("Input tokens: 1234");
    expect(html).toContain("Output tokens: 56");
    expect(html).toContain("Cached input tokens: 789");
    expect(html).toContain("Reasoning tokens: 12");
  });

  it("preserves measured zero without coercing missing counters to zero", () => {
    const html = renderUsage({
      usage: {
        totals: {
          input_tokens: 0,
          output_tokens: 0,
          cached_input_tokens: null,
        },
      },
    });
    expect(html).toContain("Input tokens: 0");
    expect(html).toContain("Output tokens: 0");
    expect(html).toContain("Cached input tokens: unavailable");
    expect(html).toContain("Reasoning tokens: unavailable");
  });

  it("does not trust scientific checkpoint totals when the ledger is absent", () => {
    const html = renderUsage({ totals: { input_tokens: 999 }, usage: null });
    expect(html).toContain("Input tokens: unavailable");
    expect(html).not.toContain("999");
  });

  it("retains ledger errors instead of showing potentially stale counts", () => {
    const html = renderUsage({
      usage: { totals: { input_tokens: 1234 } },
      usage_error: { message: "Reconcile original supervisor" },
    });
    expect(html).toContain("Reconcile original supervisor");
    expect(html).toContain("Input tokens: unavailable");
    expect(html).not.toContain("1234");
  });

  it("marks partial accounting without claiming complete consumption", () => {
    const html = renderUsage({
      usage: {
        totals: { input_tokens: 42 },
        usage_complete: false,
      },
    });
    expect(html).toContain("Input tokens: 42");
    expect(html).toContain(
      "Token usage incomplete; recorded counts may be partial.",
    );
  });

  it("does not coerce malformed or unsafe counters into measurements", () => {
    for (const value of [
      "7",
      -1,
      1.5,
      Infinity,
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        renderUsage({ usage: { totals: { input_tokens: value } } }),
      ).toContain("Input tokens: unavailable");
    }
  });
});
