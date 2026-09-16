/**
 * Satın alma (SAT) akışını yerelde denemek için demo kiracıya test verisi kurar:
 * talep açan/onaylayan kullanıcılar, departman, depo, stok ve hizmet kartları,
 * tedarikçiler ve onaylı bir bütçe. Yeniden çalıştırılabilir — var olanı bırakır.
 *
 * Çalıştırma: apps/api içinden `pnpm seed:satin-alma`
 * (şema sahibi bağlantısını kullanır, RLS'e takılmaz).
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_MIGRATE ?? "postgresql://tekir:tekir@localhost:5433/tekirextra" } },
});

const PAROLA = "Tekir2026x";
const YIL = new Date().getFullYear();
/** Demo kiracının VKN'si; test verisi yalnız bu kiracıya yazılır. */
const DEMO_VKN = "1234567801";

async function kullanici(tenantId: string, eposta: string, adSoyad: string, rol: "yonetici" | "muhasebe" | "depo") {
  const mevcut = await prisma.user.findFirst({ where: { tenantId, eposta } });
  if (mevcut) return mevcut;
  const user = await prisma.user.create({
    data: { tenantId, eposta, adSoyad, rol, parolaHash: await argon2.hash(PAROLA), epostaDogrulandi: true },
  });
  // Kimlik tablosu yalnız e-postayı kiracıya eşler; parola kullanıcı kaydındadır.
  await prisma.authKimlik.create({ data: { userId: user.id, tenantId, eposta } });
  return user;
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { vkn: DEMO_VKN } });
  if (!tenant) throw new Error(`VKN ${DEMO_VKN} olan demo kiracı bulunamadı; önce create-demo-user.ts çalıştırın`);
  const tenantId = tenant.id;
  console.log(`Kiracı: ${tenant.unvan} (${tenantId})`);

  // Abonelik kaydı olmayan kiracıda cari/stok/fatura oluşturma kilitlenir.
  const abonelik = await prisma.tenantAbonelik.findUnique({ where: { tenantId } });
  if (!abonelik) await prisma.tenantAbonelik.create({ data: { tenantId, planKodu: "v1", durum: "aktif" } });

  // Talep açan ve onaylayan ayrı kullanıcılar: görev ayrılığı (SAT-03) denenebilsin.
  await kullanici(tenantId, "depo@tekirextra.local", "Deniz Depo", "depo");
  await kullanici(tenantId, "muhasebe@tekirextra.local", "Meral Muhasebe", "muhasebe");
  const yonetici = await prisma.user.findFirst({ where: { tenantId, rol: "yonetici" } });

  // Talep departmanı personel departmanlarından seçilir; departman bir işyerine bağlıdır.
  let isyeri = await prisma.personelIsyeri.findFirst({ where: { tenantId, kod: "MRK" } });
  isyeri ??= await prisma.personelIsyeri.create({ data: { tenantId, kod: "MRK", ad: "Merkez" } });
  for (const [kod, ad] of [["URT", "Üretim"], ["IDR", "İdari İşler"]]) {
    const mevcut = await prisma.personelDepartman.findFirst({ where: { tenantId, kod } });
    if (!mevcut) await prisma.personelDepartman.create({ data: { tenantId, isyeriId: isyeri.id, kod, ad } });
  }

  // Siparişe dönüşümde teslim deposu seçilir (SAT-06).
  const depo = await prisma.depo.findFirst({ where: { tenantId, varsayilan: true } });
  if (!depo) await prisma.depo.create({ data: { tenantId, kod: "D01", ad: "Merkez Depo", varsayilan: true } });

  // Talep kalemi stok ya da hizmet kartıdır (SAT-01).
  const stoklar = [
    { kod: "HM-001", ad: "Kostik Soda %98", anaBirim: "kg", alisFiyati: "42.5000", tip: "urun" as const },
    { kod: "HM-002", ad: "Sitrik Asit Monohidrat", anaBirim: "kg", alisFiyati: "68.0000", tip: "urun" as const },
    { kod: "AMB-001", ad: "5 L HDPE Bidon", anaBirim: "adet", alisFiyati: "24.7500", tip: "urun" as const },
    { kod: "HZM-001", ad: "Cihaz Kalibrasyon Hizmeti", anaBirim: "adet", alisFiyati: "3500.0000", tip: "hizmet" as const },
  ];
  for (const stok of stoklar) {
    const mevcut = await prisma.stokKart.findFirst({ where: { tenantId, kod: stok.kod } });
    if (!mevcut) await prisma.stokKart.create({ data: { tenantId, kdvOrani: "20", ...stok } });
  }

  // Teklif karşılaştırması (SAT-05) için birden çok tedarikçi.
  const cariler = [
    { kod: "TED-001", unvan: "ANADOLU KİMYA SANAYİ VE TİCARET A.Ş.", vknTckn: "1234567802" },
    { kod: "TED-002", unvan: "EGE AMBALAJ LTD. ŞTİ.", vknTckn: "1234567803" },
    { kod: "TED-003", unvan: "MARMARA ENDÜSTRİYEL TEDARİK A.Ş.", vknTckn: "1234567804" },
  ];
  for (const cari of cariler) {
    const mevcut = await prisma.cariHesap.findFirst({ where: { tenantId, kod: cari.kod } });
    if (!mevcut) await prisma.cariHesap.create({ data: { tenantId, tip: "tedarikci", kisiTipi: "tuzel", ...cari } });
  }

  // Bütçe kontrolü (SAT-04) denenebilsin diye onaylı bir bütçe; tutarlar varsayılan
  // 25.000 TL onay eşiğinin etrafında seçildi ki hem eşik hem aşım senaryosu çıksın.
  const butce = await prisma.butce.findFirst({ where: { tenantId, yil: YIL, durum: "onayli" } });
  if (!butce) {
    const yeni = await prisma.butce.create({
      data: { tenantId, yil: YIL, revizyon: 1, durum: "onayli", onaylayanUserId: yonetici?.id ?? null, onayTarihi: new Date() },
    });
    const satirlar = [];
    for (let ay = 1; ay <= 12; ay++) {
      satirlar.push({ tenantId, butceId: yeni.id, anahtar: "mal_alis", ay, tutar: "40000.00" });
      satirlar.push({ tenantId, butceId: yeni.id, anahtar: "hizmet_alis", ay, tutar: "10000.00" });
    }
    await prisma.butceSatiri.createMany({ data: satirlar });
  }

  console.log(`Hazır — ${YIL} bütçesi onaylı (mal_alis 40.000/ay, hizmet_alis 10.000/ay).`);
  console.log(`Giriş: depo@tekirextra.local (talep açar), muhasebe@tekirextra.local (eşik altını onaylar),`);
  console.log(`       admin@tekirextra.local (eşik üstünü onaylar) — parola ${PAROLA}`);
}

main()
  .catch((hata) => {
    console.error("Hata:", hata);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
