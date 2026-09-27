import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EirsaliyeDurum, GelenEirsaliyeDurum, Prisma, type ZincirBelgeDurum } from "@prisma/client";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { durumAciklamasi } from "./durum-aciklamasi";
import { postaKutusuSec, type EntegratorConfig } from "@tekirextra/baglanti";
import { anTR, birimUblKodu, bugunTR, eirsaliyeYanitSuresi, muhtelifMusteriMi, gumrukSeferNotu, ihracatFaturasiNotu, YURT_DISI_ALICI_VKN, dorseSchemeId, firmaEbelgeEksikleri, idisBelgesiMi, IDIS_IRSALIYE_PROFILI, idisNormalize, plakaNormalize, plakaSchemeId, ublAdresi, eirsaliyeAsamasi } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { PrismaService } from "../core/prisma.service";
import { BaglantilarService } from "../tenant/baglantilar.service";
import { eirsaliyeNumarasi, eirsaliyeNumarasiniGeriAl, eirsaliyeNumarasiSerbestMi, eirsaliyeSayacSonSira, eirsaliyeSirasiAl, seriHatasiAciklamasi } from "../belgeler/belge-sayac";
import { numaraBosluklariniBul } from "./eirsaliye-bosluk";
import { eirsaliyeYurtDisiMi, gonderimEngelleri, IRSALIYE_GONDERILEBILIR_DURUMLAR, irsaliyeTeslimatAdresi, irsaliyeYuklemeAdresi } from "./eirsaliye-engeller";
import { gelenSevkTarihi, irsaliyeUblOku } from "./eirsaliye-ubl-oku";
import { MukellefListesiService } from "./mukellef-listesi.service";
import { kendiGbEtiketi, postaKutusuSecimi } from "./posta-kutusu-secimi";

/** Bağlantıda e-İrsaliye seri öneki tanımlı değilse (EBLG-20). */
const VARSAYILAN_EIRSALIYE_ONEKI = "IRS";

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Aynı irsaliyenin iki durum sorgusu arasındaki asgari süre (EBLG-36, faturadaki EBLG-14 ile aynı). */
const DURUM_SORGU_ARALIK_MS = Number(process.env.EBLG_DURUM_SORGU_ARALIK_MS || 2 * 60 * 60 * 1_000);

/**
 * EBLG-36: otomatik sorgulanacak giden e-İrsaliyeler. `kuyrukta` irsaliye GİB
 * sonucu gelene kadar, `iletildi` irsaliye alıcı yanıtı için gönderimden
 * itibaren `yanitGunSayisi` gün sorgulanır. Planlayıcı da aynı koşulu kullanır.
 */
export function eirsaliyeSorguKosulu(tenantId: string, simdi: number, yanitGunSayisi: number): Prisma.EirsaliyeKayitWhereInput {
  return {
    tenantId,
    entegratorRef: { not: null },
    OR: [{ sonDurumSorguAt: null }, { sonDurumSorguAt: { lt: new Date(simdi - DURUM_SORGU_ARALIK_MS) } }],
    // EBLG-85: kayıtlı olmayan alıcı yanıt veremez; iletilen belgesi beklenmez.
    AND: [{ OR: [{ durum: "kuyrukta" }, { durum: "iletildi", aliciKayitsiz: false, createdAt: { gte: new Date(simdi - yanitGunSayisi * 86_400_000) } }] }],
  };
}

/** EBLG-94: geçici hatayla düşen gönderim en çok bu kadar, bu aralıkla kendiliğinden yeniden denenir. */
export const EIRSALIYE_AZAMI_YENIDEN_DENEME = 3;
const EIRSALIYE_YENIDEN_DENEME_ARALIK_MS = Number(process.env.EIRSALIYE_YENIDEN_DENEME_ARALIK_MS || 15 * 60 * 1_000);

/**
 * EBLG-94: kendiliğinden yeniden gönderilecek e-İrsaliyeler — geçici hatayla
 * düşmüş (ağ, entegratörün 5xx/yetki/zaman aşımı; 400/422 içerik hatası
 * değil), deneme hakkı kalmış, son denemesinin üzerinden aralık geçmiş ve
 * programda iptal edilmemiş. Numara belgede kaldığı için aynı numarayla gider.
 */
export function eirsaliyeYenidenDenemeKosulu(tenantId: string, simdi: number): Prisma.EirsaliyeKayitWhereInput {
  return {
    tenantId,
    durum: "hata",
    geciciHata: true,
    yenidenDenemeSayisi: { lt: EIRSALIYE_AZAMI_YENIDEN_DENEME },
    updatedAt: { lt: new Date(simdi - EIRSALIYE_YENIDEN_DENEME_ARALIK_MS) },
    belge: { durum: { not: "iptal" } },
  };
}

@Injectable()
export class EirsaliyeService {
  private readonly logger = new Logger(EirsaliyeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly baglantilar: BaglantilarService,
    private readonly mukellefListesi: MukellefListesiService,
    private readonly ayarlar?: AyarlarService,
  ) {}

  /** Durum sonucunun kayda yazılan hâli. Açıklama yalnız dikkat gerektiren durumda tutulur. */
  private durumVerisi(sonuc: { durum: string; detay?: string; hamDurum?: string }) {
    const detay = sonuc.detay?.trim() || null;
    return {
      durum: sonuc.durum as EirsaliyeDurum,
      // EBLG-106: `kuyrukta` taslakta kalanı GİB'de bekleyenden ayırmaz; ham ad saklanır.
      entegratorDurumu: sonuc.hamDurum ?? null,
      // Taslakta kalan belgede açıklama entegratörün gerekçesidir (EBLG-106).
      hataMesaji: ["hata", "ret", "kismi_kabul"].includes(sonuc.durum) || eirsaliyeAsamasi(sonuc.hamDurum) === "taslak" ? detay : null,
      sonDurumSorguAt: new Date(),
    };
  }

