"use strict";
/**
 * Firma içi yetki taraması: aynı kiracıda her rol ve özel rol için bütün uçlar denenir.
 * Sonuç bir matristir (uç × rol) ve hangi rolün hangi model alanını gördüğünün kaydıdır;
 * politikayla karşılaştırma docs/GUVENLIK-FIRMA-ICI-YETKI-TARAMASI.md içindedir.
 */
const { randomUUID, createHmac } = require("node:crypto");
const { writeFileSync, readFileSync } = require("node:fs");
const { PrismaClient } = require("@prisma/client");
const { YETKI_MODULLERI, yetkiAnahtari } = require("@tekirextra/shared");
const { olustur } = require("./tohum.cjs");
const { govdeUretici } = require("./govde.cjs");

const API = process.env.API, RAPOR = process.env.RAPOR, SIR = process.env.JWT_SECRET;
const prisma = new PrismaClient({ datasourceUrl: process.env.SUPER_URL });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const imzala = (sub, tenantId, rol) => {
  const g = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, tenantId, rol, sv: 0, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 })}`;
  return `${g}.${createHmac("sha256", SIR).update(g).digest("base64url")}`;
};
const ROLLER = ["muhasebe", "satis", "salt_okunur", "mali_musavir", "b2b_bayi", "uretim_planlama", "uretim_operatoru", "depo", "kalite", "maliyet_muhasebesi", "ik", "calisan"];
const ISARET = /IDORA_([A-Za-z0-9]+)_([A-Za-z0-9]+)/g;
const havuz = async (isler, n = 12) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < isler.length) { const s = i++; await isler[s](); } })); };

async function main() {
  const t0 = Date.now();
  const { satirlar, hatalar, modeller, ekle, adla } = await olustur(prisma).tohumla();
  const A = satirlar.A, tenantId = A.Tenant.id;
  // Kurban: tohum satırlarının sahibi. Saldırgan çalışan/bayi başka karta bağlıdır.
  const kartiDigerPersonel = await ekle("A", adla.Personel, false);
  const digerCari = await ekle("A", adla.CariHesap, false);
  const kurban = {};
  for (const f of adla.User.fields) if (f.type === "String" && f.kind === "scalar" && !f.isList && !f.isRequired && !/Id$/.test(f.name)) kurban[f.name] = `IDORA_User_${f.name}`;
  kurban.parolaHash = "IDORA_User_parolaHash";
  await prisma.user.update({ where: { id: A.User.id }, data: { ...kurban, personelId: A.Personel.id, bayiCariId: A.CariHesap.id, totpAktif: false } }).catch((e) => console.log("kurban:", String(e.message).slice(-200)));
  const aktorler = {};
  for (const rol of ROLLER) {
    const u = await prisma.user.create({ data: { tenantId, eposta: `${rol}@ornek.invalid`, adSoyad: `Saldirgan ${rol}`, rol, parolaHash: "x", epostaDogrulandi: true, ...(rol === "calisan" ? { personelId: kartiDigerPersonel.id } : {}), ...(rol === "b2b_bayi" ? { bayiCariId: digerCari.id } : {}) } });
    aktorler[rol] = { id: u.id, rol, token: imzala(u.id, tenantId, rol) };
  }
  const tumKutular = YETKI_MODULLERI.flatMap((m) => ["goruntule", "duzenle", "onayla", "sil"].map((i) => yetkiAnahtari(m.kod, i)));
  const ozel = await prisma.ozelRol.create({ data: { tenantId, ad: "Hepsi kapalı", sablonRol: "yonetici", kapaliKutular: tumKutular } });
  const oz = await prisma.user.create({ data: { tenantId, eposta: "ozel@ornek.invalid", adSoyad: "Ozel rol", rol: "yonetici", parolaHash: "x", epostaDogrulandi: true, ozelRolId: ozel.id } });
  aktorler.ozel_hepsi_kapali = { id: oz.id, rol: "yonetici", token: imzala(oz.id, tenantId, "yonetici") };
  const bir = await prisma.user.create({ data: { tenantId, eposta: "yonetici2@ornek.invalid", adSoyad: "Yonetici denetim", rol: "yonetici", parolaHash: "x", epostaDogrulandi: true } });
  aktorler.yonetici = { id: bir.id, rol: "yonetici", token: imzala(bir.id, tenantId, "yonetici") };
  console.log(`Tohum tamam; ${Object.keys(aktorler).length} aktör, tohumlanamayan ${Object.keys(hatalar).length}`);

  const kisaca = Object.fromEntries(modeller.map((m) => [m.name.toLowerCase(), m.name]));
  const { model, kimlikYollari, uret } = govdeUretici({ A, B: A }, kisaca);
  const rotalar = JSON.parse(readFileSync(`${RAPOR}/rotalar.json`, "utf8")).filter((r) => r.yol.startsWith("/api/v1") && r.yontem !== "ALL" && !/^\/api\/v1\/(platform|mcp)/.test(r.yol));
  const paramlar = (y) => [...y.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const tumKimlikler = [...new Set(Object.values(A).map((r) => r.id).filter((v) => typeof v === "string"))];
  const degerCoz = (r, p) => {
    if (/^(tenant|firma)(id)?$/i.test(p)) return tenantId;
    if (/id$/i.test(p)) { const parca = r.yol.split("/"); const on = p === "id" ? `${parca[parca.indexOf(":id") - 1].replace(/-/g, "").replace(/(ler|lar)$/, "")}Id` : p; return A[model(on, r.yol)]?.id ?? randomUUID(); }
    for (const x of Object.values(A)) if (typeof x[p] === "string") return x[p];
    return /yil/i.test(p) ? "2026" : /ay$/i.test(p) ? "1" : "idor";
  };
  const yolKur = (y, d) => y.replace(/:([A-Za-z0-9_]+)/g, (_, p) => encodeURIComponent(d[p]));
  const SORGU = "?baslangic=2026-01-01&bitis=2026-12-31&donem=2026-01&yil=2026&ay=1&tarih=2026-01-15";

  const rapor = { matris: {}, yazmaMatrisi: {}, gorunen: {}, yazmaKaniti: {}, bozulan: [], tohum: { hatalar } };
  let sayac = 0;
  const istek = async (aktor, yontem, yol, govde) => {
    sayac++;
    try {
      const y = await fetch(`${API}${yol}`, { method: yontem, redirect: "manual", signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${aktor.token}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: yontem === "GET" ? undefined : JSON.stringify(govde ?? {}) });
      return { durum: y.status, metin: Buffer.from(await y.arrayBuffer()).toString("latin1") };
    } catch (e) { return { durum: 0, metin: String(e.name) }; }
  };
  const not = (m, r, ad, d) => { const k = (m[r] ??= {}); if (!(ad in k) || (d >= 200 && d < 300) || (k[ad] === 403 && d !== 403)) k[ad] = d; };
  const tara = (ad, anahtar, s) => { if (s.durum < 200 || s.durum >= 300) return; for (const e of s.metin.matchAll(ISARET)) { const a = (rapor.gorunen[ad] ??= {}); const l = (a[`${e[1]}.${e[2]}`] ??= []); if (l.length < 4 && !l.includes(anahtar)) l.push(anahtar); } };
  const kanarya = async (ad) => { const r = await istek(aktorler[ad], "GET", "/api/v1/auth/ben"); if (r.durum === 200) return; rapor.bozulan.push({ ad, durum: r.durum }); await prisma.user.update({ where: { id: aktorler[ad].id }, data: { aktif: true, oturumSurumu: 0 } }); await new Promise((x) => setTimeout(x, 11000)); };

  // Tek tek bulguların uçtan uca kanıtı.
  const durum = async (ad, yontem, yol, govde) => (await istek(aktorler[ad], yontem, `/api/v1${yol}`, govde)).durum;
  const dogrula = rapor.dogrulama = {};
  dogrula.ozelRolYukseltme = { onceCari: await durum("ozel_hepsi_kapali", "GET", "/cari"), onceKullanici: await durum("ozel_hepsi_kapali", "POST", "/kullanicilar", {}) };
  dogrula.ozelRolYukseltme.patch = await durum("ozel_hepsi_kapali", "PATCH", `/ozel-roller/${ozel.id}`, { ad: ozel.ad, aktif: true, kapaliKutular: [] });
  await new Promise((x) => setTimeout(x, 11000));
  dogrula.ozelRolYukseltme.sonraCari = await durum("ozel_hepsi_kapali", "GET", "/cari");
  dogrula.ozelRolYukseltme.sonraKullanici = await durum("ozel_hepsi_kapali", "POST", "/kullanicilar", {});
  await prisma.ozelRol.update({ where: { id: ozel.id }, data: { kapaliKutular: tumKutular } });
  await new Promise((x) => setTimeout(x, 11000));
  dogrula.ozelRolEk = { onceSil: await durum("ozel_hepsi_kapali", "GET", `/ekler?sahipTur=fatura&sahipId=${randomUUID()}`) };
  dogrula.ekler = {};
  for (const tur of ["fatura", "masraf", "cari", "kasa_banka", "personel"]) {
    const ekSatir = await prisma.ek.create({ data: { tenantId, sahipTur: tur, sahipId: randomUUID(), dosyaAdi: `IDORA_Ek_gizli_${tur}.pdf`, mimeTip: "application/pdf", boyut: 1, depoAnahtari: `x/${randomUUID()}`, yukleyenUserId: A.User.id } }).catch((e) => ({ hata: String(e.message).slice(-160) }));
    if (ekSatir.hata) { dogrula.ekler[tur] = ekSatir.hata; continue; }
    dogrula.ekler[tur] = {};
    for (const ad of ["kalite", "uretim_operatoru", "ik", "depo", "muhasebe"]) dogrula.ekler[tur][ad] = (await istek(aktorler[ad], "GET", `/api/v1/ekler?sahipTur=${tur}&sahipId=${ekSatir.sahipId}`)).metin.includes("IDORA_Ek_gizli");
  }
  // İK, özlük belgesi ekranını kullanır: listeleme, yükleme ve indirme aynı yetkide mi?
  const ozluk = await prisma.ek.create({ data: { tenantId, sahipTur: "personel", sahipId: A.Personel.id, dosyaAdi: "ozluk.pdf", mimeTip: "application/pdf", boyut: 1, depoAnahtari: `x/${randomUUID()}`, yukleyenUserId: A.User.id } });
  await prisma.personelBelgesi.create({ data: { tenantId, personelId: A.Personel.id, ekId: ozluk.id, tur: (await prisma.$queryRawUnsafe("select unnest(enum_range(null::\"PersonelBelgeTuru\"))::text v").catch(() => [{ v: "diger" }]))[0].v } }).catch(() => undefined);
  dogrula.ikOzluk = {};
  for (const ad of ["ik", "muhasebe"]) {
    const liste = await istek(aktorler[ad], "GET", `/api/v1/personel/${A.Personel.id}/belgeler`);
    const bicim = new FormData();
    bicim.append("tur", "diger");
    bicim.append("dosya", new Blob(["%PDF-1.4\n%%EOF\n"], { type: "application/pdf" }), "deneme.pdf");
    const yukleme = await fetch(`${API}/api/v1/personel/${A.Personel.id}/belgeler`, { method: "POST", headers: { authorization: `Bearer ${aktorler[ad].token}`, "idempotency-key": randomUUID() }, body: bicim }).then(async (y) => ({ durum: y.status, mesaj: (await y.text()).slice(0, 90) }), (e) => ({ durum: 0, mesaj: String(e) }));
    const indirme = await istek(aktorler[ad], "GET", `/api/v1/ekler/${ozluk.id}/indir`);
    dogrula.ikOzluk[ad] = { liste: liste.durum, listedeVar: liste.metin.includes(ozluk.id), yukleme, indirme: indirme.durum, indirmeMesaj: indirme.metin.slice(0, 90) };
  }
  console.log(JSON.stringify(dogrula));
  if (process.env.IDOR_ASAMA === "rol-dogrula") { writeFileSync(`${RAPOR}/rol-dogrula.json`, JSON.stringify(rapor.dogrulama)); await prisma.$disconnect(); return; }
  console.log("1/3 okuma matrisi");
  const okuma = rotalar.filter((r) => r.yontem === "GET");
  for (const [ad, aktor] of Object.entries(aktorler)) {
    await havuz(okuma.map((r) => async () => {
      const d = Object.fromEntries(paramlar(r.yol).map((p) => [p, degerCoz(r, p)]));
      const yol = yolKur(r.yol, d) + (paramlar(r.yol).length ? "" : SORGU);
      const s = await istek(aktor, "GET", yol);
      not(rapor.matris, `GET ${r.yol}`, ad, s.durum);
      tara(ad, `GET ${r.yol}`, s);
      // Dar rollerde ve kişisel kayıtlarda her kimlik denenir: başkasının kaydına erişim burada görünür.
      if (["calisan", "b2b_bayi", "muhasebe"].includes(ad) && paramlar(r.yol).length === 1 && /id$/i.test(paramlar(r.yol)[0]) && s.durum !== 403 && s.durum !== 401) {
        for (const k of ad === "muhasebe" ? modeller.filter((m) => m.fields.some((f) => /^(userId|kullaniciId|olusturanId)$/.test(f.name))).map((m) => A[m.name]?.id).filter(Boolean) : tumKimlikler) {
          const z = await istek(aktor, "GET", yolKur(r.yol, { [paramlar(r.yol)[0]]: k }));
          tara(ad, `GET ${r.yol}`, z);
          not(rapor.matris, `GET ${r.yol}`, ad, z.durum);
        }
      }
    }), 8);
    await kanarya(ad);
    console.log(`  ${ad}: ${sayac} istek, ${Math.round((Date.now() - t0) / 1000)} sn`);
  }
  console.log("2/3 yazma matrisi (yok kimlik, boş gövde)");
  const yazma = rotalar.filter((r) => r.yontem !== "GET" && !/^\/api\/v1\/(auth|tenant\/kayit)/.test(r.yol));
  for (const [ad, aktor] of Object.entries(aktorler)) {
    await havuz(yazma.map((r) => async () => {
      const d = Object.fromEntries(paramlar(r.yol).map((p) => [p, /^(tenant|firma)(id)?$/i.test(p) ? tenantId : /id$/i.test(p) ? randomUUID() : "idor"]));
      const s = await istek(aktor, r.yontem, yolKur(r.yol, d));
      not(rapor.yazmaMatrisi, `${r.yontem} ${r.yol}`, ad, s.durum);
      tara(ad, `${r.yontem} ${r.yol}`, s);
    }), 8);
    await kanarya(ad);
  }
  console.log("3/3 salt okunur roller gerçekten yazabiliyor mu");
  const sonSema = async () => { try { return await (await fetch("http://api:3999/son")).json(); } catch { return null; } };
  for (const ad of ["salt_okunur", "mali_musavir", "ozel_hepsi_kapali"]) {
    const kanit = (rapor.yazmaKaniti[ad] = { gecti: [], reddedildi: 0, sonucsuz: 0, kapali: 0 });
    for (const r of yazma) {
      if (r.yontem === "DELETE" || rapor.yazmaMatrisi[`${r.yontem} ${r.yol}`]?.[ad] === 403) { if (r.yontem !== "DELETE") kanit.kapali++; continue; }
      const d = Object.fromEntries(paramlar(r.yol).map((p) => [p, degerCoz(r, p)]));
      const yol = yolKur(r.yol, d);
      await sonSema();
      const ilk = await istek(aktorler[ad], r.yontem, yol);
      if (ilk.durum >= 200 && ilk.durum < 300) { kanit.gecti.push({ rota: `${r.yontem} ${r.yol}`, durum: ilk.durum, yanit: ilk.metin.slice(0, 90) }); continue; }
      if (ilk.durum === 403) { kanit.reddedildi++; continue; }
      if (ilk.durum !== 400) { kanit.sonucsuz++; continue; }
      const sema = await sonSema();
      if (!sema || sema.hata) { kanit.sonucsuz++; continue; }
      const s = await istek(aktorler[ad], r.yontem, yol, uret(sema, "kok", "kok", "", "A", r.yol));
      if (s.durum >= 200 && s.durum < 300) kanit.gecti.push({ rota: `${r.yontem} ${r.yol}`, durum: s.durum, yanit: s.metin.slice(0, 90) });
      else if (s.durum === 403) kanit.reddedildi++;
      else kanit.sonucsuz++;
    }
    await kanarya(ad);
    console.log(`  ${ad}: geçti ${kanit.gecti.length}, reddedildi ${kanit.reddedildi}, sonuçsuz ${kanit.sonucsuz}, kapalı ${kanit.kapali}`);
  }
  // Özel rolün kapatamadığı uçlar: yetki matrisinde modülü olmayan yollar.
  const { yolModulu } = require("@tekirextra/shared");
  rapor.modulsuz = [...new Set(rotalar.filter((r) => !yolModulu(r.yol)).map((r) => r.yol.replace("/api/v1/", "").split("/")[0]))].sort();

  console.log("4/5 rol başına rapor çalıştırma");
  const yon = await istek(aktorler.yonetici, "GET", "/api/v1/raporlar");
  const liste = JSON.parse(yon.metin);
  const kodlar = (Array.isArray(liste) ? liste : liste.raporlar ?? liste.kayitlar ?? []).map((x) => x.kod).filter(Boolean);
  rapor.raporlar = { kodSayisi: kodlar.length, ornek: yon.metin.slice(0, 200), roller: {}, uyumsuz: [] };
  for (const [ad, aktor] of Object.entries(aktorler)) {
    const l = await istek(aktor, "GET", "/api/v1/raporlar");
    let izinli = new Set();
    try { const j = JSON.parse(l.metin); izinli = new Set((Array.isArray(j) ? j : j.raporlar ?? j.kayitlar ?? []).map((x) => x.kod)); } catch { /* 403 */ }
    const sonuc = (rapor.raporlar.roller[ad] = { listede: izinli.size, calisti: 0, reddedildi: 0, diger: {} });
    await havuz(kodlar.map((kod) => async () => {
      const r = await istek(aktor, "POST", `/api/v1/raporlar/${kod}/calistir`, { parametreler: { baslangic: "2026-01-01", bitis: "2026-12-31", donem: "2026-01", yil: 2026 }, filtreler: {} });
      if (r.durum >= 200 && r.durum < 300) { sonuc.calisti++; if (!izinli.has(kod)) rapor.raporlar.uyumsuz.push({ ad, kod, durum: r.durum }); tara(ad, `POST /raporlar/${kod}/calistir`, r); }
      else if (r.durum === 403) { sonuc.reddedildi++; if (izinli.has(kod)) rapor.raporlar.uyumsuz.push({ ad, kod, durum: 403, not: "listede var, çalışmıyor" }); }
      else sonuc.diger[r.durum] = (sonuc.diger[r.durum] ?? 0) + 1;
    }), 6);
  }

  console.log("5/5 başkasının kayıtları (gerçek kimlik, satır karşılaştırması)");
  const sahipli = modeller.filter((m) => m.fields.some((f) => /^(userId|kullaniciId|olusturanId)$/.test(f.name)) && A[m.name]?.id);
  rapor.sahipliModeller = sahipli.map((m) => m.name);
  const goruntu = async () => {
    const o = {};
    for (const m of sahipli) { const t = m.dbName ?? m.name; const x = await prisma.$queryRawUnsafe(`select md5(t::text) h from "${t}" t where id::text=$1`, A[m.name].id).catch(() => null); o[m.name] = x?.[0]?.h ?? "SILINDI"; }
    return o;
  };
  const tekParam = yazma.filter((r) => paramlar(r.yol).length === 1 && /id$/i.test(paramlar(r.yol)[0]) && !/^\/api\/v1\/(abonelik-odeme|pos\/|self-servis-davet|mutabakat)/.test(r.yol));
  rapor.yatay = {};
  for (const ad of ["salt_okunur", "depo", "satis", "muhasebe", "calisan"]) {
    const once = await goruntu();
    const kayit = (rapor.yatay[ad] = { ikiYuz: [], degisen: [] });
    const uclar = tekParam.filter((r) => ![401, 403].includes(rapor.yazmaMatrisi[`${r.yontem} ${r.yol}`]?.[ad]));
    await havuz(uclar.flatMap((r) => sahipli.map((m) => async () => {
      const yol = yolKur(r.yol, { [paramlar(r.yol)[0]]: A[m.name].id });
      const z = await istek(aktorler[ad], r.yontem, yol);
      if (z.durum >= 200 && z.durum < 300) kayit.ikiYuz.push({ rota: `${r.yontem} ${r.yol}`, model: m.name, durum: z.durum, yanit: z.metin.slice(0, 100) });
    })), 8);
    // Kişisel uçlarda şema gövdesi: boş gövdeyle doğrulamada kalan istekler de denensin.
    for (const r of uclar.filter((x) => /(bildirimler|rapor-abonelikleri|raporlar\/gorunumler|mcp-anahtarlari|onay-talepleri|ajan\/mesajlar|ajan\/sohbetler|icgoruler|gorevler)/.test(x.yol))) {
      for (const m of sahipli) {
        const yol = yolKur(r.yol, { [paramlar(r.yol)[0]]: A[m.name].id });
        await sonSema();
        const ilk = await istek(aktorler[ad], r.yontem, yol);
        if (ilk.durum !== 400) continue;
        const sema = await sonSema();
        if (!sema || sema.hata) continue;
        const z = await istek(aktorler[ad], r.yontem, yol, uret(sema, "kok", "kok", "", "A", r.yol));
        if (z.durum >= 200 && z.durum < 300) kayit.ikiYuz.push({ rota: `${r.yontem} ${r.yol}`, model: m.name, durum: z.durum, yanit: z.metin.slice(0, 100) });
      }
    }
    const sonra = await goruntu();
    kayit.degisen = Object.keys(once).filter((k) => once[k] !== sonra[k]);
    await kanarya(ad);
    console.log(`  ${ad}: uç ${uclar.length}, 2xx ${kayit.ikiYuz.length}, değişen ${kayit.degisen.length}`);
  }
  rapor.ozet = { istek: sayac, sureSn: Math.round((Date.now() - t0) / 1000), okuma: okuma.length, yazma: yazma.length };
  writeFileSync(`${RAPOR}/rol.json`, JSON.stringify(rapor));
  console.log(JSON.stringify(rapor.ozet));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
