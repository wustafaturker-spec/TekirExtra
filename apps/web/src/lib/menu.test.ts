import { describe, expect, it } from "vitest";
import { MENU, menuOgesiAktifMi, type MenuOge } from "./menu";

const oge = (href: string): MenuOge => {
  const bulunan = MENU.flatMap((alan) => alan.ogeler).find((m) => m.href === href);
  if (!bulunan) throw new Error(`Menüde bulunamadı: ${href}`);
  return bulunan;
};

const TUM_BELGELER = "/panel/belgeler";
const SATIS_SIPARIS = "/panel/belgeler?tur=siparis&yon=satis";
const ALIS_SIPARIS = "/panel/belgeler?tur=siparis&yon=alis";

describe("menuOgesiAktifMi", () => {
  it("süzgeçli maddeyi sorgusu örtüştüğünde aktif sayar", () => {
    expect(menuOgesiAktifMi(oge(SATIS_SIPARIS), "/panel/belgeler", "?tur=siparis&yon=satis")).toBe(true);
  });

  it("yönü farklı süzgeçli maddeyi aktif saymaz", () => {
    expect(menuOgesiAktifMi(oge(ALIS_SIPARIS), "/panel/belgeler", "?tur=siparis&yon=satis")).toBe(false);
  });

  it("süzgeçli madde eşleşirken 'Tüm Belgeler' geri çekilir", () => {
    expect(menuOgesiAktifMi(oge(TUM_BELGELER), "/panel/belgeler", "?tur=siparis&yon=satis")).toBe(false);
  });

  it("süzgeçsiz sayfada 'Tüm Belgeler' aktiftir", () => {
    expect(menuOgesiAktifMi(oge(TUM_BELGELER), "/panel/belgeler", "")).toBe(true);
  });

  it("hiçbir menü maddesiyle örtüşmeyen süzgeçte 'Tüm Belgeler' aktif kalır", () => {
    expect(menuOgesiAktifMi(oge(TUM_BELGELER), "/panel/belgeler", "?tur=irsaliye")).toBe(true);
  });

  it("başka sayfadayken aktif saymaz", () => {
    expect(menuOgesiAktifMi(oge(SATIS_SIPARIS), "/panel/fatura", "?yon=satis")).toBe(false);
  });

  it("önek eşleşmeli maddeyi alt sayfada da aktif sayar", () => {
    expect(menuOgesiAktifMi(oge("/panel/satin-alma/talepler"), "/panel/satin-alma/talepler", "?talep=abc")).toBe(true);
  });
});
