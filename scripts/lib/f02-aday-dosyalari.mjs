import { createHash } from "node:crypto";
import { lstat, readFile, readlink, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
export const root = fileURLToPath(new URL("../../", import.meta.url));
export const sha = (v) => createHash("sha256").update(v).digest("hex");
export async function files(dir, artifact = false) {
  const result = [];
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".env") || (!artifact && (e.name === "node_modules" || e.name === "dist"))) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) result.push(...await files(p, artifact));
    else if (e.isFile() || (artifact && e.isSymbolicLink())) result.push(p);
  }
  return result;
}
export async function fingerprints(paths, base) {
  const result = {};
  for (const p of [...new Set(paths)].sort()) result[relative(base, p)] = sha((await lstat(p)).isSymbolicLink() ? `symlink\0${await readlink(p)}` : await readFile(p));
  return result;
}
export async function source() {
  const paths = [];
  for (const p of ["apps/api/src", "apps/api/prisma", "apps/web/src", "apps/web/public", "apps/web/e2e", "apps/api/test", "packages/shared/src", "packages/baglanti/src", "scripts"]) paths.push(...await files(join(root, p)));
  for (const p of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "turbo.json", "apps/api/package.json", "apps/api/tsconfig.json", "apps/api/scripts/f01-yaris-kabul.mjs", "apps/web/package.json", "apps/web/tsconfig.json", "apps/web/next-env.d.ts", "apps/web/next.config.ts", "packages/shared/package.json", "packages/shared/tsconfig.json", "packages/baglanti/package.json", "packages/baglanti/tsconfig.json"]) paths.push(join(root, p));
  for (const [dir, pattern] of [["apps/web", /^playwright.*\.ts$/], ["apps/api", /^vitest.*\.ts$/]]) paths.push(...(await readdir(join(root, dir))).filter((p) => pattern.test(p)).map((p) => join(root, dir, p)));
  return fingerprints(paths, root);
}
