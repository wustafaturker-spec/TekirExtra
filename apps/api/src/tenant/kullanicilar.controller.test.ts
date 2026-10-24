import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../core/istek-baglami";
import type { KullaniciDurumService } from "../core/kullanici-durum.service";
import type { PrismaService } from "../core/prisma.service";
import type { AbonelikService } from "./abonelik.service";
import { KullanicilarController } from "./kullanicilar.controller";
import type { ParolaService } from "./parola.service";

const TENANT = "00000000-0000-0000-0000-0000000000aa";
interface Satir { id: string; eposta: string; rol: string; aktif: boolean; maksIskontoYuzdesi: Prisma.Decimal | null; bayiCariId: string | null }

function kur(satirlar: Satir[]) {
  const kullanicilar = new Map(satirlar.map((s) => [s.id, { ...s }]));
  const denetim: { islem: string; varlikId: string; detay: unknown }[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => []),
    user: {
      // Prisma gibi kopya döndürür; güncelleme önceki okumayı değiştirmez.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const u = kullanicilar.get(where.id); return u ? { ...u } : null; }),
      count: vi.fn(async ({ where }: { where: { rol: string; aktif: boolean; id: { not: string } } }) =>
        [...kullanicilar.values()].filter((u) => u.rol === where.rol && u.aktif === where.aktif && u.id !== where.id.not).length),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Satir> }) => {
        const u = kullanicilar.get(where.id)!;
        for (const [k, v] of Object.entries(data)) if (v !== undefined) (u as Record<string, unknown>)[k] = v;
        return { ...u, adSoyad: u.eposta };
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: { islem: string; varlikId: string; detay: unknown } }) => { denetim.push(data); return data; }) },
  };
  const prisma = { tenantIslem: vi.fn(async (_t: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx)), oturum: { deleteMany: vi.fn(async () => ({ count: 0 })) } };
  const abonelik = { limitDogrula: vi.fn(async () => undefined) };
  const durum = { unut: vi.fn() };
  const controller = new KullanicilarController(prisma as unknown as PrismaService, abonelik as unknown as AbonelikService, {} as ParolaService, durum as unknown as KullaniciDurumService);
  const olarak = <T>(userId: string, is: () => Promise<T>) => baglamlaCalistir({ tenantId: TENANT, userId, rol: "yonetici" }, is);
  return { kullanicilar, denetim, abonelik, controller, olarak, durum, prisma };
}

const satir = (id: string, rol: string, aktif = true): Satir => ({ id, eposta: `${id}@ornek.com`, rol, aktif, maksIskontoYuzdesi: null, bayiCariId: null });

describe("son yönetici koruması (yönetim P0-2)", () => {
  let k: ReturnType<typeof kur>;
  beforeEach(() => { k = kur([satir("a", "yonetici"), satir("b", "yonetici"), satir("c", "muhasebe"), satir("p", "yonetici", false)]); });

  it("kimse kendi rolünü değiştiremez", async () => {
    await expect(k.olarak("a", () => k.controller.guncelle("a", { rol: "satis" }))).rejects.toThrow(/Kendi rolünüzü/);
  });

  it("başka aktif yönetici varken bir yöneticinin rolü düşürülebilir", async () => {
    await k.olarak("a", () => k.controller.guncelle("b", { rol: "muhasebe" }));
    expect(k.kullanicilar.get("b")!.rol).toBe("muhasebe");
  });

  it("son aktif yöneticinin rolü düşürülemez, pasife alınamaz (pasif yönetici sayılmaz)", async () => {
    await k.olarak("a", () => k.controller.guncelle("b", { rol: "muhasebe" }));
    // Artık tek aktif yönetici "a"; "c" muhasebe, "p" pasif yönetici.
    k.kullanicilar.get("c")!.rol = "yonetici";
    await k.olarak("c", () => k.controller.guncelle("a", { aktif: false }));
    await expect(k.olarak("a", () => k.controller.guncelle("c", { rol: "satis" }))).rejects.toThrow(/en az bir aktif yönetici/);
    await expect(k.olarak("a", () => k.controller.guncelle("c", { aktif: false }))).rejects.toThrow(/en az bir aktif yönetici/);
    expect(k.kullanicilar.get("c")).toMatchObject({ rol: "yonetici", aktif: true });
  });

  it("yönetici olmayan kullanıcının değişikliği yönetici sayısına bakmaz", async () => {
    await k.olarak("a", () => k.controller.guncelle("c", { aktif: false }));
    expect(k.kullanicilar.get("c")!.aktif).toBe(false);
  });

  it("olmayan kullanıcıda 'bulunamadı' der, diğer hataları yutmaz", async () => {
    await expect(k.olarak("a", () => k.controller.guncelle("yok", { aktif: false }))).rejects.toThrow(/bulunamadı/);
  });
});

describe("aktif etmede abonelik sınırı (yönetim P2-2)", () => {
  it("pasif hesabı aktif ederken kullanıcı sınırı denetlenir", async () => {
    const k = kur([satir("a", "yonetici"), satir("c", "muhasebe", false)]);
    await k.olarak("a", () => k.controller.guncelle("c", { aktif: true }));
    expect(k.abonelik.limitDogrula).toHaveBeenCalledWith("kullanici");
  });

  it("sınır doluysa hesap pasif kalır", async () => {
    const k = kur([satir("a", "yonetici"), satir("c", "muhasebe", false)]);
    k.abonelik.limitDogrula.mockRejectedValueOnce(new Error("Başlangıç planının kullanici limiti doldu (3)"));
    await expect(k.olarak("a", () => k.controller.guncelle("c", { aktif: true }))).rejects.toThrow(/limiti doldu/);
    expect(k.kullanicilar.get("c")!.aktif).toBe(false);
  });

  it("zaten aktif hesabın rol değişikliği sınırı tekrar saymaz", async () => {
    const k = kur([satir("a", "yonetici"), satir("c", "muhasebe")]);
    await k.olarak("a", () => k.controller.guncelle("c", { rol: "satis" }));
    expect(k.abonelik.limitDogrula).not.toHaveBeenCalled();
  });
});

describe("yetki değişikliğinin denetim izi (yönetim P1-4)", () => {
  it("rol ve aktiflik eski → yeni değerleriyle yazılır; değişmeyen alan yazılmaz", async () => {
    const k = kur([satir("a", "yonetici"), satir("c", "muhasebe")]);
    await k.olarak("a", () => k.controller.guncelle("c", { rol: "satis", maksIskontoYuzdesi: null }));
    expect(k.denetim).toEqual([{ tenantId: TENANT, userId: "a", islem: "kullanici_yetkisi_degisti", varlik: "user", varlikId: "c", detay: { eposta: "c@ornek.com", degisiklikler: { rol: { eski: "muhasebe", yeni: "satis" } } } }]);
  });

  it("hiçbir şey değişmediyse kayıt yazılmaz", async () => {
    const k = kur([satir("a", "yonetici"), satir("c", "muhasebe")]);
    await k.olarak("a", () => k.controller.guncelle("c", { rol: "muhasebe" }));
    expect(k.denetim).toEqual([]);
  });
});
