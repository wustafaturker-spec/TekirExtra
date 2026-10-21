/**
 * Gelen alış denetçisi (EBLG-144…149).
 *
 * EBLG-115 kapısı aktarılamayan belgeyi durdurur; bu kurallar aktarılabilen
 * ama büyük olasılıkla yanlış kesilmiş ya da şüpheli alış faturasını,
 * faturaya işlenmeden ve ödenmeden önce söyler. Giden ön denetçi gibi
 * belirlenimcidir ve veritabanına dokunmaz: API geçmişi toplar, burada
 * yalnız karşılaştırılır. Uyarı onayla geçilir (EBLG-150), bilgi gösterilir.
 */
import { ALISKANLIK_EN_AZ, onKati, unvanlarUyumlu, type OnDenetimBulgusu } from "./on-denetim";

/** EBLG-145: gelen fiyatta kat hatası toleransı (fiyatlar zamanla oynar; giden ±%2'den geniş). */
export const GELEN_KAT_TOLERANSI = 0.1;
/** EBLG-149: vade karttakinden bu kadar günden fazla kısaysa uyarı. */
export const GELEN_VADE_PAYI_GUN = 5;

export interface GelenFiyatReferansi {
  fiyat: number;
  /** tedarikci: aynı tedarikçinin son alışı; donem: son 90 günün tüm tedarikçi ortalaması. */
  kaynak: "tedarikci" | "donem";
  faturaId?: string;
  faturaNo?: string | null;
}

export interface GelenDenetimSatiri {
  sira: number;
  ad: string;
  /** Kullanıcının ya da önerinin eşleştirdiği kart; eşleşmediyse null. */
  stok: { id: string; ad: string; tip: "urun" | "hizmet" | "sarf"; kdvOrani: number } | null;
  miktar: number;
  birim: string;
  /** İskontolar sonrası, KDV ve ek vergiler hariç birim fiyat (belge dövizinde). */
  netBirimFiyat: number;
  kdvOrani: number;
  tevkifatKodu: string | null;
  /** Karşılaştırılabilir geçmiş alış (aynı ürün/varyant, birim, döviz); yoksa null. */
  referans: GelenFiyatReferansi | null;
  /** Faturaya bağlanacak irsaliyenin kaynak siparişindeki net fiyat. */
  siparis: { fiyat: number; belgeNo: string | null; belgeId: string } | null;
  /** Bu ürünün son alışlarındaki KDV oranları, yeniden eskiye. */
  gecmisKdvOranlari: number[];
}

export interface GelenMukerrerAdayi {
  tur: "gelen" | "fatura";
  id: string;
  no: string | null;
  tarih: string;
  ayniNo: boolean;
  ayniToplam: boolean;
  ayniSatirlar: boolean;
}

export interface GelenDenetimGirdisi {
  belge: {
    no: string;
    /** YYYY-MM-DD */
    tarih: string;
    tip: "alis" | "satis_iade";
    doviz: string;
    /** İstisna, ihraç kayıtlı, özel matrah: KDV kartla karşılaştırılmaz. */
    kdvKarsilastirilmaz: boolean;
    /** Belgedeki vade − belge tarihi (gün); belgede vade yoksa null. */
    vadeGun: number | null;
    /** TL, KDV dahil (tevkifat alt sınırı için). */
    kdvDahilTl: number;
    tevkifatli: boolean;
    /** Oranı %100'den küçük tevkifat var (alt sınır yalnız kısmi tevkifatta aranır). */
    kismiTevkifatli: boolean;
  };
  /** Entegratör test ortamı: GİB test portalı alıcıyı "TEST KURUM" yazar, firma bilgisi denetlenmez. */
  testOrtami?: boolean;
  /** Gönderenin tedarikçi kartı; yoksa (yeni tedarikçi) null. */
  cari: { id: string; unvan: string; vadeGun: number | null } | null;
  firma: { unvan: string; vergiDairesi: string | null; il: string | null };
  alici: { unvan: string; vergiDairesi?: string; il?: string };
  odeme: {
    /** Belgedeki IBAN'lar (boşluksuz büyük harf). */
    hesaplar: string[];
    /** Kartta ve bu tedarikçinin önceki gelen belgelerinde görülen IBAN'lar. */
    bilinenler: string[];
    /** Tedarikçiden daha önce belge geldi mi. */
    oncekiBelgeVar: boolean;
  };
  /** Tedarikçinin son alış belgeleri tevkifatlı mıydı, yeniden eskiye. */
  gecmisTevkifat: boolean[];
  /** Belge tarihindeki tevkifat alt sınırı (TL, KDV dahil); bilinmiyorsa null. */
  tevkifatAltSiniri: number | null;
  satirlar: GelenDenetimSatiri[];
  mukerrerAdaylari: GelenMukerrerAdayi[];
  esikler: { fiyatYuzde: number; siparisToleransYuzde: number };
}

