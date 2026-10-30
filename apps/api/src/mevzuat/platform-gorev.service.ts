import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PlatformGorevDurumu, PlatformGorevKapsami, PlatformGorevOnceligi, Prisma } from "@prisma/client";
import { bugunTR } from "@tekirextra/shared";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformPrismaService } from "./platform-prisma.service";

export interface GorevGirdisi {
  baslik: string; aciklama: string | null; kapsam: PlatformGorevKapsami; oncelik: PlatformGorevOnceligi;
  sonTarih: string | null; sorumluId: string | null; degisiklikId: string | null;
}
export type GorevGuncellemesi = Partial<Omit<GorevGirdisi, "kapsam">> & { surum: number; durum?: PlatformGorevDurumu };
export interface GorevFiltresi {
  durum: "hepsi" | "acik_isler" | PlatformGorevDurumu; arama: string; benim: boolean; geciken: boolean; sayfa: number;
}
const ACIK: PlatformGorevDurumu[] = ["acik", "devam_ediyor"];
const ILISKILER = {
  sorumlu: { select: { id: true, adSoyad: true, rol: true, aktif: true } },
  olusturan: { select: { id: true, adSoyad: true } },
  degisiklik: { select: { id: true, no: true, baslik: true, durum: true } },
} as const;
type Gorev = Prisma.PlatformGorevGetPayload<{ include: typeof ILISKILER }>;
const gorunum = (g: Gorev) => ({ ...g, sonTarih: g.sonTarih?.toISOString().slice(0, 10) ?? null });
const tarih = (s: string | null) => s ? new Date(`${s}T00:00:00.000Z`) : null;

@Injectable()
export class PlatformGorevService {
  constructor(private readonly platform: PlatformPrismaService) {}
  private kapsam(): Prisma.PlatformGorevWhereInput { return aktifPlatformBaglam().rol === "mevzuat_editoru" ? { kapsam: "mevzuat" } : {}; }

  async listele(f: GorevFiltresi) {
    const { kullaniciId } = aktifPlatformBaglam();
    const temel = this.kapsam();
    const bugun = bugunTR();
    const geciken = { ...temel, durum: { in: ACIK }, sonTarih: { lt: tarih(bugun)! } } satisfies Prisma.PlatformGorevWhereInput;
    const where: Prisma.PlatformGorevWhereInput = {
      ...temel,
      ...(f.durum === "hepsi" ? {} : { durum: f.durum === "acik_isler" ? { in: ACIK } : f.durum }),
      ...(f.benim ? { sorumluId: kullaniciId } : {}),
      ...(f.arama ? { OR: [{ baslik: { contains: f.arama, mode: "insensitive" } }, { aciklama: { contains: f.arama, mode: "insensitive" } }] } : {}),
      ...(f.geciken ? { AND: [{ sonTarih: geciken.sonTarih, durum: { in: ACIK } }] } : {}),
    };
    const db = this.platform.db;
    const [kayitlar, toplam, gruplar, gecikenSayisi] = await Promise.all([
      db.platformGorev.findMany({ where, include: ILISKILER, orderBy: [{ sonTarih: { sort: "asc", nulls: "last" } }, { oncelik: "desc" }, { updatedAt: "desc" }, { id: "asc" }], skip: (f.sayfa - 1) * 25, take: 25 }),
      db.platformGorev.count({ where }),
      db.platformGorev.groupBy({ by: ["durum"], where: temel, _count: { _all: true } }),
      db.platformGorev.count({ where: geciken }),
    ]);
    const sayilar = { acik: 0, devam_ediyor: 0, tamamlandi: 0, iptal: 0, geciken: gecikenSayisi };
    for (const g of gruplar) sayilar[g.durum] = g._count._all;
    return { kayitlar: kayitlar.map(gorunum), toplam, sayfa: f.sayfa, sayfaBoyutu: 25, sayilar, bugun };
  }

  katilimcilar() {
    return this.platform.db.platformKullanici.findMany({ where: { aktif: true, davetTuru: null }, select: { id: true, adSoyad: true, rol: true }, orderBy: [{ adSoyad: "asc" }, { id: "asc" }] });
  }

