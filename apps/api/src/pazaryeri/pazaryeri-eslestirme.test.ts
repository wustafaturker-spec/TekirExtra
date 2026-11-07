import { describe, expect, it } from "vitest";
import { eslesmeOnerisi, unvanPazaryerineUyar, vknGecerli } from "./pazaryeri-eslestirme";

const g = (gun: number) => new Date(Date.UTC(2026, 9, gun));
const k = (id: string, gun: number, tutar: number) => ({ id, tarih: g(gun), tutar });

describe("PZR-07 eşleştirme önerisi", () => {
  const adaylar = [k("a", 1, 10), k("b", 5, 20), k("c", 9, 30), k("d", 12, 40), k("e", 25, 99)];

  it("fatura tarihine kadarki ardışık dilimi bulur; en yakın tarihli dilim önce", () => {
    expect(eslesmeOnerisi({ tarih: g(15), toplam: 70 }, adaylar)).toEqual({ kesintiIds: ["c", "d"], toplam: "70.00" });
    expect(eslesmeOnerisi({ tarih: g(15), toplam: 100 }, adaylar)).toEqual({ kesintiIds: ["a", "b", "c", "d"], toplam: "100.00" });
  });

  it("fatura tarihinden sonraki kesinti girmez; kuruş toleransı; bulunamazsa null", () => {
    expect(eslesmeOnerisi({ tarih: g(15), toplam: 99 }, adaylar)).toBeNull();
    expect(eslesmeOnerisi({ tarih: g(30), toplam: 99.01 }, adaylar)).toEqual({ kesintiIds: ["e"], toplam: "99.00" });
    expect(eslesmeOnerisi({ tarih: g(15), toplam: 55 }, adaylar)).toBeNull();
    expect(eslesmeOnerisi({ tarih: g(15), toplam: 0 }, adaylar)).toBeNull();
  });

  it("ünvandan pazaryeri ve VKN biçimi", () => {
    expect(unvanPazaryerineUyar("amazon_tr", "AMAZON TURKEY PERAKENDE HİZMETLERİ LTD. ŞTİ.")).toBe(true);
    expect(unvanPazaryerineUyar("trendyol", "DSM GRUP DANIŞMANLIK İLETİŞİM VE SATIŞ TİC. A.Ş.")).toBe(true);
    expect(unvanPazaryerineUyar("hepsiburada", "D-MARKET ELEKTRONİK HİZMETLER")).toBe(true);
    expect(unvanPazaryerineUyar("amazon_tr", "KARSEL BOYA")).toBe(false);
    expect([vknGecerli("1234567890"), vknGecerli("12345678901"), vknGecerli("12345"), vknGecerli("12a4567890")]).toEqual([true, true, false, false]);
  });
});
