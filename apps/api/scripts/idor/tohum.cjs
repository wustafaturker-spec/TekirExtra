"use strict";
/**
 * Prisma şemasından iki kiracıya genel tohumlama: her modele birer satır, metinlerde
 * kiracıya özgü işaret (IDORA/IDORB). Kısıta takılan modeller raporlanır.
 */
const { randomUUID, randomBytes } = require("node:crypto");
const { Prisma } = require("@prisma/client");

const MODULLER = (process.env.IDOR_MODULLER ?? "").split(",").filter(Boolean);
const kucuk = (s) => s[0].toLowerCase() + s.slice(1);

function olustur(prisma) {
  const modeller = Prisma.dmmf.datamodel.models;
  const enumlar = Object.fromEntries(Prisma.dmmf.datamodel.enums.map((e) => [e.name, e.values.map((v) => v.name)]));
  const adla = Object.fromEntries(modeller.map((m) => [m.name, m]));
  const iliskiler = (m) => m.fields.filter((f) => f.kind === "object" && f.relationFromFields?.length);
  const kiracili = new Set(modeller.filter((m) => m.fields.some((f) => f.name === "tenantId")).map((m) => m.name));
  // Zorunlu ilişkiyle kiracılı modele bağlı (tenant_id'siz) çocuklar da kiracıya aittir.
  for (let degisti = true; degisti; ) {
    degisti = false;
    for (const m of modeller) {
      if (kiracili.has(m.name) || m.name === "Tenant") continue;
      if (iliskiler(m).some((r) => r.isRequired && (kiracili.has(r.type) || r.type === "Tenant"))) { kiracili.add(m.name); degisti = true; }
    }
  }
  const satirlar = { A: {}, B: {}, ortak: {} };
  const hatalar = {};

  // CHECK kısıtındaki ilk geçerli değer (ör. durum IN ('a','b')); veritabanı kataloğundan okunur.
  const izinli = {};
  async function kisitlariOku() {
    const k = await prisma.$queryRawUnsafe("select c.relname t, pg_get_constraintdef(o.oid) d from pg_constraint o join pg_class c on c.oid=o.conrelid where o.contype='c'");
    for (const { t, d } of k) {
      for (const e of d.matchAll(/\(?\(?"?([a-z_0-9]+)"?\)?(?:::text)?\)? = ANY \(+ARRAY\[([^\]]+)\]/g)) (izinli[t] ??= {})[e[1]] ??= e[2].match(/'([^']*)'/)?.[1];
      for (const e of d.matchAll(/\(?"?([a-z_0-9]+)"?\)?(?:::text)? = '([^']*)'/g)) (izinli[t] ??= {})[e[1]] ??= e[2];
    }
  }

  function deger(f, harf, model, tam) {
    const sutun = f.dbName ?? f.name, sinirli = izinli[adla[model]?.dbName ?? model]?.[sutun];
    if (f.type === "String" && sinirli !== undefined && !f.isList) return sinirli;
    const yerel = f.nativeType?.[0];
    const uzunluk = f.nativeType?.[1]?.[0] ? Number(f.nativeType[1][0]) : null;
    if (f.kind === "enum") { const v = enumlar[f.type][0]; return f.isList ? [v] : v; }
    let v;
    switch (f.type) {
      case "String":
        if (yerel === "Uuid" || (/(Id|Uuid)$/.test(f.name) && !uzunluk)) v = randomUUID();
        else if (uzunluk && uzunluk < 12) v = /doviz|para/i.test(f.name) ? "TRY".slice(0, uzunluk) : randomBytes(8).toString("hex").slice(0, uzunluk);
        else v = `IDOR${harf}_${model}_${f.name}_${randomBytes(3).toString("hex")}`.slice(0, uzunluk ?? 200);
        if (/eposta|email/i.test(f.name) && (!uzunluk || uzunluk > 40)) v = `idor${harf.toLowerCase()}.${randomBytes(4).toString("hex")}@ornek.invalid`;
        break;
      case "Int": v = f.name === "yil" ? 2026 : 1; break;
      case "BigInt": v = 1n; break;
      case "Float": case "Decimal": v = 1; break;
      case "Boolean": v = false; break;
      case "DateTime": v = new Date(); break;
      case "Json": v = { isaret: `IDOR${harf}_${model}_${f.name}` }; break;
      case "Bytes": v = Buffer.from(`IDOR${harf}`); break;
      default: v = null;
    }
    return f.isList ? (tam ? [v] : []) : v;
  }

  async function ekle(harf, m, tam) {
    const veri = {};
    const fkAlanlari = new Set(iliskiler(m).flatMap((r) => r.relationFromFields));
    for (const r of iliskiler(m)) {
      const hedef = satirlar[harf][r.type] ?? satirlar.ortak[r.type];
      if (!hedef) { if (r.isRequired) return "eksik"; continue; }
      if (!r.isRequired && !tam) continue;
      r.relationFromFields.forEach((alan, i) => { veri[alan] = hedef[r.relationToFields[i]]; });
    }
    for (const f of m.fields) {
      if (f.kind === "object" || veri[f.name] !== undefined || fkAlanlari.has(f.name)) continue;
      if (f.name === "tenantId") { veri.tenantId = satirlar[harf].Tenant.id; continue; }
      if (f.isUpdatedAt || (f.hasDefaultValue && !(izinli[m.dbName ?? m.name]?.[f.dbName ?? f.name]))) continue;
      if (f.isId && f.hasDefaultValue) continue;
      if (!f.isRequired && !tam) continue;
      const v = deger(f, harf, m.name, tam);
      if (v !== null) veri[f.name] = v;
    }
    return prisma[kucuk(m.name)].create({ data: veri });
  }

  async function tohumla() {
    await kisitlariOku();
    for (const [harf, vkn] of [["A", "1111111111"], ["B", "2222222222"]]) {
      satirlar[harf].Tenant = await prisma.tenant.create({ data: { unvan: `IDOR${harf}_Tenant`, vkn } });
      satirlar[harf].User = await prisma.user.create({ data: { tenantId: satirlar[harf].Tenant.id, eposta: `yonetici.${harf.toLowerCase()}@ornek.invalid`, adSoyad: `IDOR${harf}_User`, rol: "yonetici", parolaHash: "x", epostaDogrulandi: true } });
    }
    // Bağımlılık sırası: ilerleme kalmayana kadar tekrar edilir.
    const bekleyen = { A: modeller.filter((m) => kiracili.has(m.name) && !["User"].includes(m.name)), B: null };
    for (const harf of ["A", "B"]) {
      let liste = (harf === "A" ? bekleyen.A : modeller.filter((m) => kiracili.has(m.name) && m.name !== "User"));
      for (let ilerleme = true; ilerleme && liste.length; ) {
        ilerleme = false;
        const kalan = [];
        for (const m of liste) {
          // Zorunlu ortak (kiracısız) hedef gerekiyorsa bir kez oluşturulur.
          for (const r of iliskiler(m).filter((x) => x.isRequired && !kiracili.has(x.type) && x.type !== "Tenant" && !satirlar.ortak[x.type])) {
            const h = await ekle("G", adla[r.type], false).catch(() => null);
            if (h && h !== "eksik") satirlar.ortak[r.type] = h;
          }
          let sonuc;
          try { sonuc = await ekle(harf, m, true); }
          catch { try { sonuc = await ekle(harf, m, false); } catch (e) { sonuc = "hata"; hatalar[m.name] = String(e.message ?? e).split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300); } }
          if (sonuc === "eksik" || sonuc === "hata") { kalan.push(m); continue; }
          satirlar[harf][m.name] = sonuc; delete hatalar[m.name]; ilerleme = true;
        }
        liste = kalan;
      }
      for (const m of liste) hatalar[m.name] ??= "bağımlı satır oluşmadı";
    }
    // Rastgele değerler modülleri kapatmasın, kiracı ekranları açık olsun.
    for (const harf of ["A", "B"]) {
      const t = satirlar[harf].Tenant.id;
      await prisma.$executeRawUnsafe("DELETE FROM modul_ayarlari WHERE tenant_id=$1::uuid", t);
      for (const modul of MODULLER) await prisma.modulAyar.create({ data: { tenantId: t, modul, ayarlar: { mod: "acik", gorunum: "tam" } } }).catch(() => undefined);
      await prisma.$executeRawUnsafe("UPDATE users SET ozel_rol_id=NULL, aktif=true, rol='yonetici', totp_aktif=false WHERE id=$1::uuid", satirlar[harf].User.id).catch(() => undefined);
      await prisma.tenant.update({ where: { id: t }, data: { efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: true } }).catch(() => undefined);
      satirlar[harf].ModulAyar = await prisma.modulAyar.findFirst({ where: { tenantId: t } });
    }
    return { satirlar, hatalar, kiracili, modeller, ekle, adla };
  }
  return { tohumla };
}
module.exports = { olustur };
