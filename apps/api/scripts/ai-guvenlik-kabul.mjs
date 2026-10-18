import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * AI-57: e-posta → teklif hattının güvenlik kabulü. Canlı bağlantı ayarı
 * okunmaz; her koşu kendi boş PostgreSQL kabını açar, göçleri uygular,
 * testleri RLS'e tabi `tekir_app` rolüyle çalıştırır ve kabı her durumda siler.
 *   node scripts/ai-guvenlik-kabul.mjs
 */
const nonce = randomBytes(8).toString("hex");
const database = `ai_guvenlik_${nonce}`, password = randomBytes(24).toString("hex");
let container;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: new URL("../", import.meta.url), timeout: 180000, ...options, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => { output += d; if (options.yansit) process.stdout.write(d); });
    child.stderr.on("data", (d) => { output += d; if (options.yansit) process.stderr.write(d); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} exit ${code}: ${output.replaceAll(password, "[redacted]").slice(-6000)}`)));
    child.stdin.end(options.input);
  });
}

let basarili = false;
try {
  container = await run("docker", ["run", "--pull=never", "--rm", "-d", "--name", `tekir-ai-guvenlik-${nonce}`, "--label", "tekirextra.test=ai-guvenlik", "--memory=512m", "--tmpfs", "/var/lib/postgresql/data:rw,size=512m", "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=tekir", "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${database}`, "postgres:16-alpine"]);
  const deadline = Date.now() + 30000;
  for (;;) {
    try { await run("docker", ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "tekir", "-d", database]); break; }
    catch (e) { if (Date.now() > deadline) throw e; await new Promise((r) => setTimeout(r, 200)); }
  }
  await run("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "tekir", "-d", database], { input: `CREATE ROLE tekir_app LOGIN PASSWORD '${password}'; CREATE ROLE tekir_platform LOGIN PASSWORD '${password}'; ALTER DATABASE ${database} SET tekir.ai_guvenlik_nonce = '${nonce}';` });
  const port = (await run("docker", ["port", container, "5432/tcp"])).split(":").at(-1).trim();
  if (!/^\d+$/.test(port)) throw new Error("Geçici PostgreSQL portu doğrulanamadı.");
  const base = `127.0.0.1:${port}/${database}`;
  await run("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: `postgresql://tekir:${password}@${base}`, DATABASE_URL_MIGRATE: `postgresql://tekir:${password}@${base}` } });
  console.log("Geçici PostgreSQL hazır; göçler uygulandı. Güvenlik testleri tekir_app rolüyle çalışıyor.");
  await run("pnpm", ["exec", "vitest", "run", "--config", "vitest.ai-guvenlik.config.ts"], {
    timeout: 300000, yansit: true,
    env: {
      ...process.env,
      NODE_PATH: [fileURLToPath(new URL("../node_modules", import.meta.url)), process.env.NODE_PATH].filter(Boolean).join(delimiter),
      AI_GUVENLIK_DB_URL: `postgresql://tekir_app:${password}@${base}?connection_limit=8`,
      AI_GUVENLIK_PLATFORM_URL: `postgresql://tekir_platform:${password}@${base}?connection_limit=2`,
      AI_GUVENLIK_NONCE: nonce,
      // Canlı sağlayıcıya düşülmesin.
      AI_PROVIDER: "", GEMINI_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "",
    },
  });
  basarili = true;
} finally {
  if (container) await run("docker", ["rm", "-f", container]).catch(() => undefined);
  console.log(`Geçici veritabanı silindi. Sonuç: ${basarili ? "GEÇTİ" : "BAŞARISIZ"}`);
}
if (!basarili) process.exit(1);
