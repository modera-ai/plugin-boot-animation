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
  const footer = page.locator(".app-sidebar [data-plugin-sidebar-footer]");
  await expect(footer.locator(".modera-boot-pin")).toBeVisible({ timeout: 30000 });
  await expect(footer.locator(".modera-boot-launcher")).toBeVisible();
  await expect(footer.locator(".modera-boot-launcher")).toHaveText("🎬");
  const launcherSize = await footer.locator(".modera-boot-launcher").evaluate((node) => node.getBoundingClientRect().width);
  if (launcherSize > 40) throw new Error(`Intro library button is too wide: ${launcherSize}px`);
  await expect(page.locator("body > .modera-boot-footer-actions")).toHaveCount(0);
  await footer.locator(".modera-boot-launcher").click();
  await expect(page.getByRole("dialog", { name: "片头动画设置" })).toBeVisible();
  await page.locator(".modera-boot-close").click();
  console.log("PASS: intro library and session pin stay in the left conversation footer");
} finally {
  await app.close();
}
