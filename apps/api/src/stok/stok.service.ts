import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type StokHareketTip } from "@prisma/client";
import type { KayitEylem } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { ayarTanimiAl } from "../core/ayarlar/ayar-kayit";
import { izinliEylemler, eylemIzinli } from "../core/eylemler/eylem-kayit";
import { PrismaService } from "../core/prisma.service";
import { PdfService } from "../core/pdf/pdf.service";
import { metinNormalize } from "@tekirextra/shared";
import { DepoService } from "./depo.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { etiketPdfHtml, type EtiketVerisi } from "./etiket-pdf";
import type {
  etiketBasSemasi,
  kategoriSemasi,
  sayimOlusturSemasi,
  stokBarkodSemasi,
  stokBirimSemasi,
  stokKartGuncelleSemasi,
  stokKartOlusturSemasi,
  stokTedarikciSemasi,
  stokVaryantGuncelleSemasi,
  stokVaryantSemasi,
  stokFiyatSemasi,
} from "./stok.semalar";

import { stokExcelOku } from "../core/excel-yardimci";
import { iptalCiftiMi, iptalEdilmisFaturalar } from "../fatura/iptal-cifti";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

/** Stok hareketi girdisi (STK-07 ile depo zorunlu alan oldu). */
export interface StokHareketGirdisi {
  stokId: string;
  varyantId?: string | null;
  depoId: string;
  tip: StokHareketTip;
  /** ana birim cinsinden; sayim_duzeltme dışında pozitif verilir */
  miktar: Prisma.Decimal;
  girilenBirim: string;
  girilenMiktar: Prisma.Decimal;
  /** girişte alış fiyatı, çıkışta göz ardı edilir (ortalama maliyet kullanılır) */
  birimMaliyet: Prisma.Decimal;
  tarih: Date;
  aciklama?: string | null;
  kaynakTur?: string;
  kaynakRef?: string | null;
  partiler?: { lotNo: string; seriNo?: string | null; sonKullanmaTarihi?: string | null; uretimTarihi?: string | null; miktar: Prisma.Decimal }[];
}

