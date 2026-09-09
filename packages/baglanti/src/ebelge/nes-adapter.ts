import type { EntegratorAdapter } from "./adapter";
import { zipIlkXmlBuffer } from "./zip";
import { randomUUID } from "node:crypto";
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
} from "./types";

/**
 * NES uçları tek kök adres altında servis ailelerine ayrılır; config yalnızca
 * kökü tutar (örn. https://apitest.nes.com.tr), aile ön ekini adaptör ekler.
 * Sovos'taki gibi aile başına ayrı servis adresi tanımlamaya gerek yoktur.
 */
type Aile = "einvoice" | "earchive" | "edespatch" | "general";

/**
 * e-Arşiv referansları e-Fatura zarflarıyla aynı kümede saklandığı için ön ek
 * taşır; durum sorgusu hangi aileye gideceğini bu ön ekten bilir.
 */
const EARSIV_ONEKI = "EARSIV:";

const SAYFA_BOYUTU = 100;

/** Gelen tarama sonsuz döngüye girmesin diye sayfa tavanı (EBLG-11). */
const SAYFA_TAVANI = 50;

/** NES'e kendimizi tanıttığımız kaynak uygulama adı; zorunlu alandır. */
const KAYNAK_UYGULAMA = "TekirExtra";

/** Durum kodunu taşıyan hata; 404'ü diğer arızalardan ayırmak için gerekir. */
class NesHatasi extends Error {
  constructor(readonly durum: number, mesaj: string) {
    super(mesaj);
    this.name = "NesHatasi";
  }
}

function konum(
  cfg: EntegratorConfig,
  aile: Aile,
  yol: string,
  sorgu?: Record<string, string | number | boolean | undefined>,
): string {
  const kok = (cfg.servisAdresi ?? "").replace(/\/+$/, "");
  const adres = new URL(`${kok}/${aile}${yol}`);
  for (const [ad, deger] of Object.entries(sorgu ?? {})) {
    if (deger !== undefined) adres.searchParams.set(ad, String(deger));
  }
  return adres.toString();
}

/**
 * NES hata gövdesinin iki belgelenmiş biçimi vardır:
 * 400 → `{ message, invalidFields: [{ field, description, detail }] }`
 * 422 → `{ message, errors: [{ code, description, detail }] }`
 * Bunların yanında ASP.NET ProblemDetails (`errors` sözlüğü) da gelebilir.
 */
type NesHataGovdesi = {
  message?: string;
  Message?: string;
  title?: string;
  detail?: string;
  invalidFields?: { field?: string; description?: string; detail?: string }[];
  errors?: { code?: string; description?: string; detail?: string }[] | Record<string, string[] | string>;
};

/**
 * Gövdedeki alan ve iş kuralı hatalarını okunur satırlara çevirir. Başlık tek
 * başına yetmez: "GECERSIZ ISTEK" hangi alanın neden reddedildiğini söylemez,
 * faturayı düzeltecek bilgi bu listededir.
 */
function hataSatirlari(govde: NesHataGovdesi): string[] {
  const satirlar: string[] = [];
  for (const alan of govde.invalidFields ?? []) {
    const aciklama = alan?.description || alan?.detail;
    if (aciklama) satirlar.push(alan?.field ? `${alan.field}: ${aciklama}` : aciklama);
  }
  const hatalar = govde.errors;
  if (Array.isArray(hatalar)) {
    for (const hata of hatalar) {
      // 422'de description makine kodu, detail onun Türkçe karşılığıdır;
      // ikisi de varsa şematron hatasını izlemek için ikisi birden yazılır.
      if (hata?.description && hata?.detail) satirlar.push(`${hata.description} (${hata.detail})`);
      else if (hata?.description || hata?.detail) satirlar.push((hata.description || hata.detail)!);
    }
  } else if (hatalar && typeof hatalar === "object") {
    for (const [alan, mesajlar] of Object.entries(hatalar)) {
      const metin = Array.isArray(mesajlar) ? mesajlar.join(", ") : String(mesajlar);
      if (metin) satirlar.push(`${alan}: ${metin}`);
    }
  }
  return satirlar;
}

