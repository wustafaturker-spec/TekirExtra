import { beforeEach, describe, expect, it, vi } from "vitest";
import { EirsaliyeService } from "./eirsaliye.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1-uuid", userId: "u1" }),
}));

vi.mock("../core/kripto", () => ({
  coz: (val: string) => val,
}));

/** EBLG-34: portalda ya da başka bir yerde verilmiş irsaliye yanıtının benimsenmesi. */
describe("EirsaliyeService gelen yanıt (EBLG-34)", () => {
  const adapter = {
    gelenIrsaliyeleriCek: vi.fn(),
    gelenIrsaliyeYanitDurumu: vi.fn(),
    irsaliyeYanitiGonder: vi.fn(),
  };
  const tx = {
    baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify({ saglayici: "nes" }) }) },
    gelenEirsaliye: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({ id: "irs-kayit" }),
    },
  };
  const prisma = { tenantIslem: vi.fn((_tenantId: string, cb: (t: typeof tx) => unknown) => cb(tx)) };
  const service = new EirsaliyeService(prisma as never, { adapterCoz: () => adapter } as never, {} as never);

  const gelen = (uuid: string, ek: object = {}) => ({ uuid, belgeNo: `TYH-${uuid}`, gonderenVkn: "4620553774", gonderenUnvan: "Hızlı", tarih: new Date("2026-09-10"), xml: "<DespatchAdvice/>", ...ek });

  beforeEach(() => {
    vi.clearAllMocks();
    tx.gelenEirsaliye.findUnique.mockResolvedValue({ id: "irs-kayit", uuid: "u1", durum: "yeni", xmlIcerik: "<DespatchAdvice/>" });
  });

  it("taramada entegratördeki kararı yalnız yanıt bekleyen kayda yazar", async () => {
    adapter.gelenIrsaliyeleriCek.mockResolvedValue([gelen("u1", { yanit: { karar: "kabul" } }), gelen("u2"), gelen("u3", { yanit: { karar: "ret", not: "Eksik" } })]);

    await service.gelenleriCek();

    expect(tx.gelenEirsaliye.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.gelenEirsaliye.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1-uuid", uuid: "u1", durum: "yeni" }, data: { durum: "kabul", yanitGerekcesi: null } });
    expect(tx.gelenEirsaliye.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1-uuid", uuid: "u3", durum: "yeni" }, data: { durum: "ret", yanitGerekcesi: "Eksik" } });
  });

  it("entegratörde zaten yanıtlanmış irsaliyeye yanıt göndermez, kararı kayda işler", async () => {
    adapter.gelenIrsaliyeYanitDurumu.mockResolvedValue({ karar: "kabul" });

    await expect(service.gelenYanit("irs-kayit", "ret", "Hasarlı")).rejects.toThrow(/zaten 'kabul'/);

    expect(adapter.gelenIrsaliyeYanitDurumu).toHaveBeenCalledWith(expect.any(Object), "u1");
    expect(adapter.irsaliyeYanitiGonder).not.toHaveBeenCalled();
    expect(tx.gelenEirsaliye.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1-uuid", id: "irs-kayit", durum: "yeni" }, data: { durum: "kabul", yanitGerekcesi: null } });
  });

  it("karar yoksa ya da sorgu yapılamazsa yanıtı gönderir ve kaydeder", async () => {
    adapter.irsaliyeYanitiGonder.mockResolvedValue({ basarili: true, belgeRef: "ra-1", belgeNo: "YNT2026000000003" });

    adapter.gelenIrsaliyeYanitDurumu.mockResolvedValueOnce(null);
    await service.gelenYanit("irs-kayit", "kabul");
    adapter.gelenIrsaliyeYanitDurumu.mockRejectedValueOnce(new Error("NES 500"));
    await service.gelenYanit("irs-kayit", "kabul");

    expect(adapter.irsaliyeYanitiGonder).toHaveBeenCalledTimes(2);
    expect(tx.gelenEirsaliye.update).toHaveBeenCalledWith({ where: { id: "irs-kayit" }, data: { durum: "kabul", yanitRef: "ra-1", yanitBelgeNo: "YNT2026000000003", yanitGerekcesi: null } });
  });
});
