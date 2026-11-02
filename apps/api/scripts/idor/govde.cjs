"use strict";
/** Doğrulama şemasından (JSON Schema) geçerli istek gövdesi üretir; kimlik alanları tohum satırlarından gelir. */
const { randomUUID } = require("node:crypto");

function govdeUretici(satirlar, kisaca) {
  const adlar = Object.keys(satirlar.B);
  const TAKMA = { cari: "CariHesap", tedarikci: "CariHesap", musteri: "CariHesap", bayi: "CariHesap", stok: "StokKart", urun: "StokKart", kullanici: "User", user: "User", sorumlu: "User", atanan: "User", kasa: "KasaHesap", bankahesap: "BankaHesap", banka: "BankaHesap", fatura: "Fatura", depo: "Depo" };
  const model = (alan, yol = "") => {
    const y = alan.replace(/(Idleri|Idler|Ids|Id)$/, "").toLowerCase();
    if (TAKMA[y] && satirlar.B[TAKMA[y]]) return TAKMA[y];
    if (kisaca[y] && satirlar.B[kisaca[y]]) return kisaca[y];
    const parca = yol.split("/").filter((x) => x && !x.startsWith(":") && x !== "api" && x !== "v1").map((x) => x.replace(/-/g, "").replace(/(ler|lar)$/, ""));
    const icerenler = y.length > 2 ? adlar.filter((m) => m.toLowerCase().includes(y)) : [];
    return icerenler.find((m) => parca.some((c) => m.toLowerCase().startsWith(c.slice(0, 5)))) ?? icerenler[0] ?? "CariHesap";
  };
  const kimlikAlani = (s, ad) => s?.format === "uuid" || (s?.type === "string" && /(Id|Idleri|Idler|Ids)$/.test(ad)) || (!s?.type && /(Id|Idleri|Idler|Ids)$/.test(ad));
  /** Şemadaki kimlik alanı yolları. */
  const kimlikYollari = (s, ad, yol, cikti, derin = 0) => {
    if (!s || derin > 7) return cikti;
    for (const k of ["anyOf", "oneOf", "allOf"]) if (s[k]) { const x = s[k].find((v) => v.type !== "null") ?? s[k][0]; return kimlikYollari(x, ad, yol, cikti, derin + 1); }
    if (s.type === "object" || s.properties) for (const [k, v] of Object.entries(s.properties ?? {})) kimlikYollari(v, k, `${yol}.${k}`, cikti, derin + 1);
    else if (s.type === "array") kimlikYollari(s.items, ad, `${yol}[]`, cikti, derin + 1);
    else if (kimlikAlani(s, ad)) cikti.push({ yol, ad });
    return cikti;
  };
  const uret = (s, ad, yol, hedef, harf, rota, derin = 0) => {
    if (!s || derin > 7) return undefined;
    if (kimlikAlani(s, ad)) return satirlar[yol === hedef ? harf : "A"][model(ad, rota)]?.id ?? satirlar[yol === hedef ? harf : "A"].CariHesap?.id;
    if (/tarih|vade|baslangic|bitis|^donem$/i.test(ad) && (!s.type || s.type === "string")) return /^donem$/i.test(ad) ? "2026-06" : "2026-06-15";
    if (/tutar|miktar|fiyat|bedel|kur$|oran|maliyet|deger|matrah/i.test(ad) && (!s.type || s.type === "string")) return "100";
    if (!s.type && !s.anyOf && !s.oneOf && !s.allOf && !s.enum && s.const === undefined && !s.properties) return "1";
    if (s.default !== undefined) return s.default;
    if (s.const !== undefined) return s.const;
    if (s.enum) return s.enum[0];
    for (const k of ["anyOf", "oneOf"]) if (s[k]) return uret(s[k].find((x) => x.type !== "null") ?? s[k][0], ad, yol, hedef, harf, rota, derin + 1);
    if (s.allOf) return uret(s.allOf[0], ad, yol, hedef, harf, rota, derin + 1);
    if (s.type === "object" || s.properties) {
      const c = {};
      for (const [k, v] of Object.entries(s.properties ?? {})) {
        const alt = `${yol}.${k}`;
        // Zorunlu alan her zaman; isteğe bağlı alan yalnız hedefe giden yoldaysa.
        if ((s.required ?? []).includes(k) || hedef === alt || hedef.startsWith(`${alt}.`) || hedef.startsWith(`${alt}[`)) { const d = uret(v, k, alt, hedef, harf, rota, derin + 1); if (d !== undefined) c[k] = d; }
      }
      return c;
    }
    if (s.type === "array") { const d = uret(s.items, ad, `${yol}[]`, hedef, harf, rota, derin + 1); return d === undefined ? [] : Array.from({ length: Math.max(1, s.minItems ?? 1) }, () => d); }
    if (s.type === "number" || s.type === "integer") { const a = s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 1); return s.maximum !== undefined ? Math.min(a, s.maximum) : a; }
    if (s.type === "boolean") return true;
    if (s.type === "string") {
      const hex = s.pattern?.match(/^\^\[a-f0-9\]\{(\d+)\}\$$/);
      if (hex) return "a".repeat(Number(hex[1]));
      if (s.format === "date-time") return "2026-06-15T10:00:00.000Z";
      if (s.format === "date") return "2026-06-15";
      if (s.format === "email") return "idor.govde@ornek.invalid";
      if (s.pattern && /\\d\{4\}-/.test(s.pattern)) return "2026-06-15";
      if (s.pattern && /\\d/.test(s.pattern) && !/[a-z]/i.test(s.pattern)) return "1234567890".slice(0, s.maxLength ?? 10);
      const m = `IDORA_${randomUUID().slice(0, 6)}`;
      return (s.minLength ?? 0) > m.length ? m.padEnd(s.minLength, "x") : m.slice(0, s.maxLength ?? 200);
    }
    return undefined;
  };
  return { model, kimlikYollari, uret };
}
module.exports = { govdeUretici };
