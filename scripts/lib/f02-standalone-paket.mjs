import { cp, lstat, mkdir, readFile, realpath, writeFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, relative, sep } from "node:path";
import { files, fingerprints, sha } from "./f02-aday-dosyalari.mjs";

async function artifactPaths(dir) {
  return [...await files(join(dir, "api"), true), ...await files(join(dir, "web"), true), ...["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].map(p => join(dir, p))];
}

// Next iç içe lockfile'larda üst kökü seçebilir. Sunucu ve bütün yerel
// bağımlılıklarını aynı önekten al; static/public dosyalarını girişe bağla.
export async function standalonePaketiniDuzelt(input, output) {
  const parent = JSON.parse(await readFile(join(input, "manifest.json"), "utf8"));
  if (parent.durum !== "yerel_aday") throw Error("Tamamlanmış derleme gerekli");
  const original = await fingerprints(await artifactPaths(input), input);
  if (JSON.stringify(original) !== JSON.stringify(parent.dosyalar) || sha(JSON.stringify(original)) !== parent.dosyaOzeti) throw Error("Ana aday dosyaları değişmiş");
  const servers = Object.keys(original).filter(p => p.startsWith("web/") && p.endsWith("apps/web/server.js"));
  if (servers.length !== 1) throw Error("Tek standalone uygulama sunucusu gerekli");
  const prefix = servers[0].slice("web/".length, -"apps/web/server.js".length);
  if (!prefix) return { dizin: input, duzeltildi: false };
  if (prefix.split("/").includes("..")) throw Error("Güvenli olmayan standalone öneki");
  await mkdir(output);
  const options = { recursive: true, verbatimSymlinks: true, filter: p => !p.split(sep).at(-1).startsWith(".env") };
  for (const p of ["api", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) await cp(join(input, p), join(output, p), options);
  await cp(join(input, "web", prefix), join(output, "web"), options);
  const dist = parent.webDist.split("/").at(-1);
  for (const p of [dist + "/static", "public"]) if (await stat(join(input, "web/apps/web", p)).catch(() => null)) await cp(join(input, "web/apps/web", p), join(output, "web/apps/web", p), options);
  const paths = await artifactPaths(output);
  for (const p of paths) if ((await lstat(p)).isSymbolicLink()) {
    const target = relative(output, await realpath(p));
    if (target.startsWith("..") || target.startsWith(sep)) throw Error("Paket dışı bağlantı: " + p);
  }
  const actual = await fingerprints(paths, output);
  const packaging = { anaAdayId: parent.id, anaDosyaOzeti: parent.dosyaOzeti, eskiWebOnEki: prefix, aracSha256: sha(await readFile(new URL(import.meta.url))), kaynakYenidenDerlenmedi: true };
  const manifest = { ...parent, id: `f02-${new Date().toISOString().replace(/[-:.]/g, "")}-${randomBytes(4).toString("hex")}`, createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), dosyalar: actual, dosyaOzeti: sha(JSON.stringify(actual)), paketleme: packaging };
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(join(output, "standalone-kok-duzeltmesi.json"), JSON.stringify({ durum: "gecti", ...packaging }, null, 2) + "\n");
  return { dizin: output, duzeltildi: true, paketleme: packaging };
}
