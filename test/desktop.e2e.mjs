import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = resolve(root, "../../modera");
const hostRequire = createRequire(join(host, "modera-app/package.json"));
const { _electron: electron, expect } = hostRequire("@playwright/test");
const data = await mkdtemp(join(tmpdir(), "modera-boot-desktop-"));
const pluginRoot = join(data, "plugins/plugin-boot-animation");
await mkdir(pluginRoot, { recursive: true });
for (const name of ["dist", "plugin.json", "LICENSE", "NOTICE"])
  await cp(join(root, name), join(pluginRoot, name), { recursive: true });
const config = join(data, "default.yml");
await writeFile(config,
  "version: 1\nprofile: default\nprofiles:\n  default:\n    plugins:\n      modera.boot-animation: { enabled: true }\n");
const env = {
  ...process.env,
  MODERA_TEST_DATA: data,
  MODERA_DATA_DIR: data,
  MODERA_DEFAULT_CONFIG: config,
  MODERA_PLUGINS_DIR: join(data, "plugins"),
  MODERA_TRUSTED_CORE_PLUGINS_DIR: join(data, "plugins"),
  ELECTRON_RENDERER_URL: "",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [join(host, "modera-app/core/tests/desktop/bootstrap.mjs")],
  env,
});
try {
  const page = await app.firstWindow();
  const skip = page.getByRole("button", { name: "跳过 ×" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  const footer = page.locator(".app-sidebar [data-plugin-sidebar-above-footer]");
  await expect(footer.locator(".modera-boot-pin")).toBeVisible({ timeout: 30000 });
  await expect(footer.locator(".modera-boot-launcher")).toBeVisible();
  await expect(footer.locator(".modera-boot-launcher")).toHaveText("🎬");
  await page.evaluate(() => localStorage.setItem("modera.sidebar.workbench-entries", JSON.stringify(["plugins"])));
  await page.reload();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(footer.locator(".modera-boot-launcher")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".app-sidebar-navigation-footer")).toBeVisible();
  await expect(skip).toBeVisible({ timeout: 30000 });
  await skip.click();
  await expect(page.locator(".modera-boot-overlay")).toHaveCount(0);
  const footerOrder = await page.evaluate(() => {
    const injection = document.querySelector("[data-plugin-sidebar-above-footer]").getBoundingClientRect();
    const settings = document.querySelector(".app-sidebar-navigation-footer").getBoundingClientRect();
    return injection.bottom <= settings.top;
  });
  if (!footerOrder) throw new Error("Intro actions must stay above settings");
  await page.screenshot({ path: join(root, "release/sidebar-footer.png") });
  await expect(page.locator("[data-plugin-sidebar-footer] .modera-boot-footer-actions")).toHaveCount(0);

  const launcherSize = await footer.locator(".modera-boot-launcher").evaluate((node) => node.getBoundingClientRect().width);
  if (launcherSize > 40) throw new Error(`Intro library button is too wide: ${launcherSize}px`);
  await expect(page.locator("body > .modera-boot-footer-actions")).toHaveCount(0);
  await footer.locator(".modera-boot-launcher").click();
  const libraryDialog = page.getByRole("dialog", { name: "片头片库" });
  await expect(libraryDialog).toBeVisible();
  const builtins = page.locator(".dba-item").filter({ hasText: "插件内置" });
  await expect(builtins).toHaveCount(4);
  for (let index = 0; index < 4; index++) {
    await expect(builtins.nth(index).getByRole("button", { name: "删除", exact: true })).toHaveCount(0);
    await builtins.nth(index).getByRole("button", { name: "▶ 预览", exact: true }).click();
    const video = page.locator(".modera-boot-video");
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((node) => node.readyState), { timeout: 15000 }).toBeGreaterThanOrEqual(3);
    await skip.click();
    await expect(libraryDialog).toBeVisible();
    await expect(builtins.getByRole("button", { name: "已选", exact: true })).toHaveCount(0);
  }
  await builtins.first().getByRole("button", { name: "选它", exact: true }).click();
  await expect(builtins.first().getByRole("button", { name: "已选", exact: true })).toBeDisabled();
  await libraryDialog.getByRole("button", { name: "完整显示", exact: true }).click();
  await expect(libraryDialog.getByRole("button", { name: "完整显示", exact: true })).toHaveClass(/dba-btn-on/);
  await libraryDialog.getByRole("button", { name: "🎲 随机播放：关", exact: true }).click();
  await expect(libraryDialog.getByRole("button", { name: "🎲 随机播放：开", exact: true })).toBeVisible();
  await libraryDialog.getByRole("button", { name: "▶ 播一次", exact: true }).click();
  await expect(page.locator(".modera-boot-video")).toBeVisible();
  const firstRandom = await page.locator(".modera-boot-video").getAttribute("src");
  await skip.click();
  await libraryDialog.getByRole("button", { name: "▶ 播一次", exact: true }).click();
  await expect(page.locator(".modera-boot-video")).toBeVisible();
  const secondRandom = await page.locator(".modera-boot-video").getAttribute("src");
  if (firstRandom === secondRandom) throw new Error("Random playback repeated the previous clip");
  await skip.click();
  await libraryDialog.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(libraryDialog.getByRole("button", { name: "🎲 随机播放：开", exact: true })).toBeVisible();
  await page.screenshot({ path: join(root, "release/upstream-library.png") });
  await libraryDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(libraryDialog).toHaveCount(0);
  await footer.locator(".modera-boot-launcher").click();
  await expect(builtins.first().getByRole("button", { name: "已选", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(libraryDialog).toHaveCount(0);
  console.log("PASS: upstream library previews, selection, fit, random playback, refresh and close");
} finally {
  await app.close();
}
