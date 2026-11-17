import { expect, type Page, test } from "@playwright/test";

async function signIn(page: Page, name: string) {
  await page.goto("/signin");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/notes$/);
}

test("create, edit and delete a note", async ({ page }, info) => {
  await signIn(page, `E2E ${info.project.name} ${Date.now()}`);
  await expect(page.getByText("No notes yet.")).toBeVisible();

  await page.getByLabel("Title").fill("Groceries");
  await page.getByLabel("Body").fill("Lentils, rice, lemons");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByRole("link", { name: "Groceries" })).toBeVisible();
  await expect(page.getByText("Lentils, rice, lemons")).toBeVisible();

  await page.getByRole("link", { name: "Groceries" }).click();
  await expect(page.getByRole("heading", { name: "Edit note" })).toBeVisible();
  await page.getByLabel("Title").fill("Groceries for Sunday");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByRole("link", { name: "Groceries for Sunday" })).toBeVisible();

  await page.getByRole("link", { name: "Groceries for Sunday" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Groceries for Sunday");
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByText("No notes yet.")).toBeVisible();
});

test("other users cannot see your notes", async ({ page, browser }, info) => {
  await signIn(page, `Owner ${info.project.name} ${Date.now()}`);
  await page.getByLabel("Title").fill("Private plans");
  await page.getByRole("button", { name: "Add note" }).click();
  const href = await page.getByRole("link", { name: "Private plans" }).getAttribute("href");

  const other = await (await browser.newContext()).newPage();
  await signIn(other, `Other ${info.project.name} ${Date.now()}`);
  await expect(other.getByText("Private plans")).toHaveCount(0);
  const response = await other.goto(href ?? "/notes/0");
  expect(response?.status()).toBe(404);
});

test("mock mode shows the preview banner and seeded users", async ({ page }, info) => {
  test.skip(info.project.name !== "mock", "mock mode only");
  await page.goto("/signin");
  await expect(page.getByRole("status")).toContainText("Preview with mock data");

  await page.getByRole("button", { name: /Grace Hopper/ }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByRole("heading", { name: /Your notes/ })).toContainText("(120)");
});

test("production mode has no banner and no mock users", async ({ page }, info) => {
  test.skip(info.project.name !== "production", "production mode only");
  await page.goto("/signin");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByText("Or pick a mock user")).toHaveCount(0);
});
