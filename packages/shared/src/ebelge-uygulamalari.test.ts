import { describe, expect, it } from "vitest";
import {
  ebelgeKanalEngelleri,
  ebelgeKanali,
  ebelgeKullanilmiyor,
  ebelgeUygulamalariCoz,
  mukellefiyetCelismeleri,
  uygulamaAcik,
} from "./ebelge-uygulamalari";

const coz = (
  elle: Partial<{ efatura: boolean | null; earsiv: boolean | null; eirsaliye: boolean | null }>,
  liste: Partial<{ efatura: boolean; eirsaliye: boolean; guncel: boolean }> = {},
) =>
  ebelgeUygulamalariCoz({
    elle: { efatura: null, earsiv: null, eirsaliye: null, ...elle },
    liste: { efatura: false, eirsaliye: false, guncel: false, ...liste },
  });

describe("ebelgeUygulamalariCoz (EBLG-77)", () => {
  it("elle seçim listeden önce gelir", () => {
    const u = coz({ efatura: false }, { efatura: true, guncel: true });

    expect(u.efatura).toEqual({ acik: false, kaynak: "elle" });
  });

  it("elle boşsa GİB mükellef listesinden okur", () => {
    const u = coz({}, { efatura: true, eirsaliye: true, guncel: true });

    expect(u.efatura.acik).toBe(true);
    expect(u.efatura.kaynak).toBe("entegrator");
    expect(u.eirsaliye.acik).toBe(true);
  });

  it("liste güncel değilse durum bilinmiyor kalır", () => {
    const u = coz({}, { efatura: true, guncel: false });

    expect(u.efatura).toEqual({ acik: null, kaynak: "bilinmiyor" });
    expect(uygulamaAcik(u, "efatura")).toBe(false);
  });

  it("e-Arşiv otomatikte e-Fatura mükellefiyetini izler", () => {
    // GİB e-Arşiv mükellef listesi yayınlamaz; e-Fatura mükellefi zorunlu
    // e-Arşiv mükellefidir.
    expect(coz({}, { efatura: true, guncel: true }).earsiv.acik).toBe(true);
    expect(coz({ efatura: false }).earsiv.acik).toBe(null);
  });

  it("yalnız e-Arşiv kullanan firma elle söyler", () => {
    const u = coz({ efatura: false, earsiv: true });

    expect(u.efatura.acik).toBe(false);
    expect(u.earsiv.acik).toBe(true);
    expect(ebelgeKullanilmiyor(u)).toBe(false);
  });

  it("e-Fatura kapalıyken e-İrsaliye de kapalıdır", () => {
    // e-İrsaliye uygulaması e-Fatura'ya kayıtlı olmayı gerektirir.
    const u = coz({ efatura: false, eirsaliye: true });

    expect(u.eirsaliye.acik).toBe(false);
  });

  it("hiçbirine kayıtlı olmayan firmada e-belge kullanılmaz", () => {
    expect(ebelgeKullanilmiyor(coz({ efatura: false, earsiv: false }))).toBe(true);
  });
});

describe("ebelgeKanali (EBLG-77)", () => {
  it("e-Fatura mükellefi alıcıya e-Fatura keser", () => {
    const uygulamalar = coz({ efatura: true, earsiv: true });

    expect(ebelgeKanali({ uygulamalar, aliciEfaturaMukellefi: true })).toBe("efatura");
    expect(ebelgeKanali({ uygulamalar, aliciEfaturaMukellefi: false })).toBe("earsiv");
  });

  it("satıcı e-Fatura mükellefi değilse alıcı mükellef olsa da e-Arşiv keser", () => {
    const uygulamalar = coz({ efatura: false, earsiv: true });

    expect(ebelgeKanali({ uygulamalar, aliciEfaturaMukellefi: true })).toBe("earsiv");
    expect(ebelgeKanalEngelleri({ uygulamalar, aliciEfaturaMukellefi: true })).toEqual([]);
  });

  it("iki uygulama da kapalıysa belge gönderilmez", () => {
    const uygulamalar = coz({ efatura: false, earsiv: false });

    expect(ebelgeKanali({ uygulamalar, aliciEfaturaMukellefi: false })).toBeNull();
    expect(ebelgeKanalEngelleri({ uygulamalar, aliciEfaturaMukellefi: false })[0]).toContain("kağıt");
  });

  it("e-Fatura durumu bilinmiyorken alıcıya bakılmadan durdurur", () => {
    // Bilinmezlik satıcının kapsamındadır: e-Arşiv'e düşürmek, firma aslında
    // mükellefse mükellef alıcıya yanlış belge kesmek olurdu.
    const uygulamalar = coz({ earsiv: true });

    expect(ebelgeKanalEngelleri({ uygulamalar, aliciEfaturaMukellefi: true })[0]).toContain("e-Fatura mükellefiyeti bilinmiyor");
    expect(ebelgeKanalEngelleri({ uygulamalar, aliciEfaturaMukellefi: false })[0]).toContain("e-Fatura mükellefiyeti bilinmiyor");
  });

  it("e-Arşiv durumu bilinmiyorken mükellef olmayan alıcıya belge gönderilmez", () => {
    const uygulamalar = coz({ efatura: true });

    expect(ebelgeKanalEngelleri({ uygulamalar, aliciEfaturaMukellefi: false })).toEqual([]);
    expect(coz({ efatura: true }).earsiv.acik).toBe(true);
  });
});

describe("mukellefiyetCelismeleri (EBLG-77)", () => {
  it("listede kayıtlı firma e-Fatura'yı kapatırsa uyarır", () => {
    const celismeler = mukellefiyetCelismeleri({ elle: { efatura: false, eirsaliye: null }, liste: { efatura: true, eirsaliye: false } });
    expect(celismeler).toHaveLength(1);
    expect(celismeler[0]).toContain("e-Fatura mükellefi görünüyor");
  });

  it("listede kayıtlı firma e-İrsaliye'yi kapatırsa uyarır; e-Fatura zaten kapalıysa ikinci uyarı yinelenmez", () => {
    expect(mukellefiyetCelismeleri({ elle: { efatura: true, eirsaliye: false }, liste: { efatura: true, eirsaliye: true } })).toHaveLength(1);
    expect(mukellefiyetCelismeleri({ elle: { efatura: false, eirsaliye: false }, liste: { efatura: true, eirsaliye: true } })).toHaveLength(1);
  });

  it("ayar listeyle uyumluysa ya da otomatikse uyarmaz", () => {
    expect(mukellefiyetCelismeleri({ elle: { efatura: false, eirsaliye: false }, liste: { efatura: false, eirsaliye: false } })).toEqual([]);
    expect(mukellefiyetCelismeleri({ elle: { efatura: null, eirsaliye: null }, liste: { efatura: true, eirsaliye: true } })).toEqual([]);
  });
});
