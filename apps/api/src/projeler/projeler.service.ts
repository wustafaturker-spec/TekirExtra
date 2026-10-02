import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type {
  projeAltKirilimSemasi,
  projeAsamaSemasi,
  projeGuncelleSemasi,
  projeNotSemasi,
  projeOlusturSemasi,
} from "./projeler.semalar";

const D = (deger: string | number): Prisma.Decimal => new Prisma.Decimal(deger);

@Injectable()
export class ProjelerService {
  constructor(private readonly prisma: PrismaService) {}

  async secenekler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [cariler, kullanicilar] = await Promise.all([
        tx.cariHesap.findMany({
          where: { aktif: true },
          select: { id: true, kod: true, unvan: true },
          orderBy: { unvan: "asc" },
          take: 200,
        }),
        tx.user.findMany({
          where: { aktif: true },
          select: { id: true, adSoyad: true, eposta: true },
          orderBy: { adSoyad: "asc" },
        }),
      ]);
      return { cariler, kullanicilar };
    });
  }

  async listele(arama?: string, durum?: string) {
    const { tenantId } = aktifBaglam();
    const projeler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.proje.findMany({
        where: {
          tenantId,
          ...(durum ? { durum: durum as any } : {}),
          ...(arama
            ? {
                OR: [
                  { ad: { contains: arama, mode: "insensitive" } },
                  { kod: { contains: arama, mode: "insensitive" } },
                  { aciklama: { contains: arama, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }],
        include: {
          cari: { select: { id: true, unvan: true, kod: true } },
          sorumlu: { select: { id: true, adSoyad: true, eposta: true } },
          altKirilimlar: { select: { id: true, kod: true, ad: true, butceTutari: true, tip: true }, orderBy: { createdAt: "asc" } },
          _count: { select: { asamalar: true, altKirilimlar: true, notlarListesi: true } },
        },
      }),
    );

    // Bütün projelerin tutarları tek seferde toplanır (proje başına sorgu atılmaz).
    const tutarlar = await this.finansTutarlari("projeId", projeler.map((p) => p.id));
    const sonuclar = projeler.map((p) => {
        const finans = ProjelerService.finansOzeti(tutarlar.get(p.id)!);
        return {
          ...p,
          hedefGelir: p.hedefGelir.toString(),
          hedefGider: p.hedefGider.toString(),
          toplamGelir: finans.toplamGelir,
          toplamGider: finans.toplamGider,
          netKarZarar: finans.netKarZarar,
          gelirButceOrani: Number(p.hedefGelir) > 0 ? Math.round((Number(finans.toplamGelir) / Number(p.hedefGelir)) * 100) : null,
          giderButceOrani: Number(p.hedefGider) > 0 ? Math.round((Number(finans.toplamGider) / Number(p.hedefGider)) * 100) : null,
        };
      });

    return sonuclar;
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const proje = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.proje.findUnique({
        where: { id, tenantId },
        include: {
          cari: { select: { id: true, unvan: true, kod: true } },
          sorumlu: { select: { id: true, adSoyad: true, eposta: true } },
          asamalar: { orderBy: { sira: "asc" } },
          altKirilimlar: { orderBy: { kod: "asc" } },
          notlarListesi: {
            orderBy: { createdAt: "desc" },
            include: { user: { select: { id: true, adSoyad: true } } },
          },
        },
      }),
    );

    if (!proje) throw new NotFoundException("Proje bulunamadı");

    const finans = await this.projeFinansOzeti(id);
    const analitikKirilimlar = await this.analitikYevmiyeKirilimlari(id, proje.altKirilimlar);

    return {
      ...proje,
      hedefGelir: proje.hedefGelir.toString(),
      hedefGider: proje.hedefGider.toString(),
      finansalOzet: finans,
      analitikKirilimlar,
    };
  }

  /**
   * Proje kârlılığı tahakkuk esaslıdır ve **KDV hariç, TL'ye çevrilmiş**
   * tutarlarla hesaplanır: fatura satırının matrahı × fatura kuru (yalnız
   * kesinleşmiş faturalar; iadeler düşülür), masrafın matrahı × kuru, gelir
   * kaydının brütü × kuru. Kasa/banka hareketleri çift sayımı önlemek için
   * toplama girmez, nakit özeti olarak ayrıca döner.
   */
  private async finansTutarlari(alan: "projeId" | "projeAltKirilimId", idler: string[]) {
    const { tenantId } = aktifBaglam();
    const bos = () => ({ satis: D(0), satisIade: D(0), alis: D(0), alisIade: D(0), masraf: D(0), gelir: D(0), tahsilat: D(0), tediye: D(0) });
    const sonuc = new Map(idler.map((id) => [id, bos()]));
    if (idler.length === 0) return sonuc;
    const kosul = { [alan]: { in: idler } };
    const [satirlar, masraflar, gelirler, nakit] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.faturaSatir.findMany({
        where: { ...kosul, fatura: { durum: "kesin", tip: { in: ["satis", "satis_iade", "alis", "alis_iade"] } } },
        select: { projeId: true, projeAltKirilimId: true, matrah: true, fatura: { select: { tip: true, kur: true } } },
      }),
      tx.masraf.findMany({ where: { ...kosul, durum: "onaylandi" }, select: { projeId: true, projeAltKirilimId: true, matrah: true, kur: true } }),
      tx.gelirKaydi.findMany({ where: kosul, select: { projeId: true, projeAltKirilimId: true, brutTutar: true, kur: true } }),
      alan === "projeId"
        ? tx.kasaBankaHareket.groupBy({ by: ["projeId", "tip"], where: { projeId: { in: idler } }, _sum: { tutarTry: true } })
        : Promise.resolve([]),
    ]));
    const anahtar = (r: { projeId: string | null; projeAltKirilimId: string | null }) => r[alan] ?? "";
    const try_ = (tutar: Prisma.Decimal, kur: Prisma.Decimal) => tutar.mul(kur);
    for (const s of satirlar) {
      const t = sonuc.get(anahtar(s));
      if (!t) continue;
      const alanAdi = ({ satis: "satis", satis_iade: "satisIade", alis: "alis", alis_iade: "alisIade" } as const)[s.fatura.tip as "satis" | "satis_iade" | "alis" | "alis_iade"];
      t[alanAdi] = t[alanAdi].add(try_(s.matrah, s.fatura.kur));
    }
    for (const m of masraflar) { const t = sonuc.get(anahtar(m)); if (t) t.masraf = t.masraf.add(try_(m.matrah, m.kur)); }
    for (const g of gelirler) { const t = sonuc.get(anahtar(g)); if (t) t.gelir = t.gelir.add(try_(g.brutTutar, g.kur)); }
    for (const n of nakit) {
      const t = sonuc.get(n.projeId ?? "");
      if (!t) continue;
      if (n.tip === "tahsilat") t.tahsilat = t.tahsilat.add(n._sum.tutarTry ?? 0);
      if (n.tip === "tediye") t.tediye = t.tediye.add(n._sum.tutarTry ?? 0);
    }
    return sonuc;
  }

  private static finansOzeti(t: { satis: Prisma.Decimal; satisIade: Prisma.Decimal; alis: Prisma.Decimal; alisIade: Prisma.Decimal; masraf: Prisma.Decimal; gelir: Prisma.Decimal; tahsilat: Prisma.Decimal; tediye: Prisma.Decimal }) {
    const satisNet = t.satis.sub(t.satisIade);
    const alisNet = t.alis.sub(t.alisIade);
    const toplamGelir = satisNet.add(t.gelir);
    const toplamGider = alisNet.add(t.masraf);
    const f = (d: Prisma.Decimal) => d.toFixed(2);
    return {
      toplamGelir: f(toplamGelir),
      toplamGider: f(toplamGider),
      netKarZarar: f(toplamGelir.sub(toplamGider)),
      esas: "tahakkuk" as const,
      kdvHaric: true as const,
      nakitOzet: { tahsilat: f(t.tahsilat), tediye: f(t.tediye), netNakitAkisi: f(t.tahsilat.sub(t.tediye)) },
      detay: {
        satisFaturaGeliri: f(t.satis),
        satisIadesi: f(t.satisIade),
        ekstraGelir: f(t.gelir),
        alisFaturaGideri: f(t.alis),
        alisIadesi: f(t.alisIade),
        masrafGideri: f(t.masraf),
        kasaTahsilat: f(t.tahsilat),
        kasaTediye: f(t.tediye),
      },
    };
  }

  private async projeFinansOzeti(projeId: string) {
    const tutarlar = await this.finansTutarlari("projeId", [projeId]);
    return ProjelerService.finansOzeti(tutarlar.get(projeId)!);
  }

  /** Analitik yevmiye / maliyet alt kırılımları bazında gerçekleşen gelir ve gider (KDV hariç, TL). */
  private async analitikYevmiyeKirilimlari(_projeId: string, altKirilimlar: Array<{ id: string; tip: string; butceTutari: Prisma.Decimal } & Record<string, unknown>>) {
    const tutarlar = await this.finansTutarlari("projeAltKirilimId", altKirilimlar.map((k) => k.id));
    return altKirilimlar.map((k) => {
      const t = tutarlar.get(k.id)!;
      const gelir = t.satis.sub(t.satisIade).add(t.gelir);
      const gider = t.alis.sub(t.alisIade).add(t.masraf);
      const net = gelir.sub(gider);
      const gerceklesen = k.tip === "gelir" ? gelir : k.tip === "gider" ? gider : net.abs();
      const butce = D(k.butceTutari.toString());
      return {
        ...k,
        butceTutari: k.butceTutari.toString(),
        gerceklesenTutar: gerceklesen.toFixed(2),
        gerceklesenGelir: gelir.toFixed(2),
        gerceklesenGider: gider.toFixed(2),
        netTutar: net.toFixed(2),
        sapma: butce.sub(gerceklesen).toFixed(2),
        kullanimOrani: butce.gt(0) ? gerceklesen.div(butce).mul(100).toDecimalPlaces(0).toNumber() : null,
      };
    });
  }

  async olustur(girdi: z.infer<typeof projeOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      const proje = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.proje.create({
          data: {
            tenantId,
            kod: girdi.kod.trim().toUpperCase(),
            ad: girdi.ad.trim(),
            aciklama: girdi.aciklama || undefined,
            cariId: girdi.cariId || undefined,
            baslangicTarihi: girdi.baslangicTarihi ? new Date(girdi.baslangicTarihi) : undefined,
            bitisTarihi: girdi.bitisTarihi ? new Date(girdi.bitisTarihi) : undefined,
            durum: (girdi.durum as any) ?? "planlanan",
            sorumluUserId: girdi.sorumluUserId || undefined,
            hedefGelir: girdi.hedefGelir ? D(girdi.hedefGelir) : undefined,
            hedefGider: girdi.hedefGider ? D(girdi.hedefGider) : undefined,
            notlar: girdi.notlar || undefined,
          },
        }),
      );
      return this.getir(proje.id);
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") {
        throw new ConflictException(`'${girdi.kod}' proje kodu zaten kullanımda`);
      }
      throw hata;
    }
  }

  async guncelle(id: string, girdi: z.infer<typeof projeGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(id);

    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.proje.update({
        where: { id, tenantId },
        data: {
          ...(girdi.kod ? { kod: girdi.kod.trim().toUpperCase() } : {}),
          ...(girdi.ad ? { ad: girdi.ad.trim() } : {}),
          aciklama: girdi.aciklama === null ? null : girdi.aciklama,
          cariId: girdi.cariId === null ? null : girdi.cariId,
          baslangicTarihi: girdi.baslangicTarihi ? new Date(girdi.baslangicTarihi) : girdi.baslangicTarihi === null ? null : undefined,
          bitisTarihi: girdi.bitisTarihi ? new Date(girdi.bitisTarihi) : girdi.bitisTarihi === null ? null : undefined,
          ...(girdi.durum ? { durum: girdi.durum as any } : {}),
          sorumluUserId: girdi.sorumluUserId === null ? null : girdi.sorumluUserId,
          hedefGelir: girdi.hedefGelir ? D(girdi.hedefGelir) : undefined,
          hedefGider: girdi.hedefGider ? D(girdi.hedefGider) : undefined,
          notlar: girdi.notlar === null ? null : girdi.notlar,
          ...(girdi.aktif !== undefined ? { aktif: girdi.aktif } : {}),
        },
      }),
    );

    return this.getir(id);
  }

  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    const [faturaSayisi, masrafSayisi] = await Promise.all([
      this.prisma.tenantIslem(tenantId, (tx) => tx.faturaSatir.count({ where: { projeId: id } })),
      this.prisma.tenantIslem(tenantId, (tx) => tx.masraf.count({ where: { projeId: id } })),
    ]);

    if (faturaSayisi > 0 || masrafSayisi > 0) {
      throw new BadRequestException("İlişkili fatura veya masraf kaydı bulunan proje silinemez. Durumunu 'iptal' yapabilirsiniz.");
    }

    await this.prisma.tenantIslem(tenantId, (tx) => tx.proje.delete({ where: { id, tenantId } }));
  }

  // ─── AŞAMALAR (PHASES) ────────────────────────────────────────────────
  async asamaEkle(projeId: string, girdi: z.infer<typeof projeAsamaSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(projeId);

    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.projeAsama.create({
        data: {
          tenantId,
          projeId,
          sira: girdi.sira,
          ad: girdi.ad.trim(),
          aciklama: girdi.aciklama || undefined,
          baslangicTarihi: girdi.baslangicTarihi ? new Date(girdi.baslangicTarihi) : undefined,
          bitisTarihi: girdi.bitisTarihi ? new Date(girdi.bitisTarihi) : undefined,
          tamamlandi: girdi.tamamlandi ?? false,
          tamamlanmaTarihi: girdi.tamamlandi ? new Date() : undefined,
        },
      }),
    );
  }

  async asamaGuncelle(projeId: string, asamaId: string, girdi: z.infer<typeof projeAsamaSemasi>) {
    const { tenantId } = aktifBaglam();
    const asama = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.projeAsama.findFirst({ where: { id: asamaId, projeId, tenantId } }),
    );
    if (!asama) throw new NotFoundException("Proje aşaması bulunamadı");

    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.projeAsama.update({
        where: { id: asamaId, tenantId },
        data: {
          sira: girdi.sira,
          ad: girdi.ad.trim(),
          aciklama: girdi.aciklama === null ? null : girdi.aciklama,
          baslangicTarihi: girdi.baslangicTarihi ? new Date(girdi.baslangicTarihi) : girdi.baslangicTarihi === null ? null : undefined,
          bitisTarihi: girdi.bitisTarihi ? new Date(girdi.bitisTarihi) : girdi.bitisTarihi === null ? null : undefined,
          tamamlandi: girdi.tamamlandi ?? asama.tamamlandi,
          tamamlanmaTarihi: girdi.tamamlandi && !asama.tamamlandi ? new Date() : !girdi.tamamlandi ? null : undefined,
        },
      }),
    );
  }

  async asamaSil(projeId: string, asamaId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.projeAsama.deleteMany({ where: { id: asamaId, projeId, tenantId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Proje aşaması bulunamadı");
  }

  // ─── ALT KIRILIMLAR (ANALİTİK YEVMİYE / MALİYET MERKEZLERİ) ───────────
  async altKirilimEkle(projeId: string, girdi: z.infer<typeof projeAltKirilimSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(projeId);

    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.projeAltKirilim.create({
          data: {
            tenantId,
            projeId,
            kod: girdi.kod.trim().toUpperCase(),
            ad: girdi.ad.trim(),
            tip: (girdi.tip as any) ?? "gider",
            butceTutari: girdi.butceTutari ? D(girdi.butceTutari) : undefined,
            aciklama: girdi.aciklama || undefined,
          },
        }),
      );
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") {
        throw new ConflictException(`'${girdi.kod}' analitik kırılım kodu bu projede zaten tanımlı`);
      }
      throw hata;
    }
  }

  async altKirilimSil(projeId: string, kirilimId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.projeAltKirilim.deleteMany({ where: { id: kirilimId, projeId, tenantId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Analitik alt kırılım bulunamadı");
  }

  // ─── NOTLAR ───────────────────────────────────────────────────────────
  async notEkle(projeId: string, girdi: z.infer<typeof projeNotSemasi>) {
    const ctx = aktifBaglam();
    await this.getir(projeId);

    return this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.projeNot.create({
        data: {
          tenantId: ctx.tenantId,
          projeId,
          userId: ctx.userId,
          icerik: girdi.icerik.trim(),
        },
        include: { user: { select: { id: true, adSoyad: true } } },
      }),
    );
  }
}
