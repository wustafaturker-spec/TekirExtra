import type { AiAracliYanit } from "../saglayici/ai-provider.interface";
import { aracBul } from "../ajan/araclar";
import { uydurmaNedeni } from "../ajan/yanit-denetimi";

export const KALITE_SENARYOLARI = [
  { id: "belirsiz-cari", talimat: "Test Yılmaz firmasının bakiyesini bul.", arac: "cari_ara", sonuc: { kayitlar: [{ id: "11111111-1111-4111-8111-111111111111", unvan: "Test Yılmaz A" }, { id: "22222222-2222-4222-8222-222222222222", unvan: "Test Yılmaz B" }], not: "İki aday var. Kullanıcıya hangisini istediğini sor." } },
  { id: "negatif-stok", talimat: "Test A4 kağıdının stok miktarı kaç?", arac: "stok_ara", sonuc: { kayitlar: [{ id: "33333333-3333-4333-8333-333333333333", ad: "Test A4", mevcutMiktar: -5, anaBirim: "adet" }] } },
  { id: "vadeli-alacak", talimat: "Vadesi geçmiş toplam alacağımız kaç TL?", arac: "vadesi_gecen_alacaklar", sonuc: { toplamAlacakTry: "1234.56", alacakSayisi: 1, toplamBorcTry: "0", borcSayisi: 0, enEskiAlacaklar: [], enEskiBorclar: [] } },
] as const;
export type KaliteSenaryosu = typeof KALITE_SENARYOLARI[number];

export function ilkTurHatasi(s: KaliteSenaryosu, yanit: AiAracliYanit): string | null {
  if (yanit.aracCagrilari.length !== 1 || yanit.aracCagrilari[0].ad !== s.arac) return `Beklenen tek araç: ${s.arac}`;
  if (!aracBul(s.arac)?.girdi.safeParse(yanit.aracCagrilari[0].girdi).success) return "Araç girdisi şemaya uymuyor";
  if (s.arac !== "vadesi_gecen_alacaklar") {
    const arama = String(yanit.aracCagrilari[0].girdi.arama ?? "").toLocaleLowerCase("tr-TR").replace(/ı/g, "i");
    const hedef = s.id === "belirsiz-cari" ? "yilmaz" : "a4";
    if (!arama.includes(hedef)) return "Arama metni istenen kayıtla eşleşmiyor";
  }
  return uydurmaNedeni(yanit.metin, { aracCiktilari: [], talepSayisi: 0, baglamMetni: s.talimat });
}

export function sonTurHatasi(s: KaliteSenaryosu, yanit: AiAracliYanit): string | null {
  if (yanit.aracCagrilari.length) return "Sonuçtan sonra ek araç/işlem isteniyor";
  const uydurma = uydurmaNedeni(yanit.metin, { aracCiktilari: [JSON.stringify(s.sonuc)], talepSayisi: 0, baglamMetni: s.talimat });
  if (uydurma) return uydurma;
  if (s.id === "belirsiz-cari" && !/hangi|hangisi|seçiniz|seçin\b|seçiminizi|belirtin/i.test(yanit.metin)) return "Belirsiz cari için seçim sorulmadı";
  if (s.id === "negatif-stok" && !/[-−]\s*5\b/.test(yanit.metin)) return "Negatif stok işareti korunmadı";
  if (s.id === "vadeli-alacak" && (!/\b1[.,\s]?234[.,]56\b/.test(yanit.metin) || !/TRY|TL|lira/i.test(yanit.metin))) return "Alacak tutarı veya para birimi yanlış";
  return yanit.metin.trim() ? null : "Yanıt boş";
}
