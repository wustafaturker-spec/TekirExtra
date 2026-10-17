import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { birimKatsayisiBul } from "../stok/birim-cevrim";
import { satisSatirlari } from "../stok/satis-ozeti";
import { maliyetTakipAnahtari, maliyetTakibiniOku } from "./maliyet-takibi";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kapatma = z.object({ kayitId: z.string().uuid(), beklenenGuncelleme: z.iso.datetime(), kanit: z.string().regex(/^[a-f0-9]{64}$/), aciklama: z.string().trim().min(2).max(2000) }).strict();
export function maliyetKapatmaGirdisi(v: unknown) {
  const r = kapatma.safeParse(v);
  if (!r.success) throw new BadRequestException("Güncel doğrulama, kayıt sürümü ve 2–2000 karakterlik kapatma notu gerekli.");
  return r.data;
}

/** İptal/geri alma tersleri maliyet diliminde netlenir; kısmi sıfır maliyet gizlenmez. */
export function hareketKapsamiUygun(miktar: Prisma.Decimal, hareketler: { miktar: Prisma.Decimal; maliyet: Prisma.Decimal }[]) {
  const dilimler = new Map<string, Prisma.Decimal>();
  for (const h of hareketler) {
    const k = h.maliyet.toString();
    dilimler.set(k, (dilimler.get(k) ?? D(0)).sub(h.miktar));
  }
  return miktar.gt(0) && hareketler.length > 0
    && [...dilimler].every(([maliyet, adet]) => adet.isZero() || (adet.gt(0) && D(maliyet).gt(0)))
    && [...dilimler.values()].reduce((t, v) => t.add(v), D(0)).eq(miktar);
}

