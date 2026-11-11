import { onayYurutmesi } from "../onay/onay-kurallari";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ayarTanimiAl } from "../core/ayarlar/ayar-kayit";
import { cariRiskleri, grupRiskleri, toplamLimit } from "./cari-risk";

/**
 * CARI-32 (karar 2026-10-03): carinin belgeye açık olup olmadığı tek yerden
 * denetlenir (CARI-17, AYR-04).
 *
 * - Kara liste: teklif, sipariş, irsaliye ve fatura — satış da alış da — ne
 *   oluşturulabilir ne düzenlenebilir ne onaylanabilir. Tahsilat ve ödeme serbest.
 * - Pasif cari: yeni belge açılamaz; mevcut belgesi onaylanıp kapatılabilir.
 * - Karşı tarafın düzenlediği gelen e-Fatura/e-İrsaliye kaydı denetlenmez;
 *   olmuş işin kaydıdır, engellemek defteri eksik bırakır.
 */
export type BelgeTuru = "teklif" | "siparis" | "irsaliye" | "fatura";
export type BelgeAsamasi = "yeni" | "mevcut";

const BELGE_ADI: Record<BelgeTuru, string> = { teklif: "teklif", siparis: "sipariş", irsaliye: "irsaliye", fatura: "fatura" };

export async function cariIslemDenetle(tx: Prisma.TransactionClient, cariId: string, belge: BelgeTuru, asama: BelgeAsamasi): Promise<void> {
  const cari = await tx.cariHesap.findUnique({ where: { id: cariId }, select: { unvan: true, aktif: true, karaListe: true, karaListeNotu: true } });
  if (!cari) throw new NotFoundException("Cari hesap bulunamadı");
  if (cari.karaListe) {
    throw new BadRequestException(
      `'${cari.unvan}' işlem blokajında (kara liste); ${BELGE_ADI[belge]} ${asama === "yeni" ? "oluşturulamaz" : "işlenemez"}` +
        (cari.karaListeNotu ? ` — ${cari.karaListeNotu}` : ""),
    );
  }
  if (asama === "yeni" && !cari.aktif) {
    throw new BadRequestException(`'${cari.unvan}' pasif; yeni ${BELGE_ADI[belge]} açılamaz. Önce cari kartını aktifleştirin`);
  }
}

// ─── Risk limiti politikası ────────────────────────────────────────────────

export type RiskPolitikasi = "uyar" | "engelle" | "yonetici_onayi";
export const RISK_ONAYI_ISARETI = "yönetici onayı gerekir";

export async function riskPolitikasi(tx: Prisma.TransactionClient, tenantId: string): Promise<RiskPolitikasi> {
  const kayit = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: "cari" } } });
  const ayarlar = { ...ayarTanimiAl("cari")?.varsayilanlar, ...((kayit?.ayarlar as Record<string, unknown>) ?? {}) };
  const p = ayarlar.riskLimitiPolitikasi;
  return p === "engelle" || p === "yonetici_onayi" ? p : "uyar";
}

export interface RiskDenetimi {
  tenantId: string;
  userId: string;
  rol: string;
  cariId: string;
  /** Riskte henüz bulunmayan belge tutarı, güncel kurla TL (CARI-33); faturada hareket önceden yazıldığı için 0. */
  ekTutarTry: Prisma.Decimal;
  belgeEtiketi: string;
  /** Yönetici onayı politikasında aşımı geçmek için gerekçe. */
  onayGerekcesi?: string | null;
}

/**
 * CARI-32: sipariş onayı ve fatura kesinleştirmede risk limiti. Aşım yoksa
 * null; "uyar"da uyarı metni; "engelle"de hata; "yonetici_onayi"nda yönetici
 * gerekçe yazarak geçer (denetim izine yazılır), diğerleri hata alır.
 */
/** ONY-01: politika uygulanmadan, belge eklenince carinin ya da grubunun risk limiti aşılıyor mu. */
export async function riskAsimiVarMi(tx: Prisma.TransactionClient, tenantId: string, cariId: string, ekTutarTry: Prisma.Decimal): Promise<boolean> {
  return (await riskAsimlari(tx, { tenantId, cariId, ekTutarTry, belgeEtiketi: "" })).length > 0;
}

