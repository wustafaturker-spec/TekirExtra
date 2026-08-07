import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { KullanimController } from "./kullanim.controller";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "yonetici" }) }));

describe("KullanimController", () => {
  it("yalniz izin verilen olayi kaydeder", async () => {
    const create = vi.fn().mockResolvedValue({ id: "1" });
    const prisma = { tenantIslem: vi.fn((_tenant, cb) => cb({ auditLog: { create } })) } as any;
    const controller = new KullanimController(prisma);
    await expect(controller.olay({ olay: "fatura_tamamlandi", sureMs: 120000 })).resolves.toEqual({ kaydedildi: true });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ varlik: "kullanim", islem: "fatura_tamamlandi", detay: { sureMs: 120000 } }) });
    await expect(controller.olay({ olay: "serbest_metin" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.geriBildirim({ puan: 5, kategori: "kullanilabilirlik", mesaj: "Hızlı ve anlaşılır" })).resolves.toEqual({ kaydedildi: true });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ varlik: "kullanim", islem: "geri_bildirim", detay: { puan: 5, kategori: "kullanilabilirlik", mesaj: "Hızlı ve anlaşılır" } }) });
    await expect(controller.geriBildirim({ puan: 6, kategori: "genel" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("30 gunluk tamamlama ve benimsenme ozetini hesaplar", async () => {
    const kayitlar = [
      { islem: "fatura_form_acildi", userId: "u1", detay: null }, { islem: "fatura_form_acildi", userId: "u2", detay: null },
      { islem: "fatura_tamamlandi", userId: "u1", detay: { sureMs: 60000 } }, { islem: "fatura_tamamlandi", userId: "u2", detay: { sureMs: 120000 } },
      { islem: "fatura_dogrulama_hatasi", userId: "u1", detay: null }, { islem: "gorunum_kaydedildi", userId: "u1", detay: null },
      { islem: "gorunum_kullanildi", userId: "u2", detay: null },
      { islem: "geri_bildirim", userId: "u1", detay: { puan: 5, kategori: "genel" } },
      { islem: "geri_bildirim", userId: "u2", detay: { puan: 3, kategori: "hata" } },
    ];
    const kullanicilar = [{ id: "u1", rol: "yonetici" }, { id: "u2", rol: "satis" }];
    const prisma = { tenantIslem: vi.fn((_tenant, cb) => cb({
      auditLog: { findMany: vi.fn().mockResolvedValue(kayitlar) },
      user: { findMany: vi.fn().mockResolvedValue(kullanicilar) },
    })) } as any;
    const sonuc = await new KullanimController(prisma).ozet();
    expect(sonuc).toMatchObject({
      aktifKullanici: 2, toplamOlay: 9,
      fatura: { acilan: 2, tamamlanan: 2, ortancaSureMs: 90000, terkOrani: 0, dogrulamaHatasi: 1 },
      gorunum: { kaydedilen: 1, kullanilan: 1 },
      geriBildirim: { yanit: 2, ortalamaPuan: 4, kategoriler: { genel: 1, kullanilabilirlik: 0, hata: 1, oneri: 0 } },
      rolKirilimi: [
        { rol: "yonetici", kullaniciSayisi: 1, aktifKullanici: 1, toplamOlay: 5, tamamlananFatura: 1, kullanilanGorunum: 0 },
        { rol: "satis", kullaniciSayisi: 1, aktifKullanici: 1, toplamOlay: 4, tamamlananFatura: 1, kullanilanGorunum: 1 },
      ],
    });
  });
});
