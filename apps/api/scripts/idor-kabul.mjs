import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Kiracılar arası erişim (IDOR) taraması. Derlenmiş API paketi, internete çıkışı
 * olmayan ayrı bir Docker ağında, geçici PostgreSQL ve Redis ile çalışır; canlı
 * bağlantı ayarı okunmaz, ortam değişkenleri tek tek verilir. Sonunda her şey silinir.
 *   node scripts/idor-kabul.mjs <derlenmiş-runtime-dizini> <rapor-dizini>
 */
const [runtimeArg, raporArg] = process.argv.slice(2);
if (!runtimeArg || !raporArg) { console.error("Kullanım: node scripts/idor-kabul.mjs <runtime> <rapor-dizini>"); process.exit(2); }
const runtime = resolve(runtimeArg), rapor = resolve(raporArg);
mkdirSync(rapor, { recursive: true });
const IMAJ = process.env.IDOR_IMAJ ?? "tekirextra-pilot-runtime:20261101";
const nonce = randomBytes(6).toString("hex"), database = `idor_${nonce}`, parola = randomBytes(24).toString("hex");
const ag = `tekir-idor-${nonce}`, pg = `tekir-idor-pg-${nonce}`, redis = `tekir-idor-redis-${nonce}`, api = `tekir-idor-api-${nonce}`;
const hex = (n) => randomBytes(n).toString("hex");
const jwt = hex(32), platformJwt = hex(32);
const baglantiAnahtari = hex(32);
const kapsam = fileURLToPath(new URL("./idor", import.meta.url));

function calistir(komut, args, secenek = {}) {
  return new Promise((ok, red) => {
    const c = spawn(komut, args, { cwd: fileURLToPath(new URL("../", import.meta.url)), ...secenek, stdio: ["pipe", "pipe", "pipe"] });
    let cikti = "";
    const yaz = (d, akis) => { cikti += d; if (secenek.yansit) akis.write(d); };
    c.stdout.on("data", (d) => yaz(d, process.stdout));
    c.stderr.on("data", (d) => yaz(d, process.stderr));
    c.on("error", red);
    c.on("close", (k) => (k === 0 ? ok(cikti.trim()) : red(new Error(`${komut} ${args[0]} çıkış ${k}: ${cikti.replaceAll(parola, "[gizli]").slice(-3000)}`))));
    c.stdin.end(secenek.girdi);
  });
}
const docker = (...a) => calistir("docker", a);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

const ortakEnv = (e) => Object.entries(e).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
const ETIKET = ["--label", "tekirextra.test=idor"];

