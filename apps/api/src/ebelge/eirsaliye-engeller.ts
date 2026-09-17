import { PLAKA_HATA_MESAJI, plakaGecerliMi } from "@tekirextra/shared";

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
  | "mukellef_degil"
  | "adres_yok"
  | "tasiyan_yok"
  | "tasiyici_vkn_yok";

export interface Engel {
  kod: EngelKodu;
  mesaj: string;
}

/** Mükellefiyet yerel GİB listesinden okunur; liste bayatsa "bilinmiyor". */
export type MukellefDurumu = "mukellef" | "degil" | "bilinmiyor";

export interface EirsaliyeAdayi {
  tur: string;
  yon: string;
  durum: string;
  cari: { vknTckn: string | null; adresler: { tip: string; il: string | null; ilce: string | null; postaKodu: string | null }[] };
  tasiyiciCariId: string | null;
  tasiyiciCari?: { vknTckn: string | null } | null;
  soforAdi: string | null;
  soforSoyadi: string | null;
  plaka: string | null;
  dorsePlaka?: string | null;
}

/** Şematron il, ilçe ve posta kodunun üçünü de dolu ister. */
const adresTam = (a: { il: string | null; ilce: string | null; postaKodu: string | null }) => Boolean(a.il && a.ilce && a.postaKodu);

/** Malın fiilen gittiği adres: sevk adresi, yoksa merkez/fatura adresi. */
export function teslimatAdresiSec<T extends { tip: string; il: string | null; ilce: string | null; postaKodu: string | null }>(adresler: T[]): T | undefined {
  return adresler.find((a) => a.tip === "sevk" && adresTam(a)) ?? adresler.find((a) => (a.tip === "merkez" || a.tip === "fatura") && adresTam(a));
}

/**
 * Belgeyi gönderime engel olan eksikler. Boş dizi "gönderilebilir" demektir.
 * Sıra `gonder` içindeki denetim sırasıyla aynıdır.
 */
export function gonderimEngelleri(belge: EirsaliyeAdayi, mukellef: MukellefDurumu): Engel[] {
  const engeller: Engel[] = [];
  if (belge.tur !== "irsaliye" || belge.yon !== "satis") {
    return [{ kod: "belge_turu", mesaj: "Yalnızca satış irsaliyesi e-İrsaliye olarak gönderilebilir" }];
  }
  if (belge.durum !== "onaylandi") {
    engeller.push({ kod: "onaysiz", mesaj: "e-İrsaliye göndermek için belge onaylanmış olmalıdır" });
  }
  if (!belge.cari.vknTckn) {
    engeller.push({ kod: "vkn_yok", mesaj: "Cari VKN/TCKN bilgisi eksik" });
  } else if (mukellef === "degil") {
    engeller.push({ kod: "mukellef_degil", mesaj: "Cari e-İrsaliye alıcısı olarak tanımlı değil" });
  }
  if (!teslimatAdresiSec(belge.cari.adresler)) {
    engeller.push({ kod: "adres_yok", mesaj: "e-İrsaliye teslimat adresi ister; cari kartına il, ilçe ve posta kodu dolu bir sevk adresi ekleyin" });
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
  return engeller;
}
