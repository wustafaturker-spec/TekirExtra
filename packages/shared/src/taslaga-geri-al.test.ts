import { describe, expect, it } from "vitest";
import { faturaGeriAlmaEngeli, irsaliyeGeriAlmaEngeli } from "./taslaga-geri-al";

describe("faturaGeriAlmaEngeli (FTR-29)", () => {
  it("e-Belgesi olmayan kesin faturayı geri alır", () => {
    expect(faturaGeriAlmaEngeli({ durum: "kesin", tip: "satis", ebelge: null })).toBeNull();
    expect(faturaGeriAlmaEngeli({ durum: "kesin", tip: "alis" })).toBeNull();
  });

  it("entegratöre hiç ulaşmamış (hatalı, referanssız) e-Belgede geri alır", () => {
    expect(faturaGeriAlmaEngeli({ durum: "kesin", tip: "satis", ebelge: { durum: "hata", entegratorRef: null } })).toBeNull();
  });

  it("reddedilmiş, gönderimde ya da gönderilmiş e-Belgede geri almaz", () => {
    expect(faturaGeriAlmaEngeli({ durum: "kesin", tip: "satis", ebelge: { durum: "hata", entegratorRef: "u1" } })).toMatch(/reddedilmiş/);
    for (const durum of ["kuyrukta", "iletildi", "kabul", "ret", "iptal"]) {
      expect(faturaGeriAlmaEngeli({ durum: "kesin", tip: "satis", ebelge: { durum, entegratorRef: null } })).toMatch(/gönderilmiş/);
    }
  });

  it("taslak, iptal ve proforma faturayı geri almaz", () => {
    expect(faturaGeriAlmaEngeli({ durum: "taslak", tip: "satis" })).not.toBeNull();
    expect(faturaGeriAlmaEngeli({ durum: "iptal", tip: "satis" })).not.toBeNull();
    expect(faturaGeriAlmaEngeli({ durum: "kesin", tip: "proforma" })).not.toBeNull();
  });
});

describe("irsaliyeGeriAlmaEngeli (FTR-29)", () => {
  it("onaylı, gönderilmemiş ya da ulaşmamış irsaliyeyi geri alır", () => {
    expect(irsaliyeGeriAlmaEngeli({ tur: "irsaliye", durum: "onaylandi", eirsaliye: null })).toBeNull();
    expect(irsaliyeGeriAlmaEngeli({ tur: "irsaliye", durum: "onaylandi", eirsaliye: { durum: "hata", entegratorRef: null } })).toBeNull();
  });

  it("faturaya bağlı (kapandı) irsaliyede önce bağın kaldırılmasını ister", () => {
    expect(irsaliyeGeriAlmaEngeli({ tur: "irsaliye", durum: "kapandi" })).toMatch(/bağını kaldırın/);
  });

  it("gönderilmiş e-İrsaliyeyi, taslağı ve diğer belge türlerini geri almaz", () => {
    expect(irsaliyeGeriAlmaEngeli({ tur: "irsaliye", durum: "onaylandi", eirsaliye: { durum: "iletildi", entegratorRef: "u1" } })).not.toBeNull();
    expect(irsaliyeGeriAlmaEngeli({ tur: "irsaliye", durum: "taslak" })).not.toBeNull();
    expect(irsaliyeGeriAlmaEngeli({ tur: "siparis", durum: "onaylandi" })).not.toBeNull();
  });
});
