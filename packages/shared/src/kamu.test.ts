import { describe, expect, it } from "vitest";
import { ibanGecerliMi, ibanNormalize, kamuEngelleri, kamuSenaryosuMu } from "./kamu";

describe("KAMU senaryosu", () => {
  it("liste türü KAMU ya da kart işaretiyle KAMU olur", () => {
    expect(kamuSenaryosuMu({ listeTuru: "KAMU" })).toBe(true);
    expect(kamuSenaryosuMu({ listeTuru: "OZEL", kartIsareti: true })).toBe(true);
    expect(kamuSenaryosuMu({ listeTuru: "OZEL", kartIsareti: false })).toBe(false);
    expect(kamuSenaryosuMu({})).toBe(false);
  });

  it("IBAN'ı şematron deseni ve mod-97 ile denetler", () => {
    expect(ibanGecerliMi("TR33 0006 1005 1978 6457 8413 26")).toBe(true);
    expect(ibanNormalize("tr33 0006 1005 1978 6457 8413 26")).toBe("TR330006100519786457841326");
    expect(ibanGecerliMi("TR330006100519786457841327")).toBe(false);
    expect(ibanGecerliMi("DE89370400440532013000")).toBe(false);
    expect(ibanGecerliMi("")).toBe(false);
  });

  it("harcama birimi ve IBAN eksiklerini sayar", () => {
    expect(kamuEngelleri({ harcamaBirimiVkn: "2222222105", harcamaBirimiAdi: "Kamu İhale Kurumu", iban: "TR330006100519786457841326" })).toEqual([]);
    const engeller = kamuEngelleri({ harcamaBirimiVkn: "123", harcamaBirimiAdi: " ", iban: null });
    expect(engeller.map((e) => e.alan)).toEqual(["harcamaBirimiVkn", "harcamaBirimiAdi", "iban"]);
    expect(kamuEngelleri({ harcamaBirimiVkn: "2222222105", harcamaBirimiAdi: "X", iban: "TR000000000000000000000001" })[0].alan).toBe("iban");
  });
});
