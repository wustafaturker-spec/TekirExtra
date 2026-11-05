import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Firma takip migration'ı ve kabulü için tek kullanımlık PostgreSQL. Mevcut DB'ye dokunmaz. */
const cwd = fileURLToPath(new URL("../", import.meta.url));
const ad = `tekir-firma-kabul-${randomBytes(6).toString("hex")}`;
const parola = randomBytes(24).toString("hex");
function run(cmd, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error(`${cmd} ${args[0]} (${code}): ${out.replaceAll(parola, "[gizli]").slice(-60000)}`)));
  });
}
let acildi = false;
let geciciSchema;
const gecisProvasi = process.argv.includes("--abonelik-gecis");
try {
  // Kalıcılık/crash testi yapılmayan tek kullanımlık DB'de her DDL için disk senkronizasyonu bekleme.
  await run("docker", ["run", "--rm", "-d", "--pull=never", "--name", ad, "--label", "tekirextra.test=platform-firma", "--memory=512m", "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=tekir", "-e", `POSTGRES_PASSWORD=${parola}`, "-e", "POSTGRES_DB=firma_kabul", "postgres:16-alpine", "postgres", "-c", "fsync=off", "-c", "synchronous_commit=off"]);
  acildi = true;
  for (const son = Date.now() + 120000; ; ) {
    try { await run("docker", ["exec", ad, "pg_isready", "-h", "127.0.0.1", "-U", "tekir", "-d", "firma_kabul"]); break; }
    catch (e) { if (Date.now() > son) throw e; await new Promise((r) => setTimeout(r, 300)); }
  }
  await run("docker", ["exec", ad, "psql", "-h", "127.0.0.1", "-v", "ON_ERROR_STOP=1", "-U", "tekir", "-d", "firma_kabul", "-c", `CREATE ROLE tekir_app LOGIN PASSWORD '${parola}'; CREATE ROLE tekir_platform LOGIN PASSWORD '${parola}';`]);
  const port = (await run("docker", ["port", ad, "5432/tcp"])).split(":").at(-1).trim();
  if (!/^\d+$/.test(port)) throw new Error("PostgreSQL test portu okunamadı.");
  const adres = (rol) => `postgresql://${rol}:${parola}@127.0.0.1:${port}/firma_kabul?connection_limit=4&connect_timeout=30`;
  const env = { ...process.env, DATABASE_URL: adres("tekir_app"), DATABASE_URL_MIGRATE: adres("tekir"), DATABASE_URL_PLATFORM: adres("tekir_platform") };
  if (gecisProvasi) {
    geciciSchema = await mkdtemp(join(tmpdir(), "tekir-abonelik-gecis-"));
    const kok = join(cwd, "prisma"), hedef = join(geciciSchema, "migrations");
    await mkdir(hedef, { recursive: true });
    const kesim = "20261104050000_abonelik_katalog_bagi";
    await cp(join(kok, "schema.prisma"), join(geciciSchema, "schema.prisma"));
    const dizinler = await readdir(join(kok, "migrations"));
    for (const d of dizinler.filter((d) => d < kesim || d === "migration_lock.toml")) await cp(join(kok, "migrations", d), join(hedef, d), { recursive: true });
    const deploy = () => run("pnpm", ["exec", "prisma", "migrate", "deploy", "--schema", join(geciciSchema, "schema.prisma")], { ...env, DATABASE_URL: adres("tekir") });
    await deploy();
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const planlar = ["baslangic", "profesyonel", "kurumsal", "v1", "kabul_bilinmeyen"];
    const idListesi = ids.map((id) => `'${id}'::uuid`).join(",");
    const sql = (s) => run("docker", ["exec", ad, "psql", "-h", "127.0.0.1", "-v", "ON_ERROR_STOP=1", "-U", "tekir", "-d", "firma_kabul", "-c", s]);
    await sql(ids.map((id, i) => `INSERT INTO tenants(id,unvan,vkn,updated_at) VALUES ('${id}','Geçiş provası ${i}','${String(i + 1).padStart(10, "0")}',now());
      INSERT INTO tenant_abonelikleri(id,tenant_id,plan_kodu,durum,donem_baslangici,donem_sonu,iptal_tarihi,meta,updated_at)
      VALUES (gen_random_uuid(),'${id}','${planlar[i]}','${["aktif","deneme","iptal","askida","aktif"][i]}','2026-10-01','2027-02-01',${i === 2 ? "'2026-10-15'" : "NULL"},'{"prova":true}','2026-10-20');`).join("\n") + `
      CREATE TABLE test_abonelik_gecis_oncesi AS SELECT id,to_jsonb(a) AS veri FROM tenant_abonelikleri a WHERE tenant_id IN (${idListesi});
      CREATE TABLE test_gecis_olay_adedi AS SELECT count(*) AS adet FROM platform_firma_yasam_olaylari;
      CREATE TABLE test_gecis_fiyat_toplamlari AS
        SELECT ay,count(*) AS adet,sum((CASE WHEN plan_kodu='baslangic' THEN 399 ELSE 999 END)::numeric*ay) AS matrah,
          sum(round((CASE WHEN plan_kodu='baslangic' THEN 399 ELSE 999 END)::numeric*ay*0.20,2)) AS kdv
        FROM tenant_abonelikleri CROSS JOIN unnest(ARRAY[1,3,6,12]) ay
        WHERE plan_kodu IN ('baslangic','profesyonel','v1') GROUP BY ay;`);
    for (const d of dizinler.filter((d) => d >= kesim && d !== "migration_lock.toml")) await cp(join(kok, "migrations", d), join(hedef, d), { recursive: true });
    await deploy();
    await sql(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM test_abonelik_gecis_oncesi b LEFT JOIN tenant_abonelikleri a ON a.id=b.id WHERE a.id IS NULL OR (to_jsonb(a)-'paket_surum_id'-'paket_kosullari'-'kota_surumu') IS DISTINCT FROM b.veri) THEN RAISE EXCEPTION 'Gecis eski abonelik alanlarini degistirdi'; END IF;
      IF (SELECT count(*) FROM tenant_abonelikleri WHERE tenant_id IN (${idListesi}) AND paket_surum_id IS NOT NULL) <> 4 THEN RAISE EXCEPTION 'Bilinen dort plan baglanmadi'; END IF;
      IF EXISTS (SELECT 1 FROM tenant_abonelikleri WHERE plan_kodu='kabul_bilinmeyen' AND (paket_surum_id IS NOT NULL OR paket_kosullari IS NOT NULL)) THEN RAISE EXCEPTION 'Bilinmeyen plan varsayildi'; END IF;
      IF (SELECT count(*) FROM platform_firma_yasam_olaylari) <> (SELECT adet FROM test_gecis_olay_adedi) THEN RAISE EXCEPTION 'Gecis sahte yasam olayi uretti'; END IF;
      IF EXISTS (
        WITH sonra AS (
          SELECT (d->>'aySayisi')::integer AS ay,count(*) AS adet,sum((d->>'matrah')::numeric) AS matrah,
            sum(round((d->>'matrah')::numeric*(a.paket_kosullari->'fiyatlandirma'->>'kdvOrani')::numeric/100,2)) AS kdv
          FROM tenant_abonelikleri a CROSS JOIN LATERAL jsonb_array_elements(a.paket_kosullari->'fiyatlandirma'->'donemler') d
          WHERE a.plan_kodu IN ('baslangic','profesyonel','v1') GROUP BY (d->>'aySayisi')::integer
        ) SELECT 1 FROM test_gecis_fiyat_toplamlari b FULL JOIN sonra s USING(ay)
          WHERE ROW(b.adet,b.matrah,b.kdv) IS DISTINCT FROM ROW(s.adet,s.matrah,s.kdv)
      ) THEN RAISE EXCEPTION 'Gecis dort donemin toplam fiyatini degistirdi'; END IF;
    END $$;`);
    console.log("Geçiş provası geçti: dört bilinen plan bağlandı; bilinmeyen plan, eski alanlar, dört dönem fiyat toplamları ve yaşam olayları korundu.");
  } else await run("pnpm", ["exec", "prisma", "migrate", "deploy"], { ...env, DATABASE_URL: adres("tekir") });
  console.log("Geçici PostgreSQL'de tüm migration'lar uygulandı.");
  const testler = process.argv.slice(2).filter((g) => g !== "--abonelik-gecis");
  const sonuc = await run("pnpm", ["exec", "vitest", "run", "--config", "vitest.kabul.config.ts", ...(testler.length ? testler : [
    "test/platform-paket-katalogu.kabul.test.ts",
    "test/platform-operasyon-gecmisi.kabul.test.ts", "test/platform-odeme-kapsami.kabul.test.ts",
    "test/platform-kullanim-operasyon.kabul.test.ts",
    "test/platform-buyume.kabul.test.ts",
    "test/platform-istatistik.kabul.test.ts",
    "test/platform-firma-takip.kabul.test.ts", "test/platform-firma-sayfalama.kabul.test.ts", "test/platform-firma.kabul.test.ts",
    "test/platform-gorev-aktarimi.kabul.test.ts", "test/platform-olay-gorunurlugu.kabul.test.ts", "test/rls-kapsama.kabul.test.ts",
  ])], env);
  console.log(sonuc.replaceAll(parola, "[gizli]"));
} catch (e) {
  console.error(String(e).replaceAll(parola, "[gizli]")); process.exitCode = 1;
  if (acildi) {
    try { console.error((await run("docker", ["logs", "--tail", "50", ad])).replaceAll(parola, "[gizli]").slice(-6000)); }
    catch { /* Asıl hata korunur; hazır olmayan konteynerin logu da okunamayabilir. */ }
  }
} finally {
  if (acildi) { await run("docker", ["rm", "-f", ad]); console.log("Geçici PostgreSQL kaldırıldı."); }
  if (geciciSchema) await rm(geciciSchema, { recursive: true, force: true });
}
