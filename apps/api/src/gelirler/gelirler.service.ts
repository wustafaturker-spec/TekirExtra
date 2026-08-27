import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type {
  gelirKategoriGuncelleSemasi,
  gelirKategoriOlusturSemasi,
  gelirKaydiOlusturSemasi,
} from "./gelirler.semalar";

const D = (deger: string | number | Prisma.Decimal) => new Prisma.Decimal(deger);

const VARSAYILAN_GELIR_KATEGORILERI = [
  { ad: "Gayrimenkul / Taşıt Kira Geliri", varsayilanStopajOrani: "20", muhasebeKodu: "649" },
  { ad: "Mevduat & Finansal Faiz Geliri", varsayilanStopajOrani: "7.5", muhasebeKodu: "642" },
  { ad: "Temettü / Kar Payı Geliri", varsayilanStopajOrani: "10", muhasebeKodu: "640" },
  { ad: "Taşınır / Taşınmaz Varlık Satış Karı", varsayilanStopajOrani: "0", muhasebeKodu: "645" },
  { ad: "Devlet Teşvik & Hibe Gelirleri", varsayilanStopajOrani: "0", muhasebeKodu: "649" },
  { ad: "Sigorta & Hasar Tazminat Gelirleri", varsayilanStopajOrani: "0", muhasebeKodu: "649" },
  { ad: "Kur Farkı & Kambiyo Gelirleri", varsayilanStopajOrani: "0", muhasebeKodu: "646" },
  { ad: "Yansıtma Gelirleri (Elektrik, Su vb.)", varsayilanStopajOrani: "0", muhasebeKodu: "649" },
  { ad: "Diğer Faaliyet Dışı Gelirler", varsayilanStopajOrani: "0", muhasebeKodu: "649" },
];

