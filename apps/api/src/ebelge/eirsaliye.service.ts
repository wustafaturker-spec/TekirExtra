import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EirsaliyeDurum, GelenEirsaliyeDurum } from "@prisma/client";
import type { EntegratorConfig } from "@tekirextra/baglanti";
import { XMLParser } from "fast-xml-parser";
import { aktifBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { PrismaService } from "../core/prisma.service";
import { BaglantilarService } from "../tenant/baglantilar.service";
import { MukellefListesiService } from "./mukellef-listesi.service";

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true });
const dizi = <T>(v: T | T[] | undefined): T[] => v == null ? [] : Array.isArray(v) ? v : [v];
const metin = (v: unknown): string => typeof v === "object" && v !== null && "#text" in v ? String((v as { "#text": unknown })["#text"]) : v == null ? "" : String(v);

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

  private ubl(b: any, tenant: any) {
    const lines = b.satirlar.map((s: any, i: number) => `<cac:DespatchLine><cbc:ID>${i + 1}</cbc:ID><cbc:DeliveredQuantity unitCode="C62">${s.miktar}</cbc:DeliveredQuantity><cac:Item><cbc:Name>${esc(s.stok.ad)}</cbc:Name><cac:SellersItemIdentification><cbc:ID>${esc(s.stok.kod)}</cbc:ID></cac:SellersItemIdentification></cac:Item></cac:DespatchLine>`).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>TR1.2</cbc:CustomizationID><cbc:ProfileID>SEVK</cbc:ProfileID><cbc:ID>${esc(b.no ?? b.id)}</cbc:ID><cbc:UUID>${b.id}</cbc:UUID><cbc:IssueDate>${new Date(b.tarih).toISOString().slice(0, 10)}</cbc:IssueDate><cac:DespatchSupplierParty><cac:Party><cac:PartyName><cbc:Name>${esc(tenant.unvan)}</cbc:Name></cac:PartyName><cac:PartyIdentification><cbc:ID schemeID="VKN">${esc(tenant.vkn)}</cbc:ID></cac:PartyIdentification><cbc:EndpointID>${esc(tenant.vkn)}</cbc:EndpointID></cac:Party></cac:DespatchSupplierParty><cac:DeliveryCustomerParty><cac:Party><cac:PartyName><cbc:Name>${esc(b.cari.unvan)}</cbc:Name></cac:PartyName><cac:PartyIdentification><cbc:ID schemeID="VKN">${esc(b.cari.vknTckn ?? "")}</cbc:ID></cac:PartyIdentification></cac:Party></cac:DeliveryCustomerParty>${lines}</DespatchAdvice>`;
  }

  async gonder(belgeId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({ where: { id: belgeId }, include: { cari: true, satirlar: { include: { stok: true } }, eirsaliye: true } });
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
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const xml = this.ubl(belge, tenant);
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
      return tx.eirsaliyeKayit.update({ where: { id: kayit.id }, data: { durum: sonuc.durum as EirsaliyeDurum, hataMesaji: sonuc.detay ?? null } });
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

  async gelenListele(durum?: GelenEirsaliyeDurum) { const { tenantId } = aktifBaglam(); return this.prisma.tenantIslem(tenantId, (tx) => tx.gelenEirsaliye.findMany({ where: durum ? { durum } : undefined, select: { id: true, uuid: true, belgeNo: true, gonderenVkn: true, gonderenUnvan: true, tarih: true, durum: true, yanitRef: true, yanitGerekcesi: true, createdAt: true, updatedAt: true }, orderBy: [{ tarih: "desc" }, { createdAt: "desc" }] })); }

  async gelenDetay(id: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.gelenEirsaliye.findUnique({ where: { id } }));
    if (!kayit) throw new NotFoundException("Gelen e-İrsaliye bulunamadı");
    try {
      const kok = xmlParser.parse(kayit.xmlIcerik) as Record<string, any>;
      const belge = kok.DespatchAdvice ?? Object.values(kok)[0] ?? {};
      const teslimat = belge.Delivery ?? {};
      const adres = teslimat.DeliveryAddress ?? teslimat.DeliveryLocation?.Address ?? {};
      const satirlar = dizi<any>(belge.DespatchLine).map((s, index) => ({
        sira: metin(s.ID) || String(index + 1),
        stokKodu: metin(s.Item?.SellersItemIdentification?.ID || s.Item?.ManufacturersItemIdentification?.ID),
        ad: metin(s.Item?.Name || s.Item?.Description) || "İsimsiz ürün",
        miktar: metin(s.DeliveredQuantity),
        birim: s.DeliveredQuantity?.["@_unitCode"] || "",
        aciklama: metin(s.Note),
      }));
      return { ...kayit, detay: { sevkTarihi: metin(belge.ActualDespatchDate || belge.IssueDate), sevkSaati: metin(belge.ActualDespatchTime || belge.IssueTime), teslimatAdresi: [metin(adres.StreetName), metin(adres.BuildingNumber), metin(adres.CitySubdivisionName), metin(adres.CityName)].filter(Boolean).join(" "), notlar: dizi(belge.Note).map(metin).filter(Boolean), satirlar } };
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
      return tx.gelenEirsaliye.update({ where: { id }, data: { durum: yanit, yanitRef: sonuc.belgeRef, yanitGerekcesi: gerekce ?? null } });
    });
  }
}
