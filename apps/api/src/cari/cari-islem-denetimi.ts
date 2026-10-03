import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ayarTanimiAl } from "../core/ayarlar/ayar-kayit";
import { cariRiskleri } from "./cari-risk";

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
  /** Riskte henüz bulunmayan belge tutarı (TL); faturada hareket önceden yazıldığı için 0. */
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
export async function riskLimitiDenetle(tx: Prisma.TransactionClient, d: RiskDenetimi): Promise<string | null> {
  const cari = await tx.cariHesap.findUnique({ where: { id: d.cariId }, select: { riskLimiti: true } });
  if (!cari?.riskLimiti) return null;
  const risk = (await cariRiskleri(tx, [d.cariId])).get(d.cariId)!;
  const toplam = risk.mevcutRisk.add(d.ekTutarTry);
  if (!toplam.greaterThan(cari.riskLimiti)) return null;
  const metin = `Risk limiti aşılıyor: ${d.belgeEtiketi} ile risk ${toplam.toFixed(2)} TL` +
    (risk.cekSenetRiski.isZero() ? "" : ` (bakiye ${Prisma.Decimal.max(risk.bakiyeTry, 0).toFixed(2)} + çek/senet ${risk.cekSenetRiski.toFixed(2)}${d.ekTutarTry.isZero() ? "" : ` + belge ${d.ekTutarTry.toFixed(2)}`})`) +
    `, limit ${cari.riskLimiti.toFixed(2)} TL`;
  const politika = await riskPolitikasi(tx, d.tenantId);
  if (politika === "uyar") return metin;
  if (politika === "engelle") throw new ConflictException(`${metin}. Risk politikası aşıma izin vermiyor; limiti artırın ya da tahsilat bekleyin`);
  const gerekce = d.onayGerekcesi?.trim().slice(0, 500);
  if (d.rol !== "yonetici" || !gerekce) {
    throw new ConflictException(`${metin}; ${RISK_ONAYI_ISARETI}${d.rol === "yonetici" ? " — gerekçe yazın" : ""}`);
  }
  await tx.auditLog.create({
    data: {
      tenantId: d.tenantId, userId: d.userId, islem: "risk_asimi_onayi", varlik: "cari", varlikId: d.cariId,
      detay: { belge: d.belgeEtiketi, risk: toplam.toFixed(2), limit: cari.riskLimiti.toFixed(2), gerekce },
    },
  });
  return `${metin} — yönetici onayıyla geçildi`;
}
