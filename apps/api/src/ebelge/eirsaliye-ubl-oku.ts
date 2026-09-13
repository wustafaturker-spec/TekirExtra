/**
 * UBL-TR gelen e-İrsaliye (DespatchAdvice) okuyucu. Detay ekranı ve yedek PDF
 * görünümü (EBLG-33) aynı alanları buradan okur. Ayrıştırma tolere edicidir:
 * gerçek belgeler şemadan sapabildiği için eksik alan boş metne düşer.
 */
import { XMLParser } from "fast-xml-parser";
import { birimAdi } from "./ubl-oku";

export interface UblIrsaliyeTaraf {
  vknTckn: string;
  unvan: string;
  adres: string;
}

export interface UblIrsaliyeSatir {
  sira: string;
  stokKodu: string;
  ad: string;
  miktar: string;
  /** UBL birim kodu (C62, KGM…). */
  birim: string;
  birimAdi: string;
  aciklama: string;
}

export interface UblIrsaliye {
  uuid: string;
  belgeNo: string;
  tarih: string;
  saat: string;
  profilId: string;
  tipKodu: string;
  gonderen: UblIrsaliyeTaraf;
  alici: UblIrsaliyeTaraf;
  sevkTarihi: string;
  sevkSaati: string;
  teslimatAdresi: string;
  tasiyici: { vknTckn: string; unvan: string } | null;
  plaka: string;
  dorsePlaka: string;
  sofor: string;
  notlar: string[];
  satirlar: UblIrsaliyeSatir[];
}

export class IrsaliyeUblOkumaHatasi extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

type Dugum = Record<string, unknown>;

const nesne = (d: unknown): Dugum | undefined =>
  d !== null && typeof d === "object" && !Array.isArray(d) ? (d as Dugum) : undefined;

const dizi = (d: unknown): Dugum[] => {
  if (d === undefined || d === null) return [];
  if (Array.isArray(d)) return d.filter((x) => nesne(x) !== undefined) as Dugum[];
  const n = nesne(d);
  return n ? [n] : [];
};

const metin = (d: unknown): string => {
  if (d === undefined || d === null) return "";
  if (typeof d === "string") return d.trim();
  if (typeof d === "number") return String(d);
  const n = nesne(d);
  return n && "#text" in n ? String(n["#text"] ?? "").trim() : "";
};

/** Yol boyunca ilk düğümü izler; ara adımda dizi varsa ilk elemanı alır. */
function yol(kok: unknown, ...adlar: string[]): unknown {
  let mevcut: unknown = kok;
  for (const ad of adlar) {
    if (Array.isArray(mevcut)) mevcut = mevcut[0];
    const n = nesne(mevcut);
    if (!n) return undefined;
    mevcut = n[ad];
  }
  return mevcut;
}

function kimlik(party: unknown): string {
  const kimlikler = dizi(yol(party, "PartyIdentification"));
  for (const k of kimlikler) {
    const sema = String(nesne(k.ID)?.["@_schemeID"] ?? "").toUpperCase();
    if (sema === "VKN" || sema === "TCKN") return metin(k.ID);
  }
  return kimlikler.length > 0 ? metin(kimlikler[0].ID) : "";
}

function adresMetni(adres: unknown): string {
  return [
    metin(yol(adres, "StreetName")),
    metin(yol(adres, "BuildingNumber")),
    metin(yol(adres, "CitySubdivisionName")),
    metin(yol(adres, "CityName")),
  ]
    .filter(Boolean)
    .join(" ");
}

function taraf(party: unknown): UblIrsaliyeTaraf {
  const unvan =
    metin(yol(party, "PartyName", "Name")) ||
    [metin(yol(party, "Person", "FirstName")), metin(yol(party, "Person", "FamilyName"))].filter(Boolean).join(" ");
  return { vknTckn: kimlik(party), unvan, adres: adresMetni(yol(party, "PostalAddress")) };
}

export function irsaliyeUblOku(xml: string): UblIrsaliye {
  let kok: Dugum | undefined;
  try {
    kok = nesne(parser.parse(xml));
  } catch (hata) {
    throw new IrsaliyeUblOkumaHatasi(`XML ayrıştırılamadı: ${hata instanceof Error ? hata.message : "bilinmeyen hata"}`);
  }
  const belge = nesne(kok?.DespatchAdvice);
  if (!belge) throw new IrsaliyeUblOkumaHatasi("Belgede UBL DespatchAdvice kökü bulunamadı");

  // UBL-TR teslimat ve fiili sevk bilgisini Shipment/Delivery altında taşır;
  // eski ya da şemadan sapan belgeler için kök düzeydeki alanlar yedektir.
  const teslimat = yol(belge, "Shipment", "Delivery") ?? belge.Delivery;
  const sevk = yol(teslimat, "Despatch");
  const asama = yol(belge, "Shipment", "ShipmentStage");
  const tasiyiciParty = yol(teslimat, "CarrierParty");
  const tasiyici = tasiyiciParty ? taraf(tasiyiciParty) : null;
  const sofor = [metin(yol(asama, "DriverPerson", "FirstName")), metin(yol(asama, "DriverPerson", "FamilyName"))]
    .filter(Boolean)
    .join(" ");

  return {
    uuid: metin(belge.UUID),
    belgeNo: metin(belge.ID),
    tarih: metin(belge.IssueDate),
    saat: metin(belge.IssueTime),
    profilId: metin(belge.ProfileID),
    tipKodu: metin(belge.DespatchAdviceTypeCode),
    gonderen: taraf(yol(belge, "DespatchSupplierParty", "Party")),
    alici: taraf(yol(belge, "DeliveryCustomerParty", "Party")),
    sevkTarihi: metin(yol(sevk, "ActualDespatchDate")) || metin(belge.ActualDespatchDate) || metin(belge.IssueDate),
    sevkSaati: metin(yol(sevk, "ActualDespatchTime")) || metin(belge.ActualDespatchTime) || metin(belge.IssueTime),
    teslimatAdresi: adresMetni(yol(teslimat, "DeliveryAddress") ?? yol(teslimat, "DeliveryLocation", "Address")),
    tasiyici: tasiyici && (tasiyici.vknTckn || tasiyici.unvan) ? { vknTckn: tasiyici.vknTckn, unvan: tasiyici.unvan } : null,
    plaka: metin(yol(asama, "TransportMeans", "RoadTransport", "LicensePlateID")),
    dorsePlaka: metin(yol(belge, "Shipment", "TransportHandlingUnit", "TransportEquipment", "ID")),
    sofor,
    notlar: dizi(belge.Note).map(metin).concat(
      (Array.isArray(belge.Note) ? belge.Note : [belge.Note]).filter((n): n is string => typeof n === "string").map((n) => n.trim()),
    ).filter(Boolean),
    satirlar: dizi(belge.DespatchLine).map((s, i) => {
      const birim = String(nesne(s.DeliveredQuantity)?.["@_unitCode"] ?? "");
      return {
        sira: metin(s.ID) || String(i + 1),
        stokKodu: metin(yol(s, "Item", "SellersItemIdentification", "ID")) || metin(yol(s, "Item", "ManufacturersItemIdentification", "ID")),
        ad: metin(yol(s, "Item", "Name")) || metin(yol(s, "Item", "Description")) || "İsimsiz ürün",
        miktar: metin(s.DeliveredQuantity),
        birim,
        birimAdi: birimAdi(birim),
        aciklama: metin(s.Note),
      };
    }),
  };
}
