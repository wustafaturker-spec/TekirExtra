import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { delimiter } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

// Canlı DB adresi kullanılmaz. Her koşu kendi boş PostgreSQL konteynerini açar;
// Prisma CLI .env yüklese bile bağlantı URL’leri geçici DB ile zorunlu olarak değiştirilir.
const nonce = randomBytes(8).toString("hex");
const cekirdek = process.argv.includes("--cekirdek");
const yayin = process.argv.includes("--f02-yayin") || cekirdek;
const f04Kilit = process.argv.includes("--f04-kilit-prova");
const f04Ileri = process.argv.includes("--f04-ileri-prova") || f04Kilit;
const f04WorkerKurtarma = process.argv.includes("--f04-worker-kurtarma-prova");
const f04EbelgeRezervasyon = process.argv.includes("--f04-ebelge-rezervasyon-prova");
const f04KorumaliWorker = process.argv.includes("--f04-korumali-worker-prova");
const f04EbelgeAktif = process.argv.includes("--f04-ebelge-aktif-prova");
const f04EbelgeDevir = process.argv.includes("--f04-ebelge-devir-prova") || f04EbelgeAktif;
const f04AktifWorkerDevir = process.argv.includes("--f04-aktif-worker-devir-prova") || f04WorkerKurtarma;
const f04GenelWorkerDevir = process.argv.includes("--f04-genel-worker-devir-prova") || f04AktifWorkerDevir || f04EbelgeDevir || f04KorumaliWorker;
const f04TamGeri = process.argv.includes("--f04-tam-geri-prova") || f04GenelWorkerDevir;
const f04WorkerDevir = process.argv.includes("--f04-worker-devir-prova");
const f04OzelWorker = process.argv.includes("--f04-ozel-worker-prova") || f04WorkerDevir;
const f04BirlesikGecis = process.argv.includes("--f04-birlesik-gecis-prova");
const f04KorumaliServis = process.argv.includes("--f04-korumali-servis-gecis-prova") || f04BirlesikGecis;
const f04ServisGecis = process.argv.includes("--f04-servis-gecis-prova") || f04KorumaliServis;
const f04Prova = process.argv.includes("--f04-prova") || f04TamGeri || f04OzelWorker || f04ServisGecis || f04EbelgeRezervasyon;
if (f04Ileri && f04Prova) throw new Error("İleri geçiş ve restore provalarını ayrı çalıştırın");
const f04Http = process.argv.includes("--f04-http") || f04Prova || f04Ileri;
const f04 = process.argv.includes("--f04") || f04Http;
if (f04Http) process.env.OTURUM_ISARETI_SECRET ??= randomBytes(32).toString("hex");
const crmHttp = process.argv.includes("--f03-http") || cekirdek;
// API giriş çerezi ile standalone web koruması aynı izole anahtarı kullanmalı.
// Gerçek ortam dosyası okunmaz; alt test süreçlerine rastgele anahtar aktarılır.
if (crmHttp) process.env.OTURUM_ISARETI_SECRET ??= randomBytes(32).toString("hex");
const crmDist = cekirdek ? process.env.F02_API_DIST : process.env.F03_API_DIST ?? fileURLToPath(new URL("../../../.release-candidates/f03-http-20261018/api", import.meta.url));
if (yayin && !process.env.F02_API_DIST) throw new Error("Yayın provası için F02_API_DIST gerekli");
const config = f04Http ? "vitest.ihtiyac-http.config.ts" : f04 ? "vitest.ihtiyac.config.ts" : cekirdek ? "vitest.cekirdek.config.ts" : crmHttp ? "vitest.crm-http.config.ts" : process.argv.includes("--f03") ? "vitest.crm-belge.config.ts" : yayin ? "vitest.f02-yayin.config.ts" : process.argv.includes("--f02") ? "vitest.odeme-sozu.config.ts" : "vitest.maliyet-yaris.config.ts";
const report = { surum: 1, baslangic: new Date().toISOString(), durum: "baslamadi", geciciDbSilindi: false, gercekSirketPilotu: false };
if (yayin) {
  const { adayiDogrula } = await import("../../../scripts/f02-aday-dogrula.mjs");
  report.aday = await adayiDogrula(dirname(process.env.F02_API_DIST));
}
const database = `f01_yaris_${nonce}`, password = randomBytes(24).toString("hex");
const f04Evidence = resolve(fileURLToPath(new URL("../", import.meta.url)), process.env.F04_HTTP_EVIDENCE ?? "../../.release-candidates/f04-http-20261022");
let container;
async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: new URL("../", import.meta.url), timeout: f04 ? 600000 : 180000, ...options, stdio: ["pipe", "pipe", "pipe"] });
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
  if (f04Http) {
    if (!process.env.F04_API_DIST || !process.env.F04_WEB_ROOT) throw new Error("F04_API_DIST ve F04_WEB_ROOT hazır paket yolları gerekli");
    if (f04Prova && !process.env.F04_ESKI_API_DIST) throw new Error("F04_ESKI_API_DIST eski derlenmiş önizleme paketi gerekli");
    if (f04EbelgeRezervasyon && !process.env.F04_REZERV_API_DIST) throw new Error("F04_REZERV_API_DIST güncel rezervasyon düzeltmesi derlemesi gerekli");
    await mkdir(f04Evidence, { recursive: true });
  }
  if(f04ServisGecis){
    const {webPaketiniKonteynerdeDogrula}=await import('./f04-servis-gecis-prova.mjs');
    report.webAgsizKabul=await webPaketiniKonteynerdeDogrula({run,nonce,evidence:f04Evidence});
  }
  if (crmHttp && !cekirdek) {
    await mkdir(dirname(crmDist), { recursive: true });
    await run(process.execPath, ["--max-old-space-size=4096", "node_modules/typescript/bin/tsc", "-p", "tsconfig.crm-http.json", "--outDir", crmDist]);
    console.log("F03 odaklı API derlemesi hazır; üretim servisi başlatılmadı.");
  }
  container = await run("docker", ["run", "--pull=never", "--rm", "-d", "--name", `tekir-f01-yaris-${nonce}`, "--label", "tekirextra.test=f01-yaris", "--memory=512m", "--tmpfs", "/var/lib/postgresql/data:rw,size=512m", "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=tekir", "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${database}`, "postgres:16-alpine"]);
  const deadline = Date.now() + (f04 ? 180000 : 30000);
  for (;;) {
    try { await run("docker", ["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "tekir", "-d", database]); break; }
    catch (e) { if (Date.now() > deadline) throw e; await new Promise((r) => setTimeout(r, 200)); }
  }
  await run("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "tekir", "-d", database], { input: `CREATE ROLE tekir_app LOGIN PASSWORD '${password}'; CREATE ROLE tekir_platform LOGIN PASSWORD '${password}'; ALTER DATABASE ${database} SET tekir.f01_yaris_nonce = '${nonce}';` });
  const port = (await run("docker", ["port", container, "5432/tcp"])).split(":").at(-1).trim();
  if (!/^\d+$/.test(port)) throw new Error("Geçici PostgreSQL portu doğrulanamadı.");
  const base = `127.0.0.1:${port}/${database}`;
  if (f04Ileri) {
    const {ileriGecisiProvaEt} = await import("./f04-ileri-prova.mjs");
    report.ileriGecis = await ileriGecisiProvaEt({run,sql:input=>run("docker",["exec","-i",container,"psql","-v","ON_ERROR_STOP=1","-At","-h","127.0.0.1","-U","tekir","-d",database],{input}),
      migrationEnv:{...process.env,DATABASE_URL:`postgresql://tekir:${password}@${base}`,DATABASE_URL_MIGRATE:`postgresql://tekir:${password}@${base}`},
      testEnv:{...process.env,NODE_PATH:[fileURLToPath(new URL("../node_modules",import.meta.url)),process.env.NODE_PATH].filter(Boolean).join(delimiter),F01_YARIS_DB_URL:`postgresql://tekir_app:${password}@${base}?connection_limit=6`,F01_YARIS_NONCE:nonce},
      prismaRoot:fileURLToPath(new URL("../prisma",import.meta.url)),evidence:f04Evidence,kilitProva:f04Kilit});
  } else {
  await run("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: `postgresql://tekir:${password}@${base}`, DATABASE_URL_MIGRATE: `postgresql://tekir:${password}@${base}` } });
  }
  if (yayin || f04Prova) {
    await run("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: `postgresql://tekir:${password}@${base}`, DATABASE_URL_MIGRATE: `postgresql://tekir:${password}@${base}` } });
    report.migrationTekrari = "gecti";
  }
  console.log("Geçici PostgreSQL hazır; migration'lar uygulandı. Yarış testleri uygulama rolüyle çalışıyor.");
  const output = await run("pnpm", ["exec", "vitest", "run", "--config", config], {
    timeout: (cekirdek || crmHttp || f04Http) ? 600000 : 180000,
    env: { ...process.env, ...(crmHttp ? { F03_API_DIST: crmDist } : {}), ...(cekirdek ? { F03_WEB_ROOT: `${dirname(crmDist)}/web/apps/web` } : {}), NODE_PATH: [fileURLToPath(new URL("../node_modules", import.meta.url)), process.env.NODE_PATH].filter(Boolean).join(delimiter), F01_YARIS_DB_URL: `postgresql://tekir_app:${password}@${base}?connection_limit=6`, F01_YARIS_NONCE: nonce },
  });
  console.log(output.replaceAll(password, "[redacted]"));
  if (f04Http) {
    report.testAdedi = Number(output.match(/Tests\s+(\d+) passed/)?.[1] ?? 0);
    if (!report.testAdedi) throw new Error("F04 HTTP kabul test sayısı doğrulanamadı");
    report.durum = "gecti";
    report.kabulLogOzeti = createHash("sha256").update(output).digest("hex");
    await writeFile(`${f04Evidence}/http-kabul.log`, output.replaceAll(password, "[redacted]") + "\n");
  }
  if (f04Prova) {
    // Bu DB yalnız bu koşumun konteynerinde vardır. Canlı adres veya dump dosyası kabul edilmez.
    report.durum = "prova_suruyor";
    const sql = (db, input) => run("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-h", "127.0.0.1", "-U", "tekir", "-d", db], { input });
    const tablolar = (await sql(database, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).split("\n").filter(Boolean);
    if (!tablolar.length || tablolar.some(t => !/^[a-z_][a-z0-9_]*$/.test(t))) throw new Error("Prova tablo kapsamı doğrulanamadı");
    const fingerprints = tablolar.map(t => `SELECT '${t}' AS tablo,count(*)::text AS adet,md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) AS ozet FROM public."${t}" x`).join(" UNION ALL ");
    const fingerprint = db => sql(db, `SELECT * FROM (${fingerprints}) q ORDER BY tablo`);
    const once = await fingerprint(database);
    // Dolu veritabanında deploy tekrarı mevcut iş satırlarını değiştirmemeli.
    const migrationLog = await run("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: `postgresql://tekir:${password}@${base}`, DATABASE_URL_MIGRATE: `postgresql://tekir:${password}@${base}` } });
    if (once !== await fingerprint(database)) throw new Error("Dolu DB migration tekrarı satırları değiştirdi");
    await writeFile(`${f04Evidence}/migration-tekrar.log`, migrationLog.replaceAll(password, "[redacted]") + "\n");
    report.doluDbMigrationTekrari = "gecti";
    const [tenantId,planId,talepId,userId] = (await sql(database, "SELECT tenant_id,plan_id,talep_id,user_id FROM ihtiyac_satin_alma_baglari ORDER BY created_at,plan_id LIMIT 1")).split("|");
    if (![tenantId,planId,talepId,userId].every(v => /^[a-f0-9-]{36}$/.test(v ?? ""))) throw new Error("Restore için kayıtlı plan/talep fixture'ı bulunamadı");
    const modFixture = JSON.parse(await readFile(`${f04Evidence}/mod-kabul-ozeti.json`, "utf8")).restoreFixture;
    if (!modFixture || ![modFixture.tenantId,modFixture.userId,modFixture.planId].every(v => /^[a-f0-9-]{36}$/.test(v ?? ""))) throw new Error("Restore için şirket modu fixture'ı bulunamadı");
    const dump = await run("docker", ["exec", container, "pg_dump", "-h", "127.0.0.1", "-U", "tekir", "-d", database, "-Fc", "--no-owner"], { binary: true });
    const restoreDb = `f01_yaris_${randomBytes(8).toString("hex")}`;
    await sql(database, `CREATE DATABASE ${restoreDb}; ALTER DATABASE ${restoreDb} SET tekir.f01_yaris_nonce = '${nonce}';`);
    await run("docker", ["exec", "-i", container, "pg_restore", "--exit-on-error", "--no-owner", "-h", "127.0.0.1", "-U", "tekir", "-d", restoreDb], { input: dump });
    const sonra = await fingerprint(restoreDb);
    if (once !== sonra) throw new Error("F04 restore sonrasında tablo içerikleri farklı");
    const restoreBase = `127.0.0.1:${port}/${restoreDb}`;
    const restoreOutput = await run("pnpm", ["exec", "vitest", "run", "--config", "vitest.ihtiyac-gecis.config.ts"], {timeout:180000,env:{...process.env,NODE_PATH:[fileURLToPath(new URL("../node_modules",import.meta.url)),process.env.NODE_PATH].filter(Boolean).join(delimiter),F01_YARIS_DB_URL:`postgresql://tekir_app:${password}@${restoreBase}?connection_limit=6`,F01_YARIS_NONCE:nonce,F04_PROVA_TENANT_ID:tenantId,F04_PROVA_PLAN_ID:planId,F04_PROVA_TALEP_ID:talepId,F04_PROVA_USER_ID:userId,F04_PROVA_MOD_FIXTURE:JSON.stringify(modFixture)}});
    const restoreTestAdedi = Number(restoreOutput.match(/Tests\s+(\d+) passed/)?.[1] ?? 0);
    if (!restoreTestAdedi) throw new Error("Restore/geri dönüş test sonucu doğrulanamadı");
    // İşlevsel kontroller de hiçbir tabloyu değiştirmemeli; audit dahil bütün public tablolar karşılaştırılır.
    if (sonra !== await fingerprint(restoreDb)) throw new Error("Restore işlevsel kontrolleri kayıtları değiştirdi");
    await writeFile(`${f04Evidence}/restore-kabul.log`, restoreOutput.replaceAll(password,"[redacted]") + "\n");
    console.log(restoreOutput.replaceAll(password,"[redacted]"));
    report.yedekGeriYukleme={durum:"gecti",tabloAdedi:tablolar.length,kayitOzeti:createHash("sha256").update(once).digest("hex"),dumpSha256:createHash("sha256").update(dump).digest("hex"),dumpDiskeYazildi:false,restoreTestAdedi};
    report.geriDonusKapsami="19 Ekim derlenmiş anlık ihtiyaç controller/servisi; tam uygulama veya eski web değil";
    if(f04EbelgeRezervasyon){
      const tables=['siparis_giris_tarihleri','ihtiyac_uretim_talepleri','ihtiyac_planlari','ihtiyac_karsilama_baglari','ihtiyac_satin_alma_baglari'];
      const query=tables.map(t=>`SELECT '${t}',count(*)::text,md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) FROM public."${t}" x`).join(' UNION ALL ')+" UNION ALL SELECT 'f04_ayar',count(*)::text,md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) FROM modul_ayarlari x WHERE modul='stok_ihtiyac_plani' UNION ALL SELECT 'f04_audit',count(*)::text,md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) FROM audit_log x WHERE islem LIKE 'ihtiyac_%' ORDER BY 1";
      const before=await sql(restoreDb,query);
      const log=await run('pnpm',['exec','vitest','run','--config','vitest.ebelge-rezervasyon.config.ts'],{timeout:240000,env:{...process.env,NODE_PATH:[fileURLToPath(new URL('../node_modules',import.meta.url)),process.env.NODE_PATH].filter(Boolean).join(delimiter),F01_YARIS_DB_URL:`postgresql://tekir_app:${password}@${restoreBase}?connection_limit=6`,F01_YARIS_NONCE:nonce}});
      const tests=Number(log.match(/Tests\s+(\d+) passed/)?.[1]??0);if(tests!==6)throw Error('E-belge rezervasyon kabulü altı test bekliyor');
      if(await sql(restoreDb,query)!==before)throw Error('E-belge rezervasyon provası F04 kayıtlarını değiştirdi');
      await writeFile(`${f04Evidence}/ebelge-rezervasyon-kabul.log`,log.replaceAll(password,'[redacted]')+'\n');console.log(log.replaceAll(password,'[redacted]'));
      report.ebelgeRezervasyon={durum:'gecti',testAdedi:tests,gercekSaglayici:false,tamWorkerKabulDegil:true,f04KayitOzeti:createHash('sha256').update(before).digest('hex')};
    }
    if(f04TamGeri){
      const {tamPaketiProvaEt}=await import('./f04-tam-geri-prova.mjs');
      report.tamPaket=await tamPaketiProvaEt({run,sql,container,database:restoreDb,password,nonce,base:restoreBase,evidence:f04Evidence,devir:f04GenelWorkerDevir,aktifDevir:f04AktifWorkerDevir,kurtarma:f04WorkerKurtarma,ebelgeDevir:f04EbelgeDevir,ebelgeAktif:f04EbelgeAktif,korumali:f04KorumaliWorker});
      report.geriDonusKapsami='19 Ekim tam API + genel worker + standalone web; izole yeni şema uyumu, gerçek servis geçişi değil';
      if(f04GenelWorkerDevir)report.geriDonusKapsami+='; ortak Redis üzerinde eski-güncel-eski genel worker devri ve bekleyen personel işi';
      if(f04AktifWorkerDevir)report.geriDonusKapsami+='; bir personelli aktif işte SIGTERM, DB kilidi açıldıktan sonra tamamlanma ve bordro korunumu';
      if(f04WorkerKurtarma)report.geriDonusKapsami+='; kısmen commit edilmiş personel işinde iki yönlü SIGKILL ve doğal kilit süresiyle stalled kurtarma';
      if(f04EbelgeDevir)report.geriDonusKapsami+='; sağlayıcısız e-belge kuyruğunda eski-güncel-eski devir, yerel ret, dead-letter ve tenant sınırı';
      if(f04EbelgeAktif)report.geriDonusKapsami+='; aktif e-belge sorgusunda iki sürümde SIGTERM ve yerel gönderim reddinde iki yönlü doğal stalled kurtarma';
      if(f04KorumaliWorker)report.geriDonusKapsami+='; korumalı güncel tam worker, gerçek Sovos adaptörü/internal SOAP ve e-belge kuyruğu pause edilerek eskiye dönüş';
    }

    if(f04OzelWorker){
      const {ozelWorkeriProvaEt}=await import('./f04-ozel-worker-prova.mjs');
      report.ozelWorker=await ozelWorkeriProvaEt({run,sql,container,database:restoreDb,password,nonce,base:restoreBase,evidence:f04Evidence,devir:f04WorkerDevir});
      report.geriDonusKapsami+='; 19 Ekim özel ödeme sözü workerı gerçek SMTP fixture ve yeni şemada sınandı';
      if(f04WorkerDevir)report.geriDonusKapsami+='; durdurma doğrulanarak eski-güncel-eski özel worker devri';
    }
    if(f04ServisGecis){
      const {servisGecisiniProvaEt}=await import('./f04-servis-gecis-prova.mjs');
      report.servisGecisi=await servisGecisiniProvaEt({run,sql,container,database:restoreDb,password,nonce,base:restoreBase,evidence:f04Evidence,korumali:f04KorumaliServis,birlesik:f04BirlesikGecis});
      report.geriDonusKapsami+='; izole aynı giriş noktasında yeni-eski-yeni API/web servis ve trafik geçişi';
      if(f04KorumaliServis)report.geriDonusKapsami+='; korumalı yeni API paketi ve Redis pause/aktif sıfır eski trafik kapısı';
      if(f04BirlesikGecis)report.geriDonusKapsami+='; aynı ağ/DB/Redis üzerinde kontrollü gerçek worker ve HTTP devri, güncele dönüşte bekleyen işin tek sonuca ulaşması';
    }
    report.durum="gecti";
    console.log("F04 dolu DB migration tekrarı, tüm tabloların yedek/restore eşitliği ve eski önizleme API kontrolü geçti.");
  }
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
  if (f04Http) {
    await mkdir(f04Evidence, { recursive: true });
    await writeFile(`${f04Evidence}/kabul-ozeti.json`, JSON.stringify({ ...report, durum: report.durum === "gecti" ? "gecti" : "basarisiz", bitis: new Date().toISOString() }, null, 2) + "\n");
  }
  if (yayin && process.env.F02_RELEASE_REPORT) await writeFile(process.env.F02_RELEASE_REPORT, JSON.stringify({ ...report, durum: report.durum === "gecti" ? "gecti" : "basarisiz", bitis: new Date().toISOString() }, null, 2) + "\n");
  if (crmHttp) await writeFile(`${dirname(crmDist)}/kabul-ozeti.json`, JSON.stringify({ ...report, durum: report.durum === "gecti" ? "gecti" : "basarisiz", bitis: new Date().toISOString() }, null, 2) + "\n");
}
