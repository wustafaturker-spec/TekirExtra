import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import "../src/ayar-tanimlari";
import { AiOnayService } from "../src/ai/onay/ai-onay.service";
import { BildirimService } from "../src/bildirimler/bildirim.service";
import { AyarlarService } from "../src/core/ayarlar/ayarlar.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { DonemKilidiService } from "../src/donem-kapatma/donem-kilidi.service";
import { KasaBankaService } from "../src/kasa-banka/kasa-banka.service";
import { kasaBankaHareketOlusturSemasi } from "../src/kasa-banka/kasa-banka.semalar";
import { OnayService } from "../src/onay/onay.service";

/**
 * AI-108 (e): AI onayı, talebi açan kişinin "bunu ben istedim" teyididir; görev ayrılığı
 * gerektiren işlem AI onayından sonra genel onay akışına (ONY-09) düşer ve talep eden onu
 * kendisi onaylayamaz. Gerçek PostgreSQL ve uygulama rolüyle (RLS); araç, ucun servisine bağlanır.
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const tenantId = randomUUID();
const [yonetici1, yonetici2, kasaId] = [randomUUID(), randomUUID(), randomUUID()];
let aktifKullanici = yonetici1;

const prisma = {
  tenantIslem: <T>(t: string, fn: (tx: never) => Promise<T>, secenek?: { timeout?: number }) =>
    uygulama.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true), set_config('app.user_id', ${aktifKullanici}, true)`;
      return fn(tx as never);
    }, { timeout: secenek?.timeout ?? 60_000 }),
};
const bildirim = new BildirimService(prisma as never);
const onay = new OnayService(prisma as never, new AyarlarService(prisma as never), bildirim);
const kasa = new KasaBankaService(prisma as never, {} as never, new DonemKilidiService(prisma as never), onay);
// Araç, uç çağırıcı yerine aynı servise bağlanır (controller'ın şema ayrıştırmasıyla).
const uc = {
  cagir: async (u: { yol: string }, args: unknown[]) => {
    if (u.yol === "POST /kasa-banka/hareketler") return kasa.hareketEkle(kasaBankaHareketOlusturSemasi.parse(args[0]));
    throw new Error(`Beklenmeyen uç: ${u.yol}`);
  },
};
const aiOnay = new AiOnayService(prisma as never, uc as never, bildirim);
const olarak = <T>(userId: string, fn: () => Promise<T>) => { aktifKullanici = userId; return baglamlaCalistir({ tenantId, userId, rol: "yonetici" } as never, fn); };
const oku = <T>(fn: (t: PrismaClient) => Promise<T>) => prisma.tenantIslem(tenantId, (t: never) => fn(t as PrismaClient));

beforeAll(async () => {
  await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${tenantId}::uuid, 'AI Dört Göz', ${String(Date.now()).slice(-10)}, now(), now())`;
  for (const [id, ad] of [[yonetici1, "Yeliz Yönetici"], [yonetici2, "Yusuf Yönetici"]] as const) {
    await yonetim.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${id}::uuid, ${tenantId}::uuid, ${`ai-dg-${id}@test.local`}, 'x', ${ad}, 'yonetici'::"Rol", now())`;
  }
  await yonetim.$executeRaw`INSERT INTO kasalar (id, tenant_id, ad, created_at, updated_at) VALUES (${kasaId}::uuid, ${tenantId}::uuid, 'Merkez', now(), now())`;
});

afterAll(async () => {
  await uygulama.$disconnect();
  await yonetim.$disconnect();
});

it("AI'ın açtığı ödeme AI onayından sonra genel onaya düşer; talep eden kendisi onaylayamaz, ikinci yönetici onaylayınca yürür", async () => {
  // Ödeme eksi bakiye korumasına takılmasın diye kasada para olsun (tahsilat kurala tabi değil).
  await olarak(yonetici1, () => kasa.hareketEkle(kasaBankaHareketOlusturSemasi.parse({ kasaId, tip: "tahsilat", tutar: "10000.00", dovizCinsi: "TRY", tarih: "2026-11-19" })));
  await olarak(yonetici1, () => onay.kuralKaydet(null, { islem: "kasa_banka_odeme", ad: "Ödeme", tutarEsigi: 1000, adimlar: [{ rol: "yonetici" }] }));
  const parametreler = { tip: "tediye", hesapTuru: "kasa", hesapId: kasaId, tutar: "5000.00", tarih: "2026-11-20", aciklama: "AI ödeme denemesi" };
  const talep = await olarak(yonetici1, () => aiOnay.olustur({ arac: "kasa_banka_hareketi_kaydet", parametreler, ozet: "Tediye 5.000 TL · kasa Merkez", kaynak: "asistan" }));
  expect(talep.risk).toBe("finansal");

  // AI onayı (talebi açanın teyidi) işlemi yapmaz; genel onay talebi açılır.
  const sonuc = await olarak(yonetici1, () => aiOnay.onayla(talep.id, { kanal: "WEB" }));
  expect(sonuc.durum).toBe("onaylandi");
  const { onayTalebiId } = sonuc.sonuc as { onayaGonderildi: boolean; onayTalebiId: string };
  expect(sonuc.sonuc).toMatchObject({ onayaGonderildi: true });
  expect(await oku((t) => t.kasaBankaHareket.count({ where: { kasaId, tip: "tediye" } }))).toBe(0);

  // Görev ayrılığı: AI talebini açan ve onaylayan kişi genel onayda da talep edendir.
  const ony = await oku((t) => t.onayTalebi.findUnique({ where: { id: onayTalebiId }, select: { talepEdenId: true } }));
  expect(ony?.talepEdenId).toBe(yonetici1);
  expect((await olarak(yonetici1, () => onay.liste("bekleyen"))).talepler.map((x) => x.id)).not.toContain(onayTalebiId);
  await expect(olarak(yonetici1, () => onay.karar(onayTalebiId, "onay"))).rejects.toThrow(/Kendi talebinizi onaylayamazsınız|onaycısı değilsiniz/);
  expect(await oku((t) => t.kasaBankaHareket.count({ where: { kasaId, tip: "tediye" } }))).toBe(0);

  const karar = await olarak(yonetici2, () => onay.karar(onayTalebiId, "onay"));
  expect(karar, JSON.stringify(karar)).toMatchObject({ durum: "onaylandi" });
  expect(await oku((t) => t.kasaBankaHareket.count({ where: { kasaId, tip: "tediye" } }))).toBe(1);
  const aiKarar = await oku((t) => t.aiOnayKarari.findUnique({ where: { talepId: talep.id } }));
  expect(aiKarar).toMatchObject({ kararVerenId: yonetici1, kanal: "WEB", ekDogrulama: false });
});
