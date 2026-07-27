// リポジトリ直下の docs/ にある画像を site/public/ へ複製する。
// README とランディングページで同じ素材を使い、二重管理を避けるため。
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const publicDir = path.resolve(here, "..", "public");

const items = [
  ["docs/icon.png", "icon.png"],
  ["docs/screenshots", "screenshots"],
];

await mkdir(publicDir, { recursive: true });
for (const [from, to] of items) {
  const src = path.join(repo, from);
  const dest = path.join(publicDir, to);
  if (!existsSync(src)) {
    console.error(`[sync-assets] 見つかりません: ${from}`);
    process.exit(1);
  }
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true });
  console.log(`[sync-assets] ${from} -> public/${to}`);
}
