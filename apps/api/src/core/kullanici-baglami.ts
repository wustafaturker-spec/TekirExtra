import type { Rol } from "@tekirextra/shared";
import { baglamlaCalistir, type IstekBaglami } from "./istek-baglami";
import type { PrismaService } from "./prisma.service";

/** AI-94: kullanıcı adına yürütme başlatılamadı (pasif, silinmiş ya da okunamadı). */
export class KullaniciBaglamiHatasi extends Error {
  constructor(public readonly neden: "bulunamadi" | "pasif" | "okunamadi", mesaj: string) {
    super(mesaj);
    this.name = "KullaniciBaglamiHatasi";
  }
}

/**
 * AI-94 (birleşik plan P-01): kullanıcı adına çalışan her arka plan işi
 * (zamanlanmış görev, onay sonrası yürütme, teklif otomasyonu) bağlamını
 * buradan kurar. Aktiflik, temel rol ve özel rolün kapattığı kutular
 * önbelleksiz okunur; panel/MCP/Telegram bağlamıyla aynı alanlar kurulur.
 * Okuma başarısızsa ya da kullanıcı etkin değilse iş durur; sessizce temel
 * role veya yöneticiye düşülmez. Paket kapsamı uç çağrısında ayrıca denetlenir.
 */
export async function kullaniciBaglami(prisma: PrismaService, tenantId: string, userId: string): Promise<IstekBaglami> {
  let k: { aktif: boolean; rol: string; ozelRolId: string | null; ozelRol: { kapaliKutular: string[] } | null } | null;
  try {
    k = await prisma.tenantIslem(tenantId, (tx) => tx.user.findFirst({
      where: { id: userId },
      select: { aktif: true, rol: true, ozelRolId: true, ozelRol: { select: { kapaliKutular: true } } },
    }));
  } catch {
    throw new KullaniciBaglamiHatasi("okunamadi", "Kullanıcı yetkisi okunamadı; işlem yapılmadı.");
  }
  if (!k) throw new KullaniciBaglamiHatasi("bulunamadi", "İşi başlatan kullanıcı bulunamadı; işlem yapılmadı.");
  if (!k.aktif) throw new KullaniciBaglamiHatasi("pasif", "İşi başlatan kullanıcı artık etkin değil; işlem yapılmadı.");
  return {
    tenantId,
    userId,
    rol: k.rol as Rol,
    ...(k.ozelRolId ? { ozelRol: { id: k.ozelRolId, kapali: k.ozelRol?.kapaliKutular ?? [] } } : {}),
  };
}

/** Kullanıcının güncel yetkisiyle çalıştırır (AI-95). */
export async function kullaniciAdinaCalistir<T>(prisma: PrismaService, tenantId: string, userId: string, is: () => Promise<T>): Promise<T> {
  return baglamlaCalistir(await kullaniciBaglami(prisma, tenantId, userId), is);
}
