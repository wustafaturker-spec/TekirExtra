import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * SEC-23: POS makbuzu açık bağlantı anahtarı. Saklanmaz; firma ve tahsilat
 * kimliğinden makbuza özel bir sırla türetilir. Böylece bağlantı kalıcıdır
 * (müşteri saklayabilir, personel ekranı yeniden kurar) ve veritabanı tek
 * başına bağlantı üretmeye yetmez.
 *
 * Sırlar sürümlüdür: `MAKBUZ_ANAHTAR_SIRLARI="v2:<hex>,v1:<hex>"`. Yeni
 * bağlantı ilk (en yeni) sürümle `v2.<hmac>` biçiminde üretilir; doğrulama
 * bağlantıdaki sürümün sırrıyla yapılır. Sır yenilerken yenisi başa eklenir,
 * eskisi listede kaldıkça eski bağlantılar çalışır. Bu sır şifreleme
 * anahtarından (`BAGLANTI_SIFRELEME_ANAHTARI`) bağımsızdır; onun yenilenmesi
 * makbuzları etkilemez.
 *
 * Geçiş: 2026-11-15 sürümü sürüm öneki taşımayan (64 hex) anahtar üretti; bunlar
 * `v1` sırrıyla doğrulanır. 2026-11-15 öncesi rastgele anahtarlar saklanan
 * özetle doğrulanır.
 */
export interface MakbuzSirri { surum: string; sir: Buffer }

const SURUM = /^v[1-9]\d{0,3}$/;

export function makbuzSirlariniOku(ortam: Record<string, string | undefined> = process.env): MakbuzSirri[] {
  const ham = ortam.MAKBUZ_ANAHTAR_SIRLARI?.trim();
  if (!ham) {
    // Yalnız geliştirme/test: ayrı sır yoksa 2026-11-15 davranışı (v1 = şifreleme anahtarı).
    // Üretimde açılış denetimi (uretim-sirlari.ts) bu durumda süreci başlatmaz.
    const eski = ortam.BAGLANTI_SIFRELEME_ANAHTARI?.trim();
    if (!eski || !/^[0-9a-fA-F]{64}$/.test(eski)) throw new Error("MAKBUZ_ANAHTAR_SIRLARI tanımlı değil");
    return [{ surum: "v1", sir: Buffer.from(eski, "hex") }];
  }
  const sirlar = ham.split(",").map((parca) => {
    const [surum, deger, ...fazla] = parca.trim().split(":");
    if (fazla.length || !SURUM.test(surum ?? "") || !/^[0-9a-fA-F]{64,}$/.test(deger ?? "") || /^(.)\1*$/.test(deger!))
      throw new Error("MAKBUZ_ANAHTAR_SIRLARI biçimi geçersiz: \"v2:<en az 64 hex>,v1:<en az 64 hex>\" (değer gösterilmez)");
    return { surum: surum!, sir: Buffer.from(deger!, "hex") };
  });
  if (new Set(sirlar.map((s) => s.surum)).size !== sirlar.length) throw new Error("MAKBUZ_ANAHTAR_SIRLARI içinde aynı sürüm iki kez var");
  return sirlar;
}

const hmac = (s: MakbuzSirri, tenantId: string, tahsilatId: string) =>
  createHmac("sha256", s.sir).update(`pos-makbuz-${s.surum}:${tenantId}:${tahsilatId}`).digest("hex");

/** Yeni bağlantının anahtarı: en yeni sürüm, `v2.<hmac>`. */
export function makbuzAnahtari(tenantId: string, tahsilatId: string, sirlar = makbuzSirlariniOku()): string {
  const s = sirlar[0]!;
  return `${s.surum}.${hmac(s, tenantId, tahsilatId)}`;
}

export const anahtarOzeti = (anahtar: string) => createHash("sha256").update(anahtar, "utf8").digest("hex");

const esit = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function makbuzAnahtariGecerli(tenantId: string, tahsilatId: string, verilen: string, eskiOzet: string | null, sirlar = makbuzSirlariniOku()): boolean {
  const surumlu = /^(v[1-9]\d{0,3})\.([0-9a-f]{64})$/.exec(verilen);
  if (surumlu) {
    const s = sirlar.find((x) => x.surum === surumlu[1]);
    return Boolean(s) && esit(surumlu[2]!, hmac(s!, tenantId, tahsilatId));
  }
  if (!/^[0-9a-f]{64}$/.test(verilen)) return false;
  // 2026-11-15 sürümünün öneksiz anahtarı (v1) ya da daha eski rastgele anahtarın özeti.
  const v1 = sirlar.find((x) => x.surum === "v1");
  if (v1 && esit(verilen, hmac(v1, tenantId, tahsilatId))) return true;
  return eskiOzet !== null && esit(anahtarOzeti(verilen), eskiOzet);
}

export const makbuzYolu = (tenantId: string, tahsilatId: string) => `/pos/makbuz/${tenantId}/${tahsilatId}/${makbuzAnahtari(tenantId, tahsilatId)}`;
