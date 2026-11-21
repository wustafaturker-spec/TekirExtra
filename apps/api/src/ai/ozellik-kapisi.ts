import { ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AI_OZELLIK_ADLARI, aiOzellikAnahtariMi, type AiOzellikAnahtari } from "@tekirextra/shared";

/**
 * AI-109: yapay zekâ özelliği kapısı. Öncelik: platform acil durdurması > paket (yapay_zeka
 * modülü; giriş noktalarında ayrıca denetlenir) > firma ayarı. Kapalı özellik 503 ve açık
 * mesajla durur; bekleyen onaylar ve kuyruktaki işler silinmez, tarayıcılar onları atlar.
 *
 * Platform listesi süreç başına ONBELLEK_MS önbellekte tutulur: acil durdurma api, worker
 * ve telegram süreçlerinde en geç bu süre içinde etkili olur (ister: 30 sn).
 */
export const ONBELLEK_MS = 15_000;

export type AiOzellikDurumu = { kapali: false } | { kapali: true; kaynak: "platform" | "firma"; mesaj: string };

export class AiOzellikKapaliHatasi extends ServiceUnavailableException {
  constructor(readonly ozellik: AiOzellikAnahtari, readonly kaynak: "platform" | "firma", mesaj: string) {
    super({ message: mesaj, kod: "AI_OZELLIK_KAPALI", ozellik, kaynak });
  }
}

type Okuyucu = Pick<Prisma.TransactionClient, "platformAiOzellikDurumu" | "tenantAiAyari">;
let platformOnbellegi: { bitis: number; durdurulan: Set<string> } | null = null;

/** Testler ve platform yazımı sonrası aynı süreçte hemen etkili olsun diye. */
export function platformOnbelleginiSifirla(): void {
  platformOnbellegi = null;
}

async function platformDurdurulanlar(tx: Okuyucu, simdi = Date.now()): Promise<Set<string>> {
  if (platformOnbellegi && platformOnbellegi.bitis > simdi) return platformOnbellegi.durdurulan;
  const satirlar = await tx.platformAiOzellikDurumu.findMany({ where: { durduruldu: true }, select: { ozellik: true } });
  platformOnbellegi = { bitis: simdi + ONBELLEK_MS, durdurulan: new Set(satirlar.map((s) => s.ozellik)) };
  return platformOnbellegi.durdurulan;
}

export const platformMesaji = (o: AiOzellikAnahtari) =>
  `${AI_OZELLIK_ADLARI[o].ad} platform genelinde geçici olarak durduruldu. Bekleyen onaylarınız ve kuyruktaki işleriniz korunuyor; özellik yeniden açılınca kaldığı yerden sürer.`;
export const firmaMesaji = (o: AiOzellikAnahtari) =>
  `${AI_OZELLIK_ADLARI[o].ad} firmanızın yapay zekâ ayarlarında kapalı. Yöneticiniz Ayarlar › Yapay zekâ ekranından açabilir.`;

/** Kiracı işlemi içinde okunur (platform tablosu tüm kiracı süreçlerine okunur). */
export async function aiOzellikDurumu(tx: Okuyucu, tenantId: string, ozellik: AiOzellikAnahtari): Promise<AiOzellikDurumu> {
  if ((await platformDurdurulanlar(tx)).has(ozellik)) return { kapali: true, kaynak: "platform", mesaj: platformMesaji(ozellik) };
  const ayar = await tx.tenantAiAyari.findUnique({ where: { tenantId }, select: { kapaliOzellikler: true } });
  if (ayar?.kapaliOzellikler?.includes(ozellik)) return { kapali: true, kaynak: "firma", mesaj: firmaMesaji(ozellik) };
  return { kapali: false };
}

type TenantIslem = { tenantIslem: <T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T> };

/** Kapalıysa `AiOzellikKapaliHatasi` (503) fırlatır. */
export async function aiOzellikDenetle(prisma: TenantIslem, tenantId: string, ozellik: AiOzellikAnahtari): Promise<void> {
  const d = await prisma.tenantIslem(tenantId, (tx) => aiOzellikDurumu(tx, tenantId, ozellik));
  if (d.kapali) throw new AiOzellikKapaliHatasi(ozellik, d.kaynak, d.mesaj);
}

/** Tarayıcılar için: kapalıysa true (iş atlanır, kuyrukta bekler). */
export async function aiOzellikKapaliMi(prisma: TenantIslem, tenantId: string, ozellik: AiOzellikAnahtari): Promise<boolean> {
  return (await prisma.tenantIslem(tenantId, (tx) => aiOzellikDurumu(tx, tenantId, ozellik))).kapali;
}

/** Firma ayarı girdisi: bilinmeyen anahtar düşer, tekrarlar teklenir. */
export function kapaliOzellikleriAyikla(girdi: unknown): AiOzellikAnahtari[] {
  return Array.isArray(girdi) ? [...new Set(girdi.filter(aiOzellikAnahtariMi))] : [];
}
