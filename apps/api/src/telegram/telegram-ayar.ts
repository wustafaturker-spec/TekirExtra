import type { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * CNL-05/20: firmanın Telegram ürün ayarı. Genel modül ayarları kayıt defterine bilerek girmez:
 * ürün çıkarılırken bağların aynı işlemde düşmesi gerekir ve bu yalnız TelegramService'ten yapılır.
 */
export const TELEGRAM_MODULU = "telegram";
export const telegramAyariSemasi = z.object({ etkin: z.boolean(), tutarGoster: z.boolean() }).strict();
export type TelegramAyari = z.infer<typeof telegramAyariSemasi>;
/** CNL-20: varsayılan ekli değil; CNL-05: tutarlar varsayılan olarak gösterilir. */
export const TELEGRAM_VARSAYILAN: TelegramAyari = { etkin: false, tutarGoster: true };

export async function telegramAyariOku(tx: Prisma.TransactionClient, tenantId: string): Promise<TelegramAyari> {
  const kayit = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: TELEGRAM_MODULU } }, select: { ayarlar: true } });
  const sonuc = telegramAyariSemasi.safeParse({ ...TELEGRAM_VARSAYILAN, ...((kayit?.ayarlar as object | null) ?? {}) });
  return sonuc.success ? sonuc.data : TELEGRAM_VARSAYILAN;
}

/** CNL-14: panel tarafında özellik, platform bot adını tanımladıysa vardır (anahtar yalnız Telegram sürecindedir). */
export function telegramBotAdi(): string | null {
  const ad = process.env.TELEGRAM_BOT_ADI?.trim().replace(/^@/, "");
  return ad && /^[A-Za-z0-9_]{5,32}$/.test(ad) ? ad : null;
}

/** Bağın düşme nedenleri; denetim izine ve kullanıcıya giden metne dönüşür. */
export type DusmeNedeni = "urun_kapali" | "plan_kapali" | "firma_kisitli" | "kullanici_pasif" | "oturum_degisti" | "rol_kapali";
export const DUSME_METNI: Record<DusmeNedeni, string> = {
  urun_kapali: "firmanızda Telegram kanalı kapatıldı",
  plan_kapali: "abonelik paketinizde yapay zekâ asistanı yok",
  firma_kisitli: "firmanızın hesabı şu anda kısıtlı",
  kullanici_pasif: "kullanıcınız pasife alındı",
  oturum_degisti: "parolanız ya da iki adımlı doğrulamanız değişti",
  rol_kapali: "rolünüz yapay zekâ asistanını kullanamıyor",
};
