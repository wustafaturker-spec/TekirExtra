import { describe, expect, it } from "vitest";
import { ilkTurHatasi, KALITE_SENARYOLARI, sonTurHatasi } from "./kalite-senaryolari";

describe("AI kalite ölçütleri", () => {
  it("yanlış araç ve şemaya aykırı girdiler başarısızdır", () => {
    const s = KALITE_SENARYOLARI[0];
    expect(ilkTurHatasi(s, { metin: "", aracCagrilari: [{ id: "c1", ad: "stok_ara", girdi: {} }] })).not.toBeNull();
    expect(ilkTurHatasi(s, { metin: "", aracCagrilari: [{ id: "c1", ad: "cari_ara", girdi: { arama: 42 } }] })).not.toBeNull();
    expect(ilkTurHatasi(s, { metin: "", aracCagrilari: [{ id: "c1", ad: "cari_ara", girdi: { arama: "Başka firma" } }] })).not.toBeNull();
    expect(ilkTurHatasi(s, { metin: "", aracCagrilari: [{ id: "c1", ad: "cari_ara", girdi: { arama: "Yılmaz" } }] })).toBeNull();
  });
  it("belirsizlikte seçim, negatif stokta işaret ve alacakta tutar/para birimi aranır", () => {
    expect(sonTurHatasi(KALITE_SENARYOLARI[0], { metin: "Hangisini seçiyorsunuz?", aracCagrilari: [] })).toBeNull();
    expect(sonTurHatasi(KALITE_SENARYOLARI[0], { metin: "İlk cariyi seçtim.", aracCagrilari: [] })).not.toBeNull();
    expect(sonTurHatasi(KALITE_SENARYOLARI[1], { metin: "Stok -5 adet.", aracCagrilari: [] })).toBeNull();
    expect(sonTurHatasi(KALITE_SENARYOLARI[1], { metin: "Stok 5 adet.", aracCagrilari: [] })).not.toBeNull();
    expect(sonTurHatasi(KALITE_SENARYOLARI[2], { metin: "1.234,56 TL", aracCagrilari: [] })).toBeNull();
    expect(sonTurHatasi(KALITE_SENARYOLARI[2], { metin: "1.234,56 USD", aracCagrilari: [] })).not.toBeNull();
  });
});
