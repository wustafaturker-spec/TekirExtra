import type { EntegratorAdapter } from "./adapter";
import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { BelgeDurum } from "@tekirextra/shared";
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
  GelenAliciYaniti,
} from "./types";

const EFATURA_NS = "http:/fitcons.com/eInvoice/";

function xmlKacir(deger: string): string {
  return deger.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function xmlDegeri(xml: string, adlar: string[]): string | undefined {
  for (const ad of adlar) {
    const eslesme = xml.match(new RegExp(`<(?:\\w+:)?${ad}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${ad}>`, "i"));
    if (eslesme) return eslesme[1].trim();
  }
  return undefined;
}

function xmlCoz(deger: string): string {
  return deger.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function xmlBloklari(xml: string, ad: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:\\w+:)?${ad}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${ad}>`, "gi"))].map((m) => m[1]);
}

/** Sovos'un döndürdüğü tek/çok dosyalı ZIP'in ilk XML girdisini açar. */
export function zipIlkXml(base64: string): string {
  const zip = Buffer.from(base64.replace(/\s/g, ""), "base64");
  if (zip.subarray(0, 4).toString("hex") !== "504b0304") {
    const duz = zip.toString("utf8");
    if (duz.trimStart().startsWith("<")) return duz;
    throw new Error("Sovos belge verisi ZIP veya XML biçiminde değil");
  }
  const metod = zip.readUInt16LE(8);
  const sikismisBoyut = zip.readUInt32LE(18);
  const adBoyutu = zip.readUInt16LE(26);
  const ekBoyutu = zip.readUInt16LE(28);
  const baslangic = 30 + adBoyutu + ekBoyutu;
  const veri = zip.subarray(baslangic, baslangic + sikismisBoyut);
  if (metod === 0) return veri.toString("utf8");
  if (metod === 8) return inflateRawSync(veri).toString("utf8");
  throw new Error(`Desteklenmeyen ZIP sıkıştırma yöntemi: ${metod}`);
}

function gelenUblBilgisi(xml: string, varsayilanUuid: string): GelenBelge {
  const tedarikci = xml.match(/<(?:\w+:)?AccountingSupplierParty[\s\S]*?<\/(?:\w+:)?AccountingSupplierParty>/i)?.[0] || xml;
  const uuid = xmlDegeri(xml, ["UUID"]) || varsayilanUuid;
  const belgeNo = xmlDegeri(xml, ["ID"]) || uuid;
  const gonderenVkn = tedarikci.match(/<(?:\w+:)?ID[^>]*schemeID=["'](?:VKN|TCKN)["'][^>]*>([^<]+)</i)?.[1] || "";
  const gonderenUnvan = xmlDegeri(tedarikci, ["Name"]) || gonderenVkn;
  const tarihMetni = xmlDegeri(xml, ["IssueDate"]);
  return { uuid, belgeNo: xmlCoz(belgeNo), gonderenVkn, gonderenUnvan: xmlCoz(gonderenUnvan), tarih: tarihMetni ? new Date(`${tarihMetni}T00:00:00Z`) : new Date(), xml };
}

/**
 * Sovos zarf durum kodunu ortak BelgeDurum kümesine indirger. 1300 GİB'de
 * kabul, 1220/1221 ret; 1000/1100 hâlâ işlemde. Kod hiç dönmediyse "hata"
 * denmez — sorgunun kendisi boş dönmüş olabilir, çağıran karar verir.
 */
function zarfDurumu(kod: string | undefined): BelgeDurum {
  if (kod === "1300") return "kabul";
  if (kod === "1220" || kod === "1221") return "ret";
  if (kod === "1000" || kod === "1100") return "kuyrukta";
  return kod ? "iletildi" : "hata";
}

/** Bir zarfın (StandardBusinessDocument) paketindeki UBL belgelerini ayırır. */
function zarfBelgeleri(zarfXml: string): { faturalar: string[]; yanitlar: string[] } {
  const kok = (ad: string) =>
    [...zarfXml.matchAll(new RegExp(`<(?:\\w+:)?${ad}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:\\w+:)?${ad}>`, "gi"))].map((m) => m[0]);
  // Zarfsız gelen (tek belge) durumunda paket sarmalayıcısı yoktur; belgenin
  // kendisi köktedir, o yüzden arama zarf/paket ayrımı yapmadan yürür.
  return { faturalar: kok("Invoice"), yanitlar: kok("ApplicationResponse") };
}

/** Uygulama yanıtı UBL'inden alıcının kabul/ret kararını okur (EBLG-13). */
function aliciYanitiOku(xml: string, varsayilanUuid: string): GelenAliciYaniti | undefined {
  const cevap = xml.match(/<(?:\w+:)?DocumentResponse[\s\S]*?<\/(?:\w+:)?DocumentResponse>/i)?.[0];
  if (!cevap) return undefined;
  const kod = (xmlDegeri(cevap, ["ResponseCode"]) || "").toUpperCase();
  // GİB kod listesinde kabul "KABUL", ret "RED"; başka bir kod gelirse yanıt
  // olarak sayılmaz — yanlış tarafa yazmaktansa işlenmemiş bırakılır.
  if (kod !== "KABUL" && kod !== "RED") return undefined;
  const atif = cevap.match(/<(?:\w+:)?DocumentReference[\s\S]*?<\/(?:\w+:)?DocumentReference>/i)?.[0] || "";
  const tarihMetni = xmlDegeri(xml, ["IssueDate"]);
  return {
    uuid: xmlDegeri(xml, ["UUID"]) || varsayilanUuid,
    faturaUuid: xmlDegeri(atif, ["UUID"]),
    faturaNo: xmlDegeri(atif, ["ID"]),
    yanit: kod === "KABUL" ? "kabul" : "ret",
    gerekce: xmlDegeri(cevap, ["Description"]) || xmlDegeri(xml, ["Note"]),
    tarih: tarihMetni ? new Date(`${tarihMetni.slice(0, 10)}T00:00:00Z`) : new Date(),
  };
}

/** Bir günü aşmayan dilimler üretir; Sovos liste sorgusunun tavanı 1 gündür. */
function gunlukDilimler(aralik: ZarfAraligi): ZarfAraligi[] {
  const dilimler: ZarfAraligi[] = [];
  let imlec = new Date(aralik.baslangic);
  while (imlec < aralik.bitis) {
    const ertesi = new Date(imlec.getTime() + 24 * 60 * 60 * 1000);
    dilimler.push({ baslangic: new Date(imlec), bitis: ertesi < aralik.bitis ? ertesi : new Date(aralik.bitis) });
    imlec = ertesi;
  }
  return dilimler;
}

function crc32(veri: Uint8Array): number {
  let crc = 0xffffffff;
  for (const bayt of veri) {
    crc ^= bayt;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function le16(deger: number): Uint8Array {
  return Uint8Array.of(deger & 255, (deger >>> 8) & 255);
}

function le32(deger: number): Uint8Array {
  return Uint8Array.of(deger & 255, (deger >>> 8) & 255, (deger >>> 16) & 255, (deger >>> 24) & 255);
}

function birlestir(...parcalar: Uint8Array[]): Uint8Array {
  const sonuc = new Uint8Array(parcalar.reduce((toplam, parca) => toplam + parca.length, 0));
  let konum = 0;
  for (const parca of parcalar) { sonuc.set(parca, konum); konum += parca.length; }
  return sonuc;
}

/** Harici bağımlılık olmadan, tek dosyalı ve sıkıştırmasız geçerli ZIP üretir. */
export function tekDosyaZipBase64(dosyaAdi: string, icerik: string): string {
  const kodlayici = new TextEncoder();
  const ad = kodlayici.encode(dosyaAdi);
  const veri = kodlayici.encode(icerik);
  const crc = crc32(veri);
  const ortak = birlestir(le16(20), le16(0x0800), le16(0), le16(0), le16(0), le32(crc), le32(veri.length), le32(veri.length), le16(ad.length), le16(0));
  const yerel = birlestir(le32(0x04034b50), ortak, ad, veri);
  const merkez = birlestir(le32(0x02014b50), le16(20), ortak, le16(0), le16(0), le16(0), le32(0), le32(0), ad);
  const son = birlestir(le32(0x06054b50), le16(0), le16(0), le16(1), le16(1), le32(merkez.length), le32(yerel.length), le16(0));
  return Buffer.from(birlestir(yerel, merkez, son)).toString("base64");
}

function configDogrula(cfg: EntegratorConfig): string | undefined {
  if (!cfg.kullaniciAdi || !cfg.parola) return "Sovos kullanıcı adı ve parolası zorunludur";
  if (!cfg.vknTckn) return "Sovos firma VKN/TCKN bilgisi zorunludur";
  if (!cfg.gondericiBirimEtiketi) return "Sovos gönderici birim (GB) etiketi zorunludur";
  if (!cfg.servisAdresi) return "Sovos tarafından verilen e-Fatura servis adresi zorunludur";
  return undefined;
}

export class SovosEntegratorAdapter implements EntegratorAdapter {
  readonly saglayici = "sovos" as const;

  private async soap(cfg: EntegratorConfig, islem: string, govde: string): Promise<string> {
    const hata = configDogrula(cfg);
    if (hata) throw new Error(hata);
    const adres = cfg.servisAdresi!;
    const zarf = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ein="${EFATURA_NS}"><soapenv:Header/><soapenv:Body>${govde}</soapenv:Body></soapenv:Envelope>`;
    const kimlik = Buffer.from(`${cfg.kullaniciAdi}:${cfg.parola}`, "utf8").toString("base64");
    const yanit = await fetch(adres, {
      method: "POST",
      headers: { "content-type": "text/xml; charset=utf-8", SOAPAction: islem, authorization: `Basic ${kimlik}` },
      body: zarf,
    });
    const xml = await yanit.text();
    if (!yanit.ok) throw new Error(`Sovos HTTP ${yanit.status}: ${xmlDegeri(xml, ["faultstring", "Text"]) || yanit.statusText}`);
    const soapHatasi = xmlDegeri(xml, ["faultstring"]);
    if (soapHatasi) throw new Error(`Sovos SOAP: ${soapHatasi}`);
    return xml;
  }

  private async earsivSoap(cfg: EntegratorConfig, islem: string, govde: string, adAlani = "http://fitcons.com/earchive/invoice"): Promise<string> {
    if (!cfg.kullaniciAdi || !cfg.parola || !cfg.earsivServisAdresi) throw new Error("Sovos e-Arşiv kullanıcı bilgileri ve servis adresi zorunludur");
    const zarf = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:svc="${adAlani}"><soapenv:Header/><soapenv:Body>${govde}</soapenv:Body></soapenv:Envelope>`;
    const kimlik = Buffer.from(`${cfg.kullaniciAdi}:${cfg.parola}`, "utf8").toString("base64");
    const yanit = await fetch(cfg.earsivServisAdresi, { method: "POST", headers: { "content-type": "text/xml; charset=utf-8", SOAPAction: islem, authorization: `Basic ${kimlik}` }, body: zarf });
    const xml = await yanit.text();
    if (!yanit.ok) throw new Error(`Sovos e-Arşiv HTTP ${yanit.status}: ${xmlDegeri(xml, ["faultstring", "message"]) || yanit.statusText}`);
    const soapHatasi = xmlDegeri(xml, ["faultstring"]);
    if (soapHatasi) throw new Error(`Sovos e-Arşiv SOAP: ${soapHatasi}`);
    return xml;
  }

  private async irsaliyeSoap(cfg: EntegratorConfig, islem: string, govde: string): Promise<string> {
    if (!cfg.kullaniciAdi || !cfg.parola || !cfg.irsaliyeServisAdresi) throw new Error("Sovos e-İrsaliye kullanıcı bilgileri ve servis adresi zorunludur");
    const zarf = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http:/fitcons.com/eDespatch/"><soapenv:Header/><soapenv:Body>${govde}</soapenv:Body></soapenv:Envelope>`;
    const kimlik = Buffer.from(`${cfg.kullaniciAdi}:${cfg.parola}`, "utf8").toString("base64");
    const yanit = await fetch(cfg.irsaliyeServisAdresi, { method: "POST", headers: { "content-type": "text/xml; charset=utf-8", SOAPAction: islem, authorization: `Basic ${kimlik}` }, body: zarf });
    const xml = await yanit.text(); if (!yanit.ok) throw new Error(`Sovos e-İrsaliye HTTP ${yanit.status}: ${xmlDegeri(xml,["faultstring"]) || yanit.statusText}`); return xml;
  }

  async baglantiTest(cfg: EntegratorConfig): Promise<BaglantiSonuc> {
    const hata = configDogrula(cfg);
    if (hata) return { basarili: false, mesaj: hata };
    try {
      await this.soap(cfg, "getRAWUserList", `<ein:getRAWUserListRequest><ein:Identifier>${xmlKacir(cfg.gondericiBirimEtiketi!)}</ein:Identifier><ein:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</ein:VKN_TCKN><ein:Role>GB</ein:Role></ein:getRAWUserListRequest>`);
      return { basarili: true, mesaj: "Sovos e-Fatura SOAP bağlantısı doğrulandı" };
    } catch (hata) {
      return { basarili: false, mesaj: hata instanceof Error ? hata.message : "Sovos bağlantısı kurulamadı" };
    }
  }

  async mukellefSorgula(cfg: EntegratorConfig, vknTckn: string): Promise<MukellefDurum> {
    const xml = await this.soap(cfg, "getRAWUserList", `<ein:getRAWUserListRequest><ein:Identifier>${xmlKacir(cfg.gondericiBirimEtiketi!)}</ein:Identifier><ein:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</ein:VKN_TCKN><ein:Role>PK</ein:Role></ein:getRAWUserListRequest>`);
    const postaKutusu = xml.match(new RegExp(`urn:mail:[^<\"']*${vknTckn}[^<\"']*`, "i"))?.[0];
    return { vknTckn, eFaturaMukellefi: Boolean(postaKutusu), postaKutusu };
  }

  async belgeGonder(cfg: EntegratorConfig, belge: UblBelge): Promise<GonderimSonuc> {
    if (belge.tur === "earsiv") {
      if (!cfg.earsivServisAdresi) return { basarili: false, hataMesaji: "Sovos e-Arşiv servis adresi tanımlı değil" };
      try {
        const dosyaAdi = `${belge.uuid}.zip`;
        const zip = tekDosyaZipBase64(`${belge.uuid}.xml`, belge.xml);
        const zipBaytlari = Buffer.from(zip, "base64");
        const hash = createHash("md5").update(zipBaytlari).digest("hex").toUpperCase();
        const aliciVkn = belge.xml.match(/<(?:\w+:)?AccountingCustomerParty[\s\S]*?<(?:\w+:)?ID[^>]*schemeID=["'](?:VKN|TCKN)["'][^>]*>([^<]+)</i)?.[1] || "11111111111";
        const xml = await this.earsivSoap(cfg, "sendInvoice", `<svc:sendInvoiceRequestType><senderID>${xmlKacir(cfg.vknTckn!)}</senderID><receiverID>${xmlKacir(aliciVkn)}</receiverID><docType>XML</docType><fileName>${dosyaAdi}</fileName><hash>${hash}</hash><binaryData>${zip}</binaryData><customizationParams><paramName>BRANCH</paramName><paramValue>default</paramValue></customizationParams></svc:sendInvoiceRequestType>`);
        const basarili = /<(?:\w+:)?Result(?:\s[^>]*)?>\s*SUCCESS\s*<\/(?:\w+:)?Result>/i.test(xml);
        const uuid = xmlDegeri(xml, ["UUID"]);
        return basarili && uuid ? { basarili: true, belgeRef: `EARSIV:${uuid}` } : { basarili: false, hataMesaji: xmlDegeri(xml, ["Detail", "SuccessDesc"]) || "Sovos e-Arşiv gönderimi reddedildi" };
      } catch (hata) {
        return { basarili: false, hataMesaji: hata instanceof Error ? hata.message : "Sovos e-Arşiv gönderimi başarısız" };
      }
    }
    if (!belge.aliciPostaKutusu) return { basarili: false, hataMesaji: "Alıcının e-Fatura posta kutusu etiketi bulunamadı" };
    try {
      const veri = tekDosyaZipBase64(`${belge.uuid}.xml`, belge.xml);
      const xml = await this.soap(cfg, "sendUBL", `<ein:sendUBLRequest><ein:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</ein:VKN_TCKN><ein:SenderIdentifier>${xmlKacir(cfg.gondericiBirimEtiketi!)}</ein:SenderIdentifier><ein:ReceiverIdentifier>${xmlKacir(belge.aliciPostaKutusu)}</ein:ReceiverIdentifier><ein:DocType>INVOICE</ein:DocType><ein:DocData>${veri}</ein:DocData></ein:sendUBLRequest>`);
      const belgeRef = xmlDegeri(xml, ["EnvUUID", "UUID", "DocumentUUID"]);
      return belgeRef ? { basarili: true, belgeRef } : { basarili: false, hataMesaji: xmlDegeri(xml, ["ErrorDesc", "Message"]) || "Sovos gönderim referansı dönmedi" };
    } catch (hata) {
      return { basarili: false, hataMesaji: hata instanceof Error ? hata.message : "Sovos gönderimi başarısız" };
    }
  }

  async durumSorgula(cfg: EntegratorConfig, belgeRef: string): Promise<BelgeDurumSonuc> {
    if (belgeRef.startsWith("EARSIV:")) {
      const uuid = belgeRef.slice(7);
      try {
        const xml = await this.earsivSoap(cfg, "getStatus", `<svc:getStatusRequestType><UUID>${xmlKacir(uuid)}</UUID><vkn>${xmlKacir(cfg.vknTckn!)}</vkn></svc:getStatusRequestType>`);
        const kod = xmlDegeri(xml, ["statusCode"]);
        const durum = kod === "130" ? "kabul" : kod === "150" || kod === "200" ? "iletildi" : kod === "190" ? "kuyrukta" : "hata";
        return { belgeRef, durum, detay: xmlDegeri(xml, ["Detail"]) };
      } catch (hata) {
        return { belgeRef, durum: "hata", detay: hata instanceof Error ? hata.message : "Sovos e-Arşiv durum sorgusu başarısız" };
      }
    }
    try {
      const xml = await this.soap(cfg, "getEnvelopeStatus", `<ein:getEnvelopeStatusRequest><ein:Identifier>${xmlKacir(cfg.gondericiBirimEtiketi!)}</ein:Identifier><ein:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</ein:VKN_TCKN><ein:UUID>${xmlKacir(belgeRef)}</ein:UUID></ein:getEnvelopeStatusRequest>`);
      const kod = xmlDegeri(xml, ["ResponseCode", "StatusCode", "Code", "Status"]);
      return { belgeRef, durum: zarfDurumu(kod), detay: xmlDegeri(xml, ["Description", "StatusDescription", "Message"]) };
    } catch (hata) {
      return { belgeRef, durum: "hata", detay: hata instanceof Error ? hata.message : "Sovos durum sorgusu başarısız" };
    }
  }

  async gelenBelgeleriCek(_cfg: EntegratorConfig, _sonrasi: Date): Promise<GelenBelge[]> {
    const cfg = _cfg;
    if (!cfg.postaKutusuEtiketi) throw new Error("Sovos gelen belge akışı için PK etiketi zorunludur");
    const bitis = new Date();
    const baslangic = new Date(_sonrasi);
    const kimlikler: string[] = [];
    for (let gun = new Date(baslangic); gun < bitis; gun.setUTCDate(gun.getUTCDate() + 1)) {
      const ertesi = new Date(gun); ertesi.setUTCDate(ertesi.getUTCDate() + 1);
      const xml = await this.soap(cfg, "getUBLList", `<ein:getUBLListRequest><ein:Identifier>${xmlKacir(cfg.postaKutusuEtiketi)}</ein:Identifier><ein:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</ein:VKN_TCKN><ein:DocType>INVOICE</ein:DocType><ein:Type>INBOUND</ein:Type><ein:FromDate>${gun.toISOString()}</ein:FromDate><ein:ToDate>${(ertesi < bitis ? ertesi : bitis).toISOString()}</ein:ToDate></ein:getUBLListRequest>`);
      for (const blok of xmlBloklari(xml, "UBLList")) {
        const uuid = xmlDegeri(blok, ["UUID"]);
        if (uuid && !kimlikler.includes(uuid)) kimlikler.push(uuid);
      }
    }
    const sonuc: GelenBelge[] = [];
    for (let i = 0; i < kimlikler.length; i += 20) {
      const grup = kimlikler.slice(i, i + 20);
      const xml = await this.soap(cfg, "getUBL", `<ein:getUBLRequest><ein:Identifier>${xmlKacir(cfg.postaKutusuEtiketi)}</ein:Identifier><ein:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</ein:VKN_TCKN>${grup.map((uuid) => `<ein:UUID>${xmlKacir(uuid)}</ein:UUID>`).join("")}<ein:DocType>INVOICE</ein:DocType><ein:Type>INBOUND</ein:Type><ein:Parameters>zip</ein:Parameters></ein:getUBLRequest>`);
      const veriler = xmlBloklari(xml, "DocData");
      veriler.forEach((veri, sira) => sonuc.push(gelenUblBilgisi(zipIlkXml(veri), grup[sira] || randomUUID())));
    }
    return sonuc;
  }

  async yanitGonder(cfg: EntegratorConfig, belgeRef: string, yanit: "kabul" | "ret", gerekce?: string, kaynak?: { gonderenVkn: string; xml: string }): Promise<GonderimSonuc> {
    if (!cfg.postaKutusuEtiketi) return { basarili: false, hataMesaji: "Sovos uygulama yanıtı için PK etiketi zorunludur" };
    if (!kaynak) return { basarili: false, hataMesaji: "Yanıt verilecek faturanın kaynak UBL bilgisi eksik" };
    const aliciGb = kaynak.xml.match(/<(?:\w+:)?AccountingSupplierParty[\s\S]*?<(?:\w+:)?EndpointID[^>]*>([^<]+)</i)?.[1];
    if (!aliciGb) return { basarili: false, hataMesaji: "Gönderenin GB etiketi kaynak UBL içinde bulunamadı" };
    const uuid = randomUUID();
    const tarih = new Date().toISOString().slice(0, 10);
    const kod = yanit === "kabul" ? "KABUL" : "RED";
    const uygulamaYaniti = `<?xml version="1.0" encoding="UTF-8"?><ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>TR1.2</cbc:CustomizationID><cbc:ProfileID>TICARIFATURA</cbc:ProfileID><cbc:ID>${uuid}</cbc:ID><cbc:UUID>${uuid}</cbc:UUID><cbc:IssueDate>${tarih}</cbc:IssueDate>${gerekce ? `<cbc:Note>${xmlKacir(gerekce)}</cbc:Note>` : ""}<cac:DocumentResponse><cac:Response><cbc:ReferenceID>${xmlKacir(belgeRef)}</cbc:ReferenceID><cbc:ResponseCode>${kod}</cbc:ResponseCode>${gerekce ? `<cbc:Description>${xmlKacir(gerekce)}</cbc:Description>` : ""}</cac:Response><cac:DocumentReference><cbc:ID>${xmlKacir(belgeRef)}</cbc:ID><cbc:UUID>${xmlKacir(belgeRef)}</cbc:UUID><cbc:DocumentType>FATURA</cbc:DocumentType></cac:DocumentReference></cac:DocumentResponse></ApplicationResponse>`;
    try {
      const veri = tekDosyaZipBase64(`${uuid}.xml`, uygulamaYaniti);
      const xml = await this.soap(cfg, "sendUBL", `<ein:sendUBLRequest><ein:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</ein:VKN_TCKN><ein:SenderIdentifier>${xmlKacir(cfg.postaKutusuEtiketi)}</ein:SenderIdentifier><ein:ReceiverIdentifier>${xmlKacir(xmlCoz(aliciGb))}</ein:ReceiverIdentifier><ein:DocType>APP_RESP</ein:DocType><ein:DocData>${veri}</ein:DocData></ein:sendUBLRequest>`);
      const ref = xmlDegeri(xml, ["EnvUUID", "UUID"]);
      return ref ? { basarili: true, belgeRef: ref } : { basarili: false, hataMesaji: "Sovos uygulama yanıtı referansı dönmedi" };
    } catch (hata) {
      return { basarili: false, hataMesaji: hata instanceof Error ? hata.message : "Sovos uygulama yanıtı gönderilemedi" };
    }
  }

  /**
   * Tam GİB mükellef listesini indirir (EBLG-10). Yanıt tek bir base64 ZIP
   * içinde `UserList` XML'i taşır; her kullanıcının INVOICE tipindeki silinmemiş
   * etiketleri kanal kararının kaynağıdır. Bu metot günde bir kez çağrılır,
   * belge gönderiminde değil.
   */
  async mukellefListesiCek(cfg: EntegratorConfig): Promise<MukellefKaydi[]> {
    const hata = configDogrula(cfg);
    if (hata) throw new Error(hata);
    const yanit = await this.soap(cfg, "getRAWUserList", `<ein:getRAWUserListRequest><ein:Identifier>${xmlKacir(cfg.gondericiBirimEtiketi!)}</ein:Identifier><ein:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</ein:VKN_TCKN><ein:Role>PK</ein:Role></ein:getRAWUserListRequest>`);
    const veri = xmlDegeri(yanit, ["DocData"]);
    if (!veri) throw new Error("Sovos mükellef listesi yanıtında DocData bulunamadı");
    const liste = zipIlkXml(veri);
    const kayitlar: MukellefKaydi[] = [];
    for (const kullanici of xmlBloklari(liste, "User")) {
      const vknTckn = xmlDegeri(kullanici, ["Identifier"]);
      if (!vknTckn) continue;
      const unvan = xmlDegeri(kullanici, ["Title"]);
      for (const belge of [...kullanici.matchAll(/<(?:\w+:)?Document\s[^>]*type=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:\w+:)?Document>/gi)]) {
        const tip = belge[1].toUpperCase();
        // Tek indirme e-Fatura ve e-İrsaliye kayıtlarının ikisini de getirir;
        // ayrı ayrı liste çekmeye gerek yok.
        const belgeTuru = tip === "INVOICE" ? "efatura" as const : tip === "DESPATCH" ? "eirsaliye" as const : undefined;
        if (!belgeTuru) continue;
        for (const etiket of xmlBloklari(belge[2], "Alias")) {
          // Silinme zamanı dolmuş etiket artık geçerli değildir; buna gönderim
          // yapılırsa zarf karşı tarafa ulaşmaz.
          if (xmlDegeri(etiket, ["DeletionTime"])) continue;
          const ad = xmlDegeri(etiket, ["Name"]);
          if (ad) kayitlar.push({ vknTckn: xmlCoz(vknTckn), belgeTuru, postaKutusu: xmlCoz(ad), unvan: unvan ? xmlCoz(unvan) : undefined });
        }
      }
    }
    return kayitlar;
  }

  /**
   * Gelen zarfları kursörün verdiği aralıkta indirir (EBLG-11, EBLG-12).
   * Liste zarf tipinde çekilir; böylece fatura ve uygulama yanıtı için ayrı
   * çağrı yapılmaz. Aralık bir günlük dilimlere bölünür, UBL'ler 20'şerli
   * indirilir.
   */
  async gelenZarflariCek(cfg: EntegratorConfig, aralik: ZarfAraligi): Promise<GelenZarfSonucu> {
    if (!cfg.postaKutusuEtiketi) throw new Error("Sovos gelen belge akışı için PK etiketi zorunludur");
    const kimlikler: string[] = [];
    for (const dilim of gunlukDilimler(aralik)) {
      const xml = await this.soap(cfg, "getUBLList", `<ein:getUBLListRequest><ein:Identifier>${xmlKacir(cfg.postaKutusuEtiketi)}</ein:Identifier><ein:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</ein:VKN_TCKN><ein:DocType>ENVELOPE</ein:DocType><ein:Type>INBOUND</ein:Type><ein:FromDate>${dilim.baslangic.toISOString()}</ein:FromDate><ein:ToDate>${dilim.bitis.toISOString()}</ein:ToDate></ein:getUBLListRequest>`);
      for (const blok of xmlBloklari(xml, "UBLList")) {
        const uuid = xmlDegeri(blok, ["UUID"]);
        if (uuid && !kimlikler.includes(uuid)) kimlikler.push(uuid);
      }
    }
    const belgeler: GelenBelge[] = [];
    const yanitlar: GelenAliciYaniti[] = [];
    for (let i = 0; i < kimlikler.length; i += 20) {
      const grup = kimlikler.slice(i, i + 20);
      const xml = await this.soap(cfg, "getUBL", `<ein:getUBLRequest><ein:Identifier>${xmlKacir(cfg.postaKutusuEtiketi)}</ein:Identifier><ein:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</ein:VKN_TCKN>${grup.map((uuid) => `<ein:UUID>${xmlKacir(uuid)}</ein:UUID>`).join("")}<ein:DocType>ENVELOPE</ein:DocType><ein:Type>INBOUND</ein:Type><ein:Parameters>zip</ein:Parameters></ein:getUBLRequest>`);
      xmlBloklari(xml, "DocData").forEach((veri, sira) => {
        const zarfUuid = grup[sira] || randomUUID();
        const paket = zarfBelgeleri(zipIlkXml(veri));
        for (const fatura of paket.faturalar) belgeler.push(gelenUblBilgisi(fatura, zarfUuid));
        for (const yanitXml of paket.yanitlar) {
          const yanit = aliciYanitiOku(yanitXml, zarfUuid);
          if (yanit) yanitlar.push(yanit);
        }
      });
    }
    return { belgeler, yanitlar };
  }

  /**
   * Zarf durumlarını 20'şerli sorgular (EBLG-14). Tek tek sorgulama
   * sağlayıcının bloklama sebeplerinden biridir.
   */
  async durumSorgulaToplu(cfg: EntegratorConfig, belgeRefleri: string[]): Promise<BelgeDurumSonuc[]> {
    const sonuc: BelgeDurumSonuc[] = [];
    for (let i = 0; i < belgeRefleri.length; i += 20) {
      const grup = belgeRefleri.slice(i, i + 20);
      try {
        const xml = await this.soap(cfg, "getEnvelopeStatus", `<ein:getEnvelopeStatusRequest><ein:Identifier>${xmlKacir(cfg.gondericiBirimEtiketi!)}</ein:Identifier><ein:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</ein:VKN_TCKN>${grup.map((uuid) => `<ein:UUID>${xmlKacir(uuid)}</ein:UUID>`).join("")}</ein:getEnvelopeStatusRequest>`);
        const bloklar = xmlBloklari(xml, "Response");
        for (const blok of bloklar) {
          const belgeRef = xmlDegeri(blok, ["UUID"]);
          if (!belgeRef) continue;
          sonuc.push({ belgeRef, durum: zarfDurumu(xmlDegeri(blok, ["ResponseCode", "StatusCode", "Code"])), detay: xmlDegeri(blok, ["Description", "StatusDescription"]) });
        }
        // Yanıtta karşılığı dönmeyen zarf sorgulanmamış sayılır; "hata" yazmak
        // kaydı yanlışlıkla son duruma taşır ve bir daha sorgulanmaz olurdu.
      } catch (hata) {
        const detay = hata instanceof Error ? hata.message : "Sovos toplu durum sorgusu başarısız";
        for (const belgeRef of grup) sonuc.push({ belgeRef, durum: "hata", detay });
      }
    }
    return sonuc;
  }

  async earsivIptal(cfg: EntegratorConfig, girdi: EarsivIptalGirdi): Promise<BaglantiSonuc> {
    try {
      const xml = await this.earsivSoap(cfg, "cancelInvoice", `<svc:invoiceCancellationServiceRequestType><invoiceCancelInfoTypeList><invoiceId>${xmlKacir(girdi.faturaNo)}</invoiceId><vkn>${xmlKacir(cfg.vknTckn!)}</vkn><branch>${xmlKacir(girdi.sube || "default")}</branch><totalAmount>${xmlKacir(girdi.toplamTutar)}</totalAmount><cancelDate>${girdi.iptalTarihi.toISOString().slice(0, 10)}</cancelDate></invoiceCancelInfoTypeList></svc:invoiceCancellationServiceRequestType>`, "http://fitcons.com/earchive/invoicecancellation");
      const basarili = /<(?:\w+:)?Result(?:\s[^>]*)?>\s*SUCCESS\s*<\/(?:\w+:)?Result>/i.test(xml);
      return { basarili, mesaj: xmlDegeri(xml, ["message", "Detail"]) || (basarili ? "e-Arşiv iptali Sovos'a bildirildi" : "e-Arşiv iptali reddedildi") };
    } catch (hata) {
      return { basarili: false, mesaj: hata instanceof Error ? hata.message : "e-Arşiv iptali gönderilemedi" };
    }
  }

  async earsivRaporListele(cfg: EntegratorConfig, baslangic: Date, bitis: Date): Promise<EarsivRapor[]> {
    const xml = await this.earsivSoap(cfg, "getReportList", `<svc:getReportListRequest><startDate>${baslangic.toISOString().slice(0, 10)}</startDate><endDate>${bitis.toISOString().slice(0, 10)}</endDate><vkn>${xmlKacir(cfg.vknTckn!)}</vkn><approved>0</approved></svc:getReportListRequest>`, "http://fitcons.com/earchive/report");
    return xmlBloklari(xml, "Reports").map((blok) => ({
      uuid: xmlDegeri(blok, ["uuid"]) || "",
      donem: xmlDegeri(blok, ["periodCode"]) || "",
      baslangic: xmlDegeri(blok, ["sectionStartDate"]) || "",
      bitis: xmlDegeri(blok, ["sectionEndDate"]) || "",
      faturaSayisi: Number(xmlDegeri(blok, ["invoiceCount"]) || 0),
      toplamTutar: xmlDegeri(blok, ["invoiceTotalAmount"]) || "0",
      gibDurumu: xmlCoz(xmlDegeri(blok, ["gibStatus"]) || ""),
    })).filter((rapor) => rapor.uuid);
  }

  async earsivRaporDurum(cfg: EntegratorConfig, uuid: string): Promise<BaglantiSonuc & { kod?: string }> {
    try {
      const xml = await this.earsivSoap(cfg, "getReportStatus", `<svc:getReportStatusRequestType><UUID>${xmlKacir(uuid)}</UUID><VKN>${xmlKacir(cfg.vknTckn!)}</VKN></svc:getReportStatusRequestType>`, "http://fitcons.com/earchive/report");
      const kod = xmlDegeri(xml, ["StatusCode"]);
      const basarili = kod === "200" || kod === "130";
      return { basarili, kod, mesaj: xmlDegeri(xml, ["Detail"]) };
    } catch (hata) {
      return { basarili: false, mesaj: hata instanceof Error ? hata.message : "e-Arşiv rapor durumu sorgulanamadı" };
    }
  }

  async irsaliyeGonder(cfg: EntegratorConfig, belge: EirsaliyeBelge): Promise<GonderimSonuc> {
    try { const xml=await this.irsaliyeSoap(cfg,"sendDesUBL",`<des:sendDesUBLRequest><des:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</des:VKN_TCKN><des:SenderIdentifier>${xmlKacir(cfg.gondericiBirimEtiketi!)}</des:SenderIdentifier><des:ReceiverIdentifier>${xmlKacir(belge.aliciPostaKutusu)}</des:ReceiverIdentifier><des:DocType>DESPATCH</des:DocType><des:DocData>${tekDosyaZipBase64(`${belge.uuid}.xml`,belge.xml)}</des:DocData></des:sendDesUBLRequest>`); const ref=xmlDegeri(xml,["EnvUUID","UUID"]); return ref?{basarili:true,belgeRef:ref}:{basarili:false,hataMesaji:"Sovos e-İrsaliye referansı dönmedi"}; } catch(hata){return{basarili:false,hataMesaji:hata instanceof Error?hata.message:"e-İrsaliye gönderilemedi"};}
  }

  async irsaliyeDurumSorgula(cfg: EntegratorConfig, belgeRef: string): Promise<BelgeDurumSonuc> {
    try { const xml=await this.irsaliyeSoap(cfg,"getDesEnvelopeStatus",`<des:getDesEnvelopeStatusRequest><des:Identifier>${xmlKacir(cfg.gondericiBirimEtiketi!)}</des:Identifier><des:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</des:VKN_TCKN><des:UUID>${xmlKacir(belgeRef)}</des:UUID></des:getDesEnvelopeStatusRequest>`); const kod=xmlDegeri(xml,["StatusCode","Code"]); return{belgeRef,durum:kod==="1300"?"kabul":kod==="1220"?"ret":kod==="1000"||kod==="1100"?"kuyrukta":kod?"iletildi":"hata",detay:xmlDegeri(xml,["StatusDescription","Description"])}; } catch(hata){return{belgeRef,durum:"hata",detay:hata instanceof Error?hata.message:"e-İrsaliye durumu sorgulanamadı"};}
  }

  async gelenIrsaliyeleriCek(cfg: EntegratorConfig, sonrasi: Date): Promise<GelenEirsaliye[]> {
    if(!cfg.postaKutusuEtiketi) throw new Error("Sovos gelen e-İrsaliye için PK etiketi zorunludur"); const liste=await this.irsaliyeSoap(cfg,"getDesUBLList",`<des:getDesUBLListRequest><des:Identifier>${xmlKacir(cfg.postaKutusuEtiketi)}</des:Identifier><des:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</des:VKN_TCKN><des:DocType>DESPATCH</des:DocType><des:Type>INBOUND</des:Type><des:FromDate>${sonrasi.toISOString()}</des:FromDate><des:ToDate>${new Date().toISOString()}</des:ToDate></des:getDesUBLListRequest>`); const ids=xmlBloklari(liste,"UBLList").map(b=>xmlDegeri(b,["UUID"])).filter((x):x is string=>Boolean(x)); const sonuc:GelenEirsaliye[]=[]; for(let i=0;i<ids.length;i+=20){const grup=ids.slice(i,i+20);const xml=await this.irsaliyeSoap(cfg,"getDesUBL",`<des:getDesUBLRequest><des:Identifier>${xmlKacir(cfg.postaKutusuEtiketi)}</des:Identifier><des:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</des:VKN_TCKN>${grup.map(u=>`<des:UUID>${xmlKacir(u)}</des:UUID>`).join("")}<des:DocType>DESPATCH</des:DocType><des:Type>INBOUND</des:Type><des:Parameters>zip</des:Parameters></des:getDesUBLRequest>`);xmlBloklari(xml,"DocData").forEach((v,s)=>sonuc.push(gelenUblBilgisi(zipIlkXml(v),grup[s]||randomUUID())));} return sonuc;
  }

  async irsaliyeYanitiGonder(cfg: EntegratorConfig, belgeRef: string, yanit: "kabul"|"ret", gerekce: string|undefined, kaynakXml: string): Promise<GonderimSonuc> {
    const alici=kaynakXml.match(/<(?:\w+:)?DespatchSupplierParty[\s\S]*?<(?:\w+:)?EndpointID[^>]*>([^<]+)</i)?.[1]; if(!alici)return{basarili:false,hataMesaji:"Gönderen etiketi bulunamadı"}; const uuid=randomUUID(); const receipt=`<?xml version="1.0" encoding="UTF-8"?><ReceiptAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:ReceiptAdvice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>TR1.2</cbc:CustomizationID><cbc:ID>${uuid}</cbc:ID><cbc:UUID>${uuid}</cbc:UUID><cbc:IssueDate>${new Date().toISOString().slice(0,10)}</cbc:IssueDate><cac:DespatchDocumentReference><cbc:ID>${xmlKacir(belgeRef)}</cbc:ID></cac:DespatchDocumentReference><cac:ReceiptLine><cbc:ID>1</cbc:ID><cbc:ReceivedQuantity unitCode="C62">${yanit==="kabul"?1:0}</cbc:ReceivedQuantity>${gerekce?`<cbc:Note>${xmlKacir(gerekce)}</cbc:Note>`:""}</cac:ReceiptLine></ReceiptAdvice>`; try{const xml=await this.irsaliyeSoap(cfg,"sendDesUBL",`<des:sendDesUBLRequest><des:VKN_TCKN>${xmlKacir(cfg.vknTckn!)}</des:VKN_TCKN><des:SenderIdentifier>${xmlKacir(cfg.postaKutusuEtiketi!)}</des:SenderIdentifier><des:ReceiverIdentifier>${xmlKacir(xmlCoz(alici))}</des:ReceiverIdentifier><des:DocType>RECEIPT</des:DocType><des:DocData>${tekDosyaZipBase64(`${uuid}.xml`,receipt)}</des:DocData></des:sendDesUBLRequest>`);const ref=xmlDegeri(xml,["EnvUUID","UUID"]);return ref?{basarili:true,belgeRef:ref}:{basarili:false,hataMesaji:"İrsaliye yanıt referansı dönmedi"};}catch(hata){return{basarili:false,hataMesaji:hata instanceof Error?hata.message:"İrsaliye yanıtı gönderilemedi"};}
  }
}
