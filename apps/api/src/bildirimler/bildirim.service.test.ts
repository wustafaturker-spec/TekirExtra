import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { BildirimService } from "./bildirim.service";

const baglam = { tenantId: "t1", userId: "u1", rol: "muhasebe" as string };
vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => baglam }));

function servisKur(tx: Record<string, unknown>) {
  const prisma = { tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)) } as never;
  return new BildirimService(prisma);
}

function uretTx(secenekler: {
  kullanicilar: { id: string }[];
  tercihler?: { userId: string; uygulamaIci: boolean; eposta: boolean }[];
  mevcutTeslimatlar?: { userId: string }[];
}) {
  const createMany = vi.fn();
  return {
    tx: {
      bildirim: { upsert: vi.fn().mockResolvedValue({ id: "b1" }) },
      user: { findMany: vi.fn().mockResolvedValue(secenekler.kullanicilar) },
      bildirimTercihi: { findMany: vi.fn().mockResolvedValue(secenekler.tercihler ?? []) },
      bildirimTeslimati: { findMany: vi.fn().mockResolvedValue(secenekler.mevcutTeslimatlar ?? []), createMany },
    },
    createMany,
  };
}

const ornekGirdi = {
  tur: "ebelge" as const,
  onem: "kritik" as const,
  baslik: "e-Belge gönderimi hata verdi",
  aciklama: "SF2026000123 reddedildi",
  birlesimAnahtari: "ebelge:k1",
  roller: ["yonetici", "muhasebe"] as never,
};

describe("BildirimService.uret", () => {
  it("hedef roldeki her kullanıcıya teslimat açar", async () => {
    const { tx, createMany } = uretTx({ kullanicilar: [{ id: "u1" }, { id: "u2" }] });
    const sonuc = await servisKur(tx).uret(ornekGirdi);

    expect(sonuc).toEqual({ bildirimId: "b1", yeniTeslimat: 2 });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: "u1", durum: "yeni", epostaDurumu: "beklemede" }),
        expect.objectContaining({ userId: "u2", durum: "yeni", epostaDurumu: "beklemede" }),
      ],
    });
  });

  it("teslimatı olan kullanıcıya ikinci kez teslimat açmaz", async () => {
    const { tx, createMany } = uretTx({ kullanicilar: [{ id: "u1" }, { id: "u2" }], mevcutTeslimatlar: [{ userId: "u1" }] });
    const sonuc = await servisKur(tx).uret(ornekGirdi);

    expect(sonuc.yeniTeslimat).toBe(1);
    expect(createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ userId: "u2" })] });
  });

  it("son tarihi tazelemez — SLA her taramada ileri itilmemelidir", async () => {
    const { tx } = uretTx({ kullanicilar: [] });
    await servisKur(tx).uret({ ...ornekGirdi, sonTarih: new Date("2026-09-06T00:00:00Z") });

    const cagri = (tx.bildirim.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cagri.create.sonTarih).toEqual(new Date("2026-09-06T00:00:00Z"));
    expect(cagri.update).not.toHaveProperty("sonTarih");
    expect(cagri.update.kapandiAt).toBeNull();
  });

  it("e-postası kapalı kullanıcıda kanalı kapalı işaretler, uygulama içi kapalıysa listeye düşürmez", async () => {
    const { tx, createMany } = uretTx({
      kullanicilar: [{ id: "u1" }, { id: "u2" }],
      tercihler: [
        { userId: "u1", uygulamaIci: true, eposta: false },
        { userId: "u2", uygulamaIci: false, eposta: true },
      ],
    });
    await servisKur(tx).uret(ornekGirdi);

    const [{ data }] = (createMany as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data[0]).toMatchObject({ userId: "u1", durum: "yeni", epostaDurumu: "kapali" });
    expect(data[1]).toMatchObject({ userId: "u2", durum: "okundu", epostaDurumu: "beklemede" });
  });

  it("iki kanalı da kapatan kullanıcıya hiç teslimat açmaz", async () => {
    const { tx, createMany } = uretTx({
      kullanicilar: [{ id: "u1" }],
      tercihler: [{ userId: "u1", uygulamaIci: false, eposta: false }],
    });
    const sonuc = await servisKur(tx).uret(ornekGirdi);

    expect(sonuc.yeniTeslimat).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe("BildirimService kapsam ve kapatma", () => {
  it("firma geneli kapsamı yönetici olmayana kapalıdır", async () => {
    const servis = servisKur({});
    await expect(servis.listele({ kapsam: "firma", sayfa: 1, limit: 25 } as never)).rejects.toThrow(ForbiddenException);
  });

  it("artık tespit edilmeyen bildirimleri kapatır, açık olanlara dokunmaz", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const servis = servisKur({ bildirim: { updateMany } });

    await expect(servis.kapatEksikleri("stok", ["stok_kritik:2026-09-05"])).resolves.toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: { tur: "stok", kapandiAt: null, birlesimAnahtari: { notIn: ["stok_kritik:2026-09-05"] } },
      data: { kapandiAt: expect.any(Date) },
    });
  });

  it("hiç tespit yoksa o türün tüm açık bildirimlerini kapatır", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const servis = servisKur({ bildirim: { updateMany } });

    await servis.kapatEksikleri("vade", []);
    expect(updateMany).toHaveBeenCalledWith({ where: { tur: "vade", kapandiAt: null }, data: { kapandiAt: expect.any(Date) } });
  });
});

describe("BildirimService durum geçişleri", () => {
  it("okundu yalnız yeni teslimatları etkiler ve kullanıcıyla sınırlıdır", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const servis = servisKur({ bildirimTeslimati: { updateMany } });

    await expect(servis.okunduIsaretle(["d1", "d2"])).resolves.toEqual({ guncellenen: 2 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["d1", "d2"] }, userId: "u1", durum: { in: ["yeni"] } },
      data: { durum: "okundu", okunduAt: expect.any(Date) },
    });
  });

  it("aksiyon alındı, okundu damgasını da atar", async () => {
    const update = vi.fn().mockResolvedValue({ id: "d1" });
    const servis = servisKur({ bildirimTeslimati: { findFirst: vi.fn().mockResolvedValue({ id: "d1" }), update } });

    await servis.aksiyonAlindi("d1", "Fatura yeniden gönderildi");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "d1" },
        data: expect.objectContaining({ durum: "aksiyon_alindi", aksiyonNotu: "Fatura yeniden gönderildi", aksiyonAt: expect.any(Date), okunduAt: expect.any(Date) }),
      }),
    );
  });

  it("başkasının teslimatı güncellenemez", async () => {
    const servis = servisKur({ bildirimTeslimati: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } });
    await expect(servis.ustlen("d9")).rejects.toThrow("Bildirim bulunamadı");
  });
});
