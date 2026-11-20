import {
  EKRAN_DURUMLARI, FORM_SATIR_SINIRI, FORM_TANIMLARI, SATIR_ALANLARI, ekranSuzgecDegeri, panelYolunuCoz, tutarKaynaktaVar,
  type ArayuzEylemi, type ArayuzEylemSonucu, type EkranDurumTanimi, type EkranDurumu, type FormAlanTuru, type FormSatiri, type FormTanimi,
} from "@tekirextra/shared";
import { z } from "zod";
import { arac, type AjanAraci } from "./araclar/arac";
import { UC } from "./araclar/uclar";
import { kimlikSuzgeci, seciliKayitlariOku } from "./ekran-durumu";
import type { UcCagirici } from "./uc-cagirici";

/**
 * AI-114: arayüz eylemi araçları. Model çağırır; sunucu şema, izin listesi ve kayıt
 * yetkisiyle doğrular; eylem yanıtla tarayıcıya gider ve orada uygulanır. Araçlar kayıt
 * oluşturmaz, onay gerektirmez, yalnız web kanalında sunulur (Telegram ve MCP'de yok).
 * Yürütme `calistir` ile değil döngüdeki `arayuzEylemiHazirla` ile yapılır: doğrulama bu
 * turun ekran durumunu, kullanıcı mesajını ve araç çıktılarını ister.
 */

/** Bir turda en çok bu kadar arayüz eylemi. */
export const TUR_EYLEM_SINIRI = 5;

const alanDegerListesi = z.array(z.object({ alan: z.string().max(40), deger: z.union([z.string().max(500), z.number()]) })).max(20);

const calismaz = async (): Promise<never> => { throw new Error("Arayüz eylemi döngüde hazırlanır"); };

export const ARAYUZ_ARACLARI: AjanAraci[] = [
  arac({
    ad: "sayfaya_git",
    aciklama: "Kullanıcının ekranını bir panel sayfasına götürür (ör. /panel/fatura?yon=satis, /panel/cari/<id>). Yalnız /panel altındaki yollar; kayıt kimliği araç sonucundan gelmeli. Kullanıcı bir ekranı açmanı ya da 'göster' dediğinde kullan.",
    sinif: "arayuz",
    girdi: z.object({ yol: z.string().min(6).max(200).describe("Panel yolu, /panel ile başlar") }),
    uc: UC.bildirimOzet,
    calistir: calismaz,
  }),
  arac({
    ad: "suzgec_uygula",
    aciklama: "Kullanıcının açık liste ekranında süzgeç uygular (ekran durumundaki süzgeç alanları). Başka ekrandaysa önce sayfaya_git kullan. Kullanıcı listeyi daraltmanı istediğinde kullan.",
    sinif: "arayuz",
    girdi: z.object({ suzgecler: alanDegerListesi.describe("Ekran süzgeç alanı ve değeri; boş değer süzgeci kaldırır") }),
    uc: UC.bildirimOzet,
    calistir: calismaz,
  }),
  arac({
    ad: "sekme_ac",
    aciklama: "Kullanıcının açık ekranında bir sekmeyi açar (ekranın sekme kodu).",
    sinif: "arayuz",
    girdi: z.object({ sekme: z.string().max(40) }),
    uc: UC.bildirimOzet,
    calistir: calismaz,
  }),
  arac({
    ad: "kayit_vurgula",
    aciklama: "Kullanıcının açık listesinde kayıtları vurgular ve ilkine kaydırır (fatura, belge, cari, gelen e-Fatura kimlikleri).",
    sinif: "arayuz",
    girdi: z.object({ idler: z.array(z.string().uuid()).min(1).max(20) }),
    uc: UC.bildirimOzet,
    calistir: calismaz,
  }),
  arac({
    ad: "formu_doldur",
    aciklama: "Ekranda açık ve düzenlenebilir formun (ekran durumundaki form) alanlarını ve kalemlerini doldurur; KAYDETMEZ, kaydı kullanıcı yapar. Tutar ve fiyatları yalnız kullanıcının mesajından ya da araç sonuçlarından al; uydurma. Ürün kimlikleri stok_ara sonucundan gelmeli.",
    sinif: "arayuz",
    girdi: z.object({
      alanlar: alanDegerListesi.optional().describe("Form alanı ve değeri"),
      satirlar: z.array(z.object({
        stokId: z.string().uuid(),
        miktar: z.number().positive().max(1e9),
        birimFiyat: z.number().min(0).max(1e12).optional(),
        kdvOrani: z.number().min(0).max(100).optional(),
        iskontoOrani: z.number().min(0).max(100).optional(),
      })).max(FORM_SATIR_SINIRI).optional().describe("Kalemler; verilirse formdaki kalemlerin yerine geçer"),
    }),
    uc: UC.bildirimOzet,
    calistir: calismaz,
  }),
];

