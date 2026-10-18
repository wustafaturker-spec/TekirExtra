import { BelgelerController } from "../../../belgeler/belgeler.controller";
import { CariController } from "../../../cari/cari.controller";
import { DovizController } from "../../../doviz/doviz.controller";
import { EbelgeController } from "../../../ebelge/ebelge.controller";
import { FaturaController } from "../../../fatura/fatura.controller";
import { KasaBankaController } from "../../../kasa-banka/kasa-banka.controller";
import { MasraflarController } from "../../../masraflar/masraflar.controller";
import { NakitAkisiController } from "../../../nakit-akisi/nakit-akisi.controller";
import { RaporController } from "../../../rapor/rapor.controller";
import { RaporlarController } from "../../../core/raporlar/raporlar.controller";
import { StokController } from "../../../stok/stok.controller";
import { VadeHatirlatmaController } from "../../../cari/vade-hatirlatma.controller";
import { GelenEpostaController } from "../../../tenant/gelen-eposta.controller";
import { CrmBelgeController } from "../../../crm/crm-belge.controller";
import type { UcTanimi } from "../uc-cagirici";

const uc = (denetleyici: UcTanimi["denetleyici"], yontem: string, yol: string): UcTanimi => ({ denetleyici, yontem, yol });

/** Araçların dayandığı ekran uçları (AI-07: ekranla aynı doğrulama ve kurallar). */
export const UC = {
  cariListe: uc(CariController, "listele", "GET /cari"),
  cariGetir: uc(CariController, "getir", "GET /cari/:id"),
  cariDurum: uc(CariController, "durum", "GET /cari/:id/durum"),
  cariOlustur: uc(CariController, "olustur", "POST /cari"),
  cariGuncelle: uc(CariController, "guncelle", "PATCH /cari/:id"),
  cariKisiEkle: uc(CariController, "kisiEkle", "POST /cari/:id/kisiler"),
  cariCrmGorev: uc(CariController, "crmGorevEkle", "POST /cari/:id/crm/gorevler"),
  cariEkstreEposta: uc(CariController, "ekstreEposta", "POST /cari/:id/ekstre/eposta"),

  stokListe: uc(StokController, "listele", "GET /stok"),
  stokGetir: uc(StokController, "getir", "GET /stok/:id"),
  stokTavsiyeFiyat: uc(StokController, "tavsiyeFiyat", "GET /stok/:id/tavsiye-fiyat"),
  stokOlustur: uc(StokController, "olustur", "POST /stok"),
  stokGuncelle: uc(StokController, "guncelle", "PATCH /stok/:id"),

  belgeListe: uc(BelgelerController, "listele", "GET /belgeler"),
  belgeGetir: uc(BelgelerController, "getir", "GET /belgeler/:id"),
  belgeOlustur: uc(BelgelerController, "olustur", "POST /belgeler"),
  belgeOnayla: uc(BelgelerController, "onayla", "POST /belgeler/:id/onayla"),
  belgeIptal: uc(BelgelerController, "iptal", "POST /belgeler/:id/iptal"),
  belgeDonustur: uc(BelgelerController, "donustur", "POST /belgeler/:id/donustur"),
  belgeEposta: uc(BelgelerController, "pdfGonder", "POST /belgeler/:id/pdf-gonder"),

  faturaListe: uc(FaturaController, "listele", "GET /fatura"),
  faturaGetir: uc(FaturaController, "getir", "GET /fatura/:id"),
  faturaOlustur: uc(FaturaController, "olustur", "POST /fatura"),
  faturaKesinlestir: uc(FaturaController, "kesinlestir", "POST /fatura/:id/kesinlestir"),
  faturaIptal: uc(FaturaController, "iptal", "POST /fatura/:id/iptal"),
  faturaEposta: uc(FaturaController, "pdfGonder", "POST /fatura/:id/pdf-gonder"),
  ebelgeGonder: uc(EbelgeController, "gonder", "POST /ebelge/gonder/:faturaId"),

  masrafKategoriler: uc(MasraflarController, "kategoriListele", "GET /masraflar/kategoriler"),
  masrafOlustur: uc(MasraflarController, "olustur", "POST /masraflar"),

  kasaListe: uc(KasaBankaController, "kasaListele", "GET /kasa-banka/kasalar"),
  bankaListe: uc(KasaBankaController, "bankaListele", "GET /kasa-banka/bankalar"),
  kasaBankaHareket: uc(KasaBankaController, "hareketEkle", "POST /kasa-banka/hareketler"),

  nakitAkisi: uc(NakitAkisiController, "tahmin", "GET /nakit-akisi"),
  vadesiGecenler: uc(RaporController, "vadesiGecenler", "GET /rapor/vadesi-gecenler"),
  finansalOzet: uc(RaporController, "finansalOzet", "GET /rapor/ozet"),
  gelirGider: uc(RaporController, "gelirGiderRaporu", "GET /rapor/gelir-gider"),
  raporKatalogu: uc(RaporlarController, "listele", "GET /raporlar"),
  // Rapor çalıştırmak okumadır; POST yalnız gövde taşımak için (denetim kaydına yazılmaz).
  raporCalistir: uc(RaporlarController, "calistir", "GET /raporlar/:kod/calistir"),
  dovizKuru: uc(DovizController, "getir", "GET /doviz-kurlari"),
  tahsilatOncelikleri: uc(VadeHatirlatmaController, "oncelikler", "GET /cari/vade-hatirlatma/oncelikler"),
  tahsilatRiski: uc(VadeHatirlatmaController, "cariRiski", "GET /cari/vade-hatirlatma/risk/:cariId"),
  vadeHatirlatmaGonder: uc(VadeHatirlatmaController, "gonder", "POST /cari/vade-hatirlatma/gonder"),

  gelenEpostaListe: uc(GelenEpostaController, "listele", "GET /eposta/gelen"),
  gelenEpostaGetir: uc(GelenEpostaController, "getir", "GET /eposta/gelen/:id"),
  gelenEpostaCrmGorev: uc(GelenEpostaController, "crmGorevOlustur", "POST /eposta/gelen/:id/crm-gorev"),
  gelenEpostaSenkronize: uc(GelenEpostaController, "senkronizeEt", "POST /eposta/gelen/senkronize-et"),
  gelenEpostaEkOcr: uc(GelenEpostaController, "ekOcrCikar", "POST /eposta/gelen/:id/ekler/:ekId/ocr"),
  gelenEpostaDurum: uc(GelenEpostaController, "durumGuncelle", "PATCH /eposta/gelen/:id/durum"),
  gelenEpostaOkundu: uc(GelenEpostaController, "okunduGuncelle", "PATCH /eposta/gelen/:id/okundu"),

  // AI-36: e-posta teklif talebinden açılan taslak fırsata bağlanır.
  crmTeklifBagla: uc(CrmBelgeController, "bagla", "POST /crm/firsatlar/:firsatId/belgeler"),
};
