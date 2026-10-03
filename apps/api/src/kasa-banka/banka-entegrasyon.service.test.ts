import { afterEach, describe, expect, it, vi } from "vitest";
import { BankaEntegrasyonService } from "./banka-entegrasyon.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", rol: "yonetici" }) }));
vi.mock("../core/kripto", () => ({ coz: () => JSON.stringify({ kullaniciAdi: "k", parola: "s" }) }));

/** KSB-15: otomatik çekim aralığı, hata sayacı ve kimlik reddinde durma. */
function kur(baglanti: Record<string, unknown>) {
  const tx = {
    baglanti: {
      findFirst: vi.fn(async () => ({ id: "b1", sifreliConfig: "x", bankaHesapEslemeleri: [{ id: "e1", disHesapId: "25", bankaHesapId: "h1", sonHareketId: null, sonSenkronTarihi: null }], ...baglanti })),
      findMany: vi.fn(async () => [{ id: "b1", otomatikSenkronDk: 60, sonSenkronDenemesi: baglanti.sonSenkronDenemesi ?? null }]),
      update: vi.fn(async () => ({})),
    },
    bankaBaglantiHesap: { update: vi.fn(async () => ({})) },
  };
  const ekstre = { webhookHareketleriniAl: vi.fn(async () => ({ yeniSatir: 1, yinelenenSatir: 0 })) };
  const service = new BankaEntegrasyonService({ tenantIslem: vi.fn((_t, cb) => cb(tx)) } as any, ekstre as any);
  return { tx, service };
}

describe("BankaEntegrasyonService — otomatik çekim", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("aralığı dolmamış bağlantıyı atlar, dolmuşu çeker", async () => {
    const simdi = new Date("2026-10-03T10:00:00Z");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (url.endsWith("/authenticate") ? { status: "success", token: "jwt" } : { status: "success", transactions: [] }) })));
    const erken = kur({ sonSenkronDenemesi: new Date("2026-10-03T09:30:00Z") });
    expect(await erken.service.vadesiGelenleriCek(simdi)).toEqual({ denenen: 0, basarisiz: 0 });
    const gec = kur({ sonSenkronDenemesi: new Date("2026-10-03T08:59:00Z") });
    expect(await gec.service.vadesiGelenleriCek(simdi)).toEqual({ denenen: 1, basarisiz: 0 });
    expect(gec.tx.baglanti.update.mock.calls.at(-1)![0].data).toMatchObject({ ardisikHata: 0, otomatikDurduNedeni: null, sonSenkronHatasi: null });
  });

  it("geçici hatada sayacı artırır, otomatik çekimi durdurmaz", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, statusText: "Service Unavailable", json: async () => ({}) })));
    const { tx, service } = kur({});
    expect(await service.vadesiGelenleriCek()).toEqual({ denenen: 1, basarisiz: 1 });
    const veri = tx.baglanti.update.mock.calls.at(-1)![0].data;
    expect(veri.ardisikHata).toEqual({ increment: 1 });
    expect(veri.otomatikDurduNedeni).toBeUndefined();
  });

  it("kimlik reddinde otomatik çekimi durdurur; elle çekimde durdurmaz", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ message: "invalid app key" }) })));
    const oto = kur({});
    await oto.service.vadesiGelenleriCek();
    expect(oto.tx.baglanti.update.mock.calls.at(-1)![0].data.otomatikDurduNedeni).toContain("reddedildi");
    const elle = kur({});
    await expect(elle.service.senkronize("b1")).rejects.toThrow("reddedildi");
    expect(elle.tx.baglanti.update.mock.calls.at(-1)![0].data.otomatikDurduNedeni).toBeUndefined();
  });
});
