import { aliciUlkeKodu, idisEngelleri, PLAKA_HATA_MESAJI, plakaGecerliMi, yurtDisiAliciMi } from "@tekirextra/shared";

/**
 * e-İrsaliye gönderim engelleri (EBLG-42).
 *
 * Gönderimin ön koşulları tek yerde tanımlanır: `gonder` ilk engelde durur,
 * giden e-İrsaliye ekranı ise aynı listeyi önceden gösterir. İki yer ayrı
 * kurallar kullansaydı ekran "gönderilebilir" derken gönderim reddedebilirdi.
 */

export type EngelKodu =
  | "plaka_bicimi"
  | "belge_turu"
  | "onaysiz"
  | "vkn_yok"
  | "adres_yok"
  | "tasiyan_yok"
  | "tasiyici_vkn_yok"
  | "idis"
  | "gumruk";

export interface Engel {
  kod: EngelKodu;
  mesaj: string;
}

/**
 * e-İrsaliye olarak gönderilebilen belge durumları. "Kapandı" faturalanmış
 * demektir, sevk belgesi olarak hâlâ geçerlidir (FTR-26).
 */
export const IRSALIYE_GONDERILEBILIR_DURUMLAR: readonly string[] = ["onaylandi", "kapandi"];

export interface EirsaliyeAdayi {
  tur: string;
  yon: string;
  durum: string;
  cari: { vknTckn: string | null; adresler: { tip: string; il: string | null; ilce: string | null; postaKodu: string | null; ulke?: string | null }[] };
  /** EBLG-84: irsaliyeye özel teslimat adresi (ihracatta gümrük kapısı). */
  teslimatAdres?: string | null;
  teslimatIl?: string | null;
  teslimatIlce?: string | null;
  teslimatPostaKodu?: string | null;
  /**
   * EBLG-87: gümrükten depoya kısım kısım sevk. Alış irsaliyesidir ama firma
   * gönderir; alıcı firmanın kendisidir, boşaltma adresi deponun adresidir.
   */
  gumrukDepoSevki?: boolean;
  gumrukBeyannameNo?: string | null;
  gumrukBeyannameTarihi?: Date | string | null;
  yuklemeAdres?: string | null;
  yuklemeIl?: string | null;
  yuklemeIlce?: string | null;
  yuklemePostaKodu?: string | null;
  depo?: { adres: string | null; il: string | null; ilce: string | null; postaKodu: string | null } | null;
  tasiyiciCariId: string | null;
  tasiyiciCari?: { vknTckn: string | null } | null;
  soforAdi: string | null;
  soforSoyadi: string | null;
  plaka: string | null;
  dorsePlaka?: string | null;
  /** EBLG-72: doluysa belge IDISIRSALIYE profiliyle gider. */
  idisSevkiyatNo?: string | null;
  satirlar?: { idisEtiketNo?: string | null }[];
}

/** Şematron il, ilçe ve posta kodunun üçünü de dolu ister. */
const adresTam = (a: { il: string | null; ilce: string | null; postaKodu: string | null }) => Boolean(a.il && a.ilce && a.postaKodu);

/** Malın fiilen gittiği adres: sevk adresi, yoksa merkez/fatura adresi. */
export function teslimatAdresiSec<T extends { tip: string; il: string | null; ilce: string | null; postaKodu: string | null }>(adresler: T[]): T | undefined {
  return adresler.find((a) => a.tip === "sevk" && adresTam(a)) ?? adresler.find((a) => (a.tip === "merkez" || a.tip === "fatura") && adresTam(a));
}

/**
 * EBLG-84: alıcı yurt dışında mı — faturadaki kuralın aynısı (EBLG-80): adres
 * ülkesi Türkiye dışı ya da kartta 2222222222 / 1460415308. Yurt dışı alıcının
 * Türk VKN'si olmaz; belgeye GİB'in yurt dışı alıcı VKN'si yazılır.
 */
export function eirsaliyeYurtDisiMi(belge: Pick<EirsaliyeAdayi, "cari" | "gumrukDepoSevki">): boolean {
  // Gümrükten depoya sevkte cari yabancı tedarikçidir ama alıcı firmanın kendisidir.
  if (belge.gumrukDepoSevki) return false;
  return yurtDisiAliciMi({ ulkeKodu: aliciUlkeKodu(belge.cari.adresler.map((a) => ({ tip: a.tip, ulke: a.ulke ?? null }))), vknTckn: belge.cari.vknTckn });
}

/** Dört alanı da dolu adres; biri eksikse adres yok sayılır. */
function tamAdres(adres?: string | null, il?: string | null, ilce?: string | null, postaKodu?: string | null) {
  return adres && il && ilce && postaKodu ? { adres, il, ilce, postaKodu } : undefined;
}

/** EBLG-87: gümrükten depoya sevkte yükleme (gümrük) adresi. */
export function irsaliyeYuklemeAdresi(belge: Pick<EirsaliyeAdayi, "yuklemeAdres" | "yuklemeIl" | "yuklemeIlce" | "yuklemePostaKodu">) {
  return tamAdres(belge.yuklemeAdres, belge.yuklemeIl, belge.yuklemeIlce, belge.yuklemePostaKodu);
}

/**
 * EBLG-84: malın teslim edileceği adres. İrsaliyeye girilen adres önce gelir;
 * yurt dışı alıcıda yalnız o geçerlidir, çünkü mal müşterinin yabancı adresine
 * değil Türkiye'deki gümrük kapısına götürülür.
 */
