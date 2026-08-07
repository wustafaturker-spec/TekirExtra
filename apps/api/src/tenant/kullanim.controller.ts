import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

const geriBildirimSemasi = z.object({
  puan: z.number().int().min(1).max(5),
  kategori: z.enum(["genel", "kullanilabilirlik", "hata", "oneri"]),
  mesaj: z.string().trim().max(1000).optional(),
});

const olaySemasi = z.object({
  olay: z.enum(["fatura_form_acildi", "fatura_tamamlandi", "fatura_dogrulama_hatasi", "fatura_form_terk", "gorunum_kaydedildi", "gorunum_kullanildi"]),
  sureMs: z.number().int().min(0).max(86_400_000).optional(),
});

@Controller("kullanim")
export class KullanimController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("olay")
  async olay(@Body() govde: unknown) {
    const sonuc = olaySemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException("Geçersiz kullanım olayı");
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.auditLog.create({ data: {
      tenantId, userId, varlik: "kullanim", islem: sonuc.data.olay,
      detay: sonuc.data.sureMs === undefined ? undefined : { sureMs: sonuc.data.sureMs },
    } }));
    return { kaydedildi: true };
  }

  @Post("geri-bildirim")
  async geriBildirim(@Body() govde: unknown) {
    const sonuc = geriBildirimSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException("Geçersiz geri bildirim");
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.auditLog.create({ data: {
      tenantId, userId, varlik: "kullanim", islem: "geri_bildirim", detay: sonuc.data,
    } }));
    return { kaydedildi: true };
  }

  @Get("ozet")
  @Roller("yonetici")
  async ozet() {
    const { tenantId } = aktifBaglam();
    const baslangic = new Date(Date.now() - 30 * 86_400_000);
    const { kayitlar, kullanicilar } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const [kayitlar, kullanicilar] = await Promise.all([
        tx.auditLog.findMany({
          where: { varlik: "kullanim", createdAt: { gte: baslangic } },
          select: { islem: true, userId: true, detay: true },
          take: 20_000,
        }),
        tx.user.findMany({ select: { id: true, rol: true }, where: { aktif: true } }),
      ]);
      return { kayitlar, kullanicilar };
    });
    const say = (olay: string) => kayitlar.filter((kayit) => kayit.islem === olay).length;
    const sureler = kayitlar.filter((kayit) => kayit.islem === "fatura_tamamlandi").map((kayit) => {
      const detay = kayit.detay as { sureMs?: unknown } | null;
      return typeof detay?.sureMs === "number" ? detay.sureMs : null;
    }).filter((sure): sure is number => sure !== null).sort((a, b) => a - b);
    const orta = Math.floor(sureler.length / 2);
    const ortancaSureMs = sureler.length ? (sureler.length % 2 ? sureler[orta] : (sureler[orta - 1] + sureler[orta]) / 2) : null;
    const acilan = say("fatura_form_acildi"); const tamamlanan = say("fatura_tamamlandi");
    const terk = say("fatura_form_terk");
    const geriBildirimler = kayitlar.filter((kayit) => kayit.islem === "geri_bildirim").map((kayit) => kayit.detay as { puan?: unknown; kategori?: unknown } | null);
    const puanlar = geriBildirimler.map((detay) => detay?.puan).filter((puan): puan is number => typeof puan === "number");
    const kategoriSayilari = Object.fromEntries(["genel", "kullanilabilirlik", "hata", "oneri"].map((kategori) => [kategori, geriBildirimler.filter((detay) => detay?.kategori === kategori).length]));
    const rolKirilimi = (["yonetici", "muhasebe", "satis", "salt_okunur"] as const).map((rol) => {
      const kullaniciIdleri = new Set(kullanicilar.filter((kullanici) => kullanici.rol === rol).map((kullanici) => kullanici.id));
      const olaylar = kayitlar.filter((kayit) => kayit.userId && kullaniciIdleri.has(kayit.userId));
      const rolSay = (olay: string) => olaylar.filter((kayit) => kayit.islem === olay).length;
      return {
        rol,
        kullaniciSayisi: kullaniciIdleri.size,
        aktifKullanici: new Set(olaylar.map((kayit) => kayit.userId)).size,
        toplamOlay: olaylar.length,
        tamamlananFatura: rolSay("fatura_tamamlandi"),
        kullanilanGorunum: rolSay("gorunum_kullanildi"),
      };
    }).filter((satir) => satir.kullaniciSayisi > 0 || satir.toplamOlay > 0);
    return {
      donemGun: 30,
      aktifKullanici: new Set(kayitlar.map((kayit) => kayit.userId).filter(Boolean)).size,
      toplamOlay: kayitlar.length,
      rolKirilimi,
      geriBildirim: { yanit: geriBildirimler.length, ortalamaPuan: puanlar.length ? puanlar.reduce((toplam, puan) => toplam + puan, 0) / puanlar.length : null, kategoriler: kategoriSayilari },
      fatura: { acilan, tamamlanan, ortancaSureMs, terkOrani: tamamlanan + terk ? terk / (tamamlanan + terk) : 0, dogrulamaHatasi: say("fatura_dogrulama_hatasi") },
      gorunum: { kaydedilen: say("gorunum_kaydedildi"), kullanilan: say("gorunum_kullanildi") },
    };
  }
}
