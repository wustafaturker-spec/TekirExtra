import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, CekSenetDurum, CekSenetYon, DovizCinsi } from "@prisma/client";
import type { KayitEylem } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { izinliEylemler } from "../core/eylemler/eylem-kayit";
import { PrismaService } from "../core/prisma.service";
import { PdfService } from "../core/pdf/pdf.service";
import { makbuzPdfHtml } from "./makbuz-pdf";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import type {
  bankaHesapGuncelleSemasi,
  bankaHesapOlusturSemasi,
  cekSenetGuncelleSemasi,
  cekSenetOlusturSemasi,
  kasaBankaHareketOlusturSemasi,
  kasaGuncelleSemasi,
  kasaOlusturSemasi,
  virmanOlusturSemasi,
  posHesapOlusturSemasi,
  posBankaAktarimSemasi,
} from "./kasa-banka.semalar";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

export interface KasaBankaBakiye {
  borc: string;
  alacak: string;
  bakiye: string;
}

@Injectable()
export class KasaBankaService {
  constructor(private readonly prisma: PrismaService, private readonly pdf: PdfService, private readonly donemKilidi: DonemKilidiService) {}

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

  async posHesapListele() {
    const { tenantId } = aktifBaglam();
    const hesaplar = await this.prisma.tenantIslem(tenantId, (tx) => tx.posHesap.findMany({ orderBy: { ad: "asc" }, include: { varsayilanBankaHesap: { select: { id: true, ad: true } }, baglanti: { select: { durum: true, sonSenkronHatasi: true, updatedAt: true } } } }));
    const gruplar = await this.prisma.tenantIslem(tenantId, (tx) => tx.kasaBankaHareket.groupBy({ by: ["posHesapId", "tip"], where: { posHesapId: { in: hesaplar.map((h) => h.id) } }, _sum: { tutar: true } }));
    return hesaplar.map((h) => { let bakiye = D(0); for (const g of gruplar.filter((x) => x.posHesapId === h.id)) bakiye = g.tip === "tahsilat" || g.tip === "virman_gelis" ? bakiye.add(g._sum.tutar ?? 0) : bakiye.sub(g._sum.tutar ?? 0); return { ...h, bakiye: bakiye.toFixed(2) }; });
  }

