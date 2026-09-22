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
  OnizlemeSonuc,
  UblBelge,
  EarsivIptalGirdi,
  EarsivRapor,
  EarsivRaporTutari,
  EirsaliyeBelge,
  GelenEirsaliye,
  MukellefKaydi,
  GelenYanit,
} from "./types";

/**
 * NES uçları tek kök adres altında servis ailelerine ayrılır; aile ön ekini
 * adaptör ekler. Kök kullanıcıdan alınmaz, test ortamı seçiminden türetilir
 * (EBLG-01a): serbest adres test bayrağıyla ayrışabiliyor ve API anahtarını
 * herhangi bir sunucuya gönderebiliyordu.
 */
type Aile = "einvoice" | "earchive" | "edespatch" | "general";

export const NES_TEST_KOKU = "https://apitest.nes.com.tr";
export const NES_CANLI_KOKU = "https://api.nes.com.tr";

export function nesKokAdresi(cfg: Pick<EntegratorConfig, "testOrtami">): string {
  return cfg.testOrtami ? NES_TEST_KOKU : NES_CANLI_KOKU;
}

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

/** Belgenin içeriğine itiraz eden, yeniden göndermekle değişmeyecek ret kodları. */
const NES_KALICI_RET_KODLARI = [400, 422];

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
  const adres = new URL(`${nesKokAdresi(cfg)}/${aile}${yol}`);
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
  /** 403'te dönen yetki gövdesi: hangi scope'un eksik olduğunu söyler. */
  scope?: string;
  role?: string | null;
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
    // 403 gövdesi ötekilere benzemez: yalnızca eksik yetkinin adını taşır.
    // Ham JSON'u basmak kullanıcıya ne yapacağını söylemez.
    if (yanit.status === 403 && govde.scope) {
      return new NesHatasi(403, `NES 403: API anahtarının '${govde.scope}' yetkisi yok — NES portalında Yönetim Paneli > API Tanımları'ndan anahtarın scope'larını genişletin`);
    }
    const baslik = govde.message || govde.Message || govde.title || govde.detail;
    ayrinti = [baslik, hataSatirlari(govde).join("; ")].filter(Boolean).join(" — ") || ayrinti;
  } catch {
    // Gövde JSON değilse ham metnin başı yeterli ayrıntıdır.
  }
  return new NesHatasi(yanit.status, `NES ${yanit.status}${ayrinti ? `: ${kirp(ayrinti)}` : ""}`);
}

/**
 * Uzun gövdeyi keser ama kuralı ortasından bölmez: bir belge birden çok
 * şematron kuralına takılabiliyor ve yarım cümle hangi alanın eksik olduğunu
 * söylemiyor. Sığmayan kuralların sayısı yazılır ki eksik olduğu bilinsin.
 */
function kirp(metin: string, sinir = 1000): string {
  if (metin.length <= sinir) return metin;
  const parcalar = metin.split("; ");
  const tutulan: string[] = [];
  let uzunluk = 0;
  for (const parca of parcalar) {
    if (uzunluk + parca.length > sinir && tutulan.length) break;
    tutulan.push(parca);
    uzunluk += parca.length + 2;
  }
  const kalan = parcalar.length - tutulan.length;
  return tutulan.join("; ") + (kalan > 0 ? ` (+${kalan} kural daha)` : "");
}

/**
 * NES giden belge durumunu ortak BelgeDurum kümesine indirger (EBLG-04).
 * Alıcının kararı zarf durumunu ezer: ticari faturada son söz alıcınındır.
 * Tanınmayan bir durum "hata" sayılmaz — belge takipten düşer ve bir daha
 * sorgulanmaz; bilinmeyen hâl "kuyrukta" kalıp yeniden sorgulanmalıdır.
 */
/** NES rapor dökümünün bir satırı (general/v1 şeması, 2026-09-11). */
export interface NesRaporDokumSatiri {
  documentNumber?: string;
  isCancelRecord?: boolean;
  documentCurrencyCode?: string;
  payableAmount?: number;
}

/**
 * Döküm satırlarını para birimine göre toplar. İptal kaydı (`isCancelRecord`)
 * bildirilen toplama katılmaz, ayrı listelenir. Toplama kuruş cinsinden
 * tamsayıyla yapılır; kayan noktalı toplama yüzlerce belgede kuruş kaydırır.
 */
export function earsivRaporTutariOzetle(uuid: string, satirlar: NesRaporDokumSatiri[]): EarsivRaporTutari {
  const topla = (liste: NesRaporDokumSatiri[]) => {
    const gruplar = new Map<string, { kurus: number; belgeSayisi: number }>();
    for (const satir of liste) {
      const paraBirimi = satir.documentCurrencyCode || "TRY";
      const grup = gruplar.get(paraBirimi) ?? { kurus: 0, belgeSayisi: 0 };
      grup.kurus += Math.round(Number(satir.payableAmount ?? 0) * 100);
      grup.belgeSayisi += 1;
      gruplar.set(paraBirimi, grup);
    }
    return [...gruplar].map(([paraBirimi, g]) => ({ paraBirimi, tutar: (g.kurus / 100).toFixed(2), belgeSayisi: g.belgeSayisi }));
  };
  return {
    uuid,
    bildirilen: topla(satirlar.filter((s) => !s.isCancelRecord)),
    iptal: topla(satirlar.filter((s) => s.isCancelRecord)),
  };
}

