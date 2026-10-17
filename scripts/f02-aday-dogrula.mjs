import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { root, source, files, fingerprints, sha } from "./lib/f02-aday-dosyalari.mjs";

export async function adayiDogrula(aday, { kaynak = true } = {}) {
  const dir = resolve(root, aday);
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  if (manifest.surum !== 1 || manifest.durum !== "yerel_aday") throw new Error("Tamamlanmış yerel aday gerekli");
  if (kaynak && sha(JSON.stringify(await source())) !== manifest.kaynakOzeti) throw new Error("Adayın kaynak özeti güncel çalışma alanıyla aynı değil");
  const paths = [...await files(join(dir, "api"), true), ...await files(join(dir, "web"), true)];
  for (const p of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json"]) paths.push(join(dir, p));
  const actual = await fingerprints(paths, dir);
  if (sha(JSON.stringify(actual)) !== manifest.dosyaOzeti || JSON.stringify(actual) !== JSON.stringify(manifest.dosyalar)) throw new Error("Aday dosyaları değişmiş");
  return { aday: dir, id: manifest.id, kaynakOzeti: manifest.kaynakOzeti, dosyaOzeti: manifest.dosyaOzeti, webBuildId: manifest.webBuildId };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("node scripts/f02-aday-dogrula.mjs .release-candidates/<aday>");
  console.log(JSON.stringify(await adayiDogrula(process.argv[2])));
}