/**
 * 401'de gövde tamamen boş gelir. Durum kodu her hâlükârda mesaja yazılır,
 * yoksa "yetki yok" ile "belge yok" ayrımı loglardan kaybolur.
 */
async function nesHatasi(yanit: Response): Promise<NesHatasi> {
  const metin = await yanit.text().catch(() => "");
  let ayrinti = metin.slice(0, 300);
  try {
    const govde = JSON.parse(metin) as NesHataGovdesi;
    const baslik = govde.message || govde.Message || govde.title || govde.detail;
    ayrinti = [baslik, hataSatirlari(govde).join("; ")].filter(Boolean).join(" — ") || ayrinti;
  } catch {
    // Gövde JSON değilse ham metnin başı yeterli ayrıntıdır.
  }
  return new NesHatasi(yanit.status, `NES ${yanit.status}${ayrinti ? `: ${ayrinti.slice(0, 400)}` : ""}`);
}

/**
 * NES giden belge durumunu ortak BelgeDurum kümesine indirger (EBLG-04).
 * Alıcının kararı zarf durumunu ezer: ticari faturada son söz alıcınındır.
 * Tanınmayan bir durum "hata" sayılmaz — belge takipten düşer ve bir daha
 * sorgulanmaz; bilinmeyen hâl "kuyrukta" kalıp yeniden sorgulanmalıdır.
 */
export function nesBelgeDurumu(gidenDurum?: string, yanit?: string): BelgeDurum {
  if (yanit === "Accepted") return "kabul";
  if (yanit === "Rejected") return "ret";
  switch (gidenDurum) {
    case "EnvelopeHasBeenTransferredToReceiverSuccessfully":
    case "EnvelopeSystemResponseIsBeingWaitedFromReceiver":
      return "iletildi";
    case "ErrorHasBeenDetectedInEnvelopeByGib":
    case "ErrorHasBeenDetectedInEnvelopeByReceiver":
    case "EnvelopeCouldNotTransferredToReceiverByGib":
    case "FileNotFound":
    case "XmlParseError":
      return "hata";
    default:
      return "kuyrukta";
  }
}

/**
 * Yükleme çok parçalı gövde ister. UBL-TR üretimi ebelge modülünde bittiği
 * için adaptör XML'e dokunmaz, yalnızca zarflar (EBLG-03).
 *
 * SourceAppRecordId belge UUID'mizi taşır: aynı belge iki kez gönderilirse
 * NES tarafında hangi kaydımıza ait olduğu izlenebilir kalır.
 */
function yuklemeFormu(belge: { uuid: string; xml: string }, gonderen: string, alici?: string): FormData {
  const form = new FormData();
  form.set("File", new Blob([belge.xml], { type: "application/xml" }), `${belge.uuid}.xml`);
  form.set("SenderAlias", gonderen);
  if (alici) form.set("ReceiverAlias", alici);
  form.set("IsDirectSend", "true");
  // Önizleme HTML'i istemiyoruz; gönderim yanıtını gereksiz büyütür.
  form.set("PreviewType", "None");
  form.set("SourceApp", KAYNAK_UYGULAMA);
  form.set("SourceAppRecordId", belge.uuid);
  // Alıcıyı NES'in cari defterine biz yazmayız; cari yönetimi bizde kalır.
  form.set("AutoSaveCompany", "false");
  return form;
}

