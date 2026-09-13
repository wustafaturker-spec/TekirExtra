import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EirsaliyeDurum, GelenEirsaliyeDurum } from "@prisma/client";
import { durumAciklamasi } from "./durum-aciklamasi";
import type { EntegratorConfig } from "@tekirextra/baglanti";
import { aktifBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { PrismaService } from "../core/prisma.service";
import { BaglantilarService } from "../tenant/baglantilar.service";
import { irsaliyeUblOku } from "./eirsaliye-ubl-oku";
import { MukellefListesiService } from "./mukellef-listesi.service";

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

@Injectable()
export class EirsaliyeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly baglantilar: BaglantilarService,
    private readonly mukellefListesi: MukellefListesiService,
  ) {}

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
   * (`DespatchAdviceTypeCode`), profili değil.
   */
  private ubl(b: any, tenant: any) {
    const tarih = new Date(b.tarih).toISOString().slice(0, 10);
    // Fiili sevk zamanı belgeden gelir (EBLG-23); onayda boş bırakılmışsa onay
    // anıyla dolduruluyor, yine de yoksa belge tarihine düşülür.
    const sevk = new Date(b.fiiliSevkZamani ?? b.createdAt ?? b.tarih);
    const sevkTarihi = sevk.toISOString().slice(0, 10);
    const saat = sevk.toISOString().slice(11, 19);
    const adres = (birim: string, sehir: string) =>
      `<cac:PostalAddress><cbc:CitySubdivisionName>${esc(birim)}</cbc:CitySubdivisionName><cbc:CityName>${esc(sehir)}</cbc:CityName><cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country></cac:PostalAddress>`;
    const taraf = (vkn: string, unvan: string) =>
      `<cac:Party><cac:PartyIdentification><cbc:ID schemeID="${vkn.length === 11 ? "TCKN" : "VKN"}">${esc(vkn)}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${esc(unvan)}</cbc:Name></cac:PartyName>${adres("Merkez", "Istanbul")}</cac:Party>`;
    // Taşıyan: cari seçilmediyse malı kendi aracımızla götürmüşüzdür.
    const tasiyan = b.tasiyiciCari
      ? { vknTckn: b.tasiyiciCari.vknTckn ?? "", unvan: b.tasiyiciCari.unvan }
      : { vknTckn: tenant.vkn, unvan: tenant.unvan };
    const sofor = b.soforAdi && b.soforSoyadi
      ? `<cac:DriverPerson><cbc:FirstName>${esc(b.soforAdi)}</cbc:FirstName><cbc:FamilyName>${esc(b.soforSoyadi)}</cbc:FamilyName>${b.soforTckn ? `<cbc:NationalityID>${esc(b.soforTckn)}</cbc:NationalityID>` : ""}</cac:DriverPerson>`
      : "";
    const arac = b.plaka
      ? `<cac:TransportMeans><cac:RoadTransport><cbc:LicensePlateID schemeID="PLAKA">${esc(b.plaka)}</cbc:LicensePlateID></cac:RoadTransport></cac:TransportMeans>`
      : "";
    const sevkiyatAsamasi = arac || sofor ? `<cac:ShipmentStage>${arac}${sofor}</cac:ShipmentStage>` : "";
    const dorse = b.dorsePlaka
      ? `<cac:TransportHandlingUnit><cac:TransportEquipment><cbc:ID schemeID="DORSEPLAKA">${esc(b.dorsePlaka)}</cbc:ID></cac:TransportEquipment></cac:TransportHandlingUnit>`
      : "";
    const satirlar = b.satirlar
      .map(
        (s: any, i: number) =>
          `<cac:DespatchLine><cbc:ID>${i + 1}</cbc:ID><cbc:DeliveredQuantity unitCode="C62">${s.miktar}</cbc:DeliveredQuantity><cac:OrderLineReference><cbc:LineID>${i + 1}</cbc:LineID></cac:OrderLineReference><cac:Item><cbc:Name>${esc(s.stok.ad)}</cbc:Name><cac:SellersItemIdentification><cbc:ID>${esc(s.stok.kod)}</cbc:ID></cac:SellersItemIdentification></cac:Item></cac:DespatchLine>`,
      )
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?><DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`
      + `<cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>TR1.2</cbc:CustomizationID><cbc:ProfileID>TEMELIRSALIYE</cbc:ProfileID>`
      + `<cbc:ID>${esc(b.no ?? b.id)}</cbc:ID><cbc:CopyIndicator>false</cbc:CopyIndicator><cbc:UUID>${b.id}</cbc:UUID>`
      + `<cbc:IssueDate>${tarih}</cbc:IssueDate><cbc:IssueTime>${saat}</cbc:IssueTime>`
      + `<cbc:DespatchAdviceTypeCode>SEVK</cbc:DespatchAdviceTypeCode><cbc:LineCountNumeric>${b.satirlar.length}</cbc:LineCountNumeric>`
      + `<cac:Signature><cbc:ID schemeID="VKN_TCKN">${esc(tenant.vkn)}</cbc:ID><cac:SignatoryParty><cac:PartyIdentification><cbc:ID schemeID="VKN">${esc(tenant.vkn)}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${esc(tenant.unvan)}</cbc:Name></cac:PartyName>${adres("Merkez", "Istanbul")}</cac:SignatoryParty><cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#Signature</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment></cac:Signature>`
      + `<cac:DespatchSupplierParty>${taraf(tenant.vkn, tenant.unvan)}</cac:DespatchSupplierParty>`
      + `<cac:DeliveryCustomerParty>${taraf(b.cari.vknTckn ?? "", b.cari.unvan)}</cac:DeliveryCustomerParty>`
      // Fiili sevk zamanı `cac:Shipment` içinde bildirilir; taşıyan ve plaka
      // bilgisi kartta tutulmadığı için yazılmıyor.
      // Fiili sevk zamanı ve malın nereye teslim edildiği `cac:Shipment`
      // içinde bildirilir; teslimat adresi zorunludur (şematron), taşıyan ve
      // plaka bilgisi ise kartta tutulmadığı için yazılmıyor.
      // Taşıyan: nakliyeci/kargo carisi seçildiyse o, seçilmediyse malı kendi
      // aracıyla götüren firma. Şoför ve plaka `ShipmentStage`'te taşınır;
      // GİB `DriverPerson` ya da `CarrierParty`'den en az birini ister.
      + `<cac:Shipment><cbc:ID>1</cbc:ID>${sevkiyatAsamasi}<cac:Delivery><cac:DeliveryAddress><cbc:StreetName>${esc(b.teslimatAdresi.adres)}</cbc:StreetName><cbc:CitySubdivisionName>${esc(b.teslimatAdresi.ilce)}</cbc:CitySubdivisionName><cbc:CityName>${esc(b.teslimatAdresi.il)}</cbc:CityName><cbc:PostalZone>${esc(b.teslimatAdresi.postaKodu)}</cbc:PostalZone><cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country></cac:DeliveryAddress><cac:CarrierParty><cac:PartyIdentification><cbc:ID schemeID="${tasiyan.vknTckn.length === 11 ? "TCKN" : "VKN"}">${esc(tasiyan.vknTckn)}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${esc(tasiyan.unvan)}</cbc:Name></cac:PartyName>${adres("Merkez", "Istanbul")}</cac:CarrierParty><cac:Despatch><cbc:ActualDespatchDate>${sevkTarihi}</cbc:ActualDespatchDate><cbc:ActualDespatchTime>${saat}</cbc:ActualDespatchTime></cac:Despatch></cac:Delivery>${dorse}</cac:Shipment>`
      + `${satirlar}</DespatchAdvice>`;
  }

  async gonder(belgeId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({ where: { id: belgeId }, include: { cari: { include: { adresler: true } }, tasiyiciCari: true, satirlar: { include: { stok: true } }, eirsaliye: true } });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      if (belge.tur !== "irsaliye" || belge.yon !== "satis") throw new BadRequestException("Yalnızca satış irsaliyesi e-İrsaliye olarak gönderilebilir");
      if (belge.durum !== "onaylandi") throw new BadRequestException("e-İrsaliye göndermek için belge onaylanmış olmalıdır");
      if (belge.eirsaliye?.durum === "kabul" || belge.eirsaliye?.durum === "iletildi") return belge.eirsaliye;
      const { baglanti, cfg, adapter } = await this.baglanti(tx, tenantId);
      if (!adapter.irsaliyeGonder) throw new BadRequestException("Seçili entegratör e-İrsaliye gönderimini desteklemiyor");
      if (!belge.cari.vknTckn) throw new BadRequestException("Cari VKN/TCKN bilgisi eksik");
      // e-İrsaliye kaydı GİB'de e-Fatura'dan ayrıdır; lokal liste sorgusu da
      // "eirsaliye" türüyle yapılır (EBLG-10).
      const mukellef = await this.mukellefListesi.kanalBelirle(baglanti.saglayici, cfg, belge.cari.vknTckn, "eirsaliye");
      if (!mukellef.eFaturaMukellefi || !mukellef.postaKutusu) throw new BadRequestException("Cari e-İrsaliye alıcısı olarak tanımlı değil");
      // Malın fiilen nereye gittiği e-İrsaliye'nin varlık sebebi; uydurulmuş
      // bir adres yazmaktansa gönderim durur. Sevk adresi yoksa merkez/fatura
      // adresi kullanılır.
      const adresler = belge.cari.adresler as { tip: string; adres: string; il: string | null; ilce: string | null; postaKodu: string | null }[];
      // Şematron il, ilçe ve posta kodunun üçünü de dolu ister.
      const tam = (a: (typeof adresler)[number]) => Boolean(a.il && a.ilce && a.postaKodu);
      const teslimatAdresi =
        adresler.find((a) => a.tip === "sevk" && tam(a)) ??
        adresler.find((a) => (a.tip === "merkez" || a.tip === "fatura") && tam(a));
      if (!teslimatAdresi) {
        throw new BadRequestException("e-İrsaliye teslimat adresi ister; cari kartına il, ilçe ve posta kodu dolu bir sevk adresi ekleyin");
      }
      // Taşıyan bilgisi irsaliye onayında değil burada zorunlu (EBLG-23): kâğıt
      // irsaliye kesen firma engellenmesin, GİB'e giden belge eksik gitmesin.
      // Nakliyeciye verilmediyse malı kendi aracımızla götürmüşüzdür ve o
      // araca dair şoför/plaka bilgisini biz biliriz.
      if (!belge.tasiyiciCariId && !(belge.soforAdi && belge.soforSoyadi && belge.plaka)) {
        throw new BadRequestException(
          "e-İrsaliye taşıyan bilgisi ister: taşıyıcı firmayı seçin ya da şoför adı, soyadı ve plakayı girin",
        );
      }
      if (belge.tasiyiciCariId && !belge.tasiyiciCari?.vknTckn) {
        throw new BadRequestException("Taşıyıcı cari kartında VKN/TCKN bilgisi bulunmalıdır");
      }
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const xml = this.ubl({ ...belge, teslimatAdresi }, tenant);
      const sonuc = await adapter.irsaliyeGonder(cfg, { uuid: belge.id, belgeNo: belge.no ?? belge.id, xml, aliciPostaKutusu: mukellef.postaKutusu });
      return tx.eirsaliyeKayit.upsert({ where: { belgeId }, create: { tenantId, belgeId, durum: sonuc.basarili ? "iletildi" : "hata", entegratorRef: sonuc.belgeRef, xmlIcerik: xml, hataMesaji: sonuc.hataMesaji }, update: { durum: sonuc.basarili ? "iletildi" : "hata", entegratorRef: sonuc.belgeRef, xmlIcerik: xml, hataMesaji: sonuc.hataMesaji } });
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
      const sonuc = await adapter.irsaliyeDurumSorgula(cfg, kayit.entegratorRef);
      // İrsaliyede alıcı notu tutulmaz; açıklamadan yalnız hata kısmı kalır.
      return tx.eirsaliyeKayit.update({ where: { id: kayit.id }, data: { durum: sonuc.durum as EirsaliyeDurum, hataMesaji: durumAciklamasi(sonuc).hataMesaji } });
    });
  }

  async gelenleriCek() {
    const { tenantId } = aktifBaglam();
    const { cfg, adapter } = await this.prisma.tenantIslem(tenantId, (tx) => this.baglanti(tx, tenantId));
    if (!adapter.gelenIrsaliyeleriCek) throw new BadRequestException("Entegratör gelen e-İrsaliye akışını desteklemiyor");
    const gelen = await adapter.gelenIrsaliyeleriCek(cfg, new Date(Date.now() - 30 * 86400000));
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcutlar = await tx.gelenEirsaliye.findMany({ where: { uuid: { in: gelen.map((g) => g.uuid) } }, select: { uuid: true } });
      const mevcutUuid = new Set(mevcutlar.map((x) => x.uuid));
      await Promise.all(gelen.map((g) => tx.gelenEirsaliye.upsert({ where: { tenantId_uuid: { tenantId, uuid: g.uuid } }, create: { tenantId, uuid: g.uuid, belgeNo: g.belgeNo, gonderenVkn: g.gonderenVkn, gonderenUnvan: g.gonderenUnvan, tarih: g.tarih, xmlIcerik: g.xml }, update: { belgeNo: g.belgeNo, gonderenVkn: g.gonderenVkn, gonderenUnvan: g.gonderenUnvan, tarih: g.tarih, xmlIcerik: g.xml } })));
      return { toplam: gelen.length, yeni: gelen.filter((g) => !mevcutUuid.has(g.uuid)).length, kontrolTarihi: new Date().toISOString() };
    });
  }

  async gelenListele(durum?: GelenEirsaliyeDurum) { const { tenantId } = aktifBaglam(); return this.prisma.tenantIslem(tenantId, (tx) => tx.gelenEirsaliye.findMany({ where: durum ? { durum } : undefined, select: { id: true, uuid: true, belgeNo: true, gonderenVkn: true, gonderenUnvan: true, tarih: true, durum: true, yanitRef: true, yanitBelgeNo: true, yanitGerekcesi: true, createdAt: true, updatedAt: true }, orderBy: [{ tarih: "desc" }, { createdAt: "desc" }] })); }

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
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.gelenEirsaliye.findUnique({ where: { id } }); if (!kayit) throw new NotFoundException("Gelen e-İrsaliye bulunamadı");
      if (kayit.durum !== "yeni") throw new BadRequestException("Bu e-İrsaliyeye daha önce yanıt verilmiş");
      const { cfg, adapter } = await this.baglanti(tx, tenantId); if (!adapter.irsaliyeYanitiGonder) throw new BadRequestException("Entegratör e-İrsaliye yanıtını desteklemiyor");
      const sonuc = await adapter.irsaliyeYanitiGonder(cfg, kayit.uuid, yanit, gerekce, kayit.xmlIcerik);
      if (!sonuc.basarili) throw new BadRequestException(sonuc.hataMesaji ?? "Yanıt gönderilemedi");
      return tx.gelenEirsaliye.update({ where: { id }, data: { durum: yanit, yanitRef: sonuc.belgeRef, yanitBelgeNo: sonuc.belgeNo ?? null, yanitGerekcesi: gerekce ?? null } });
    });
  }
}