async function riskAsimlari(tx: Prisma.TransactionClient, d: Pick<RiskDenetimi, "tenantId" | "cariId" | "ekTutarTry" | "belgeEtiketi">) {
  const cari = await tx.cariHesap.findUnique({ where: { id: d.cariId }, select: { riskLimiti: true, grup: { select: { id: true, ad: true, riskLimiti: true } } } });
  const asimlar: { metin: string; detay: Record<string, string> }[] = [];
  if (cari?.riskLimiti) {
    const risk = (await cariRiskleri(tx, d.tenantId, [d.cariId])).get(d.cariId)!;
    const toplam = risk.mevcutRisk.add(d.ekTutarTry);
    // CARI-39: geçerli teminat limite eklenir.
    const limit = toplamLimit(risk, cari.riskLimiti)!;
    if (toplam.greaterThan(limit)) {
      const limitMetni = risk.teminatTry.isZero() ? `${cari.riskLimiti.toFixed(2)} TL` : `${limit.toFixed(2)} TL (risk limiti ${cari.riskLimiti.toFixed(2)} + teminat ${risk.teminatTry.toFixed(2)})`;
      asimlar.push({
        metin: `Risk limiti aşılıyor: ${d.belgeEtiketi} ile risk ${toplam.toFixed(2)} TL` +
          (risk.cekSenetRiski.isZero() ? "" : ` (bakiye ${Prisma.Decimal.max(risk.bakiyeTry, 0).toFixed(2)} + çek/senet ${risk.cekSenetRiski.toFixed(2)}${d.ekTutarTry.isZero() ? "" : ` + belge ${d.ekTutarTry.toFixed(2)}`})`) +
          `, limit ${limitMetni}`,
        detay: { risk: toplam.toFixed(2), limit: limit.toFixed(2), teminat: risk.teminatTry.toFixed(2) },
      });
    }
  }
  // CARI-41: grup limiti üyelerin toplam riskine (bu belge dahil) uygulanır; üyelerin teminatı eklenir.
  if (cari?.grup?.riskLimiti) {
    const g = (await grupRiskleri(tx, d.tenantId, [cari.grup.id])).get(cari.grup.id)!;
    const toplam = g.mevcutRisk.add(d.ekTutarTry);
    const limit = toplamLimit(g, cari.grup.riskLimiti)!;
    if (toplam.greaterThan(limit)) {
      asimlar.push({
        metin: `'${cari.grup.ad}' grup risk limiti aşılıyor: ${d.belgeEtiketi} ile ${g.uyeSayisi} üyenin toplam riski ${toplam.toFixed(2)} TL, limit ${g.teminatTry.isZero() ? `${cari.grup.riskLimiti.toFixed(2)} TL` : `${limit.toFixed(2)} TL (grup limiti ${cari.grup.riskLimiti.toFixed(2)} + teminat ${g.teminatTry.toFixed(2)})`}`,
        detay: { grup: cari.grup.ad, grupRiski: toplam.toFixed(2), grupLimiti: limit.toFixed(2) },
      });
    }
  }
  return asimlar;
}

export async function riskLimitiDenetle(tx: Prisma.TransactionClient, d: RiskDenetimi): Promise<string | null> {
  const asimlar = await riskAsimlari(tx, d);
  if (asimlar.length === 0) return null;
  const metin = asimlar.map((a) => a.metin).join("; ");
  const politika = await riskPolitikasi(tx, d.tenantId);
  if (politika === "uyar") return metin;
  if (politika === "engelle") throw new ConflictException(`${metin}. Risk politikası aşıma izin vermiyor; limiti artırın ya da tahsilat bekleyin`);
  // ONY-03: genel onay akışında onaylanmış işlem risk onayı yerine geçer (kayıt denetim izine yazılır).
  const onayTalebi = onayYurutmesi()?.talepId;
  const gerekce = onayTalebi ? `Onay talebi ${onayTalebi} ile onaylandı` : d.onayGerekcesi?.trim().slice(0, 500);
  if (!onayTalebi && (d.rol !== "yonetici" || !gerekce)) {
    throw new ConflictException(`${metin}; ${RISK_ONAYI_ISARETI}${d.rol === "yonetici" ? " — gerekçe yazın" : ""}`);
  }
  await tx.auditLog.create({
    data: {
      tenantId: d.tenantId, userId: d.userId, islem: "risk_asimi_onayi", varlik: "cari", varlikId: d.cariId,
      detay: { belge: d.belgeEtiketi, ...Object.assign({}, ...asimlar.map((a) => a.detay)), gerekce },
    },
  });
  return `${metin} — yönetici onayıyla geçildi`;
}
