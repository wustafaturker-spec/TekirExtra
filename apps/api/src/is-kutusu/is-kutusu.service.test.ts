import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../core/istek-baglami";
import { IsKutusuService } from "./is-kutusu.service";

const ESKI = new Date("2026-10-15T09:00:00Z");
function kur(rol = "satis") {
  const tx = {
    epostaTeklifIslemi: {
      findMany: vi.fn().mockResolvedValue([
        { id: "i1", durum: "cari_secimi", uyarilar: ["seçin"], cariAdaylari: [{ cariId: "c1", kod: "C1", unvan: "ARENA", gerekceler: ["alan adı arena.com"] }], belgeId: null, updatedAt: ESKI, calistiranUserId: "u1", gelenEposta: { id: "e1", konu: "Kahve", gonderenAdi: "Kemal", gonderenEposta: "k@arena.com", tarih: ESKI } },
        { id: "i2", durum: "incelenmeli", uyarilar: [], cariAdaylari: [], belgeId: "b1", updatedAt: ESKI, calistiranUserId: "u1", gelenEposta: { id: "e2", konu: "Teklif", gonderenAdi: null, gonderenEposta: "a@b.com", tarih: ESKI } },
        { id: "i3", durum: "taslak_hazir", uyarilar: [], cariAdaylari: [], belgeId: "b2", updatedAt: ESKI, calistiranUserId: "u1", gelenEposta: { id: "e3", konu: "Teklif 2", gonderenAdi: null, gonderenEposta: "a@b.com", tarih: ESKI } },
        { id: "i4", durum: "hata", uyarilar: [], cariAdaylari: [], belgeId: null, updatedAt: ESKI, calistiranUserId: "u1", gelenEposta: { id: "e4", konu: "Bozuk", gonderenAdi: null, gonderenEposta: "x@y.com", tarih: ESKI } },
      ]),
      count: vi.fn().mockResolvedValue(2),
    },
    belge: {
      findMany: vi.fn().mockResolvedValue([
        { id: "b1", durum: "taslak", genelToplam: new Prisma.Decimal(100), dovizCinsi: "TRY", cari: { id: "c2", unvan: "TÜRKER" } },
        // Onaylanmış taslak artık "kontrol bekleyen" değildir.
        { id: "b2", durum: "onaylandi", genelToplam: new Prisma.Decimal(50), dovizCinsi: "TRY", cari: { id: "c2", unvan: "TÜRKER" } },
      ]),
      count: vi.fn().mockResolvedValue(1),
    },
    aiOnayTalebi: { findMany: vi.fn().mockResolvedValue([{ id: "o1", arac: "cari_olustur", ozet: "Yeni cari: ABC", kaynak: "otomasyon", createdAt: ESKI, gecerlilikSonu: new Date(Date.now() + 3600_000), userId: "u1", user: { adSoyad: "Meral" } }]), count: vi.fn().mockResolvedValue(1) },
    teklifTakibi: {
      findMany: vi.fn(async (q: { where: { durum: string } }) => q.where.durum === "hatirlatildi"
        ? [{ id: "t1", belgeId: "b9", gonderildiAt: ESKI, hatirlatmaGunu: ESKI, alici: "m@x.com", gonderimSayisi: 1, sorumluUserId: "u1", belge: { no: "TKF1", revizyonNo: 0, genelToplam: new Prisma.Decimal(10), dovizCinsi: "TRY", gecerlilikTarihi: null, cari: { id: "c3", unvan: "ANADOLU" } } }]
        : []),
      count: vi.fn().mockResolvedValue(3),
    },
    user: { findMany: vi.fn().mockResolvedValue([{ id: "u1", adSoyad: "Meral" }]) },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (x: typeof tx) => unknown) => fn(tx)) };
  const s = new IsKutusuService(prisma as never);
  const calistir = <T>(fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: "t", userId: "u1", rol: rol as never } }, fn);
  return { s, tx, calistir };
}

describe("teklif iş kutusu (AI-48…51)", () => {
  it("grupları ayırır: cari seçimi, kontrol bekleyen taslak, incelenecek, onay, takip", async () => {
    const k = kur();
    const g = await k.calistir(() => k.s.listele());
    expect(g.cariSecimi.map((x) => x.id)).toEqual(["i1"]);
    expect(g.cariSecimi[0].cariAdaylari[0].unvan).toBe("ARENA");
    expect(g.taslaklar.map((x) => x.id)).toEqual(["i2"]);
    expect(g.taslaklar[0].adres).toBe("/panel/belgeler?odak=b1");
    expect(g.incelenecek.map((x) => x.id)).toEqual(["i4"]);
    expect(g.onaylar).toEqual([expect.objectContaining({ id: "o1", benim: true, adres: "/panel/ai?talep=o1" })]);
    expect(g.takipEdilecek).toEqual([expect.objectContaining({ belgeId: "b9", no: "TKF1", kim: "Meral" })]);
  });

  it("kendi kapsamında yalnız kendi kayıtlarını sorgular", async () => {
    const k = kur();
    await k.calistir(() => k.s.listele("bana"));
    expect(k.tx.epostaTeklifIslemi.findMany.mock.calls[0][0].where).toMatchObject({ calistiranUserId: "u1" });
    expect(k.tx.aiOnayTalebi.findMany.mock.calls[0][0].where).toMatchObject({ userId: "u1" });
    expect(k.tx.teklifTakibi.findMany.mock.calls[0][0].where).toMatchObject({ sorumluUserId: "u1" });
  });

  it("firma geneli yalnız yöneticiye; yöneticide kullanıcı süzgeci yoktur", async () => {
    const satis = kur("satis");
    await expect(satis.calistir(() => satis.s.listele("firma"))).rejects.toBeInstanceOf(ForbiddenException);
    const yonetici = kur("yonetici");
    await yonetici.calistir(() => yonetici.s.listele("firma"));
    expect(yonetici.tx.epostaTeklifIslemi.findMany.mock.calls[0][0].where).not.toHaveProperty("calistiranUserId");
    expect(yonetici.tx.aiOnayTalebi.findMany.mock.calls[0][0].where).not.toHaveProperty("userId");
  });

  it("sayaç kendi açık işlerini toplar", async () => {
    const k = kur();
    expect(await k.calistir(() => k.s.sayac())).toEqual({ toplam: 2 + 1 + 1 + 3 });
  });
});
