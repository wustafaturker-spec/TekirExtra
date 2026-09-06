import type { EbelgeSaglayici } from "@tekirextra/shared";
import type {
  BaglantiSonuc,
  BelgeDurumSonuc,
  EntegratorConfig,
  GelenBelge,
  GonderimSonuc,
  MukellefDurum,
  UblBelge,
  EarsivIptalGirdi,
  EarsivRapor,
  EirsaliyeBelge,
  GelenEirsaliye,
  MukellefKaydi,
  ZarfAraligi,
  GelenZarfSonucu,
} from "./types";

/**
 * e-Belge entegratör adaptör sözleşmesi (EBLG-01, MIMARI §5.1).
 *
 * Adaptör yalnızca taşıma/zarf/kimlik farklarını kapatır; UBL-TR üretimi
 * ve iş kuralları ebelge modülündedir. Sağlayıcı durum kodları ortak
 * BelgeDurum kümesine adaptör içinde normalize edilir.
 */
export interface EntegratorAdapter {
  readonly saglayici: EbelgeSaglayici;

  baglantiTest(cfg: EntegratorConfig): Promise<BaglantiSonuc>;
  mukellefSorgula(cfg: EntegratorConfig, vknTckn: string): Promise<MukellefDurum>;
  belgeGonder(cfg: EntegratorConfig, belge: UblBelge): Promise<GonderimSonuc>;
  durumSorgula(cfg: EntegratorConfig, belgeRef: string): Promise<BelgeDurumSonuc>;
  gelenBelgeleriCek(cfg: EntegratorConfig, sonrasi: Date): Promise<GelenBelge[]>;
  /**
   * Tam GİB mükellef listesini indirir (EBLG-10). Yalnızca toplu liste sunan
   * sağlayıcılar uygular; tekil sorgusu ucuz olan sağlayıcılarda tanımsız
   * kalır ve çağıran `mukellefSorgula`'ya düşer.
   */
  mukellefListesiCek?(cfg: EntegratorConfig): Promise<MukellefKaydi[]>;
  /**
   * Verilen tarih aralığındaki gelen zarfları tek çağrı ailesiyle indirir
   * (EBLG-11, EBLG-12). Aralık kursörden gelir; adaptör aralığı sağlayıcının
   * izin verdiği dilimlere kendi böler.
   */
  gelenZarflariCek?(cfg: EntegratorConfig, aralik: ZarfAraligi): Promise<GelenZarfSonucu>;
  /** Zarf durumlarını toplu sorgular (EBLG-14); sağlayıcı sınırına adaptör uyar. */
  durumSorgulaToplu?(cfg: EntegratorConfig, belgeRefleri: string[]): Promise<BelgeDurumSonuc[]>;
  yanitGonder(
    cfg: EntegratorConfig,
    belgeRef: string,
    yanit: "kabul" | "ret",
    gerekce?: string,
    kaynak?: { gonderenVkn: string; xml: string },
  ): Promise<GonderimSonuc>;
  earsivIptal?(cfg: EntegratorConfig, girdi: EarsivIptalGirdi): Promise<BaglantiSonuc>;
  earsivRaporListele?(cfg: EntegratorConfig, baslangic: Date, bitis: Date): Promise<EarsivRapor[]>;
  earsivRaporDurum?(cfg: EntegratorConfig, uuid: string): Promise<BaglantiSonuc & { kod?: string }>;
  irsaliyeGonder?(cfg: EntegratorConfig, belge: EirsaliyeBelge): Promise<GonderimSonuc>;
  irsaliyeDurumSorgula?(cfg: EntegratorConfig, belgeRef: string): Promise<BelgeDurumSonuc>;
  gelenIrsaliyeleriCek?(cfg: EntegratorConfig, sonrasi: Date): Promise<GelenEirsaliye[]>;
  irsaliyeYanitiGonder?(cfg: EntegratorConfig, belgeRef: string, yanit: "kabul" | "ret", gerekce: string | undefined, kaynakXml: string): Promise<GonderimSonuc>;
}