export function irsaliyeTeslimatAdresi<T extends { tip: string; il: string | null; ilce: string | null; postaKodu: string | null }>(
  belge: Pick<EirsaliyeAdayi, "teslimatAdres" | "teslimatIl" | "teslimatIlce" | "teslimatPostaKodu" | "gumrukDepoSevki" | "depo"> & { cari: { vknTckn: string | null; adresler: (T & { ulke?: string | null })[] } },
): { adres: string; il: string; ilce: string; postaKodu: string } | T | undefined {
  if (belge.teslimatAdres || belge.teslimatIl || belge.teslimatIlce || belge.teslimatPostaKodu) {
    return tamAdres(belge.teslimatAdres, belge.teslimatIl, belge.teslimatIlce, belge.teslimatPostaKodu);
  }
  // EBLG-87: boşaltma adresi irsaliyeye girilmediyse deponun adresidir.
  if (belge.gumrukDepoSevki) {
    return belge.depo ? tamAdres(belge.depo.adres, belge.depo.il, belge.depo.ilce, belge.depo.postaKodu) : undefined;
  }
  if (eirsaliyeYurtDisiMi(belge)) return undefined;
  return teslimatAdresiSec(belge.cari.adresler);
}

/**
 * Belgeyi gönderime engel olan eksikler. Boş dizi "gönderilebilir" demektir.
 * Sıra `gonder` içindeki denetim sırasıyla aynıdır.
 */
export function gonderimEngelleri(belge: EirsaliyeAdayi): Engel[] {
  const engeller: Engel[] = [];
  if (belge.tur !== "irsaliye" || (belge.yon !== "satis" && !belge.gumrukDepoSevki)) {
    return [{ kod: "belge_turu", mesaj: "Yalnızca satış irsaliyesi ve gümrükten depoya sevk irsaliyesi e-İrsaliye olarak gönderilebilir" }];
  }
  if (!IRSALIYE_GONDERILEBILIR_DURUMLAR.includes(belge.durum)) {
    engeller.push({ kod: "onaysiz", mesaj: "e-İrsaliye göndermek için belge onaylanmış olmalıdır" });
  }
  // EBLG-83: alıcının e-İrsaliye kullanıcısı olması gerekmez; kayıtlı
  // olmayana belge alıcı etiketi olmadan gider (NES testinde 2026-09-24).
  const yurtDisi = eirsaliyeYurtDisiMi(belge);
  // Gümrükten depoya sevkte alıcı firmanın kendisidir; carinin VKN'si aranmaz.
  if (!belge.cari.vknTckn && !yurtDisi && !belge.gumrukDepoSevki) {
    engeller.push({ kod: "vkn_yok", mesaj: "Cari VKN/TCKN bilgisi eksik" });
  }
  if (belge.gumrukDepoSevki) {
    if (!belge.gumrukBeyannameNo?.trim() || !belge.gumrukBeyannameTarihi) {
      engeller.push({ kod: "gumruk", mesaj: "Gümrükten depoya sevk irsaliyesi gümrük beyannamesinin numarasını ve tarihini ister" });
    }
    if (!irsaliyeYuklemeAdresi(belge)) {
      engeller.push({ kod: "gumruk", mesaj: "Gümrükten depoya sevk irsaliyesi yükleme (gümrük) adresini adres, il, ilçe ve posta koduyla ister" });
    }
  }
  if (!irsaliyeTeslimatAdresi(belge)) {
    engeller.push({
      kod: "adres_yok",
      mesaj: belge.gumrukDepoSevki
        ? "Gümrükten depoya sevk irsaliyesi boşaltma adresi ister: depo kartına il, ilçe ve posta kodu girin ya da irsaliyeye teslimat adresi yazın"
        : yurtDisi
        ? "İhracat irsaliyesi teslimat adresi ister: malın Türkiye'den çıkacağı gümrük kapısının adresini, il, ilçe ve posta koduyla irsaliyeye girin"
        : "e-İrsaliye teslimat adresi ister; irsaliyeye teslimat adresi girin ya da cari kartına il, ilçe ve posta kodu dolu bir sevk adresi ekleyin",
    });
  }
  if (!belge.tasiyiciCariId && !(belge.soforAdi && belge.soforSoyadi && belge.plaka)) {
    engeller.push({ kod: "tasiyan_yok", mesaj: "e-İrsaliye taşıyan bilgisi ister: taşıyıcı firmayı seçin ya da şoför adı, soyadı ve plakayı girin" });
  }
  // Şematron 14.09.2026 §3: şoför bildirilen belgede plaka zorunludur;
  // taşıyıcı firma seçilmiş olsa bile şoför varsa plaka aranır.
  if ((belge.soforAdi || belge.soforSoyadi) && !belge.plaka) {
    engeller.push({ kod: "tasiyan_yok", mesaj: "Şoför bildirilen irsaliyede araç plakası zorunludur" });
  }
  for (const [alan, deger] of [["Araç plakası", belge.plaka], ["Dorse plakası", belge.dorsePlaka]] as const) {
    if (deger && !plakaGecerliMi(deger)) {
      engeller.push({ kod: "plaka_bicimi", mesaj: `${alan} GİB biçimine uymuyor: ${PLAKA_HATA_MESAJI}` });
    }
  }
  if (belge.tasiyiciCariId && !belge.tasiyiciCari?.vknTckn) {
    engeller.push({ kod: "tasiyici_vkn_yok", mesaj: "Taşıyıcı cari kartında VKN/TCKN bilgisi bulunmalıdır" });
  }
  // İDİS: sevkiyat numarasının biçimi ve satır etiketleri faturadakiyle aynı
  // kuraldan denetlenir (EBLG-72).
  for (const engel of idisEngelleri({
    sevkiyatNo: belge.idisSevkiyatNo,
    satirlar: (belge.satirlar ?? []).map((satir, index) => ({ sira: index + 1, etiketNo: satir.idisEtiketNo })),
  })) {
    engeller.push({ kod: "idis", mesaj: engel.mesaj });
  }
  return engeller;
}