export const ARAYUZ_ARAC_ADLARI = new Set(ARAYUZ_ARACLARI.map((a) => a.ad));

/** Kullanıcı açıkça bir ekran açılmasını istiyor mu ("…sayfasını aç", "beni … götür", "ekrana git"). */
const YONLENDIRME_NIYETI = /(sayfa|ekran|menü|menu)(s[ıi]n[ıi]|y[ıi]|ya|ye|da|de)?\s*(aç|ac|git|götür|gotur|getir)|götür|gotur|yönlendir|yonlendir|(^|\s)(git|aç|ac)([\s.!?,]|$)|gidelim|açar m[ıi]s[ıi]n|açabilir misin/iu;

/**
 * AI-114: arayüz araçları yalnız işe yarayacakları durumda modele sunulur. Her mesajda
 * sunulduklarında model yetkisiz istekte reddetmek yerine ilgili sayfaya yönlendirmeye
 * kaydı (2026-11-20 değerlendirmesi, yetki senaryoları). Kural: süzgeç/sekme/vurgulama
 * yalnız liste ekranı durumu varken, form doldurma yalnız açık form varken, sayfaya_git
 * yalnız kullanıcı açıkça ekran açılmasını istediğinde.
 */
export function arayuzAraclariniSec<T extends { ad: string; sinif: string }>(izinli: T[], g: { durum?: EkranDurumu; mesaj: string }): T[] {
  const yonlendirme = YONLENDIRME_NIYETI.test(g.mesaj);
  return izinli.filter((a) => {
    if (a.sinif !== "arayuz") return true;
    if (a.ad === "sayfaya_git") return yonlendirme;
    if (a.ad === "formu_doldur") return !!g.durum?.form;
    return !!g.durum;
  });
}

export interface ArayuzBaglami {
  uc: UcCagirici;
  durum?: EkranDurumu;
  /** Ekran kaydı/yol kimliği okuyucu (sunucudaki ekran ucu, kullanıcının rolüyle). */
  kayitOku: (tur: string, id: string) => Promise<unknown>;
  /** Tutar denetimi kaynağı: kullanıcının mesajı + bu turdaki araç çıktıları. */
  kaynakMetni: string;
}

type Hazirlik = { eylem: ArayuzEylemi; ozet: string } | { hata: string };

