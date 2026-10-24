import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
    abonelikTalebi: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "talep-1", durum: "bekliyor", ...data })),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    abonelikDegisikligi: { create: vi.fn().mockResolvedValue({}) },
  };
  Object.assign(tx.tenantAbonelik, { update: vi.fn().mockResolvedValue({}) });
  const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => Promise.resolve(calistir(tx))) } as never;
  const erisim = { unut: vi.fn() };
  return { servis: new AbonelikService(prisma, erisim as never), upsert, tx, erisim };
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

  it("plan değişikliği hemen uygulanmaz, talep olarak açılır (platform P0-1)", async () => {
    const { servis, tx } = servisKur({ planKodu: "baslangic", durum: "aktif" });
    const talep = await servis.planTalebi("kurumsal", "Kullanıcı sayımız arttı");
    expect(talep).toMatchObject({ mevcutPlan: "baslangic", istenenPlan: "kurumsal", aciklama: "Kullanıcı sayımız arttı", isteyenUserId: "u1" });
    expect((tx.tenantAbonelik as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ islem: "abonelik_talebi_olusturuldu" }) }));
  });

  it("aynı plana, askıdaki abonelikte ya da sınırı aşan küçük plana talep açılmaz", async () => {
    await expect(servisKur({ planKodu: "v1", durum: "aktif" }).servis.planTalebi("profesyonel")).rejects.toThrow(/Zaten bu plandasınız/);
    await expect(servisKur({ planKodu: "baslangic", durum: "askida" }).servis.planTalebi("kurumsal")).rejects.toThrow(ForbiddenException);
    await expect(servisKur({ planKodu: "profesyonel", durum: "aktif" }, { kullanici: 5, cari: 1, stok: 1, aylikFatura: 1 }).servis.planTalebi("baslangic")).rejects.toThrow(/limit aşımını/);
  });

  it("bekleyen talep varken ikincisi 409 alır", async () => {
    const { servis, tx } = servisKur({ planKodu: "baslangic", durum: "aktif" });
    tx.abonelikTalebi.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("tekil", { code: "P2002", clientVersion: "6" }));
    await expect(servis.planTalebi("kurumsal")).rejects.toThrow(ConflictException);
  });

  it("askıdaki aboneliği firma kendisi açamaz; iptal/etkinleştirme önbelleği tazeler", async () => {
    await expect(servisKur({ planKodu: "v1", durum: "askida" }).servis.durumDegistir("aktif")).rejects.toThrow(/TekirExtra ekibi/);
    const { servis, erisim } = servisKur({ planKodu: "v1", durum: "aktif" });
    await servis.durumDegistir("iptal");
    expect(erisim.unut).toHaveBeenCalledWith("t1");
  });
});
