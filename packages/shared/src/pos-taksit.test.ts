import { describe, expect, it } from "vitest";
import { posAcikTaksitler, posAzamiTaksit, posTaksitBosluklari, posTaksitOrani } from "./pos-taksit";

describe("KSB-35 POS taksit tablosu", () => {
  it("boş tablo yalnız tek çekim açar", () => {
    expect(posAcikTaksitler([])).toEqual([1]);
    expect(posAzamiTaksit([])).toBe(1);
    expect(posTaksitBosluklari([])).toEqual([]);
  });
  it("taksitleri sıralar, tekrarı ve aralık dışını atar", () => {
    const tablo = [{ taksit: 6, oran: "5" }, { taksit: 3, oran: "3" }, { taksit: 3, oran: "3" }, { taksit: 1, oran: "9" }, { taksit: 15, oran: "9" }];
    expect(posAcikTaksitler(tablo)).toEqual([1, 3, 6]);
    expect(posAzamiTaksit(tablo)).toBe(6);
  });
  it("PayTR için tanımsız ara taksitleri bildirir", () => {
    expect(posTaksitBosluklari([{ taksit: 3, oran: "3" }, { taksit: 6, oran: "5" }])).toEqual([2, 4, 5]);
  });
  it("tabloda olmayan taksitte tek çekim oranına düşer", () => {
    const hesap = { komisyonOrani: "1.99", taksitOranlari: [{ taksit: 3, oran: "3.49" }] };
    expect(posTaksitOrani(hesap, 1)).toBe("1.99");
    expect(posTaksitOrani(hesap, 3)).toBe("3.49");
    expect(posTaksitOrani(hesap, 6)).toBe("1.99");
  });
});
