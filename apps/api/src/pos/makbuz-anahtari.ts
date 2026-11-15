import { createHash, timingSafeEqual } from "node:crypto";
import { turetilmisAnahtar } from "../core/kripto";

/**
 * SEC-23: POS makbuzu açık bağlantı anahtarı. Saklanmaz; firma ve tahsilat
 * kimliğinden sunucu sırrıyla türetilir, böylece bağlantı kalıcıdır (müşteri
 * saklayabilir, personel ekranı yeniden kurabilir) ve veritabanında anahtar
 * yoktur. 2026-11-15 öncesi bağlantılar saklanan özetle doğrulanır.
 */
export function makbuzAnahtari(tenantId: string, tahsilatId: string): string {
  return turetilmisAnahtar("pos-makbuz-v1", tenantId, tahsilatId);
}

export const anahtarOzeti = (anahtar: string) => createHash("sha256").update(anahtar, "utf8").digest("hex");

const esit = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function makbuzAnahtariGecerli(tenantId: string, tahsilatId: string, verilen: string, eskiOzet: string | null): boolean {
  if (!/^[0-9a-f]{64}$/.test(verilen)) return false;
  if (esit(verilen, makbuzAnahtari(tenantId, tahsilatId))) return true;
  return eskiOzet !== null && esit(anahtarOzeti(verilen), eskiOzet);
}

export const makbuzYolu = (tenantId: string, tahsilatId: string) => `/pos/makbuz/${tenantId}/${tahsilatId}/${makbuzAnahtari(tenantId, tahsilatId)}`;
