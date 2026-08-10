import { describe, expect, it, vi } from "vitest";
import { KayitService } from "./kayit.service";

vi.mock("argon2", () => ({ hash: vi.fn().mockResolvedValue("parola-hash") }));

describe("KayitService abonelik altyapisi", () => {
  it("yeni firma icin fiyatlandirmasiz v1 profili olusturur", async () => {
    const abonelikCreate = vi.fn().mockResolvedValue({});
    const tx = {
      tenant: { create: vi.fn().mockResolvedValue({}) },
      user: { create: vi.fn().mockResolvedValue({}) },
      tenantAbonelik: { create: abonelikCreate },
      depo: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      authKimlik: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
      tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)),
      epostaDogrulama: { create: vi.fn().mockResolvedValue({}) },
    } as any;
    const eposta = { dogrulamaGonder: vi.fn().mockResolvedValue(undefined) } as any;
    const servis = new KayitService(prisma, eposta);

    await servis.kaydet({
      unvan: "Örnek Firma AŞ", vkn: "1234567890", vergiDairesi: "Kadıköy",
      yoneticiAdSoyad: "Ada Yılmaz", yoneticiEposta: "ada@example.com", parola: "gucluParola1",
    });

    expect(abonelikCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      planKodu: "v1", durum: "aktif", faturaEpostasi: "ada@example.com", faturalandirmaUnvani: "Örnek Firma AŞ",
    }) });
  });
});
