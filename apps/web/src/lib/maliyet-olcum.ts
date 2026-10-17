export const OLCUM_DOSYA_SINIRI = 64 * 1024;
export interface MaliyetOlcumu {
  surum: 1; olcumTuru: "anlik"; firma: { id: string; unvan: string };
  baslangic: string; bitis: string; kullanimModu: "salt_okunur" | "pilot" | "acik"; alindigiZaman: string;
  kapsam: { malSatisSatiri: number; takipliKaynakSatiri: number; kaynakKimlikOzeti: string };
  uyari: { satir: number; ciro: string; aktifTakipliSatir: number; aktifTakipsizSatir: number };
  incelemeler: { toplam: number; acik: number; incelemede: number; beklemede: number; dogrulanmisKapanis: number;
    digerKapanis: number; yoksayildi: number; medyanSureSaniye: string | null; sureOrnekSayisi: number; sureDisiKayit: number };
}
function hata(alan: string): never { throw new Error(`Ölçüm biçimi geçersiz: ${alan}. Geçerli sürüm 1 ölçüm verisi gerekli.`); }
function nesne(v: unknown, alanlar: string[], ad: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return hata(ad);
  const r = v as Record<string, unknown>;
  if (Object.keys(r).length !== alanlar.length || alanlar.some((k) => !Object.hasOwn(r, k))) return hata(ad);
  return r;
}
function sayi(v: unknown): v is number { return Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 20000; }
function ondalik(v: unknown, hane: number) { return typeof v === "string" && new RegExp(`^(0|[1-9][0-9]{0,29})\\.[0-9]{${hane}}$`).test(v); }
function gun(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
export function maliyetOlcumunuDogrula(v: unknown): MaliyetOlcumu {
  const r = nesne(v, ["surum", "olcumTuru", "firma", "baslangic", "bitis", "kullanimModu", "alindigiZaman", "kapsam", "uyari", "incelemeler"], "alanlar");
  if (r.surum !== 1 || r.olcumTuru !== "anlik") hata("sürüm veya ölçüm türü");
  const f = nesne(r.firma, ["id", "unvan"], "şirket");
  if (typeof f.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(f.id)
    || typeof f.unvan !== "string" || !f.unvan.trim() || f.unvan.length > 1000) hata("şirket");
  if (!gun(r.baslangic) || !gun(r.bitis) || Date.parse(r.bitis) < Date.parse(r.baslangic) || Date.parse(r.bitis) - Date.parse(r.baslangic) > 365 * 86400000) hata("satış dönemi");
  if (typeof r.kullanimModu !== "string" || !["salt_okunur", "pilot", "acik"].includes(r.kullanimModu)) hata("kullanım modu");
  const zaman = typeof r.alindigiZaman === "string" ? new Date(r.alindigiZaman) : null;
  if (!zaman || !Number.isFinite(zaman.getTime()) || zaman.toISOString() !== r.alindigiZaman) hata("ölçüm zamanı");
  const k = nesne(r.kapsam, ["malSatisSatiri", "takipliKaynakSatiri", "kaynakKimlikOzeti"], "kaynak kapsamı");
  if (!sayi(k.malSatisSatiri) || !sayi(k.takipliKaynakSatiri) || k.takipliKaynakSatiri > k.malSatisSatiri
    || typeof k.kaynakKimlikOzeti !== "string" || !/^[a-f0-9]{64}$/.test(k.kaynakKimlikOzeti)) hata("kaynak kapsamı özeti");
  const u = nesne(r.uyari, ["satir", "ciro", "aktifTakipliSatir", "aktifTakipsizSatir"], "uyarılar");
  if (!sayi(u.satir) || !sayi(u.aktifTakipliSatir) || !sayi(u.aktifTakipsizSatir) || !ondalik(u.ciro, 2)
    || u.satir > (k.malSatisSatiri as number) || u.aktifTakipliSatir + u.aktifTakipsizSatir !== u.satir
    || u.aktifTakipliSatir > (k.takipliKaynakSatiri as number) || (u.satir === 0) !== (u.ciro === "0.00")) hata("uyarı toplamları");
  const durumlar = ["acik", "incelemede", "beklemede", "dogrulanmisKapanis", "digerKapanis", "yoksayildi"];
  const i = nesne(r.incelemeler, ["toplam", ...durumlar, "medyanSureSaniye", "sureOrnekSayisi", "sureDisiKayit"], "incelemeler");
  if (["toplam", ...durumlar, "sureOrnekSayisi", "sureDisiKayit"].some((ad) => !sayi(i[ad]))
    || durumlar.reduce((t, ad) => t + (i[ad] as number), 0) !== i.toplam
    || (k.takipliKaynakSatiri as number) > (i.toplam as number)
    || (u.aktifTakipliSatir as number) > (i.acik as number) + (i.incelemede as number) + (i.beklemede as number)
    || (i.sureOrnekSayisi as number) + (i.sureDisiKayit as number) !== i.dogrulanmisKapanis
    || (i.sureOrnekSayisi === 0 ? i.medyanSureSaniye !== null : !ondalik(i.medyanSureSaniye, 3))) hata("inceleme toplamları veya medyan");
  return { ...(v as MaliyetOlcumu), firma: { id: (f.id as string).toLowerCase(), unvan: f.unvan as string } };
}
export function maliyetOlcumDosyasiniOku(metin: string): MaliyetOlcumu {
  if (new TextEncoder().encode(metin).byteLength > OLCUM_DOSYA_SINIRI) throw new Error("Ölçüm dosyası en fazla 64 KB olabilir.");
  let veri: unknown;
  try { veri = JSON.parse(metin.replace(/^\uFEFF/, "")); } catch { throw new Error("Dosya geçerli bir JSON ölçüm dosyası değil."); }
  return maliyetOlcumunuDogrula(veri);
}
function birimeCevir(v: string): bigint { return BigInt(v.replace(".", "")); }
function sabit(v: bigint, hane: number): string {
  const isaret = v < 0n ? "-" : "", s = (v < 0n ? -v : v).toString().padStart(hane + 1, "0");
  return isaret + (hane ? `${s.slice(0, -hane)}.${s.slice(-hane)}` : s);
}
export function olcumSayiBicimi(v: string): string {
  const [tam, kesir] = v.split(".");
  return tam.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (kesir === undefined ? "" : `,${kesir}`);
}
export function maliyetOlcumleriniKarsilastir(baz: MaliyetOlcumu, guncel: MaliyetOlcumu) {
  // Her iki taraf da doğrulanır; dosya kaynak doğruluğu veya imzası olarak kabul edilmez.
  baz = maliyetOlcumunuDogrula(baz); guncel = maliyetOlcumunuDogrula(guncel);
  if (baz.firma.id !== guncel.firma.id) throw new Error("Ölçümler farklı şirketlere ait; karşılaştırılamaz.");
  if (baz.baslangic !== guncel.baslangic || baz.bitis !== guncel.bitis) throw new Error("Ölçümlerin satış dönemleri farklı; aynı dönemi seçin.");
  if (baz.kapsam.kaynakKimlikOzeti !== guncel.kapsam.kaynakKimlikOzeti || baz.kapsam.malSatisSatiri !== guncel.kapsam.malSatisSatiri) throw new Error("Satış satırı kapsamı değişmiş; bu ölçümler karşılaştırılamaz.");
  if (Date.parse(baz.alindigiZaman) >= Date.parse(guncel.alindigiZaman)) throw new Error("Önceki ölçümün zamanı güncel ölçümden eski olmalı.");
  const satir = (ad: string, once: number | string | null, sonra: number | string | null, hane = 0) => ({
    ad, baz: once === null ? null : String(once), guncel: sonra === null ? null : String(sonra),
    fark: once === null || sonra === null ? null : sabit(birimeCevir(String(sonra)) - birimeCevir(String(once)), hane),
  });
  return { modDegisti: baz.kullanimModu !== guncel.kullanimModu, satirlar: [
    satir("Uyarı verilen satış satırı", baz.uyari.satir, guncel.uyari.satir),
    satir("İlgili uyarı cirosu (TRY)", baz.uyari.ciro, guncel.uyari.ciro, 2),
    satir("Aktif takipsiz uyarı satırı", baz.uyari.aktifTakipsizSatir, guncel.uyari.aktifTakipsizSatir),
    satir("Aktif takipli uyarı satırı", baz.uyari.aktifTakipliSatir, guncel.uyari.aktifTakipliSatir),
    satir("Açık inceleme kaydı", baz.incelemeler.acik, guncel.incelemeler.acik),
    satir("İncelemede olan kayıt", baz.incelemeler.incelemede, guncel.incelemeler.incelemede),
    satir("Bekleyen inceleme kaydı", baz.incelemeler.beklemede, guncel.incelemeler.beklemede),
    satir("Doğrulanmış kapanış kaydı", baz.incelemeler.dogrulanmisKapanis, guncel.incelemeler.dogrulanmisKapanis),
    satir("Diğer kapanış kaydı", baz.incelemeler.digerKapanis, guncel.incelemeler.digerKapanis),
    satir("Yoksayılmış inceleme kaydı", baz.incelemeler.yoksayildi, guncel.incelemeler.yoksayildi),
    satir("Medyan süre (saniye)", baz.incelemeler.medyanSureSaniye, guncel.incelemeler.medyanSureSaniye, 3),
    satir("Geçerli süre örneği", baz.incelemeler.sureOrnekSayisi, guncel.incelemeler.sureOrnekSayisi),
  ] };
}
