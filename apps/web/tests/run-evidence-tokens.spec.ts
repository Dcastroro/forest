import { expect, test } from "@playwright/test";

// Synthetic session responses test presentation, not actual model consumption.
for (const width of [1440, 390]) {
  test(`run evidence distinguishes recorded, zero and unavailable tokens at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const created = await request.post("/api/projects", {
      data: {
        name: "Synthetic token presentation",
        mode: "manual",
        budget: { allow_paid: false },
      },
    });
    expect(created.ok()).toBeTruthy();
    const project = await created.json();
    try {
      const graph = await (
        await request.get(`/api/projects/${project.id}/graph`)
      ).json();
      const nodeId = crypto.randomUUID();
      const added = await request.post(
        `/api/projects/${project.id}/graph/commands`,
        {
          data: {
            request_id: crypto.randomUUID(),
            expected_revision: graph.revision,
            operation: "add_node",
            targets: [],
            run: false,
            params: {
              id: nodeId,
              branch_id: graph.branches[0].id,
              type: "agent",
              title: "Synthetic session",
              position: { x: 200, y: 160 },
            },
          },
        },
      );
      expect(added.ok()).toBeTruthy();
      const run = {
        id: "synthetic-token-run",
        project_id: project.id,
        node_id: nodeId,
        kind: "agent",
        status: "completed",
        node_revision: 0,
        config: {},
        metrics: {},
        dependencies: [],
        created_at: "2026-10-01T00:00:00Z",
      };
      let usage: Record<string, unknown> | null = {
        totals: {
          input_tokens: 1234,
          output_tokens: 0,
          cached_input_tokens: null,
          reasoning_tokens: 12,
        },
        usage_complete: false,
      };
      await page.route(`**/api/projects/${project.id}/runs*`, (route) =>
        route.fulfill({ json: [run] }),
      );
      await page.route("**/api/runs/synthetic-token-run/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = path.endsWith("/lineage")
          ? {
              run_id: run.id,
              project_id: project.id,
              runs: [{ ...run, current: true, files: [] }],
            }
          : path.endsWith("/session")
            ? {
                run_id: run.id,
                status: "completed",
                session: { status: "completed", usage },
              }
            : path.endsWith("/acceptance")
              ? { purpose: "exploratory" }
              : {};
        return route.fulfill({ json });
      });
      const openEvidence = async () => {
        await page.goto(`/projects/${project.id}/workspace?node=${nodeId}`);
        const inspector = page.getByRole("complementary", {
          name: "Node inspector",
        });
        await expect(page.getByTestId(`rf__node-${nodeId}`)).toBeVisible();
        if (!(await inspector.isVisible()))
          await page.getByRole("button", { name: "Toggle inspector" }).click();
        await expect(inspector).toBeVisible();
        await inspector
          .getByRole("tab", { name: "Results", exact: true })
          .click();
        await inspector
          .getByText("Evidence and recovery", { exact: true })
          .click();
        return inspector.getByRole("group", { name: "Recorded token usage" });
      };
      const tokens = await openEvidence();
      await expect(tokens).toContainText("Input tokens: 1234");
      await expect(tokens).toContainText("Output tokens: 0");
      await expect(tokens).toContainText("Cached input tokens: unavailable");
      await expect(tokens).toContainText("Reasoning tokens: 12");
      await expect(tokens).toContainText(
        "Token usage incomplete; recorded counts may be partial.",
      );
      await expect(tokens).toBeVisible();
      await tokens.scrollIntoViewIfNeeded();
      await expect(tokens).toBeInViewport();
      const bounds = await tokens.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: test.info().outputPath("recorded-tokens.png"),
        fullPage: true,
      });
      usage = null;
      const unavailable = await openEvidence();
      await expect(unavailable).toContainText("Input tokens: unavailable");
      await expect(unavailable).not.toContainText("1234");
      await expect(unavailable).not.toContainText("Output tokens: 0");
      expect(errors).toEqual([]);
    } finally {
      await page.goto("about:blank");
      expect(
        (await request.delete(`/api/projects/${project.id}`)).ok(),
      ).toBeTruthy();
    }
  });
}