@Injectable()
export class StokService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly depoService: DepoService,
    private readonly donemKilidi: DonemKilidiService,
  ) {}

  // ─── STOK KART YÖNETİMİ (STK-01) ───────────────────────────────────────────

  async kritikOzeti() {
    const { tenantId } = aktifBaglam();
    const satirlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.$queryRaw<{ sayi: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS sayi
        FROM stok_kartlari
        WHERE tenant_id = ${tenantId}::uuid
          AND kritik_seviye IS NOT NULL
          AND mevcut_miktar <= kritik_seviye
      `),
    );
    return { kritikStok: satirlar[0]?.sayi ?? 0 };
  }

  async listele(arama?: string, kategoriId?: string, imlec?: string, adet = 50) {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();
    const aranan = arama ? metinNormalize(arama) : "";

    const where: Prisma.StokKartWhereInput = {
      ...(kategoriId ? { kategoriId } : {}),
      ...(aranan
        ? {
            OR: [
              // ARA-01: ad, kod ve ana barkod veritabanının ürettiği
              // `arama_normal` kolonunda toplanır — aksan orada katlanır.
              { aramaNormal: { contains: aranan } },
              // STK-15: barkod tablosundan da bul
              { barkodlar: { some: { barkod: { contains: arama } } } },
              // STK-18: tedarikcinin urun koduyla da bul
              { tedarikciler: { some: { tedarikciUrunKodu: { contains: arama, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };

    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.findMany({
        where,
        orderBy: [{ kod: "asc" }, { id: "asc" }],
        take: adet + 1,
        ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
        include: {
          kategori: { select: { id: true, ad: true } },
          tedarikciler: { select: { tedarikciUrunKodu: true } },
          _count: { select: { hareketler: true } },
        },
      }),
    );

    const sonrakiImlec = kayitlar.length > adet ? kayitlar[adet - 1].id : null;
    const sayfa = kayitlar.slice(0, adet);

    return {
      kayitlar: sayfa.map((k) => ({
        ...this.gorunum(k),
        kategori: k.kategori,
        tedarikciUrunKodlari: k.tedarikciler.map((tedarikci) => tedarikci.tedarikciUrunKodu).filter((kod): kod is string => Boolean(kod)),
        izinliEylemler: this.eylemler(k, ctx.rol, k._count.hareketler),
      })),
      sonrakiImlec,
    };
  }

  async getir(id: string) {
    const ctx = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.stokKart.findUnique({
        where: { id },
        include: {
          kategori: true,
          birimler: true,
          barkodlar: true,
          tedarikciler: {
            include: { cari: { select: { id: true, kod: true, unvan: true } } },
          },
          varyantlar: { orderBy: [{ aktif: "desc" }, { kod: "asc" }], include: { depoBakiyeleri: { include: { depo: { select: { id: true, kod: true, ad: true } } } } } },
          _count: { select: { hareketler: true } },
        },
      }),
    );

    if (!kayit) throw new NotFoundException("Stok kartı bulunamadı");

    return {
      ...this.gorunum(kayit),
      kategori: kayit.kategori,
      birimler: kayit.birimler,
      barkodlar: kayit.barkodlar,
      tedarikciler: kayit.tedarikciler,
      varyantlar: kayit.varyantlar,
      izinliEylemler: this.eylemler(kayit, ctx.rol, kayit._count.hareketler),
    };
  }

  async varyantEkle(stokId: string, girdi: z.infer<typeof stokVaryantSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(stokId);
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) => tx.stokVaryant.create({ data: {
        tenantId, stokId, kod: girdi.kod, ad: girdi.ad, nitelikler: girdi.nitelikler,
        barkod: girdi.barkod, alisFiyati: girdi.alisFiyati ? D(girdi.alisFiyati) : null,
        satisFiyati: girdi.satisFiyati ? D(girdi.satisFiyati) : null,
      }}));
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") throw new ConflictException("Varyant kodu veya barkodu zaten kullanımda");
      throw hata;
    }
  }

  async fiyatListele(stokId: string) {
    const { tenantId } = aktifBaglam();
    await this.getir(stokId);
    return this.prisma.tenantIslem(tenantId, (tx) => tx.stokFiyat.findMany({ where: { tenantId, stokId }, orderBy: [{ aktif: "desc" }, { tip: "asc" }, { dovizCinsi: "asc" }] }));
  }

  async fiyatKaydet(stokId: string, girdi: z.infer<typeof stokFiyatSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(stokId);
    if (girdi.varyantId) {
      const varyant = await this.prisma.tenantIslem(tenantId, (tx) => tx.stokVaryant.findFirst({ where: { id: girdi.varyantId ?? undefined, stokId } }));
      if (!varyant) throw new NotFoundException("Varyant bulunamadı");
    }
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.stokFiyat.findFirst({ where: { tenantId, stokId, varyantId: girdi.varyantId ?? null, tip: girdi.tip } });
      return mevcut
        ? tx.stokFiyat.update({ where: { id: mevcut.id, tenantId }, data: { dovizCinsi: girdi.dovizCinsi, tutar: D(girdi.tutar), aktif: girdi.aktif } })
        : tx.stokFiyat.create({ data: { tenantId, stokId, varyantId: girdi.varyantId ?? null, tip: girdi.tip, dovizCinsi: girdi.dovizCinsi, tutar: D(girdi.tutar), aktif: girdi.aktif } });
    });
  }

  async fiyatSil(stokId: string, fiyatId: string) {
    const { tenantId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.stokFiyat.deleteMany({ where: { id: fiyatId, stokId, tenantId } }));
    if (sonuc.count === 0) throw new NotFoundException("Fiyat bulunamadı");
  }

  async varyantGuncelle(stokId: string, varyantId: string, girdi: z.infer<typeof stokVaryantGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    const mevcut = await this.prisma.tenantIslem(tenantId, (tx) => tx.stokVaryant.findFirst({ where: { id: varyantId, stokId } }));
    if (!mevcut) throw new NotFoundException("Varyant bulunamadı");
    return this.prisma.tenantIslem(tenantId, (tx) => tx.stokVaryant.update({ where: { id: varyantId }, data: {
      ...girdi, alisFiyati: girdi.alisFiyati === undefined ? undefined : girdi.alisFiyati ? D(girdi.alisFiyati) : null,
      satisFiyati: girdi.satisFiyati === undefined ? undefined : girdi.satisFiyati ? D(girdi.satisFiyati) : null,
    }}));
  }

  async olustur(girdi: z.infer<typeof stokKartOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.stokKart.create({
          data: {
            tenantId,
            kod: girdi.kod,
            ad: girdi.ad,
            kisaAd: girdi.kisaAd,
            aciklama: girdi.aciklama,
            tip: girdi.tip,
            marka: girdi.marka,
            model: girdi.model,
            mensei: girdi.mensei,
            gtipKodu: girdi.gtipKodu,
            ureticiUrunKodu: girdi.ureticiUrunKodu,
            barkod: girdi.barkod,
            kategoriId: girdi.kategoriId,
            anaBirim: girdi.anaBirim,
            kdvOrani: D(girdi.kdvOrani),
            alisFiyati: girdi.alisFiyati ? D(girdi.alisFiyati) : null,
            satisFiyati: girdi.satisFiyati ? D(girdi.satisFiyati) : null,
            alisFiyatiDoviz: girdi.alisFiyatiDoviz,
            satisFiyatiDoviz: girdi.satisFiyatiDoviz,
            kritikSeviye: girdi.kritikSeviye ? D(girdi.kritikSeviye) : null,
            minStok: girdi.minStok ? D(girdi.minStok) : null,
            maksStok: girdi.maksStok ? D(girdi.maksStok) : null,
            guvenlikStogu: girdi.guvenlikStogu ? D(girdi.guvenlikStogu) : null,
            tedarikSuresiGun: girdi.tedarikSuresiGun,
            gorselUrl: girdi.gorselUrl,
            takipTipi: girdi.takipTipi,
          },
        }),
      );
      return this.gorunum(kayit);
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.kod}' kodlu ürün zaten kullanımda`);
      }
      throw hata;
    }
  }

  async tavsiyeFiyat(stokId: string, cariId?: string, tip = "satis", dovizCinsi = "TRY", fiyatListesiId?: string, belgeKuru = "1", urunKuru?: string, varyantId?: string) {
    const { tenantId } = aktifBaglam();

    let birimFiyat = 0;
    let iskontoOrani = 0;

    const stok = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.findUnique({ where: { id: stokId } }),
    );
    if (!stok) throw new NotFoundException("Stok kartı bulunamadı");

    const fiyat = await this.prisma.tenantIslem(tenantId, async (tx) => {
      if (varyantId) {
        const varyantFiyati = await tx.stokFiyat.findFirst({ where: { tenantId, stokId, varyantId, tip: tip === "alis" ? "alis" : "satis", aktif: true } });
        if (varyantFiyati) return varyantFiyati;
      }
      return tx.stokFiyat.findFirst({ where: { tenantId, stokId, tip: tip === "alis" ? "alis" : "satis", aktif: true, varyantId: null } });
    });
    birimFiyat = fiyat ? Number(fiyat.tutar) : Number(tip === "satis" ? stok.satisFiyati ?? 0 : stok.alisFiyati ?? 0);
    let kaynakDoviz = fiyat?.dovizCinsi ?? (tip === "alis" ? stok.alisFiyatiDoviz : stok.satisFiyatiDoviz);
    let fiyatKaynagi = fiyat ? "urun" : "kart";

    if (cariId) {
      const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariHesap.findUnique({ where: { id: cariId } }),
      );

      if (cari) {
        iskontoOrani = Number(cari.varsayilanIskonto ?? 0);

        const etkinListeId = fiyatListesiId || cari.fiyatListesiId;
        if (tip === "satis" && etkinListeId) {
          const listeKalemi = await this.prisma.tenantIslem(tenantId, (tx) =>
            tx.fiyatListesiKalem.findFirst({
              where: { tenantId, listeId: etkinListeId, stokId, liste: { aktif: true } },
              include: { liste: { select: { dovizCinsi: true } } },
            }),
          );
          if (listeKalemi) {
            birimFiyat = Number(listeKalemi.fiyat);
            kaynakDoviz = listeKalemi.liste.dovizCinsi;
            fiyatKaynagi = "fiyat_listesi";
          }
        }
      }
    }

    const belgeKurDegeri = dovizCinsi === "TRY" ? 1 : Number(belgeKuru);
    const kaynakKurDegeri = kaynakDoviz === "TRY" ? 1 : Number(urunKuru || (kaynakDoviz === dovizCinsi ? belgeKurDegeri : 0));
    const cevrilebilir = kaynakDoviz === dovizCinsi || (belgeKurDegeri > 0 && kaynakKurDegeri > 0);
    const cevrilmisFiyat = kaynakDoviz === dovizCinsi ? birimFiyat : cevrilebilir ? birimFiyat * kaynakKurDegeri / belgeKurDegeri : null;
    return {
      birimFiyat: cevrilmisFiyat ?? birimFiyat,
      kaynakFiyat: birimFiyat,
      kaynakDoviz,
      belgeDovizi: dovizCinsi,
      belgeKuru: belgeKurDegeri,
      urunKuru: kaynakKurDegeri || null,
      cevrilebilir,
      fiyatKaynagi,
      iskontoOrani,
    };
  }

  async kopyala(id: string) {
    const { tenantId } = aktifBaglam();
    const stok = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.findUnique({
        where: { id },
        include: {
          birimler: true,
          tedarikciler: true,
        },
      }),
    );

    if (!stok) throw new NotFoundException("Stok kartı bulunamadı");

    const hareketSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokHareket.count({ where: { stokId: id } }),
    );
    const ctx = aktifBaglam();
    if (!eylemIzinli("stok", "kopyala", { aktif: stok.aktif, hareketSayisi }, ctx)) {
      throw new ForbiddenException("Bu stok kartı kopyalanamaz veya bu işlem için yetkiniz yok");
    }

    let yeniKod = `${stok.kod}-KOPYA`;
    let sayac = 1;
    while (true) {
      const varMi = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.stokKart.findUnique({ where: { tenantId_kod: { tenantId, kod: yeniKod } } }),
      );
      if (!varMi) break;
      yeniKod = `${stok.kod}-KOPYA-${sayac}`;
      sayac++;
    }

    const kopyaStok = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kopya = await tx.stokKart.create({
        data: {
          tenantId,
          kod: yeniKod,
          ad: `${stok.ad} (Kopya)`,
          kisaAd: stok.kisaAd ? `${stok.kisaAd} (Kopya)` : null,
          aciklama: stok.aciklama,
          tip: stok.tip,
          marka: stok.marka,
          model: stok.model,
          mensei: stok.mensei,
          gtipKodu: stok.gtipKodu,
          ureticiUrunKodu: stok.ureticiUrunKodu,
          barkod: null, // clear barcode to avoid unique constraint
          kategoriId: stok.kategoriId,
          anaBirim: stok.anaBirim,
          kdvOrani: stok.kdvOrani,
          alisFiyati: stok.alisFiyati,
          satisFiyati: stok.satisFiyati,
          kritikSeviye: stok.kritikSeviye,
          minStok: stok.minStok,
          maksStok: stok.maksStok,
          guvenlikStogu: stok.guvenlikStogu,
          tedarikSuresiGun: stok.tedarikSuresiGun,
          gorselUrl: stok.gorselUrl,
          takipTipi: stok.takipTipi,
          mevcutMiktar: 0,
          rezerveMiktar: 0,
          yoldakiMiktar: 0,
          ortalamaMaliyet: 0,
          aktif: true,
        },
      });

      for (const b of stok.birimler) {
        await tx.stokBirim.create({
          data: {
            tenantId,
            stokId: kopya.id,
            ad: b.ad,
            katsayi: b.katsayi,
          },
        });
      }

      for (const t of stok.tedarikciler) {
        await tx.stokTedarikci.create({
          data: {
            tenantId,
            stokId: kopya.id,
            cariId: t.cariId,
            tedarikciUrunKodu: t.tedarikciUrunKodu,
            alisFiyati: t.alisFiyati,
            dovizCinsi: t.dovizCinsi,
            tedarikSuresiGun: t.tedarikSuresiGun,
            varsayilan: t.varsayilan,
          },
        });
      }

      return kopya;
    });

    return this.getir(kopyaStok.id);
  }

  async guncelle(id: string, girdi: z.infer<typeof stokKartGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    const mevcut = await this.getir(id);
    if (girdi.takipTipi && girdi.takipTipi !== mevcut.takipTipi) {
      const partiSayisi = await this.prisma.tenantIslem(tenantId, (tx) => tx.stokParti.count({ where: { stokId: id } }));
      if (partiSayisi > 0) throw new BadRequestException("Parti hareketi bulunan kartın takip tipi değiştirilemez");
    }
    try {
      const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.stokKart.update({
          where: { id },
          data: {
            kod: girdi.kod,
            ad: girdi.ad,
            kisaAd: girdi.kisaAd,
            aciklama: girdi.aciklama,
            tip: girdi.tip,
            marka: girdi.marka,
            model: girdi.model,
            mensei: girdi.mensei,
            gtipKodu: girdi.gtipKodu,
            ureticiUrunKodu: girdi.ureticiUrunKodu,
            barkod: girdi.barkod,
            kategoriId: girdi.kategoriId,
            anaBirim: girdi.anaBirim,
            kdvOrani: girdi.kdvOrani ? D(girdi.kdvOrani) : undefined,
            alisFiyati: girdi.alisFiyati !== undefined ? (girdi.alisFiyati ? D(girdi.alisFiyati) : null) : undefined,
            satisFiyati: girdi.satisFiyati !== undefined ? (girdi.satisFiyati ? D(girdi.satisFiyati) : null) : undefined,
            alisFiyatiDoviz: girdi.alisFiyatiDoviz,
            satisFiyatiDoviz: girdi.satisFiyatiDoviz,
            kritikSeviye: girdi.kritikSeviye !== undefined ? (girdi.kritikSeviye ? D(girdi.kritikSeviye) : null) : undefined,
            minStok: girdi.minStok !== undefined ? (girdi.minStok ? D(girdi.minStok) : null) : undefined,
            maksStok: girdi.maksStok !== undefined ? (girdi.maksStok ? D(girdi.maksStok) : null) : undefined,
            guvenlikStogu: girdi.guvenlikStogu !== undefined ? (girdi.guvenlikStogu ? D(girdi.guvenlikStogu) : null) : undefined,
            tedarikSuresiGun: girdi.tedarikSuresiGun,
            gorselUrl: girdi.gorselUrl,
            takipTipi: girdi.takipTipi,
            aktif: girdi.aktif,
          },
        }),
      );
      return this.gorunum(kayit);
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.kod}' kodlu ürün zaten kullanımda`);
      }
      throw hata;
    }
  }

  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    const hareketSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokHareket.count({ where: { stokId: id } }),
    );
    if (hareketSayisi > 0) {
      throw new BadRequestException(
        "Hareketi olan stok kartı silinemez; pasife alın (aktif=false)",
      );
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.delete({ where: { id } }),
    );
  }

  // ─── KATEGORİ YÖNETİMİ (STK-09) ──────────────────────────────────────────

  async kategoriListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKategori.findMany({
        orderBy: { ad: "asc" },
        include: { ust: { select: { id: true, ad: true } } },
      }),
    );
  }

  async kategoriOlustur(girdi: z.infer<typeof kategoriSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKategori.create({
        data: {
          tenantId,
          ad: girdi.ad,
          ustId: girdi.ustId,
        },
      }),
    );
  }

  async kategoriSil(id: string) {
    const { tenantId } = aktifBaglam();
    // Alt kategorisi var mı?
    const altKategoriSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKategori.count({ where: { ustId: id } }),
    );
    if (altKategoriSayisi > 0) {
      throw new BadRequestException("Alt kategorisi bulunan kategori silinemez");
    }
    // Bu kategoriye ait ürün var mı?
    const urunSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.count({ where: { kategoriId: id } }),
    );
    if (urunSayisi > 0) {
      throw new BadRequestException("Ürünleri bulunan kategori silinemez");
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKategori.delete({ where: { id } }),
    );
  }

  // ─── ÇOKLU BİRİM YÖNETİMİ (STK-10) ───────────────────────────────────────

  async birimEkle(stokId: string, girdi: z.infer<typeof stokBirimSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(stokId);
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.stokBirim.create({
          data: {
            tenantId,
            stokId,
            ad: girdi.ad,
            katsayi: D(girdi.katsayi),
          },
        }),
      );
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(
          `Bu ürün için '${girdi.ad}' birimi zaten tanımlı`,
        );
      }
      throw hata;
    }
  }

  async birimSil(stokId: string, birimId: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokBirim.delete({ where: { id: birimId, stokId } }),
    );
  }

  /**
   * Stok kartının depo bazlı kırılımı (STK-07). Kart üzerindeki toplamların
   * depolara dağılımıdır; bakiye satırı olmayan depolar listelenmez.
   */
  async depoKirilimi(stokId: string) {
    const { tenantId } = aktifBaglam();
    await this.getir(stokId);
    const satirlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokDepoBakiye.findMany({
        where: { stokId },
        include: { depo: { select: { id: true, kod: true, ad: true, aktif: true } } },
      }),
    );
    return satirlar
      .sort((a, b) => a.depo.kod.localeCompare(b.depo.kod, "tr"))
      .map((s) => ({
        depoId: s.depoId,
        depoKod: s.depo.kod,
        depoAd: s.depo.ad,
        depoAktif: s.depo.aktif,
        mevcutMiktar: D(s.mevcutMiktar).toFixed(3),
        rezerveMiktar: D(s.rezerveMiktar).toFixed(3),
        yoldakiMiktar: D(s.yoldakiMiktar).toFixed(3),
        kullanilabilirMiktar: D(s.mevcutMiktar).sub(D(s.rezerveMiktar)).toFixed(3),
      }));
  }

  // ─── STOK HAREKETLERİ & AVCO HESAPLAMA (STK-02/08) ───────────────────────

  async hareketListele(stokId: string, depoId?: string, iptalleriGosterilsin = false) {
    const { tenantId } = aktifBaglam();
    await this.getir(stokId);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hareketler = await tx.stokHareket.findMany({
        where: { stokId, ...(depoId ? { depoId } : {}) },
        orderBy: [{ tarih: "asc" }, { createdAt: "asc" }],
        include: { depo: { select: { id: true, kod: true, ad: true } }, varyant: { select: { id: true, kod: true, ad: true } } },
      });
      // STK-22: iptal edilmiş faturanın hareketi, ters hareketi ve telafisi
      // birbirini sıfırlar; varsayılan olarak gösterilmez.
      const iptaller = await iptalEdilmisFaturalar(tx, hareketler);
      return hareketler
        .map((h) => ({ ...h, iptal: iptalCiftiMi(h, iptaller) }))
        .filter((h) => iptalleriGosterilsin || !h.iptal);
    });
  }

  async partiListele(stokId: string, varyantId?: string, depoId?: string, stokta = false) {
    const { tenantId } = aktifBaglam();
    await this.getir(stokId);
    return this.prisma.tenantIslem(tenantId, (tx) => tx.stokParti.findMany({
      where: { stokId, ...(varyantId ? { varyantId } : {}), ...(depoId ? { depoId } : {}), ...(stokta ? { kalanMiktar: { gt: 0 } } : {}) },
      orderBy: [{ sonKullanmaTarihi: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      include: { depo: { select: { id: true, kod: true, ad: true } }, varyant: { select: { id: true, kod: true, ad: true } } },
    }));
  }

  /** Giriş gibi işlenen hareket türleri (STK-19, STK-07 transferi dahil). */
  private static readonly GIRIS_TURLERI: StokHareketTip[] = [
    "giris",
    "acilis",
    "transfer_giris",
  ];
  /** Çıkış gibi işlenen hareket türleri (STK-19, STK-07 transferi dahil). */
  private static readonly CIKIS_TURLERI: StokHareketTip[] = [
    "cikis",
    "fire",
    "zayi",
    "numune",
    "promosyon",
    "transfer_cikis",
  ];

  /**
   * Stok hareketi ekler; ürünün toplam miktarı, hareketin geçtiği deponun
   * bakiyesi ve ortalama maliyet (AVCO) aynı transaction içinde güncellenir
   * (STK-08, STK-07). Ortalama maliyet firma genelinde tektir — depo bazında
   * ayrışmaz (S-01), bu yüzden transfer maliyeti değiştirmez.
   * Çıkış türlerinde eksi stok politikası uygulanır (STK-17); kontrol
   * hareketin yapıldığı deponun kullanılabilir stoğu üzerinden yapılır ve
   * "uyar" modunda uyarı metni döner.
   */
  async hareketEkle(
    tx: Prisma.TransactionClient,
    girdi: StokHareketGirdisi,
  ): Promise<{ hareket: unknown; eksiStokUyarisi: string | null; partiTahsisleri: { lotNo: string; seriNo: string | null; sonKullanmaTarihi: string | null; uretimTarihi: string | null; miktar: Prisma.Decimal }[] }> {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "stok hareketi oluşturma");
    const {
      stokId,
      varyantId,
      depoId,
      tip,
      miktar,
      girilenBirim,
      girilenMiktar,
      tarih,
      aciklama,
      kaynakTur = "manuel",
      kaynakRef,
    } = girdi;
    let birimMaliyet = girdi.birimMaliyet;

    // Ürünü kilitleyerek getir (race condition engellemek için)
    const urun = await tx.stokKart.findUnique({
      where: { id: stokId },
    });
    if (!urun) throw new NotFoundException("Stok kartı bulunamadı");
    const varyant = varyantId ? await tx.stokVaryant.findFirst({ where: { id: varyantId, stokId, aktif: true } }) : null;
    if (varyantId && !varyant) throw new BadRequestException("Varyant bu stok kartına ait değil");

    const depo = await tx.depo.findUnique({ where: { id: depoId } });
    if (!depo) throw new NotFoundException("Depo bulunamadı");
    const depoBakiye = await tx.stokDepoBakiye.findUnique({
      where: { tenantId_stokId_depoId: { tenantId, stokId, depoId } },
    });
    const depoMevcut = D(depoBakiye?.mevcutMiktar ?? 0);
    const depoRezerve = D(depoBakiye?.rezerveMiktar ?? 0);
    const varyantDepoBakiye = varyant
      ? await tx.stokVaryantDepoBakiye.findUnique({ where: { tenantId_varyantId_depoId: { tenantId, varyantId: varyant.id, depoId } } })
      : null;

    let miktarDegisimi = D(0);
    let yeniMevcut = D(urun.mevcutMiktar);
    let yeniMaliyet = D(urun.ortalamaMaliyet);
    let eksiStokUyarisi: string | null = null;

    if (StokService.GIRIS_TURLERI.includes(tip)) {
      miktarDegisimi = miktar;
      yeniMevcut = D(urun.mevcutMiktar).add(miktarDegisimi);

      // AVCO Formülü (STK-08):
      // yeniMevcut > 0 ise yeni maliyet hesaplanır. Eski mevcut miktar <= 0 ise,
      // yeni maliyet doğrudan gelen birimMaliyet olur (negatif stoku düzeltirken veya sıfır envanterde).
      if (yeniMevcut.gt(0)) {
        if (D(urun.mevcutMiktar).lte(0)) {
          yeniMaliyet = birimMaliyet;
        } else {
          const eskiDeger = D(urun.mevcutMiktar).mul(D(urun.ortalamaMaliyet));
          const girenDeger = miktar.mul(birimMaliyet);
          yeniMaliyet = eskiDeger.add(girenDeger).div(yeniMevcut).toDecimalPlaces(4);
        }
      }
    } else if (StokService.CIKIS_TURLERI.includes(tip)) {
      miktarDegisimi = miktar.negated();
      yeniMevcut = D(urun.mevcutMiktar).add(miktarDegisimi);
      // Çıkış hareketinde maliyet, mevcut ortalama maliyettir ve ortalama maliyet DEĞİŞMEZ.
      birimMaliyet = D(urun.ortalamaMaliyet);

      // Eksi stok politikası (STK-17) — yalnız stoklu ürünlerde (hizmet hariç).
      // Kontrol KULLANILABİLİR stok üzerinden yapılır (FTR-12 S-01 kararı):
      // kullanılabilir = mevcut − rezerve; rezerve mal başka çıkışa verilemez.
      // Çoklu depoda ölçüt deponun kendi stoğudur (STK-07): başka depodaki mal
      // bu depodan yapılan çıkışı karşılamaz.
      const yeniKullanilabilir = depoMevcut.add(miktarDegisimi).sub(depoRezerve);
      if (urun.tip === "urun" && yeniKullanilabilir.lt(0)) {
        const politika = await this.eksiStokPolitikasi(tx, tenantId);
        const mesaj =
          `'${urun.ad}' ürününün '${depo.ad}' deposundaki kullanılabilir stoğu eksiye düşüyor ` +
          `(mevcut ${depoMevcut.toFixed(3)}, rezerve ${depoRezerve.toFixed(3)}, çıkış ${miktar.toFixed(3)})`;
        if (politika === "engelle") {
          throw new BadRequestException(`${mesaj} — eksi stok politikası çıkışı engelliyor`);
        }
        if (politika === "uyar") eksiStokUyarisi = mesaj;
      }
      if (varyant) {
        const varyantKullanilabilir = D(varyantDepoBakiye?.mevcutMiktar ?? 0)
          .add(miktarDegisimi).sub(D(varyantDepoBakiye?.rezerveMiktar ?? 0));
        if (varyantKullanilabilir.lt(0)) {
          const politika = await this.eksiStokPolitikasi(tx, tenantId);
          const mesaj = `'${varyant.ad}' varyantının '${depo.ad}' deposundaki kullanılabilir stoğu eksiye düşüyor`;
          if (politika === "engelle") throw new BadRequestException(`${mesaj} — eksi stok politikası çıkışı engelliyor`);
          if (politika === "uyar") eksiStokUyarisi = mesaj;
        }
      }
    } else if (tip === "sayim_duzeltme") {
      miktarDegisimi = miktar; // Sayım düzeltmesinde miktar pozitif veya negatif olabilir
      yeniMevcut = D(urun.mevcutMiktar).add(miktarDegisimi);

      // Artış düzeltmesi ise (miktar > 0), bir nevi giriş gibi maliyet etkilenir
      if (miktarDegisimi.gt(0)) {
        if (yeniMevcut.gt(0)) {
          if (D(urun.mevcutMiktar).lte(0)) {
            yeniMaliyet = birimMaliyet;
          } else {
            const eskiDeger = D(urun.mevcutMiktar).mul(D(urun.ortalamaMaliyet));
            const girenDeger = miktarDegisimi.mul(birimMaliyet);
            yeniMaliyet = eskiDeger.add(girenDeger).div(yeniMevcut).toDecimalPlaces(4);
          }
        }
      }
      // Azalış düzeltmesi ise (miktar < 0) maliyet değişmez, çıkış gibi işlem görür
    }

    // Stok hareketini yaz
    const hareket = await tx.stokHareket.create({
      data: {
        tenantId,
        stokId,
        varyantId,
        depoId,
        tip,
        miktar: miktarDegisimi,
        girilenBirim,
        girilenMiktar,
        maliyet: birimMaliyet,
        tarih,
        aciklama,
        kaynakTur,
        kaynakRef,
      },
    });
    const partiTahsisleri = await this.partiTahsisEt(tx, urun.takipTipi, hareket.id, {
      stokId, varyantId, depoId, miktarDegisimi, partiler: girdi.partiler ?? [],
    });

    // Stok kartındaki toplam ve depo bakiyesi birlikte güncellenir (STK-07)
    await tx.stokKart.update({
      where: { id: stokId },
      data: {
        mevcutMiktar: yeniMevcut,
        ortalamaMaliyet: yeniMaliyet,
      },
    });
    await tx.stokDepoBakiye.upsert({
      where: { tenantId_stokId_depoId: { tenantId, stokId, depoId } },
      create: { tenantId, stokId, depoId, mevcutMiktar: miktarDegisimi },
      update: { mevcutMiktar: { increment: miktarDegisimi } },
    });
    if (varyant) {
      await tx.stokVaryant.update({ where: { id: varyant.id }, data: { mevcutMiktar: { increment: miktarDegisimi } } });
      await tx.stokVaryantDepoBakiye.upsert({
        where: { tenantId_varyantId_depoId: { tenantId, varyantId: varyant.id, depoId } },
        create: { tenantId, varyantId: varyant.id, depoId, mevcutMiktar: miktarDegisimi },
        update: { mevcutMiktar: { increment: miktarDegisimi } },
      });
    }

    return { hareket, eksiStokUyarisi, partiTahsisleri };
  }

  private async partiTahsisEt(
    tx: Prisma.TransactionClient,
    takipTipi: "yok" | "lot" | "seri",
    hareketId: string,
    girdi: { stokId: string; varyantId?: string | null; depoId: string; miktarDegisimi: Prisma.Decimal; partiler: NonNullable<StokHareketGirdisi["partiler"]> },
  ) {
    const { tenantId } = aktifBaglam();
    if (takipTipi === "yok") {
      if (girdi.partiler.length) throw new BadRequestException("Bu stok kartında seri/lot takibi açık değil");
      return [];
    }
    const giris = girdi.miktarDegisimi.gt(0);
    const hedef = girdi.miktarDegisimi.abs();
    const tahsisler: { lotNo: string; seriNo: string | null; sonKullanmaTarihi: string | null; uretimTarihi: string | null; miktar: Prisma.Decimal }[] = [];
    if (giris) {
      const toplam = girdi.partiler.reduce((t, p) => t.add(p.miktar), D(0));
      if (!toplam.eq(hedef)) throw new BadRequestException("Parti miktarları hareket miktarına eşit olmalıdır");
      if (takipTipi === "seri" && girdi.partiler.some((p) => !p.seriNo || !p.miktar.eq(1))) throw new BadRequestException("Seri takibinde her seri numarası 1 adet olmalıdır");
      for (const p of girdi.partiler) {
        const anahtar = [girdi.stokId, girdi.varyantId ?? "-", girdi.depoId, p.lotNo, p.seriNo ?? "-"].join(":");
        const mevcutSeri = p.seriNo ? await tx.stokParti.findUnique({ where: { tenantId_seriNo: { tenantId, seriNo: p.seriNo } } }) : null;
        if (mevcutSeri && mevcutSeri.kalanMiktar.gt(0)) throw new ConflictException(`'${p.seriNo}' seri numarası halen stokta`);
        const parti = mevcutSeri
          ? await tx.stokParti.update({ where: { id: mevcutSeri.id }, data: { depoId: girdi.depoId, anahtar, kalanMiktar: p.miktar } })
          : await tx.stokParti.upsert({
              where: { tenantId_anahtar: { tenantId, anahtar } },
              create: { tenantId, stokId: girdi.stokId, varyantId: girdi.varyantId, depoId: girdi.depoId, lotNo: p.lotNo, seriNo: p.seriNo, sonKullanmaTarihi: p.sonKullanmaTarihi ? new Date(p.sonKullanmaTarihi) : null, uretimTarihi: p.uretimTarihi ? new Date(p.uretimTarihi) : null, ilkMiktar: p.miktar, kalanMiktar: p.miktar, anahtar },
              update: { ilkMiktar: { increment: p.miktar }, kalanMiktar: { increment: p.miktar } },
            });
        await tx.stokHareketParti.create({ data: { tenantId, hareketId, partiId: parti.id, miktar: p.miktar } });
        tahsisler.push({ ...p, seriNo: p.seriNo ?? null, sonKullanmaTarihi: p.sonKullanmaTarihi ?? null, uretimTarihi: p.uretimTarihi ?? null });
      }
      return tahsisler;
    }
    let kalan = hedef;
    const partiler = await tx.stokParti.findMany({ where: { stokId: girdi.stokId, varyantId: girdi.varyantId ?? null, depoId: girdi.depoId, kalanMiktar: { gt: 0 } }, orderBy: [{ sonKullanmaTarihi: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] });
    for (const p of partiler) {
      if (kalan.lte(0)) break;
      const miktar = Prisma.Decimal.min(kalan, p.kalanMiktar);
      await tx.stokParti.update({ where: { id: p.id }, data: { kalanMiktar: { decrement: miktar } } });
      await tx.stokHareketParti.create({ data: { tenantId, hareketId, partiId: p.id, miktar: miktar.negated() } });
      tahsisler.push({ lotNo: p.lotNo, seriNo: p.seriNo, sonKullanmaTarihi: p.sonKullanmaTarihi?.toISOString().slice(0, 10) ?? null, uretimTarihi: p.uretimTarihi?.toISOString().slice(0, 10) ?? null, miktar });
      kalan = kalan.sub(miktar);
    }
    if (kalan.gt(0)) throw new BadRequestException(`FEFO için yeterli parti stoğu yok; ${kalan.toFixed(3)} eksik`);
    return tahsisler;
  }

  async varyantDogrula(tx: Prisma.TransactionClient, stokId: string, varyantId?: string | null) {
    if (!varyantId) return null;
    const varyant = await tx.stokVaryant.findFirst({ where: { id: varyantId, stokId, aktif: true } });
    if (!varyant) throw new BadRequestException("Varyant bu stok kartına ait değil veya pasif");
    return varyant;
  }

  /**
   * Girilen birimi ana birime çeviren katsayı (STK-10):
   * miktar (ana birim) = girilenMiktar × katsayı.
   */
  async birimKatsayisi(
    tx: Prisma.TransactionClient,
    stokId: string,
    birim: string,
  ): Promise<Prisma.Decimal> {
    const kart = await tx.stokKart.findUnique({
      where: { id: stokId },
      select: { anaBirim: true, ad: true },
    });
    if (!kart) throw new NotFoundException("Stok kartı bulunamadı");
    if (kart.anaBirim === birim) return D(1);
    const ek = await tx.stokBirim.findFirst({ where: { stokId, ad: birim } });
    if (!ek) {
      throw new BadRequestException(
        `'${kart.ad}' ürününde '${birim}' birimi tanımlı değil`,
      );
    }
    return D(ek.katsayi);
  }

  /** Eksi stok politikasını mevcut transaction içinden okur (STK-17). */
  private async eksiStokPolitikasi(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<"izin" | "uyar" | "engelle"> {
    const tanim = ayarTanimiAl("stok");
    const kayit = await tx.modulAyar.findUnique({
      where: { tenantId_modul: { tenantId, modul: "stok" } },
    });
    const ayarlar = {
      ...tanim?.varsayilanlar,
      ...((kayit?.ayarlar as Record<string, unknown>) ?? {}),
    };
    const politika = ayarlar.eksiStokPolitikasi;
    return politika === "izin" || politika === "engelle" ? politika : "uyar";
  }

  // ─── BARKODLAR (STK-15) ──────────────────────────────────────────────────

  async barkodEkle(stokId: string, girdi: z.infer<typeof stokBarkodSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(stokId);
    if (girdi.birim) {
      const birimVar = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.stokBirim.findFirst({ where: { stokId, ad: girdi.birim! } }),
      );
      const kart = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.stokKart.findUnique({ where: { id: stokId }, select: { anaBirim: true } }),
      );
      if (!birimVar && kart?.anaBirim !== girdi.birim) {
        throw new BadRequestException(
          `'${girdi.birim}' birimi bu ürün için tanımlı değil`,
        );
      }
    }
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.stokBarkod.create({
          data: {
            tenantId,
            stokId,
            barkod: girdi.barkod,
            birim: girdi.birim,
            satisFiyati: girdi.satisFiyati ? D(girdi.satisFiyati) : null,
          },
        }),
      );
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.barkod}' barkodu zaten kayıtlı`);
      }
      throw hata;
    }
  }

  async barkodSil(stokId: string, barkodId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokBarkod.deleteMany({ where: { id: barkodId, stokId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Barkod bulunamadı");
  }

  /** Barkodla ürün bulma (STK-15): önce barkod tablosu, sonra karttaki alan. */
  async barkodlaBul(barkod: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokBarkod.findUnique({
        where: { tenantId_barkod: { tenantId, barkod } },
        include: { stok: true },
      }),
    );
    if (kayit) {
      return {
        ...this.gorunum(kayit.stok),
        eslesenBarkod: {
          barkod: kayit.barkod,
          birim: kayit.birim ?? kayit.stok.anaBirim,
          satisFiyati: kayit.satisFiyati?.toFixed(4) ?? null,
        },
      };
    }
    const kart = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.findFirst({ where: { barkod } }),
    );
    if (!kart) throw new NotFoundException(`'${barkod}' barkoduna kayıtlı ürün yok`);
    return {
      ...this.gorunum(kart),
      eslesenBarkod: {
        barkod,
        birim: kart.anaBirim,
        satisFiyati: kart.satisFiyati?.toFixed(4) ?? null,
      },
    };
  }

  /**
   * Barkod etiket PDF'i (STK-15 devamı): seçilen ürünler için 3×8 etiket
   * ızgarası. Barkod belirtilmezse ürünün ilk barkodu (yoksa karttaki
   * barkod alanı) kullanılır.
   */
  async etiketPdf(girdi: z.infer<typeof etiketBasSemasi>): Promise<Buffer> {
    const { tenantId } = aktifBaglam();
    const etiketler = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc: EtiketVerisi[] = [];
      for (const kalem of girdi.kalemler) {
        const kart = await tx.stokKart.findUnique({
          where: { id: kalem.stokId },
          include: { barkodlar: true },
        });
        if (!kart) throw new NotFoundException("Stok kartı bulunamadı");

        let barkod: string | undefined;
        let satisFiyati: Prisma.Decimal | null = kart.satisFiyati;
        if (kalem.barkod) {
          const kayit = kart.barkodlar.find((b) => b.barkod === kalem.barkod);
          if (!kayit && kart.barkod !== kalem.barkod) {
            throw new BadRequestException(
              `'${kart.ad}' ürününde '${kalem.barkod}' barkodu tanımlı değil`,
            );
          }
          barkod = kalem.barkod;
          if (kayit?.satisFiyati) satisFiyati = kayit.satisFiyati;
        } else {
          const ilk = kart.barkodlar[0];
          barkod = ilk?.barkod ?? kart.barkod ?? undefined;
          if (ilk?.satisFiyati) satisFiyati = ilk.satisFiyati;
        }
        if (!barkod) {
          throw new BadRequestException(
            `'${kart.ad}' için tanımlı barkod yok; önce barkod ekleyin`,
          );
        }
        for (let i = 0; i < kalem.adet; i++) {
          sonuc.push({
            urunAd: kart.ad,
            urunKod: kart.kod,
            barkod,
            satisFiyati: satisFiyati?.toFixed(2) ?? null,
          });
        }
      }
      return sonuc;
    });
    return this.pdf.htmlToPdf(etiketPdfHtml(etiketler));
  }

  // ─── TEDARİKÇİLER (STK-18) ───────────────────────────────────────────────

  async tedarikciEkle(stokId: string, girdi: z.infer<typeof stokTedarikciSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(stokId);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Tek varsayılan tedarikçi olur
      if (girdi.varsayilan) {
        await tx.stokTedarikci.updateMany({
          where: { stokId },
          data: { varsayilan: false },
        });
      }
      return tx.stokTedarikci.upsert({
        where: { tenantId_stokId_cariId: { tenantId, stokId, cariId: girdi.cariId } },
        create: {
          tenantId,
          stokId,
          cariId: girdi.cariId,
          tedarikciUrunKodu: girdi.tedarikciUrunKodu,
          alisFiyati: girdi.alisFiyati ? D(girdi.alisFiyati) : null,
          dovizCinsi: girdi.dovizCinsi,
          tedarikSuresiGun: girdi.tedarikSuresiGun,
          varsayilan: girdi.varsayilan,
        },
        update: {
          tedarikciUrunKodu: girdi.tedarikciUrunKodu,
          alisFiyati: girdi.alisFiyati ? D(girdi.alisFiyati) : null,
          dovizCinsi: girdi.dovizCinsi,
          tedarikSuresiGun: girdi.tedarikSuresiGun,
          varsayilan: girdi.varsayilan,
        },
      });
    });
  }

  async tedarikciSil(stokId: string, tedarikciId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokTedarikci.deleteMany({ where: { id: tedarikciId, stokId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Tedarikçi kaydı bulunamadı");
  }

  // ─── FİİLİ SAYIM (STK-06/20) ─────────────────────────────────────────────
  // Sayım taslak olarak kaydedilir; farklar yalnız onayla stoğa işlenir.

  async sayimOlustur(girdi: z.infer<typeof sayimOlusturSemasi>) {
    const { tenantId } = aktifBaglam();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Sayım tek depoyu kapsar (STK-07); depo verilmezse varsayılan depo
      const depoId = await this.depoService.depoCozumle(tx, girdi.depoId);
      const sayim = await tx.sayim.create({
        data: {
          tenantId,
          depoId,
          tarih: new Date(girdi.tarih),
          aciklama: girdi.aciklama,
        },
      });

      for (const k of girdi.kalemler) {
        const urun = await tx.stokKart.findUnique({
          where: { id: k.stokId },
          select: { id: true },
        });
        if (!urun) throw new NotFoundException(`Sayılmak istenen '${k.stokId}' ürünü bulunamadı`);

        // Sistem miktarı sayılan deponun bakiyesidir
        const bakiye = await tx.stokDepoBakiye.findUnique({
          where: { tenantId_stokId_depoId: { tenantId, stokId: k.stokId, depoId } },
        });

        await tx.sayimKalem.create({
          data: {
            tenantId,
            sayimId: sayim.id,
            stokId: k.stokId,
            sistemMiktar: D(bakiye?.mevcutMiktar ?? 0),
            fiiliMiktar: D(k.fiiliMiktar),
          },
        });
      }

      return sayim;
    });
  }

  /**
   * Sayım onayı (STK-20): farklar onay anındaki güncel sistem miktarına göre
   * yeniden hesaplanır ve sayim_duzeltme hareketleri olarak işlenir.
   */
  async sayimOnayla(id: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    if (!["muhasebe", "yonetici"].includes(rol)) {
      throw new ForbiddenException("Sayım onayı için muhasebe veya yönetici rolü gerekir");
    }

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sayim = await tx.sayim.findUnique({
        where: { id },
        include: { kalemler: true },
      });
      if (!sayim) throw new NotFoundException("Sayım bulunamadı");
      if (sayim.durum !== "taslak") {
        throw new BadRequestException("Sayım zaten onaylanmış");
      }

      for (const k of sayim.kalemler) {
        const urun = await tx.stokKart.findUnique({ where: { id: k.stokId } });
        if (!urun) continue;

        // Fark, sayılan deponun onay anındaki miktarına göre hesaplanır (STK-07/20)
        const bakiye = await tx.stokDepoBakiye.findUnique({
          where: {
            tenantId_stokId_depoId: { tenantId, stokId: k.stokId, depoId: sayim.depoId },
          },
        });
        const guncelSistem = D(bakiye?.mevcutMiktar ?? 0);
        const fark = D(k.fiiliMiktar).sub(guncelSistem);

        // Onay anındaki sistem miktarını kayda geçir
        await tx.sayimKalem.update({
          where: { id: k.id },
          data: { sistemMiktar: guncelSistem },
        });

        if (!fark.isZero()) {
          const birimMaliyet = guncelSistem.gt(0)
            ? D(urun.ortalamaMaliyet)
            : D(urun.alisFiyati ?? 0);

          await this.hareketEkle(tx, {
            stokId: k.stokId,
            depoId: sayim.depoId,
            tip: "sayim_duzeltme",
            miktar: fark,
            girilenBirim: urun.anaBirim,
            girilenMiktar: fark,
            birimMaliyet,
            tarih: new Date(sayim.tarih),
            aciklama: `${sayim.id} nolu sayım düzeltmesi`,
            kaynakTur: "sayim",
            kaynakRef: sayim.id,
          });
        }
      }

      return tx.sayim.update({
        where: { id },
        data: {
          durum: "onaylandi",
          onaylayanUserId: userId,
          onayZamani: new Date(),
        },
      });
    });
  }

  async sayimListesi() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.sayim.findMany({
        orderBy: { tarih: "desc" },
        include: {
          depo: { select: { id: true, kod: true, ad: true } },
          _count: { select: { kalemler: true } },
        },
      }),
    );
  }

  async sayimGetir(id: string) {
    const { tenantId } = aktifBaglam();
    const sayim = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.sayim.findUnique({
        where: { id },
        include: {
          depo: { select: { id: true, kod: true, ad: true } },
          kalemler: true,
        },
      }),
    );
    if (!sayim) throw new NotFoundException("Sayım bulunamadı");

    const stokIdler = sayim.kalemler.map((k) => k.stokId);
    const stoklar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.findMany({
        where: { id: { in: stokIdler } },
        select: { id: true, kod: true, ad: true, anaBirim: true },
      }),
    );
    const stokMap = new Map(stoklar.map((s) => [s.id, s]));

    return {
      ...sayim,
      kalemler: sayim.kalemler.map((k) => ({
        ...k,
        stok: stokMap.get(k.stokId) ?? null,
      })),
    };
  }

  // Envanter raporu RPR-06 araç setine taşındı: stok.envanter (STK-13).

  // ─── PRIVATE YARDIMCILAR ──────────────────────────────────────────────────

  private eylemler(
    kayit: { aktif: boolean },
    _rol: string,
    hareketSayisi: number,
  ): KayitEylem[] {
    return izinliEylemler(
      "stok",
      { aktif: kayit.aktif, hareketSayisi },
      aktifBaglam(),
    );
  }

  private gorunum(k: {
    id: string;
    kod: string;
    ad: string;
    kisaAd: string | null;
    aciklama: string | null;
    tip: string;
    marka: string | null;
    model: string | null;
    mensei: string | null;
    gtipKodu: string | null;
    ureticiUrunKodu: string | null;
    barkod: string | null;
    kategoriId: string | null;
    anaBirim: string;
    kdvOrani: Prisma.Decimal;
    alisFiyati: Prisma.Decimal | null;
    satisFiyati: Prisma.Decimal | null;
    alisFiyatiDoviz: "TRY" | "USD" | "EUR";
    satisFiyatiDoviz: "TRY" | "USD" | "EUR";
    kritikSeviye: Prisma.Decimal | null;
    minStok: Prisma.Decimal | null;
    maksStok: Prisma.Decimal | null;
    guvenlikStogu: Prisma.Decimal | null;
    tedarikSuresiGun: number | null;
    gorselUrl: string | null;
    mevcutMiktar: Prisma.Decimal;
    rezerveMiktar: Prisma.Decimal;
    yoldakiMiktar: Prisma.Decimal;
    ortalamaMaliyet: Prisma.Decimal;
    aktif: boolean;
    takipTipi: "yok" | "lot" | "seri";
  }) {
    return {
      id: k.id,
      kod: k.kod,
      ad: k.ad,
      kisaAd: k.kisaAd,
      aciklama: k.aciklama,
      tip: k.tip,
      marka: k.marka,
      model: k.model,
      mensei: k.mensei,
      gtipKodu: k.gtipKodu,
      ureticiUrunKodu: k.ureticiUrunKodu,
      barkod: k.barkod,
      kategoriId: k.kategoriId,
      anaBirim: k.anaBirim,
      kdvOrani: D(k.kdvOrani).toFixed(2),
      alisFiyati: k.alisFiyati ? D(k.alisFiyati).toFixed(4) : null,
      satisFiyati: k.satisFiyati ? D(k.satisFiyati).toFixed(4) : null,
      alisFiyatiDoviz: k.alisFiyatiDoviz,
      satisFiyatiDoviz: k.satisFiyatiDoviz,
      kritikSeviye: k.kritikSeviye ? D(k.kritikSeviye).toFixed(3) : null,
      minStok: k.minStok ? D(k.minStok).toFixed(3) : null,
      maksStok: k.maksStok ? D(k.maksStok).toFixed(3) : null,
      guvenlikStogu: k.guvenlikStogu ? D(k.guvenlikStogu).toFixed(3) : null,
      tedarikSuresiGun: k.tedarikSuresiGun,
      gorselUrl: k.gorselUrl,
      mevcutMiktar: D(k.mevcutMiktar).toFixed(3),
      // FTR-12 göstergeleri: rezerve (açık satış siparişi), yoldaki (açık
      // alış siparişi) ve kullanılabilir = mevcut − rezerve
      rezerveMiktar: D(k.rezerveMiktar).toFixed(3),
      yoldakiMiktar: D(k.yoldakiMiktar).toFixed(3),
      kullanilabilirMiktar: D(k.mevcutMiktar).sub(D(k.rezerveMiktar)).toFixed(3),
      ortalamaMaliyet: D(k.ortalamaMaliyet).toFixed(4),
      aktif: k.aktif,
      takipTipi: k.takipTipi,
    };
  }

  async excelOnizle(buffer: Buffer) {
    const { tenantId } = aktifBaglam();
    const urunler = await stokExcelOku(buffer);
    if (urunler.length === 0) {
      throw new BadRequestException("Excel dosyasında aktarılabilir ürün bulunamadı");
    }

    const kodlar = [...new Set(urunler.map((urun) => urun.kod))];
    const mevcutlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.findMany({
        where: { kod: { in: kodlar } },
        select: { kod: true },
      }),
    );
    const mevcutKodlar = new Set(mevcutlar.map((stok) => stok.kod));
    const satirlar = urunler.map((urun) => ({
      ...urun,
      islem: mevcutKodlar.has(urun.kod) ? "guncelle" : "ekle",
    }));

    return {
      toplam: satirlar.length,
      eklenecek: satirlar.filter((satir) => satir.islem === "ekle").length,
      guncellenecek: satirlar.filter((satir) => satir.islem === "guncelle").length,
      satirlar: satirlar.slice(0, 20),
      kirpildi: satirlar.length > 20,
    };
  }

  async excelImport(buffer: Buffer): Promise<{ eklenen: number }> {
    const { tenantId } = aktifBaglam();
    const urunler = await stokExcelOku(buffer);

    await this.prisma.tenantIslem(tenantId, async (tx) => {
      for (const u of urunler) {
        await tx.stokKart.upsert({
          where: { tenantId_kod: { tenantId, kod: u.kod } },
          create: {
            tenantId,
            kod: u.kod,
            ad: u.ad,
            tip: u.tip,
            barkod: u.barkod,
            kdvOrani: u.kdvOrani,
            alisFiyati: u.alisFiyati,
            satisFiyati: u.satisFiyati,
            mevcutMiktar: 0,
            ortalamaMaliyet: 0,
          },
          update: {
            ad: u.ad,
            tip: u.tip,
            barkod: u.barkod,
            kdvOrani: u.kdvOrani,
            alisFiyati: u.alisFiyati,
            satisFiyati: u.satisFiyati,
          },
        });
      }
    });

    return { eklenen: urunler.length };
  }
}
