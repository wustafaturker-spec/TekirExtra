import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { Rol } from "@tekirextra/shared";
import { ikiAdimEksikMi } from "../../core/guvenlik-politikasi";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";

const ON_EK = "tkx_";
const EN_COK_ETKIN_ANAHTAR = 10;
/** Asistanı kullanamayan roller MCP anahtarıyla da giremez. */
const MCP_KAPALI_ROLLER: Rol[] = ["calisan", "b2b_bayi"];

const ozetle = (anahtar: string) => createHash("sha256").update(anahtar).digest("hex");

/** `tkx_<kiracı kimliği, tiresiz>_<rastgele>`; kiracı kısmı yalnız RLS kapsamını bulmak için. */
function kiraciCoz(anahtar: string): string | null {
  const m = /^tkx_([0-9a-f]{32})_[A-Za-z0-9_-]{40,}$/.exec(anahtar);
  if (!m) return null;
  const h = m[1];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface McpKimligi {
  tenantId: string;
  userId: string;
  rol: Rol;
  anahtarId: string;
}

/**
 * AI-09: kullanıcı başına MCP erişim anahtarları. Anahtar bir kez gösterilir,
 * yalnız SHA-256 özeti saklanır. Anahtar o kullanıcının güncel rolüyle çalışır;
 * kullanıcı pasifleşirse ya da anahtar iptal edilirse istek reddedilir.
 */
@Injectable()
export class McpAnahtarService {
  constructor(private readonly prisma: PrismaService) {}

  async olustur(ad: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    if (MCP_KAPALI_ROLLER.includes(rol)) throw new ForbiddenException("Bu rol MCP anahtarı oluşturamaz.");
    const temizAd = (ad ?? "").trim();
    if (temizAd.length < 2 || temizAd.length > 60) throw new BadRequestException("Anahtar adı 2–60 karakter olmalıdır.");
    const anahtar = `${ON_EK}${tenantId.replace(/-/g, "")}_${randomBytes(32).toString("base64url")}`;
    const kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const etkin = await tx.aiMcpAnahtari.count({ where: { userId, iptalAt: null } });
      if (etkin >= EN_COK_ETKIN_ANAHTAR) throw new BadRequestException(`En çok ${EN_COK_ETKIN_ANAHTAR} etkin anahtarınız olabilir; kullanmadığınızı iptal edin.`);
      return tx.aiMcpAnahtari.create({ data: { tenantId, userId, ad: temizAd, onEk: `${anahtar.slice(0, 8)}…${anahtar.slice(-4)}`, ozet: ozetle(anahtar) } });
    });
    return { id: kayit.id, ad: kayit.ad, onEk: kayit.onEk, createdAt: kayit.createdAt, anahtar };
  }

  /** Kendi anahtarları; yönetici kiracıdaki bütün anahtarları görür. */
  async listele() {
    const { tenantId, userId, rol } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.aiMcpAnahtari.findMany({
        where: rol === "yonetici" ? {} : { userId },
        orderBy: { createdAt: "desc" },
        include: { user: { select: { adSoyad: true } } },
      }),
    );
    return kayitlar.map((k) => ({
      id: k.id, ad: k.ad, onEk: k.onEk, kullanici: k.user.adSoyad, kendi: k.userId === userId,
      createdAt: k.createdAt, sonKullanim: k.sonKullanim, iptalAt: k.iptalAt,
    }));
  }

  async iptal(id: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.aiMcpAnahtari.findUnique({ where: { id } });
      if (!k) throw new NotFoundException("Anahtar bulunamadı");
      if (k.userId !== userId && rol !== "yonetici") throw new ForbiddenException("Yalnız kendi anahtarınızı iptal edebilirsiniz.");
      if (k.iptalAt) return { id, iptalAt: k.iptalAt };
      const g = await tx.aiMcpAnahtari.update({ where: { id }, data: { iptalAt: new Date() } });
      return { id, iptalAt: g.iptalAt };
    });
  }

  /** MCP isteğindeki anahtarı çözer; geçersiz, iptal edilmiş ya da kullanıcısı pasifse null. */
  async dogrula(anahtar: string): Promise<McpKimligi | null> {
    const tenantId = kiraciCoz(anahtar);
    if (!tenantId) return null;
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.aiMcpAnahtari.findUnique({ where: { ozet: ozetle(anahtar) }, include: { user: { select: { rol: true, aktif: true, totpAktif: true } } } });
      if (!k || k.tenantId !== tenantId || k.iptalAt || !k.user.aktif) return null;
      const rol = k.user.rol as Rol;
      if (MCP_KAPALI_ROLLER.includes(rol)) return null;
      // KLN-21: 2FA zorunlu rolde kurulumu bitmemiş kullanıcının anahtarı da çalışmaz.
      const politika = await tx.tenant.findUnique({ where: { id: tenantId }, select: { ikiAdimZorunluRoller: true } });
      if (politika && ikiAdimEksikMi(politika, rol, k.user.totpAktif)) return null;
      if (!k.sonKullanim || Date.now() - k.sonKullanim.getTime() > 60_000) {
        await tx.aiMcpAnahtari.update({ where: { id: k.id }, data: { sonKullanim: new Date() } });
      }
      return { tenantId, userId: k.userId, rol, anahtarId: k.id };
    });
  }
}
