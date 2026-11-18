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
import { EirsaliyeController } from "../../../ebelge/eirsaliye.controller";
import { SatinAlmaController } from "../../../satin-alma/satin-alma.controller";
import { KrediController } from "../../../kasa-banka/kredi.controller";
import { DemirbasController } from "../../../demirbas/demirbas.controller";
import { AracTakipController } from "../../../arac-takip/arac-takip.controller";
import { KrediKartiController } from "../../../kasa-banka/kredi-karti.controller";
import { OdemeTalimatiController } from "../../../kasa-banka/odeme-talimati.controller";
import { ButceController } from "../../../butce/butce.controller";
import { DuzeltmelerController } from "../../../duzeltmeler/duzeltmeler.controller";
import { BildirimlerController } from "../../../bildirimler/bildirimler.controller";
import { DonemKapatmaController } from "../../../donem-kapatma/donem-kapatma.controller";
import { SohbetEkController } from "../sohbet-ek.controller";
import { AiOnayOzetiController } from "../../onay/ai-onay-ozeti.controller";
import { CrmFirsatController } from "../../../crm/crm-firsat.controller";
import { UretimController } from "../../../uretim/uretim.controller";
import { DepoController } from "../../../stok/depo.controller";
import { PersonelController } from "../../../personel/personel.controller";
import { PersonelRaporController } from "../../../personel/personel-rapor.controller";
import { IzinController } from "../../../personel/izin.controller";
import { SelfServisDavetController } from "../../../personel/self-servis.controller";
import { FiyatEndeksController } from "../../../fiyat-endeks/fiyat-endeks.controller";
import { HazirlikController } from "../../hazirlik/hazirlik.controller";
import { SozlesmeController } from "../../sozlesme/sozlesme.controller";
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
  cariAdresEkle: uc(CariController, "adresEkle", "POST /cari/:id/adresler"),
  cariBankaHesapEkle: uc(CariController, "bankaHesapEkle", "POST /cari/:id/banka-hesaplari"),
  cariCrmGorev: uc(CariController, "crmGorevEkle", "POST /cari/:id/crm/gorevler"),
  cariEkstreEposta: uc(CariController, "ekstreEposta", "POST /cari/:id/ekstre/eposta"),
  cariEkstreDosyasi: uc(CariController, "ekstreDosyasi", "GET /cari/:id/ekstre/dosya"),

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
  belgeRevize: uc(BelgelerController, "revizeEt", "POST /belgeler/:id/revize"),
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
  /** CNL-22: fişten açılan taslağın onayı, ödemesi ve araç bağı (tek onay talebi). */
  masrafGetir: uc(MasraflarController, "getir", "GET /masraflar/:id"),
  masrafOnayla: uc(MasraflarController, "onayla", "POST /masraflar/:id/onayla"),
  masrafOde: uc(MasraflarController, "ode", "POST /masraflar/:id/ode"),
  aracGiderBagla: uc(AracTakipController, "giderBagla", "POST /arac-takip/:id/gider"),

  kasaListe: uc(KasaBankaController, "kasaListele", "GET /kasa-banka/kasalar"),
  bankaListe: uc(KasaBankaController, "bankaListele", "GET /kasa-banka/bankalar"),
  kasaBankaHareket: uc(KasaBankaController, "hareketEkle", "POST /kasa-banka/hareketler"),
  /** CNL-10: asistan sorusuna verilen yanıtla eşleşmeyen banka satırı cariye bağlanır (onaylı). */
  ekstreSatirEslestir: uc(KasaBankaController, "ekstreEslestir", "POST /kasa-banka/ekstre/satirlar/:id/eslestir"),

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

  // AI-73: gelen e-Fatura / e-İrsaliye kutusu.
  gelenEfaturaSayfa: uc(EbelgeController, "gelenSayfa", "GET /ebelge/gelen/sayfa"),
  gelenEfaturaGetir: uc(EbelgeController, "gelenGetir", "GET /ebelge/gelen/:id"),
  gelenEfaturaDenetim: uc(EbelgeController, "gelenDenetim", "POST /ebelge/gelen/:id/denetim"),
  gelenEfaturaIsle: uc(EbelgeController, "gelenOnayla", "POST /ebelge/gelen/:id/onayla"),
  gelenEfaturaYanit: uc(EbelgeController, "gelenYanit", "POST /ebelge/gelen/:id/yanit"),
  // AI-79: sohbete eklenen UBL XML'in gelen kutusuna yüklenmesi.
  sohbetEkiXml: uc(SohbetEkController, "xml", "GET /ai/ajan/ek/:id/xml"),
  gelenXmlYukle: uc(EbelgeController, "gelenXmlYukle", "POST /ebelge/gelen/xml-yukle"),
  gelenEirsaliyeListe: uc(EirsaliyeController, "gelenListele", "GET /ebelge/irsaliye/gelen"),
  gelenEirsaliyeGetir: uc(EirsaliyeController, "gelenDetay", "GET /ebelge/irsaliye/gelen/:id"),
  gelenEirsaliyeYanit: uc(EirsaliyeController, "gelenYanit", "POST /ebelge/irsaliye/gelen/:id/yanit"),

  // AI-74: satın alma talepleri.
  satinAlmaSecenekler: uc(SatinAlmaController, "secenekler", "GET /satin-alma/secenekler"),
  satinAlmaListe: uc(SatinAlmaController, "listele", "GET /satin-alma/talepler"),
  satinAlmaGetir: uc(SatinAlmaController, "getir", "GET /satin-alma/talepler/:id"),
  satinAlmaOlustur: uc(SatinAlmaController, "olustur", "POST /satin-alma/talepler"),
  satinAlmaTeklifEkle: uc(SatinAlmaController, "teklifEkle", "POST /satin-alma/talepler/:id/teklifler"),
  satinAlmaOnayaSun: uc(SatinAlmaController, "gonder", "POST /satin-alma/talepler/:id/gonder"),
  satinAlmaOnayla: uc(SatinAlmaController, "onayla", "POST /satin-alma/talepler/:id/onayla"),
  satinAlmaReddet: uc(SatinAlmaController, "reddet", "POST /satin-alma/talepler/:id/reddet"),
  satinAlmaTeklifSec: uc(SatinAlmaController, "teklifSec", "POST /satin-alma/teklifler/:teklifId/sec"),
  satinAlmaSiparis: uc(SatinAlmaController, "siparisOlustur", "POST /satin-alma/talepler/:id/siparis"),

  // AI-75: çek/senet, kredi, kredi kartı, ödeme talimatı (yalnız okuma).
  cekSenetListe: uc(KasaBankaController, "cekSenetListele", "GET /kasa-banka/cek-senet"),
  cekSenetOzet: uc(KasaBankaController, "cekSenetOzet", "GET /kasa-banka/cek-senet-ozet"),
  cekSenetVade: uc(KasaBankaController, "cekSenetVadeAnalizi", "GET /kasa-banka/cek-senet-vade-analizi"),
  krediListe: uc(KrediController, "listele", "GET /kasa-banka/krediler"),
  krediGetir: uc(KrediController, "getir", "GET /kasa-banka/krediler/:id"),
  demirbasListe: uc(DemirbasController, "listele", "GET /demirbas"),
  demirbasGetir: uc(DemirbasController, "getir", "GET /demirbas/:id"),
  amortismanOnizleme: uc(DemirbasController, "onizleme", "GET /demirbas/amortisman/:yil"),
  aracListe: uc(AracTakipController, "listele", "GET /arac-takip"),
  aracGetir: uc(AracTakipController, "getir", "GET /arac-takip/:id"),
  aracYaklasanlar: uc(AracTakipController, "yaklasanlar", "GET /arac-takip/yaklasanlar"),
  aracRapor: uc(AracTakipController, "rapor", "GET /arac-takip/rapor"),
  krediKartiListe: uc(KrediKartiController, "listele", "GET /kasa-banka/kredi-kartlari"),
  krediKartiEkstreler: uc(KrediKartiController, "ekstreler", "GET /kasa-banka/kredi-kartlari/:id/ekstreler"),
  odemeTalimatlari: uc(OdemeTalimatiController, "listele", "GET /kasa-banka/odeme-talimatlari"),

  // AI-76: bütçe ve nakit.
  butceKarsilastirma: uc(ButceController, "karsilastirma", "GET /butce/:yil/karsilastirma"),
  nakitPozisyon: uc(NakitAkisiController, "pozisyon", "GET /nakit-akisi/pozisyon"),
  // END-21: fiyat–endeks
  fiyatEndeksSecenekleri: uc(FiyatEndeksController, "secenekler", "GET /fiyat-endeks/secenekler"),
  fiyatEndeksEndeks: uc(FiyatEndeksController, "endeks", "GET /fiyat-endeks/endeks/:kod"),
  fiyatEndeksUrun: uc(FiyatEndeksController, "urun", "GET /fiyat-endeks/urun/:stokId"),
  fiyatEndeksOzet: uc(FiyatEndeksController, "ozet", "GET /fiyat-endeks/ozet"),

  // AI-77: Düzeltme Merkezi, bildirimler, dönem kapatma kontrolleri.
  duzeltmeListe: uc(DuzeltmelerController, "listele", "GET /duzeltmeler"),
  duzeltmeOzet: uc(DuzeltmelerController, "ozet", "GET /duzeltmeler/ozet"),
  duzeltmeGetir: uc(DuzeltmelerController, "getir", "GET /duzeltmeler/:id"),
  duzeltmeAta: uc(DuzeltmelerController, "ata", "PATCH /duzeltmeler/:id/ata"),
  duzeltmeDurum: uc(DuzeltmelerController, "durumDegistir", "PATCH /duzeltmeler/:id/durum"),
  bildirimOzet: uc(BildirimlerController, "ozet", "GET /bildirimler/ozet"),
  bildirimListe: uc(BildirimlerController, "listele", "GET /bildirimler"),
  // Kontroller dönemi kapatmaz ama sonuçlarını kaydeder; denetim kaydına düşsün diye POST.
  donemKontrol: uc(DonemKapatmaController, "kontrol", "POST /donem-kapatma/kontroller"),

  // AI-83: günlük brifing kaynakları.
  aiOnayOzeti: uc(AiOnayOzetiController, "ozet", "GET /ai/onay-ozeti"),
  sabahHazirlikOzeti: uc(HazirlikController, "brifingOzeti", "GET /ai/hazirlik/brifing-ozeti"),
  sozlesmeAra: uc(SozlesmeController, "ara", "POST /ai/sozlesme/ara"),
  sozlesmeSor: uc(SozlesmeController, "sor", "POST /ai/sozlesme/sor"),
  stokKritik: uc(StokController, "kritikOzeti", "GET /stok/kritik-ozeti"),

  // AI-36: e-posta teklif talebinden açılan taslak fırsata bağlanır.
  crmTeklifBagla: uc(CrmBelgeController, "bagla", "POST /crm/firsatlar/:firsatId/belgeler"),

  // AI-89…91: CRM fırsatları.
  crmFirsatListe: uc(CrmFirsatController, "listele", "GET /crm/firsatlar"),
  crmFirsatGetir: uc(CrmFirsatController, "getir", "GET /crm/firsatlar/:id"),
  crmFirsatOlustur: uc(CrmFirsatController, "olustur", "POST /crm/firsatlar"),
  crmFirsatGuncelle: uc(CrmFirsatController, "guncelle", "PUT /crm/firsatlar/:id"),
  crmFirsatAsama: uc(CrmFirsatController, "asamaDegistir", "PATCH /crm/firsatlar/:id/asama"),
  crmFirsatBelgeler: uc(CrmBelgeController, "listele", "GET /crm/firsatlar/:firsatId/belgeler"),
  crmFirsattanTeklif: uc(CrmBelgeController, "teklifOlustur", "POST /crm/firsatlar/:firsatId/belgeler/teklif"),

  // AI-85/86: üretim.
  uretimOzet: uc(UretimController, "ozet", "GET /uretim/ozet"),
  uretimEmirListe: uc(UretimController, "emirler", "GET /uretim/emirler"),
  uretimEmirGetir: uc(UretimController, "emir", "GET /uretim/emirler/:id"),
  uretimMalzemeUygunlugu: uc(UretimController, "malzemeUygunlugu", "GET /uretim/emirler/:id/malzeme-uygunlugu"),
  uretimEmirMaliyet: uc(UretimController, "maliyet", "GET /uretim/emirler/:id/maliyet"),
  uretimKapasite: uc(UretimController, "kapasite", "GET /uretim/kapasite"),
  uretimRecete: uc(UretimController, "recete", "GET /uretim/receteler/:stokId"),
  uretimKalite: uc(UretimController, "kaliteKontrolleri", "GET /uretim/kalite-kontrolleri"),
  uretimMaliyetRaporu: uc(UretimController, "maliyetRaporu", "GET /uretim/maliyet-raporu"),
  uretimEmirOlustur: uc(UretimController, "emirOlustur", "POST /uretim/emirler"),
  uretimPlanla: uc(UretimController, "planla", "POST /uretim/emirler/:id/planla"),
  uretimRezerve: uc(UretimController, "rezerveEt", "POST /uretim/emirler/:id/rezerve-et"),
  uretimKapat: uc(UretimController, "kapat", "POST /uretim/emirler/:id/kapat"),
  uretimIptal: uc(UretimController, "iptal", "POST /uretim/emirler/:id/iptal"),
  depoListe: uc(DepoController, "listele", "GET /depo"),

  // AI-87/88: personel (PersonelErisimGuard araçta da çalışır).
  personelListe: uc(PersonelController, "listele", "GET /personel"),
  personelGetir: uc(PersonelController, "getir", "GET /personel/:id"),
  personelAvanslar: uc(PersonelController, "avansListele", "GET /personel/avanslar"),
  personelOzet: uc(PersonelRaporController, "ozet", "GET /personel/raporlar/ozet"),
  personelMaliyet: uc(PersonelRaporController, "maliyetRaporu", "GET /personel/raporlar/maliyet"),
  izinListe: uc(IzinController, "listele", "GET /personel/izinler"),
  izinBakiyeleri: uc(IzinController, "bakiyeler", "GET /personel/izinler/bakiyeler/:personelId"),
  izinOnayla: uc(IzinController, "onayla", "POST /personel/izinler/:id/onayla"),
  izinReddet: uc(IzinController, "reddet", "POST /personel/izinler/:id/reddet"),
  bilgiTalepleri: uc(SelfServisDavetController, "bilgiTalepleri", "GET /personel/bilgi-talepleri"),
  bilgiOnayla: uc(SelfServisDavetController, "bilgiOnayla", "POST /personel/bilgi-talepleri/:talepId/onayla"),
  bilgiReddet: uc(SelfServisDavetController, "bilgiReddet", "POST /personel/bilgi-talepleri/:talepId/reddet"),
};
