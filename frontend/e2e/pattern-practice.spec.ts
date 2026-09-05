import { test, expect } from "@playwright/test";

test("mobile practice pauses, survives reload, uses Stockfish and retries a lost save response", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await page.goto("/dev/patterns?practice&failSave");
  await page.clock.runFor(4000);
  await expect(page.locator(".practice-toolbar")).toContainText("0 s");
  await page.getByRole("button", { name: "Osserva la posizione" }).click();
  await page.clock.runFor(2000);
  await page.getByRole("button", { name: "Pausa", exact: true }).click();
  const paused = await page.locator(".practice-toolbar").innerText();
  await page.clock.runFor(6000);
  expect(await page.locator(".practice-toolbar").innerText()).toBe(paused);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Riprendiamo da qui." })).toBeVisible();
  await page.getByRole("button", { name: "Osserva la posizione" }).click();
  await page.getByRole("button", { name: "Mi fermo a controllare" }).click();
  await page.getByLabel("La tua mossa (notazione SAN)").fill("Be3");
  await page.clock.runFor(2000);
  await page.getByRole("button", { name: "Conferma la scelta" }).click();
  await expect(page.getByText("La tua decisione", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/il salvataggio nell'account non è riuscito/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("La tua decisione", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Salva i risultati" }).click();
  await expect(page.getByText("Risultati salvati nel tuo account.")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("synthetic-practice-saved")!).length)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Concludi la sessione" }).click();
  await expect(page.getByRole("heading", { name: "Adesso portalo in partita." })).toBeVisible();
  await page.screenshot({ path: "test-results/practice-complete-390.png" });
});

test("progress separates exercises from game opportunities on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/dev/patterns?progress");
  await expect(page.getByRole("heading", { name: "Dall'esercizio alla partita." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "In allenamento" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nelle partite successive" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/progress-360.png", fullPage: true });
  await page.goto("/dev/patterns?progress&missing-start");
  await expect(page.getByRole("status")).toContainText("14 partite escluse dal confronto successivo");
  await expect(page.getByText(/Zero occasioni non significa zero errori/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
