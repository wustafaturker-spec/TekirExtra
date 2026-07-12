import type { EbelgeSaglayici } from "@tekirextra/shared";
import type {
  BaglantiSonuc,
  BelgeDurumSonuc,
  EntegratorConfig,
  GelenBelge,
  GonderimSonuc,
  MukellefDurum,
  UblBelge,
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
  ): Promise<GonderimSonuc>;
}
