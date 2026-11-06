import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { KayitService } from "./kayit.service";

vi.mock("argon2", () => ({ hash: vi.fn().mockResolvedValue("parola-hash") }));

describe("KayitService abonelik altyapisi", () => {
  it("yeni firma icin fiyatlandirmasiz v1 profili olusturur", async () => {
    const abonelikCreate = vi.fn().mockResolvedValue({});
    const tx = {
      authKimlik: { create: vi.fn().mockResolvedValue({}) },
      tenant: { create: vi.fn().mockResolvedValue({}) },
      user: { create: vi.fn().mockResolvedValue({}) },
      tenantAbonelik: { create: abonelikCreate },
      depo: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      vergiDairesi: { findFirst: vi.fn().mockResolvedValue({ kod: "34123", ad: "Kadıköy Vergi Dairesi Müdürlüğü" }) },
      authKimlik: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
      tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)),
      epostaDogrulama: { create: vi.fn().mockResolvedValue({}) },
    } as any;
    const eposta = { dogrulamaGonder: vi.fn().mockResolvedValue(undefined) } as any;
    const servis = new KayitService(prisma, eposta);

    await servis.kaydet({
      unvan: "Örnek Firma AŞ", kisiTuru: "tuzel", vkn: "1234567890", vergiDairesi: "Kadıköy Vergi Dairesi Müdürlüğü", vergiDairesiKodu: "34123", il: "İstanbul", ilce: "Kadıköy",
      yoneticiAdSoyad: "Ada Yılmaz", yoneticiEposta: "ada@example.com", parola: "gucluParola1",
    });

    expect(abonelikCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      planKodu: "v1", durum: "aktif", faturaEpostasi: "ada@example.com", faturalandirmaUnvani: "Örnek Firma AŞ",
    }) });
  });

  it("kayitli VKN ile gelen kaydi sunucu hatasi yerine cakisma olarak reddeder", async () => {
    const ihlal = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6.19.3" });
    const authKimlikCreate = vi.fn();
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      vergiDairesi: { findFirst: vi.fn().mockResolvedValue({ kod: "34123", ad: "Kadıköy Vergi Dairesi Müdürlüğü" }) },
      authKimlik: { findFirst: vi.fn().mockResolvedValue(null), create: authKimlikCreate },
      tenantIslem: vi.fn().mockRejectedValue(ihlal),
      epostaDogrulama: { create: vi.fn() },
    } as any;
    const servis = new KayitService(prisma, { dogrulamaGonder: vi.fn() } as any);

    const sonuc = servis.kaydet({
      unvan: "Örnek Firma AŞ", kisiTuru: "tuzel", vkn: "1234567890", vergiDairesi: "Kadıköy Vergi Dairesi Müdürlüğü", vergiDairesiKodu: "34123", il: "İstanbul", ilce: "Kadıköy",
      yoneticiAdSoyad: "Ada Yılmaz", yoneticiEposta: "ada@example.com", parola: "gucluParola1",
    });

    await expect(sonuc).rejects.toBeInstanceOf(ConflictException);
    await expect(sonuc).rejects.toThrow("Bu VKN/TCKN ile kayıtlı bir firma zaten var");
    expect(authKimlikCreate).not.toHaveBeenCalled();
  });
});
