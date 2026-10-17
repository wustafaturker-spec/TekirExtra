import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { root, sha, files, fingerprints, source } from "./lib/f02-aday-dosyalari.mjs";

if (process.argv.includes("--help")) {
  console.log("node scripts/f02-yayin-adayi.mjs [--cikti .release-candidates/<ad>]\nYerel API ve web adayını üretir. Yayın/migration/şirket ayarı değiştirmez. Var olan adayın üzerine yazmaz.");
  process.exit(0);
}
const arg = process.argv.indexOf("--cikti");
if (process.argv.slice(2).some((v, i, a) => v !== "--cikti" && a[i - 1] !== "--cikti")) throw new Error("Bilinmeyen seçenek; --help kullanın");
if (arg >= 0 && !process.argv[arg + 1]) throw new Error("--cikti yolu gerekli");
const id = `f02-${new Date().toISOString().replace(/[-:.]/g, "")}-${randomBytes(4).toString("hex")}`;
const output = resolve(root, arg >= 0 ? process.argv[arg + 1] : `.release-candidates/${id}`);
if (relative(join(root, ".release-candidates"), output).startsWith("..") || output === join(root, ".release-candidates") || !output.startsWith(join(root, ".release-candidates") + sep)) throw new Error("Aday yalnız .release-candidates altına yazılır");
const web = join(root, "apps/web"), api = join(root, "apps/api");
const dist = `.next-f02-pilot-${randomBytes(8).toString("hex")}`;
async function run(args, cwd, log) {
  await new Promise((ok, fail) => {
    const child = spawn("pnpm", args, { cwd, env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096", NEXT_DIST_DIR: dist }, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (v) => { text += v; }); child.stderr.on("data", (v) => { text += v; });
    child.on("error", fail);
    child.on("close", async (code) => {
      try { await writeFile(join(output, log), text); if (code !== 0) throw new Error(`${log}: exit ${code}; ${text.slice(-2500)}`); ok(); } catch (e) { fail(e); }
    });
  });
}
// Özel çıktı kökünü oluştur; var olan adaylar değiştirilemez.
await mkdir(join(root, ".release-candidates"), { recursive: true });
await mkdir(output);
const manifest = { surum: 1, id, durum: "hazirlaniyor", createdAt: new Date().toISOString(), yayinlandi: false, gercekSirketPilotu: false, webDist: relative(root, join(web, dist)) };
await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const tsconfig = await readFile(join(web, "tsconfig.json")), nextEnv = await readFile(join(web, "next-env.d.ts"));
try {
  const before = await source();
  console.log(`F02 aday dizini: ${relative(root, output)}; API ve web derleniyor.`);
  const apiBuild = () => run(["exec", "tsc", "-p", "tsconfig.json", "--outDir", join(output, "api"), "--noEmitOnError", "--sourceMap", "false"], api, "api-build.log");
  const webBuild = () => run(["build"], web, "web-build.log");
  const builds = process.env.F02_SERIAL_BUILD === "1"
    ? [await apiBuild().then(() => ({ status: "fulfilled" }), (reason) => ({ status: "rejected", reason })), await webBuild().then(() => ({ status: "fulfilled" }), (reason) => ({ status: "rejected", reason }))]
    : await Promise.allSettled([apiBuild(), webBuild()]);
  for (const build of builds) if (build.status === "rejected") throw build.reason;
  // Next'in yalnız kendi ürettiği tür yolu değişikliklerini koşu öncesine al.
  await writeFile(join(web, "tsconfig.json"), tsconfig); await writeFile(join(web, "next-env.d.ts"), nextEnv);
  const after = await source();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Kaynaklar derleme sırasında değişti; aday kabul edilmedi");
  const safeCopy = { recursive: true, verbatimSymlinks: true, filter: (p) => !basename(p).startsWith(".env") };
  await cp(join(web, dist, "standalone"), join(output, "web"), safeCopy);
  await cp(join(web, dist, "static"), join(output, "web/apps/web", dist, "static"), safeCopy);
  if (await stat(join(web, "public")).catch(() => null)) await cp(join(web, "public"), join(output, "web/apps/web/public"), safeCopy);
  for (const p of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json"]) await cp(join(root, p), join(output, p));
  // Workspace bağımlılıkları ve Prisma istemcisi dağıtım ortamında frozen lockfile ile sağlanır.
  const artifactPaths = [];
  for (const p of ["api", "web"]) artifactPaths.push(...await files(join(output, p), true));
  for (const p of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json"]) artifactPaths.push(join(output, p));
  const artifacts = await fingerprints(artifactPaths, output);
  const kaynakOzeti = sha(JSON.stringify(before)), dosyaOzeti = sha(JSON.stringify(artifacts));
  Object.assign(manifest, { durum: "yerel_aday", completedAt: new Date().toISOString(), kaynakOzeti, dosyaOzeti, webBuildId: (await readFile(join(web, dist, "BUILD_ID"), "utf8")).trim(), kaynaklar: before, dosyalar: artifacts,
    gerekenKabul: ["derlenmis_api_jwt_http_rls", "standalone_chromium", "migration_tekrar_ve_yedek_geri_yukleme", "gercek_sirket_pilotu", "uretim_kapasitesi", "eski_surume_geri_donus", "dagitim_bagimliliklari_ve_yedek"],
    apiBagimlilikNotu: "API dosyaları Node modüllerini paketlemez; aynı lockfile, workspace shared/baglanti dist ve üretilmiş Prisma istemcisi gerekir. Bu dizin tek başına kurulumsuz API dağıtımı değildir." });
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ aday: relative(root, output), kaynakOzeti, dosyaOzeti, webBuildId: manifest.webBuildId, durum: manifest.durum }));
} catch (error) {
  manifest.durum = "basarisiz";
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  throw error;
} finally {
  await writeFile(join(web, "tsconfig.json"), tsconfig); await writeFile(join(web, "next-env.d.ts"), nextEnv);
}
