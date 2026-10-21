import { expect, test } from "@playwright/test";

for (const fixture of [
  { columns: 101, rows: 51, lang: "en", width: 1440 },
  { columns: 101, rows: 0, lang: "zh", width: 390 },
  { columns: 100, rows: 1, lang: "en", width: 1440 },
  { columns: 3, rows: 1, lang: "en", width: 390 },
]) {
  test(`saved preview discloses column limits: ${fixture.columns} columns, ${fixture.rows} rows, ${fixture.lang}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: fixture.width, height: 1000 });
    await page.addInitScript((lang) => {
      localStorage.setItem("forest-language", lang);
    }, fixture.lang);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const preferences = await request.get("/api/settings");
    expect(preferences.ok()).toBeTruthy();
    const previousPreferences = await preferences.json();
    const language = await request.patch("/api/settings", {
      data: { language: fixture.lang },
    });
    expect(language.ok()).toBeTruthy();
    const created = await request.post("/api/projects", {
      data: {
        name: `Column preview ${Date.now()}`,
        mode: "manual",
        budget: { allow_paid: false },
      },
    });
    expect(created.ok()).toBeTruthy();
    const project = await created.json();
    const columns = Array.from(
      { length: fixture.columns },
      (_, index) => `column_${index + 1}`,
    );
    // Synthetic table data tests presentation and persistence, not research results.
    const content =
      [
        columns.join(","),
        ...Array.from({ length: fixture.rows }, (_, row) =>
          columns.map((_, column) => `${row}-${column}`).join(","),
        ),
      ].join("\n") + "\n";
    const filename = "preview-columns.csv";
    try {
      const upload = await request.post(`/api/projects/${project.id}/upload`, {
        multipart: {
          file: {
            name: filename,
            mimeType: "text/csv",
            buffer: Buffer.from(content),
          },
        },
      });
      expect(upload.ok()).toBeTruthy();
      const uploaded = await upload.json();
      const preview = await request.get(
        `/api/projects/${project.id}/file/preview`,
        { params: { path: uploaded.path, limit: 50 } },
      );
      expect(preview.ok()).toBeTruthy();
      const data = await preview.json();
      expect(data.column_count).toBe(fixture.columns);
      expect(data.truncated_columns).toBe(fixture.columns > 100);
      expect(data.columns).toHaveLength(Math.min(fixture.columns, 100));

      await page.goto(`/projects/${project.id}/files`);
      const openPreview = async () => {
        await page
          .locator(".file-tree")
          .getByRole("button")
          .filter({ hasText: filename })
          .click();
        await expect(page.locator(".file-table-preview th")).toHaveCount(
          Math.min(fixture.columns, 100),
        );
      };
      await openPreview();
      const notice = page.locator(".file-table-preview [role=status]");
      if (fixture.columns > 100) {
        await expect(notice).toHaveText(
          fixture.lang === "zh"
            ? "仅显示 101 列中的前 100 列；其余列未显示。下载原始文件可查看全部列。"
            : "Showing the first 100 of 101 columns; remaining columns are omitted. Download the original file to view all columns.",
        );
        await expect(notice).toBeVisible();
        await expect(
          page
            .locator(".file-table-preview th")
            .filter({ hasText: /^column_101$/ }),
        ).toHaveCount(0);
      } else {
        await expect(notice).toHaveCount(0);
      }
      if (fixture.rows > 50) {
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await expect(page.locator(".file-table-preview tbody tr")).toHaveCount(
          1,
        );
        await expect(notice).toBeVisible();
        await page
          .getByRole("button", { name: "Previous", exact: true })
          .click();
        await expect(page.locator(".file-table-preview tbody tr")).toHaveCount(
          50,
        );
      }
      await page.reload();
      await openPreview();
      if (fixture.columns > 100) await expect(notice).toBeVisible();
      else await expect(notice).toHaveCount(0);
      const download = await request.get(
        `/api/projects/${project.id}/download`,
        {
          params: { path: uploaded.path },
        },
      );
      expect(download.ok()).toBeTruthy();
      expect((await download.body()).equals(Buffer.from(content))).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      const deleted = await request.delete(`/api/projects/${project.id}`);
      expect(deleted.ok()).toBeTruthy();
      const restored = await request.patch("/api/settings", {
        data: { language: previousPreferences.language },
      });
      expect(restored.ok()).toBeTruthy();
    }
  });
}
