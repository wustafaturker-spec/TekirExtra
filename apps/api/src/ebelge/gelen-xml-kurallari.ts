import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/** Gelen e-Fatura XML'inin depo biçimi; servis ve taşıma betiği aynı kuralları kullanır. */
const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

export interface GelenXmlKaydi { xmlIcerik: string | null; xmlAnahtar: string | null; xmlOzet: string | null }

/** UUID entegratörden gelir; anahtara özeti yazılır ki depo yolunu etkileyemesin. */
export const gelenXmlAnahtari = (tenantId: string, uuid: string) => `${tenantId}/gelen-ebelge/${sha256(uuid)}.xml.gz`;
export const gelenXmlOzeti = (xml: string) => sha256(xml);
export const gelenXmlSikistir = (xml: string) => gzipSync(Buffer.from(xml, "utf8"));

/** Depodan gelen içerik kayıttaki özetle eşleşmezse okunmaz: yasal belge sessizce bozulmamalı. */
export function gelenXmlAc(veri: Buffer, ozet: string): string {
  const xml = gunzipSync(veri).toString("utf8");
  if (gelenXmlOzeti(xml) !== ozet) throw new Error("Gelen belge XML'i depodaki özetle eşleşmiyor");
  return xml;
}
