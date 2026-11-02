"use strict";
/* IDOR taraması: A kiracısının token'ıyla B kiracısının kimlikleri denenir. Ayrıntı: docs/GUVENLIK-IDOR-TARAMASI.md */
const { randomUUID, createHmac } = require("node:crypto");
const { writeFileSync, readFileSync } = require("node:fs");
const { PrismaClient } = require("@prisma/client");
const { olustur } = require("./tohum.cjs");

const API = process.env.API, RAPOR = process.env.RAPOR, SIR = process.env.JWT_SECRET, ASAMA = process.env.IDOR_ASAMA;
const prisma = new PrismaClient({ datasourceUrl: process.env.SUPER_URL });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function imzala(sub, tenantId) {
  const govde = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, tenantId, rol: "yonetici", sv: 0, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 })}`;
  return `${govde}.${createHmac("sha256", SIR).update(govde).digest("base64url")}`;
}
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const kisalt = (s) => s.replace(/\s+/g, " ").slice(0, 400);

async function main() {
  const baslangic = Date.now();
  const { satirlar, hatalar, kiracili, modeller } = await olustur(prisma).tohumla();
  const say = (h) => Object.keys(satirlar[h]).length;
  console.log(`Tohum: A=${say("A")} B=${say("B")} model, tohumlanamayan ${Object.keys(hatalar).length}`);
  await prisma.$executeRawUnsafe(`INSERT INTO auth_kimlikler (eposta, tenant_id, user_id) SELECT eposta, tenant_id, id FROM users ON CONFLICT DO NOTHING`).catch(() => undefined);

  const A = { t: satirlar.A.Tenant.id, u: satirlar.A.User.id }, B = { t: satirlar.B.Tenant.id, u: satirlar.B.User.id };
  const tokenA = imzala(A.u, A.t);
  const bKimlikler = new Map(), aKarsilik = new Map();
  for (const [ad, r] of Object.entries(satirlar.B)) if (r.id && typeof r.id === "string") { bKimlikler.set(r.id, ad); const a = satirlar.A[ad]; if (a?.id) aKarsilik.set(r.id, a.id); }
  const adaylar = [...bKimlikler.keys()];
  const rotalar = JSON.parse(readFileSync(`${RAPOR}/rotalar.json`, "utf8")).filter((r) => r.yol.startsWith("/api/v1") && r.yontem !== "ALL");

  const kisaca = {}; // param adı → model
  for (const m of modeller) kisaca[m.name.toLowerCase()] = m.name;
  const adaySec = (param) => {
    const yalin = param.replace(/Id$/, "").toLowerCase();
    if (/^(tenant|firma|kiraci)(id)?$/i.test(param)) return [B.t];
    if (/(^id$|id$)/i.test(param)) { if (kisaca[yalin] && satirlar.B[kisaca[yalin]]) return [satirlar.B[kisaca[yalin]].id]; return adaylar; }
    const degerler = new Set();
    for (const r of Object.values(satirlar.B)) if (typeof r[param] === "string") degerler.add(r[param]);
    return degerler.size ? [...degerler].slice(0, 25) : /yil/i.test(param) ? ["2026"] : /ay$/i.test(param) ? ["1"] : ["idor"];
  };
  const yolKur = (yol, d) => yol.replace(/:([A-Za-z0-9_]+)/g, (_, p) => encodeURIComponent(d[p]));
  const paramlar = (yol) => [...yol.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  function birlesimler(yol, sinir = 400) {
    const ps = paramlar(yol);
    if (!ps.length) return [{}];
    const listeler = ps.map(adaySec);
    const toplam = listeler.reduce((a, l) => a * l.length, 1);
    const cikti = [];
    if (toplam <= sinir) { const dolas = (i, o) => { if (i === ps.length) return cikti.push(o); for (const v of listeler[i]) dolas(i + 1, { ...o, [ps[i]]: v }); }; dolas(0, {}); return cikti; }
    for (let i = 0; i < sinir; i++) cikti.push(Object.fromEntries(ps.map((p, j) => [p, listeler[j][Math.floor(Math.random() * listeler[j].length)]])));
    return cikti;
  }
  const aDegeri = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === B.t ? A.t : aKarsilik.get(v) ?? v]));
  const rastgele = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, /^[0-9a-f-]{36}$/i.test(String(v)) ? randomUUID() : v]));

  let istekSayisi = 0, kanarya = 0;
  const istek = async (yontem, yol, { sorgu = "", govde } = {}) => {
    istekSayisi++;
    try {
      const y = await fetch(`${API}${yol}${sorgu}`, { method: yontem, redirect: "manual", signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json", "idempotency-key": randomUUID(), "x-tekir-istek": "1" }, body: yontem === "GET" || yontem === "HEAD" ? undefined : JSON.stringify(govde ?? {}) });
      const metin = Buffer.from(await y.arrayBuffer()).toString("latin1");
      return { durum: y.status, metin };
    } catch (e) { return { durum: 0, metin: String(e.name) }; }
  };
  const sizinti = (ham, gonderilen, degerler = []) => {
    // API'nin hata mesajında geri yazdığı istek değeri sızıntı değildir.
    let metin = ham;
    for (const v of degerler) metin = metin.split(String(v)).join("").split(encodeURIComponent(String(v))).join("");
    const bulgu = [];
    if (metin.includes("IDORB")) bulgu.push(`işaret: ${kisalt(metin.slice(Math.max(0, metin.indexOf("IDORB") - 60), metin.indexOf("IDORB") + 80))}`);
    for (const m of metin.match(UUID) ?? []) { const k = m.toLowerCase(); if (bKimlikler.has(k) && !gonderilen.includes(k)) bulgu.push(`kimlik: ${bKimlikler.get(k)} ${k}`); }
    return bulgu;
  };
  const kurtar = async () => {
    await prisma.user.update({ where: { id: A.u }, data: { aktif: true, rol: "yonetici", oturumSurumu: 0, ozelRolId: null, totpAktif: false } });
    await new Promise((r) => setTimeout(r, 11000)); // kullanıcı durumu önbelleği
  };
  const havuz = async (isler, n = 14) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < isler.length) { const s = i++; await isler[s](); } })); };

  const rapor = { rotalar: {}, sizintilar: [], supheliler: [], bozulanA: [], uyari: [] };
  const kayit = (y) => (rapor.rotalar[y] ??= { saldiri: {}, taban: null, kontrol: {} });
  const artir = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

  const kanaryaDenetle = async (son) => {
    if (++kanarya % 400) return;
    const r = await istek("GET", "/api/v1/auth/ben");
    if (r.durum !== 200) { rapor.bozulanA.push({ durum: r.durum, son }); await kurtar(); }
  };
  const db0 = await dbGorunumu();

  const yontemler = (m) => rotalar.filter((r) => m.includes(r.yontem));
  const SALDIRI = async (r) => {
    const anahtar = `${r.yontem} ${r.yol}`, k = kayit(anahtar), birlesim = birlesimler(r.yol);
    const ornek = birlesim[0] ?? {};
    const taban = await istek(r.yontem, yolKur(r.yol, rastgele(ornek)));
    k.taban = taban.durum;
    await havuz(birlesim.map((d) => async () => {
      const yol = yolKur(r.yol, d), s = await istek(r.yontem, yol);
      artir(k.saldiri, s.durum);
      const gonderilen = Object.values(d).join(" ").toLowerCase();
      for (const b of sizinti(s.metin, gonderilen, Object.values(d))) rapor.sizintilar.push({ rota: anahtar, yol, durum: s.durum, bulgu: b });
      if (paramlar(r.yol).length && s.durum >= 200 && s.durum < 300 && !(taban.durum >= 200 && taban.durum < 300)) rapor.supheliler.push({ rota: anahtar, yol, durum: s.durum, taban: taban.durum, modeller: Object.values(d).map((v) => bKimlikler.get(v) ?? v) });
      await kanaryaDenetle(anahtar);
    }));
  };

  // 1. okuma: B kimlikleriyle; ardından A kimlikleriyle denetim (rotaya ulaşıldığının kanıtı)
  const yalnizGovde = ASAMA === "govde";
  rapor.ozDenetim = await ozDenetim();
  console.log("Öz denetim:", JSON.stringify(rapor.ozDenetim));
  console.log("1/4 okuma saldırısı");
  if (!yalnizGovde) for (const r of yontemler(["GET"])) await SALDIRI(r);
  console.log(`  ${istekSayisi} istek, ${Math.round((Date.now() - baslangic) / 1000)} sn`);
  console.log("2/4 denetim (A'nın kendi kimlikleri)");
  if (!yalnizGovde) for (const r of yontemler(["GET"])) {
    const k = kayit(`GET ${r.yol}`), liste = birlesimler(r.yol).map(aDegeri);
    let isaretli = 0;
    await havuz(liste.map((d) => async () => { const s = await istek("GET", yolKur(r.yol, d)); artir(k.kontrol, s.durum); if (s.metin.includes("IDORA")) isaretli++; }));
    k.aIsareti = isaretli;
  }
  console.log("3/4 listelerde sorgu parametresiyle saldırı");
  const SORGU = ["cariId", "stokId", "faturaId", "personelId", "kullaniciId", "userId", "tenantId", "firmaId", "belgeId", "projeId", "depoId", "hesapId", "bankaHesapId", "kasaId", "sahipId"];
  const sorguAdi = (p) => { const y = p.replace(/Id$/, "").toLowerCase(); if (/^(tenant|firma)/.test(y)) return B.t; if (y === "kullanici" || y === "user") return B.u; return (satirlar.B[kisaca[y]] ?? satirlar.B.Cari)?.id; };
  const sorgu = "?baslangic=2026-01-01&bitis=2026-12-31&donem=2026-01&yil=2026&ay=1&tarih=2026-01-15&" + SORGU.map((p) => `${p}=${sorguAdi(p)}`).join("&");
  const liste = yontemler(["GET"]).filter((r) => !paramlar(r.yol).length);
  if (!yalnizGovde) await havuz(liste.map((r) => async () => { const s = await istek("GET", r.yol, { sorgu }); artir((kayit(`GET ${r.yol}`).sorgulu ??= {}), s.durum); for (const b of sizinti(s.metin, sorgu.toLowerCase())) rapor.sizintilar.push({ rota: `GET ${r.yol}`, yol: `${r.yol}?…`, durum: s.durum, bulgu: b }); }));
  const db1 = await dbGorunumu();
  if (ASAMA !== "okuma" && !yalnizGovde) {
    console.log("4/4 yazma saldırısı (boş gövde)");
    for (const r of yontemler(["POST", "PUT", "PATCH", "DELETE"])) await SALDIRI(r);
  }
  if (ASAMA !== "okuma") { console.log("5/5 şemadan üretilen gövdelerle yabancı kimlik"); rapor.govde = await govdeSaldirisi(); }
  if (ASAMA !== "okuma") {
    console.log("6/6 kurulan bağlardan sonra okuma taraması");
    const once = rapor.sizintilar.length;
    const okuma = [];
    for (const r of yontemler(["GET"])) if (!/^\/api\/v1\/platform/.test(r.yol)) for (const d of birlesimler(r.yol, 60).map(aDegeri)) okuma.push(async () => {
      const yol = yolKur(r.yol, d), s = await istek("GET", yol);
      // Önceki aşamalarda A'nın kendisi B kimliği gönderdi (ör. kuyruğa yazılan iş); burada yalnız B'nin metin işareti sızıntıdır.
      for (const b of sizinti(s.metin, "", Object.values(d))) if (b.startsWith("işaret")) rapor.sizintilar.push({ rota: `GET ${r.yol}`, yol, durum: s.durum, bulgu: `bağ sonrası: ${b}` });
      if (s.durum >= 500) { const k = `GET ${r.yol}`; artir((rapor.bagSonrasi5xx ??= {}), k); }
    });
    await havuz(okuma);
    console.log(`  ${okuma.length} okuma, yeni sızıntı ${rapor.sizintilar.length - once}`);
  }
  const db2 = await dbGorunumu();
  rapor.db = { seedSonrasi: db0.sayilar, degisenB: farklar(db0.ozet, db2.ozet), okumadaDegisenB: farklar(db0.ozet, db1.ozet), capraz: await caprazBaglar(), rlsEksik: await rlsEksikleri() };
  rapor.tohum = { hatalar, A: say("A"), B: say("B"), model: modeller.length, kiracili: [...kiracili].length };
  rapor.ozet = ozetle(rapor, istekSayisi, Date.now() - baslangic);
  writeFileSync(`${RAPOR}/sonuc.json`, JSON.stringify(rapor, null, 1));
  console.log(JSON.stringify(rapor.ozet, null, 1));
  await prisma.$disconnect();

  /** Dedektörler çalışıyor mu? B kendi kaydını okuyunca sızıntı işareti; bozulan bağ ve satır DB denetiminde görünmeli. */
  async function ozDenetim() {
    const cari = satirlar.B.CariHesap;
    const y = await fetch(`${API}/api/v1/cari/${cari.id}`, { headers: { authorization: `Bearer ${imzala(B.u, B.t)}` } });
    const metin = await y.text();
    const sizintiGorur = sizinti(metin, "").length > 0;
    const tablo = modeller.find((m) => m.name === "CariHesap").dbName;
    const once = await dbGorunumu();
    await prisma.$executeRawUnsafe(`UPDATE "${tablo}" SET unvan = unvan || 'x' WHERE id=$1::uuid`, cari.id);
    const degisimGorur = farklar(once.ozet, (await dbGorunumu()).ozet).includes("CariHesap");
    await prisma.$executeRawUnsafe(`UPDATE "${tablo}" SET unvan = left(unvan, -1) WHERE id=$1::uuid`, cari.id);
    // A'nın CariHesap'a bağlı bir satırını B'ye bağlamak: tetikleyici reddetmeli; tetikleyici
    // kapalıyken (geri alınan işlemde) kurulan bağı da çapraz denetimi görmeli.
    const bag = await prisma.$queryRawUnsafe(`select c.relname t, a.attname s from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_class p on p.oid=k.confrelid join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1] where k.contype='f' and p.relname=$1 and array_length(k.conkey,1)=1 and exists(select 1 from information_schema.columns x where x.table_name=c.relname and x.column_name='tenant_id')`, tablo);
    let caprazGorur = false, tetikleyiciReddeder = false;
    for (const b of bag) {
      const satir = await prisma.$queryRawUnsafe(`select "${b.s}"::text v from "${b.t}" where tenant_id=$1::uuid and "${b.s}" is not null limit 1`, A.t);
      if (!satir[0]) continue;
      const yaz = (c) => c.$executeRawUnsafe(`UPDATE "${b.t}" SET "${b.s}"=$1::uuid WHERE tenant_id=$2::uuid AND "${b.s}"=$3::uuid`, cari.id, A.t, satir[0].v);
      tetikleyiciReddeder = await yaz(prisma).then(() => false, (e) => /foreign key|bağlı kaydı/i.test(String(e.message)));
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await yaz(tx);
        const n = await tx.$queryRawUnsafe(`select count(*)::int n from "${b.t}" c join "${tablo}" p on c."${b.s}"=p.id where c.tenant_id<>p.tenant_id`);
        caprazGorur = n[0].n > 0;
        throw new Error("geri al");
      }).catch(() => undefined);
      break;
    }
    return { durum: y.status, sizintiGorur, degisimGorur, caprazGorur, tetikleyiciReddeder };
  }

  /**
   * Doğrulama şemasından geçerli gövde. Her kimlik alanı tek tek denenir: gövdenin kalanı
   * A'nın kendi kayıtlarını gösterir, yalnız o alan B'ye çevrilir. Böylece ilk alanın
   * reddi sonraki alanların denetimsizliğini gizlemez; birbirini dışlayan alanlar da çalışır.
   */
  async function govdeSaldirisi() {
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
    const sonSema = async () => { try { return await (await fetch("http://api:3999/son")).json(); } catch { return null; } };
    const gecti = (d) => d >= 200 && d < 300;
    const sonuc = { semasiz: [], kimliksiz: [], denemeSayisi: 0, korunuyor: [], denetimGecmedi: [], ikisiGecti: [], yalnizBGecti: [] };
    for (const r of yontemler(["POST", "PUT", "PATCH"])) {
      if (/^\/api\/v1\/(auth|platform|tenant\/kayit|mcp)/.test(r.yol)) continue;
      const anahtar = `${r.yontem} ${r.yol}`;
      const parca = r.yol.split("/");
      const d = Object.fromEntries(paramlar(r.yol).map((p) => {
        if (/id$/i.test(p) && !/^(tenant|firma)/i.test(p)) { const on = p === "id" ? `${parca[parca.indexOf(":id") - 1].replace(/-/g, "").replace(/(ler|lar)$/, "")}Id` : p; return [p, satirlar.A[model(on, r.yol)]?.id ?? randomUUID()]; }
        const a = adaySec(p)[0]; return [p, aKarsilik.get(a) ?? (a === B.t ? A.t : a)];
      }));
      const yol = yolKur(r.yol, d);
      await sonSema();
      const ilk = await istek(r.yontem, yol);
      const sema = ilk.durum === 400 ? await sonSema() : null;
      if (!sema || sema.hata) { sonuc.semasiz.push({ rota: anahtar, durum: ilk.durum, yanit: kisalt(ilk.metin).slice(0, 90) }); continue; }
      const alanlar = kimlikYollari(sema, "kok", "kok", []).slice(0, 14);
      if (!alanlar.length) { sonuc.kimliksiz.push(anahtar); continue; }
      for (const alan of alanlar) {
        sonuc.denemeSayisi++;
        const gB = uret(sema, "kok", "kok", alan.yol, "B", r.yol), gA = uret(sema, "kok", "kok", alan.yol, "A", r.yol);
        // Önce saldırı: denetim isteğinin açtığı kayıt tekillik hatasıyla saldırıyı maskelemesin.
        const b = await istek(r.yontem, yol, { govde: gB });
        const a = await istek(r.yontem, yol, { govde: gA });
        for (const x of sizinti(b.metin, "", JSON.stringify(gB).match(UUID) ?? [])) rapor.sizintilar.push({ rota: anahtar, yol, durum: b.durum, bulgu: `gövde ${alan.yol}: ${x}` });
        const k = { rota: anahtar, alan: alan.yol, model: model(alan.ad, r.yol), a: a.durum, b: b.durum, yanitB: kisalt(b.metin).slice(0, 170), yanitA: gecti(a.durum) ? undefined : kisalt(a.metin).slice(0, 110), govdeB: kisalt(JSON.stringify(gB)).slice(0, 220) };
        if (gecti(b.durum) && gecti(a.durum)) sonuc.ikisiGecti.push(k);
        else if (gecti(b.durum)) sonuc.yalnizBGecti.push(k);
        else if (gecti(a.durum)) sonuc.korunuyor.push({ rota: anahtar, alan: alan.yol, b: b.durum, yanit: k.yanitB.slice(0, 90) });
        else sonuc.denetimGecmedi.push(k);
        if (++kanarya % 40 === 0) { const c = await istek("GET", "/api/v1/auth/ben"); if (c.durum !== 200) { rapor.bozulanA.push({ durum: c.durum, son: anahtar }); await kurtar(); } }
      }
    }
    return sonuc;
  }

  async function dbGorunumu() {
    const ozet = {}, sayilar = {};
    for (const [ad, r] of Object.entries(satirlar.B)) {
      const m = modeller.find((x) => x.name === ad);
      const tablo = m.dbName ?? ad, idSut = m.fields.find((f) => f.name === "id")?.dbName ?? "id";
      if (!r.id) continue;
      const satir = await prisma.$queryRawUnsafe(`select md5(t::text) h from "${tablo}" t where "${idSut}"::text = $1`, r.id).catch(() => null);
      ozet[ad] = satir?.[0]?.h ?? "SILINDI";
    }
    return { ozet, sayilar };
  }
  function farklar(a, b) { return Object.keys(a).filter((k) => a[k] !== b[k]); }
  async function caprazBaglar() {
    const fk = await prisma.$queryRawUnsafe(`
      select c.relname cocuk, a.attname sutun, p.relname ana, pa.attname ana_sutun
      from pg_constraint k
      join pg_class c on c.oid=k.conrelid join pg_class p on p.oid=k.confrelid
      join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1]
      join pg_attribute pa on pa.attrelid=k.confrelid and pa.attnum=k.confkey[1]
      where k.contype='f' and array_length(k.conkey,1)=1
        and exists(select 1 from information_schema.columns x where x.table_schema='public' and x.table_name=c.relname and x.column_name='tenant_id')
        and exists(select 1 from information_schema.columns x where x.table_schema='public' and x.table_name=p.relname and x.column_name='tenant_id')`);
    const cikti = [];
    for (const f of fk) {
      const s = await prisma.$queryRawUnsafe(`select count(*)::int n from "${f.cocuk}" c join "${f.ana}" p on c."${f.sutun}"=p."${f.ana_sutun}" where c.tenant_id<>p.tenant_id`);
      if (s[0].n) cikti.push({ ...f, adet: s[0].n });
    }
    return { fkSayisi: fk.length, bulgular: cikti };
  }
  async function rlsEksikleri() {
    return prisma.$queryRawUnsafe(`
      select c.relname tablo, c.relrowsecurity rls, c.relforcerowsecurity force,
        exists(select 1 from information_schema.columns x where x.table_schema='public' and x.table_name=c.relname and x.column_name='tenant_id') tenant_sutunu,
        has_table_privilege('tekir_app', c.oid, 'SELECT') app_okur
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and not (c.relrowsecurity and c.relforcerowsecurity) and c.relname not like '\\_prisma%'
      order by 1`);
  }
}
function ozetle(r, istek, ms) {
  const ulasilan = Object.entries(r.rotalar).filter(([k, v]) => k.startsWith("GET") && Object.keys(v.kontrol).some((d) => d >= 200 && d < 300));
  const sadece400 = Object.entries(r.rotalar).filter(([k, v]) => !k.startsWith("GET") && Object.keys(v.saldiri).every((d) => d === "400"));
  const bes = Object.entries(r.rotalar).filter(([, v]) => Object.keys(v.saldiri).some((d) => d >= 500));
  return { istek, sureSn: Math.round(ms / 1000), rota: Object.keys(r.rotalar).length, getUlasilan: ulasilan.length, getIsaretli: Object.values(r.rotalar).filter((v) => v.aIsareti).length, yazmaYalniz400: sadece400.length, bes5xxRota: bes.length, sizinti: r.sizintilar.length, suphe: r.supheliler.length, bozulanA: r.bozulanA.length, degisenB: r.db.degisenB.length, capraz: r.db.capraz.bulgular.length, rlsEksik: r.db.rlsEksik.length, tohumHata: Object.keys(r.tohum.hatalar).length, govde: r.govde ? Object.fromEntries(Object.entries(r.govde).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])) : null };
}
main().catch((e) => { console.error(e); process.exit(1); });