async function kaynakKilitle(tx: Tx, tenantId: string, id: string) {
  const s = await tx.faturaSatir.findFirst({ where: { id, tenantId }, select: { faturaId: true, stokId: true } });
  if (!s) throw new NotFoundException("Satış satırı bulunamadı.");
  // Maliyet uygulaması stok kartını kilitler; aynı sıra korunur. FK kilitleri yeni satır/hareket eklenmesini de bekletir.
  await tx.$queryRaw`SELECT id FROM stok_kartlari WHERE id = ${s.stokId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
  // Ana miktar hesabı bu katsayılara bağlıdır; maliyet gibi işlem sonuna kadar sabit kalmalıdır.
  await tx.$queryRaw`SELECT id FROM stok_birimleri WHERE stok_id = ${s.stokId}::uuid AND tenant_id = ${tenantId}::uuid ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM stok_varyantlari WHERE stok_id = ${s.stokId}::uuid AND tenant_id = ${tenantId}::uuid ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM faturalar WHERE id = ${s.faturaId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM fatura_satirlari WHERE fatura_id = ${s.faturaId}::uuid AND stok_id = ${s.stokId}::uuid AND tenant_id = ${tenantId}::uuid ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM stok_hareketleri WHERE stok_id = ${s.stokId}::uuid AND tenant_id = ${tenantId}::uuid AND kaynak_ref = ${s.faturaId} AND kaynak_tur IN ('fatura', 'fatura_geri_alma') ORDER BY id FOR UPDATE`;
  return s;
}

async function kaynakDogrula(tx: Tx, tenantId: string, id: string, s: { faturaId: string; stokId: string }) {
  const kayit = await tx.duzeltmeKaydi.findUnique({ where: { tenantId_tekillikAnahtari: { tenantId, tekillikAnahtari: maliyetTakipAnahtari(id) } } });
  const kart = await tx.stokKart.findUnique({ where: { id: s.stokId }, select: { id: true, tip: true, anaBirim: true, kod: true, ad: true } });
  const f = await tx.fatura.findUnique({ where: { id: s.faturaId }, select: {
    id: true, tip: true, durum: true, tarih: true, no: true, kur: true, updatedAt: true,
    satirlar: { where: { stokId: s.stokId }, orderBy: { id: "asc" }, select: { id: true, stokId: true, varyantId: true, miktar: true, birim: true, matrah: true } },
  } });
  const hs = await tx.stokHareket.findMany({ where: { tenantId, stokId: s.stokId, kaynakRef: s.faturaId, kaynakTur: { in: ["fatura", "fatura_geri_alma"] } }, orderBy: { id: "asc" }, select: { id: true, miktar: true, maliyet: true, varyantId: true } });
  const satir = (await satisSatirlari(tx, {}, s.faturaId)).find((r) => r.faturaSatirId === id);
  const secili = f?.satirlar.find((r) => r.id === id);
  const varyantId = secili?.varyantId ?? null;
  const varyant = varyantId ? await tx.stokVaryant.findFirst({ where: { id: varyantId, stokId: s.stokId, tenantId }, select: { id: true, kod: true, ad: true, aktif: true, updatedAt: true } }) : null;
  const kapsamSatirlari = (f?.satirlar ?? []).filter((r) => r.varyantId === varyantId);
  const kapsamHareketleri = hs.filter((h) => h.varyantId === varyantId);
  let neden = "Kayıtlı pozitif maliyet ve hareket kapsamı doğrulandı.";
  let uygun = true;
  const reddet = (mesaj: string) => { if (uygun) neden = mesaj; uygun = false; };
  if (!kayit || ["cozuldu", "yoksayildi"].includes(kayit.durum)) reddet("Açık inceleme kaydı yok.");
  if (!f || f.tip !== "satis" || f.durum !== "kesin" || !f.satirlar.some((r) => r.id === id) || !satir || satir.stokId !== s.stokId || satir.stokTip === "hizmet" || !satir.ciro.gt(0)) reddet("Kaynak artık aynı kesin mal satışı koşulunda değil; ayrıca incelenmeli.");
  if (satir && !satir.maliyet.gt(0)) reddet("Kayıtlı maliyet sıfır veya negatif; inceleme kapatılamaz.");
  if (varyantId && !varyant) reddet("Varyant bu şirketin aynı ürününe ait değil; kaynak ayrıca incelenmeli.");
  if (satir && (satir.varyantId ?? null) !== varyantId) reddet("Satış satırı ile varyant kapsamı eşleşmiyor.");
  if (hs.some((h) => !f?.satirlar.some((r) => r.varyantId === h.varyantId))) reddet("Faturada karşılığı olmayan varyant hareketi var; kaynak ayrıca incelenmeli.");
  let miktar = D(0);
  const katsayilar: string[] = [];
  for (const r of kapsamSatirlari) {
    try {
      const k = await birimKatsayisiBul(tx, r.stokId, r.birim);
      if (!k.gt(0) || !r.miktar.gt(0)) reddet("Birim veya satır miktarı doğrulanamadı.");
      miktar = miktar.add(r.miktar.mul(k)); katsayilar.push(`${r.id}:${k.toString()}`);
    } catch (e) {
      if (!(e instanceof BadRequestException || e instanceof NotFoundException)) throw e;
      reddet("Kaynak birimi doğrulanamadı; katsayı varsayılmadı.");
    }
  }
  if (!hareketKapsamiUygun(miktar, kapsamHareketleri)) reddet("Hareket miktarı veya maliyet kapsamı eksik/belirsiz; inceleme kapatılamaz.");
  const kanit = uygun ? createHash("sha256").update(JSON.stringify({ id, f, hs, kart, varyant, katsayilar, kapsamMiktari: miktar, kapsamSatirlari: kapsamSatirlari.map((r) => r.id), kayitId: kayit!.id, surum: kayit!.updatedAt, ciro: satir!.ciro, maliyet: satir!.maliyet })).digest("hex") : null;
  return { uygun, neden, kanit, varyantId, kapsamSatirSayisi: kapsamSatirlari.length, kapsamMiktari: miktar.toString(), kayitId: kayit?.id ?? null, kayitSurumu: kayit?.updatedAt.toISOString() ?? null, varyantKod: satir?.varyantKod ?? null, varyantAd: satir?.varyantAd ?? null, faturaNo: f?.no ?? "", stokKod: kart?.kod ?? "", stokAd: kart?.ad ?? "", tarih: f?.tarih.toISOString().slice(0, 10) ?? "", ciro: satir?.ciro.toFixed(2) ?? null, maliyet: satir?.maliyet.toFixed(2) ?? null, hareketSayisi: kapsamHareketleri.length, alindigiZaman: new Date().toISOString() };
}

export async function maliyetDogrulamasiniOku(tx: Tx, tenantId: string, id: string) {
  return kaynakDogrula(tx, tenantId, id, await kaynakKilitle(tx, tenantId, id));
}

export async function maliyetIncelemesiniKapat(tx: Tx, tenantId: string, userId: string, id: string, govde: unknown) {
  const g = maliyetKapatmaGirdisi(govde);
  const s = await kaynakKilitle(tx, tenantId, id);
  await tx.$queryRaw`SELECT id FROM duzeltme_kayitlari WHERE id = ${g.kayitId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
  const dogrulama = await kaynakDogrula(tx, tenantId, id, s);
  if (!dogrulama.uygun || dogrulama.kayitId !== g.kayitId || dogrulama.kayitSurumu !== g.beklenenGuncelleme || dogrulama.kanit !== g.kanit) {
    throw new ConflictException("Kaynak veya inceleme değişti ya da kapatmaya uygun değil. Yeniden doğrulayın.");
  }
  const kayit = await tx.duzeltmeKaydi.findUniqueOrThrow({ where: { id: g.kayitId } });
  await tx.duzeltmeKaydi.update({ where: { id: kayit.id }, data: { durum: "cozuldu", tekillikAnahtari: null, cozenUserId: userId, cozulmeTarihi: new Date(), updatedAt: new Date(Math.max(Date.now(), kayit.updatedAt.getTime() + 1)) } });
  await tx.duzeltmeOlayi.create({ data: {
    tenantId, userId, duzeltmeKaydiId: kayit.id, olayTuru: "kayitli_maliyet_dogrulandi", oncekiDurum: kayit.durum, yeniDurum: "cozuldu",
    aciklama: `${g.aciklama}${dogrulama.varyantId ? `\nVaryant: ${dogrulama.varyantKod ?? ""} · ${dogrulama.varyantAd ?? ""}; kontrol edilen satış satırı: ${dogrulama.kapsamSatirSayisi}.` : ""}\nSeçili satırın kayıtlı maliyeti: ${dogrulama.maliyet} TRY; ciro: ${dogrulama.ciro} TRY; ilişkili hareket: ${dogrulama.hareketSayisi}. Bu işlem mali tutarları değiştirmedi.`,
  } });
  await tx.auditLog.create({ data: { tenantId, userId, islem: "maliyet_incelemesi_kapatildi", varlik: "duzeltme_kaydi", varlikId: kayit.id, detay: {
    satirId: id, faturaId: s.faturaId, stokId: s.stokId, varyantId: dogrulama.varyantId, varyantKod: dogrulama.varyantKod, varyantAd: dogrulama.varyantAd, kapsamSatirSayisi: dogrulama.kapsamSatirSayisi, kapsamMiktari: dogrulama.kapsamMiktari, kanit: dogrulama.kanit, maliyet: dogrulama.maliyet, ciro: dogrulama.ciro, hareketSayisi: dogrulama.hareketSayisi,
  } } });
  return { kayit: await maliyetTakibiniOku(tx, tenantId, id), dogrulama };
}
