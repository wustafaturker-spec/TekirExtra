import { describe, expect, it } from "vitest";
import { ebelgeGitmemisMi } from "./ebelge-iptal";

describe("ebelgeGitmemisMi (EBLG-81)", () => {
  it("hata durumunda, numarasız ve referanssız belge gitmemiştir", () => {
    expect(ebelgeGitmemisMi({ faturaNo: null, ebelge: { durum: "hata", entegratorRef: null } })).toBe(true);
  });

  it("numara atanmışsa belge entegratördedir", () => {
    expect(ebelgeGitmemisMi({ faturaNo: "SNC2026000000001", ebelge: { durum: "hata", entegratorRef: null } })).toBe(false);
  });

  it("entegratör referansı varsa belge entegratördedir", () => {
    expect(ebelgeGitmemisMi({ faturaNo: null, ebelge: { durum: "hata", entegratorRef: "abc" } })).toBe(false);
  });

  it("kuyruktaki ya da reddedilen belge bu yola girmez", () => {
    expect(ebelgeGitmemisMi({ faturaNo: null, ebelge: { durum: "kuyrukta", entegratorRef: null } })).toBe(false);
    expect(ebelgeGitmemisMi({ faturaNo: null, ebelge: { durum: "ret", entegratorRef: null } })).toBe(false);
  });

  it("e-Belge kaydı yoksa false", () => {
    expect(ebelgeGitmemisMi({ faturaNo: null, ebelge: null })).toBe(false);
  });
});
