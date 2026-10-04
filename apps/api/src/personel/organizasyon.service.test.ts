import { describe, expect, it, vi } from "vitest";
import { OrganizasyonService } from "./organizasyon.service";

const servis = (tx: unknown) => new OrganizasyonService({ tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx) } as never);

describe("organizasyon düzenleme (PRS-13)", () => {
  it("etkin personeli olan departman pasife alınmaz", async () => {
    const tx = { personelDepartman: { findFirst: vi.fn(async () => ({ id: "d1", ad: "Üretim", isyeriId: "i1" })), count: vi.fn(async () => 0), update: vi.fn() }, personel: { count: vi.fn(async () => 3) } };
    await expect(servis(tx).departmanGuncelle("t1", "d1", { aktif: false })).rejects.toThrow("Üretim biriminde 3 etkin personel var");
    expect(tx.personelDepartman.update).not.toHaveBeenCalled();
  });

  it("üst departman ataması döngü oluşturamaz", async () => {
    // d1'in altında d2 var; d1'in üstünü d2 yapmak döngü
    const kayitlar: Record<string, { id: string; ad: string; isyeriId: string; ustDepartmanId: string | null }> = {
      "11111111-1111-4111-8111-111111111111": { id: "11111111-1111-4111-8111-111111111111", ad: "Üretim", isyeriId: "i1", ustDepartmanId: null },
      "22222222-2222-4222-8222-222222222222": { id: "22222222-2222-4222-8222-222222222222", ad: "Montaj", isyeriId: "i1", ustDepartmanId: "11111111-1111-4111-8111-111111111111" },
    };
    const tx = {
      personelDepartman: {
        findFirst: vi.fn(async (a: { where: { id: string } }) => kayitlar[a.where.id]),
        findUnique: vi.fn(async (a: { where: { id: string } }) => kayitlar[a.where.id]),
        update: vi.fn(),
      },
    };
    await expect(servis(tx).departmanGuncelle("t1", "11111111-1111-4111-8111-111111111111", { ustDepartmanId: "22222222-2222-4222-8222-222222222222" })).rejects.toThrow("döngü");
    await expect(servis(tx).departmanGuncelle("t1", "11111111-1111-4111-8111-111111111111", { ustDepartmanId: "11111111-1111-4111-8111-111111111111" })).rejects.toThrow("kendi üst departmanı");
  });

  it("pozisyon adı değişince kartlardaki unvan da değişir; son etkin işyeri pasife alınmaz", async () => {
    const tx = { personelPozisyon: { findFirst: vi.fn(async () => ({ id: "p1", ad: "Usta" })), update: vi.fn(async () => ({})) }, personel: { updateMany: vi.fn(async () => ({ count: 2 })), count: vi.fn(async () => 0) } };
    await servis(tx).pozisyonGuncelle("t1", "p1", { ad: "Kıdemli usta" });
    expect(tx.personel.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1", pozisyonId: "p1" }, data: { unvan: "Kıdemli usta" } });
    const tx2 = { personelIsyeri: { findFirst: vi.fn(async () => ({ id: "i1", ad: "Merkez" })), count: vi.fn(async () => 0), update: vi.fn() }, personel: { count: vi.fn(async () => 0) } };
    await expect(servis(tx2).isyeriGuncelle("t1", "i1", { aktif: false })).rejects.toThrow("En az bir etkin işyeri");
  });
});
