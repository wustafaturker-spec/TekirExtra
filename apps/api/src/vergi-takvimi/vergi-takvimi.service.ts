import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { bugunTR, VERGI_TAKVIMI_TURU, vergiDonemAylari, VERGI_YUKUMLULUK_ADLARI } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { vergiTakvimiOku } from "./vergi-takvimi.okuma";
import type { vergiAyarSemasi, vergiBeyanSemasi, vergiHareketSorguSemasi, vergiOdemeSemasi } from "./vergi-takvimi.semalar";

type Tx = Prisma.TransactionClient;

/** VTK: takvim yalnız işaret tutar; para hareketi ve muhasebe fişi üretmez. */
@Injectable()
export class VergiTakvimiService {
  constructor(private readonly prisma: PrismaService) {}

  private iz(tx: Tx, islem: string, varlikId: string | null, detay: Prisma.InputJsonValue) {
    const { tenantId, userId } = aktifBaglam();
    return tx.auditLog.create({ data: { tenantId, userId, islem, varlik: "vergi_takvimi", varlikId, detay } });
  }

  private ucAylikYayinli(tx: Tx, bugun: string) {
    return tx.mevzuatKayit.count({ where: { tur: VERGI_TAKVIMI_TURU, anahtar: { startsWith: "muhtasar3:" }, yururlukBaslangic: { lte: new Date(`${bugun}T00:00:00Z`) }, yururlukBitis: null } });
  }

  async liste(yil: number) {
    const { tenantId, rol } = aktifBaglam();
    const bugun = bugunTR();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [sonuc, ucAylik] = await Promise.all([
        vergiTakvimiOku(tx, tenantId, { ilk: { yil, ay: 1 }, son: { yil, ay: 12 }, bugun }),
        this.ucAylikYayinli(tx, bugun),
      ]);
      return { yil, bugun, ayar: sonuc.ayar, ucAylikAcik: ucAylik > 0, yazabilir: ["yonetici", "muhasebe"].includes(rol ?? ""), satirlar: sonuc.satirlar };
    });
  }

  async ayarKaydet(g: z.infer<typeof vergiAyarSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (g.muhtasarDonemi === "uc_aylik" && !(await this.ucAylikYayinli(tx, bugunTR()))) {
        throw new BadRequestException("Üç aylık muhtasar tarihleri henüz yayınlanmadı; bu seçenek platform takvimi yayınlanınca açılır");
      }
      const veri = { baslangicYil: g.baslangicYil, baslangicAy: g.baslangicAy, devredenKdv: new Prisma.Decimal(g.devredenKdv), muhtasarDonemi: g.muhtasarDonemi, guncelleyenId: userId };
      await tx.vergiTakvimiAyari.upsert({ where: { tenantId }, create: { tenantId, ...veri }, update: veri });
      await this.iz(tx, "VERGI_TAKVIMI_AYAR", null, { ...g });
      return { kaydedildi: true };
    });
  }

  private donemiDenetle(g: { yukumluluk: Parameters<typeof vergiDonemAylari>[0]; ay: number }) {
    if (!vergiDonemAylari(g.yukumluluk).includes(g.ay)) throw new BadRequestException(`${VERGI_YUKUMLULUK_ADLARI[g.yukumluluk]} için geçersiz dönem`);
  }

  private kayit(tx: Tx, tenantId: string, g: { yukumluluk: string; yil: number; ay: number }) {
    return tx.vergiYukumlulukKaydi.upsert({
      where: { tenantId_yukumluluk_yil_ay: { tenantId, yukumluluk: g.yukumluluk, yil: g.yil, ay: g.ay } },
      create: { tenantId, yukumluluk: g.yukumluluk, yil: g.yil, ay: g.ay },
      update: {},
    });
  }

  /** VTK-09: boş tutar beyanı kaldırır; hesaplanan her durumda görünür kalır. */
  async beyanKaydet(g: z.infer<typeof vergiBeyanSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    this.donemiDenetle(g);
    if (g.beyanDevreden != null && g.yukumluluk !== "kdv1") throw new BadRequestException("Sonraki döneme devreden yalnız KDV-1 için girilir");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await this.kayit(tx, tenantId, g);
      const beyan = g.beyanTutari === null ? null : new Prisma.Decimal(g.beyanTutari);
      await tx.vergiYukumlulukKaydi.update({
        where: { id: k.id },
        data: { beyanTutari: beyan, beyanDevreden: beyan === null || g.beyanDevreden == null ? null : new Prisma.Decimal(g.beyanDevreden), beyanNotu: beyan === null ? null : g.beyanNotu || null, beyanGirenId: userId },
      });
      await this.iz(tx, "VERGI_BEYAN_TUTARI", k.id, { ...g, oncekiBeyan: k.beyanTutari?.toString() ?? null });
      return { kaydedildi: true };
    });
  }

  /** VTK-10: ödeme işareti; hareket verildiyse aynı firmanın bağlanmamış tediyesi olmalıdır. */
  async odemeEkle(g: z.infer<typeof vergiOdemeSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    this.donemiDenetle(g);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (g.kasaBankaHareketId) {
        const h = await tx.kasaBankaHareket.findFirst({ where: { id: g.kasaBankaHareketId, tenantId }, select: { tip: true, vergiOdemesi: { select: { id: true } } } });
        if (!h) throw new NotFoundException("Kasa/banka hareketi bulunamadı");
        if (h.tip !== "tediye") throw new BadRequestException("Yalnız ödeme (tediye) hareketi bağlanabilir");
        if (h.vergiOdemesi) throw new ConflictException("Bu hareket başka bir kaleme bağlı");
      }
      const k = await this.kayit(tx, tenantId, g);
      const o = await tx.vergiOdemesi.create({ data: { tenantId, kayitId: k.id, tarih: new Date(`${g.tarih}T00:00:00Z`), tutar: new Prisma.Decimal(g.tutar), kasaBankaHareketId: g.kasaBankaHareketId || null, not: g.not || null, kullaniciId: userId } });
      await this.iz(tx, "VERGI_ODEME_ISARETLE", o.id, { ...g });
      return { id: o.id };
    });
  }

  async odemeSil(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const o = await tx.vergiOdemesi.findFirst({ where: { id, tenantId }, include: { kayit: { select: { yukumluluk: true, yil: true, ay: true } } } });
      if (!o) throw new NotFoundException("Ödeme işareti bulunamadı");
      await tx.vergiOdemesi.delete({ where: { id } });
      await this.iz(tx, "VERGI_ODEME_GERI_AL", id, { ...o.kayit, tarih: o.tarih.toISOString().slice(0, 10), tutar: o.tutar.toString() });
      return { silindi: true };
    });
  }

  /** Bağlanabilecek hareketler: henüz kaleme bağlanmamış tediyeler. */
  async hareketler(g: z.infer<typeof vergiHareketSorguSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const liste = await tx.kasaBankaHareket.findMany({
        where: { tenantId, tip: "tediye", tarih: { gte: new Date(`${g.baslangic}T00:00:00Z`), lte: new Date(`${g.bitis}T00:00:00Z`) }, vergiOdemesi: null },
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        take: 100,
        select: { id: true, tarih: true, tutarTry: true, aciklama: true, kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true } } },
      });
      return liste.map((h) => ({ id: h.id, tarih: h.tarih.toISOString().slice(0, 10), tutar: Number(h.tutarTry), aciklama: h.aciklama, hesap: h.kasa?.ad ?? h.bankaHesap?.ad ?? null }));
    });
  }
}
