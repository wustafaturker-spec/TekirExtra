import { beforeEach, describe, expect, it } from "vitest";
import type { IstekBaglami } from "../istek-baglami";
import {
  _tumPolitikalariTemizle,
  eylemIzinli,
  izinliEylemler,
  registerEylemPolitikasi,
} from "./eylem-kayit";

interface SahteFatura {
  durum: "taslak" | "kesin" | "iptal";
}

const muhasebeci: IstekBaglami = { tenantId: "t1", userId: "u1", rol: "muhasebe" };
const saticiCtx: IstekBaglami = { tenantId: "t1", userId: "u2", rol: "satis" };
const yonetici: IstekBaglami = { tenantId: "t1", userId: "u3", rol: "yonetici" };

describe("eylem kural motoru (AYR-04..07)", () => {
  beforeEach(() => {
    _tumPolitikalariTemizle();
    // AYR-05 varsayılan kural seti örneği
    registerEylemPolitikasi<SahteFatura>("fatura", {
      duzenle: (f, ctx) => f.durum === "taslak" && ["muhasebe", "yonetici"].includes(ctx.rol),
      sil: (f, ctx) => f.durum === "taslak" && ["muhasebe", "yonetici"].includes(ctx.rol),
      iptal: (f, ctx) => f.durum === "kesin" && ["muhasebe", "yonetici"].includes(ctx.rol),
      kopyala: (f, ctx) => f.durum !== "iptal" && ctx.rol !== "salt_okunur",
    });
  });

  it("taslak fatura düzenlenir ve silinir ama iptal edilemez", () => {
    const eylemler = izinliEylemler("fatura", { durum: "taslak" }, muhasebeci);
    expect(eylemler).toContain("duzenle");
    expect(eylemler).toContain("sil");
    expect(eylemler).not.toContain("iptal");
  });

  it("kesin fatura düzenlenemez/silinemez ama kopyalanır ve iptal edilir (AYR-05)", () => {
    const eylemler = izinliEylemler("fatura", { durum: "kesin" }, muhasebeci);
    expect(eylemler).not.toContain("duzenle");
    expect(eylemler).not.toContain("sil");
    expect(eylemler).toContain("kopyala");
    expect(eylemler).toContain("iptal");
  });

  it("rol denetimi uygular: satış silme yapamaz, kopyalayabilir", () => {
    expect(eylemIzinli("fatura", "sil", { durum: "taslak" }, saticiCtx)).toBe(false);
    expect(eylemIzinli("fatura", "kopyala", { durum: "kesin" }, saticiCtx)).toBe(true);
    expect(eylemIzinli("fatura", "sil", { durum: "taslak" }, yonetici)).toBe(true);
  });

  it("kayıtsız varlık için hiçbir eylem dönmez", () => {
    expect(izinliEylemler("bilinmeyen", {}, muhasebeci)).toEqual([]);
  });

  it("aynı varlığın ikinci kaydını reddeder", () => {
    expect(() => registerEylemPolitikasi("fatura", {})).toThrow(/zaten kayıtlı/);
  });
});