/**
 * EBLG-36: irsaliye yanıtının (UBL-TR ReceiptAdvice) kararı satır
 * miktarlarından çıkar — yalnız teslim alınan → kabul, hiç teslim alınmayan →
 * ret, ikisi birden → kısmi kabul. Eksik miktar (`ShortQuantity`) da teslim
 * alınmamış sayılır. Satır ya da miktar yoksa karar verilmez.
 */
export function irsaliyeYanitiKarari(xml: string): { durum: "kabul" | "ret" | "kismi_kabul"; detay?: string } | undefined {
  const satirlar = xml.match(/<(?:\w+:)?ReceiptLine\b[\s\S]*?<\/(?:\w+:)?ReceiptLine>/g) ?? [];
  const miktar = (satir: string, ad: string) => {
    const deger = satir.match(new RegExp(`<(?:\\w+:)?${ad}\\b[^>]*>([^<]*)<`))?.[1]?.trim().replace(",", ".");
    const sayi = deger ? Number(deger) : 0;
    return Number.isFinite(sayi) ? sayi : 0;
  };
  let alinan = 0;
  let reddedilen = 0;
  let eksik = 0;
  const gerekceler = new Set<string>();
  for (const satir of satirlar) {
    alinan += miktar(satir, "ReceivedQuantity");
    reddedilen += miktar(satir, "RejectedQuantity");
    eksik += miktar(satir, "ShortQuantity");
    const gerekce = satir.match(/<(?:\w+:)?RejectReason\b[^>]*>([^<]*)</)?.[1]?.trim();
    if (gerekce) gerekceler.add(gerekce);
  }
  const teslimAlinmayan = reddedilen + eksik;
  if (alinan === 0 && teslimAlinmayan === 0) return undefined;

  const yuvarla = (n: number) => Math.round(n * 1000) / 1000;
  const detay = [
    teslimAlinmayan > 0 ? `teslim alınan ${yuvarla(alinan)}, reddedilen ${yuvarla(reddedilen)}${eksik ? `, eksik ${yuvarla(eksik)}` : ""}` : "",
    gerekceler.size ? `gerekçe: ${[...gerekceler].join("; ")}` : "",
  ].filter(Boolean).join(" · ");
  const durum = teslimAlinmayan === 0 ? "kabul" : alinan === 0 ? "ret" : "kismi_kabul";
  return detay ? { durum, detay: detay.slice(0, 500) } : { durum };
}

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

/** Kaynak irsaliyeden tek bir alanı çeker; UBL-TR alan adları benzersizdir. */
function ublAlan(xml: string, blok: string, alan: string): string {
  const govde = new RegExp(`<cac:${blok}>([\\s\\S]*?)</cac:${blok}>`).exec(xml)?.[1] ?? xml;
  return xmlCoz(new RegExp(`<cbc:${alan}[^>]*>([^<]*)</cbc:${alan}>`).exec(govde)?.[1] ?? "");
}

/**
 * Gelen e-İrsaliyeye verilecek ReceiptAdvice UBL'i (UBL-TR 1.2.1). Eleman
 * sırası şemada bağlayıcı; `docs/e-belge/… UBL-TR 1.2.1/XML/ReceiptAdvice.xml`
 * örneğinden alınmıştır. Taraflar ve satırlar yanıtlanan irsaliyeden okunur —
 * yanıt, cevapladığı belgenin taraflarını aynen taşımak zorundadır.
 */
