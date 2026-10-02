import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type DovizCinsi } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { kurZorunlu } from "../doviz/kur-coz";
import { dovizIslemHesapla } from "./doviz-islem-hesap";
import { KasaBankaService } from "./kasa-banka.service";
import type { dovizIslemSemasi } from "./kasa-banka.semalar";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);
const KAMBIYO_GELIR = { ad: "Kambiyo Kârları", muhasebeKodu: "646" };
const KAMBIYO_GIDER = { ad: "Kambiyo Zararları", muhasebeKodu: "656" };
const BANKA_KATEGORISI = { ad: "Banka ve POS Komisyonları", muhasebeKodu: null };

type Girdi = z.infer<typeof dovizIslemSemasi>;
type Hesap = { kasaId: string | null; bankaHesapId: string | null };

/**
 * P1-2a: döviz alım/satımı. Çıkan hesaptan bir dövizde, giren hesaba başka bir
 * dövizde para geçer (ör. USD hesaptan bozdurulup TL hesaba). İki bacak tek
 * işlemde yazılır; döviz bacakları TCMB alış kuruyla değerlenir, fark kambiyo
 * kârı ya da zararı olarak kayda girer. Bankanın kestiği masraf isteğe bağlıdır.
 */
@Injectable()
export class DovizIslemService {
  constructor(private readonly prisma: PrismaService, private readonly donemKilidi: DonemKilidiService, private readonly kasaBanka: KasaBankaService) {}