function formDegeri(tur: FormAlanTuru, deger: unknown, kaynak: string): { deger: string | number } | { hata: string } {
  switch (tur) {
    case "metin": {
      const d = String(deger ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 500);
      return { deger: d };
    }
    case "tarih": return typeof deger === "string" && /^\d{4}-\d{2}-\d{2}$/.test(deger) ? { deger } : { hata: "tarih YYYY-AA-GG olmalı" };
    case "para": case "oran": case "sayi": {
      const n = typeof deger === "number" ? deger : Number(String(deger).replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return { hata: "sayı olmalı" };
      if (tur === "oran" && n > 100) return { hata: "oran 0–100 olmalı" };
      // AI-111 kuralı: tutar yalnız kullanıcının yazdığı ya da araçtan gelen değer olabilir.
      if (tur === "para" && !tutarKaynaktaVar(n, kaynak)) return { hata: `${n} tutarı kullanıcının mesajında ya da araç sonuçlarında yok; tutarı uydurma, kullanıcıya sor` };
      return { deger: n };
    }
    case "cari": case "stok":
      return typeof deger === "string" && /^[0-9a-f-]{36}$/i.test(deger) ? { deger: deger.toLowerCase() } : { hata: "kimlik UUID olmalı" };
  }
}

/** Model çağrısını doğrulanmış arayüz eylemine çevirir; olmazsa modele dönecek neden. */
export async function arayuzEylemiHazirla(ad: string, girdi: Record<string, unknown>, b: ArayuzBaglami): Promise<Hazirlik> {
  const tanim = ARAYUZ_ARACLARI.find((a) => a.ad === ad);
  if (!tanim) return { hata: "Bilinmeyen arayüz eylemi" };
  const ayristirma = tanim.girdi.safeParse(girdi);
  if (!ayristirma.success) return { hata: `Geçersiz parametre: ${ayristirma.error.issues.map((s) => `${s.path.join(".")}: ${s.message}`).join("; ")}` };
  const g = ayristirma.data as Record<string, any>;
  const ekranTanimi: EkranDurumTanimi | undefined = b.durum ? EKRAN_DURUMLARI[b.durum.ekran] : undefined;

  if (ad === "sayfaya_git") {
    const c = panelYolunuCoz(g.yol);
    if (!c) return { hata: "Yol izinli değil: yalnız /panel altındaki ekranlar, bilinen sorgu parametreleri ve kimlik yolları." };
    for (const k of c.kayitlar) {
      try { await b.kayitOku(k.tur, k.id); } catch { return { hata: "Yoldaki kayıt bulunamadı ya da kullanıcının bu kayda yetkisi yok; yönlendirme yapılmadı." }; }
    }
    return { eylem: { tur: "sayfaya_git", yol: c.yol }, ozet: `${c.yol} açılacak` };
  }

  if (!b.durum || !ekranTanimi) return { hata: "Kullanıcının ekranında bu eylemi destekleyen bir liste ya da form yok; gerekirse önce sayfaya_git ile ekranı aç." };

  if (ad === "suzgec_uygula") {
    const suzgecler: Record<string, string> = {};
    for (const { alan, deger } of g.suzgecler as Array<{ alan: string; deger: string | number }>) {
      const t = Object.prototype.hasOwnProperty.call(ekranTanimi.suzgecler, alan) ? ekranTanimi.suzgecler[alan] : undefined;
      if (!t) return { hata: `"${alan}" bu ekranın süzgeci değil. Süzgeçler: ${Object.keys(ekranTanimi.suzgecler).join(", ")}` };
      if (deger === "" ) { suzgecler[alan] = ""; continue; }
      const temiz = ekranSuzgecDegeri(t.tur, String(deger));
      if (temiz === null) return { hata: `"${alan}" değeri biçime uymuyor (${t.tur})` };
      if ((t.tur === "cari" || t.tur === "banka" || t.tur === "hesap") && !(await kimlikSuzgeci(b.uc, t.tur, temiz))) return { hata: `"${alan}" kaydı bulunamadı ya da yetki dışı` };
      suzgecler[alan] = temiz;
    }
    return { eylem: { tur: "suzgec_uygula", ekran: b.durum.ekran, suzgecler }, ozet: `${ekranTanimi.ad}: ${Object.entries(suzgecler).map(([a, d]) => `${ekranTanimi.suzgecler[a]?.ad ?? a}=${d || "(kaldır)"}`).join(", ")}` };
  }

  if (ad === "sekme_ac") {
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(g.sekme)) return { hata: "Sekme kodu geçersiz" };
    return { eylem: { tur: "sekme_ac", ekran: b.durum.ekran, sekme: g.sekme }, ozet: `${ekranTanimi.ad}: ${g.sekme} sekmesi` };
  }

  if (ad === "kayit_vurgula") {
    if (!ekranTanimi.seciliTur) return { hata: "Bu ekranda kayıt vurgulanamaz" };
    const okunan = await seciliKayitlariOku(b.uc, ekranTanimi.seciliTur, g.idler);
    if (!okunan.length) return { hata: "Kayıtlar bulunamadı ya da yetki dışı" };
    return { eylem: { tur: "kayit_vurgula", ekran: b.durum.ekran, idler: okunan.map((k) => k.id) }, ozet: `${okunan.length} kayıt vurgulanacak` };
  }

  // formu_doldur
  if (!b.durum.form) return { hata: "Ekranda açık ve düzenlenebilir bir form yok (kesinleşmiş belge doldurulamaz)." };
  const form: FormTanimi = FORM_TANIMLARI[b.durum.form];
  const alanlar: Record<string, string | number> = {};
  for (const { alan, deger } of (g.alanlar ?? []) as Array<{ alan: string; deger: string | number }>) {
    const t = Object.prototype.hasOwnProperty.call(form.alanlar, alan) ? form.alanlar[alan] : undefined;
    if (!t) return { hata: `"${alan}" ${form.ad} alanı değil. Alanlar: ${Object.keys(form.alanlar).join(", ")}` };
    const d = formDegeri(t.tur, deger, b.kaynakMetni);
    if ("hata" in d) return { hata: `${t.ad}: ${d.hata}` };
    if (t.tur === "cari") { try { await b.kayitOku("cari", String(d.deger)); } catch { return { hata: "Cari bulunamadı ya da yetki dışı" }; } }
    alanlar[alan] = d.deger;
  }
  let satirlar: FormSatiri[] | undefined;
  if (g.satirlar) {
    if (!form.satirlar) return { hata: `${form.ad} kalem almaz` };
    satirlar = [];
    for (const [i, s] of (g.satirlar as FormSatiri[]).entries()) {
      for (const [alan, t] of Object.entries(SATIR_ALANLARI)) {
        const v = (s as unknown as Record<string, unknown>)[alan];
        if (v === undefined || t.tur === "stok") continue;
        const d = formDegeri(t.tur, v, b.kaynakMetni);
        if ("hata" in d) return { hata: `${i + 1}. kalem ${t.ad}: ${d.hata}` };
      }
      try { await b.kayitOku("stok", s.stokId); } catch { return { hata: `${i + 1}. kalemin ürünü bulunamadı ya da yetki dışı` }; }
      satirlar.push(s);
    }
  }
  if (!Object.keys(alanlar).length && !satirlar?.length) return { hata: "Doldurulacak alan verilmedi" };
  return { eylem: { tur: "formu_doldur", form: b.durum.form, alanlar, ...(satirlar ? { satirlar } : {}) }, ozet: `${form.ad}: ${[...Object.keys(alanlar).map((a) => form.alanlar[a]?.ad ?? a), ...(satirlar ? [`${satirlar.length} kalem`] : [])].join(", ")} doldurulacak` };
}

/** Önceki turun tarayıcı sonuçları modele kısa not olarak gider. */
export function arayuzSonucMetni(sonuclar: ArayuzEylemSonucu[]): string {
  if (!sonuclar.length) return "";
  const ad: Record<string, string> = { basarili: "uygulandı", ekran_bulunamadi: "ekran bulunamadı, uygulanmadı", alan_yok: "alan bulunamadı, uygulanmadı", geri_alindi: "kullanıcı geri aldı", hata: "uygulanamadı" };
  return `\n\nÖNCEKİ ARAYÜZ EYLEMLERİNİN SONUCU (tarayıcıdan): ${sonuclar.map((s) => `${s.tur}: ${ad[s.sonuc]}`).join("; ")}. Uygulanmayan ya da geri alınan eylemi yapılmış sayma.`;
}
