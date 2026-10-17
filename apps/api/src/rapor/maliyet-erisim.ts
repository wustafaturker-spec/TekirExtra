import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { MALIYET_KONTROL_MODULU, maliyetKontrolAyariSemasi } from "../core/ayarlar/maliyet-kontrol-ayari";

/** İşlem boyunca ayar satırını tutar: eşzamanlı mod değişikliği commit'i bekler. */
export async function maliyetErisiminiDogrula(tx: Prisma.TransactionClient, yazma = false) {
  const { tenantId, rol } = aktifBaglam();
  const kayitlar = await tx.$queryRaw<{ ayarlar: unknown }[]>`
    SELECT ayarlar FROM modul_ayarlari
    WHERE tenant_id = ${tenantId}::uuid AND modul = ${MALIYET_KONTROL_MODULU}
    FOR SHARE`;
  // Saklı kayıt bozuk/gelecek sürümdeyse varsayılanlarla açılmaz.
  const sonuc = maliyetKontrolAyariSemasi.safeParse(kayitlar[0]?.ayarlar ?? {});
  if (!sonuc.success || sonuc.data.mod === "kapali") {
    throw new ForbiddenException("Satış maliyet kontrolü bu şirket için kapalı. Yönetici, Modül Ayarları ekranından açabilir.");
  }
  const mod = sonuc.data.mod;
  const takipYazma = mod !== "salt_okunur" && ["yonetici", "muhasebe"].includes(rol);
  if (yazma && !takipYazma) throw new ForbiddenException("Satış maliyet kontrolünde inceleme yazma izni yok; şirket modu veya kullanıcı yetkisi salt okunur.");
  return { mod, takipYazma };
}
