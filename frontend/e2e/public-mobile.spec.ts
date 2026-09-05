import { test, expect } from "@playwright/test";

test("public mobile flow explains clock context and opens signup", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("abitudini");
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Sotto pressione", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Qui il tempo era quasi finito." })).toBeVisible();
  await page.getByRole("button", { name: "Tempo a disposizione", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Avevi tempo. La scelta è arrivata subito." })).toBeVisible();
  await page.getByRole("button", { name: "Continua senza telemetria", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Scelta telemetria" })).toHaveCount(0);
  await page.getByRole("link", { name: "Inizia dalle tue partite" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});

test("onboarding uses the selected category rating and recovers a failed save", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const user = { id: "10000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "mobile@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  await page.route("**/auth/v1/token**", route => route.fulfill({ json: { access_token: "synthetic-browser-token", refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, user } }));
  await page.route("**/auth/v1/user", route => route.fulfill({ json: user }));
  let submitted: Record<string, unknown> | null = null;
  let saves = 0;
  await page.route("**/rest/v1/profiles*", route => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON(); saves += 1;
      return route.fulfill({ status: 503, json: { message: "Synthetic unavailable" } });
    }
    return route.fulfill({ json: null });
  });
  await page.route("https://api.chess.com/pub/player/mobilefixture", route => route.fulfill({ json: { username: "mobilefixture" } }));
  await page.route("https://api.chess.com/pub/player/mobilefixture/stats", route => route.fulfill({ json: { chess_rapid: { last: { rating: 1400 } }, chess_blitz: { last: { rating: 1100 } } } }));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-test-password");
  await page.getByRole("button", { name: "Entra", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Username Chess.com").fill("mobilefixture");
  await page.getByRole("button", { name: "Trova il profilo", exact: true }).click();
  await page.getByRole("button", { name: "Usa questo profilo", exact: true }).click();
  await expect(page.getByLabel("Livello di riferimento")).toHaveValue("1600");
  await page.getByRole("button", { name: "blitz 1100", exact: true }).click();
  await expect(page.getByLabel("Livello di riferimento")).toHaveValue("1300");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/onboarding-360.png", fullPage: true });
  const save = page.getByRole("button", { name: "Analizza le mie partite", exact: true });
  await save.click();
  await expect(page.getByRole("alert")).toContainText("Non sono riuscito a salvare");
  await expect(save).toBeEnabled();
  expect(submitted).toMatchObject({ goal_time_class: "blitz", goal_rating: 1300, user_id: user.id });
  await save.click();
  await expect.poll(() => saves).toBe(2);
});

test("preparation exposes successful counts, recovery and access to first reading", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/dev/patterns?preparation");
  await expect(page.getByRole("progressbar", { name: "Partite analizzate" })).toHaveAttribute("value", "5");
  await expect(page.getByRole("progressbar", { name: "Partite analizzate" })).toHaveAttribute("max", "24");
  await expect(page.getByText("5 / 24 partite analizzate e salvate", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/dev/patterns?preparation&error");
  await expect(page.getByRole("alert")).toContainText("connessione interrotta");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.getByRole("button", { name: "Riprendi l’analisi", exact: true }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await page.goto("/dev/patterns?preparation&ready");
  await page.getByRole("button", { name: "Apri il tuo gioco", exact: true }).click();
  await expect(page).toHaveURL(/\/dev\/patterns$/);
});

 test("Maia preparation shows measured positions and elapsed silence without invented progress", async ({page})=>{
  await page.clock.install();
  await page.setViewportSize({width:390,height:844});
  await page.goto("/dev/patterns?preparation&maia");
  await expect(page.getByText("36 / 200 posizioni confrontate",{exact:true})).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value","36");
  await page.clock.fastForward(31000);
  await expect(page.getByText(/Non sono arrivati nuovi avanzamenti/)).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value","36");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });

 test("Maia estimate follows completed work and disappears when work stops", async ({ page }) => {
  await page.clock.install();
  await page.goto("/dev/patterns?preparation&maia");
  await page.clock.fastForward(10000);
  await page.getByRole("button", { name: "Simula 12 confronti completati" }).click();
  await expect(page.getByText("48 / 200 posizioni confrontate", { exact: true })).toBeVisible();
  await expect(page.getByText(/Tempo stimato per questa fase/)).toBeVisible();
  await page.clock.fastForward(31000);
  await expect(page.getByText(/Tempo stimato per questa fase/)).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "48");
 });
