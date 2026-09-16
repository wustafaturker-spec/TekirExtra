import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AbonelikService } from "./abonelik.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "yonetici" }),
}));

/** Kiracıda abonelik kaydı `mevcut` ise onu döndüren, yoksa açan sahte tablo. */
function servisKur(mevcut: { planKodu: string; durum: string } | null, kullanim = { kullanici: 1, cari: 1, stok: 1, aylikFatura: 1 }) {
  const upsert = vi.fn().mockImplementation(({ create }) => Promise.resolve(mevcut ?? { tenantId: "t1", ...create }));
  const tx = {
    tenantAbonelik: { upsert },
    user: { count: vi.fn().mockResolvedValue(kullanim.kullanici) },
    cariHesap: { count: vi.fn().mockResolvedValue(kullanim.cari) },
    stokKart: { count: vi.fn().mockResolvedValue(kullanim.stok) },
    fatura: { count: vi.fn().mockResolvedValue(kullanim.aylikFatura) },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir(tx)) } as never;
  return { servis: new AbonelikService(prisma), upsert };
}

describe("AbonelikService", () => {
  it("abonelik kaydı yoksa varsayılan planla açar ve işlemi engellemez", async () => {
    const { servis, upsert } = servisKur(null);

    await expect(servis.limitDogrula("cari")).resolves.toBeUndefined();

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "t1" },
      create: { tenantId: "t1", planKodu: "v1", durum: "aktif" },
      update: {},
    }));
  });

  it("askıya alınmış abonelikte işlemi durdurur", async () => {
    const { servis } = servisKur({ planKodu: "v1", durum: "askida" });

    await expect(servis.limitDogrula("cari")).rejects.toThrow(BadRequestException);
  });

  it("plan limiti dolduğunda yeni kayda izin vermez", async () => {
    const { servis } = servisKur({ planKodu: "baslangic", durum: "aktif" }, { kullanici: 1, cari: 250, stok: 1, aylikFatura: 1 });

    await expect(servis.limitDogrula("cari")).rejects.toThrow(/limiti doldu/);
  });

  it("özet, kaydı olmayan kiracıda da plan ve kullanım döndürür", async () => {
    const { servis } = servisKur(null);

    const ozet = await servis.ozet();

    expect(ozet.plan.kod).toBe("profesyonel");
    expect(ozet.kullanim).toEqual({ kullanici: 1, cari: 1, stok: 1, aylikFatura: 1 });
  });
});