const yuzde = (x: number) => `%${Math.abs(x).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
const tutar = (x: number, doviz: string) => `${x.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${doviz}`;
const tarihTr = (t: string) => t.split("-").reverse().join(".");
const satirListesi = (sira: number[]) => (sira.length > 5 ? `${sira.slice(0, 5).join(", ")} ve ${sira.length - 5} satır daha` : sira.join(", "));

/** ISO 13616 denetim basamağı (mod 97); TR IBAN'ı 26 karakterdir. */
export function ibanGecerli(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (s.startsWith("TR") && s.length !== 26) return false;
  const dizilim = s.slice(4) + s.slice(0, 4);
  let kalan = 0;
  for (const c of dizilim) {
    const sayi = c >= "A" ? String(c.charCodeAt(0) - 55) : c;
    for (const r of sayi) kalan = (kalan * 10 + Number(r)) % 97;
  }
  return kalan === 1;
}

const HARF_SADE: Record<string, string> = { İ: "I", Ş: "S", Ğ: "G", Ü: "U", Ö: "O", Ç: "C" };

/**
 * Vergi dairesi ve il karşılaştırması: büyük harf, "vergi dairesi" ekleri ve
 * noktalama atılır; Türkçe harfler sadeleşir (belgelerde "ISTANBUL" sık yazılır).
 */
export function yerAdiSadelestir(ad: string | null | undefined): string {
  return (ad ?? "")
    .toLocaleUpperCase("tr-TR")
    .replace(/[İŞĞÜÖÇ]/g, (h) => HARF_SADE[h])
    .replace(/VERGI\s*DAIRESI\s*(MUDURLUGU|MUD\.?)?|\bV\.?\s?D\.?(?=\s|$)/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function tekDuze<T>(degerler: T[]): T | undefined {
  if (degerler.length < ALISKANLIK_EN_AZ) return undefined;
  return degerler.every((d) => d === degerler[0]) ? degerler[0] : undefined;
}

function fiyatKurallari(g: GelenDenetimGirdisi): OnDenetimBulgusu[] {
  const bulgular: OnDenetimBulgusu[] = [];
  const doviz = g.belge.doviz;
  const eslesmeyen: number[] = [];
  const gecmissiz: number[] = [];
  for (const s of g.satirlar) {
    if (!(s.netBirimFiyat > 0) || !(s.miktar > 0)) continue;
    if (!s.stok) { eslesmeyen.push(s.sira); continue; }
    const stok = { tur: "stok" as const, id: s.stok.id, etiket: s.stok.ad };
    if (s.referans && s.referans.fiyat > 0) {
      const oran = s.netBirimFiyat / s.referans.fiyat;
      const kat = onKati(oran, GELEN_KAT_TOLERANSI);
      const nereden = s.referans.kaynak === "tedarikci"
        ? `bu tedarikçiden son alışta${s.referans.faturaNo ? ` (${s.referans.faturaNo})` : ""}`
        : "son 90 günde tüm tedarikçilerden ortalama";
      const baglanti = s.referans.faturaId ? { tur: "fatura" as const, id: s.referans.faturaId, etiket: s.referans.faturaNo ?? undefined } : stok;
      if (kat) {
        bulgular.push({ kod: "GELEN_FIYAT_KAT_HATASI", duzey: "uyari", satir: s.sira, baglanti,
          mesaj: `${s.ad}: birim fiyat ${tutar(s.netBirimFiyat, doviz)}, ${nereden} ${tutar(s.referans.fiyat, doviz)} — yaklaşık ${Math.abs(kat)} kat ${kat > 0 ? "fazla" : "az"}. Ondalık ya da birim hatası olabilir.` });
      } else if (Math.abs(oran - 1) * 100 > g.esikler.fiyatYuzde) {
        bulgular.push({ kod: "GELEN_FIYAT_SAPMA", duzey: "uyari", satir: s.sira, baglanti,
          mesaj: `${s.ad}: birim fiyat ${tutar(s.netBirimFiyat, doviz)}, ${nereden} ${tutar(s.referans.fiyat, doviz)} (${yuzde((oran - 1) * 100)} ${oran > 1 ? "yüksek" : "düşük"}).` });
      }
    } else {
      gecmissiz.push(s.sira);
    }
    if (s.siparis && s.siparis.fiyat > 0) {
      const sapma = (s.netBirimFiyat / s.siparis.fiyat - 1) * 100;
      if (Math.abs(sapma) > g.esikler.siparisToleransYuzde) {
        bulgular.push({ kod: "GELEN_SIPARIS_FIYATI", duzey: "uyari", satir: s.sira,
          baglanti: { tur: "belge", id: s.siparis.belgeId, etiket: s.siparis.belgeNo ?? undefined },
          mesaj: `${s.ad}: birim fiyat ${tutar(s.netBirimFiyat, doviz)}, ${s.siparis.belgeNo ?? "siparişte"} ${tutar(s.siparis.fiyat, doviz)} (${yuzde(sapma)} ${sapma > 0 ? "yüksek" : "düşük"}).` });
      }
    }
  }
  if (eslesmeyen.length) {
    bulgular.push({ kod: "GELEN_URUN_ESLESMEDI", duzey: "bilgi",
      mesaj: `${satirListesi(eslesmeyen)}. ${eslesmeyen.length > 1 ? "satırlar" : "satır"} bir ürün kartıyla eşleşmedi; fiyat ve KDV karşılaştırılmadı.` });
  }
  if (gecmissiz.length) {
    bulgular.push({ kod: "GELEN_FIYAT_GECMISI_YOK", duzey: "bilgi",
      mesaj: `${satirListesi(gecmissiz)}. ${gecmissiz.length > 1 ? "satırlar" : "satır"} için aynı birim ve dövizde karşılaştırılabilir geçmiş alış yok.` });
  }
  return bulgular;
}

/**
 * Belge başına tek bulgu; en güçlü neden (numara, satırlar, tutar) önce, en
 * çok 3 kayıt anılır. Aynı numara ya da aynı gün aynı tutar/satırlar uyarıdır;
 * 7 gün içindeki benzerlik bilgidir — her gün aynı malı getiren tedarikçi
 * sürekli uyarı üretip kuralın susturulmasına yol açmasın.
 */
function mukerrerKurallari(g: GelenDenetimGirdisi): OnDenetimBulgusu[] {
  const guc = (a: GelenMukerrerAdayi) => (a.ayniNo ? 3 : a.ayniSatirlar ? 2 : a.ayniToplam ? 1 : 0);
  const adaylar = g.mukerrerAdaylari.filter((a) => guc(a) > 0).sort((a, b) => guc(b) - guc(a) || b.tarih.localeCompare(a.tarih));
  if (!adaylar.length) return [];
  const anlat = (a: GelenMukerrerAdayi) => {
    const neden = a.ayniNo ? "aynı numarayla" : a.ayniSatirlar ? "aynı ürün ve miktarlarla" : "aynı tutarla";
    return a.tur === "gelen"
      ? `${tarihTr(a.tarih)} tarihli ${a.no ?? ""} numaralı e-Fatura ${neden} gelmiş`
      : `${tarihTr(a.tarih)} tarihli ${a.no ? `${a.no} numaralı ` : ""}alış faturası ${neden} elle kaydedilmiş`;
  };
  const ilk = adaylar[0];
  const digerleri = adaylar.length > 3 ? ` ve ${adaylar.length - 3} kayıt daha` : "";
  const guclu = adaylar.some((a) => a.ayniNo || a.tarih === g.belge.tarih);
  return [{
    kod: "GELEN_MUKERRER",
    duzey: guclu ? "uyari" : "bilgi",
    baglanti: { tur: ilk.tur === "gelen" ? "gelen" : "fatura", id: ilk.id, etiket: ilk.no ?? undefined },
    mesaj: `Bu tedarikçiden ${adaylar.slice(0, 3).map(anlat).join("; ")}${digerleri}. ${guclu ? "Aynı fatura iki kez kaydedilebilir." : "Tekrarlanan bir alım değilse aynı fatura iki kez kaydedilebilir."}`,
  }];
}

function odemeKurallari(g: GelenDenetimGirdisi): OnDenetimBulgusu[] {
  const bulgular: OnDenetimBulgusu[] = [];
  const bilinen = new Set(g.odeme.bilinenler);
  const cari = g.cari ? { tur: "cari" as const, id: g.cari.id, etiket: g.cari.unvan } : undefined;
  for (const iban of g.odeme.hesaplar) {
    if (!ibanGecerli(iban)) {
      bulgular.push({ kod: "GELEN_IBAN_GECERSIZ", duzey: "uyari", ...(cari ? { baglanti: cari } : {}),
        mesaj: `Belgedeki ödeme hesabı (${iban}) geçerli bir IBAN değil; denetim basamağı tutmuyor.` });
    } else if (bilinen.has(iban)) {
      continue;
    } else if (g.odeme.oncekiBelgeVar || bilinen.size) {
      bulgular.push({ kod: "GELEN_IBAN_DEGISTI", duzey: "uyari", ...(cari ? { baglanti: cari } : {}),
        mesaj: `Belgedeki ödeme hesabı (${iban}) bu tedarikçinin kartında ve önceki faturalarında yok. Ödemeden önce tedarikçiyi bilinen bir telefondan arayarak doğrulayın.` });
    } else {
      bulgular.push({ kod: "GELEN_IBAN_ILK", duzey: "bilgi", ...(cari ? { baglanti: cari } : {}),
        mesaj: `Bu tedarikçiden ilk belge; ödeme hesabı ${iban}. Kartta kayıtlı bir hesap yok.` });
    }
  }
  return bulgular;
}

function vergiKurallari(g: GelenDenetimGirdisi): OnDenetimBulgusu[] {
  const bulgular: OnDenetimBulgusu[] = [];
  if (g.belge.tip !== "alis") return bulgular;
  if (!g.belge.kdvKarsilastirilmaz) {
    for (const s of g.satirlar) {
      if (!s.stok) continue;
      const stok = { tur: "stok" as const, id: s.stok.id, etiket: s.stok.ad };
      if (s.kdvOrani !== s.stok.kdvOrani) {
        // Kart ile son alışlar aynı farklı oranı söylüyorsa kart eski kalmıştır; geçmiş esas.
        const gecmis = tekDuze(s.gecmisKdvOranlari.slice(0, 5));
        if (gecmis === s.kdvOrani) continue;
        bulgular.push({ kod: "GELEN_KDV_KARTTAN_FARKLI", duzey: "uyari", satir: s.sira, baglanti: stok,
          mesaj: `${s.ad}: KDV %${s.kdvOrani}, ürün kartında (${s.stok.ad}) %${s.stok.kdvOrani}.` });
      } else {
        const gecmis = tekDuze(s.gecmisKdvOranlari.slice(0, 5));
        if (gecmis !== undefined && gecmis !== s.kdvOrani) {
          bulgular.push({ kod: "GELEN_KDV_GECMISTEN_FARKLI", duzey: "uyari", satir: s.sira, baglanti: stok,
            mesaj: `${s.ad}: KDV %${s.kdvOrani}, bu ürünün son alışlarında hep %${gecmis}.` });
        }
      }
    }
  }
  const aliskanlik = tekDuze(g.gecmisTevkifat.slice(0, 5));
  if (aliskanlik !== undefined && aliskanlik !== g.belge.tevkifatli) {
    bulgular.push({ kod: "GELEN_TEVKIFAT_ALISKANLIK", duzey: "uyari",
      mesaj: aliskanlik
        ? `Bu tedarikçiden son ${Math.min(g.gecmisTevkifat.length, 5)} fatura tevkifatlı geldi; bu belgede tevkifat yok.`
        : `Bu tedarikçiden son ${Math.min(g.gecmisTevkifat.length, 5)} fatura tevkifatsız geldi; bu belgede tevkifat var.` });
  }
  const sinir = g.tevkifatAltSiniri;
  if (sinir && sinir > 0 && g.belge.doviz === "TRY") {
    const sinirMetni = tutar(sinir, "TL");
    if (g.belge.kismiTevkifatli && g.belge.kdvDahilTl < sinir) {
      bulgular.push({ kod: "GELEN_TEVKIFAT_ALT_SINIR", duzey: "uyari",
        mesaj: `Belgede kısmi tevkifat var ama KDV dahil tutar (${tutar(g.belge.kdvDahilTl, "TL")}) tevkifat alt sınırının (${sinirMetni}) altında; iş türüne göre tevkifat gerekmeyebilir, tedarikçiyle doğrulayın.` });
    } else if (!g.belge.tevkifatli && g.belge.kdvDahilTl >= sinir) {
      const hizmet = g.satirlar.filter((s) => s.stok?.tip === "hizmet").map((s) => s.sira);
      if (hizmet.length) {
        bulgular.push({ kod: "GELEN_TEVKIFAT_OLABILIR", duzey: "bilgi",
          mesaj: `${satirListesi(hizmet)}. ${hizmet.length > 1 ? "satırlar" : "satır"} hizmet ve KDV dahil tutar ${sinirMetni} sınırının üstünde; iş türüne göre tevkifat kapsamında olabilir.` });
      }
    }
  }
  return bulgular;
}

function bilgiKurallari(g: GelenDenetimGirdisi): OnDenetimBulgusu[] {
  const bulgular: OnDenetimBulgusu[] = [];
  const farklar: string[] = [];
  if (!g.testOrtami) {
    if (g.alici.unvan && g.firma.unvan && !unvanlarUyumlu(g.alici.unvan, g.firma.unvan)) farklar.push(`unvan "${g.alici.unvan}"`);
    const vd = yerAdiSadelestir(g.alici.vergiDairesi);
    if (vd && yerAdiSadelestir(g.firma.vergiDairesi) && vd !== yerAdiSadelestir(g.firma.vergiDairesi)) farklar.push(`vergi dairesi "${g.alici.vergiDairesi}"`);
    const il = yerAdiSadelestir(g.alici.il);
    if (il && yerAdiSadelestir(g.firma.il) && il !== yerAdiSadelestir(g.firma.il)) farklar.push(`il "${g.alici.il}"`);
  }
  if (farklar.length) {
    bulgular.push({ kod: "GELEN_ALICI_BILGISI", duzey: "uyari",
      mesaj: `Faturada firmanızın bilgileri farklı yazılmış: ${farklar.join(", ")}. Firma kayıtlarınızdan farklı fatura gider ve KDV indirimi için sorun çıkarabilir.` });
  }
  if (g.belge.tip === "alis" && g.cari?.vadeGun && g.cari.vadeGun > 0) {
    const cari = { tur: "cari" as const, id: g.cari.id, etiket: g.cari.unvan };
    if (g.belge.vadeGun === null) {
      bulgular.push({ kod: "GELEN_VADE_YOK", duzey: "bilgi", baglanti: cari,
        mesaj: `Belgede vade yazmıyor; cari kartında vade ${g.cari.vadeGun} gün.` });
    } else if (g.belge.vadeGun < g.cari.vadeGun - GELEN_VADE_PAYI_GUN) {
      bulgular.push({ kod: "GELEN_VADE_KISA", duzey: "uyari", baglanti: cari,
        mesaj: `Belgedeki vade ${Math.max(g.belge.vadeGun, 0)} gün, cari kartında ${g.cari.vadeGun} gün.` });
    }
  }
  return bulgular;
}

/** Bütün kurallar; sıra: mükerrer, ödeme, belge bilgileri, vergi, fiyat. İade belgesinde yalnız mükerrer ve bilgiler. */
export function gelenDenetimYap(g: GelenDenetimGirdisi): OnDenetimBulgusu[] {
  if (g.belge.tip === "satis_iade") return [...mukerrerKurallari(g), ...bilgiKurallari(g)];
  return [...mukerrerKurallari(g), ...odemeKurallari(g), ...bilgiKurallari(g), ...vergiKurallari(g), ...fiyatKurallari(g)];
}
