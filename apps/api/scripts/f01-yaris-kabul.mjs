import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { delimiter } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

// Canlı bağlantı ayarı okunmaz. Her koşu kendi boş PostgreSQL konteynerini açar.
const nonce = randomBytes(8).toString("hex");
const cekirdek = process.argv.includes("--cekirdek");
const yayin = process.argv.includes("--f02-yayin") || cekirdek;
const crmHttp = process.argv.includes("--f03-http") || cekirdek;
// API giriş çerezi ile standalone web koruması aynı izole anahtarı kullanmalı.
// Gerçek ortam dosyası okunmaz; alt test süreçlerine rastgele anahtar aktarılır.
if (crmHttp) process.env.OTURUM_ISARETI_SECRET ??= randomBytes(32).toString("hex");
const crmDist = cekirdek ? process.env.F02_API_DIST : process.env.F03_API_DIST ?? fileURLToPath(new URL("../../../.release-candidates/f03-http-20261018/api", import.meta.url));
if (yayin && !process.env.F02_API_DIST) throw new Error("Yayın provası için F02_API_DIST gerekli");
const config = process.argv.includes("--f04") ? "vitest.ihtiyac.config.ts" : cekirdek ? "vitest.cekirdek.config.ts" : crmHttp ? "vitest.crm-http.config.ts" : process.argv.includes("--f03") ? "vitest.crm-belge.config.ts" : yayin ? "vitest.f02-yayin.config.ts" : process.argv.includes("--f02") ? "vitest.odeme-sozu.config.ts" : "vitest.maliyet-yaris.config.ts";
const report = { surum: 1, baslangic: new Date().toISOString(), durum: "baslamadi", geciciDbSilindi: false, gercekSirketPilotu: false };
if (yayin) {
  const { adayiDogrula } = await import("../../../scripts/f02-aday-dogrula.mjs");
  report.aday = await adayiDogrula(dirname(process.env.F02_API_DIST));
}
const database = `f01_yaris_${nonce}`, password = randomBytes(24).toString("hex");
let container;
async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: new URL("../", import.meta.url), timeout: process.argv.includes("--f04") ? 600000 : 180000, ...options, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const binary = [];
    child.stdout.on("data", (d) => { if (options.binary) binary.push(d); else output += d; });
    child.stderr.on("data", (d) => { output += d; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(options.binary ? Buffer.concat(binary) : output.trim()) : reject(new Error(`${command} exit ${code}: ${output.replaceAll(password, "[redacted]").slice(-6000)}`)));
    child.stdin.end(options.input);
  });
}
try {
  if (crmHttp && !cekirdek) {
    await mkdir(dirname(crmDist), { recursive: true });
    await run(process.execPath, ["--max-old-space-size=4096", "node_modules/typescript/bin/tsc", "-p", "tsconfig.crm-http.json", "--outDir", crmDist]);
    console.log("F03 odaklı API derlemesi hazır; üretim servisi başlatılmadı.");
  }
  container = await run("docker", ["run", "--pull=never", "--rm", "-d", "--name", `tekir-f01-yaris-${nonce}`, "--label", "tekirextra.test=f01-yaris", "--memory=512m", "--tmpfs", "/var/lib/postgresql/data:rw,size=512m", "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=tekir", "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${database}`, "postgres:16-alpine"]);
  const deadline = Date.now() + 30000;
  for (;;) {
    try { await run("docker", ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "tekir", "-d", database]); break; }
    catch (e) { if (Date.now() > deadline) throw e; await new Promise((r) => setTimeout(r, 200)); }
  }
  await run("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "tekir", "-d", database], { input: `CREATE ROLE tekir_app LOGIN PASSWORD '${password}'; CREATE ROLE tekir_platform LOGIN PASSWORD '${password}'; ALTER DATABASE ${database} SET tekir.f01_yaris_nonce = '${nonce}';` });
  const port = (await run("docker", ["port", container, "5432/tcp"])).split(":").at(-1).trim();
  if (!/^\d+$/.test(port)) throw new Error("Geçici PostgreSQL portu doğrulanamadı.");
  const base = `127.0.0.1:${port}/${database}`;
  await run("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: `postgresql://tekir:${password}@${base}`, DATABASE_URL_MIGRATE: `postgresql://tekir:${password}@${base}` } });
  if (yayin) {
    await run("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: `postgresql://tekir:${password}@${base}`, DATABASE_URL_MIGRATE: `postgresql://tekir:${password}@${base}` } });
    report.migrationTekrari = "gecti";
  }
  console.log("Geçici PostgreSQL hazır; migration'lar uygulandı. Yarış testleri uygulama rolüyle çalışıyor.");
  const output = await run("pnpm", ["exec", "vitest", "run", "--config", config], {
    timeout: cekirdek ? 600000 : crmHttp ? 600000 : 180000,
    env: { ...process.env, ...(crmHttp ? { F03_API_DIST: crmDist } : {}), ...(cekirdek ? { F03_WEB_ROOT: `${dirname(crmDist)}/web/apps/web` } : {}), NODE_PATH: [fileURLToPath(new URL("../node_modules", import.meta.url)), process.env.NODE_PATH].filter(Boolean).join(delimiter), F01_YARIS_DB_URL: `postgresql://tekir_app:${password}@${base}?connection_limit=6`, F01_YARIS_NONCE: nonce },
  });
  console.log(output.replaceAll(password, "[redacted]"));
  if (crmHttp) {
    report.testAdedi = Number(output.match(/Tests\s+(\d+) passed/)?.[1] ?? 0);
    if (!report.testAdedi) throw new Error("F03 HTTP kabul sonucu doğrulanamadı");
    if (!cekirdek) report.durum = "gecti";
    report.kabulLogOzeti = createHash("sha256").update(output).digest("hex");
    await writeFile(`${dirname(crmDist)}/http-kabul.log`, output.replaceAll(password, "[redacted]") + "\n");
  }
  if (yayin) {
    report.testAdedi = Number(output.match(/Tests\s+(\d+) passed/)?.[1] ?? 0);
    if (!report.testAdedi) throw new Error("Kabul sonucu test sayısı doğrulanamadı");
    report.kabulLogOzeti = createHash("sha256").update(output).digest("hex");
    const tables = ["tenants", "users", "cari_hesaplar", "faturalar", "cari_hareketler", "kasa_banka_hareketleri", "fatura_kapamalari", "odeme_sozleri", "tahsilat_takipleri", "tahsilat_gorusmeleri", "tahsilat_soz_baglantilari", "bildirimler", "bildirim_teslimatlari", "audit_log"];
    if (cekirdek) tables.push("crm_firsatlari", "belgeler", "belge_satirlari", "fatura_satirlari", "firsat_belge_baglari", "firsat_kapama_paylari", "firsat_iade_paylari", "fatura_iade_referanslari");
    const fingerprintSql = tables.map((t) => `SELECT '${t}',count(*)::text,md5(COALESCE(string_agg(to_jsonb(x)::text, '' ORDER BY id),'')) FROM ${t} x`).join(" UNION ALL ");
    const sql = (db, input) => run("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-h", "127.0.0.1", "-U", "tekir", "-d", db], { input });
    const once = await sql(database, `SELECT * FROM (${fingerprintSql}) q ORDER BY 1`);
    const dump = await run("docker", ["exec", container, "pg_dump", "-h", "127.0.0.1", "-U", "tekir", "-d", database, "-Fc", "--no-owner"], { binary: true });
    const restoreDb = `f01_restore_${nonce}`;
    await sql(database, `CREATE DATABASE ${restoreDb};`);
    await run("docker", ["exec", "-i", container, "pg_restore", "--exit-on-error", "--no-owner", "-h", "127.0.0.1", "-U", "tekir", "-d", restoreDb], { input: dump });
    const sonra = await sql(restoreDb, `SELECT * FROM (${fingerprintSql}) q ORDER BY 1`);
    if (once !== sonra) throw new Error("Geçici yedek/geri yükleme kayıt özeti farklı");
    report.yedekGeriYukleme = { durum: "gecti", tabloAdedi: tables.length, kayitOzeti: createHash("sha256").update(once).digest("hex") };
    console.log("Migration tekrarı ve geçici yedek/geri yükleme kayıt eşitliği geçti.");
    report.durum = "gecti";
  }
} finally {
  if (container) {
    await run("docker", ["stop", "--time", "3", container]);
    console.log("Geçici PostgreSQL durduruldu ve otomatik silindi.");
    report.geciciDbSilindi = true;
  }
  if (yayin && process.env.F02_RELEASE_REPORT) await writeFile(process.env.F02_RELEASE_REPORT, JSON.stringify({ ...report, durum: report.durum === "gecti" ? "gecti" : "basarisiz", bitis: new Date().toISOString() }, null, 2) + "\n");
  if (crmHttp) await writeFile(`${dirname(crmDist)}/kabul-ozeti.json`, JSON.stringify({ ...report, durum: report.durum === "gecti" ? "gecti" : "basarisiz", bitis: new Date().toISOString() }, null, 2) + "\n");
}
