import { describe, expect, it } from "vitest";
import type { EntegratorConfig, SeriTanimi } from "@tekirextra/baglanti";
import { seriEngelleri } from "./seri-dogrulama";

const tanimlar: SeriTanimi[] = [
  { tur: "efatura", seri: "K07", otomatik: true, aktif: true },
  { tur: "efatura", seri: "EFE", otomatik: false, aktif: true },
  { tur: "earsiv", seri: "SNC", otomatik: true, aktif: true },
  { tur: "eirsaliye", seri: "IRS", otomatik: true, aktif: true },
  { tur: "eirsaliye", seri: "GBZ", otomatik: false, aktif: true },
  { tur: "eirsaliye", seri: "ESK", otomatik: false, aktif: false },
  { tur: "eirsaliye_yanit", seri: "YNT", otomatik: true, aktif: true },
  { tur: "efatura", seri: "TKR", otomatik: false, aktif: true },
  { tur: "earsiv", seri: "AST", otomatik: false, aktif: true },
  { tur: "eirsaliye_yanit", seri: "SIL", otomatik: true, aktif: false, durum: "Deleted" },
];
const cfg = (ek: Partial<EntegratorConfig>) => ({ saglayici: "nes", kullaniciAdi: "x", ...ek }) as EntegratorConfig;

describe("seriEngelleri (EBLG-97)", () => {
  it("doğru kurulmuş bağlantıda engel yok", () => {
    expect(seriEngelleri(cfg({ belgeSeriOneki: "K07", earsivSeriOneki: "SNC", eirsaliyeSeriOneki: "GBZ", eirsaliyeYanitSeriOneki: "YNT" }), tanimlar, { eirsaliyeKullanicisi: true })).toEqual([]);
  });

  it("otomatik e-İrsaliye serisini reddeder — TEKİREXTRA2'deki IRS hatası", () => {
    expect(seriEngelleri(cfg({ eirsaliyeSeriOneki: "IRS" }), tanimlar, { eirsaliyeKullanicisi: true })).toEqual([
      "e-İrsaliye serisi IRS entegratörde otomatik numaralı; e-İrsaliye numarasını program verir, elle numaralı bir seri gerekir",
    ]);
  });

  it("e-İrsaliye kullanıcısında önek boşsa durur, kullanıcı olmayanda sormaz", () => {
    expect(seriEngelleri(cfg({}), tanimlar, { eirsaliyeKullanicisi: true })[0]).toContain("e-İrsaliye seri öneki girilmemiş");
    expect(seriEngelleri(cfg({}), tanimlar, { eirsaliyeKullanicisi: null })[0]).toContain("e-İrsaliye seri öneki girilmemiş");
    expect(seriEngelleri(cfg({}), tanimlar, { eirsaliyeKullanicisi: false })).toEqual([]);
  });

  it("elle numaralı e-Fatura serisini, tanımsız ve pasif seriyi bildirir", () => {
    expect(seriEngelleri(cfg({ belgeSeriOneki: "EFE", earsivSeriOneki: "XYZ", eirsaliyeSeriOneki: "ESK" }), tanimlar, { eirsaliyeKullanicisi: true })).toEqual([
      "e-Fatura serisi EFE entegratörde elle numaralı; e-Fatura için numarayı entegratörün verdiği otomatik bir seri gerekir",
      "e-Arşiv serisi XYZ entegratörde tanımlı değil",
      "e-İrsaliye serisi ESK entegratörde pasif",
    ]);
  });

  it("başka belge türünde açılmış seriyi ve silinmiş seriyi açıkça söyler — TEKİREXTRA2 kurulumu", () => {
    expect(seriEngelleri(cfg({ earsivSeriOneki: "TKR", eirsaliyeSeriOneki: "AST", eirsaliyeYanitSeriOneki: "SIL" }), tanimlar, { eirsaliyeKullanicisi: true })).toEqual([
      "e-Arşiv serisi TKR entegratörde e-Arşiv serisi olarak tanımlı değil; e-Fatura serisi olarak tanımlı. Seriyi portalda e-Arşiv bölümünde açın",
      "e-İrsaliye serisi AST entegratörde e-İrsaliye serisi olarak tanımlı değil; e-Arşiv serisi olarak tanımlı. Seriyi portalda e-İrsaliye bölümünde açın",
      "e-İrsaliye yanıt serisi SIL entegratörde silinmiş",
    ]);
  });
});