/** Gelen e-İrsaliyeye verilecek ReceiptAdvice UBL'i. */
function receiptAdviceXml(belgeRef: string, yanit: "kabul" | "ret", gerekce?: string): { uuid: string; xml: string } {
  const uuid = randomUUID();
  const kacir = (deger: string) =>
    deger.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><ReceiptAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:ReceiptAdvice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>TR1.2</cbc:CustomizationID><cbc:ID>${uuid}</cbc:ID><cbc:UUID>${uuid}</cbc:UUID><cbc:IssueDate>${new Date().toISOString().slice(0, 10)}</cbc:IssueDate><cac:DespatchDocumentReference><cbc:ID>${kacir(belgeRef)}</cbc:ID></cac:DespatchDocumentReference><cac:ReceiptLine><cbc:ID>1</cbc:ID><cbc:ReceivedQuantity unitCode="C62">${yanit === "kabul" ? 1 : 0}</cbc:ReceivedQuantity>${gerekce ? `<cbc:Note>${kacir(gerekce)}</cbc:Note>` : ""}</cac:ReceiptLine></ReceiptAdvice>`;
  return { uuid, xml };
}

/** XML metin düğümlerindeki varlıkları çözer; ünvanlarda `&` sık görülür. */
function xmlCoz(deger: string): string {
  return deger
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * NES toplu mükellef listesi XML'i: her `User` bir VKN/TCKN, altındaki her
 * `Alias` bir posta kutusu. Sovos'un aksine silinme damgası yoktur — dosya
 * yalnızca yürürlükteki kayıtları taşır, ayıklanacak ölü etiket yoktur.
 */
function mukellefListesiAyristir(xml: string, belgeTuru: MukellefKaydi["belgeTuru"]): MukellefKaydi[] {
  const kayitlar: MukellefKaydi[] = [];
  for (const kullanici of xml.matchAll(/<User>([\s\S]*?)<\/User>/g)) {
    const govde = kullanici[1];
    const vknTckn = govde.match(/<Identifier>([^<]*)<\/Identifier>/)?.[1]?.trim();
    if (!vknTckn) continue;
    const unvan = govde.match(/<Title>([^<]*)<\/Title>/)?.[1]?.trim();
    for (const etiket of govde.matchAll(/<Name>([^<]*)<\/Name>/g)) {
      const postaKutusu = etiket[1].trim();
      if (!postaKutusu) continue;
      kayitlar.push({ vknTckn, belgeTuru, postaKutusu: xmlCoz(postaKutusu), unvan: unvan ? xmlCoz(unvan) : undefined });
    }
  }
  return kayitlar;
}

function configDogrula(cfg: EntegratorConfig): string | undefined {
  if (!cfg.apiAnahtari) return "NES API anahtarı zorunludur";
  if (!cfg.servisAdresi) return "NES servis kök adresi zorunludur (örn. https://apitest.nes.com.tr)";
  if (!cfg.gondericiBirimEtiketi) return "NES gönderici birim (GB) etiketi zorunludur";
  return undefined;
}

type GelenSatir = {
  id?: string;
  documentNumber?: string;
  issueDate?: string;
  createdAt?: string;
  accountingSupplierParty?: { partyIdentification?: string; partyName?: string; firstName?: string; familyName?: string };
};

function gonderenUnvani(taraf: GelenSatir["accountingSupplierParty"], vkn: string): string {
  const kisi = [taraf?.firstName, taraf?.familyName].filter(Boolean).join(" ");
  return taraf?.partyName || kisi || vkn;
}

/**
 * NES özel entegratör adaptörü (EBLG-01). Taşıma REST + JSON'dur; kimlik
 * doğrulama tek bir API anahtarının Bearer başlığında gönderilmesiyle olur,
 * ayrı bir oturum açma çağrısı yoktur.
 *
 * Sovos'tan iki önemli davranış farkı vardır ve ikisi de bilinçlidir:
 * - `gelenZarflariCek` tanımlı değildir: NES gelen uygulama yanıtını ayrı bir
 *   belge olarak sunmaz, giden faturanın `documentAnswer` alanına işler. Alıcı
 *   kararı bu yüzden durum sorgusundan okunur (EBLG-13).
 * - `durumSorgulaToplu` tanımlı değildir: NES zarf durumunu yalnızca tekil
 *   sorgular, toplu uç yoktur (EBLG-14).
 */
export class NesEntegratorAdapter implements EntegratorAdapter {
  readonly saglayici = "nes" as const;

  private async cagir<T>(
    cfg: EntegratorConfig,
    aile: Aile,
    yol: string,
    secenekler: {
      metot?: string;
      sorgu?: Record<string, string | number | boolean | undefined>;
      govde?: unknown;
      metin?: boolean;
      ikili?: boolean;
    } = {},
  ): Promise<T> {
    const form = secenekler.govde instanceof FormData;
    const yanit = await fetch(konum(cfg, aile, yol, secenekler.sorgu), {
      method: secenekler.metot ?? "GET",
      headers: {
        authorization: `Bearer ${cfg.apiAnahtari}`,
        accept: secenekler.ikili ? "application/zip" : secenekler.metin ? "application/xml" : "application/json",
        // FormData'nın sınır (boundary) başlığını fetch kendisi kurar; elle
        // content-type yazmak gövdeyi okunamaz hâle getirir.
        ...(!form && secenekler.govde !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: form ? (secenekler.govde as FormData) : secenekler.govde !== undefined ? JSON.stringify(secenekler.govde) : undefined,
    });
    if (!yanit.ok) throw await nesHatasi(yanit);
    // ZIP gövdesi metne çevrilirse bozulur; ikili yanıt ham tampon döner.
    if (secenekler.ikili) return Buffer.from(await yanit.arrayBuffer()) as T;
    const metin = await yanit.text();
    if (secenekler.metin) return metin as T;
    return (metin ? JSON.parse(metin) : undefined) as T;
  }

  async baglantiTest(cfg: EntegratorConfig): Promise<BaglantiSonuc> {
    const hata = configDogrula(cfg);
    if (hata) return { basarili: false, mesaj: hata };
    try {
      // Hesabın kendi etiketlerini okumak en ucuz doğrulamadır: kontör
      // harcamaz, belge üretmez, yalnızca anahtarın geçerliliğini sınar.
      await this.cagir(cfg, "general", "/v1/einvoice/aliases/Gb");
      return { basarili: true, mesaj: "NES REST bağlantısı doğrulandı" };
    } catch (hata) {
      return { basarili: false, mesaj: hata instanceof Error ? hata.message : "NES bağlantısı kurulamadı" };
    }
  }

  async mukellefSorgula(cfg: EntegratorConfig, vknTckn: string): Promise<MukellefDurum> {
    try {
      const kullanici = await this.cagir<{ aliases?: { alias?: string; creationTime?: string }[] }>(
        cfg,
        "einvoice",
        `/v1/users/${encodeURIComponent(vknTckn)}/Pk`,
      );
      // GİB bir VKN'ye onlarca posta kutusu tanımlayabilir (test kurumunun 225
      // etiketi var) ve bu uç varsayılanı işaretlemez. Firma entegratör
      // değiştirdikçe yeni etiket eklendiği için **en son oluşturulan** etiket
      // yürürlüktekidir; listenin ilkini almak yıllar önce terk edilmiş bir
      // posta kutusuna gönderim yapmak olurdu.
      const postaKutusu = (kullanici?.aliases ?? [])
        .filter((etiket) => etiket.alias)
        .sort((a, b) => (b.creationTime ?? "").localeCompare(a.creationTime ?? ""))[0]?.alias;
      return { vknTckn, eFaturaMukellefi: Boolean(postaKutusu), postaKutusu };
    } catch (hata) {
      // 404 "mükellef değil" demektir, arıza değil. Diğer hatalar yutulursa
      // e-Fatura mükellefine e-Arşiv kesilir; o yüzden yukarı taşınır.
      if (hata instanceof NesHatasi && hata.durum === 404) return { vknTckn, eFaturaMukellefi: false };
      throw hata;
    }
  }

  /**
   * Tam GİB mükellef listesini indirir (EBLG-10). NES listeyi belge ailesi
   * başına ayrı ZIP'te verir; e-Fatura ve e-İrsaliye için iki indirme gerekir.
   * Test ortamında e-Fatura dosyası ~27 bin mükellef ve ~29 bin etiket taşır,
   * bu yüzden metot günde bir kez çağrılır, belge gönderiminde değil.
   */
  async mukellefListesiCek(cfg: EntegratorConfig): Promise<MukellefKaydi[]> {
    const hata = configDogrula(cfg);
    if (hata) throw new Error(hata);
    const kayitlar = mukellefListesiAyristir(await this.mukellefListesiXml(cfg, "einvoice"), "efatura");
    try {
      kayitlar.push(...mukellefListesiAyristir(await this.mukellefListesiXml(cfg, "edespatch"), "eirsaliye"));
    } catch (hata) {
      // e-İrsaliye modülü açık olmayan hesapta bu uç yetki hatası döner; bu
      // veri arızası değil ürün kapsamıdır. Diğer hatalar yukarı taşınır,
      // yoksa eksik liste tam sanılıp gönderimler yanlış kanala kayar.
      if (!(hata instanceof NesHatasi) || (hata.durum !== 403 && hata.durum !== 404)) throw hata;
    }
    return kayitlar;
  }

  private async mukellefListesiXml(cfg: EntegratorConfig, aile: Aile): Promise<string> {
    return zipIlkXmlBuffer(await this.cagir<Buffer>(cfg, aile, "/v1/users/zip/Pk", { ikili: true }));
  }

  async belgeGonder(cfg: EntegratorConfig, belge: UblBelge): Promise<GonderimSonuc> {
    const hata = configDogrula(cfg);
    if (hata) return { basarili: false, hataMesaji: hata };
    if (belge.tur === "efatura" && !belge.aliciPostaKutusu) {
      return { basarili: false, hataMesaji: "Alıcının e-Fatura posta kutusu etiketi bulunamadı" };
    }
    const aile: Aile = belge.tur === "earsiv" ? "earchive" : "einvoice";
    try {
      const sonuc = await this.cagir<{ uuid?: string }>(cfg, aile, "/v1/uploads/document", {
        metot: "POST",
        govde: yuklemeFormu(belge, cfg.gondericiBirimEtiketi!, belge.aliciPostaKutusu),
      });
      if (!sonuc?.uuid) return { basarili: false, hataMesaji: "NES yükleme yanıtında belge UUID'si dönmedi" };
      return { basarili: true, belgeRef: belge.tur === "earsiv" ? `${EARSIV_ONEKI}${sonuc.uuid}` : sonuc.uuid };
    } catch (hata) {
      return { basarili: false, hataMesaji: hata instanceof Error ? hata.message : "NES gönderimi başarısız" };
    }
  }

  async durumSorgula(cfg: EntegratorConfig, belgeRef: string): Promise<BelgeDurumSonuc> {
    if (belgeRef.startsWith(EARSIV_ONEKI)) {
      const uuid = belgeRef.slice(EARSIV_ONEKI.length);
      try {
        const fatura = await this.cagir<{ recordStatus?: string }>(
          cfg,
          "earchive",
          `/v1/invoices/${encodeURIComponent(uuid)}`,
        );
        // e-Arşiv'de alıcı kabul/ret akışı yoktur; belge NES'te oluştuysa
        // GİB'e raporlanmak üzere iletilmiş sayılır.
        const kayit = fatura?.recordStatus;
        return { belgeRef, durum: kayit === "Error" ? "hata" : kayit === "Waiting" ? "kuyrukta" : "iletildi" };
      } catch (hata) {
        return { belgeRef, durum: "hata", detay: hata instanceof Error ? hata.message : "NES e-Arşiv durum sorgusu başarısız" };
      }
    }
    try {
      const fatura = await this.cagir<{
        outgoingStatus?: string;
        documentAnswer?: string;
        outgoingEnvelope?: { description?: string };
        incomingAnswer?: { answerNote?: string; errorDescription?: string };
      }>(cfg, "einvoice", `/v1/outgoing/invoices/${encodeURIComponent(belgeRef)}`);
      return {
        belgeRef,
        durum: nesBelgeDurumu(fatura?.outgoingStatus, fatura?.documentAnswer),
        detay:
          fatura?.incomingAnswer?.answerNote ||
          fatura?.incomingAnswer?.errorDescription ||
          fatura?.outgoingEnvelope?.description,
      };
    } catch (hata) {
      return { belgeRef, durum: "hata", detay: hata instanceof Error ? hata.message : "NES durum sorgusu başarısız" };
    }
  }

  /**
   * Gelen faturaları tarih penceresiyle sayfalayarak indirir (EBLG-11).
   * NES kursör sunmaz, `page`/`pageSize` verir; tarama sürerken yeni belge
   * girerse sayfalar kayabildiği için UUID bazında tekilleştirme yapılır.
   */
  async gelenBelgeleriCek(cfg: EntegratorConfig, sonrasi: Date): Promise<GelenBelge[]> {
    const hata = configDogrula(cfg);
    if (hata) throw new Error(hata);
    const bitis = new Date();
    const gorulen = new Set<string>();
    const belgeler: GelenBelge[] = [];
    for (let sayfa = 1; sayfa <= SAYFA_TAVANI; sayfa++) {
      const liste = await this.cagir<{ data?: GelenSatir[] }>(cfg, "einvoice", "/v1/incoming/invoices", {
        sorgu: {
          startCreateDate: sonrasi.toISOString(),
          endCreateDate: bitis.toISOString(),
          page: sayfa,
          pageSize: SAYFA_BOYUTU,
        },
      });
      const satirlar = liste?.data ?? [];
      for (const satir of satirlar) {
        if (!satir.id || gorulen.has(satir.id)) continue;
        gorulen.add(satir.id);
        const xml = await this.cagir<string>(cfg, "einvoice", `/v1/incoming/invoices/${encodeURIComponent(satir.id)}/xml`, {
          metin: true,
        });
        const gonderenVkn = satir.accountingSupplierParty?.partyIdentification ?? "";
        belgeler.push({
          uuid: satir.id,
          belgeNo: satir.documentNumber ?? satir.id,
          gonderenVkn,
          gonderenUnvan: gonderenUnvani(satir.accountingSupplierParty, gonderenVkn),
          tarih: new Date(satir.issueDate ?? satir.createdAt ?? Date.now()),
          xml,
        });
      }
      if (satirlar.length < SAYFA_BOYUTU) break;
    }
    return belgeler;
  }

  /**
   * Gelen faturaya kabul/ret verir (EBLG-06). Sovos'tan farklı olarak
   * ApplicationResponse UBL'ini biz üretmeyiz; NES yanıtı kendi kurar, bize
   * yalnızca kararı ve notu iletmek düşer. Bu yüzden `kaynak` kullanılmaz.
   */
  async yanitGonder(
    cfg: EntegratorConfig,
    belgeRef: string,
    yanit: "kabul" | "ret",
    gerekce?: string,
  ): Promise<GonderimSonuc> {
    try {
      await this.cagir(cfg, "einvoice", `/v1/incoming/invoices/${encodeURIComponent(belgeRef)}/documentAnswer`, {
        metot: "POST",
        govde: {
          answerNote: gerekce,
          incomingInvoiceAnswerParameter: yanit === "kabul" ? "KABUL" : "RED",
        },
      });
      return { basarili: true, belgeRef };
    } catch (hata) {
      return { basarili: false, hataMesaji: hata instanceof Error ? hata.message : "NES uygulama yanıtı gönderilemedi" };
    }
  }

  /**
   * e-Arşiv iptali. NES iptali belge UUID'siyle alır, sözleşmemiz
   * ise fatura numarası taşır; aradaki eşlemeyi adaptör kendisi kurar.
   */
  async earsivIptal(cfg: EntegratorConfig, girdi: EarsivIptalGirdi): Promise<BaglantiSonuc> {
    try {
      const liste = await this.cagir<{ data?: { id?: string }[] }>(cfg, "earchive", "/v1/invoices", {
        sorgu: { documentNumber: girdi.faturaNo, page: 1, pageSize: 2 },
      });
      const uuid = liste?.data?.find((satir) => satir.id)?.id;
      if (!uuid) return { basarili: false, mesaj: `İptal edilecek e-Arşiv faturası NES'te bulunamadı: ${girdi.faturaNo}` };
      await this.cagir(cfg, "earchive", "/v1/invoices/cancel", { metot: "POST", govde: { uuids: [uuid] } });
      return { basarili: true, mesaj: "e-Arşiv iptali NES'e bildirildi" };
    } catch (hata) {
      return { basarili: false, mesaj: hata instanceof Error ? hata.message : "e-Arşiv iptali gönderilemedi" };
    }
  }

  /**
   * e-Arşiv raporlarını ay ay listeler (EBLG-07). NES raporu dönem bölümleri
   * hâlinde tutar ve tutar toplamı döndürmez; tutar alanı bu yüzden boştur,
   * ekran belge sayısı ve GİB durumu üzerinden okunur.
   */
  async earsivRaporListele(cfg: EntegratorConfig, baslangic: Date, bitis: Date): Promise<EarsivRapor[]> {
    const raporlar: EarsivRapor[] = [];
    const imlec = new Date(Date.UTC(baslangic.getUTCFullYear(), baslangic.getUTCMonth(), 1));
    const son = new Date(Date.UTC(bitis.getUTCFullYear(), bitis.getUTCMonth(), 1));
    while (imlec <= son) {
      const yil = imlec.getUTCFullYear();
      const ay = imlec.getUTCMonth() + 1;
      const bolumler = await this.cagir<
        { id?: string; startDate?: string; endDate?: string; eArchiveInvoiceCount?: number; status?: string }[]
      >(cfg, "general", `/v1/earchivedocumentsreport/${yil}/${ay}`);
      for (const bolum of bolumler ?? []) {
        if (!bolum.id) continue;
        raporlar.push({
          uuid: bolum.id,
          donem: `${yil}-${String(ay).padStart(2, "0")}`,
          baslangic: (bolum.startDate ?? "").slice(0, 10),
          bitis: (bolum.endDate ?? "").slice(0, 10),
          faturaSayisi: bolum.eArchiveInvoiceCount ?? 0,
          toplamTutar: "0",
          gibDurumu: bolum.status ?? "",
        });
      }
      imlec.setUTCMonth(imlec.getUTCMonth() + 1);
    }
    return raporlar;
  }

  async irsaliyeGonder(cfg: EntegratorConfig, belge: EirsaliyeBelge): Promise<GonderimSonuc> {
    const hata = configDogrula(cfg);
    if (hata) return { basarili: false, hataMesaji: hata };
    try {
      const sonuc = await this.cagir<{ uuid?: string }>(cfg, "edespatch", "/v1/uploads/document", {
        metot: "POST",
        govde: yuklemeFormu(belge, cfg.gondericiBirimEtiketi!, belge.aliciPostaKutusu),
      });
      return sonuc?.uuid
        ? { basarili: true, belgeRef: sonuc.uuid }
        : { basarili: false, hataMesaji: "NES e-İrsaliye referansı dönmedi" };
    } catch (hata) {
      return { basarili: false, hataMesaji: hata instanceof Error ? hata.message : "e-İrsaliye gönderilemedi" };
    }
  }

  async irsaliyeDurumSorgula(cfg: EntegratorConfig, belgeRef: string): Promise<BelgeDurumSonuc> {
    try {
      const irsaliye = await this.cagir<{ outgoingStatus?: string; documentAnswer?: string; outgoingEnvelope?: { description?: string } }>(
        cfg,
        "edespatch",
        `/v1/outgoing/despatches/${encodeURIComponent(belgeRef)}`,
      );
      return {
        belgeRef,
        durum: nesBelgeDurumu(irsaliye?.outgoingStatus, irsaliye?.documentAnswer),
        detay: irsaliye?.outgoingEnvelope?.description,
      };
    } catch (hata) {
      return { belgeRef, durum: "hata", detay: hata instanceof Error ? hata.message : "e-İrsaliye durumu sorgulanamadı" };
    }
  }

  async gelenIrsaliyeleriCek(cfg: EntegratorConfig, sonrasi: Date): Promise<GelenEirsaliye[]> {
    const hata = configDogrula(cfg);
    if (hata) throw new Error(hata);
    const bitis = new Date();
    const gorulen = new Set<string>();
    const irsaliyeler: GelenEirsaliye[] = [];
    for (let sayfa = 1; sayfa <= SAYFA_TAVANI; sayfa++) {
      const liste = await this.cagir<{ data?: GelenSatir[] }>(cfg, "edespatch", "/v1/incoming/despatches", {
        sorgu: {
          startCreateDate: sonrasi.toISOString(),
          endCreateDate: bitis.toISOString(),
          page: sayfa,
          pageSize: SAYFA_BOYUTU,
        },
      });
      const satirlar = liste?.data ?? [];
      for (const satir of satirlar) {
        if (!satir.id || gorulen.has(satir.id)) continue;
        gorulen.add(satir.id);
        const xml = await this.cagir<string>(cfg, "edespatch", `/v1/incoming/despatches/${encodeURIComponent(satir.id)}/xml`, {
          metin: true,
        });
        const gonderenVkn = satir.accountingSupplierParty?.partyIdentification ?? "";
        irsaliyeler.push({
          uuid: satir.id,
          belgeNo: satir.documentNumber ?? satir.id,
          gonderenVkn,
          gonderenUnvan: gonderenUnvani(satir.accountingSupplierParty, gonderenVkn),
          tarih: new Date(satir.issueDate ?? satir.createdAt ?? Date.now()),
          xml,
        });
      }
      if (satirlar.length < SAYFA_BOYUTU) break;
    }
    return irsaliyeler;
  }

  /**
   * Gelen e-İrsaliyeye yanıt verir. NES ReceiptAdvice'ı hazır
   * üretmez; UBL'i biz kurar, karar bilgisini AnswerType alanında ayrıca
   * belirtiriz. Kısmi kabul akışı bizde yok, yanıt hep tüm satırları kapsar.
   */
  async irsaliyeYanitiGonder(
    cfg: EntegratorConfig,
    belgeRef: string,
    yanit: "kabul" | "ret",
    gerekce?: string,
  ): Promise<GonderimSonuc> {
    try {
      const receipt = receiptAdviceXml(belgeRef, yanit, gerekce);
      const form = new FormData();
      form.set("File", new Blob([receipt.xml], { type: "application/xml" }), `${receipt.uuid}.xml`);
      form.set("AnswerType", yanit === "kabul" ? "AllAccepted" : "AllRejected");
      await this.cagir(cfg, "edespatch", `/v1/incoming/despatches/${encodeURIComponent(belgeRef)}/receiptadvice`, {
        metot: "POST",
        govde: form,
      });
      return { basarili: true, belgeRef: receipt.uuid };
    } catch (hata) {
      return { basarili: false, hataMesaji: hata instanceof Error ? hata.message : "İrsaliye yanıtı gönderilemedi" };
    }
  }
}