  async getir(id: string) {
    const g = await this.platform.db.platformGorev.findFirst({ where: { id, ...this.kapsam() }, include: ILISKILER });
    if (!g) throw new NotFoundException("Görev bulunamadı.");
    return gorunum(g);
  }

  private async baglariDogrula(tx: Prisma.TransactionClient, kapsam: PlatformGorevKapsami, sorumluId?: string | null, degisiklikId?: string | null) {
    if (sorumluId) {
      const k = await tx.platformKullanici.findFirst({ where: { id: sorumluId, aktif: true, davetTuru: null }, select: { rol: true } });
      if (!k) throw new BadRequestException("Sorumlu, kurulumu tamamlanmış aktif bir platform kullanıcısı olmalı.");
      if (kapsam === "platform" && k.rol !== "yonetici") throw new BadRequestException("Platform görevine yalnız platform yöneticisi atanabilir.");
    }
    if (degisiklikId) {
      if (kapsam !== "mevzuat") throw new BadRequestException("Mevzuat değişikliği yalnız mevzuat görevine bağlanabilir.");
      if (!await tx.mevzuatDegisiklik.findUnique({ where: { id: degisiklikId }, select: { id: true } })) throw new BadRequestException("Bağlanacak mevzuat değişikliği bulunamadı.");
    }
  }

  async olustur(g: GorevGirdisi) {
    const { kullaniciId, rol } = aktifPlatformBaglam();
    if (rol === "mevzuat_editoru" && g.kapsam !== "mevzuat") throw new ForbiddenException("Editörler yalnız mevzuat görevi oluşturabilir.");
    return this.platform.db.$transaction(async (tx) => {
      await this.baglariDogrula(tx, g.kapsam, g.sorumluId, g.degisiklikId);
      const yeni = await tx.platformGorev.create({ data: { ...g, sonTarih: tarih(g.sonTarih), olusturanId: kullaniciId }, include: ILISKILER });
      await tx.mevzuatOlay.create({ data: { kullaniciId, degisiklikId: g.kapsam === "mevzuat" ? g.degisiklikId : null, olay: `${g.kapsam}_gorevi_olusturuldu`, detay: { gorevId: yeni.id, baslik: g.baslik, sorumluId: g.sorumluId, sonTarih: g.sonTarih, oncelik: g.oncelik } } });
      return gorunum(yeni);
    });
  }

  async guncelle(id: string, g: GorevGuncellemesi) {
    const { kullaniciId } = aktifPlatformBaglam();
    return this.platform.db.$transaction(async (tx) => {
      const eski = await tx.platformGorev.findFirst({ where: { id, ...this.kapsam() } });
      if (!eski) throw new NotFoundException("Görev bulunamadı.");
      if (eski.surum !== g.surum) throw new ConflictException("Görev başka biri tarafından değiştirildi. Güncel kaydı açıp tekrar deneyin.");
      await this.baglariDogrula(tx, eski.kapsam, g.sorumluId, g.degisiklikId);
      const { surum, sonTarih, ...alanlar } = g;
      const kapanisAt = g.durum && g.durum !== eski.durum ? (g.durum === "tamamlandi" || g.durum === "iptal" ? new Date() : null) : eski.kapanisAt;
      const sonuc = await tx.platformGorev.updateMany({ where: { id, surum }, data: { ...alanlar, ...(sonTarih !== undefined ? { sonTarih: tarih(sonTarih) } : {}), kapanisAt, surum: { increment: 1 } } });
      if (sonuc.count !== 1) throw new ConflictException("Görev başka biri tarafından değiştirildi. Güncel kaydı açıp tekrar deneyin.");
      await tx.mevzuatOlay.create({ data: { kullaniciId, degisiklikId: eski.kapsam === "mevzuat" ? (g.degisiklikId !== undefined ? g.degisiklikId : eski.degisiklikId) : null, olay: `${eski.kapsam}_gorevi_guncellendi`, detay: { gorevId: id, baslik: g.baslik ?? eski.baslik, oncekiDurum: eski.durum, yeniDurum: g.durum ?? eski.durum, surum: surum + 1 } } });
      const yeni = await tx.platformGorev.findUniqueOrThrow({ where: { id }, include: ILISKILER });
      return gorunum(yeni);
    });
  }
}
