import { describe, expect, it } from "vitest";
import { bankaSorusu, dugmeCoz, dugmeVerisi, epostaSorusu, maasSatiriMi, taslakSapmasi, taslakSorusu } from "./asistan-soru.kurallari";

const g = (vadeGun: number | null, iskontoYuzde = 0) => ({ vadeGun, iskontoYuzde });

describe("taslak sapması (CNL-09)", () => {
  it("vade, son faturaların ortancasından en az 15 gün ve yarısı kadar saparsa sorulur", () => {
    expect(taslakSapmasi(g(90), [g(30), g(30), g(45)], null)).toEqual({ alan: "vade", taslak: 90, olagan: 30 });
    expect(taslakSapmasi(g(40), [g(30), g(30), g(30)], null)).toBeNull(); // 10 gün fark
    expect(taslakSapmasi(g(0), [g(60), g(60), g(60)], null)).toEqual({ alan: "vade", taslak: 0, olagan: 60 });
  });

  it("geçmiş azsa carinin varsayılan vadesiyle kıyaslanır; o da yoksa vade sorulmaz", () => {
    expect(taslakSapmasi(g(60), [g(30)], 14)).toEqual({ alan: "vade", taslak: 60, olagan: 14 });
    expect(taslakSapmasi(g(60), [], null)).toBeNull();
  });

  it("iskonto, geçmişin en yükseğini 5 puan aşarsa sorulur; geçmiş azsa sorulmaz", () => {
    expect(taslakSapmasi(g(30, 15), [g(30, 5), g(30, 8), g(30, 0)], null)).toEqual({ alan: "iskonto", taslak: 15, olagan: 8 });
    expect(taslakSapmasi(g(30, 12), [g(30, 8), g(30, 8), g(30, 8)], null)).toBeNull();
    expect(taslakSapmasi(g(30, 40), [g(30, 0)], null)).toBeNull();
  });
});

describe("soru metinleri", () => {
  it("banka: önerilen cari varsa evet/hayır, yoksa serbest yanıt; çıkış eksi işaretsiz yazılır", () => {
    const a = bankaSorusu({ tarih: "2026-11-10", tutar: "-1500.00", dovizCinsi: "TRY", aciklama: "EFT  ABC  LTD", karsiUnvan: null, onerilenCari: { id: "c", unvan: "ABC Ltd." } });
    expect(a.soru).toContain("10.11.2026 tarihli 1.500,00 TL çıkış, “EFT ABC LTD”");
    expect(a.secenekler.map((s) => s.kod)).toEqual(["evet", "hayir", "panel"]);
    expect(bankaSorusu({ tarih: "2026-11-10", tutar: "20", dovizCinsi: "USD", aciklama: "X", karsiUnvan: "Y", onerilenCari: null }).secenekler.map((s) => s.kod)).toEqual(["panel"]);
  });

  it("e-posta: en çok üç aday, ilgisiz ve panel seçenekleri", () => {
    const s = epostaSorusu({ gonderenAdi: "Ali", gonderenEposta: "ali@x.com", konu: "Teklif", adaylar: [1, 2, 3, 4].map((i) => ({ cariId: `c${i}`, unvan: `Cari ${i}` })) });
    expect(s.secenekler.map((x) => x.kod)).toEqual(["cari0", "cari1", "cari2", "ilgisiz", "panel"]);
    expect(s.soru).toContain("Ali <ali@x.com>, konu “Teklif”");
  });

  it("taslak: vade sorusunda alışılmışa çekme seçeneği, iskontoda yalnız onay", () => {
    expect(taslakSorusu({ cariUnvan: "A", tutar: "100", dovizCinsi: "TRY", sapma: { alan: "vade", taslak: 90, olagan: 30 } }).secenekler.map((x) => x.kod)).toEqual(["dogru", "olagan", "panel"]);
    expect(taslakSorusu({ cariUnvan: "A", tutar: "100", dovizCinsi: "TRY", sapma: { alan: "iskonto", taslak: 15, olagan: 8 } }).secenekler.map((x) => x.kod)).toEqual(["dogru", "panel"]);
  });

  it("maaş görünümlü banka satırı tanınır (Telegram'a sorulmaz)", () => {
    expect(maasSatiriMi("KASIM MAAS ODEMESI", null)).toBe(true);
    expect(maasSatiriMi("EFT", "Ücret avansı")).toBe(true);
    expect(maasSatiriMi("FATURA 2026-11 ODEMESI", "ABC LTD")).toBe(false);
  });
});

describe("Telegram düğme verisi", () => {
  it("64 baytı aşmaz ve geri çözülür; bozuk veri reddedilir", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const v = dugmeVerisi(id, "cari2");
    expect(Buffer.byteLength(v)).toBeLessThanOrEqual(64);
    expect(dugmeCoz(v)).toEqual({ soruId: id, kod: "cari2" });
    expect(dugmeCoz(`s:${id}:KÖTÜ`)).toBeNull();
    expect(dugmeCoz("x")).toBeNull();
  });
});
