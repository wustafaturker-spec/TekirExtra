import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, CekSenetDurum, DovizCinsi } from "@prisma/client";
import type { KayitEylem } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { izinliEylemler } from "../core/eylemler/eylem-kayit";
import { PrismaService } from "../core/prisma.service";
import type {
  bankaHesapGuncelleSemasi,
  bankaHesapOlusturSemasi,
  cekSenetGuncelleSemasi,
  cekSenetOlusturSemasi,
  kasaBankaHareketOlusturSemasi,
  kasaGuncelleSemasi,
  kasaOlusturSemasi,
  virmanOlusturSemasi,
} from "./kasa-banka.semalar";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

export interface KasaBankaBakiye {
  borc: string;
  alacak: string;
  bakiye: string;
}

@Injectable()
export class KasaBankaService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── KASA YÖNETİMİ (KSB-01/04) ─────────────────────────────────────────────

  async kasaListele() {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();
    const kasalar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasa.findMany({
        orderBy: { ad: "asc" },
        include: { _count: { select: { hareketler: true } } },
      }),
    );

    const bakiyeler = await this.kasaBakiyeleri(kasalar.map((k) => k.id));

    return kasalar.map((k) => {
      const bakiye = bakiyeler.get(k.id) ?? { borc: "0.00", alacak: "0.00", bakiye: "0.00" };
      return {
        id: k.id,
        ad: k.ad,
        dovizCinsi: k.dovizCinsi,
        aktif: k.aktif,
        bakiye: bakiye.bakiye,
        borc: bakiye.borc,
        alacak: bakiye.alacak,
        izinliEylemler: this.eylemler("kasa", k, ctx.rol, k._count.hareketler),
      };
    });
  }

  async kasaGetir(id: string) {
    const ctx = aktifBaglam();
    const kasa = await this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.kasa.findUnique({
        where: { id },
        include: { _count: { select: { hareketler: true } } },
      }),
    );
    if (!kasa) throw new NotFoundException("Kasa bulunamadı");

    const bakiyeler = await this.kasaBakiyeleri([id]);
    const bakiye = bakiyeler.get(id) ?? { borc: "0.00", alacak: "0.00", bakiye: "0.00" };

    return {
      id: kasa.id,
      ad: kasa.ad,
      dovizCinsi: kasa.dovizCinsi,
      aktif: kasa.aktif,
      bakiye: bakiye.bakiye,
      borc: bakiye.borc,
      alacak: bakiye.alacak,
      izinliEylemler: this.eylemler("kasa", kasa, ctx.rol, kasa._count.hareketler),
    };
  }

  async kasaOlustur(girdi: z.infer<typeof kasaOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.kasa.create({
          data: {
            tenantId,
            ad: girdi.ad,
            dovizCinsi: girdi.dovizCinsi,
          },
        }),
      );
    } catch {
      throw new BadRequestException(`'${girdi.ad}' adında kasa zaten mevcut`);
    }
  }

  async kasaGuncelle(id: string, girdi: z.infer<typeof kasaGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.kasaGetir(id);
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.kasa.update({
          where: { id },
          data: girdi,
        }),
      );
    } catch {
      throw new BadRequestException(`'${girdi.ad}' adında kasa zaten mevcut`);
    }
  }

  async kasaSil(id: string) {
    const { tenantId } = aktifBaglam();
    const hareketSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasaBankaHareket.count({ where: { kasaId: id } }),
    );
    if (hareketSayisi > 0) {
      throw new BadRequestException("Hareketi olan kasa silinemez; pasife alın");
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasa.delete({ where: { id } }),
    );
  }

  // ─── BANKA HESAP YÖNETİMİ (KSB-01/04) ──────────────────────────────────────

  async bankaListele() {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();
    const hesaplar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaHesap.findMany({
        orderBy: { ad: "asc" },
        include: { _count: { select: { hareketler: true } } },
      }),
    );

    const bakiyeler = await this.bankaBakiyeleri(hesaplar.map((h) => h.id));

    return hesaplar.map((h) => {
      const bakiye = bakiyeler.get(h.id) ?? { borc: "0.00", alacak: "0.00", bakiye: "0.00" };
      return {
        id: h.id,
        ad: h.ad,
        bankaAdi: h.bankaAdi,
        sube: h.sube,
        hesapNo: h.hesapNo,
        iban: h.iban,
        dovizCinsi: h.dovizCinsi,
        aktif: h.aktif,
        bakiye: bakiye.bakiye,
        borc: bakiye.borc,
        alacak: bakiye.alacak,
        izinliEylemler: this.eylemler("banka", h, ctx.rol, h._count.hareketler),
      };
    });
  }

  async bankaGetir(id: string) {
    const ctx = aktifBaglam();
    const hesap = await this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.bankaHesap.findUnique({
        where: { id },
        include: { _count: { select: { hareketler: true } } },
      }),
    );
    if (!hesap) throw new NotFoundException("Banka hesabı bulunamadı");

    const bakiyeler = await this.bankaBakiyeleri([id]);
    const bakiye = bakiyeler.get(id) ?? { borc: "0.00", alacak: "0.00", bakiye: "0.00" };

    return {
      id: hesap.id,
      ad: hesap.ad,
      bankaAdi: hesap.bankaAdi,
      sube: hesap.sube,
      hesapNo: hesap.hesapNo,
      iban: hesap.iban,
      dovizCinsi: hesap.dovizCinsi,
      aktif: hesap.aktif,
      bakiye: bakiye.bakiye,
      borc: bakiye.borc,
      alacak: bakiye.alacak,
      izinliEylemler: this.eylemler("banka", hesap, ctx.rol, hesap._count.hareketler),
    };
  }

  async bankaOlustur(girdi: z.infer<typeof bankaHesapOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.bankaHesap.create({
          data: {
            tenantId,
            ad: girdi.ad,
            bankaAdi: girdi.bankaAdi,
            sube: girdi.sube,
            hesapNo: girdi.hesapNo,
            iban: girdi.iban,
            dovizCinsi: girdi.dovizCinsi,
          },
        }),
      );
    } catch {
      throw new BadRequestException(`'${girdi.ad}' adında banka hesabı zaten mevcut`);
    }
  }

  async bankaGuncelle(id: string, girdi: z.infer<typeof bankaHesapGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.bankaGetir(id);
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.bankaHesap.update({
          where: { id },
          data: girdi,
        }),
      );
    } catch {
      throw new BadRequestException(`'${girdi.ad}' adında banka hesabı zaten mevcut`);
    }
  }

  async bankaSil(id: string) {
    const { tenantId } = aktifBaglam();
    const hareketSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasaBankaHareket.count({ where: { bankaHesapId: id } }),
    );
    if (hareketSayisi > 0) {
      throw new BadRequestException("Hareketi olan banka hesabı silinemez; pasife alın");
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaHesap.delete({ where: { id } }),
    );
  }

  // ─── HAREKET YÖNETİMİ & FATURA KAPAMA (KSB-02/07) ─────────────────────────

  async hareketListele(kasaId?: string, bankaHesapId?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasaBankaHareket.findMany({
        where: {
          kasaId: kasaId || undefined,
          bankaHesapId: bankaHesapId || undefined,
        },
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        include: {
          cari: { select: { id: true, kod: true, unvan: true } },
          fatura: { select: { id: true, no: true, genelToplam: true } },
        },
      }),
    );
  }

  async hareketEkle(girdi: z.infer<typeof kasaBankaHareketOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    const tutar = D(girdi.tutar);
    const kur = D(girdi.kur);
    const tutarTry = tutar.mul(kur).toDecimalPlaces(2);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // 1. Kasa/Banka hareketini oluştur
      const hareket = await tx.kasaBankaHareket.create({
        data: {
          tenantId,
          kasaId: girdi.kasaId,
          bankaHesapId: girdi.bankaHesapId,
          tip: girdi.tip,
          tutar,
          dovizCinsi: girdi.dovizCinsi,
          kur,
          tutarTry,
          tarih: new Date(girdi.tarih),
          aciklama: girdi.aciklama,
          cariId: girdi.cariId,
          faturaId: girdi.faturaId,
          kaynakTur: girdi.faturaId ? "fatura_kapama" : "manuel",
          kaynakRef: girdi.faturaId || null,
        },
      });

      // 2. Cari bağlantısı varsa Cari Hareketini oluştur (KSB-02)
      // Tahsilat -> Cari alacaklanır (borcu azalır)
      // Tediye -> Cari borçlanır (alacağı azalır)
      if (girdi.cariId) {
        const cariHareketTip = girdi.tip === "tahsilat" ? "alacak" : "borc";
        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: girdi.cariId,
            tip: cariHareketTip,
            tutar,
            dovizCinsi: girdi.dovizCinsi,
            kur,
            tutarTry,
            tarih: new Date(girdi.tarih),
            aciklama: girdi.aciklama ?? `${girdi.tip.toUpperCase()} kasa/banka fişi`,
            kaynakTur: "kasa_banka",
            kaynakRef: hareket.id,
          },
        });
      }

      return hareket;
    });
  }

  // ─── HESAPLAR ARASI VİRMAN (KSB-03) ───────────────────────────────────────

  async virmanEkle(girdi: z.infer<typeof virmanOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    const tutar = D(girdi.tutar);

    // Kasa ve banka hesaplarının para birimlerini kontrol et (Aynı birim olmalı)
    const dovizCinsi = await this.virmanKurallariniDenetle(girdi);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // 1. Kaynak hesaptan para çıkışı (virman_gidis)
      const gidis = await tx.kasaBankaHareket.create({
        data: {
          tenantId,
          kasaId: girdi.kaynakKasaId || null,
          bankaHesapId: girdi.kaynakBankaHesapId || null,
          tip: "virman_gidis",
          tutar,
          dovizCinsi,
          kur: 1,
          tutarTry: tutar,
          tarih: new Date(girdi.tarih),
          aciklama: girdi.aciklama ?? "Hesaplar arası virman transferi",
        },
      });

      // 2. Hedef hesaba para girişi (virman_gelis)
      const gelis = await tx.kasaBankaHareket.create({
        data: {
          tenantId,
          kasaId: girdi.hedefKasaId || null,
          bankaHesapId: girdi.hedefBankaHesapId || null,
          tip: "virman_gelis",
          tutar,
          dovizCinsi,
          kur: 1,
          tutarTry: tutar,
          tarih: new Date(girdi.tarih),
          aciklama: girdi.aciklama ?? "Hesaplar arası virman transferi",
          karsiHareketId: gidis.id,
        },
      });

      // 3. Kaynak harekete karşı hareket ID'sini yaz
      await tx.kasaBankaHareket.update({
        where: { id: gidis.id },
        data: { karsiHareketId: gelis.id },
      });

      return { gidis, gelis };
    });
  }

  // ─── ÇEK VE SENET TAKİBİ (KSB-05) ─────────────────────────────────────────

  async cekSenetListele(tur?: "cek" | "senet", durum?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cekSenet.findMany({
        where: {
          tur: tur || undefined,
          durum: durum ? (durum as CekSenetDurum) : undefined,
        },
        orderBy: { vadeTarihi: "asc" },
        include: {
          cari: { select: { id: true, kod: true, unvan: true } },
          ciroCari: { select: { id: true, kod: true, unvan: true } },
        },
      }),
    );
  }

  async cekSenetGetir(id: string) {
    const { tenantId } = aktifBaglam();
    const CS = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cekSenet.findUnique({
        where: { id },
        include: {
          cari: true,
          ciroCari: true,
        },
      }),
    );
    if (!CS) throw new NotFoundException("Çek/Senet bulunamadı");
    return CS;
  }

  async cekSenetOlustur(girdi: z.infer<typeof cekSenetOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    const tutar = D(girdi.tutar);
    const kur = D(girdi.kur);
    const tutarTry = tutar.mul(kur).toDecimalPlaces(2);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const CS = await tx.cekSenet.create({
        data: {
          tenantId,
          tur: girdi.tur,
          portfoyNo: girdi.portfoyNo,
          vadeTarihi: new Date(girdi.vadeTarihi),
          tutar,
          dovizCinsi: girdi.dovizCinsi,
          kur,
          tutarTry,
          borclu: girdi.borclu,
          kesideYeri: girdi.kesideYeri,
          banka: girdi.banka,
          sube: girdi.sube,
          hesapNo: girdi.hesapNo,
          durum: "portfoyde",
          cariId: girdi.cariId,
          aciklama: girdi.aciklama,
        },
      });

      // Çek/Senet aldığımızda cari hesap alacaklanır (borcu azalır)
      if (girdi.cariId) {
        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: girdi.cariId,
            tip: "alacak",
            tutar,
            dovizCinsi: girdi.dovizCinsi,
            kur,
            tutarTry,
            tarih: new Date(),
            aciklama: `${girdi.tur.toUpperCase()} alımı (Portföy No: ${girdi.portfoyNo})`,
            kaynakTur: "cek_senet",
            kaynakRef: CS.id,
          },
        });
      }

      return CS;
    });
  }

  async cekSenetGuncelle(id: string, girdi: z.infer<typeof cekSenetGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    const CS = await this.cekSenetGetir(id);

    // Tahsil hesabının para birimi çek/senetle uyuşmalı (KSB-05)
    if (girdi.durum === "tahsil_edildi" && CS.durum !== "tahsil_edildi") {
      await this.tahsilHesabiniDenetle(girdi, CS.dovizCinsi);
    }

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const guncel = await tx.cekSenet.update({
        where: { id },
        data: {
          durum: girdi.durum,
          ciroCariId: girdi.ciroCariId,
          aciklama: girdi.aciklama ?? CS.aciklama,
        },
      });

      // Tahsil edilince para seçilen kasa/bankaya girer (KSB-05).
      // Cari, çek alımında zaten alacaklandığı için burada cari hareketi
      // YAZILMAZ (çift kayıt olur); bu yüzden fişte cariId boş bırakılır.
      // Koşul, durum zaten tahsil ise ikinci fişi engeller.
      if (girdi.durum === "tahsil_edildi" && CS.durum !== "tahsil_edildi") {
        await tx.kasaBankaHareket.create({
          data: {
            tenantId,
            kasaId: girdi.tahsilKasaId ?? null,
            bankaHesapId: girdi.tahsilBankaHesapId ?? null,
            tip: "tahsilat",
            tutar: CS.tutar,
            dovizCinsi: CS.dovizCinsi,
            kur: CS.kur,
            tutarTry: D(CS.tutar).mul(D(CS.kur)).toDecimalPlaces(2),
            tarih: girdi.tahsilTarihi ? new Date(girdi.tahsilTarihi) : new Date(),
            aciklama: `${CS.tur.toUpperCase()} tahsili (Portföy No: ${CS.portfoyNo}, Borçlu: ${CS.borclu})`,
            kaynakTur: "cek_senet",
            kaynakRef: CS.id,
          },
        });
      }

      // Ciro edilirse ciro edilen cariye alacak (borcumuz azalır) yazarız
      if (girdi.durum === "ciro_edildi" && girdi.ciroCariId) {
        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: girdi.ciroCariId,
            tip: "alacak", // Biz onlara ödeme yapıyoruz (ciro), alacak yazarız
            tutar: CS.tutar,
            dovizCinsi: CS.dovizCinsi,
            kur: CS.kur,
            tutarTry: D(CS.tutar).mul(D(CS.kur)).toDecimalPlaces(2),
            tarih: new Date(),
            aciklama: `${CS.tur.toUpperCase()} Ciro Edildi (Portföy No: ${CS.portfoyNo})`,
            kaynakTur: "cek_senet",
            kaynakRef: CS.id,
          },
        });
      }

      return guncel;
    });
  }

  // ─── BAKİYE HESAPLAMA METOTLARI (PRIVATE) ──────────────────────────────────

  private async kasaBakiyeleri(kasaIdler: string[]): Promise<Map<string, KasaBankaBakiye>> {
    if (kasaIdler.length === 0) return new Map();
    const { tenantId } = aktifBaglam();

    const gruplar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasaBankaHareket.groupBy({
        by: ["kasaId", "tip"],
        where: { kasaId: { in: kasaIdler } },
        _sum: { tutar: true },
      }),
    );

    const sonuc = new Map<string, KasaBankaBakiye>();
    kasaIdler.forEach((id) => {
      sonuc.set(id, { borc: "0.00", alacak: "0.00", bakiye: "0.00" });
    });

    for (const g of gruplar) {
      if (!g.kasaId) continue;
      const mevcut = sonuc.get(g.kasaId) ?? { borc: "0.00", alacak: "0.00", bakiye: "0.00" };
      const tutarVal = D(g._sum.tutar ?? 0);

      // Kasa için:
      // borç (girişler): tahsilat, virman_gelis
      // alacak (çıkışlar): tediye, virman_gidis
      if (g.tip === "tahsilat" || g.tip === "virman_gelis") {
        mevcut.borc = D(mevcut.borc).add(tutarVal).toFixed(2);
      } else {
        mevcut.alacak = D(mevcut.alacak).add(tutarVal).toFixed(2);
      }
      mevcut.bakiye = D(mevcut.borc).sub(D(mevcut.alacak)).toFixed(2);
      sonuc.set(g.kasaId, mevcut);
    }

    return sonuc;
  }

  private async bankaBakiyeleri(hesapIdler: string[]): Promise<Map<string, KasaBankaBakiye>> {
    if (hesapIdler.length === 0) return new Map();
    const { tenantId } = aktifBaglam();

    const gruplar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kasaBankaHareket.groupBy({
        by: ["bankaHesapId", "tip"],
        where: { bankaHesapId: { in: hesapIdler } },
        _sum: { tutar: true },
      }),
    );

    const sonuc = new Map<string, KasaBankaBakiye>();
    hesapIdler.forEach((id) => {
      sonuc.set(id, { borc: "0.00", alacak: "0.00", bakiye: "0.00" });
    });

    for (const g of gruplar) {
      if (!g.bankaHesapId) continue;
      const mevcut = sonuc.get(g.bankaHesapId) ?? { borc: "0.00", alacak: "0.00", bakiye: "0.00" };
      const tutarVal = D(g._sum.tutar ?? 0);

      if (g.tip === "tahsilat" || g.tip === "virman_gelis") {
        mevcut.borc = D(mevcut.borc).add(tutarVal).toFixed(2);
      } else {
        mevcut.alacak = D(mevcut.alacak).add(tutarVal).toFixed(2);
      }
      mevcut.bakiye = D(mevcut.borc).sub(D(mevcut.alacak)).toFixed(2);
      sonuc.set(g.bankaHesapId, mevcut);
    }

    return sonuc;
  }

  /**
   * Tahsil hesabının var olduğunu ve para biriminin çek/senetle uyuştuğunu
   * doğrular; uyuşmazsa hesabın bakiyesi karışık para birimine düşerdi.
   */
  private async tahsilHesabiniDenetle(
    girdi: z.infer<typeof cekSenetGuncelleSemasi>,
    cekDovizCinsi: DovizCinsi,
  ): Promise<void> {
    const { tenantId } = aktifBaglam();

    const hesapDovizi = girdi.tahsilKasaId
      ? (
          await this.prisma.tenantIslem(tenantId, (tx) =>
            tx.kasa.findUnique({ where: { id: girdi.tahsilKasaId! } }),
          )
        )?.dovizCinsi
      : (
          await this.prisma.tenantIslem(tenantId, (tx) =>
            tx.bankaHesap.findUnique({ where: { id: girdi.tahsilBankaHesapId! } }),
          )
        )?.dovizCinsi;

    if (!hesapDovizi) {
      throw new BadRequestException("Tahsil için seçilen kasa/banka hesabı bulunamadı");
    }
    if (hesapDovizi !== cekDovizCinsi) {
      throw new BadRequestException(
        `Çek/senet ${cekDovizCinsi} cinsinden; ${hesapDovizi} hesabına tahsil edilemez`,
      );
    }
  }

  private async virmanKurallariniDenetle(girdi: z.infer<typeof virmanOlusturSemasi>): Promise<DovizCinsi> {
    const { tenantId } = aktifBaglam();

    let kaynakDoviz: DovizCinsi | undefined;
    let hedefDoviz: DovizCinsi | undefined;

    if (girdi.kaynakKasaId) {
      const k = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.kasa.findUnique({ where: { id: girdi.kaynakKasaId! } }),
      );
      kaynakDoviz = k?.dovizCinsi;
    } else {
      const b = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.bankaHesap.findUnique({ where: { id: girdi.kaynakBankaHesapId! } }),
      );
      kaynakDoviz = b?.dovizCinsi;
    }

    if (girdi.hedefKasaId) {
      const k = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.kasa.findUnique({ where: { id: girdi.hedefKasaId! } }),
      );
      hedefDoviz = k?.dovizCinsi;
    } else {
      const b = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.bankaHesap.findUnique({ where: { id: girdi.hedefBankaHesapId! } }),
      );
      hedefDoviz = b?.dovizCinsi;
    }

    if (!kaynakDoviz || !hedefDoviz) {
      throw new BadRequestException("Kaynak veya Hedef hesap bulunamadı");
    }

    if (kaynakDoviz !== hedefDoviz) {
      throw new BadRequestException("Farklı döviz cinsleri arasında virman yapılamaz");
    }

    return kaynakDoviz;
  }

  private eylemler(
    varlik: "kasa" | "banka",
    kayit: { aktif: boolean },
    _rol: string,
    hareketSayisi: number,
  ): KayitEylem[] {
    return izinliEylemler(
      varlik,
      { aktif: kayit.aktif, hareketSayisi },
      aktifBaglam(),
    );
  }
}
