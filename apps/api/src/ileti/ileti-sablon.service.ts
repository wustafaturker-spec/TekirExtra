import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { aktifBaglam, aktifPlatformBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { SABLONLAR, sablonDogrula, sablonDoldur, sablonTanimi, type SablonDegerleri, type SablonIstegi, type SablonSonucu, type SablonTanimi } from "./ileti-sablonlari";
import { smsParcaSayisi } from "./sms-kurallari";

export const sablonGirdiSemasi = z.object({ konu: z.string().max(400).nullable().optional(), metin: z.string().max(20_000) });
type SablonGirdisi = z.infer<typeof sablonGirdiSemasi>;
type OzelSablon = { konu: string | null; metin: string };

/** Sistem şablonu firma ekranından, firma şablonu platform ekranından okunamaz ve yazılamaz. */
const gorunum = (t: SablonTanimi, ozel: OzelSablon | undefined) => ({
  tur: t.tur, ad: t.ad, kanal: t.kanal, kategori: t.kategori, degiskenler: Object.keys(t.degiskenler), zorunlu: t.zorunlu ?? [],
  varsayilan: { konu: t.konu ?? null, metin: t.metin }, ozel: ozel ? { konu: ozel.konu, metin: ozel.metin } : null,
});

@Injectable()
export class IletiSablonService {
  constructor(private readonly prisma: PrismaService, private readonly platform: PlatformPrismaService) {}

  private get platformEtkin() { return Boolean(process.env.DATABASE_URL_PLATFORM); }
  private firmaTanimi(tur: string) { const t = sablonTanimi(tur); if (t.kategori === "sistem") throw new BadRequestException("Sistem şablonu firma tarafından değiştirilemez"); return t; }

  /** İleti metnini üretir. `tx` verilirse firma şablonu o işlem içinde okunur. */
  async uret(istek: SablonIstegi, tenantId?: string | null, tx?: Prisma.TransactionClient): Promise<SablonSonucu> {
    const t = sablonTanimi(istek.tur);
    return sablonDoldur(t, await this.ozelOku(t, tenantId, tx), istek.degiskenler);
  }

  private async ozelOku(t: SablonTanimi, tenantId?: string | null, tx?: Prisma.TransactionClient): Promise<OzelSablon | null> {
    if (t.kategori === "sistem") return this.platformEtkin ? this.platform.db.platformIletiSablonu.findUnique({ where: { tur: t.tur } }) : null;
    if (!tenantId) return null;
    const oku = (c: Prisma.TransactionClient) => c.iletiSablonu.findUnique({ where: { tenantId_tur: { tenantId, tur: t.tur } } });
    return tx ? oku(tx) : this.prisma.tenantIslem(tenantId, oku);
  }

  private onizlemeSonucu(t: SablonTanimi, g: SablonGirdisi) {
    const temiz = sablonDogrula(t, g);
    const sonuc = sablonDoldur(t, temiz, t.degiskenler as SablonDegerleri);
    return { konu: sonuc.konu, metin: sonuc.metin, karakter: sonuc.metin.length, parca: t.kanal === "sms" ? smsParcaSayisi(sonuc.metin) : null };
  }

  // ─── firma ────────────────────────────────────────────────────────────────
  async firmaListesi() {
    const { tenantId } = aktifBaglam();
    const ozeller = await this.prisma.tenantIslem(tenantId, (tx) => tx.iletiSablonu.findMany());
    const harita = new Map(ozeller.map((o) => [o.tur, o]));
    return SABLONLAR.filter((t) => t.kategori !== "sistem").map((t) => gorunum(t, harita.get(t.tur)));
  }

  firmaOnizle(tur: string, g: SablonGirdisi) { return this.onizlemeSonucu(this.firmaTanimi(tur), g); }

  async firmaKaydet(tur: string, g: SablonGirdisi) {
    const { tenantId, userId } = aktifBaglam();
    const veri = { ...sablonDogrula(this.firmaTanimi(tur), g), guncelleyenId: userId };
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.iletiSablonu.upsert({ where: { tenantId_tur: { tenantId, tur } }, create: { tenantId, tur, ...veri }, update: veri });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "ileti_sablonu_degisti", varlik: "ileti_sablonu", detay: { tur } } });
    });
    return this.firmaListesi();
  }

  async firmaSifirla(tur: string) {
    const { tenantId, userId } = aktifBaglam();
    this.firmaTanimi(tur);
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.iletiSablonu.deleteMany({ where: { tur } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "ileti_sablonu_sifirlandi", varlik: "ileti_sablonu", detay: { tur } } });
    });
    return this.firmaListesi();
  }

  // ─── platform ─────────────────────────────────────────────────────────────
  private sistemTanimi(tur: string) { const t = sablonTanimi(tur); if (t.kategori !== "sistem") throw new BadRequestException("Firma şablonu platformdan değiştirilemez"); return t; }

  async platformListesi() {
    const ozeller = await this.platform.db.platformIletiSablonu.findMany();
    const harita = new Map(ozeller.map((o) => [o.tur, o]));
    return SABLONLAR.filter((t) => t.kategori === "sistem").map((t) => gorunum(t, harita.get(t.tur)));
  }

  platformOnizle(tur: string, g: SablonGirdisi) { return this.onizlemeSonucu(this.sistemTanimi(tur), g); }

  async platformKaydet(tur: string, g: SablonGirdisi) {
    const { kullaniciId } = aktifPlatformBaglam();
    const temiz = sablonDogrula(this.sistemTanimi(tur), g);
    const veri = { konu: temiz.konu ?? "", metin: temiz.metin, guncelleyenId: kullaniciId };
    await this.platform.db.$transaction(async (tx) => {
      await tx.platformIletiSablonu.upsert({ where: { tur }, create: { tur, ...veri }, update: veri });
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "ileti_sablonu_degisti", detay: { tur } } });
    });
    return this.platformListesi();
  }

  async platformSifirla(tur: string) {
    const { kullaniciId } = aktifPlatformBaglam();
    this.sistemTanimi(tur);
    await this.platform.db.$transaction(async (tx) => {
      await tx.platformIletiSablonu.deleteMany({ where: { tur } });
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "ileti_sablonu_sifirlandi", detay: { tur } } });
    });
    return this.platformListesi();
  }
}
