import { test, expect } from "@playwright/test";

for (const width of [360, 390, 430, 1280]) {
  test(`pattern home and clock evidence at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dev/patterns");
    await expect(page.getByRole("heading", { name: "Conosci il tuo gioco." })).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Navigazione principale" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Allenamento", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const practice = page.getByRole("link", { name: "Prova sulle tue posizioni", exact: true });
    const evidence = page.getByRole("link", { name: "Perché questo tema?", exact: true });
    const practiceUrl = new URL((await practice.getAttribute("href"))!, page.url());
    const evidenceUrl = new URL((await evidence.getAttribute("href"))!, page.url());
    expect(practiceUrl.pathname).toBe("/sessione");
    expect(practiceUrl.searchParams.get("pattern")).toBeTruthy();
    expect(practiceUrl.searchParams.get("pattern")).toBe(evidenceUrl.searchParams.get("pattern"));
    await expect(page.locator("#timing-evidence")).toBeHidden();
    await page.getByRole("button", { name: "Esplora il tuo uso del tempo" }).click();
    await expect(page.locator(".pattern-detail summary").first()).toContainText("mediogioco");
    await page.locator(".pattern-detail summary").first().click();
    await expect(page.getByRole("heading", { name: "Prima della tua decisione" }).first()).toBeVisible();
    await expect(page.getByText("6:00", { exact: true }).first()).toBeVisible();
    const choices = page.locator(".pattern-evidence").first();
    await choices.getByRole("button", { name: "Partita 2" }).click();
    await expect(choices.getByRole("button", { name: "Partita 2" })).toHaveAttribute("aria-pressed", "true");
    const board = await page.locator(".pattern-board").first().boundingBox();
    expect(board!.width).toBeGreaterThan(250);
    expect(board!.x + board!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Passa al tema chiaro" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/patterns-${width}-light.png` });
    await page.screenshot({ path: `test-results/patterns-${width}-light-full.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("missing timing and empty reports remain actionable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/patterns?missing");
  await expect(page.getByText(/Questa lettura non contiene ancora/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aggiorna le partite" })).toBeEnabled();
  await page.goto("/dev/patterns?new-rating");
  await expect(page.getByRole("link", { name: "Il tuo obiettivo" })).toContainText("1250");
  await expect(page.getByRole("status")).toContainText("Il confronto Maia di questa lettura usa 1200 → 1400");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/dev/patterns?empty");
  await expect(page.getByRole("heading", { name: "La tua lettura deve ancora arrivare." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aggiorna le partite" })).toBeEnabled();
});

test("pattern detail shows successful evidence and supports touch-sized controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/patterns?detail");
  await expect(page.getByRole("heading", { name: "Le prove, sulle tue scacchiere" })).toBeVisible();
  await page.getByRole("button", { name: /Scelte riuscite/ }).click();
  await page.getByRole("button", { name: "Partita 2", exact: true }).click();
  await page.getByRole("button", { name: "Alternativa del motore" }).click();
  const initial = await page.locator('.move-playback').getAttribute('data-position');
  await page.getByRole("button", { name: "Mossa successiva" }).click();
  await expect(page.locator('.move-playback')).not.toHaveAttribute('data-position', initial!);
  await page.getByRole("button", { name: "Mossa precedente" }).click();
  await expect(page.locator('.move-playback')).toHaveAttribute('data-position', initial!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const control = await page.getByRole("button", { name: "Mossa successiva" }).boundingBox();
  expect(control!.height).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("button", { name: "Partita 2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("main")).toHaveCount(1);
});
