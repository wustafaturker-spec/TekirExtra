import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { afterAll, expect, it, vi } from "vitest";
import { ArkaPlanSahiplikHatasi, type ArkaPlanSecenegi } from "../src/ai/ajan/ai-ajan.service";
import { AsistanGorevService, GOREV_AZAMI_DENEME } from "../src/ai/ajan/asistan-gorev.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { PrismaService } from "../src/core/prisma.service";

/**
 * AI-105 kabulü (gerçek PostgreSQL): atomik sahiplenme, kirası dolan işin tek devri,
 * sahipliğini kaybeden worker'ın sonuç yazamaması, iptal ve firma/kullanıcı yalıtımı.
 * Asistan sahtedir: sonucu üretimdeki gibi `arkaPlan.sonucYaz` ile aynı işlemde yazar.
 */
const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const db = new PrismaService();
const tenantId = randomUUID();
const baskaTenantId = randomUUID();

/** Üretimdeki son yazımın aynısı: asistan mesajı + sonucYaz aynı işlemde; false ise geri alınır. */
function sahteAjan(beklet?: Promise<void>) {
  return {
    webOturumu: vi.fn(),
    mesajiIsle: vi.fn(async (metin: string, _r: unknown, _e: unknown, _ek: unknown, s: { arkaPlan: ArkaPlanSecenegi }) => {
      await beklet;
      await db.tenantIslem(tenantId, async (tx) => {
        const kayit = await tx.ajanMesajGecmisi.create({ data: { oturumId: s.arkaPlan.oturumId, rol: "assistant", icerik: `Analiz: ${metin}`, kanal: "WEB" } });
        if (!(await s.arkaPlan.sonucYaz(tx, kayit.id))) throw new ArkaPlanSahiplikHatasi();
      });
      return { cevap: "tamam" };
    }),
  };
}

afterAll(async () => {
  await admin.$transaction(async (tx) => {
    for (const t of [tenantId, baskaTenantId]) {
      await tx.bildirim.deleteMany({ where: { tenantId: t } }).catch(() => undefined);
      await tx.aiAsistanGorevi.deleteMany({ where: { tenantId: t } });
      await tx.ajanMesajGecmisi.deleteMany({ where: { oturum: { tenantId: t } } });
      await tx.ajanOturumu.deleteMany({ where: { tenantId: t } });
      await tx.user.deleteMany({ where: { tenantId: t } });
      await tx.tenant.deleteMany({ where: { id: t } });
    }
  }, { timeout: 60_000 });
  await Promise.all([db.$disconnect(), admin.$disconnect()]);
});

