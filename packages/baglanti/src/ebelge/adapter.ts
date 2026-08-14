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