  async posHesapOlustur(girdi: z.infer<typeof posHesapOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (girdi.baglantiId) { const b = await tx.baglanti.findFirst({ where: { id: girdi.baglantiId, aile: "pos" } }); if (!b) throw new BadRequestException("POS bağlantısı bulunamadı"); if (b.saglayici !== girdi.saglayici) throw new BadRequestException("POS hesabı ile bağlantı sağlayıcısı uyuşmuyor"); }
      if (girdi.varsayilanBankaHesapId) { const b = await tx.bankaHesap.findUnique({ where: { id: girdi.varsayilanBankaHesapId } }); if (!b || b.dovizCinsi !== girdi.dovizCinsi) throw new BadRequestException("Varsayılan banka hesabı aynı döviz cinsinde olmalıdır"); }
      return tx.posHesap.create({ data: { tenantId, ...girdi } });
    });
  }

  // ─── HAREKET YÖNETİMİ & FATURA KAPAMA (KSB-02/07) ─────────────────────────

  async hareketListele(kasaId?: string, bankaHesapId?: string, posHesapId?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hareketler = await tx.kasaBankaHareket.findMany({
        where: {
          kasaId: kasaId || undefined,
          bankaHesapId: bankaHesapId || undefined,
          posHesapId: posHesapId || undefined,
        },
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        include: {
          kasa: { select: { id: true, ad: true } },
          bankaHesap: { select: { id: true, ad: true, bankaAdi: true } },
          cari: { select: { id: true, kod: true, unvan: true } },
          fatura: { select: { id: true, no: true, genelToplam: true } },
          posHesap: { select: { id: true, ad: true, saglayici: true } },
        },
      });
      if (kasaId || bankaHesapId || posHesapId) return hareketler;
      const cekler = await tx.cekSenet.findMany({
        where: { tenantId, yon: "alinan", durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi", "tahsil_edildi"] } },
        select: { id: true, tutar: true, dovizCinsi: true, kur: true, tutarTry: true, islemTarihi: true, portfoyNo: true, tur: true, borclu: true, cari: { select: { id: true, kod: true, unvan: true } } },
        orderBy: { islemTarihi: "desc" },
      });
      const fisliCekler = new Set(hareketler.map((h) => h.kaynakRef).filter(Boolean));
      return [...hareketler, ...cekler.filter((cek) => !fisliCekler.has(cek.id)).map((cek) => ({
        id: cek.id, kasaId: null, bankaHesapId: null, posHesapId: null, tip: "tahsilat" as const, tutar: cek.tutar, dovizCinsi: cek.dovizCinsi, kur: cek.kur, tutarTry: cek.tutarTry, tarih: cek.islemTarihi, aciklama: `${cek.tur.toUpperCase()} tahsilatı (Portföy No: ${cek.portfoyNo}, Borçlu: ${cek.borclu})`, cariId: cek.cari?.id ?? null, faturaId: null, karsiHareketId: null, kaynakTur: "cek_senet", kaynakRef: cek.id, createdAt: cek.islemTarihi, kasa: null, bankaHesap: null, cari: cek.cari, fatura: null, posHesap: null,
      }))].sort((a, b) => new Date(b.tarih).getTime() - new Date(a.tarih).getTime());
    });
  }

  async hareketEkle(girdi: z.infer<typeof kasaBankaHareketOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "kasa/banka hareketi oluşturma");
    const tutar = D(girdi.tutar);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hesap = girdi.kasaId ? await tx.kasa.findUnique({ where: { id: girdi.kasaId } }) : girdi.bankaHesapId ? await tx.bankaHesap.findUnique({ where: { id: girdi.bankaHesapId } }) : await tx.posHesap.findUnique({ where: { id: girdi.posHesapId! } });
      if (!hesap || !hesap.aktif) throw new BadRequestException("Aktif kasa, banka veya POS hesabı bulunamadı");
      if (hesap.dovizCinsi !== girdi.dovizCinsi) throw new BadRequestException(`Hesap ${hesap.dovizCinsi}, hareket ${girdi.dovizCinsi} cinsinde olamaz`);
      let cariId = girdi.cariId || null;
      if (cariId && !(await tx.cariHesap.findFirst({ where: { id: cariId, aktif: true }, select: { id: true } }))) throw new BadRequestException("Aktif cari hesap bulunamadı");
      if (girdi.faturaId) {
        const fatura = await tx.fatura.findUnique({ where: { id: girdi.faturaId }, select: { tip: true, durum: true, cariId: true, dovizCinsi: true, genelToplam: true, kasaBankaHarekets: { select: { tutar: true } }, krediKartiHareketleri: { select: { cariOdemeTutari: true } } } });
        if (!fatura || fatura.durum !== "kesin") throw new BadRequestException("Yalnızca kesinleşmiş faturaya ödeme bağlanabilir");
        const beklenenTip = ["satis", "alis_iade"].includes(fatura.tip) ? "tahsilat" : ["alis", "satis_iade"].includes(fatura.tip) ? "tediye" : null;
        if (!beklenenTip || girdi.tip !== beklenenTip) throw new BadRequestException(`Bu fatura için ${beklenenTip === "tahsilat" ? "tahsilat" : "tediye"} kaydı gereklidir`);

        // Çapraz Kur / Farklı Para Birimi Desteği: Fatura ile Ödeme Kasa/Banka farklı para birimlerinde olabilir
        if (cariId && cariId !== fatura.cariId) throw new BadRequestException("Seçilen cari faturanın carisiyle uyuşmuyor");
        cariId = fatura.cariId;
      }
      const hareketTarihi = new Date(girdi.tarih);
      const kur = girdi.dovizCinsi === "TRY" ? D(1) : girdi.kur ? D(girdi.kur) : await (async () => { const k = await tx.dovizKuru.findFirst({ where: { tarih: { lte: hareketTarihi }, dovizCinsi: girdi.dovizCinsi }, orderBy: { tarih: "desc" }, select: { dovizSatis: true } }); if (!k) throw new BadRequestException(`${girdi.dovizCinsi} için işlem tarihinde geçerli kur bulunamadı`); return k.dovizSatis; })();
      const tutarTry = tutar.mul(kur).toDecimalPlaces(2);
      // 1. Kasa/Banka hareketini oluştur
      const hareket = await tx.kasaBankaHareket.create({
        data: {
          tenantId,
          kasaId: girdi.kasaId,
          bankaHesapId: girdi.bankaHesapId,
          posHesapId: girdi.posHesapId,
          tip: girdi.tip,
          tutar,
          dovizCinsi: girdi.dovizCinsi,
          kur,
          tutarTry,
          tarih: hareketTarihi,
          aciklama: girdi.aciklama,
          cariId,
          faturaId: girdi.faturaId,
          kaynakTur: girdi.faturaId ? "fatura_kapama" : "manuel",
          kaynakRef: girdi.faturaId || null,
        },
      });

      // 2. Cari bağlantısı varsa Cari Hareketini oluştur (KSB-02)
      // Tahsilat -> Cari alacaklanır (borcu azalır)
      // Tediye -> Cari borçlanır (alacağı azalır)
      if (cariId) {
        const cariHareketTip = girdi.tip === "tahsilat" ? "alacak" : "borc";
        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId,
            tip: cariHareketTip,
            tutar,
            dovizCinsi: girdi.dovizCinsi,
            kur,
            tutarTry,
            tarih: hareketTarihi,
            aciklama: girdi.aciklama ?? `${girdi.tip.toUpperCase()} kasa/banka fişi`,
            kaynakTur: "kasa_banka",
            kaynakRef: hareket.id,
          },
        });
      }

      return hareket;
    });
  }

  async makbuzPdf(id: string): Promise<{ buffer: Buffer; dosyaAdi: string }> {
    const { tenantId } = aktifBaglam();
    const [hareket, firma] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.kasaBankaHareket.findUnique({ where: { id }, include: { kasa: true, bankaHesap: true, posHesap: true, cari: { select: { kod: true, unvan: true } }, fatura: { select: { no: true } } } }),
      tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }),
    ]));
    if (!hareket || !["tahsilat", "tediye"].includes(hareket.tip)) throw new NotFoundException("Tahsilat/ödeme makbuzu bulunamadı");
    const logo = await this.pdf.firmaLogoDataUri();
    return { buffer: await this.pdf.htmlToPdf(makbuzPdfHtml(hareket, firma, logo)), dosyaAdi: `${hareket.tip}-makbuzu-${hareket.id.slice(0, 8)}.pdf` };
  }

  // ─── HESAPLAR ARASI VİRMAN (KSB-03) ───────────────────────────────────────

  async virmanEkle(girdi: z.infer<typeof virmanOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    const tutar = D(girdi.tutar);

    // Kasa ve banka hesaplarının para birimlerini kontrol et (Aynı birim olmalı)
    const dovizCinsi = await this.virmanKurallariniDenetle(girdi);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const tarih = new Date(girdi.tarih); const kur = dovizCinsi === "TRY" ? D(1) : await (async () => { const k = await tx.dovizKuru.findFirst({ where: { tarih: { lte: tarih }, dovizCinsi }, orderBy: { tarih: "desc" }, select: { dovizSatis: true } }); if (!k) throw new BadRequestException(`${dovizCinsi} için virman tarihinde geçerli kur bulunamadı`); return k.dovizSatis; })(); const tutarTry = tutar.mul(kur).toDecimalPlaces(2);
      // 1. Kaynak hesaptan para çıkışı (virman_gidis)
      const gidis = await tx.kasaBankaHareket.create({
        data: {
          tenantId,
          kasaId: girdi.kaynakKasaId || null,
          bankaHesapId: girdi.kaynakBankaHesapId || null,
          posHesapId: girdi.kaynakPosHesapId || null,
          tip: "virman_gidis",
          tutar,
          dovizCinsi,
          kur,
          tutarTry,
          tarih,
          aciklama: girdi.aciklama ?? "Hesaplar arası virman transferi",
        },
      });

      // 2. Hedef hesaba para girişi (virman_gelis)
      const gelis = await tx.kasaBankaHareket.create({
        data: {
          tenantId,
          kasaId: girdi.hedefKasaId || null,
          bankaHesapId: girdi.hedefBankaHesapId || null,
          posHesapId: girdi.hedefPosHesapId || null,
          tip: "virman_gelis",
          tutar,
          dovizCinsi,
          kur,
          tutarTry,
          tarih,
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

  async posBankayaAktar(girdi: z.infer<typeof posBankaAktarimSemasi>) {
    const { tenantId } = aktifBaglam(); const brut = D(girdi.brutTutar); const komisyon = D(girdi.komisyonTutar); const net = brut.sub(komisyon);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const pos = await tx.posHesap.findUnique({ where: { id: girdi.posHesapId } });
      if (!pos || !pos.aktif) throw new NotFoundException("Aktif POS hesabı bulunamadı");
      const bankaId = girdi.bankaHesapId ?? pos.varsayilanBankaHesapId;
      if (!bankaId) throw new BadRequestException("Aktarım için banka hesabı seçilmelidir");
      const banka = await tx.bankaHesap.findUnique({ where: { id: bankaId } });
      if (!banka || !banka.aktif || banka.dovizCinsi !== pos.dovizCinsi) throw new BadRequestException("Aktif ve aynı döviz cinsinde banka hesabı seçilmelidir");
      const ekstreSatir = girdi.ekstreSatirId ? await tx.bankaEkstreSatir.findUnique({ where: { id: girdi.ekstreSatirId } }) : null;
      if (girdi.ekstreSatirId && (!ekstreSatir || ekstreSatir.durum !== "beklemede" || ekstreSatir.hareketId)) throw new BadRequestException("Onay bekleyen ekstre satırı bulunamadı");
      if (ekstreSatir && (ekstreSatir.bankaHesapId !== bankaId || !ekstreSatir.tutar.isPositive() || !ekstreSatir.tutar.equals(net))) throw new BadRequestException("Ekstre satırı banka hesabı veya net aktarım tutarıyla uyuşmuyor");
      const bakiyeGruplari = await tx.kasaBankaHareket.groupBy({ by: ["tip"], where: { posHesapId: pos.id }, _sum: { tutar: true } });
      let kullanilabilir = D(0);
      for (const grup of bakiyeGruplari) kullanilabilir = grup.tip === "tahsilat" || grup.tip === "virman_gelis" ? kullanilabilir.add(grup._sum.tutar ?? 0) : kullanilabilir.sub(grup._sum.tutar ?? 0);
      if (brut.greaterThan(kullanilabilir)) throw new BadRequestException(`Aktarım tutarı POS bakiyesini aşıyor (kullanılabilir: ${kullanilabilir.toFixed(2)} ${pos.dovizCinsi})`);
      const ortak = { tenantId, dovizCinsi: pos.dovizCinsi, kur: D(1), tarih: new Date(girdi.tarih), kaynakTur: "pos_mutabakat", aciklama: girdi.aciklama ?? `${pos.ad} sağlayıcı ödemesi` };
      const gidis = await tx.kasaBankaHareket.create({ data: { ...ortak, posHesapId: pos.id, tip: "virman_gidis", tutar: net, tutarTry: net } });
      const gelis = await tx.kasaBankaHareket.create({ data: { ...ortak, bankaHesapId: bankaId, tip: "virman_gelis", tutar: net, tutarTry: net, karsiHareketId: gidis.id } });
      await tx.kasaBankaHareket.update({ where: { id: gidis.id }, data: { karsiHareketId: gelis.id } });
      const komisyonHareketi = komisyon.isPositive() ? await tx.kasaBankaHareket.create({ data: { ...ortak, posHesapId: pos.id, tip: "tediye", tutar: komisyon, tutarTry: komisyon, kaynakRef: gidis.id, aciklama: `${pos.ad} komisyon/kesinti` } }) : null;
      const komisyonMasrafi = komisyonHareketi ? await (async () => {
        const kategori = await tx.masrafKategori.upsert({
          where: { tenantId_ad: { tenantId, ad: "Banka ve POS Komisyonları" } },
          create: { tenantId, ad: "Banka ve POS Komisyonları", varsayilanKdvOrani: D(0) },
          update: { aktif: true },
        });
        return tx.masraf.create({
          data: {
            tenantId,
            kategoriId: kategori.id,
            belgeTuru: "dekont",
            tarih: new Date(girdi.tarih),
            saticiUnvan: pos.ad,
            aciklama: `${pos.ad} komisyon/kesinti`,
            matrah: komisyon,
            kdvOrani: D(0),
            kdvTutari: D(0),
            toplam: komisyon,
            dovizCinsi: pos.dovizCinsi,
            durum: "onaylandi",
            odemeDurumu: "odendi",
            odenenTutar: komisyon,
            odemeTarihi: new Date(girdi.tarih),
            hareketId: komisyonHareketi.id,
          },
        });
      })() : null;
      if (ekstreSatir) await tx.bankaEkstreSatir.update({ where: { id: ekstreSatir.id }, data: { durum: "eslesti", hareketId: gelis.id } });
      return { gidis, gelis, komisyonHareketi, komisyonMasrafi, brutTutar: brut.toFixed(2), netTutar: net.toFixed(2), komisyonTutar: komisyon.toFixed(2) };
    });
  }

  // ─── ÇEK VE SENET TAKİBİ (KSB-05) ─────────────────────────────────────────

  async cekSenetListele(tur?: "cek" | "senet", durum?: string, yon?: string, arama?: string, baslangic?: string, bitis?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cekSenet.findMany({
        where: {
          tur: tur || undefined,
          durum: durum ? (durum as CekSenetDurum) : undefined,
          yon: yon ? (yon as CekSenetYon) : undefined,
          vadeTarihi: { ...(baslangic ? { gte: new Date(baslangic) } : {}), ...(bitis ? { lte: new Date(bitis) } : {}) },
          ...(arama ? { OR: [
            { portfoyNo: { contains: arama, mode: "insensitive" } },
            { cekNo: { contains: arama, mode: "insensitive" } },
            { borclu: { contains: arama, mode: "insensitive" } },
            { banka: { contains: arama, mode: "insensitive" } },
            { cari: { unvan: { contains: arama, mode: "insensitive" } } },
          ] } : {}),
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
          olaylar: { orderBy: [{ createdAt: "desc" }], take: 100 },
        },
      }),
    );
    if (!CS) throw new NotFoundException("Çek/Senet bulunamadı");
    return CS;
  }

  async cekSenetOzet(yon?: string) {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.cekSenet.findMany({
      where: { yon: yon ? (yon as CekSenetYon) : undefined },
      select: { durum: true, vadeTarihi: true, tutarTry: true, dovizCinsi: true, tutar: true },
    }));
    const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
    const otuzGun = new Date(bugun); otuzGun.setDate(otuzGun.getDate() + 30);
    const acikDurumlar = yon === "verilen" ? ["verildi"] : ["portfoyde", "tahsile_verildi", "teminata_verildi"];
    const acik = kayitlar.filter((k) => acikDurumlar.includes(k.durum));
    const toplam = (liste: typeof kayitlar) => liste.reduce((t, k) => t.add(k.tutarTry), D(0)).toFixed(2);
    const dovizler = Object.fromEntries(["TRY", "USD", "EUR"].map((d) => [d, acik.filter((k) => k.dovizCinsi === d).reduce((t, k) => t.add(k.tutar), D(0)).toFixed(2)]));
    return {
      acik: { adet: acik.length, toplamTry: toplam(acik), dovizler },
      geciken: { adet: acik.filter((k) => k.vadeTarihi < bugun).length, toplamTry: toplam(acik.filter((k) => k.vadeTarihi < bugun)) },
      yaklasan: { adet: acik.filter((k) => k.vadeTarihi >= bugun && k.vadeTarihi <= otuzGun).length, toplamTry: toplam(acik.filter((k) => k.vadeTarihi >= bugun && k.vadeTarihi <= otuzGun)) },
      bankada: { adet: kayitlar.filter((k) => ["tahsile_verildi", "teminata_verildi"].includes(k.durum)).length, toplamTry: toplam(kayitlar.filter((k) => ["tahsile_verildi", "teminata_verildi"].includes(k.durum))) },
      ciro: { adet: kayitlar.filter((k) => k.durum === "ciro_edildi").length, toplamTry: toplam(kayitlar.filter((k) => k.durum === "ciro_edildi")) },
      karsiliksiz: { adet: kayitlar.filter((k) => k.durum === "karsiliksiz").length, toplamTry: toplam(kayitlar.filter((k) => k.durum === "karsiliksiz")) },
    };
  }

  async cekSenetOlustur(girdi: z.infer<typeof cekSenetOlusturSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    const tutar = D(girdi.tutar);
    const kur = D(girdi.kur);
    const tutarTry = tutar.mul(kur).toDecimalPlaces(2);

    const ayniPortfoy = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cekSenet.findFirst({ where: { portfoyNo: girdi.portfoyNo }, select: { id: true } }),
    );
    if (ayniPortfoy) throw new BadRequestException(`“${girdi.portfoyNo}” portföy numarası zaten kullanılıyor`);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const CS = await tx.cekSenet.create({
        data: {
          tenantId,
          tur: girdi.tur,
          portfoyNo: girdi.portfoyNo,
          cekNo: girdi.cekNo,
          islemTarihi: new Date(girdi.islemTarihi),
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
          yon: girdi.yon,
          durum: girdi.yon === "verilen" ? "verildi" : "portfoyde",
          cariId: girdi.cariId,
          aciklama: girdi.aciklama,
          fizikselKonum: girdi.fizikselKonum ?? (girdi.yon === "alinan" ? "Şirket portföyü" : "Lehtara teslim"),
        },
      });

      await tx.cekSenetOlay.create({ data: { tenantId, cekSenetId: CS.id, yeniDurum: CS.durum, islemTarihi: new Date(girdi.islemTarihi), aciklama: "Çek/senet kaydı oluşturuldu", userId } });

      // Alınan çek/senet: müşteri alacaklanır (bize olan borcu azalır).
      // Verilen çek/senet: lehtar borçlanır (bizim ona olan borcumuz azalır).
      if (girdi.cariId) {
        const verilen = girdi.yon === "verilen";
        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: girdi.cariId,
            tip: verilen ? "borc" : "alacak",
            tutar,
            dovizCinsi: girdi.dovizCinsi,
            kur,
            tutarTry,
            tarih: new Date(girdi.islemTarihi),
            aciklama: `${girdi.tur.toUpperCase()} ${verilen ? "verildi" : "alımı"} (Portföy No: ${girdi.portfoyNo})`,
            kaynakTur: "cek_senet",
            kaynakRef: CS.id,
          },
        });
      }

      return CS;
    });
  }

  async cekSenetGuncelle(id: string, girdi: z.infer<typeof cekSenetGuncelleSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    const CS = await this.cekSenetGetir(id);
    this.cekSenetDurumunuDenetle(CS.yon, girdi.durum);

    const gecisler: Record<string, string[]> = CS.yon === "alinan" ? {
      portfoyde: ["tahsile_verildi", "teminata_verildi", "ciro_edildi", "tahsil_edildi", "karsiliksiz", "iade_edildi"],
      tahsile_verildi: ["portfoyde", "tahsil_edildi", "karsiliksiz", "iade_edildi"],
      teminata_verildi: ["portfoyde", "tahsil_edildi", "karsiliksiz", "iade_edildi"],
    } : { verildi: ["odendi", "karsiliksiz", "iade_edildi"] };
    if (!(gecisler[CS.durum] ?? []).includes(girdi.durum)) throw new BadRequestException(`${CS.durum} durumundan ${girdi.durum} durumuna geçilemez`);

    const fisYazilacak = girdi.durum === "tahsil_edildi" || girdi.durum === "odendi";
    if (fisYazilacak) await this.islemHesabiniDenetle(girdi, CS.dovizCinsi);
    const islemTarihi = girdi.islemTarihi ? new Date(girdi.islemTarihi) : new Date();
    const varsayilanKonum: Record<string, string> = { portfoyde: "Şirket portföyü", tahsile_verildi: "Bankada tahsilde", teminata_verildi: "Bankada teminatta", ciro_edildi: "Ciro edilen caride", tahsil_edildi: "Tahsil edildi", odendi: "Ödendi", karsiliksiz: "Karşılıksız işlem dosyası", iade_edildi: "İade edildi" };

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hak = await tx.cekSenet.updateMany({ where: { id, durum: CS.durum }, data: { durum: girdi.durum } });
      if (hak.count !== 1) throw new BadRequestException("Çek/senet başka bir işlemle güncellendi; ekranı yenileyin");
      const guncel = await tx.cekSenet.update({
        where: { id },
        data: {
          ciroCariId: girdi.ciroCariId,
          aciklama: girdi.aciklama ?? CS.aciklama,
          fizikselKonum: girdi.fizikselKonum ?? varsayilanKonum[girdi.durum],
        },
      });

      if (fisYazilacak) {
        const odeme = girdi.durum === "odendi";
        await tx.kasaBankaHareket.create({
          data: {
            tenantId,
            kasaId: girdi.hesapKasaId ?? null,
            bankaHesapId: girdi.hesapBankaHesapId ?? null,
            tip: odeme ? "tediye" : "tahsilat",
            tutar: CS.tutar,
            dovizCinsi: CS.dovizCinsi,
            kur: CS.kur,
            tutarTry: D(CS.tutar).mul(D(CS.kur)).toDecimalPlaces(2),
            tarih: islemTarihi,
            aciklama: odeme
              ? `${CS.tur.toUpperCase()} ödemesi (Portföy No: ${CS.portfoyNo}, Lehtar: ${CS.cari?.unvan ?? "—"})`
              : `${CS.tur.toUpperCase()} tahsili (Portföy No: ${CS.portfoyNo}, Borçlu: ${CS.borclu})`,
            kaynakTur: "cek_senet",
            kaynakRef: CS.id,
          },
        });
      }

      if (girdi.durum === "ciro_edildi" && girdi.ciroCariId) {
        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: girdi.ciroCariId,
            tip: "borc",
            tutar: CS.tutar,
            dovizCinsi: CS.dovizCinsi,
            kur: CS.kur,
            tutarTry: D(CS.tutar).mul(D(CS.kur)).toDecimalPlaces(2),
            tarih: islemTarihi,
            aciklama: `${CS.tur.toUpperCase()} Ciro Edildi (Portföy No: ${CS.portfoyNo})`,
            kaynakTur: "cek_senet_ciro",
            kaynakRef: CS.id,
          },
        });
      }

      if (["karsiliksiz", "iade_edildi"].includes(girdi.durum) && CS.cariId) {
        await tx.cariHareket.create({ data: {
          tenantId, cariId: CS.cariId, tip: CS.yon === "alinan" ? "borc" : "alacak",
          tutar: CS.tutar, dovizCinsi: CS.dovizCinsi, kur: CS.kur,
          tutarTry: D(CS.tutar).mul(D(CS.kur)).toDecimalPlaces(2), tarih: islemTarihi,
          aciklama: `${CS.tur.toUpperCase()} ${girdi.durum === "karsiliksiz" ? "karşılıksız" : "iade"} ters kaydı (Portföy No: ${CS.portfoyNo})`,
          kaynakTur: "cek_senet_ters", kaynakRef: CS.id,
        } });
      }

      await tx.cekSenetOlay.create({ data: { tenantId, cekSenetId: CS.id, oncekiDurum: CS.durum, yeniDurum: girdi.durum, islemTarihi, aciklama: girdi.aciklama, userId } });

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

  /** Yönüne göre bir çek/senetin alabileceği durumlar (KSB-05). */
  private static readonly ALINAN_DURUMLARI: CekSenetDurum[] = [
    "portfoyde",
    "tahsile_verildi",
    "teminata_verildi",
    "ciro_edildi",
    "tahsil_edildi",
    "karsiliksiz",
    "iade_edildi",
  ];
  private static readonly VERILEN_DURUMLARI: CekSenetDurum[] = [
    "verildi",
    "odendi",
    "karsiliksiz",
    "iade_edildi",
  ];

  /**
   * Alınan bir çek "ödendi", verilen bir çek "tahsil edildi" olamaz; aksi
   * hâlde para ters yöne akar (alınana tediye, verilene tahsilat fişi).
   */
  private cekSenetDurumunuDenetle(yon: CekSenetYon, durum: CekSenetDurum): void {
    const izinli =
      yon === "verilen"
        ? KasaBankaService.VERILEN_DURUMLARI
        : KasaBankaService.ALINAN_DURUMLARI;
    if (!izinli.includes(durum)) {
      throw new BadRequestException(
        `'${durum}' durumu ${yon === "verilen" ? "verilen" : "alınan"} çek/senet için geçersiz`,
      );
    }
  }

  /**
   * Tahsil/ödeme hesabının var olduğunu ve para biriminin çek/senetle
   * uyuştuğunu doğrular; uyuşmazsa hesabın bakiyesi karışık para birimine
   * düşerdi.
   */
  private async islemHesabiniDenetle(
    girdi: z.infer<typeof cekSenetGuncelleSemasi>,
    cekDovizCinsi: DovizCinsi,
  ): Promise<void> {
    const { tenantId } = aktifBaglam();

    const hesapDovizi = girdi.hesapKasaId
      ? (
          await this.prisma.tenantIslem(tenantId, (tx) =>
            tx.kasa.findUnique({ where: { id: girdi.hesapKasaId! } }),
          )
        )?.dovizCinsi
      : (
          await this.prisma.tenantIslem(tenantId, (tx) =>
            tx.bankaHesap.findUnique({ where: { id: girdi.hesapBankaHesapId! } }),
          )
        )?.dovizCinsi;

    if (!hesapDovizi) {
      throw new BadRequestException("Seçilen kasa/banka hesabı bulunamadı");
    }
    if (hesapDovizi !== cekDovizCinsi) {
      throw new BadRequestException(
        `Çek/senet ${cekDovizCinsi} cinsinden; ${hesapDovizi} hesabıyla işlem yapılamaz`,
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
      kaynakDoviz = k?.aktif ? k.dovizCinsi : undefined;
    } else if (girdi.kaynakBankaHesapId) {
      const b = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.bankaHesap.findUnique({ where: { id: girdi.kaynakBankaHesapId! } }),
      );
      kaynakDoviz = b?.aktif ? b.dovizCinsi : undefined;
    } else {
      const p = await this.prisma.tenantIslem(tenantId, (tx) => tx.posHesap.findUnique({ where: { id: girdi.kaynakPosHesapId! } })); kaynakDoviz = p?.aktif ? p.dovizCinsi : undefined;
    }

    if (girdi.hedefKasaId) {
      const k = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.kasa.findUnique({ where: { id: girdi.hedefKasaId! } }),
      );
      hedefDoviz = k?.aktif ? k.dovizCinsi : undefined;
    } else if (girdi.hedefBankaHesapId) {
      const b = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.bankaHesap.findUnique({ where: { id: girdi.hedefBankaHesapId! } }),
      );
      hedefDoviz = b?.aktif ? b.dovizCinsi : undefined;
    } else {
      const p = await this.prisma.tenantIslem(tenantId, (tx) => tx.posHesap.findUnique({ where: { id: girdi.hedefPosHesapId! } })); hedefDoviz = p?.aktif ? p.dovizCinsi : undefined;
    }

    if (!kaynakDoviz || !hedefDoviz) {
      throw new BadRequestException("Kaynak veya Hedef hesap bulunamadı");
    }

    if (kaynakDoviz !== hedefDoviz) {
      throw new BadRequestException("Farklı döviz cinsleri arasında virman yapılamaz");
    }

    const kaynak = girdi.kaynakKasaId ? `kasa:${girdi.kaynakKasaId}` : girdi.kaynakBankaHesapId ? `banka:${girdi.kaynakBankaHesapId}` : `pos:${girdi.kaynakPosHesapId}`;
    const hedef = girdi.hedefKasaId ? `kasa:${girdi.hedefKasaId}` : girdi.hedefBankaHesapId ? `banka:${girdi.hedefBankaHesapId}` : `pos:${girdi.hedefPosHesapId}`;
    if (kaynak === hedef) throw new BadRequestException("Kaynak ve hedef hesap aynı olamaz");

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
