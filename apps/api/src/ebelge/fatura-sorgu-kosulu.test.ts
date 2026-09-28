import { describe, expect, it } from "vitest";
import { faturaSorguKosulu, faturaSorguSureleriniOku } from "./fatura-sorgu-kosulu";

const GUN = 86_400_000;
const simdi = Date.UTC(2026, 8, 15, 12);

function dallar() {
  const kosul = faturaSorguKosulu("t1", simdi, { efaturaYanitGunSayisi: 10, earsivIptalGunSayisi: 8 });
  return (kosul.AND as { OR: Record<string, any>[] }[])[0].OR;
}

describe("faturaSorguKosulu (EBLG-40)", () => {
  it("referanslı kuyruktaki belgeyi süresiz sorar", () => {
    const kosul = faturaSorguKosulu("t1", simdi, { efaturaYanitGunSayisi: 10, earsivIptalGunSayisi: 8 });
    expect(kosul).toMatchObject({ tenantId: "t1", entegratorRef: { not: null } });
    expect(dallar()[0]).toEqual({ durum: "kuyrukta" });
  });

  it("iletildi e-Faturayı yalnız ticari profilde ve yanıt süresi içinde sorar; temeli sormaz", () => {
    const efatura = dallar().filter((d) => d.tur === "efatura" && !d.entegratorDurumu);
    expect(efatura).toHaveLength(1);
    expect(efatura[0]).toMatchObject({ durum: "iletildi", fatura: { efaturaProfili: "ticari" } });
    expect(efatura[0].createdAt.gte.getTime()).toBe(simdi - 10 * GUN);
  });

  it("GİB'in alıcıya teslimini bekleyen (1200) e-Faturayı profilden bağımsız sormaya devam eder (EBLG-112)", () => {
    const bekleyen = dallar().filter((d) => d.entegratorDurumu);
    expect(bekleyen).toHaveLength(1);
    expect(bekleyen[0]).toMatchObject({ durum: "iletildi", tur: "efatura", entegratorDurumu: "EnvelopeIsWaitingToBeSendedToReceiverByGib" });
    expect(bekleyen[0].fatura).toBeUndefined();
    expect(bekleyen[0].createdAt.gte.getTime()).toBe(simdi - 10 * GUN);
  });

  it("iletildi e-Arşivi iptal edilebildiği gün boyunca sorar", () => {
    const earsiv = dallar().find((d) => d.tur === "earsiv")!;
    expect(earsiv.durum).toBe("iletildi");
    // İptal tam gün farkına bakar: 8. günün sonuna kadar iptal edilebilir.
    expect(earsiv.fatura.tarih.gte.getTime()).toBe(simdi - 9 * GUN);
  });

  it("süreleri modül ayarından okur, yoksa varsayılana düşer", () => {
    expect(faturaSorguSureleriniOku({})).toEqual({ efaturaYanitGunSayisi: 10, earsivIptalGunSayisi: 8 });
    expect(faturaSorguSureleriniOku({ efaturaYanitGunSayisi: 15, earsivIptalGunSayisi: 30 })).toEqual({ efaturaYanitGunSayisi: 15, earsivIptalGunSayisi: 30 });
  });
});
