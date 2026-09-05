import { test, expect } from "@playwright/test";

test("existing accounts with legacy Maia fields keep their home after loading and reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dev/patterns?legacy");
  await expect(page.getByRole("heading", { name: "Conosci il tuo gioco." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Doppi attacchi", level: 3 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aggiorna le partite" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Conosci il tuo gioco." })).toBeVisible();
  expect(errors).toEqual([]);
});
