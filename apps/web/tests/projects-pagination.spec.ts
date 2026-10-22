import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`older projects remain reachable at ${width}px`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const created: Array<{ id: string; name: string }> = [];
    const prefix = `Pagination ${crypto.randomUUID()}`;
    try {
      // Real temporary projects, not model runs or fabricated list responses.
      for (let index = 0; index < 101; index++) {
        const response = await request.post("/api/projects", {
          data: {
            name: `${prefix} ${String(index).padStart(3, "0")}`,
            mode: "manual",
            budget: { allow_paid: false },
          },
        });
        expect(response.ok()).toBeTruthy();
        created.push(await response.json());
      }
      const oldest = created[0];
      const first = await (await request.get("/api/projects")).json();
      expect(first).toHaveLength(100);
      expect(
        first.some((project: { id: string }) => project.id === oldest.id),
      ).toBe(false);
      const later = await (
        await request.get("/api/projects?offset=100")
      ).json();
      expect(
        later.some((project: { id: string }) => project.id === oldest.id),
      ).toBe(true);
      await page.goto("/projects");
      await expect(page.locator(".project-title")).toHaveCount(100);
      const pages = page.getByRole("navigation", { name: "Project pages" });
      await expect(
        pages.getByRole("button", { name: "Next", exact: true }),
      ).toBeVisible({ timeout: 2000 });
      await expect(
        pages.getByRole("button", { name: "Previous", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("textbox", { name: "Search projects" })
        .fill(oldest.name);
      await expect(page.locator(".project-title")).toHaveCount(0);
      await expect(
        page.getByText("No matching projects on this page", { exact: true }),
      ).toBeVisible();
      if (width === 1440) {
        let fail = true;
        // One explicit transport fault tests retry; successful pages are real.
        await page.route("**/api/projects?limit=101&offset=100", (route) => {
          if (!fail) return route.continue();
          fail = false;
          return route.fulfill({
            status: 503,
            json: { detail: "Synthetic page outage" },
          });
        });
      }
      await pages.getByRole("button", { name: "Next", exact: true }).click();
      if (width === 1440) {
        await expect(page.getByRole("alert")).toContainText(
          "Synthetic page outage",
        );
        await expect(
          pages.getByRole("button", { name: "Next", exact: true }),
        ).toBeDisabled();
        await page.getByRole("button", { name: "Retry", exact: true }).click();
      }
      await expect(pages).toContainText("Page 2");
      await expect(page.locator(".project-title")).toHaveText([oldest.name]);
      await expect(
        pages.getByRole("button", { name: "Next", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByText(
          "Filters and sorting apply to this page (up to 100 projects).",
          { exact: true },
        ),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath("older-project-page.png"),
        fullPage: true,
      });
      await pages
        .getByRole("button", { name: "Previous", exact: true })
        .click();
      await expect(pages).toContainText("Page 1");
      await expect(page.locator(".project-title")).toHaveCount(0);
      await page.getByRole("textbox", { name: "Search projects" }).fill("");
      await expect(page.locator(".project-title")).toHaveCount(100);
      await pages.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.locator(".project-title")).toHaveText([oldest.name]);
      await page.locator(".project-title").click();
      await expect(page).toHaveURL(
        new RegExp(`/projects/${oldest.id}/workspace`),
      );
      expect(errors).toEqual([]);
    } finally {
      await page.goto("about:blank");
      for (const project of created) {
        expect(
          (await request.delete(`/api/projects/${project.id}`)).ok(),
        ).toBeTruthy();
      }
    }
  });
}
