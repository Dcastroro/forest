import { expect, test } from "@playwright/test";

for (const width of [1440, 800, 390]) {
  test(`branch changes cannot leave a hidden node editable at ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    page.setDefaultTimeout(5000);
    await page.setViewportSize({ width, height: 1000 });
    const created = await request.post("/api/projects", {
      data: {
        name: `Branch selection ${crypto.randomUUID()}`,
        mode: "manual",
        budget: { allow_paid: false },
      },
    });
    expect(created.ok()).toBeTruthy();
    const project = await created.json();
    const graphPath = `/api/projects/${project.id}/graph`;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const command = async (
        operation: string,
        targets: string[],
        params: Record<string, unknown>,
      ) => {
        const graph = await (await request.get(graphPath)).json();
        const result = await request.post(`${graphPath}/commands`, {
          data: {
            request_id: crypto.randomUUID(),
            expected_revision: graph.revision,
            operation,
            targets,
            params,
            run: false,
          },
        });
        expect(result.ok()).toBeTruthy();
        return (await result.json()).graph;
      };
      const added = await command("add_node", [], {
        title: "Original branch node",
        type: "experiment",
      });
      const original = added.nodes[0];
      const forked = await command("fork_branch", [original.id], {
        name: "Alternative branch",
        copy_policy: { code: true, data: "reference", results: false },
      });
      const alternate = forked.branches.find(
        (branch: { id: string }) => branch.id !== original.branch_id,
      );
      await expect
        .poll(
          async () =>
            (await (await request.get(graphPath)).json()).branches.find(
              (branch: { id: string }) => branch.id === alternate.id,
            ).status,
        )
        .toBe("active");
      const before = await (await request.get(graphPath)).json();
      const mutations: string[] = [];
      page.on("request", (req) => {
        if (req.method() !== "GET" && req.url().includes("/graph"))
          mutations.push(req.url());
      });
      await page.goto(`/projects/${project.id}/workspace?node=${original.id}`);
      const title = page.getByLabel("Node title", { exact: true });
      await expect(title).toHaveValue(original.title);
      await title.fill("Unsaved original draft");
      const branch = page.getByLabel("Current branch");
      await branch.selectOption(original.branch_id);
      await expect(title).toHaveValue("Unsaved original draft");
      await branch.selectOption("all");
      await expect(title).toHaveValue("Unsaved original draft");

      await branch.selectOption(alternate.id);
      await expect(title).toHaveCount(0, { timeout: 2000 });
      await expect(
        page.getByRole("button", { name: "Save changes", exact: true }),
      ).toHaveCount(0);
      await expect
        .poll(() => new URL(page.url()).searchParams.get("node"))
        .toBeNull();
      await expect(
        page.locator(`.react-flow__node[data-id="${original.id}"]`),
      ).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath("branch-inspector-cleared.png"),
      });
      await page.goBack();
      await expect(title).toHaveValue("Unsaved original draft");
      await page.goForward();
      await expect(title).toHaveCount(0);

      // Explicit search can reveal another branch; its saved local draft survives.
      await page.getByLabel("Search nodes").fill(original.title);
      await page
        .locator(".node-search-results")
        .getByRole("button", {
          name: original.title,
          exact: true,
        })
        .first()
        .click();
      await expect(title).toHaveValue("Unsaved original draft");
      await expect(branch).toHaveValue("all");

      // Direct links and reloads must enforce the same branch/inspector boundary.
      await page.goto(
        `/projects/${project.id}/workspace?branch=${alternate.id}&node=${original.id}&view=focus`,
      );
      await expect(title).toHaveCount(0);
      await expect
        .poll(() => new URL(page.url()).searchParams.get("node"))
        .toBeNull();
      await page.reload();
      await expect(branch).toHaveValue(alternate.id);
      await expect(title).toHaveCount(0);
      await page.goBack();
      await expect(title).toHaveValue("Unsaved original draft");
      const after = await (await request.get(graphPath)).json();
      expect(after).toEqual(before);
      expect(mutations).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      try {
        await page.goto("about:blank");
      } finally {
        expect(
          (await request.delete(`/api/projects/${project.id}`)).ok(),
        ).toBeTruthy();
      }
    }
  });
}