let basarili = false;
try {
  await docker("network", "create", "--internal", ...ETIKET, ag);
  await docker("run", "--pull=never", "--rm", "-d", "--name", pg, ...ETIKET, "--memory=1g", "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=tekir", "-e", `POSTGRES_PASSWORD=${parola}`, "-e", `POSTGRES_DB=${database}`, "postgres:16-alpine");
  await docker("network", "connect", "--alias", "pg", ag, pg);
  await docker("run", "--pull=never", "--rm", "-d", "--name", redis, ...ETIKET, "--memory=256m", "--network", ag, "--network-alias", "redis", "redis:7-alpine");
  for (const son = Date.now() + 40000; ; ) {
    try { await docker("exec", pg, "psql", "-h", "127.0.0.1", "-U", "tekir", "-d", database, "-c", "select 1"); break; }
    catch (e) { if (Date.now() > son) throw e; await bekle(300); }
  }
  await calistir("docker", ["exec", "-i", pg, "psql", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "tekir", "-d", database], { girdi: `CREATE ROLE tekir_app LOGIN PASSWORD '${parola}'; CREATE ROLE tekir_platform LOGIN PASSWORD '${parola}';` });
  const port = (await docker("port", pg, "5432/tcp")).split(":").at(-1).trim();
  if (!/^\d+$/.test(port)) throw new Error("Geçici PostgreSQL portu doğrulanamadı");
  const dis = `postgresql://tekir:${parola}@127.0.0.1:${port}/${database}`;
  await calistir("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: dis, DATABASE_URL_MIGRATE: dis } });
  console.log("Geçici veritabanı hazır; göçler uygulandı.");

  const ic = (rol) => `postgresql://${rol}:${parola}@pg:5432/${database}`;
  await docker("run", "--pull=never", "--rm", "-d", "--name", api, ...ETIKET, "--memory=1500m", "--network", ag, "--network-alias", "api", "--read-only", "--tmpfs", "/tmp:rw,size=256m",
    "-v", `${runtime}:/runtime:ro`, "-v", `${kapsam}:/idor:ro`, "-w", "/runtime", "--entrypoint", "node",
    ...ortakEnv({
      NODE_ENV: "production", NODE_PATH: "", PORT: "3001", TEKIR_WORKER: "0", TRUST_PROXY: "",
      DATABASE_URL: `${ic("tekir_app")}?connection_limit=16`, DATABASE_URL_MIGRATE: ic("tekir"), DATABASE_URL_PLATFORM: `${ic("tekir_platform")}?connection_limit=2`,
      REDIS_URL: "redis://redis:6379", JWT_SECRET: jwt, PLATFORM_JWT_SECRET: platformJwt, OTURUM_ISARETI_SECRET: hex(32), BAGLANTI_SIFRELEME_ANAHTARI: baglantiAnahtari,
      APP_URL: "http://web.invalid", SMTP_HOST: "smtp.invalid", SMTP_PORT: "25", MAIL_FROM: "idor@ornek.invalid", RATE_LIMIT_MAX: "100000000", S3_GIZLI_ANAHTAR: hex(24), METRICS_TOKEN: hex(16),
    }),
    IMAJ, "-r", "/idor/zod-kayit.cjs", "apps/api/dist/main.js");
  await docker("run", "--pull=never", "--rm", "--name", `tekir-idor-bekle-${nonce}`, ...ETIKET, "--network", ag, "--entrypoint", "node", IMAJ, "-e",
    "(async()=>{const s=Date.now()+120000;for(;;){try{const r=await fetch('http://api:3001/health/ready');if(r.ok)return}catch{}if(Date.now()>s)process.exit(1);await new Promise(r=>setTimeout(r,500))}})()");
  const gunluk = await docker("logs", api);
  const rotalar = [...gunluk.matchAll(/Mapped \{([^,]+), (\w+)\} route/g)].map((m) => ({ yol: m[1], yontem: m[2] }));
  if (rotalar.length < 100) throw new Error(`Rota listesi okunamadı (${rotalar.length}):\n${gunluk.slice(-2000)}`);
  writeFileSync(resolve(rapor, "rotalar.json"), JSON.stringify(rotalar));
  console.log(`API hazır; ${rotalar.length} rota. Tarama başlıyor.`);
  // Canlı model denemesi: yalnız API dışarı çıkabilir; SMTP ve entegratör sahte olduğundan gönderim gerçekleşmez.
  if (process.env.IDOR_ASAMA === "pi") await docker("network", "connect", "bridge", api);

  await calistir("docker", ["run", "--pull=never", "--rm", "--name", `tekir-idor-tara-${nonce}`, ...ETIKET, "--memory=1500m", "--network", ag,
    "-v", `${runtime}:/runtime:ro`, "-v", `${kapsam}:/idor:ro`, "-v", `${rapor}:/rapor`, "--user", `${process.getuid()}:${process.getgid()}`, "--entrypoint", "node",
    ...ortakEnv({ NODE_PATH: "/runtime/apps/api/node_modules", SUPER_URL: ic("tekir"), DATABASE_URL: ic("tekir"), API: "http://api:3001", JWT_SECRET: jwt, BAGLANTI_SIFRELEME_ANAHTARI: baglantiAnahtari, IDOR_LLM: process.env.IDOR_LLM ?? "{}", PI_ATLA: process.env.PI_ATLA ?? "", RAPOR: "/rapor", IDOR_ASAMA: process.env.IDOR_ASAMA ?? "tum", IDOR_MODULLER: "stok_ihtiyac_plani,maliyet_kontrolu" }),
    IMAJ, process.env.IDOR_ASAMA === "pi" ? "/idor/pi.cjs" : process.env.IDOR_ASAMA?.startsWith("rol") ? "/idor/rol.cjs" : "/idor/tara.cjs"], { yansit: true });
  writeFileSync(resolve(rapor, "api-gunluk.txt"), (await docker("logs", "--tail", "4000", api).catch(() => "")).replaceAll(parola, "[gizli]"));
  basarili = true;
} finally {
  for (const c of [api, redis, pg]) await docker("rm", "-f", c).catch(() => undefined);
  await docker("network", "rm", ag).catch(() => undefined);
  console.log(`Geçici kaplar silindi. Sonuç: ${basarili ? "TAMAMLANDI" : "BAŞARISIZ"}`);
}
if (!basarili) process.exit(1);
