import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { Rol } from "@tekirextra/shared";
import { BildirimService } from "../bildirimler/bildirim.service";
import { planOzelligiAcik } from "../core/abonelik-erisim.service";
import { baglamlaCalistir } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { endeksIcgorusu, fiyatEndeksOzeti } from "./endeks-icgoru";
import { FIYAT_ENDEKS_MODULU, FIYAT_ENDEKS_VARSAYILAN, fiyatEndeksAyariSemasi } from "./fiyat-endeks-erisim";
import { SISTEM_USER_ID } from "../core/sistem-kimligi";


/**
 * END-22: yeni endeks dönemi açıklanınca, fiyat–endeks plan özelliği açık
 * her firmada ilgili rollere (yönetici + yöneticinin seçtiği satış/alış
 * rolleri) tek bildirim üretilir ve deterministik bulgular içgörü olarak
 * yazılır. Bildirim seri+dönem birleşim anahtarıyla, içgörü aynı tekil
 * anahtarla tekrar etmez. Hesapta model yoktur.
 */
@Injectable()
export class EndeksDuyurusuService {
  private readonly logger = new Logger(EndeksDuyurusuService.name);
  constructor(private readonly prisma: PrismaService, private readonly bildirimler: BildirimService) {}

  private async firmalar(): Promise<string[]> {
    const url = process.env.DATABASE_URL_MIGRATE;
    if (!url) throw new Error("Endeks duyurusu için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: url });
    try { return (await yonetim.tenant.findMany({ select: { id: true } })).map((t) => t.id); } finally { await yonetim.$disconnect(); }
  }

  private async roller(tx: Prisma.TransactionClient, tenantId: string): Promise<string[]> {
    const kayit = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: FIYAT_ENDEKS_MODULU } }, select: { ayarlar: true } });
    const ayar = fiyatEndeksAyariSemasi.safeParse(kayit?.ayarlar ?? FIYAT_ENDEKS_VARSAYILAN);
    const a = ayar.success ? ayar.data : FIYAT_ENDEKS_VARSAYILAN;
    return [...new Set(["yonetici", ...a.satisRolleri, ...a.alisRolleri])];
  }

  /** Yeni açıklanan dönemler için; döndürdüğü sayı bildirim üretilen firma sayısıdır. */
  async duyur(yeniler: { kod: string; ad: string; donem: string }[]): Promise<number> {
    if (!yeniler.length) return 0;
    let firmaSayisi = 0;
    for (const tenantId of await this.firmalar()) {
      try {
        const hazir = await this.prisma.tenantIslem(tenantId, async (tx) => (await planOzelligiAcik(tx, tenantId, "fiyatEndeksAnalizi")) ? this.roller(tx, tenantId) : null);
        if (!hazir) continue;
        firmaSayisi++;
        await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, async () => {
          for (const y of yeniler) {
            await this.bildirimler.uret({
              tur: "stok", onem: "bilgi",
              baslik: `${y.ad} ${y.donem.slice(0, 7)} açıklandı`,
              aciklama: "Fiyat ve endeks ekranları ile raporlar yeni değerle güncellendi. Bulgular İçgörüler'de; ürün fiyatlarınızı ve tekliflerinizi gözden geçirin.",
              birlesimAnahtari: `endeks-aciklandi:${y.kod}:${y.donem}`,
              kaynakTur: "endeks_serisi", kaynakRef: y.kod,
              hedefYol: "/panel/raporlar?rapor=stok.fiyat_endeks",
              roller: hazir as Rol[],
            });
          }
          // İçgörü: bütün tarafları gören sistem bağlamıyla; firma başına seri+dönem tektir.
          const icerik = await this.prisma.tenantIslem(tenantId, (tx) => fiyatEndeksOzeti(tx, tenantId, { satis: true, alis: true }), { timeout: 120_000 })
            .then((o) => endeksIcgorusu(o, yeniler[0]));
          const tekilAnahtar = `fiyat-endeks:${yeniler.map((y) => `${y.kod}:${y.donem}`).join(",")}`.slice(0, 120);
          const veri = { userId: SISTEM_USER_ID, onem: icerik.onem, durum: "yeni", baslik: icerik.baslik, ozet: icerik.ozet, metrikler: icerik.metrikler as Prisma.InputJsonValue, bulgular: icerik.bulgular as unknown as Prisma.InputJsonValue, kanitlar: icerik.kanitlar as unknown as Prisma.InputJsonValue, varsayimlar: icerik.varsayimlar, uyarilar: icerik.uyarilar, hesaplandiAt: new Date() };
          await this.prisma.tenantIslem(tenantId, (tx) => tx.aiIcgoru.upsert({ where: { tenantId_tekilAnahtar: { tenantId, tekilAnahtar } }, create: { tenantId, gorevId: null, tekilAnahtar, ...veri }, update: {} }));
        });
      } catch (hata) {
        this.logger.warn(`Endeks duyurusu (${tenantId}) üretilemedi: ${hata instanceof Error ? hata.message : String(hata)}`);
      }
    }
    return firmaSayisi;
  }
}
