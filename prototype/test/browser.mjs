import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BASE_URL || "http://127.0.0.1:8787";
await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: true });
let checks = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector("#run").disabled);
  assert.equal(await page.locator("#decision").textContent(), "Ready");
  const choose = async (scene) =>
    page.locator(`input[value="${scene}"]`).check();
  const run = async (expected) => {
    await page.locator("#run").click();
    await page.waitForFunction(
      (value) => document.querySelector("#decision").textContent === value,
      expected,
      { timeout: 8000 },
    );
  };
  await run("Allowed");
  assert.equal(await page.locator("#shield").isHidden(), true);
  await page.locator("#stop").click();
  checks.push("clean source is allowed after real samples");
  await choose("flash");
  await run("Shielded");
  assert.equal(await page.locator("#shield").isVisible(), true);
  assert.ok(Number(await page.locator("#flashes").textContent()) >= 3);
  assert.ok(Number(await page.locator("#samples").textContent()) > 10);
  checks.push("rapid source is detected and never uncovered during warm-up");
  await page.screenshot({
    path: new URL("../artifacts/studio-desktop.png", import.meta.url).pathname,
    fullPage: true,
  });
  await page.locator("#preset").selectOption("standard");
  await run("Shielded");
  assert.ok(Number(await page.locator("#flashes").textContent()) >= 4);
  checks.push("standard requires more than three completed general flashes");
  await choose("unreadable");
  await run("Guarded");
  assert.equal(await page.locator("#shield").isVisible(), true);
  assert.match(
    await page.locator("#shield-detail").textContent(),
    /cross-origin/,
  );
  checks.push("actual cross-origin pixel access fails closed");
  await choose("calm");
  await run("Allowed");
  await page.locator("#stop").click();
  checks.push("origin-clean state resets between scenarios");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelector("#run").disabled);
  assert.equal(await page.locator("#run").isDisabled(), true);
  await choose("flash");
  await page.locator("#replay").click();
  await page.waitForFunction(
    () => document.querySelector("#decision").textContent === "Shielded",
  );
  assert.equal(await page.locator("#shield").isVisible(), true);
  assert.match(await page.locator("#sample-mode").textContent(), /replay/);
  checks.push("reduced motion offers a covered measurements-only replay");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(() => !document.querySelector("#run").disabled);
  await choose("calm");
  await page.locator("#run").click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#decision").textContent(), "Paused");
  checks.push("Escape cancels a run");
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    axe.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  checks.push("automated WCAG A/AA checks: no violations");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: new URL("../artifacts/studio-mobile.png", import.meta.url).pathname,
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  checks.push("390px mobile viewport has no horizontal overflow");
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("../artifacts/browser-results.json", import.meta.url),
    JSON.stringify(
      { checkedAt: new Date().toISOString(), checks, pageErrors: errors },
      null,
      2,
    ),
  );
  console.log(checks.map((c) => "PASS " + c).join("\n"));
} finally {
  await browser.close();
}
