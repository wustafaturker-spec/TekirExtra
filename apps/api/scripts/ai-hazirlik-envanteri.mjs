import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { argumanlariCoz, veritabaniAdresiniDogrula, PROFILLER, profilSorgusunuKur, profiliDegerlendir, saltOkunurIslem, rlsEksikleriniBul, platformOzetiniCikar } from "./ai-hazirlik-envanteri.lib.mjs";

export async function metadataOku(db) {
  return saltOkunurIslem(db, null, async (tx) => {
    const [surum] = await tx.$queryRawUnsafe("SELECT current_database() AS veritabani, current_setting('server_version') AS postgres_surumu");
    const [migration] = await tx.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text AS tamamlanan,
      count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::text AS tamamlanmamis,
      max(finished_at) AS son_tamamlanma FROM public._prisma_migrations`);
    const tablolar = await tx.$queryRawUnsafe(`SELECT c.relname AS tablo, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
      (SELECT count(*)::text FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS politika
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) ORDER BY c.relname`);
    if (tablolar.length < 50) throw new Error("KATALOG_KAPSAMI_BEKLENMIYOR");
    const [fk] = await tx.$queryRawUnsafe("SELECT count(*)::text AS dogrulanmamis_fk FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND c.contype = 'f' AND NOT c.convalidated");
    return { ...surum, migration, tenantTabloSayisi: tablolar.length, rlsEksikleri: rlsEksikleriniBul(tablolar), ...fk,
      kapsam: "Yalnız veritabanı katalogları; tenant/ticari kayıtlar taranmadı." };
  });
}

export async function tenantOku(db, tenantId, modeller) {
  return saltOkunurIslem(db, tenantId, async (tx) => {
    const [rol] = await tx.$queryRawUnsafe("SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user");
    if (!rol || rol.rolsuper || rol.rolbypassrls) throw new Error("UYGULAMA_ROLU_GEREKLI");
    if (!await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })) throw new Error("TENANT_BULUNAMADI");
    // API anahtarı/adresi/metin içerikleri seçilmez; yalnız yapılandırma metadata'sı.
    const ai = await tx.tenantAiAyari.findUnique({ where: { tenantId }, select: {
      saglayici: true, modelAdi: true, ekonomikModelAdi: true, gucluModelAdi: true, ozelliklerEtkin: true,
      yurtDisiOnayAt: true, yurtDisiOnaySaglayici: true, yurtDisiOnayModel: true, yurtDisiOnayPolitika: true,
      gunlukCagriSiniri: true, aylikMaliyetButcesiUsd: true,
    } });
    const profiller = [];
    for (const profil of PROFILLER) {
      const sorgu = profilSorgusunuKur(profil, modeller);
      const [sonuc] = await tx.$queryRawUnsafe(sorgu.sql, tenantId);
      const gruplar = sorgu.grupSql ? await tx.$queryRawUnsafe(sorgu.grupSql, tenantId) : [];
      profiller.push({ kod: profil.kod, kapsamFiltresi: profil.ust?.filtre ?? profil.filtre ?? null,
        ...sonuc, gruplar, eksikAlanlar: sorgu.eksikAlanlar,
        durum: profiliDegerlendir(profil, sonuc, sorgu.eksikAlanlar),
        tahminYeterliligi: "Bu sayımlar tahmin/model doğruluğunu kanıtlamaz; süreklilik, gerçekleşen ve etiket denetimi gerekir." });
    }
    return { tenantId, aiAyari: ai, profiller, canliModelTesti: "yapilmadi",
      uyari: "Yalnız boş alan/adet/tarih ve durum kırılımı. Opsiyonel null alan her zaman veri hatası değildir. Parasal tutar, kişi/firma adı, hesap/çek numarası, belge metni ve görsel raporlanmaz." };
  });
}

async function main() {
  const secim = argumanlariCoz(process.argv.slice(2));
  if (secim.mod === "yardim") {
    console.log("node scripts/ai-hazirlik-envanteri.mjs --metadata-only\nnode scripts/ai-hazirlik-envanteri.mjs --tenant-id <ürün sahibi tarafından seçilmiş UUID>\nVarsayılan/all-tenant tarama yoktur. Yalnız tekirextra veritabanı, READ ONLY transaction, JSON stdout; dosya veya ERP verisi yazılmaz.");
    return;
  }
  const envDosyasi = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(envDosyasi)) process.loadEnvFile(envDosyasi);
  // Metadata yönetim bağlantısıyla; iş profili yalnız RLS uygulama bağlantısıyla okunur.
  const appUrl = veritabaniAdresiniDogrula(process.env.DATABASE_URL);
  const adres = secim.mod === "metadata" ? veritabaniAdresiniDogrula(process.env.DATABASE_URL_MIGRATE ?? appUrl) : appUrl;
  const db = new PrismaClient({ datasourceUrl: adres });
  try {
    const rapor = secim.mod === "metadata" ? await metadataOku(db) : await tenantOku(db, secim.tenantId, Prisma.dmmf.datamodel.models);
    console.log(JSON.stringify({ olusturulduAt: new Date().toISOString(), mod: secim.mod, platformCli: platformOzetiniCikar(process.env), ...rapor },
      (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((hata) => {
    // Prisma hata metni bağlantı/kayıt içeriği taşıyabilir; raw message/stack yazılmaz.
    const guvenli = ["KAPSAM_GECERSIZ", "VERITABANI_KAPSAMI_GECERSIZ", "KATALOG_KAPSAMI_BEKLENMIYOR", "UYGULAMA_ROLU_GEREKLI", "TENANT_BULUNAMADI"];
    console.error(JSON.stringify({ durum: "hata", sinif: guvenli.includes(hata?.message) ? hata.message : "ENVANTER_OKUNAMADI",
      nedenKodu: typeof hata?.code === "string" && /^[A-Z0-9]{1,12}$/.test(hata.code) ? hata.code : null }));
    process.exitCode = 1;
  });
}