@Injectable()
export class GelirlerService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── KATEGORİ İŞLEMLERİ ───────────────────────────────────────────────

  async kategoriListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if ((await tx.gelirKategori.count()) === 0) {
        await tx.gelirKategori.createMany({
          data: VARSAYILAN_GELIR_KATEGORILERI.map((k) => ({
            tenantId,
            ad: k.ad,
            varsayilanStopajOrani: D(k.varsayilanStopajOrani),
            muhasebeKodu: k.muhasebeKodu,
          })),
        });
      }
      return tx.gelirKategori.findMany({
        where: { aktif: true },
        include: {
          ust: { select: { id: true, ad: true } },
          _count: { select: { altlar: true, gelirKayitlari: true } },
        },
        orderBy: [{ ustId: "asc" }, { ad: "asc" }],
      });
    });
  }

  async kategoriOlustur(girdi: z.infer<typeof gelirKategoriOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      return await this.prisma.tenantIslem(tenantId, async (tx) => {
        if (girdi.ustId) {
          const ust = await tx.gelirKategori.findUnique({ where: { id: girdi.ustId } });
          if (!ust) throw new BadRequestException("Üst kategori bulunamadı");
        }
        return tx.gelirKategori.create({
          data: {
            tenantId,
            ad: girdi.ad,
            ustId: girdi.ustId || null,
            varsayilanStopajOrani: girdi.varsayilanStopajOrani == null ? null : D(girdi.varsayilanStopajOrani),
            varsayilanKdvOrani: girdi.varsayilanKdvOrani == null ? null : D(girdi.varsayilanKdvOrani),
            muhasebeKodu: girdi.muhasebeKodu || null,
          },
        });
      });
    } catch (hata) {
      if (hata instanceof BadRequestException) throw hata;
      throw new BadRequestException("Bu isimde bir gelir kategorisi zaten var");
    }
  }

  async kategoriGuncelle(id: string, girdi: z.infer<typeof gelirKategoriGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kat = await tx.gelirKategori.findUnique({ where: { id } });
      if (!kat) throw new NotFoundException("Gelir kategorisi bulunamadı");
      try {
        return await tx.gelirKategori.update({
          where: { id },
          data: {
            ...(girdi.ad !== undefined ? { ad: girdi.ad } : {}),
            ...(girdi.varsayilanStopajOrani !== undefined
              ? { varsayilanStopajOrani: girdi.varsayilanStopajOrani == null ? null : D(girdi.varsayilanStopajOrani) }
              : {}),
            ...(girdi.varsayilanKdvOrani !== undefined
              ? { varsayilanKdvOrani: girdi.varsayilanKdvOrani == null ? null : D(girdi.varsayilanKdvOrani) }
              : {}),
            ...(girdi.muhasebeKodu !== undefined ? { muhasebeKodu: girdi.muhasebeKodu || null } : {}),
          },
        });
      } catch {
        throw new BadRequestException("Kategori güncellenemedi; aynı isimde kategori olabilir");
      }
    });
  }

  async kategoriSil(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kat = await tx.gelirKategori.findUnique({
        where: { id },
        include: { _count: { select: { gelirKayitlari: true, altlar: true } } },
      });
      if (!kat) throw new NotFoundException("Gelir kategorisi bulunamadı");
      if (kat._count.gelirKayitlari > 0 || kat._count.altlar > 0) {
        return tx.gelirKategori.update({ where: { id }, data: { aktif: false } });
      }
      return tx.gelirKategori.delete({ where: { id } });
    });
  }

  // ─── GELİR KAYIT İŞLEMLERİ ──────────────────────────────────────────

  async listele(sorgu: { baslangic?: string; bitis?: string; kategoriId?: string }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelirKaydi.findMany({
        where: {
          ...(sorgu.baslangic || sorgu.bitis
            ? {
                tarih: {
                  ...(sorgu.baslangic ? { gte: new Date(sorgu.baslangic) } : {}),
                  ...(sorgu.bitis ? { lte: new Date(sorgu.bitis) } : {}),
                },
              }
            : {}),
          ...(sorgu.kategoriId ? { kategoriId: sorgu.kategoriId } : {}),
        },
        include: {
          kategori: true,
          cari: { select: { id: true, unvan: true } },
          kasa: { select: { id: true, ad: true } },
          bankaHesap: { select: { id: true, ad: true, bankaAdi: true } },
        },
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
      }),
    );
  }

  async olustur(girdi: z.infer<typeof gelirKaydiOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    const netTutar = D(girdi.netTutar);
    const kur = girdi.dovizCinsi === "TRY" ? D(1) : D(girdi.kur);
    const netTutarTry = netTutar.mul(kur).toDecimalPlaces(2);
    const hareketTarihi = new Date(girdi.tarih);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kat = await tx.gelirKategori.findUnique({ where: { id: girdi.kategoriId } });
      if (!kat || !kat.aktif) throw new BadRequestException("Aktif gelir kategorisi bulunamadı");

      const hesap = girdi.kasaId
        ? await tx.kasa.findUnique({ where: { id: girdi.kasaId } })
        : await tx.bankaHesap.findUnique({ where: { id: girdi.bankaHesapId! } });
      if (!hesap || !hesap.aktif) throw new BadRequestException("Aktif kasa veya banka hesabı bulunamadı");
      if (hesap.dovizCinsi !== girdi.dovizCinsi) {
        throw new BadRequestException(`Hesap para birimi (${hesap.dovizCinsi}) ile gelir para birimi (${girdi.dovizCinsi}) uyuşmuyor`);
      }

      // Kasa & Banka modülüne otomatik tahsilat hareketi ekle
      const hareket = await tx.kasaBankaHareket.create({
        data: {
          tenantId,
          kasaId: girdi.kasaId || null,
          bankaHesapId: girdi.bankaHesapId || null,
          tip: "tahsilat",
          tutar: netTutar,
          dovizCinsi: girdi.dovizCinsi,
          kur,
          tutarTry: netTutarTry,
          tarih: hareketTarihi,
          aciklama: `Faturasız Gelir Tahsilatı (${kat.ad}) - ${girdi.aciklama || ""}`.trim(),
          cariId: girdi.cariId || null,
          kaynakTur: "faturasiz_gelir",
        },
      });

      return tx.gelirKaydi.create({
        data: {
          tenantId,
          kategoriId: girdi.kategoriId,
          tarih: hareketTarihi,
          brutTutar: D(girdi.brutTutar),
          stopajOrani: D(girdi.stopajOrani),
          stopajTutari: D(girdi.stopajTutari),
          kdvOrani: D(girdi.kdvOrani),
          kdvTutari: D(girdi.kdvTutari),
          netTutar,
          dovizCinsi: girdi.dovizCinsi,
          kur,
          netTutarTry,
          aciklama: girdi.aciklama || null,
          belgeNo: girdi.belgeNo || null,
          cariId: girdi.cariId || null,
          kasaId: girdi.kasaId || null,
          bankaHesapId: girdi.bankaHesapId || null,
          hareketId: hareket.id,
        },
        include: {
          kategori: true,
          cari: { select: { id: true, unvan: true } },
          kasa: { select: { id: true, ad: true } },
          bankaHesap: { select: { id: true, ad: true, bankaAdi: true } },
        },
      });
    });
  }

  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.gelirKaydi.findUnique({ where: { id } });
      if (!kayit) throw new NotFoundException("Gelir kaydı bulunamadı");

      if (kayit.hareketId) {
        await tx.kasaBankaHareket.delete({ where: { id: kayit.hareketId } });
      }

      return tx.gelirKaydi.delete({ where: { id } });
    });
  }
}
