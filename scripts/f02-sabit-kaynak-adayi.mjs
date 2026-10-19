import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile, access } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { root, source, sha } from "./lib/f02-aday-dosyalari.mjs";
import { standalonePaketiniDuzelt } from "./lib/f02-standalone-paket.mjs";

const arg = process.argv.indexOf("--cikti");
if (arg < 0 || !process.argv[arg + 1] || process.argv.length !== 4) throw Error("node scripts/f02-sabit-kaynak-adayi.mjs --cikti .release-candidates/<ad>");
const target = resolve(root, process.argv[arg + 1]);
if (!target.startsWith(join(root, ".release-candidates") + sep)) throw Error("Çıktı .release-candidates altında olmalı");
if (await access(target).then(() => true, () => false)) throw Error("Var olan adayın üzerine yazılmaz");
const snapshot = join(root, ".release-candidates", "f02-kaynak-" + Date.now() + "-" + randomBytes(4).toString("hex"));
await mkdir(snapshot, { recursive: true });
const report = { surum: 1, baslangic: new Date().toISOString(), durum: "basladi", kaynakDizini: relative(root, snapshot), adayDizini: relative(root, target), gercekSistemDegisikligi: false };
async function run(command, args, cwd, log, extra = {}) {
  await new Promise((ok, fail) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, CI: "true", NODE_OPTIONS: "--max-old-space-size=4096", PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1", PRISMA_GENERATE_SKIP_AUTOINSTALL: "1", DATABASE_URL: "postgresql://127.0.0.1:9/f02_build_only", DATABASE_URL_MIGRATE: "postgresql://127.0.0.1:9/f02_build_only", ...extra }, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", v => { text += v; }); child.stderr.on("data", v => { text += v; });
    child.on("error", fail);
    child.on("close", async code => { try { await writeFile(join(snapshot, log), text); if (code !== 0) throw Error(`${log}: exit ${code}; ${text.slice(-2500)}`); ok(); } catch (e) { fail(e); } });
  });
}
try {
  const before = await source();
  for (const file of Object.keys(before)) { const dest = join(snapshot, file); await mkdir(dirname(dest), { recursive: true }); await copyFile(join(root, file), dest); if (sha(await readFile(dest)) !== before[file]) throw Error("Kopyalama sırasında kaynak değişti: " + file); }
  if (JSON.stringify(before) !== JSON.stringify(await source())) throw Error("Kopyalama sırasında çalışma alanı değişti; kopya kabul edilmedi");
  report.kaynakOzeti = sha(JSON.stringify(before)); report.kaynakDosyaAdedi = Object.keys(before).length;
  console.log("Kaynak kopyası sabitlendi: " + relative(root, snapshot));
  await run("pnpm", ["install", "--offline", "--frozen-lockfile", "--ignore-scripts", "--package-import-method", "copy", "--virtual-store-dir", "node_modules/.pnpm"], snapshot, "bagimlilik-kurulum.log");
  await run("pnpm", ["exec", "prisma", "generate"], join(snapshot, "apps/api"), "prisma-uretimi.log");
  for (const pkg of ["shared", "baglanti"]) await run("pnpm", ["exec", "tsc", "-p", "tsconfig.json", "--sourceMap", "false"], join(snapshot, "packages", pkg), pkg + "-build.log");
  const childOutput = ".release-candidates/derlenmis";
  await run(process.execPath, ["scripts/f02-yayin-adayi.mjs", "--cikti", childOutput], snapshot, "aday-build.log", { F02_SERIAL_BUILD: "1" });
  const { adayiDogrula } = await import(pathToFileURL(join(snapshot, "scripts/f02-aday-dogrula.mjs")));
  const raw = join(snapshot, childOutput);
  report.aday = await adayiDogrula(raw);
  if (report.aday.kaynakOzeti !== report.kaynakOzeti) throw Error("Kopya kaynağı derleme sırasında değişti");
  const packaged = await standalonePaketiniDuzelt(raw, join(snapshot, ".release-candidates/standalone-duzeltilmis"));
  report.aday = await adayiDogrula(packaged.dizin);
  report.standaloneDuzeltildi = packaged.duzeltildi;
  await rename(packaged.dizin, target);
  report.aday.aday = target;
  const current = await source();
  report.guncelCalismaAlaniylaAyni = JSON.stringify(before) === JSON.stringify(current);
  report.sonradanDegisenKaynaklar = [...new Set([...Object.keys(before), ...Object.keys(current)])].filter(p => before[p] !== current[p]);
  report.durum = "aday_hazir";
} catch (e) { report.durum = "basarisiz"; report.hata = String(e.stack || e); process.exitCode = 1; }
finally {
  report.bitis = new Date().toISOString();
  await writeFile(join(snapshot, "sabit-kaynak-raporu.json"), JSON.stringify(report, null, 2) + "\n");
  if (report.durum === "aday_hazir") await writeFile(join(target, "sabit-kaynak-raporu.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