function receiptAdviceXml(
  belgeRef: string,
  yanit: "kabul" | "ret",
  gerekce: string | undefined,
  kaynakXml: string,
  seriOneki: string,
): { uuid: string; xml: string } {
  const uuid = randomUUID();
  const kacir = (deger: string) =>
    deger.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const bugun = new Date();
  const tarih = bugun.toISOString().slice(0, 10);
  // Numarayı sağlayıcı atar: UBL'e yalnız seri öneki yazılır, tam numara
  // yükleme yanıtından okunur (EBLG-16'nın yanıt belgesindeki karşılığı).
  const no = seriOneki;
  const irsaliyeNo = ublAlan(kaynakXml, "", "ID");
  const irsaliyeTarihi = ublAlan(kaynakXml, "", "IssueDate") || tarih;
  const taraf = (blok: string) => {
    const govde = new RegExp(`<cac:${blok}>([\\s\\S]*?)</cac:${blok}>`).exec(kaynakXml)?.[1] ?? "";
    const kimlik = /<cbc:ID schemeID="(VKN|TCKN)">([^<]*)</.exec(govde);
    const ad = /<cac:PartyName>\s*<cbc:Name>([^<]*)</.exec(govde);
    return `<cac:Party><cac:PartyIdentification><cbc:ID schemeID="${kimlik?.[1] ?? "VKN"}">${kacir(kimlik?.[2] ?? "")}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${kacir(xmlCoz(ad?.[1] ?? ""))}</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:CitySubdivisionName>Merkez</cbc:CitySubdivisionName><cbc:CityName>Istanbul</cbc:CityName><cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country></cac:PostalAddress></cac:Party>`;
  };
  // Satırlar birebir yanıtlanır: kabulde gelen miktar, rette sıfır.
  const satirlar = [...kaynakXml.matchAll(/<cac:DespatchLine>([\s\S]*?)<\/cac:DespatchLine>/g)].map((eslesme, sira) => {
    const govde = eslesme[1];
    const id = /<cbc:ID>([^<]*)</.exec(govde)?.[1] ?? String(sira + 1);
    const miktar = /<cbc:DeliveredQuantity[^>]*>([^<]*)</.exec(govde)?.[1] ?? "0";
    const birim = /<cbc:DeliveredQuantity unitCode="([^"]*)"/.exec(govde)?.[1] ?? "C62";
    const adi = xmlCoz(/<cac:Item>\s*<cbc:Name>([^<]*)</.exec(govde)?.[1] ?? "");
    return `<cac:ReceiptLine><cbc:ID>${kacir(id)}</cbc:ID><cbc:ReceivedQuantity unitCode="${kacir(birim)}">${yanit === "kabul" ? kacir(miktar) : "0"}</cbc:ReceivedQuantity><cac:DespatchLineReference><cbc:LineID>${kacir(id)}</cbc:LineID></cac:DespatchLineReference><cac:Item><cbc:Name>${kacir(adi)}</cbc:Name></cac:Item></cac:ReceiptLine>`;
  }).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><ReceiptAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:ReceiptAdvice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`
    + `<cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>TR1.2</cbc:CustomizationID><cbc:ProfileID>TEMELIRSALIYE</cbc:ProfileID>`
    + `<cbc:ID>${kacir(no)}</cbc:ID><cbc:CopyIndicator>false</cbc:CopyIndicator><cbc:UUID>${uuid}</cbc:UUID>`
    + `<cbc:IssueDate>${tarih}</cbc:IssueDate><cbc:IssueTime>${bugun.toISOString().slice(11, 19)}</cbc:IssueTime>`
    + `<cbc:ReceiptAdviceTypeCode>SEVK</cbc:ReceiptAdviceTypeCode>`
    + (gerekce ? `<cbc:Note>${kacir(gerekce)}</cbc:Note>` : "")
    + `<cac:DespatchDocumentReference><cbc:ID>${kacir(irsaliyeNo)}</cbc:ID><cbc:IssueDate>${kacir(irsaliyeTarihi)}</cbc:IssueDate></cac:DespatchDocumentReference>`
    + `<cac:DeliveryCustomerParty>${taraf("DeliveryCustomerParty")}</cac:DeliveryCustomerParty>`
    + `<cac:DespatchSupplierParty>${taraf("DespatchSupplierParty")}</cac:DespatchSupplierParty>`
    + `${satirlar}</ReceiptAdvice>`;
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
    const tur = govde.match(/<Type>([^<]*)<\/Type>/)?.[1]?.trim() || undefined;
    for (const etiket of govde.matchAll(/<Name>([^<]*)<\/Name>/g)) {
      const postaKutusu = etiket[1].trim();
      if (!postaKutusu) continue;
      kayitlar.push({ vknTckn, belgeTuru, postaKutusu: xmlCoz(postaKutusu), unvan: unvan ? xmlCoz(unvan) : undefined, tur });
    }
  }
  return kayitlar;
}

/** `urn:mail:defaultpk@nes.com.tr` → `nes.com.tr` */
function etiketAlanAdi(etiket?: string): string | undefined {
  const i = etiket?.lastIndexOf("@") ?? -1;
  return i > 0 ? etiket!.slice(i + 1).toLowerCase() : undefined;
}

/** `urn:mail:defaultpk@nes.com.tr` → `defaultpk` */
function etiketYerelAdi(etiket: string): string {
  return (/^urn:mail:([^@]+)/.exec(etiket)?.[1] ?? "").toLowerCase();
}

/**
 * Alıcının posta kutusunu seçer. Tek etiket varsa soru yoktur; gerçek
 * firmaların neredeyse tamamı bu durumdadır.
 *
 * Birden çoksa veriden çıkarılabilecek en güvenilir sinyal, etiketin **bizim
 * entegratörümüzün alan adında** olmasıdır: alıcı da aynı entegratördeyse
 * teslimat oradan yürür. Bu küme içinde GİB'in birincil kutu adlandırması olan
 * `defaultpk` tercih edilir, kalan eşitlik en yeni kayıtla bozulur.
 *
 * Denenip elenen iki kural: "listenin ilki" (API sırası rastgele) ve "en yeni
 * etiket" — GİB test VKN'lerinde yıllar içinde her entegratörden etiket birikir;
 * Kurum 02'nin 225 etiketinin 57'si `defaultpk` ve en yenisi yürürlükteki kutu
 * değil. Seçim bu yüzden bir tahmindir; adayların tamamı `postaKutulari` ile
 * döner ki çağıran gerektiğinde kullanıcıya sorabilsin.
 */
function postaKutusuSec(
  etiketler: { alias?: string; creationTime?: string }[],
  kendiEtiketimiz?: string,
): string | undefined {
  const adaylar = etiketler.filter((e) => e.alias);
  if (adaylar.length <= 1) return adaylar[0]?.alias;
  const bizimAlan = etiketAlanAdi(kendiEtiketimiz);
  const ayniEntegrator = bizimAlan ? adaylar.filter((e) => etiketAlanAdi(e.alias) === bizimAlan) : [];
  const havuz = ayniEntegrator.length ? ayniEntegrator : adaylar;
  const varsayilanlar = havuz.filter((e) => etiketYerelAdi(e.alias!) === "defaultpk");
  return (varsayilanlar.length ? varsayilanlar : havuz)
    .slice()
    .sort((a, b) => (b.creationTime ?? "").localeCompare(a.creationTime ?? ""))[0]?.alias;
}

function configDogrula(cfg: EntegratorConfig): string | undefined {
  if (!cfg.apiAnahtari) return "NES API anahtarı zorunludur";
  if (!cfg.gondericiBirimEtiketi) return "NES gönderici birim (GB) etiketi zorunludur";
  return undefined;
}

type GonderenTaraf = { partyIdentification?: string; partyName?: string; firstName?: string; familyName?: string };

type GelenSatir = {
  id?: string;
  documentNumber?: string;
  issueDate?: string;
  createdAt?: string;
  accountingSupplierParty?: GonderenTaraf;
  /** e-İrsaliye yanıtında gönderen bu adla döner, faturadakiyle aynı değil. */
  despatchSupplierParty?: GonderenTaraf;
  /** Faturada alıcı kararı, listede: None | Waiting | Accepted | Rejected. */
  documentAnswer?: string;
  /** İrsaliyede alıcı kararı: AllAccepted | AllRejected | … */
  despatchAnswer?: string;
  /** Verilen yanıtın kendisi; tekil faturada karar yalnız burada döner. */
  outgoingAnswer?: { documentAnswer?: string; answerNote?: string };
};

const NES_KARARLARI: Record<string, "kabul" | "ret"> = {
  Accepted: "kabul",
  AllAccepted: "kabul",
  Rejected: "ret",
  AllRejected: "ret",
};

/**
 * NES'in gelen belgeye kaydettiği kabul/ret kararı (EBLG-34). Karar üç alandan
 * birinde gelebilir (fatura listesi, tekil fatura, irsaliye); tanınmayan ya da
 * henüz verilmemiş karar (`None`, `Waiting`, kısmi kabul) `undefined` döner —
 * belirsiz kararı benimsemek yerel yanıtı yanlışlıkla kapatırdı.
 */
export function nesGelenYanit(satir: GelenSatir): GelenYanit | undefined {
  const karar = [satir.despatchAnswer, satir.documentAnswer, satir.outgoingAnswer?.documentAnswer]
    .map((ham) => (ham ? NES_KARARLARI[ham] : undefined))
    .find(Boolean);
  if (!karar) return undefined;
  const not = satir.outgoingAnswer?.answerNote?.trim();
  return not ? { karar, not } : { karar };
}

function gonderenUnvani(taraf: GonderenTaraf | undefined, vkn: string): string {
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

  /** NES serileri otomatik numaralandırılabilir; numarayı yükleme yanıtı verir. */
  readonly belgeNoAtar = true;

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
      // Bu uç varsayılanı işaretlemez (`isDefault` yalnızca kendi hesabımızın
      // etiketlerinde vardır), o yüzden seçim kuralı adaptörde (postaKutusuSec)
      // ve adayların tamamı çağırana açılır.
      const etiketler = (kullanici?.aliases ?? []).filter((etiket) => etiket.alias);
      const postaKutusu = postaKutusuSec(etiketler, cfg.gondericiBirimEtiketi);
      return {
        vknTckn,
        eFaturaMukellefi: Boolean(postaKutusu),
        postaKutusu,
        postaKutulari: etiketler.length > 1 ? etiketler.map((etiket) => etiket.alias!) : undefined,
      };
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
      const sonuc = await this.cagir<{ uuid?: string; documentNumber?: string }>(cfg, aile, "/v1/uploads/document", {
        metot: "POST",
        govde: yuklemeFormu(belge, cfg.gondericiBirimEtiketi!, belge.aliciPostaKutusu),
      });
      if (!sonuc?.uuid) return { basarili: false, hataMesaji: "NES yükleme yanıtında belge UUID'si dönmedi" };
      return {
        basarili: true,
        belgeRef: belge.tur === "earsiv" ? `${EARSIV_ONEKI}${sonuc.uuid}` : sonuc.uuid,
        belgeNo: sonuc.documentNumber,
      };
    } catch (hata) {
      return {
        basarili: false,
        hataMesaji: hata instanceof Error ? hata.message : "NES gönderimi başarısız",
        // 400/422 belgenin kendisine itirazdır (ör. SCHEMATRON_CHECK_RESULT_HAS_FAILED);
        // yetki, zaman aşımı ve sunucu hataları geçici sayılır, yeniden denenir.
        kalici: hata instanceof NesHatasi && NES_KALICI_RET_KODLARI.includes(hata.durum),
      };
    }
  }

  /**
   * Gönderim öncesi önizleme (L): `/v1/uploads/document/preview` belgeyi
   * oluşturmadan şema ve şematron denetiminden geçirir ve alıcının göreceği
   * HTML'i base64 olarak döndürür. Denetim hatası 422 ile gelir, kural
   * metinleri `nesHatasi` ile okunur. Kural keşfi için de kullanıldı: EBLG-57,
   * 58 ve 59'daki şematron kuralları bu uçla bulundu (2026-09-19).
   */
  async belgeOnizle(cfg: EntegratorConfig, belge: UblBelge): Promise<OnizlemeSonuc> {
    const hata = configDogrula(cfg);
    if (hata) return { basarili: false, hataMesaji: hata };
    const aile: Aile = belge.tur === "earsiv" ? "earchive" : "einvoice";
    const form = new FormData();
    form.set("File", new Blob([belge.xml], { type: "application/xml" }), `${belge.uuid}.xml`);
    try {
      const sonuc = await this.cagir<{ content?: string; errorMessage?: string | null }>(cfg, aile, "/v1/uploads/document/preview", {
        metot: "POST",
        govde: form,
      });
      if (sonuc?.errorMessage) return { basarili: false, hataMesaji: `NES: ${sonuc.errorMessage}` };
      if (!sonuc?.content) return { basarili: false, hataMesaji: "NES önizleme yanıtında görünüm dönmedi" };
      return { basarili: true, html: Buffer.from(sonuc.content, "base64").toString("utf8") };
    } catch (hata) {
      return { basarili: false, hataMesaji: hata instanceof Error ? hata.message : "NES önizlemesi başarısız" };
    }
  }

  /**
   * Gönderilmiş belgenin resmî görünümü (EBLG-75). Belgeye XSLT gömmediğimiz
   * için alıcının gördüğü tasarım NES'tedir; bu uç onu PDF olarak verir.
   * Yollar ailelere göre ayrıdır: e-Faturada `/v1/outgoing/invoices/{uuid}/pdf`
   * (swagger'da belgeli), e-Arşivde `/v1/invoices/{uuid}/pdf` (2026-09-20'de
   * denenerek bulundu; e-Arşiv şeması repoda yok). `uuid` bizim fatura
   * kimliğimizdir — UBL'e `cbc:UUID` olarak onu yazıyoruz.
   */
  async gidenBelgePdf(cfg: EntegratorConfig, uuid: string, tur: UblBelge["tur"]): Promise<Buffer | null> {
    if (configDogrula(cfg)) return null;
    const earsiv = tur === "earsiv";
    try {
      return await this.cagir<Buffer>(
        cfg,
        earsiv ? "earchive" : "einvoice",
        earsiv ? `/v1/invoices/${uuid}/pdf` : `/v1/outgoing/invoices/${uuid}/pdf`,
        { ikili: true },
      );
    } catch {
      // Görünüm indirilemezse çağıran kendi yedek görünümünü basar; belge
      // görüntülemek hiçbir zaman hata vermemeli.
      return null;
    }
  }

  /**
   * Yeniden denemeden önce belgenin sağlayıcıda zaten var olup olmadığına
   * bakar (EBLG-17). NES, UBL'deki `cbc:UUID` değerini belgenin kimliği olarak
   * saklar; biz oraya fatura kimliğimizi yazdığımız için `uuid` filtresiyle
   * kendi kaydımızı doğrudan bulabiliriz.
   */
  async belgeAra(cfg: EntegratorConfig, kaynakKayitId: string, tur: UblBelge["tur"]): Promise<GonderimSonuc | undefined> {
    // Filtre çözümlenemezse sorgu tüm listeyi getirir; hiç sormamak daha güvenli.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(kaynakKayitId)) {
      throw new Error(`Belge araması için geçerli bir UUID gerekir: ${kaynakKayitId}`);
    }
    const arsiv = tur === "earsiv";
    const liste = await this.cagir<{ data?: { id?: string; documentNumber?: string }[] }>(
      cfg,
      arsiv ? "earchive" : "einvoice",
      arsiv ? "/v1/invoices" : "/v1/outgoing/invoices",
      { sorgu: { uuid: kaynakKayitId, page: 1, pageSize: 1 } },
    );
    // Dönen kaydın kimliği sorduğumuzla birebir aynı olmalı. NES, çözümlenemeyen
    // bir `uuid` filtresini sessizce yok sayıp **tüm listeyi** döndürüyor; eşitlik
    // aranmazsa yeniden denemede alakasız bir belge benimsenir ve faturaya
    // başkasının numarası yazılırdı.
    const belge = liste?.data?.find((satir) => satir.id === kaynakKayitId);
    if (!belge?.id) return undefined;
    return {
      basarili: true,
      belgeRef: arsiv ? `${EARSIV_ONEKI}${belge.id}` : belge.id,
      belgeNo: belge.documentNumber,
    };
  }

  /**
   * Çağrı hatası fırlatılır, `hata` durumu olarak dönmez: geçici kesinti
   * belgeyi son duruma taşıyıp takipten düşürüyordu (EBLG-39).
   */
  async durumSorgula(cfg: EntegratorConfig, belgeRef: string): Promise<BelgeDurumSonuc> {
    if (belgeRef.startsWith(EARSIV_ONEKI)) {
      const uuid = belgeRef.slice(EARSIV_ONEKI.length);
      const fatura = await this.cagir<{ archiveDocumentStatus?: string; isCanceled?: boolean; cancelDate?: string; reportDivisionStatus?: string }>(
        cfg,
        "earchive",
        `/v1/invoices/${encodeURIComponent(uuid)}`,
      );
      // Durum alanı `archiveDocumentStatus`; `recordStatus` diye bir alan
      // yanıtta yok (2026-09-10 canlı yanıtla ölçüldü) — onu okumak her
      // belgeyi "iletildi" göstermek demekti.
      const kayit = fatura?.archiveDocumentStatus;
      const durum =
        kayit === "Error" || kayit === "XmlParseError" || kayit === "XmlFileDoesNotExist"
          ? "hata"
          : kayit === "Waiting" || kayit === "WaitingSign"
            ? "kuyrukta"
            : "iletildi";
      // e-Arşiv'de alıcı kabul/ret akışı yoktur; belge imzalandıysa GİB'e
      // raporlanmak üzere iletilmiş sayılır. İptal ayrı bir eksende
      // (`isCanceled`) durur; servis `iptalEdilmis` ile kaydı iptal yapar,
      // tarih görünür olsun diye ayrıntıya yazılır.
      const iptal = fatura?.isCanceled
        ? `Belge NES'te iptal edilmiş${fatura.cancelDate ? ` (${fatura.cancelDate})` : ""}`
        : undefined;
      // `reportDivisionStatus` belgenin GİB raporu yolculuğu:
      // None → XmlCreateWait → XmlCreated → XmlSigned → Query → Completed.
      // `Completed` olan belge GİB'e raporlanmıştır.
      return {
        belgeRef,
        durum,
        detay: iptal,
        raporlandi: fatura?.reportDivisionStatus === "Completed",
        iptalEdilmis: Boolean(fatura?.isCanceled),
      };
    }
    const fatura = await this.cagir<{
      outgoingStatus?: string;
      documentAnswer?: string;
      outgoingEnvelope?: { description?: string };
      incomingAnswer?: { answerNote?: string; errorDescription?: string };
    }>(cfg, "einvoice", `/v1/outgoing/invoices/${encodeURIComponent(belgeRef)}`);
    const durum = nesBelgeDurumu(fatura?.outgoingStatus, fatura?.documentAnswer);
    return {
      belgeRef,
      durum,
      // Retteki açıklama alıcının notu olarak saklanır; not yoksa zarf
      // açıklamasına ("BASARIYLA TAMAMLANDI") düşülürse ret gerekçesi diye
      // o görünür.
      detay:
        durum === "ret"
          ? fatura?.incomingAnswer?.answerNote
          : fatura?.incomingAnswer?.errorDescription || fatura?.outgoingEnvelope?.description,
    };
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
        const yanit = nesGelenYanit(satir);
        belgeler.push({
          uuid: satir.id,
          belgeNo: satir.documentNumber ?? satir.id,
          gonderenVkn,
          gonderenUnvan: gonderenUnvani(satir.accountingSupplierParty, gonderenVkn),
          tarih: new Date(satir.issueDate ?? satir.createdAt ?? Date.now()),
          xml,
          ...(yanit ? { yanit } : {}),
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
      const liste = await this.cagir<{ data?: { id?: string; documentNumber?: string }[] }>(cfg, "earchive", "/v1/invoices", {
        sorgu: { documentNumber: girdi.faturaNo, page: 1, pageSize: 2 },
      });
      // İptal geri alınamaz: dönen kaydın numarası sorduğumuzla birebir
      // eşleşmedikçe iptal edilmez. `documentNumber` filtresi NES'te çalışıyor
      // (2026-09-10 ölçüldü) ama `uuid` filtresi çözümleyemediğinde sessizce
      // tüm listeyi döndürüyor; aynı sürprizin bedeli burada başkasının
      // faturasını iptal etmek olurdu (EBLG-17'nin aynı dersi).
      const uuid = liste?.data?.find((satir) => satir.id && satir.documentNumber === girdi.faturaNo)?.id;
      // NES iptal edilmiş belgeyi bu listede döndürmüyor, dolayısıyla boş yanıt
      // "böyle bir belge yok" ile "zaten iptal edilmiş"i ayırt etmiyor; mesaj
      // ikisini de söylüyor. Çağıran ayrımı tekil durum sorgusundan yapar.
      if (!uuid) {
        return {
          basarili: false,
          mesaj: `${girdi.faturaNo} numaralı e-Arşiv faturası NES'te iptal edilebilir belgeler arasında yok; belge hiç oluşmamış ya da daha önce iptal edilmiş olabilir`,
        };
      }
      await this.cagir(cfg, "earchive", "/v1/invoices/cancel", { metot: "POST", govde: { uuids: [uuid] } });
      return { basarili: true, mesaj: "e-Arşiv iptali NES'e bildirildi" };
    } catch (hata) {
      return { basarili: false, mesaj: hata instanceof Error ? hata.message : "e-Arşiv iptali gönderilemedi" };
    }
  }

  /**
   * e-Arşiv raporlarını ay ay listeler (EBLG-07). NES rapor bölümü belge ve
   * iptal sayısını verir ama tutar vermez; tutar `null` döner ve istenirse
   * bölümün dökümünden hesaplanır (`earsivRaporTutari`). Liste her bölüm için
   * döküm çağırmaz: aylık listede ~30 ek çağrı demek, NES'in çağrı sınırı da
   * belgelenmemiş.
   */
  async earsivRaporListele(cfg: EntegratorConfig, baslangic: Date, bitis: Date): Promise<EarsivRapor[]> {
    const raporlar: EarsivRapor[] = [];
    const imlec = new Date(Date.UTC(baslangic.getUTCFullYear(), baslangic.getUTCMonth(), 1));
    const son = new Date(Date.UTC(bitis.getUTCFullYear(), bitis.getUTCMonth(), 1));
    while (imlec <= son) {
      const yil = imlec.getUTCFullYear();
      const ay = imlec.getUTCMonth() + 1;
      const bolumler = await this.cagir<
        { id?: string; startDate?: string; endDate?: string; eArchiveInvoiceCount?: number; eArchiveInvoiceCanceledCount?: number; status?: string }[]
      >(cfg, "general", `/v1/earchivedocumentsreport/${yil}/${ay}`);
      for (const bolum of bolumler ?? []) {
        if (!bolum.id) continue;
        raporlar.push({
          uuid: bolum.id,
          donem: `${yil}-${String(ay).padStart(2, "0")}`,
          baslangic: (bolum.startDate ?? "").slice(0, 10),
          bitis: (bolum.endDate ?? "").slice(0, 10),
          faturaSayisi: bolum.eArchiveInvoiceCount ?? 0,
          iptalSayisi: bolum.eArchiveInvoiceCanceledCount ?? 0,
          toplamTutar: null,
          gibDurumu: bolum.status ?? "",
        });
      }
      imlec.setUTCMonth(imlec.getUTCMonth() + 1);
    }
    return raporlar;
  }

  /**
   * Bir rapor bölümünün GİB'e bildirilen tutarı, bölümün belge dökümünden
   * (`/earchivedocumentsreport/{id}/details`). Ekran bunu satır bazında ister.
   */
  async earsivRaporTutari(cfg: EntegratorConfig, uuid: string): Promise<EarsivRaporTutari> {
    const satirlar = await this.cagir<NesRaporDokumSatiri[]>(
      cfg,
      "general",
      `/v1/earchivedocumentsreport/${encodeURIComponent(uuid)}/details`,
    );
    return earsivRaporTutariOzetle(uuid, satirlar ?? []);
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

  /**
   * EBLG-36: giden e-İrsaliyenin durumu iki kaynaktan okunur. Zarfın GİB
   * yolculuğu `outgoingStatus`'tadır. Alıcının kararı ayrı bir belgedir
   * (irsaliye yanıtı / ReceiptAdvice): `despatchAnswer` yalnız yanıtın gelip
   * gelmediğini söyler (None/Waiting/Answered), kabul/ret alanı yoktur; karar
   * yanıt XML'indeki satır miktarlarından çıkarılır. Önceki kod faturadaki
   * `documentAnswer` alanını okuyordu — irsaliyede bu alan yok, karar hiç
   * görünmüyordu; ayrıca GİB hatası `iletildi` kalıyordu (2026-09-14 canlı
   * yanıtla ölçüldü).
   *
   * Çağrı hatası `hata` durumuna çevrilmez, fırlatılır: `hata` son durumdur ve
   * geçici bir NES kesintisi irsaliyeyi kalıcı olarak hatalı gösterirdi.
   */
  async irsaliyeDurumSorgula(
    cfg: EntegratorConfig,
    belgeRef: string,
  ): Promise<Omit<BelgeDurumSonuc, "durum"> & { durum: BelgeDurum | "kismi_kabul" }> {
    const irsaliye = await this.cagir<{
      outgoingStatus?: string;
      despatchAnswer?: string;
      outgoingEnvelope?: { description?: string };
      errorDescription?: string;
    }>(cfg, "edespatch", `/v1/outgoing/despatches/${encodeURIComponent(belgeRef)}`);
    const zarf = nesBelgeDurumu(irsaliye?.outgoingStatus);
    if (zarf === "hata") {
      return { belgeRef, durum: "hata", detay: irsaliye?.outgoingEnvelope?.description || irsaliye?.errorDescription };
    }

    if (irsaliye?.despatchAnswer === "Answered") {
      const liste = await this.cagir<{ data?: { id?: string; outgoingDespatch?: { id?: string } }[] }>(
        cfg,
        "edespatch",
        "/v1/incoming/receiptadvices",
        { sorgu: { despatchUuid: belgeRef, page: 1, pageSize: 10 } },
      );
      // NES çözümleyemediği filtreyi sessizce yok sayabiliyor (bkz. `belgeAra`);
      // yanıtın bu irsaliyeye ait olduğu ayrıca doğrulanır.
      const yanitBelgesi = liste?.data?.find((s) => s.outgoingDespatch?.id?.toLowerCase() === belgeRef.toLowerCase());
      if (yanitBelgesi?.id) {
        const xml = await this.cagir<string>(
          cfg,
          "edespatch",
          `/v1/incoming/receiptadvices/${encodeURIComponent(yanitBelgesi.id)}/xml`,
          { metin: true },
        );
        const karar = irsaliyeYanitiKarari(xml);
        if (karar) return { belgeRef, ...karar };
      }
    }
    return { belgeRef, durum: zarf };
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
        // NES gelen irsaliyede göndereni `despatchSupplierParty` altında
        // veriyor; fatura akışındaki adı arayınca gönderen boş kaydediliyordu
        // (2026-09-10). Fatura adı yedek olarak duruyor.
        const gonderen = satir.despatchSupplierParty ?? satir.accountingSupplierParty;
        const gonderenVkn = gonderen?.partyIdentification ?? "";
        const yanit = nesGelenYanit(satir);
        irsaliyeler.push({
          uuid: satir.id,
          belgeNo: satir.documentNumber ?? satir.id,
          gonderenVkn,
          gonderenUnvan: gonderenUnvani(gonderen, gonderenVkn),
          tarih: new Date(satir.issueDate ?? satir.createdAt ?? Date.now()),
          xml,
          ...(yanit ? { yanit } : {}),
        });
      }
      if (satirlar.length < SAYFA_BOYUTU) break;
    }
    return irsaliyeler;
  }

  /**
   * EBLG-34: gelen faturaya verilmiş karar. Tekil yanıtta karar kök düzeyde
   * değil `outgoingAnswer.documentAnswer` içinde döner (2026-09-13 ölçüldü).
   */
  async gelenYanitDurumu(cfg: EntegratorConfig, belgeRef: string): Promise<GelenYanit | null> {
    const belge = await this.cagir<GelenSatir>(cfg, "einvoice", `/v1/incoming/invoices/${encodeURIComponent(belgeRef)}`);
    return (belge && nesGelenYanit(belge)) ?? null;
  }

  /** EBLG-34: gelen e-İrsaliyeye verilmiş karar (`despatchAnswer`). */
  async gelenIrsaliyeYanitDurumu(cfg: EntegratorConfig, belgeRef: string): Promise<GelenYanit | null> {
    const belge = await this.cagir<GelenSatir>(cfg, "edespatch", `/v1/incoming/despatches/${encodeURIComponent(belgeRef)}`);
    return (belge && nesGelenYanit(belge)) ?? null;
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
    gerekce: string | undefined,
    kaynakXml: string,
  ): Promise<GonderimSonuc> {
    try {
      if (!cfg.eirsaliyeYanitSeriOneki) {
        return { basarili: false, hataMesaji: "e-İrsaliye yanıt serisi tanımlı değil; Ayarlar > Entegratörler ekranından yanıt seri önekini girin" };
      }
      const receipt = receiptAdviceXml(belgeRef, yanit, gerekce, kaynakXml, cfg.eirsaliyeYanitSeriOneki);
      const form = new FormData();
      form.set("File", new Blob([receipt.xml], { type: "application/xml" }), `${receipt.uuid}.xml`);
      form.set("AnswerType", yanit === "kabul" ? "AllAccepted" : "AllRejected");
      const sonuc = await this.cagir<{ uuid?: string; documentNumber?: string }>(
        cfg,
        "edespatch",
        `/v1/incoming/despatches/${encodeURIComponent(belgeRef)}/receiptadvice`,
        { metot: "POST", govde: form },
      );
      return { basarili: true, belgeRef: sonuc?.uuid ?? receipt.uuid, belgeNo: sonuc?.documentNumber };
    } catch (hata) {
      return { basarili: false, hataMesaji: hata instanceof Error ? hata.message : "İrsaliye yanıtı gönderilemedi" };
    }
  }
}
