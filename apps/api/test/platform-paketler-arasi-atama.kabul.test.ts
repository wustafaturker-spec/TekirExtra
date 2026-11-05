import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bugunTR, PAKET_MODUL_KODLARI, type PaketKapsamSozlesmesi } from "@tekirextra/shared";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PrismaService } from "../src/core/prisma.service";
import { PlatformPaketService } from "../src/mevzuat/platform-paket.service";
import { bagliAbonelikTutari, etkinAbonelikPlani } from "../src/tenant/abonelik-kosullari";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const platform = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
const kullaniciId = randomUUID(), firmalar: string[] = [];
const servis = new PlatformPaketService({ db: platform } as never);
const yonetici = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId, eposta: "paket-gecisi@kabul.invalid", rol: "yonetici" }, is);
const kapsam: PaketKapsamSozlesmesi = { semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: {
  kullanici: { sinir: 20, uyariYuzdesi: 80 }, cari: { sinir: 500, uyariYuzdesi: 80 }, stok: { sinir: 1000, uyariYuzdesi: 80 }, aylikFatura: { sinir: 200, uyariYuzdesi: 80 },
} };
const fiyatlandirma = { paraBirimi: "TRY" as const, vergiDahil: false as const, kdvOrani: "20", gecerlilikTarihi: "2026-01-01", donemler: ([1, 3, 6, 12] as const).map((aySayisi) => ({ aySayisi, matrah: String(700 * aySayisi) })) };
let hedefSurumId: string, hedefPaketKodu: string;

async function firma() {
  const tenantId = randomUUID(); firmalar.push(tenantId);
  await admin.tenant.create({ data: { id: tenantId, unvan: `Paket geçiş ${tenantId}`, vkn: String(8100000000 + firmalar.length) } });
  await admin.tenantAbonelik.create({ data: { tenantId, planKodu: "v1", durum: "aktif", donemSonu: new Date(Date.now() + 86_400_000) } });
  return tenantId;
}

beforeAll(async () => {
  await admin.platformKullanici.create({ data: { id: kullaniciId, eposta: `${kullaniciId}@kabul.invalid`, adSoyad: "Paket geçiş yöneticisi", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  hedefPaketKodu = `gecis_${randomUUID().slice(0, 8)}`;
  const p = await yonetici(() => servis.olustur({ kod: hedefPaketKodu, ad: "Yeni nesil paket", aciklama: "Kontrollü planlar arası geçiş", ozellikler: ["Yeni kapsam"], siralama: 10, fiyatlandirma, kapsamSozlesmesi: kapsam }));
  const yayin = await yonetici(() => servis.yayinla(p.id, p.surum.id, p.surum.kilitSurumu));
  hedefSurumId = yayin.id;
});

afterAll(async () => {
  await admin.mevzuatOlay.deleteMany({ where: { kullaniciId } });
  await admin.platformPaketAtamasi.deleteMany({ where: { kullaniciId } });
  await admin.tenantAbonelik.deleteMany({ where: { tenantId: { in: firmalar } } });
  await admin.tenant.deleteMany({ where: { id: { in: firmalar } } });
  await admin.platformFirmaYasamOlayi.deleteMany({ where: { tenantId: { in: firmalar } } });
  await admin.platformKullanici.deleteMany({ where: { id: kullaniciId } });
  await Promise.all([admin.$disconnect(), platform.$disconnect(), app.$disconnect()]);
});

describe("farklı katalog paketine kontrollü geçiş — gerçek PostgreSQL", () => {
  it("önizleme ve onay fiyatı/kapsamı/yeni plan kodunu atomik geçirir; ara dönem tarihini korur", async () => {
    const tenantId = await firma();
    const once = await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId } });
    const p = await yonetici(() => servis.atamaOnizle({ surumId: hedefSurumId, tenantIds: [tenantId], uygulamaTarihi: bugunTR(), neden: "Yeni kataloğa kontrollü geçiş", atamaKapsami: "kapsam" }));
    expect(p.kayitlar[0].donemler[0]).toMatchObject({ once: { toplam: "1198.80" }, sonra: { toplam: "840.00" }, fark: null });
    expect((await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId } })).planKodu).toBe("v1");
    await yonetici(() => servis.atamaUygula(p.id));
    const sonra = await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId } });
    expect(sonra).toMatchObject({ planKodu: hedefPaketKodu, paketSurumId: hedefSurumId, donemSonu: once.donemSonu, durum: once.durum });
    expect(sonra.paketKosullari).toMatchObject({ semaSurumu: 2, kaynak: "katalog_atamasi", planKodu: hedefPaketKodu, planAdi: "Yeni nesil paket", kapsamSozlesmesi: kapsam });
    expect(etkinAbonelikPlani(sonra)).toMatchObject({ kod: hedefPaketKodu, ad: "Yeni nesil paket", limitler: { cari: 500 } });
    expect(bagliAbonelikTutari(sonra, 1)?.toplam.toFixed(2)).toBe("840.00");
    await expect(app.tenantIslem(tenantId, (tx) => tx.tenantAbonelik.update({ where: { tenantId }, data: { planKodu: "kurumsal" } }))).rejects.toThrow("onaylı atamayla");
  });

  it("planlı dönem sonu geçişinde aboneliği vade gelene kadar korur ve worker yeni kodla uygular", async () => {
    const tenantId = await firma();
    const p = await yonetici(() => servis.atamaOnizle({ surumId: hedefSurumId, tenantIds: [tenantId], uygulamaTarihi: null, uygulamaTuru: "donem_sonu", neden: "Dönem sonunda katalog geçişi", atamaKapsami: "kapsam" }));
    await expect(yonetici(() => servis.atamaUygula(p.id))).resolves.toMatchObject({ durum: "planlandi" });
    expect((await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId } })).planKodu).toBe("v1");
    await admin.$executeRaw`UPDATE platform_paket_atamalari SET uygulanacak_at=clock_timestamp()-interval '1 second' WHERE id=${p.id}::uuid`;
    await servis.planliAtamalariIsle();
    expect(await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId } })).toMatchObject({ planKodu: hedefPaketKodu, paketSurumId: hedefSurumId });
  });
});
