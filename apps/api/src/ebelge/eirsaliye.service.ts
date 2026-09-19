import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EirsaliyeDurum, GelenEirsaliyeDurum, Prisma } from "@prisma/client";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { durumAciklamasi } from "./durum-aciklamasi";
import type { EntegratorConfig } from "@tekirextra/baglanti";
import { birimUblKodu, dorseSchemeId, firmaEbelgeEksikleri, plakaNormalize, plakaSchemeId, ublAdresi } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { PrismaService } from "../core/prisma.service";
import { BaglantilarService } from "../tenant/baglantilar.service";
import { gonderimEngelleri, teslimatAdresiSec, type MukellefDurumu } from "./eirsaliye-engeller";
import { irsaliyeUblOku } from "./eirsaliye-ubl-oku";
import { MukellefListesiService } from "./mukellef-listesi.service";

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
    AND: [{ OR: [{ durum: "kuyrukta" }, { durum: "iletildi", createdAt: { gte: new Date(simdi - yanitGunSayisi * 86_400_000) } }] }],
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
  private durumVerisi(sonuc: { durum: string; detay?: string }) {
    const detay = sonuc.detay?.trim() || null;
    return {
      durum: sonuc.durum as EirsaliyeDurum,
      hataMesaji: ["hata", "ret", "kismi_kabul"].includes(sonuc.durum) ? detay : null,
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
   * (`DespatchAdviceTypeCode`), profili değil.
   */
  private ubl(b: any, tenant: any) {
    const tarih = new Date(b.tarih).toISOString().slice(0, 10);
    // Fiili sevk zamanı belgeden gelir (EBLG-23); onayda boş bırakılmışsa onay
    // anıyla dolduruluyor, yine de yoksa belge tarihine düşülür.
    const sevk = new Date(b.fiiliSevkZamani ?? b.createdAt ?? b.tarih);
    const sevkTarihi = sevk.toISOString().slice(0, 10);
    const saat = sevk.toISOString().slice(11, 19);
    /** Firma kartındaki adres (EBLG-62); önceden sabit "Merkez/Istanbul" yazılıyordu. */
    const firmaAdresi = `<cac:PostalAddress>${tenant.adres ? `<cbc:StreetName>${esc(tenant.adres)}</cbc:StreetName>` : ""}<cbc:CitySubdivisionName>${esc(tenant.ilce ?? "") || "-"}</cbc:CitySubdivisionName><cbc:CityName>${esc(tenant.il ?? "") || "-"}</cbc:CityName>${tenant.postaKodu ? `<cbc:PostalZone>${esc(tenant.postaKodu)}</cbc:PostalZone>` : ""}<cac:Country><cbc:IdentificationCode>TR</cbc:IdentificationCode><cbc:Name>Türkiye</cbc:Name></cac:Country></cac:PostalAddress>`;
    /** Karttaki adres (EBLG-55). */
    const kartAdresi = (a: ReturnType<typeof ublAdresi>) =>
      `<cac:PostalAddress>${a.adres ? `<cbc:StreetName>${esc(a.adres)}</cbc:StreetName>` : ""}<cbc:CitySubdivisionName>${esc(a.ilce)}</cbc:CitySubdivisionName><cbc:CityName>${esc(a.il)}</cbc:CityName>${a.postaKodu ? `<cbc:PostalZone>${esc(a.postaKodu)}</cbc:PostalZone>` : ""}<cac:Country><cbc:IdentificationCode>${a.ulkeKodu}</cbc:IdentificationCode>${a.ulkeAdi ? `<cbc:Name>${esc(a.ulkeAdi)}</cbc:Name>` : ""}</cac:Country></cac:PostalAddress>`;
    const taraf = (vkn: string, unvan: string, adresBlogu = firmaAdresi) =>
      `<cac:Party><cac:PartyIdentification><cbc:ID schemeID="${vkn.length === 11 ? "TCKN" : "VKN"}">${esc(vkn)}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${esc(unvan)}</cbc:Name></cac:PartyName>${adresBlogu}</cac:Party>`;
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
    const satirlar = b.satirlar
      .map(
        (s: any, i: number) =>
          `<cac:DespatchLine><cbc:ID>${i + 1}</cbc:ID><cbc:DeliveredQuantity unitCode="${birimUblKodu(s.birim)}">${s.miktar}</cbc:DeliveredQuantity><cac:OrderLineReference><cbc:LineID>${i + 1}</cbc:LineID></cac:OrderLineReference><cac:Item><cbc:Name>${esc(s.stok.ad)}</cbc:Name><cac:SellersItemIdentification><cbc:ID>${esc(s.stok.kod)}</cbc:ID></cac:SellersItemIdentification></cac:Item></cac:DespatchLine>`,
      )
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?><DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`
      + `<cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>TR1.2</cbc:CustomizationID><cbc:ProfileID>TEMELIRSALIYE</cbc:ProfileID>`
      + `<cbc:ID>${esc(b.no ?? b.id)}</cbc:ID><cbc:CopyIndicator>false</cbc:CopyIndicator><cbc:UUID>${b.id}</cbc:UUID>`
      + `<cbc:IssueDate>${tarih}</cbc:IssueDate><cbc:IssueTime>${saat}</cbc:IssueTime>`
      + `<cbc:DespatchAdviceTypeCode>SEVK</cbc:DespatchAdviceTypeCode><cbc:LineCountNumeric>${b.satirlar.length}</cbc:LineCountNumeric>`
      + `<cac:Signature><cbc:ID schemeID="VKN_TCKN">${esc(tenant.vkn)}</cbc:ID><cac:SignatoryParty><cac:PartyIdentification><cbc:ID schemeID="VKN">${esc(tenant.vkn)}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${esc(tenant.unvan)}</cbc:Name></cac:PartyName>${firmaAdresi}</cac:SignatoryParty><cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#Signature</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment></cac:Signature>`
      + `<cac:DespatchSupplierParty>${taraf(tenant.vkn, tenant.unvan)}</cac:DespatchSupplierParty>`
      + `<cac:DeliveryCustomerParty>${taraf(b.cari.vknTckn ?? "", b.cari.unvan, kartAdresi(ublAdresi(b.cari.adresler)))}</cac:DeliveryCustomerParty>`
      // Fiili sevk zamanı `cac:Shipment` içinde bildirilir; taşıyan ve plaka
      // bilgisi kartta tutulmadığı için yazılmıyor.
      // Fiili sevk zamanı ve malın nereye teslim edildiği `cac:Shipment`
      // içinde bildirilir; teslimat adresi zorunludur (şematron), taşıyan ve
      // plaka bilgisi ise kartta tutulmadığı için yazılmıyor.
      // Taşıyan: nakliyeci/kargo carisi seçildiyse o, seçilmediyse malı kendi
      // aracıyla götüren firma. Şoför ve plaka `ShipmentStage`'te taşınır;
      // GİB `DriverPerson` ya da `CarrierParty`'den en az birini ister.
      + `<cac:Shipment><cbc:ID>1</cbc:ID>${sevkiyatAsamasi}<cac:Delivery><cac:DeliveryAddress><cbc:StreetName>${esc(b.teslimatAdresi.adres)}</cbc:StreetName><cbc:CitySubdivisionName>${esc(b.teslimatAdresi.ilce)}</cbc:CitySubdivisionName><cbc:CityName>${esc(b.teslimatAdresi.il)}</cbc:CityName><cbc:PostalZone>${esc(b.teslimatAdresi.postaKodu)}</cbc:PostalZone><cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country></cac:DeliveryAddress><cac:CarrierParty><cac:PartyIdentification><cbc:ID schemeID="${tasiyan.vknTckn.length === 11 ? "TCKN" : "VKN"}">${esc(tasiyan.vknTckn)}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${esc(tasiyan.unvan)}</cbc:Name></cac:PartyName>${tasiyan.adres}</cac:CarrierParty><cac:Despatch><cbc:ActualDespatchDate>${sevkTarihi}</cbc:ActualDespatchDate><cbc:ActualDespatchTime>${saat}</cbc:ActualDespatchTime></cac:Despatch></cac:Delivery>${dorse}</cac:Shipment>`
      + `${satirlar}</DespatchAdvice>`;
  }

  async gonder(belgeId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({ where: { id: belgeId }, include: { cari: { include: { adresler: true } }, tasiyiciCari: { include: { adresler: true } }, satirlar: { include: { stok: true } }, eirsaliye: true } });
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
      // Kalan ön koşullar ekranın gösterdiğiyle aynı kuraldan gelir (EBLG-42);
      // taşıyan bilgisi irsaliye onayında değil burada zorunludur (EBLG-23):
      // kâğıt irsaliye kesen firma engellenmesin, GİB'e giden belge eksik gitmesin.
      const aliciPostaKutusu = mukellef.eFaturaMukellefi ? mukellef.postaKutusu : undefined;
      const engeller = gonderimEngelleri(
        { ...belge, cari: { vknTckn: belge.cari.vknTckn, adresler: belge.cari.adresler } },
        aliciPostaKutusu ? "mukellef" : "degil",
      );
      // Malın fiilen nereye gittiği e-İrsaliye'nin varlık sebebi; uydurulmuş
      // bir adres yazmaktansa gönderim durur. Engel listesi boşsa adres de
      // posta kutusu da vardır; ikisi de burada daraltılır.
      const teslimatAdresi = teslimatAdresiSec(belge.cari.adresler as { tip: string; adres: string; il: string | null; ilce: string | null; postaKodu: string | null }[]);
      if (engeller.length > 0 || !aliciPostaKutusu || !teslimatAdresi) {
        throw new BadRequestException(engeller[0]?.mesaj ?? "Cari e-İrsaliye alıcısı olarak tanımlı değil");
      }
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      // EBLG-62: gönderen adresi belgede zorunlu; firma kartı eksikse durulur.
      const firmaEksigi = tenant ? firmaEbelgeEksikleri(tenant) : [];
      if (firmaEksigi.length) throw new BadRequestException(firmaEksigi.join("; "));
      const xml = this.ubl({ ...belge, teslimatAdresi }, tenant);
      const sonuc = await adapter.irsaliyeGonder(cfg, { uuid: belge.id, belgeNo: belge.no ?? belge.id, xml, aliciPostaKutusu });
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
          yon: "satis",
          // Kaydı olan her irsaliye defterde kalır; kaydı olmayanlardan yalnız
          // onaylı olanlar gönderilmeyi bekliyor sayılır.
          OR: [{ eirsaliye: { isNot: null } }, { durum: "onaylandi" }],
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
          genelToplam: true,
          cari: { select: { unvan: true, vknTckn: true, adresler: { select: { tip: true, il: true, ilce: true, postaKodu: true } } } },
          tasiyiciCari: { select: { vknTckn: true } },
          eirsaliye: { select: { durum: true, entegratorRef: true, hataMesaji: true, sonDurumSorguAt: true, createdAt: true } },
        },
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        take: 500,
      });

      // Mükellefiyet tek sorguda çözülür; satır başına entegratör çağrısı
      // kabul edilemez (bkz. entegratör çağrı disiplini).
      const vknler = [...new Set(belgeler.map((b) => b.cari.vknTckn).filter((v): v is string => Boolean(v)))];
      const mukellefler = mukellefDurumu.taze && vknler.length > 0
        ? await this.prisma.gibMukellef.findMany({ where: { vknTckn: { in: vknler }, belgeTuru: "eirsaliye" }, select: { vknTckn: true } })
        : [];
      const mukellefKumesi = new Set(mukellefler.map((m) => m.vknTckn));

      const satirlar = belgeler.map((b) => {
        const mukellef: MukellefDurumu = !mukellefDurumu.taze ? "bilinmiyor" : b.cari.vknTckn && mukellefKumesi.has(b.cari.vknTckn) ? "mukellef" : "degil";
        const gonderildi = Boolean(b.eirsaliye);
        // Gönderilmiş belgede engel aramak anlamsız; defterde durumu konuşulur.
        const engeller = gonderildi && b.eirsaliye?.durum !== "hata" ? [] : gonderimEngelleri(b, mukellef);
        return {
          belgeId: b.id,
          belgeNo: b.no,
          tarih: b.tarih.toISOString().slice(0, 10),
          fiiliSevkZamani: b.fiiliSevkZamani?.toISOString() ?? null,
          belgeDurumu: b.durum,
          genelToplam: b.genelToplam.toFixed(2),
          cari: { unvan: b.cari.unvan, vknTckn: b.cari.vknTckn },
          durum: b.eirsaliye?.durum ?? ("gonderilmedi" as const),
          entegratorRef: b.eirsaliye?.entegratorRef ?? null,
          hataMesaji: b.eirsaliye?.hataMesaji ?? null,
          sonDurumSorguAt: b.eirsaliye?.sonDurumSorguAt?.toISOString() ?? null,
          gonderimZamani: b.eirsaliye?.createdAt.toISOString() ?? null,
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
        select: { durum: true, entegratorRef: true, hataMesaji: true, xmlIcerik: true, sonDurumSorguAt: true, createdAt: true, belge: { select: { no: true, tarih: true, cari: { select: { unvan: true } } } } },
      });
      if (!kayit) throw new NotFoundException("Bu belge için e-İrsaliye kaydı bulunamadı");
      return {
        belgeNo: kayit.belge.no,
        tarih: kayit.belge.tarih.toISOString().slice(0, 10),
        cariUnvan: kayit.belge.cari.unvan,
        durum: kayit.durum,
        entegratorRef: kayit.entegratorRef,
        hataMesaji: kayit.hataMesaji,
        xmlIcerik: kayit.xmlIcerik,
        sonDurumSorguAt: kayit.sonDurumSorguAt?.toISOString() ?? null,
        gonderimZamani: kayit.createdAt.toISOString(),
      };
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

  async gelenleriCek() {
    const { tenantId } = aktifBaglam();
    const { cfg, adapter } = await this.prisma.tenantIslem(tenantId, (tx) => this.baglanti(tx, tenantId));
    if (!adapter.gelenIrsaliyeleriCek) throw new BadRequestException("Entegratör gelen e-İrsaliye akışını desteklemiyor");
    const gelen = await adapter.gelenIrsaliyeleriCek(cfg, new Date(Date.now() - 30 * 86400000));
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcutlar = await tx.gelenEirsaliye.findMany({ where: { uuid: { in: gelen.map((g) => g.uuid) } }, select: { uuid: true } });
      const mevcutUuid = new Set(mevcutlar.map((x) => x.uuid));
      await Promise.all(gelen.map((g) => tx.gelenEirsaliye.upsert({ where: { tenantId_uuid: { tenantId, uuid: g.uuid } }, create: { tenantId, uuid: g.uuid, belgeNo: g.belgeNo, gonderenVkn: g.gonderenVkn, gonderenUnvan: g.gonderenUnvan, tarih: g.tarih, xmlIcerik: g.xml }, update: { belgeNo: g.belgeNo, gonderenVkn: g.gonderenVkn, gonderenUnvan: g.gonderenUnvan, tarih: g.tarih, xmlIcerik: g.xml } })));
      // EBLG-34: portalda ya da başka bir yerde verilmiş karar yanıt bekleyen kayda yazılır; yerel kararın üzerine yazılmaz.
      await Promise.all(gelen.filter((g) => g.yanit).map((g) => tx.gelenEirsaliye.updateMany({ where: { tenantId, uuid: g.uuid, durum: "yeni" }, data: { durum: g.yanit!.karar, yanitGerekcesi: g.yanit!.not ?? null } })));
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
    const { kayit, cfg, adapter } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.gelenEirsaliye.findUnique({ where: { id } }); if (!kayit) throw new NotFoundException("Gelen e-İrsaliye bulunamadı");
      if (kayit.durum !== "yeni") throw new BadRequestException("Bu e-İrsaliyeye daha önce yanıt verilmiş");
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