  private async baglanti(tx: any, tenantId: string) {
    const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } });
    if (!baglanti) throw new BadRequestException("Aktif e-belge entegratör bağlantısı bulunamadı");
    return { baglanti, cfg: JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig, adapter: this.baglantilar.adapterCoz(baglanti.saglayici) };
  }

  /**
   * UBL-TR 1.2.1 DespatchAdvice. Eleman sırası şemada bağlayıcıdır ve GİB
   * örneğinden birebir alınmıştır (`docs/e-belge/… UBL-TR 1.2.1/XML/
   * DespatchAdvice.xml`); sıra bozulursa NES belgeyi `FAILED_XML_SCHEMA_CHECK`
   * ile geri çevirir.
   *
   * `ProfileID` **TEMELIRSALIYE**'dir; `SEVK` belgenin türüdür
   * (`DespatchAdviceTypeCode`), profili değil. İDİS kapsamındaki sevkiyatta
   * profil **IDISIRSALIYE** olur ve sevkiyat/etiket numaraları eklenir
   * (EBLG-72; GİB İDİS Teknik Kılavuzu v1.0 §3).
   */
  private ubl(b: any, tenant: any) {
    const tarih = new Date(b.tarih).toISOString().slice(0, 10);
    // Fiili sevk zamanı belgeden gelir (EBLG-23); onayda boş bırakılmışsa onay
    // anıyla dolduruluyor, yine de yoksa belge tarihine düşülür.
    const sevk = new Date(b.fiiliSevkZamani ?? b.createdAt ?? b.tarih);
    // Türkiye saatiyle: UTC yazılırsa saat 3 saat geri, gece sevkinde gün de geri kayar.
    const { tarih: sevkTarihi, saat } = anTR(sevk);
    /** Firma kartındaki adres (EBLG-62); önceden sabit "Merkez/Istanbul" yazılıyordu. */
    const firmaAdresi = `<cac:PostalAddress>${tenant.adres ? `<cbc:StreetName>${esc(tenant.adres)}</cbc:StreetName>` : ""}<cbc:CitySubdivisionName>${esc(tenant.ilce ?? "") || "-"}</cbc:CitySubdivisionName><cbc:CityName>${esc(tenant.il ?? "") || "-"}</cbc:CityName>${tenant.postaKodu ? `<cbc:PostalZone>${esc(tenant.postaKodu)}</cbc:PostalZone>` : ""}<cac:Country><cbc:IdentificationCode>TR</cbc:IdentificationCode><cbc:Name>Türkiye</cbc:Name></cac:Country></cac:PostalAddress>`;
    /** EBLG-87: yükleme adresi (gümrük); şemada `Despatch` içinde sevk saatinden sonra. */
    const yuklemeAdresi = b.yuklemeAdresi
      ? `<cac:DespatchAddress><cbc:StreetName>${esc(b.yuklemeAdresi.adres)}</cbc:StreetName><cbc:CitySubdivisionName>${esc(b.yuklemeAdresi.ilce)}</cbc:CitySubdivisionName><cbc:CityName>${esc(b.yuklemeAdresi.il)}</cbc:CityName><cbc:PostalZone>${esc(b.yuklemeAdresi.postaKodu)}</cbc:PostalZone><cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country></cac:DespatchAddress>`
      : "";
    /** Karttaki adres (EBLG-55). */
    const kartAdresi = (a: ReturnType<typeof ublAdresi>) =>
      `<cac:PostalAddress>${a.adres ? `<cbc:StreetName>${esc(a.adres)}</cbc:StreetName>` : ""}<cbc:CitySubdivisionName>${esc(a.ilce)}</cbc:CitySubdivisionName><cbc:CityName>${esc(a.il)}</cbc:CityName>${a.postaKodu ? `<cbc:PostalZone>${esc(a.postaKodu)}</cbc:PostalZone>` : ""}<cac:Country><cbc:IdentificationCode>${a.ulkeKodu}</cbc:IdentificationCode>${a.ulkeAdi ? `<cbc:Name>${esc(a.ulkeAdi)}</cbc:Name>` : ""}</cac:Country></cac:PostalAddress>`;
    const taraf = (vkn: string, unvan: string, adresBlogu = firmaAdresi, ekKimlik = "") =>
      `<cac:Party><cac:PartyIdentification><cbc:ID schemeID="${vkn.length === 11 ? "TCKN" : "VKN"}">${esc(vkn)}</cbc:ID></cac:PartyIdentification>${ekKimlik}<cac:PartyName><cbc:Name>${esc(unvan)}</cbc:Name></cac:PartyName>${adresBlogu}</cac:Party>`;
    // Taşıyan: cari seçilmediyse malı kendi aracımızla götürmüşüzdür.
    // Taşıyan cari ise kendi kart adresi, biz isek firma adresi yazılır (EBLG-62).
    const tasiyan = b.tasiyiciCari
      ? { vknTckn: b.tasiyiciCari.vknTckn ?? "", unvan: b.tasiyiciCari.unvan, adres: kartAdresi(ublAdresi(b.tasiyiciCari.adresler)) }
      : { vknTckn: tenant.vkn, unvan: tenant.unvan, adres: firmaAdresi };
    const sofor = b.soforAdi && b.soforSoyadi
      ? `<cac:DriverPerson><cbc:FirstName>${esc(b.soforAdi)}</cbc:FirstName><cbc:FamilyName>${esc(b.soforSoyadi)}</cbc:FamilyName>${b.soforTckn ? `<cbc:NationalityID>${esc(b.soforTckn)}</cbc:NationalityID>` : ""}</cac:DriverPerson>`
      : "";
    const arac = b.plaka
      // Şematron 14.09.2026 §3: yabancı plaka ayrı schemeID ile bildirilir.
      ? `<cac:TransportMeans><cac:RoadTransport><cbc:LicensePlateID schemeID="${plakaSchemeId(b.plaka)}">${esc(plakaNormalize(b.plaka))}</cbc:LicensePlateID></cac:RoadTransport></cac:TransportMeans>`
      : "";
    const sevkiyatAsamasi = arac || sofor ? `<cac:ShipmentStage>${arac}${sofor}</cac:ShipmentStage>` : "";
    const dorse = b.dorsePlaka
      ? `<cac:TransportHandlingUnit><cac:TransportEquipment><cbc:ID schemeID="${dorseSchemeId(b.dorsePlaka)}">${esc(plakaNormalize(b.dorsePlaka))}</cbc:ID></cac:TransportEquipment></cac:TransportHandlingUnit>`
      : "";
    /**
     * Sipariş referansı (EBLG-74): belgeye elle girilen müşteri sipariş
     * numarası, yoksa irsaliyenin türediği sipariş belgesinin numarası. UBL-TR
     * `IssueDate`'i zorunlu tutar (fatura tarafında NES tarihsiz referansı
     * reddetti), bu yüzden tarih yoksa belgenin tarihine düşülür. Şemadaki yeri
     * `DespatchAdviceTypeCode` ile `AdditionalDocumentReference` arasıdır
     * (GİB `DespatchAdvice.xml`).
     */
    const siparis = b.siparisNo?.trim()
      ? { no: b.siparisNo.trim(), tarih: b.siparisTarihi ?? b.tarih }
      : b.kaynakBelge?.tur === "siparis" && b.kaynakBelge.no
        ? { no: b.kaynakBelge.no as string, tarih: b.kaynakBelge.tarih ?? b.tarih }
        : null;
    const siparisBlogu = siparis
      ? `<cac:OrderReference><cbc:ID>${esc(siparis.no)}</cbc:ID><cbc:IssueDate>${new Date(siparis.tarih).toISOString().slice(0, 10)}</cbc:IssueDate></cac:OrderReference>`
      : "";
    const faturaBlogu = b.fatura?.no
      ? `<cac:AdditionalDocumentReference><cbc:ID>${esc(b.fatura.no)}</cbc:ID><cbc:IssueDate>${new Date(b.fatura.tarih).toISOString().slice(0, 10)}</cbc:IssueDate><cbc:DocumentType>FATURA</cbc:DocumentType></cac:AdditionalDocumentReference>`
      : "";
    /** İDİS: sevkiyat numarası doluysa belge bu profille gider (EBLG-72). */
    const idis = idisBelgesiMi(b.idisSevkiyatNo) ? idisNormalize(b.idisSevkiyatNo) : null;
    const satirlar = b.satirlar
      .map(
        (s: any, i: number) =>
          `<cac:DespatchLine><cbc:ID>${i + 1}</cbc:ID><cbc:DeliveredQuantity unitCode="${birimUblKodu(s.birim)}">${s.miktar}</cbc:DeliveredQuantity><cac:OrderLineReference><cbc:LineID>${i + 1}</cbc:LineID></cac:OrderLineReference><cac:Item><cbc:Name>${esc(s.stok.ad)}</cbc:Name><cac:SellersItemIdentification><cbc:ID>${esc(s.stok.kod)}</cbc:ID></cac:SellersItemIdentification>${idis && s.idisEtiketNo ? `<cac:AdditionalItemIdentification><cbc:ID schemeID="ETIKETNO">${esc(idisNormalize(s.idisEtiketNo))}</cbc:ID></cac:AdditionalItemIdentification>` : ""}</cac:Item></cac:DespatchLine>`,
      )
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?><DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`
      + `<cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>TR1.2</cbc:CustomizationID><cbc:ProfileID>${idis ? IDIS_IRSALIYE_PROFILI : "TEMELIRSALIYE"}</cbc:ProfileID>`
      + `<cbc:ID>${esc(b.no ?? b.id)}</cbc:ID><cbc:CopyIndicator>false</cbc:CopyIndicator><cbc:UUID>${b.id}</cbc:UUID>`
      + `<cbc:IssueDate>${tarih}</cbc:IssueDate><cbc:IssueTime>${saat}</cbc:IssueTime>`
      + `<cbc:DespatchAdviceTypeCode>SEVK</cbc:DespatchAdviceTypeCode>`
      // EBLG-87/89: belgenin açıklamaları; şemada tür kodundan sonra gelir.
      + ((b.notlar ?? []) as string[]).map((n) => `<cbc:Note>${esc(n)}</cbc:Note>`).join("")
      + `<cbc:LineCountNumeric>${b.satirlar.length}</cbc:LineCountNumeric>`
      + siparisBlogu + faturaBlogu
      + `<cac:Signature><cbc:ID schemeID="VKN_TCKN">${esc(tenant.vkn)}</cbc:ID><cac:SignatoryParty><cac:PartyIdentification><cbc:ID schemeID="VKN">${esc(tenant.vkn)}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${esc(tenant.unvan)}</cbc:Name></cac:PartyName>${firmaAdresi}</cac:SignatoryParty><cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#Signature</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment></cac:Signature>`
      // İDİS'te sevkiyat numarası satıcının `PartyIdentification`'ına yazılır.
      + `<cac:DespatchSupplierParty>${taraf(tenant.vkn, tenant.unvan, firmaAdresi, idis ? `<cac:PartyIdentification><cbc:ID schemeID="SEVKIYATNO">${esc(idis)}</cbc:ID></cac:PartyIdentification>` : "")}</cac:DespatchSupplierParty>`
      + `<cac:DeliveryCustomerParty>${taraf(b.cari.vknTckn ?? "", b.cari.unvan, kartAdresi(ublAdresi(b.cari.adresler)))}</cac:DeliveryCustomerParty>`
      // Fiili sevk zamanı `cac:Shipment` içinde bildirilir; taşıyan ve plaka
      // bilgisi kartta tutulmadığı için yazılmıyor.
      // Fiili sevk zamanı ve malın nereye teslim edildiği `cac:Shipment`
      // içinde bildirilir; teslimat adresi zorunludur (şematron), taşıyan ve
      // plaka bilgisi ise kartta tutulmadığı için yazılmıyor.
      // Taşıyan: nakliyeci/kargo carisi seçildiyse o, seçilmediyse malı kendi
      // aracıyla götüren firma. Şoför ve plaka `ShipmentStage`'te taşınır;
      // GİB `DriverPerson` ya da `CarrierParty`'den en az birini ister.
      + `<cac:Shipment><cbc:ID>1</cbc:ID>${sevkiyatAsamasi}<cac:Delivery><cac:DeliveryAddress><cbc:StreetName>${esc(b.teslimatAdresi.adres)}</cbc:StreetName><cbc:CitySubdivisionName>${esc(b.teslimatAdresi.ilce)}</cbc:CitySubdivisionName><cbc:CityName>${esc(b.teslimatAdresi.il)}</cbc:CityName><cbc:PostalZone>${esc(b.teslimatAdresi.postaKodu)}</cbc:PostalZone><cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country></cac:DeliveryAddress><cac:CarrierParty><cac:PartyIdentification><cbc:ID schemeID="${tasiyan.vknTckn.length === 11 ? "TCKN" : "VKN"}">${esc(tasiyan.vknTckn)}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${esc(tasiyan.unvan)}</cbc:Name></cac:PartyName>${tasiyan.adres}</cac:CarrierParty><cac:Despatch><cbc:ActualDespatchDate>${sevkTarihi}</cbc:ActualDespatchDate><cbc:ActualDespatchTime>${saat}</cbc:ActualDespatchTime>${yuklemeAdresi}</cac:Despatch></cac:Delivery>${dorse}</cac:Shipment>`
      + `${satirlar}</DespatchAdvice>`;
  }

  /** `otomatik`: kuyruk işçisinin yeniden denemesi (EBLG-94); elle gönderim sayacı sıfırlar. */
  async gonder(belgeId: string, secenekler: { otomatik?: boolean } = {}) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({ where: { id: belgeId }, include: { cari: { include: { adresler: true } }, tasiyiciCari: { include: { adresler: true } }, satirlar: { include: { stok: true } }, eirsaliye: true, fatura: { select: { no: true, tarih: true } }, kaynakBelge: { select: { tur: true, no: true, tarih: true } }, depo: true } });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      if (belge.tur !== "irsaliye" || (belge.yon !== "satis" && !belge.gumrukDepoSevki)) throw new BadRequestException("Yalnızca satış irsaliyesi ve gümrükten depoya sevk irsaliyesi e-İrsaliye olarak gönderilebilir");
      if (belge.kagitIrsaliye) throw new BadRequestException("Kâğıt irsaliye e-İrsaliye olarak gönderilmez; firma onay anında e-İrsaliye kullanıcısı değildi");
      // Faturalanmış (kapandı) irsaliye de gönderilir: fatura sevkten önce
      // kesilebilir ya da irsaliye faturaya bağlanabilir (EBLG-76, FTR-26).
      if (!IRSALIYE_GONDERILEBILIR_DURUMLAR.includes(belge.durum)) throw new BadRequestException("e-İrsaliye göndermek için belge onaylanmış olmalıdır");
      // Entegratöre ulaşmış belge ikinci kez yüklenmez; yükleme artık `kuyrukta`
      // yazdığından (EBLG-106) yalnız `iletildi`/`kabul`'e bakmak yetmez.
      // Taslakta kalan belge `taslakGonder` ile ilerletilir.
      if (belge.eirsaliye?.entegratorRef && belge.eirsaliye.durum !== "hata") return belge.eirsaliye;
      const { baglanti, cfg, adapter } = await this.baglanti(tx, tenantId);
      if (!adapter.irsaliyeGonder) throw new BadRequestException("Seçili entegratör e-İrsaliye gönderimini desteklemiyor");
      // EBLG-84: yurt dışı alıcının Türk VKN'si yoktur; belgeye GİB'in yurt dışı
      // alıcı VKN'si yazılır ve GİB listesine bakılmaz (alıcı hiç kayıtlı olamaz).
      const yurtDisi = eirsaliyeYurtDisiMi(belge);
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      // EBLG-87: gümrükten depoya sevkte satıcı da alıcı da firmanın kendisidir;
      // belge firmanın kendi e-İrsaliye posta kutusuna gider.
      const aliciVkn = belge.gumrukDepoSevki ? tenant?.vkn : belge.cari.vknTckn;
      if (!aliciVkn && !yurtDisi) throw new BadRequestException(belge.gumrukDepoSevki ? "Firma kartında VKN eksik" : "Cari VKN/TCKN bilgisi eksik");
      // e-İrsaliye kaydı GİB'de e-Fatura'dan ayrıdır; lokal liste sorgusu da
      // "eirsaliye" türüyle yapılır (EBLG-10).
      // EBLG-95: "Muhtelif Müşteriler" (5555555555) GİB'de kayıtlı bir alıcı
      // değildir; belge alıcı etiketi olmadan gider, çıktısı araçta bulunur.
      const muhtelif = !belge.gumrukDepoSevki && muhtelifMusteriMi(belge.cari);
      const mukellef = yurtDisi || muhtelif ? undefined : await this.mukellefListesi.kanalBelirle(baglanti.saglayici, cfg, aliciVkn!, "eirsaliye", belge.gumrukDepoSevki ? undefined : belge.cari.eirsaliyePostaKutusu);
      // Kalan ön koşullar ekranın gösterdiğiyle aynı kuraldan gelir (EBLG-42);
      // taşıyan bilgisi irsaliye onayında değil burada zorunludur (EBLG-23):
      // kâğıt irsaliye kesen firma engellenmesin, GİB'e giden belge eksik gitmesin.
      // EBLG-83: kayıtlı alıcıya kendi posta kutusuna gider; kayıtlı olmayana
      // da e-İrsaliye düzenlenir, belge alıcı etiketi olmadan gönderilir.
      let aliciPostaKutusu = mukellef?.eFaturaMukellefi ? mukellef.postaKutusu : undefined;
      const engeller = gonderimEngelleri({ ...belge, cari: { vknTckn: belge.cari.vknTckn, adresler: belge.cari.adresler } });
      // Malın fiilen nereye gittiği e-İrsaliye'nin varlık sebebi; uydurulmuş
      // bir adres yazmaktansa gönderim durur. Engel listesi boşsa adres
      // vardır; burada daraltılır. İrsaliyeye girilen adres önce gelir (EBLG-84).
      const teslimatAdresi = irsaliyeTeslimatAdresi({ ...belge, cari: { vknTckn: belge.cari.vknTckn, adresler: belge.cari.adresler as { tip: string; adres: string; il: string | null; ilce: string | null; postaKodu: string | null; ulke: string | null }[] } });
      if (engeller.length > 0 || !teslimatAdresi) {
        throw new BadRequestException(engeller[0]?.mesaj ?? "e-İrsaliye teslimat adresi bulunamadı");
      }
      // EBLG-62: gönderen adresi belgede zorunlu; firma kartı eksikse durulur.
      const firmaEksigi = tenant ? firmaEbelgeEksikleri(tenant) : [];
      if (firmaEksigi.length) throw new BadRequestException(firmaEksigi.join("; "));
      // EBLG-83: numara onayda değil burada, bütün engeller geçildikten sonra
      // verilir; hiç gönderilmeyen irsaliye giden seride boşluk bırakmaz.
      // Gönderim hata alırsa numara belgede kalır, yeniden gönderim aynı
      // numarayla yapılır.
      // EBLG-97: önek boşken sessizce varsayılan IRS kullanılıyordu; o seri
      // entegratörde otomatik numaralı olabiliyor ve belge reddediliyordu.
      const seriOneki = cfg.eirsaliyeSeriOneki?.trim();
      if (!seriOneki) throw new BadRequestException("Entegratör bağlantısında e-İrsaliye seri öneki girilmemiş; Ayarlar › Entegratörler'de entegratörde elle numaralı bir e-İrsaliye serisi yazın");
      // EBLG-97: seri yanlış ayarlandığı için entegratöre hiç ulaşmamış belgenin
      // numarası, önek düzeltildikten sonra yeni seriden yeniden verilir.
      if (belge.no && eirsaliyeNumarasiSerbestMi(belge.no, seriOneki, belge.eirsaliye)) {
        await eirsaliyeNumarasiniGeriAl(tx, { tenantId, yil: belge.tarih.getFullYear(), no: belge.no });
        belge.no = null;
      }
      if (!belge.no) {
        const yil = belge.tarih.getFullYear();
        const sira = await eirsaliyeSirasiAl(tx, { tenantId, onek: seriOneki, yil });
        belge.no = eirsaliyeNumarasi(seriOneki, yil, sira);
        await tx.belge.update({ where: { id: belge.id }, data: { no: belge.no } });
      }
      const cari = belge.gumrukDepoSevki && tenant
        ? { unvan: tenant.unvan, vknTckn: tenant.vkn, adresler: [{ tip: "merkez", adres: tenant.adres, il: tenant.il, ilce: tenant.ilce, postaKodu: tenant.postaKodu, ulke: "TR" }] }
        : yurtDisi ? { ...belge.cari, vknTckn: YURT_DISI_ALICI_VKN } : belge.cari;
      const notlar: string[] = [];
      if (belge.gumrukDepoSevki && belge.gumrukBeyannameNo && belge.gumrukBeyannameTarihi && belge.gumrukSeferNo) {
        notlar.push(gumrukSeferNotu({ beyannameNo: belge.gumrukBeyannameNo, beyannameTarihi: belge.gumrukBeyannameTarihi.toISOString(), seferNo: belge.gumrukSeferNo }));
      }
      // EBLG-89: ihracat irsaliyesi önceden düzenlenmiş faturaya bağlıysa fatura
      // açıklamada da anılır (mali müşavir önerisi, 2026-09-24). Fatura sonra
      // kesilirse yazılamaz: gönderilmiş e-İrsaliye değiştirilemez.
      if (yurtDisi && belge.fatura?.no) {
        notlar.push(ihracatFaturasiNotu({ faturaNo: belge.fatura.no, faturaTarihi: belge.fatura.tarih.toISOString() }));
      }
      const xml = this.ubl({ ...belge, cari, teslimatAdresi, notlar, yuklemeAdresi: belge.gumrukDepoSevki ? irsaliyeYuklemeAdresi(belge) : undefined }, tenant);
      // EBLG-106: NES'in toplu listesinde olup canlı sorgusunda olmayan kutu
      // (2026-09-27: 1234567801'in nes.com.tr kutuları) hata vermeden boşaltılır,
      // belge taslakta kalır. Birden çok kutusu olan alıcıda seçim canlı listeyle
      // doğrulanır; tek kutulu alıcıda (gerçek firmaların çoğu) ek çağrı yapılmaz.
      if (aliciPostaKutusu && mukellef?.postaKutulari && adapter.irsaliyePostaKutulariSorgula) {
        const canli = await adapter.irsaliyePostaKutulariSorgula(cfg, aliciVkn!).catch(() => null);
        if (canli?.length && !canli.includes(aliciPostaKutusu)) {
          const { adaylar } = await postaKutusuSecimi(tx, aliciVkn!, "eirsaliye", null, cfg.gondericiBirimEtiketi);
          const gecerli = adaylar.filter((a) => canli.includes(a.postaKutusu));
          const yeni = postaKutusuSec(gecerli.length ? gecerli : canli.map((k) => ({ postaKutusu: k })), cfg.gondericiBirimEtiketi);
          this.logger.warn(JSON.stringify({ event: "eirsaliye_posta_kutusu_degisti", tenantId, belgeNo: belge.no, eski: aliciPostaKutusu, yeni }));
          aliciPostaKutusu = yeni;
        }
      }
      const sonuc = await adapter.irsaliyeGonder(cfg, { uuid: belge.id, belgeNo: belge.no, xml, aliciPostaKutusu });
      // Seçilen kutu belgede saklanmaz; entegratörde farklı kutu görünürse iz buradadır.
      this.logger.log(JSON.stringify({ event: "eirsaliye_gonderildi", tenantId, belgeNo: belge.no, aliciPostaKutusu: aliciPostaKutusu ?? null, basarili: sonuc.basarili }));
      // EBLG-85: etiketsiz giden belgeyi alıcı GİB'den alamaz; çıktısı verilir.
      // Hata mesajı açıkça `null` yazılır: `undefined` alanı Prisma güncellemez
      // ve başarılı yeniden gönderim önceki hatayı göstermeye devam ederdi.
      // EBLG-94: içerik hatası (kalıcı) dışındaki başarısızlık kendiliğinden yeniden denenir.
      // EBLG-106: yüklemenin kabulü GİB'e iletim değildir; NES geçersiz etiketli
      // belgeyi taslakta bile bırakabilir. İlerleyişi durum sorgusu söyler.
      const kayit = { durum: sonuc.basarili ? ("kuyrukta" as const) : ("hata" as const), entegratorDurumu: null, entegratorRef: sonuc.belgeRef, xmlIcerik: xml, hataMesaji: seriHatasiAciklamasi(sonuc.hataMesaji) ?? null, aliciKayitsiz: !aliciPostaKutusu, geciciHata: !sonuc.basarili && !sonuc.kalici };
      return tx.eirsaliyeKayit.upsert({
        where: { belgeId },
        create: { tenantId, belgeId, ...kayit, yenidenDenemeSayisi: secenekler.otomatik ? 1 : 0 },
        update: { ...kayit, yenidenDenemeSayisi: secenekler.otomatik ? { increment: 1 } : 0 },
      });
    });
  }

  async durum(belgeId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.eirsaliyeKayit.findFirst({ where: { belgeId } });
      if (!kayit) throw new NotFoundException("e-İrsaliye gönderim kaydı bulunamadı");
      if (!kayit.entegratorRef) return kayit;
      const { cfg, adapter } = await this.baglanti(tx, tenantId);
      if (!adapter.irsaliyeDurumSorgula) throw new BadRequestException("Entegratör e-İrsaliye durumunu desteklemiyor");
      let sonuc;
      try {
        sonuc = await adapter.irsaliyeDurumSorgula(cfg, kayit.entegratorRef);
      } catch (hata) {
        // Ulaşılamayan entegratör belgeyi hatalı yapmaz (EBLG-36); kullanıcıya söylenir.
        throw new BadGatewayException(`e-İrsaliye durumu sorgulanamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
      }
      return tx.eirsaliyeKayit.update({ where: { id: kayit.id }, data: this.durumVerisi(sonuc) });
    });
  }

  /**
   * EBLG-106: alıcının GİB e-İrsaliye posta kutuları. Taslakta kalan belgeye
   * etiket bu listeden seçilir; gümrükten depoya sevkte alıcı firmanın kendisidir.
   */
  private async aliciPostaKutulari(tx: Prisma.TransactionClient, tenantId: string, belge: { gumrukDepoSevki: boolean; cari: { vknTckn: string | null; eirsaliyePostaKutusu: string | null } }) {
    const vkn = belge.gumrukDepoSevki ? (await tx.tenant.findUnique({ where: { id: tenantId }, select: { vkn: true } }))?.vkn : belge.cari.vknTckn?.trim();
    if (!vkn) return { vkn: null, adaylar: [] as string[], kartta: null as string | null };
    const secim = await postaKutusuSecimi(tx, vkn, "eirsaliye", belge.gumrukDepoSevki ? null : belge.cari.eirsaliyePostaKutusu, await kendiGbEtiketi(tx, tenantId));
    return { vkn, adaylar: secim.adaylar.map((a) => a.postaKutusu), kartta: secim.elleSecilenGecersiz ? null : secim.elleSecilen };
  }

  /**
   * EBLG-106: entegratörün alıcı etiketini kabul etmeyip taslakta bıraktığı
   * irsaliyeye etiket verir ve taslağı gönderir. Etiket alıcının GİB listesinden
   * seçilir; `kartaKaydet` ile cari kartına da yazılır ki sonraki irsaliye aynı
   * kutuya gitsin. Durum hemen sorulur: kullanıcı ilerleyişi aynı ekranda görür.
   */
  async taslakGonder(belgeId: string, girdi: { postaKutusu: string; kartaKaydet?: boolean }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.eirsaliyeKayit.findFirst({
        where: { belgeId },
        include: { belge: { select: { no: true, cariId: true, gumrukDepoSevki: true, cari: { select: { vknTckn: true, eirsaliyePostaKutusu: true } } } } },
      });
      if (!kayit?.entegratorRef) throw new NotFoundException("e-İrsaliye gönderim kaydı bulunamadı");
      if (eirsaliyeAsamasi(kayit.entegratorDurumu) !== "taslak") throw new BadRequestException("Belge entegratörde taslakta değil; önce durumunu sorgulayın");
      const { cfg, adapter } = await this.baglanti(tx, tenantId);
      if (!adapter.irsaliyeTaslaginiGonder) throw new BadRequestException("Seçili entegratör taslak gönderimini desteklemiyor");
      const { vkn, adaylar } = await this.aliciPostaKutulari(tx, tenantId, kayit.belge);
      if (!adaylar.includes(girdi.postaKutusu)) throw new BadRequestException("Seçilen posta kutusu alıcının GİB e-İrsaliye listesinde yok");
      // Toplu listede olup entegratörün canlı sorgusunda olmayan kutu belgeyi yine taslağa düşürür.
      const canli = vkn && adapter.irsaliyePostaKutulariSorgula ? await adapter.irsaliyePostaKutulariSorgula(cfg, vkn).catch(() => null) : null;
      if (canli && !canli.includes(girdi.postaKutusu)) throw new BadRequestException("Seçilen posta kutusu entegratörün güncel listesinde yok; başka bir kutu seçin");
      try {
        await adapter.irsaliyeTaslaginiGonder(cfg, kayit.entegratorRef, girdi.postaKutusu);
      } catch (hata) {
        throw new BadGatewayException(`Taslak gönderilemedi: ${hata instanceof Error ? hata.message : String(hata)}`);
      }
      this.logger.log(JSON.stringify({ event: "eirsaliye_gonderildi", tenantId, belgeNo: kayit.belge.no, aliciPostaKutusu: girdi.postaKutusu, basarili: true, taslak: true }));
      if (girdi.kartaKaydet && !kayit.belge.gumrukDepoSevki) {
        await tx.cariHesap.update({ where: { id: kayit.belge.cariId }, data: { eirsaliyePostaKutusu: girdi.postaKutusu } });
      }
      // Taslak gönderildi; sorgu başarısız olsa bile eski `Waiting` yazılı kalmamalı.
      const sonuc = await adapter.irsaliyeDurumSorgula?.(cfg, kayit.entegratorRef).catch(() => null);
      return tx.eirsaliyeKayit.update({ where: { id: kayit.id }, data: sonuc ? this.durumVerisi(sonuc) : { entegratorDurumu: null } });
    });
  }

  /**
   * EBLG-36: bekleyen giden e-İrsaliyelerin durumunu sorgular. NES'te toplu
   * durum ucu yoktur; irsaliye başına bir çağrı yapılır, her birinin ardından
   * `sonDurumSorguAt` yazılır ki aynı irsaliye 2 saat dolmadan yeniden sorulmasın.
   * Çağrısı başarısız olan irsaliyeye dokunulmaz, sonraki turda yeniden denenir.
   */
  async durumlariTopluSorgula(): Promise<{ sorgulanan: number; guncellenen: number; atlanan: number }> {
    const { tenantId } = aktifBaglam();
    const hazirlik = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } });
      if (!baglanti) return null;
      const adapter = this.baglantilar.adapterCoz(baglanti.saglayici);
      if (!adapter.irsaliyeDurumSorgula) return null;
      const ayarlar = this.ayarlar ? await this.ayarlar.getir("ebelge", tx) : {};
      const yanitGunSayisi = Number(ayarlar.eirsaliyeYanitGunSayisi ?? 10);
      const kayitlar = await tx.eirsaliyeKayit.findMany({
        where: eirsaliyeSorguKosulu(tenantId, Date.now(), yanitGunSayisi),
        select: { id: true, entegratorRef: true },
        orderBy: { sonDurumSorguAt: { sort: "asc", nulls: "first" } },
        take: 100,
      });
      return { cfg: JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig, adapter, kayitlar };
    });
    if (!hazirlik) return { sorgulanan: 0, guncellenen: 0, atlanan: 0 };

    let guncellenen = 0;
    let atlanan = 0;
    for (const kayit of hazirlik.kayitlar) {
      try {
        const sonuc = await hazirlik.adapter.irsaliyeDurumSorgula!(hazirlik.cfg, kayit.entegratorRef!);
        await this.prisma.tenantIslem(tenantId, (tx) => tx.eirsaliyeKayit.update({ where: { id: kayit.id }, data: this.durumVerisi(sonuc) }));
        guncellenen += 1;
      } catch (hata) {
        atlanan += 1;
        this.logger.warn(JSON.stringify({ event: "eirsaliye_durum_sorgusu_atlandi", tenantId, kayitId: kayit.id, hata: hata instanceof Error ? hata.message : String(hata) }));
      }
    }
    return { sorgulanan: hazirlik.kayitlar.length, guncellenen, atlanan };
  }

  // ─── Giden e-İrsaliyeler (EBLG-41…43) ─────────────────────────────────────

  /**
   * Gönderilmiş ve gönderilmeyi bekleyen satış irsaliyeleri tek listede.
   * Bekleyenlerin gönderim engelleri (EBLG-42) yerel veriden hesaplanır;
   * mükellefiyet yerel GİB listesinden okunur, liste bayatsa engel sayılmaz.
   */
  async gidenListele(durumSuzgeci?: string) {
    const { tenantId, rol } = aktifBaglam();
    // Gönderim uçları muhasebe ve yöneticiye açıktır; satış ekranı görür ama
    // gönderemez, buton da bu yüzden sunucunun bildirdiği yetkiye bakar.
    const gonderebilir = rol === "muhasebe" || rol === "yonetici";
    const mukellefDurumu = await this.mukellefListesi.durum();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belgeler = await tx.belge.findMany({
        where: {
          tur: "irsaliye",
          // EBLG-83: kâğıt irsaliye e-İrsaliye defterine girmez.
          kagitIrsaliye: false,
          AND: [
            // EBLG-87: gümrükten depoya sevk alış irsaliyesidir ama firma gönderir.
            { OR: [{ yon: "satis" }, { gumrukDepoSevki: true }] },
            // Kaydı olan her irsaliye defterde kalır; kaydı olmayanlardan yalnız
            // onaylı olanlar gönderilmeyi bekliyor sayılır.
            { OR: [{ eirsaliye: { isNot: null } }, { durum: { in: IRSALIYE_GONDERILEBILIR_DURUMLAR as ZincirBelgeDurum[] } }] },
          ],
        },
        select: {
          id: true,
          no: true,
          tarih: true,
          durum: true,
          fiiliSevkZamani: true,
          tur: true,
          yon: true,
          tasiyiciCariId: true,
          soforAdi: true,
          soforSoyadi: true,
          plaka: true,
          dorsePlaka: true,
          idisSevkiyatNo: true,
          // Gönderimdeki denetim satırları aynı sırayla görür; mesajdaki satır no tutar.
          satirlar: { select: { idisEtiketNo: true } },
          genelToplam: true,
          teslimatAdres: true,
          teslimatIl: true,
          teslimatIlce: true,
          teslimatPostaKodu: true,
          gumrukDepoSevki: true,
          gumrukBeyannameNo: true,
          gumrukBeyannameTarihi: true,
          yuklemeAdres: true,
          yuklemeIl: true,
          yuklemeIlce: true,
          yuklemePostaKodu: true,
          depo: { select: { adres: true, il: true, ilce: true, postaKodu: true } },
          cari: { select: { unvan: true, vknTckn: true, adresler: { select: { tip: true, il: true, ilce: true, postaKodu: true, ulke: true } } } },
          tasiyiciCari: { select: { vknTckn: true } },
          eirsaliye: { select: { durum: true, entegratorRef: true, entegratorDurumu: true, hataMesaji: true, sonDurumSorguAt: true, createdAt: true, aliciKayitsiz: true, geciciHata: true, yenidenDenemeSayisi: true } },
        },
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        take: 500,
      });

      const satirlar = belgeler.map((b) => {
        const gonderildi = Boolean(b.eirsaliye);
        // Gönderilmiş belgede engel aramak anlamsız; defterde durumu konuşulur.
        const engeller = gonderildi && b.eirsaliye?.durum !== "hata" ? [] : gonderimEngelleri(b);
        return {
          belgeId: b.id,
          belgeNo: b.no,
          tarih: b.tarih.toISOString().slice(0, 10),
          fiiliSevkZamani: b.fiiliSevkZamani?.toISOString() ?? null,
          belgeDurumu: b.durum,
          genelToplam: b.genelToplam.toFixed(2),
          cari: { unvan: b.cari.unvan, vknTckn: b.cari.vknTckn },
          gumrukDepoSevki: b.gumrukDepoSevki,
          durum: b.eirsaliye?.durum ?? ("gonderilmedi" as const),
          entegratorRef: b.eirsaliye?.entegratorRef ?? null,
          // EBLG-106: `kuyrukta` belgenin entegratördeki aşaması (taslak / GİB'de).
          entegratorDurumu: b.eirsaliye?.entegratorDurumu ?? null,
          hataMesaji: b.eirsaliye?.hataMesaji ?? null,
          sonDurumSorguAt: b.eirsaliye?.sonDurumSorguAt?.toISOString() ?? null,
          gonderimZamani: b.eirsaliye?.createdAt.toISOString() ?? null,
          // EBLG-85: alıcı GİB'den alamaz; çıktısı düzenleyen tarafından verilir.
          aliciKayitsiz: b.eirsaliye?.aliciKayitsiz ?? false,
          // EBLG-94: geçici hatada kalan otomatik yeniden deneme hakkı; yoksa null.
          otomatikDenemeKalan: b.eirsaliye?.durum === "hata" && b.eirsaliye.geciciHata ? Math.max(0, EIRSALIYE_AZAMI_YENIDEN_DENEME - b.eirsaliye.yenidenDenemeSayisi) : null,
          engeller,
          gonderilebilir: engeller.length === 0 && (!gonderildi || b.eirsaliye?.durum === "hata"),
          mukellefDogrulandi: mukellefDurumu.taze,
        };
      });
      return {
        kayitlar: durumSuzgeci ? satirlar.filter((s) => s.durum === durumSuzgeci) : satirlar,
        yetkiler: { gonderebilir },
      };
    });
  }

  /** Giden e-İrsaliyenin UBL içeriği ve hata ayrıntısı. */
  async gidenDetay(belgeId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.eirsaliyeKayit.findUnique({
        where: { belgeId },
        select: { durum: true, entegratorRef: true, entegratorDurumu: true, hataMesaji: true, xmlIcerik: true, sonDurumSorguAt: true, createdAt: true, belge: { select: { no: true, tarih: true, gumrukDepoSevki: true, cari: { select: { unvan: true, vknTckn: true, eirsaliyePostaKutusu: true } } } } },
      });
      if (!kayit) throw new NotFoundException("Bu belge için e-İrsaliye kaydı bulunamadı");
      // EBLG-106: taslakta kalan belgeye etiket seçtirmek için alıcının kutuları.
      const kutular = eirsaliyeAsamasi(kayit.entegratorDurumu) === "taslak" ? await this.aliciPostaKutulari(tx, tenantId, kayit.belge) : null;
      // Canlı sorgu yalnız taslakta yapılır; entegratöre ulaşılamazsa toplu liste yeter.
      let canliPostaKutulari: string[] | null = null;
      if (kutular?.vkn) {
        const { cfg, adapter } = await this.baglanti(tx, tenantId);
        canliPostaKutulari = adapter.irsaliyePostaKutulariSorgula ? await adapter.irsaliyePostaKutulariSorgula(cfg, kutular.vkn).catch(() => null) : null;
      }
      return {
        belgeNo: kayit.belge.no,
        tarih: kayit.belge.tarih.toISOString().slice(0, 10),
        cariUnvan: kayit.belge.cari.unvan,
        durum: kayit.durum,
        entegratorRef: kayit.entegratorRef,
        entegratorDurumu: kayit.entegratorDurumu,
        aliciPostaKutulari: kutular?.adaylar ?? null,
        karttakiPostaKutusu: kutular?.kartta ?? null,
        /** EBLG-106: entegratörün canlı sorgusundaki kutular; `null` → sorgulanamadı. */
        canliPostaKutulari,
        hataMesaji: kayit.hataMesaji,
        xmlIcerik: kayit.xmlIcerik,
        sonDurumSorguAt: kayit.sonDurumSorguAt?.toISOString() ?? null,
        gonderimZamani: kayit.createdAt.toISOString(),
      };
    });
  }

  /** EBLG-106: giden irsaliyenin entegratördeki işlem geçmişi; neden taslakta kaldığı burada yazar. */
  async gidenEntegratorGecmisi(belgeId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.eirsaliyeKayit.findUnique({ where: { belgeId }, select: { entegratorRef: true } });
      if (!kayit?.entegratorRef) throw new NotFoundException("Belge entegratöre ulaşmamış; işlem geçmişi yok");
      const { cfg, adapter } = await this.baglanti(tx, tenantId);
      if (!adapter.irsaliyeGecmisi) throw new BadRequestException("Seçili entegratör işlem geçmişi vermiyor");
      try {
        return await adapter.irsaliyeGecmisi(cfg, kayit.entegratorRef);
      } catch (hata) {
        throw new BadGatewayException(`İşlem geçmişi alınamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
      }
    });
  }

  /** Tek seferde gönderilebilecek azami belge sayısı (EBLG-43). */
  static readonly TOPLU_GONDERIM_SINIRI = 50;

  /**
   * EBLG-43: seçilen irsaliyeleri sırayla gönderir. Her belge kendi işleminde
   * ilerler; biri başarısız olduğunda kalanlar durmaz ve sonuç belge numarasıyla
   * raporlanır — toplu çağrının yarısının sessizce kaybolmaması için.
   */
  async topluGonder(belgeIdler: string[]): Promise<{ gonderilen: number; basarisiz: { belgeId: string; belgeNo: string | null; hata: string }[] }> {
    const { tenantId } = aktifBaglam();
    if (belgeIdler.length > EirsaliyeService.TOPLU_GONDERIM_SINIRI) {
      throw new BadRequestException(`Tek seferde en çok ${EirsaliyeService.TOPLU_GONDERIM_SINIRI} e-İrsaliye gönderilebilir`);
    }
    const numaralar = new Map(
      (await this.prisma.tenantIslem(tenantId, (tx) => tx.belge.findMany({ where: { id: { in: belgeIdler } }, select: { id: true, no: true } }))).map((b) => [b.id, b.no]),
    );
    let gonderilen = 0;
    const basarisiz: { belgeId: string; belgeNo: string | null; hata: string }[] = [];
    for (const belgeId of belgeIdler) {
      try {
        await this.gonder(belgeId);
        gonderilen++;
      } catch (hata) {
        basarisiz.push({ belgeId, belgeNo: numaralar.get(belgeId) ?? null, hata: hata instanceof Error ? hata.message : "Bilinmeyen hata" });
      }
    }
    return { gonderilen, basarisiz };
  }

  /** EBLG-93: giden e-İrsaliye serisinde boşta kalan numaralar ve firma bilgisi (taslak için). */
  async numaraBosluklari(yil: number) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" }, select: { sifreliConfig: true } });
      const seriOneki = (baglanti ? (JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig).eirsaliyeSeriOneki : undefined) ?? VARSAYILAN_EIRSALIYE_ONEKI;
      const [belgeler, sayac, firma] = await Promise.all([
        tx.belge.findMany({
          where: { tur: "irsaliye", no: { startsWith: `${seriOneki}${yil}` } },
          select: { id: true, no: true, durum: true, tarih: true, eirsaliye: { select: { durum: true } } },
        }),
        eirsaliyeSayacSonSira(tx, { tenantId, onek: seriOneki, yil }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true, vkn: true, vergiDairesi: true, adres: true, ilce: true, il: true } }),
      ]);
      const veri = numaraBosluklariniBul({ seriOneki, yil, sayacSonSira: sayac, belgeler: belgeler.map((b) => ({ ...b, no: b.no! })) });
      return { veri, firma: firma! };
    });
  }

  /**
   * EBLG-94: geçici hatayla düşmüş gönderimleri aynı numarayla yeniden dener.
   * Gönderim bu arada başka bir engele takılırsa (ör. carinin adresi silindi)
   * deneme yine sayılır; yoksa her turda aynı kayıt denenirdi.
   */
  async geciciHatalariYenidenGonder(): Promise<{ denenen: number; basarili: number; basarisiz: number }> {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.eirsaliyeKayit.findMany({ where: eirsaliyeYenidenDenemeKosulu(tenantId, Date.now()), select: { id: true, belgeId: true }, orderBy: { updatedAt: "asc" }, take: 50 }),
    );
    let basarili = 0;
    for (const kayit of kayitlar) {
      try {
        const sonuc = await this.gonder(kayit.belgeId, { otomatik: true });
        if (sonuc.durum !== "hata") basarili += 1;
      } catch (hata) {
        await this.prisma.tenantIslem(tenantId, (tx) => tx.eirsaliyeKayit.update({
          where: { id: kayit.id },
          data: { yenidenDenemeSayisi: { increment: 1 }, hataMesaji: hata instanceof Error ? hata.message : String(hata) },
        }));
        this.logger.warn(JSON.stringify({ event: "eirsaliye_yeniden_deneme_engellendi", tenantId, belgeId: kayit.belgeId, hata: hata instanceof Error ? hata.message : String(hata) }));
      }
    }
    return { denenen: kayitlar.length, basarili, basarisiz: kayitlar.length - basarili };
  }

  /**
   * Gelen e-İrsaliyeleri çeker. Pencere, kiracıya en son düşen gelen kaydından
   * bir gün geriden başlar (kayıt yoksa `EBLG_ILK_GELEN_PENCERE_GUN`, 7 gün);
   * eskiden her seferinde 30 gün istenirdi ve ortak test VKN'sinde (1234567802)
   * istek 5 dakikayı aşıp tek işlemdeki toplu yazma zaman aşımına düşüyordu
   * (2026-09-27). Bilinen belgelerin XML'i yeniden indirilmez; her belge kendi
   * işleminde yazılır, yarıda kalan çekimde yazılanlar korunur.
   */
  async gelenleriCek() {
    const { tenantId } = aktifBaglam();
    const { cfg, adapter, sonrasi, bilinenler, kendiVkn } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const { cfg, adapter } = await this.baglanti(tx, tenantId);
      const son = await tx.gelenEirsaliye.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
      const sonrasi = son
        ? new Date(son.createdAt.getTime() - 86_400_000)
        : new Date(Date.now() - Number(process.env.EBLG_ILK_GELEN_PENCERE_GUN || 7) * 86_400_000);
      // Pencerede entegratörde oluşan belge ancak ondan sonra çekilmiş olabilir.
      const kayitlar = await tx.gelenEirsaliye.findMany({ where: { createdAt: { gte: sonrasi } }, select: { uuid: true } });
      const kendiVkn = (await tx.tenant.findUnique({ where: { id: tenantId }, select: { vkn: true } }))?.vkn;
      return { cfg, adapter, sonrasi, bilinenler: new Set(kayitlar.map((k) => k.uuid)), kendiVkn };
    });
    if (!adapter.gelenIrsaliyeleriCek) throw new BadRequestException("Entegratör gelen e-İrsaliye akışını desteklemiyor");
    let gelen;
    try {
      gelen = await adapter.gelenIrsaliyeleriCek(cfg, sonrasi, bilinenler);
    } catch (hata) {
      throw new BadGatewayException(`Entegratörden gelen e-İrsaliyeler alınamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
    }
    let yeni = 0;
    for (const g of gelen) {
      await this.prisma.tenantIslem(tenantId, async (tx) => {
        if (!bilinenler.has(g.uuid)) {
          // EBLG-87: firmanın kendine gönderdiği belge (gümrükten depoya sevk) kendi
          // kutusuna da düşer; yanıt istemez, bekleyenlere girmez.
          const kendiSevkimiz = Boolean(kendiVkn) && g.gonderenVkn === kendiVkn;
          const sevkTarihi = gelenSevkTarihi(g.xml, g.tarih);
          const veri = { belgeNo: g.belgeNo, gonderenVkn: g.gonderenVkn, gonderenUnvan: g.gonderenUnvan, tarih: g.tarih, sevkTarihi, xmlIcerik: g.xml, kendiSevkimiz };
          await tx.gelenEirsaliye.upsert({ where: { tenantId_uuid: { tenantId, uuid: g.uuid } }, create: { tenantId, uuid: g.uuid, ...veri }, update: veri });
          yeni += 1;
        }
        // EBLG-34: portalda ya da başka bir yerde verilmiş karar yanıt bekleyen kayda yazılır; yerel kararın üzerine yazılmaz.
        if (g.yanit) await tx.gelenEirsaliye.updateMany({ where: { tenantId, uuid: g.uuid, durum: "yeni" }, data: { durum: g.yanit.karar, yanitGerekcesi: g.yanit.not ?? null } });
      });
    }
    // EBLG-109: planlayıcı taramayı bu andan itibaren aralık dolunca yeniden açar.
    // Kursör satırı e-Faturayla ortaktır; yoksa e-Faturanın ilk penceresiyle açılır.
    const simdi = new Date();
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ebelgeGelenKursor.upsert({
        where: { tenantId },
        create: { tenantId, sonCekimAt: new Date(simdi.getTime() - Number(process.env.EBLG_ILK_GELEN_PENCERE_GUN || 7) * 86_400_000), irsaliyeSonCekimAt: simdi },
        update: { irsaliyeSonCekimAt: simdi },
      }),
    );
    return { toplam: gelen.length, yeni, kontrolTarihi: simdi.toISOString() };
  }

  async gelenListele(durum?: GelenEirsaliyeDurum) { const { tenantId } = aktifBaglam(); return this.prisma.tenantIslem(tenantId, (tx) => tx.gelenEirsaliye.findMany({ where: durum ? { durum, ...(durum === "yeni" ? { kendiSevkimiz: false } : {}) } : undefined, select: { kendiSevkimiz: true, id: true, uuid: true, belgeNo: true, gonderenVkn: true, gonderenUnvan: true, tarih: true, sevkTarihi: true, durum: true, yanitRef: true, yanitBelgeNo: true, yanitGerekcesi: true, createdAt: true, updatedAt: true }, orderBy: [{ tarih: "desc" }, { createdAt: "desc" }] })); }

  async gelenDetay(id: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.gelenEirsaliye.findUnique({ where: { id } }));
    if (!kayit) throw new NotFoundException("Gelen e-İrsaliye bulunamadı");
    try {
      // Detay ekranı ve yedek PDF görünümü (EBLG-33) aynı okuyucuyu kullanır.
      const r = irsaliyeUblOku(kayit.xmlIcerik);
      const satirlar = r.satirlar.map(({ sira, stokKodu, ad, miktar, birim, aciklama }) => ({ sira, stokKodu, ad, miktar, birim, aciklama }));
      return { ...kayit, detay: { sevkTarihi: r.sevkTarihi, sevkSaati: r.sevkSaati, teslimatAdresi: r.teslimatAdresi, notlar: r.notlar, satirlar } };
    } catch {
      return { ...kayit, detay: { sevkTarihi: "", sevkSaati: "", teslimatAdresi: "", notlar: [], satirlar: [] } };
    }
  }

  async gelenYanit(id: string, yanit: "kabul" | "ret", gerekce?: string) {
    const { tenantId } = aktifBaglam();
    if (yanit === "ret" && !gerekce?.trim()) throw new BadRequestException("Ret gerekçesi zorunludur");
    const { kayit, cfg, adapter } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.gelenEirsaliye.findUnique({ where: { id } }); if (!kayit) throw new NotFoundException("Gelen e-İrsaliye bulunamadı");
      if (kayit.durum !== "yeni") throw new BadRequestException("Bu e-İrsaliyeye daha önce yanıt verilmiş");
      if (kayit.kendiSevkimiz) throw new BadRequestException("Bu belge firmanın kendi gönderdiği sevk irsaliyesi; yanıt verilmez");
      // EBLG-96: yanıt fiilî sevkten itibaren 7 gün içinde verilir; süresi geçen belge tam teslim alınmış sayılır.
      const sure = eirsaliyeYanitSuresi({ sevkGunu: kayit.sevkTarihi.toISOString().slice(0, 10), bugun: bugunTR() });
      if (sure.gecti) throw new BadRequestException(`Yanıt süresi ${sure.sonGun.split("-").reverse().join(".")} tarihinde doldu; belge tam teslim alınmış sayılır`);
      return { kayit, ...(await this.baglanti(tx, tenantId)) };
    });
    if (!adapter.irsaliyeYanitiGonder) throw new BadRequestException("Entegratör e-İrsaliye yanıtını desteklemiyor");
    // EBLG-34: belge portalda ya da aynı hesabı kullanan başka bir yerde yanıtlanmış olabilir. Sorgu yapılamazsa gönderim sürer; mükerrer yanıtı entegratör reddeder.
    const mevcut = adapter.gelenIrsaliyeYanitDurumu ? await adapter.gelenIrsaliyeYanitDurumu(cfg, kayit.uuid).catch(() => null) : null;
    if (mevcut) {
      await this.prisma.tenantIslem(tenantId, (tx) => tx.gelenEirsaliye.updateMany({ where: { tenantId, id, durum: "yeni" }, data: { durum: mevcut.karar, yanitGerekcesi: mevcut.not ?? null } }));
      throw new ConflictException(`Bu e-İrsaliyeye entegratörde zaten '${mevcut.karar}' yanıtı verilmiş; kayıt güncellendi`);
    }
    // Entegratör çağrısı veritabanı işleminin dışında yapılır: yanıt geri alınamaz, işlemi uzun süre açık tutmanın kazancı yok.
    const sonuc = await adapter.irsaliyeYanitiGonder(cfg, kayit.uuid, yanit, gerekce, kayit.xmlIcerik);
    if (!sonuc.basarili) throw new BadRequestException(sonuc.hataMesaji ?? "Yanıt gönderilemedi");
    return this.prisma.tenantIslem(tenantId, (tx) => tx.gelenEirsaliye.update({ where: { id }, data: { durum: yanit, yanitRef: sonuc.belgeRef, yanitBelgeNo: sonuc.belgeNo ?? null, yanitGerekcesi: gerekce ?? null } }));
  }
}