  async olustur(girdi: Girdi) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "döviz alım/satımı");
    const kaynak = { kasaId: girdi.kaynakKasaId ?? null, bankaHesapId: girdi.kaynakBankaHesapId ?? null };
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const once = await this.kasaBanka.hesapBakiyesi(tx, kaynak);
      const islem = await this.olusturTx(tx, tenantId, girdi);
      await this.kasaBanka.eksiBakiyeDenetle(tx, kaynak, once, girdi.eksiBakiyeOnay);
      return islem;
    });
  }

  private async hesapOku(tx: Prisma.TransactionClient, h: Hesap, rol: string) {
    const kayit = h.kasaId
      ? await tx.kasa.findUnique({ where: { id: h.kasaId }, select: { ad: true, dovizCinsi: true, aktif: true } })
      : await tx.bankaHesap.findUnique({ where: { id: h.bankaHesapId! }, select: { ad: true, dovizCinsi: true, aktif: true } });
    if (!kayit || !kayit.aktif) throw new BadRequestException(`Aktif ${rol} hesap bulunamadı`);
    return kayit;
  }

  /** İşlemi verilen veritabanı işleminin içinde yazar (ekran ve ekstre eşleştirmesi ortak). */
  async olusturTx(tx: Prisma.TransactionClient, tenantId: string, girdi: Girdi) {
    const { userId } = aktifBaglam();
    const kaynak: Hesap = { kasaId: girdi.kaynakKasaId ?? null, bankaHesapId: girdi.kaynakBankaHesapId ?? null };
    const hedef: Hesap = { kasaId: girdi.hedefKasaId ?? null, bankaHesapId: girdi.hedefBankaHesapId ?? null };
    const [k, h] = [await this.hesapOku(tx, kaynak, "çıkan"), await this.hesapOku(tx, hedef, "giren")];
    if (k.dovizCinsi === h.dovizCinsi) throw new BadRequestException("Aynı dövizdeki hesaplar arasında döviz alım/satımı olmaz; virman kullanın");
    const tarih = new Date(girdi.tarih);
    const kurAl = async (doviz: DovizCinsi) => (doviz === "TRY" ? D(1) : kurZorunlu(tx, doviz, tarih, "alis", tenantId));
    const cikanTutar = D(girdi.cikanTutar);
    const girenTutar = D(girdi.girenTutar);
    const [cikanKur, girenKur] = [await kurAl(k.dovizCinsi), await kurAl(h.dovizCinsi)];
    const hesap = dovizIslemHesapla({ cikanTutar, cikanDoviz: k.dovizCinsi, cikanKur, girenTutar, girenDoviz: h.dovizCinsi, girenKur });
    const id = randomUUID();
    const aciklama = (girdi.aciklama?.trim() || `Döviz ${h.dovizCinsi === "TRY" ? "bozdurma" : "alımı"}: ${k.ad} → ${h.ad}`).slice(0, 500);
    const ortak = { tenantId, tarih, kaynakTur: "doviz_islem", kaynakRef: id, aciklama: `${aciklama} · ${hesap.kurAciklamasi}`.slice(0, 500) };

    const gidis = await tx.kasaBankaHareket.create({ data: { ...ortak, ...kaynak, tip: "virman_gidis", tutar: cikanTutar, dovizCinsi: k.dovizCinsi, kur: cikanKur, tutarTry: hesap.cikanTry } });
    const gelis = await tx.kasaBankaHareket.create({ data: { ...ortak, ...hedef, tip: "virman_gelis", tutar: girenTutar, dovizCinsi: h.dovizCinsi, kur: girenKur, tutarTry: hesap.girenTry, karsiHareketId: gidis.id } });
    await tx.kasaBankaHareket.update({ where: { id: gidis.id }, data: { karsiHareketId: gelis.id } });

    const farkAciklamasi = `${aciklama} · ${hesap.kurAciklamasi}; TCMB alış ${[k, h].filter((x) => x.dovizCinsi !== "TRY").map((x) => `${x.dovizCinsi} ${(x === k ? cikanKur : girenKur).toFixed(4)}`).join(", ")}`.slice(0, 500);
    let kambiyoGelirId: string | null = null;
    let kambiyoMasrafId: string | null = null;
    if (hesap.fark.gt(0)) {
      const kategori = await tx.gelirKategori.upsert({ where: { tenantId_ad: { tenantId, ad: KAMBIYO_GELIR.ad } }, create: { tenantId, ...KAMBIYO_GELIR }, update: { aktif: true } });
      kambiyoGelirId = (await tx.gelirKaydi.create({ data: { tenantId, kategoriId: kategori.id, tarih, brutTutar: hesap.fark, netTutar: hesap.fark, netTutarTry: hesap.fark, dovizCinsi: "TRY", kur: D(1), aciklama: farkAciklamasi } })).id;
    } else if (hesap.fark.lt(0)) {
      const zarar = hesap.fark.abs();
      const kategori = await this.masrafKategorisi(tx, tenantId, KAMBIYO_GIDER);
      // Para çıkışı yoktur: masraf ödenmiş sayılır ki ödenecekler ve nakit akışına düşmesin.
      kambiyoMasrafId = (await tx.masraf.create({ data: {
        tenantId, kategoriId: kategori.id, belgeTuru: "dekont", tarih, aciklama: farkAciklamasi, matrah: zarar, kdvOrani: D(0), kdvTutari: D(0), toplam: zarar,
        dovizCinsi: "TRY", kur: D(1), durum: "onaylandi", odemeDurumu: "odendi", odenenTutar: zarar, odemeTarihi: tarih, kaynakTur: "doviz_islem",
      } })).id;
    }

    let bankaMasrafId: string | null = null;
    if (girdi.masrafTutar && D(girdi.masrafTutar).gt(0)) {
      const masrafHesap = girdi.masrafHesabi === "giren" ? { hesap: hedef, kayit: h } : { hesap: kaynak, kayit: k };
      const tutar = D(girdi.masrafTutar);
      const kur = await kurAl(masrafHesap.kayit.dovizCinsi);
      const tutarTry = tutar.mul(kur).toDecimalPlaces(2);
      const odeme = await tx.kasaBankaHareket.create({ data: { ...ortak, ...masrafHesap.hesap, tip: "tediye", tutar, dovizCinsi: masrafHesap.kayit.dovizCinsi, kur, tutarTry, aciklama: `${aciklama} · banka masrafı`.slice(0, 500) } });
      const kategori = await this.masrafKategorisi(tx, tenantId, BANKA_KATEGORISI);
      bankaMasrafId = (await tx.masraf.create({ data: {
        tenantId, kategoriId: kategori.id, belgeTuru: "dekont", tarih, aciklama: `${aciklama} · banka masrafı`.slice(0, 500), matrah: tutar, kdvOrani: D(0), kdvTutari: D(0), toplam: tutar,
        dovizCinsi: masrafHesap.kayit.dovizCinsi, kur, durum: "onaylandi", odemeDurumu: "odendi", odenenTutar: tutar, odemeTarihi: tarih, hareketId: odeme.id, kaynakTur: "doviz_islem",
      } })).id;
    }

    return tx.dovizIslemi.create({ data: {
      id, tenantId, tarih,
      cikanTutar, cikanDoviz: k.dovizCinsi, cikanKur, cikanTry: hesap.cikanTry,
      girenTutar, girenDoviz: h.dovizCinsi, girenKur, girenTry: hesap.girenTry, farkTry: hesap.fark,
      gidisHareketId: gidis.id, gelisHareketId: gelis.id, kambiyoGelirId, kambiyoMasrafId, bankaMasrafId,
      aciklama, userId,
    } });
  }

  private async masrafKategorisi(tx: Prisma.TransactionClient, tenantId: string, k: { ad: string; muhasebeKodu: string | null }) {
    return (await tx.masrafKategori.findFirst({ where: { ad: k.ad } }))
      ?? tx.masrafKategori.create({ data: { tenantId, ad: k.ad, muhasebeKodu: k.muhasebeKodu, varsayilanKdvOrani: D(0) } });
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const islem = await this.prisma.tenantIslem(tenantId, (tx) => tx.dovizIslemi.findUnique({ where: { id } }));
    if (!islem) throw new NotFoundException("Döviz alım/satımı bulunamadı");
    return islem;
  }

  async geriAl(id: string, neden: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => this.geriAlTx(tx, tenantId, id, neden));
  }

  /**
   * İki bacağı, kambiyo kaydını ve banka masrafını birlikte siler. Kapalı
   * dönemde geri alınmaz. Bacaklardan biri ekstre satırına bağlıysa önce o
   * eşleşme geri alınır; `ekstreSatirId` verilirse o satırın bağı engel sayılmaz.
   */
  async geriAlTx(tx: Prisma.TransactionClient, tenantId: string, id: string, neden: string, ekstreSatirId?: string) {
    const { userId } = aktifBaglam();
    await tx.$queryRaw`SELECT id FROM doviz_islemleri WHERE id = ${id}::uuid FOR UPDATE`;
    const islem = await tx.dovizIslemi.findUnique({ where: { id } });
    if (!islem) throw new NotFoundException("Döviz alım/satımı bulunamadı");
    await this.donemKilidi.tarihDogrula(tenantId, islem.tarih, "döviz alım/satımını geri alma");
    const hareketler = await tx.kasaBankaHareket.findMany({ where: { kaynakTur: "doviz_islem", kaynakRef: id }, include: { ekstreSatir: { select: { id: true, tarih: true, aciklama: true } } } });
    const bagli = hareketler.find((h) => h.ekstreSatir && h.ekstreSatir.id !== ekstreSatirId);
    if (bagli?.ekstreSatir) throw new BadRequestException(`Bu işlemin bir bacağı ${bagli.ekstreSatir.tarih.toISOString().slice(0, 10)} tarihli "${bagli.ekstreSatir.aciklama}" ekstre satırına bağlı; önce Banka Ekstresi ekranından o eşleşmeyi geri alın`);
    await tx.dovizIslemi.delete({ where: { id } });
    const masrafIdler = [islem.kambiyoMasrafId, islem.bankaMasrafId].filter((x): x is string => Boolean(x));
    await tx.masrafOdeme.deleteMany({ where: { tenantId, masrafId: { in: masrafIdler } } });
    await tx.masraf.deleteMany({ where: { id: { in: masrafIdler } } });
    if (islem.kambiyoGelirId) await tx.gelirKaydi.deleteMany({ where: { id: islem.kambiyoGelirId } });
    await tx.kasaBankaHareket.updateMany({ where: { id: { in: hareketler.map((h) => h.id) } }, data: { karsiHareketId: null } });
    await tx.kasaBankaHareket.deleteMany({ where: { id: { in: hareketler.map((h) => h.id) } } });
    await tx.auditLog.create({ data: { tenantId, userId, islem: "doviz_islemi_geri_alindi", varlik: "kasa-banka", varlikId: id, detay: JSON.parse(JSON.stringify({ neden, islem, hareketler })) } });
    return { geriAlindi: true };
  }
}