it("arka plan görevi: tek sahiplenme, kira devri, iptal ve yalıtım", async () => {
  await admin.tenant.create({ data: { id: tenantId, unvan: "Asistan Görevi Kabul", vkn: String(Date.now()).slice(-10) } });
  await admin.tenant.create({ data: { id: baskaTenantId, unvan: "Başka Firma", vkn: String(Date.now() + 7).slice(-10) } });
  const user = await admin.user.create({ data: { tenantId, eposta: `${tenantId}@kabul.invalid`, adSoyad: "Analist", parolaHash: "test", rol: "yonetici" } });
  const baskaKullanici = await admin.user.create({ data: { tenantId, eposta: `b-${tenantId}@kabul.invalid`, adSoyad: "Diğer", parolaHash: "test", rol: "yonetici" } });
  const yabanci = await admin.user.create({ data: { tenantId: baskaTenantId, eposta: `${baskaTenantId}@kabul.invalid`, adSoyad: "Yabancı", parolaHash: "test", rol: "yonetici" } });
  const oturum = await db.tenantIslem(tenantId, (tx) => tx.ajanOturumu.create({ data: { tenantId, userId: user.id, kanal: "WEB", kanalKimlik: `web:${user.id}:${randomUUID()}` } }));
  const bildirimler = { uret: vi.fn(async () => ({ bildirimId: "b", yeniTeslimat: 1 })) };
  const baglam = { tenantId, userId: user.id, rol: "yonetici" as const };

  const ajan = sahteAjan();
  ajan.webOturumu.mockResolvedValue(oturum);
  const servis = new AsistanGorevService(db, ajan as never, bildirimler as never);

  // Oluşturma: istek mesajı sohbete yazılır; aynı requestId ikinci görev açmaz.
  const requestId = randomUUID();
  const g = await baglamlaCalistir(baglam, () => servis.olustur({ mesaj: "Son altı ayın tahsilat analizi", requestId, baglam: { kayit: { tur: "cari", id: randomUUID() }, sayfa: "/panel/cari" } }));
  expect(g).toMatchObject({ durum: "kuyrukta", deneme: 0 });
  expect((await baglamlaCalistir(baglam, () => servis.olustur({ mesaj: "Son altı ayın tahsilat analizi", requestId }))).id).toBe(g.id);
  expect(await db.tenantIslem(tenantId, (tx) => tx.ajanMesajGecmisi.count({ where: { oturumId: oturum.id, rol: "user", requestId } }))).toBe(1);

  // Yalıtım: aynı firmadaki başka kullanıcı ve başka firmanın kullanıcısı 404 alır.
  await expect(baglamlaCalistir({ ...baglam, userId: baskaKullanici.id }, () => servis.getir(g.id))).rejects.toBeInstanceOf(NotFoundException);
  await expect(baglamlaCalistir({ tenantId: baskaTenantId, userId: yabanci.id, rol: "yonetici" }, () => servis.getir(g.id))).rejects.toBeInstanceOf(NotFoundException);

  // Eşzamanlı sahiplenme: iki worker aynı işi alamaz.
  const kayit = await admin.aiAsistanGorevi.findUniqueOrThrow({ where: { id: g.id } });
  const [a, b] = await Promise.all([servis.sahiplen(admin, kayit), servis.sahiplen(admin, kayit)]);
  expect([a, b].filter(Boolean)).toHaveLength(1);
  const ilk = (a ?? b)!;

  // Worker 1 çöktü: kira doldu, worker 2 devralır; worker 1'in geç gelen sonucu yazılmaz.
  await admin.aiAsistanGorevi.update({ where: { id: g.id }, data: { kiraBitisAt: new Date(Date.now() - 1000) } });
  const devralan = await servis.sahiplen(admin, await admin.aiAsistanGorevi.findUniqueOrThrow({ where: { id: g.id } }));
  expect(devralan).toMatchObject({ deneme: 2 });
  await servis.calistir(admin, ilk);
  expect(await admin.aiAsistanGorevi.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ durum: "calisiyor", sonucMesajId: null });
  await servis.calistir(admin, devralan!);
  const biten = await admin.aiAsistanGorevi.findUniqueOrThrow({ where: { id: g.id } });
  expect(biten).toMatchObject({ durum: "tamamlandi", sahiplikAnahtari: null });
  expect(await db.tenantIslem(tenantId, (tx) => tx.ajanMesajGecmisi.count({ where: { oturumId: oturum.id, rol: "assistant" } }))).toBe(1);
  expect(bildirimler.uret).toHaveBeenCalledTimes(1);
  expect(bildirimler.uret.mock.calls[0]![0]).toMatchObject({ baslik: "Arka plan analizi hazır", kullaniciIdler: [user.id] });

  // İptal: çalışırken iptal edilen görev sonuç yazmaz.
  let birak!: () => void;
  const bekleyen = new Promise<void>((r) => { birak = r; });
  const yavas = sahteAjan(bekleyen);
  yavas.webOturumu.mockResolvedValue(oturum);
  const servis2 = new AsistanGorevService(db, yavas as never, bildirimler as never);
  const g2 = await baglamlaCalistir(baglam, () => servis2.olustur({ mesaj: "Stok devir analizi", requestId: randomUUID() }));
  const alinan = (await servis2.sahiplen(admin, await admin.aiAsistanGorevi.findUniqueOrThrow({ where: { id: g2.id } })))!;
  const calisma = servis2.calistir(admin, alinan);
  expect((await baglamlaCalistir(baglam, () => servis2.iptal(g2.id))).durum).toBe("iptal");
  birak();
  await calisma;
  expect(await admin.aiAsistanGorevi.findUniqueOrThrow({ where: { id: g2.id } })).toMatchObject({ durum: "iptal", sonucMesajId: null });
  expect(await db.tenantIslem(tenantId, (tx) => tx.ajanMesajGecmisi.count({ where: { oturumId: oturum.id, rol: "assistant" } }))).toBe(1);
  expect(await servis2.sahiplen(admin, await admin.aiAsistanGorevi.findUniqueOrThrow({ where: { id: g2.id } }))).toBeNull();

  // Deneme hakkı biten ve kirası dolan görev hata olur, bir kez bildirilir.
  const g3 = await baglamlaCalistir(baglam, () => servis.olustur({ mesaj: "Kâr marjı analizi", requestId: randomUUID() }));
  await admin.aiAsistanGorevi.update({ where: { id: g3.id }, data: { durum: "calisiyor", deneme: GOREV_AZAMI_DENEME, kiraBitisAt: new Date(Date.now() - 1000), sahiplikAnahtari: randomUUID() } });
  expect(await servis.sahiplen(admin, await admin.aiAsistanGorevi.findUniqueOrThrow({ where: { id: g3.id } }))).toBeNull();
  expect(await admin.aiAsistanGorevi.findUniqueOrThrow({ where: { id: g3.id } })).toMatchObject({ durum: "hata" });
  expect(bildirimler.uret).toHaveBeenCalledTimes(2);
});
