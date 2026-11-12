import { Prisma } from "@prisma/client";
import { AiSinirHatasi } from "../ai/saglayici/ai-butce";
import { aiButcesiDoldu } from "../ai/saglayici/kiraci-saglayici";
import type { PrismaService } from "../core/prisma.service";

/**
 * CNL-15: Telegram sesli mesajı OpenAI konuşma tanıma API'siyle yazıya çevrilir (kullanıcı kararı
 * 2026-11-12). Anahtar platformundur (OPENAI_SES_API_KEY); maliyet firmanın aylık yapay zekâ
 * bütçesine yazılır. Ses kaydı saklanmaz; yalnız yazıya dökülmüş metin sohbete girer.
 */
export const SES_AZAMI_SANIYE = 120;
export const SES_AZAMI_BAYT = 10 * 1024 * 1024;
/** Dakika başına USD (OpenAI liste fiyatı); bilinmeyen model en pahalı fiyattan sayılır. */
const DAKIKA_FIYATI: Record<string, number> = { "gpt-4o-mini-transcribe": 0.003, "gpt-4o-transcribe": 0.006, "whisper-1": 0.006 };
/** Alan sözcükleri tanımayı iyileştirir; kullanıcı verisi içermez. */
const IPUCU = "TekirExtra ön muhasebe: cari, fatura, e-Fatura, irsaliye, KDV, tahsilat, tediye, masraf, kasa, banka, çek, senet, stok, teklif.";

export const sesAnahtari = () => process.env.OPENAI_SES_API_KEY?.trim() || null;
export const sesModeli = () => process.env.OPENAI_SES_MODELI?.trim() || "gpt-4o-mini-transcribe";
export const sesKullanilabilir = () => Boolean(sesAnahtari());

export function sesMaliyeti(model: string, saniye: number): number {
  return Math.round(((DAKIKA_FIYATI[model] ?? 0.006) * Math.max(saniye, 1)) / 60 * 1e8) / 1e8;
}

/** Telegram sesli mesajı ogg/opus; ses dosyası (audio) mp3/m4a olabilir. OpenAI türü dosya adından anlar. */
export function sesDosyaAdi(mime: string | undefined): string {
  if (!mime || /ogg|opus/.test(mime)) return "ses.ogg";
  if (/mpeg|mp3/.test(mime)) return "ses.mp3";
  if (/mp4|m4a|aac/.test(mime)) return "ses.m4a";
  if (/wav/.test(mime)) return "ses.wav";
  if (/webm/.test(mime)) return "ses.webm";
  return "ses.ogg";
}

export class SesHatasi extends Error {}

export async function sesiYaziyaCevir(
  prisma: PrismaService,
  b: { tenantId: string; userId: string },
  ses: { tampon: Buffer; mime?: string; saniye: number },
  istek: typeof fetch = fetch,
): Promise<string> {
  const anahtar = sesAnahtari();
  if (!anahtar) throw new SesHatasi("Sesli mesaj platformda henüz açık değil.");
  if (await aiButcesiDoldu(prisma, b.tenantId)) throw new AiSinirHatasi("Bu ayın yapay zekâ bütçesi doldu.");
  const model = sesModeli();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(ses.tampon)]), sesDosyaAdi(ses.mime));
  form.append("model", model);
  form.append("language", "tr");
  form.append("prompt", IPUCU);
  form.append("response_format", "json");
  const baslangic = Date.now();
  let metin: string | null = null;
  let hataSinifi: string | null = null;
  try {
    // OPENAI_SES_URL yalnız platform ortamından gelir (kabul testinde sahte sunucu).
    const yanit = await istek(process.env.OPENAI_SES_URL?.trim() || "https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${anahtar}` }, body: form, signal: AbortSignal.timeout(60_000),
    });
    if (!yanit.ok) { hataSinifi = `HTTP_${yanit.status}`; throw new SesHatasi("Sesli mesaj yazıya çevrilemedi."); }
    const veri = (await yanit.json()) as { text?: unknown };
    metin = typeof veri.text === "string" ? veri.text.replace(/\s+/g, " ").trim() : "";
    return metin;
  } catch (hata) {
    hataSinifi ??= hata instanceof Error ? hata.name.slice(0, 100) : "BilinmeyenHata";
    throw hata instanceof SesHatasi ? hata : new SesHatasi("Sesli mesaj yazıya çevrilemedi.");
  } finally {
    // OpenAI süre üzerinden ücretlendirir; başarısız istekte ücret yazılmaz.
    const basarili = metin !== null;
    await prisma.tenantIslem(b.tenantId, async (tx) => {
      await tx.aiCagriIz.create({ data: {
        tenantId: b.tenantId, userId: b.userId, ozellik: "asistan", saglayici: "openai", model, islem: "ses_yazi",
        sureMs: Date.now() - baslangic, basarili, hataSinifi: basarili ? null : hataSinifi,
        maliyetUsd: basarili ? new Prisma.Decimal(sesMaliyeti(model, ses.saniye)) : null,
      } });
      if (basarili) {
        const gun = new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" })}T00:00:00Z`);
        await tx.aiKullanim.upsert({
          where: { tenantId_gun_userId_ozellik: { tenantId: b.tenantId, gun, userId: b.userId, ozellik: "asistan" } },
          create: { tenantId: b.tenantId, gun, userId: b.userId, ozellik: "asistan", cagri: 1 },
          update: { cagri: { increment: 1 } },
        });
      }
    }).catch(() => undefined);
  }
}
