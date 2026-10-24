import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { bugunTR, metinNormalize } from "@tekirextra/shared";
import { PrismaService } from "../core/prisma.service";
import { CalismaTakvimiService } from "../calisma-takvimi/calisma-takvimi.service";
import { StokService } from "../stok/stok.service";
import { ekGiderTutari, maliyetDagit, operasyonKirilimi, planlananOperasyonMaliyeti } from "./uretim-maliyet";
import { kapasiteGunu, operasyonlariPlanla } from "./uretim-takvim";
import { duzMiktar, emirMalzemeMiktari, receteBirimKatsayisi } from "./recete-miktar";
import type { isMerkeziKaydetSemasi, kaliteKararSemasi, operasyonBaslatSemasi, operasyonBekletSemasi, operasyonTamamlaSemasi, receteKaydetSemasi, sarfDuzeltmeSemasi, uretimBildirimiSemasi, uretimDonemKilidiSemasi, uretimEmriListeSemasi, uretimEmriKapatSemasi, uretimEmriOlusturSemasi, vardiyaKaydetSemasi, yenidenIslemeTamamlaSemasi } from "./uretim.semalar";
import { satirVaryantlariniDogrula } from "../stok/varyant-secimi";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
/** Saatlik maliyet kırılımın toplamıdır; operasyon hesabı toplamı kullanır. */
const isMerkeziMaliyetleri = (g: z.infer<typeof isMerkeziKaydetSemasi>) => ({ ...g, verimlilikYuzdesi: D(g.verimlilikYuzdesi), iscilikSaatlik: D(g.iscilikSaatlik), makineSaatlik: D(g.makineSaatlik), genelGiderSaatlik: D(g.genelGiderSaatlik), saatlikMaliyet: D(g.iscilikSaatlik).add(g.makineSaatlik).add(g.genelGiderSaatlik) });
/** Reçete satırı ekrana: küçük miktarlar üstel yazılmaz; `birim` boşsa ana birim. */
const receteKalemGorunumu = <T extends { miktar: Prisma.Decimal; girilenMiktar: Prisma.Decimal | null; fireOrani: Prisma.Decimal }>(k: T) => ({ ...k, miktar: duzMiktar(k.miktar), girilenMiktar: duzMiktar(k.girilenMiktar), fireOrani: duzMiktar(k.fireOrani) });

/** Operasyonu yürütebilen roller; küçük işletmede yönetici de tezgâhta çalışır. */
const OPERATOR_ROLLERI: ("uretim_operatoru" | "yonetici")[] = ["uretim_operatoru", "yonetici"];

/** Üretimin sürdüğü emir durumları: bildirim ve operasyon bu durumlarda girilir. */
const URETIM_SUREN_DURUMLAR: string[] = ["uretimde", "kismen_tamamlandi", "kalite_bekliyor"];

/** Kalite kararı verilmemiş kontroller; yeniden işlemedeki mamul de karantinadadır. */
const ACIK_KALITE_DURUMLARI: ("bekliyor" | "yeniden_isleme")[] = ["bekliyor", "yeniden_isleme"];

/** Kalite bekleyen mamulün deposu; kabul edilmemiş stok ayrılmaz ve sarf edilmez. */
const KARANTINA_DEPO_KODU = "KARANTINA";
const sarfaUygunDepo = { aktif: true, kod: { not: KARANTINA_DEPO_KODU } };

/** Tarihin Türkiye'deki günü (YYYY-MM-DD). */
const tarihTR = (tarih: Date) => new Date(tarih.getTime() + 3 * 3600000).toISOString().slice(0, 10);
/** YYYY-MM-DD gününün Türkiye'de başladığı ve bittiği an; sunucu saat diliminden bağımsız. */
const trGunBasi = (gun: string) => new Date(`${gun}T00:00:00+03:00`);
const trGunSonu = (gun: string) => new Date(`${gun}T23:59:59.999+03:00`);

/**
 * Satış sipariş satırını karşılayan miktar: açık emirde planlanan, kapanmış
 * (tamamlandı) emirde üretilen. Eksik kapatılan emrin üretilmeyen kısmı
 * siparişin kalanına döner ve yeni emirle üretilebilir.
 */
export function siparisKarsiligi(emirler: { durum: string; planlananMiktar: Prisma.Decimal; uretilenMiktar: Prisma.Decimal }[]): Prisma.Decimal {
  return emirler.reduce((toplam, emir) => toplam.add(emir.durum === "tamamlandi" ? emir.uretilenMiktar : emir.planlananMiktar), D(0));
}

/** Planlanan bitişi (yoksa emir günü) bugünden önce kalan emir gecikmiştir. */
function gecikmeKosulu(): Prisma.UretimEmriWhereInput {
  const bugun = new Date(bugunTR());
  return { OR: [{ planlananBitis: { lt: bugun } }, { planlananBitis: null, tarih: { lt: bugun } }] };
}


@Injectable()
export class UretimService {
  constructor(private readonly prisma: PrismaService, private readonly stokService: StokService, private readonly takvim?: CalismaTakvimiService) {}

  async ozet() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [durumlar, toplamlar, geciken] = await Promise.all([
        tx.uretimEmri.groupBy({ by: ["durum"], where: { tenantId, durum: { not: "iptal" } }, _count: { _all: true } }),
        tx.uretimEmri.aggregate({ where: { tenantId, durum: { not: "iptal" } }, _sum: { uretilenMiktar: true, hurdaMiktari: true, yenidenIslemeMiktari: true } }),
        tx.uretimEmri.count({ where: { tenantId, ...gecikmeKosulu(), durum: { notIn: ["tamamlandi", "iptal"] } } }),
      ]);
      const sayac = new Map(durumlar.map((satir) => [satir.durum, satir._count._all]));
      const uretilen = D(toplamlar._sum.uretilenMiktar ?? 0);
      const hurda = D(toplamlar._sum.hurdaMiktari ?? 0);
      const yenidenIsleme = D(toplamlar._sum.yenidenIslemeMiktari ?? 0);
      const toplamCikti = uretilen.add(hurda);
      const kapaliDurumlar = new Set(["tamamlandi", "iptal"]);
      return {
        acikEmir: durumlar.filter((satir) => !kapaliDurumlar.has(satir.durum)).reduce((toplam, satir) => toplam + satir._count._all, 0),
        uretimde: (sayac.get("uretimde") ?? 0) + (sayac.get("kismen_tamamlandi") ?? 0),
        malzemeBekleyen: sayac.get("malzeme_bekliyor") ?? 0,
        kaliteBekleyen: sayac.get("kalite_bekliyor") ?? 0,
        geciken,
        uretilenMiktar: uretilen.toFixed(3),
        hurdaMiktari: hurda.toFixed(3),
        yenidenIslemeMiktari: yenidenIsleme.toFixed(3),
        hurdaOrani: toplamCikti.isZero() ? "0.00" : hurda.mul(100).div(toplamCikti).toFixed(2),
      };
    });
  }

  async isMerkezleri() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.isMerkezi.findMany({ orderBy: [{ aktif: "desc" }, { kod: "asc" }] }));
  }

  async vardiyalar() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimVardiya.findMany({ where: { aktif: true }, orderBy: { kod: "asc" } }));
  }

  async vardiyaOlustur(girdi: z.infer<typeof vardiyaKaydetSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimVardiya.create({ data: { tenantId, ...girdi } }));
  }

  async operatorler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.user.findMany({ where: { aktif: true, rol: { in: OPERATOR_ROLLERI } }, select: { id: true, adSoyad: true, eposta: true }, orderBy: { adSoyad: "asc" } }));
  }

  async uretimBekleyenSatisSiparisleri() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const satirlar = await tx.belgeSatir.findMany({ where: { belge: { tur: "siparis", yon: "satis", durum: { in: ["onaylandi", "kapandi"] } }, stok: { urunReceteleri: { some: { aktif: true, durum: "aktif" } } } }, include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true } }, varyant: { select: { id: true, kod: true, ad: true } }, belge: { select: { id: true, no: true, tarih: true, cari: { select: { kod: true, unvan: true } } } }, uretimEmirleri: { where: { durum: { not: "iptal" } }, select: { durum: true, planlananMiktar: true, uretilenMiktar: true } } }, orderBy: { belge: { tarih: "asc" } } });
      return satirlar.map((satir) => { const planlanan = siparisKarsiligi(satir.uretimEmirleri); const kalan = Prisma.Decimal.max(D(0), satir.miktar.sub(planlanan)); return { id: satir.id, siparis: satir.belge, stok: satir.stok, varyant: satir.varyant, siparisMiktari: satir.miktar.toFixed(3), planlananMiktar: planlanan.toFixed(3), kalanMiktar: kalan.toFixed(3) }; }).filter((satir) => D(satir.kalanMiktar).gt(0));
    });
  }

  async terminalBarkod(barkod: string) {
    const { tenantId } = aktifBaglam();
    const temiz = barkod.trim();
    if (!temiz) throw new BadRequestException("Barkod boş olamaz");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.stokBarkod.findUnique({ where: { tenantId_barkod: { tenantId, barkod: temiz } }, include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true, takipTipi: true } } } });
      const stok = kayit?.stok ?? await tx.stokKart.findFirst({ where: { tenantId, barkod: temiz }, select: { id: true, kod: true, ad: true, anaBirim: true, takipTipi: true } });
      if (!stok) throw new NotFoundException(`'${temiz}' barkoduna bağlı üretim ürünü bulunamadı`);
      const emirler = await tx.uretimEmri.findMany({ where: { tenantId, stokId: stok.id, durum: { notIn: ["tamamlandi", "iptal"] } }, orderBy: [{ durum: "asc" }, { tarih: "asc" }], select: { id: true, no: true, durum: true, planlananMiktar: true, uretilenMiktar: true, tarih: true, operasyonlar: { orderBy: { sira: "asc" }, select: { id: true, sira: true, operasyonAdi: true, durum: true, operator: { select: { adSoyad: true } }, vardiya: { select: { kod: true, ad: true } } } } } });
      return { barkod: temiz, stok, emirler: emirler.map((emir) => ({ ...emir, planlananMiktar: emir.planlananMiktar.toFixed(3), uretilenMiktar: emir.uretilenMiktar.toFixed(3) })) };
    });
  }

  async donemKilitleri() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimDonemKilidi.findMany({ include: { kapatan: { select: { adSoyad: true } } }, orderBy: [{ yil: "desc" }, { ay: "desc" }] }));
  }

  async donemKilitle(girdi: z.infer<typeof uretimDonemKilidiSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimDonemKilidi.upsert({ where: { tenantId_yil_ay: { tenantId, yil: girdi.yil, ay: girdi.ay } }, create: { tenantId, kapatanUserId: userId, ...girdi }, update: { kapatanUserId: userId, aciklama: girdi.aciklama, kapatildiAt: new Date() } }));
  }

  /**
   * Kapalı dönemi yeniden açar. Kilit satırı silindiği için genel denetim izi
   * yalnız ucu görür; hangi ayın, kimin kapattığı dönemin, hangi nedenle
   * açıldığı ayrı denetim kaydına aynı işlemde yazılır.
   */
  async donemKilidiAc(id: string, neden: string) {
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kilit = await tx.uretimDonemKilidi.findFirst({ where: { id }, include: { kapatan: { select: { adSoyad: true } } } });
      if (!kilit) throw new NotFoundException("Üretim dönem kilidi bulunamadı");
      await tx.auditLog.create({ data: { tenantId, userId, islem: "uretim_donem_kilidi_acildi", varlik: "uretim_donem_kilidi", varlikId: id, detay: { yil: kilit.yil, ay: kilit.ay, neden, kapatan: kilit.kapatan.adSoyad, kapatanUserId: kilit.kapatanUserId, kapatildiAt: kilit.kapatildiAt.toISOString(), kapatmaAciklamasi: kilit.aciklama } } });
      const sonuc = await tx.uretimDonemKilidi.deleteMany({ where: { id } });
      if (sonuc.count !== 1) throw new NotFoundException("Üretim dönem kilidi bulunamadı");
    });
  }

  async isMerkeziOlustur(girdi: z.infer<typeof isMerkeziKaydetSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.isMerkezi.create({ data: { tenantId, ...isMerkeziMaliyetleri(girdi) } }));
  }

  async isMerkeziGuncelle(id: string, girdi: z.infer<typeof isMerkeziKaydetSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.isMerkezi.updateMany({ where: { id }, data: isMerkeziMaliyetleri(girdi) });
      if (sonuc.count !== 1) throw new NotFoundException("İş merkezi bulunamadı");
      return tx.isMerkezi.findUniqueOrThrow({ where: { id } });
    });
  }

  async kapasite(baslangic?: string, bitis?: string) {
    const { tenantId } = aktifBaglam();
    const ilkGun = trGunBasi(baslangic && /^\d{4}-\d{2}-\d{2}$/.test(baslangic) ? baslangic : bugunTR());
    const sonGun = bitis && /^\d{4}-\d{2}-\d{2}$/.test(bitis) ? trGunSonu(bitis) : new Date(ilkGun.getTime() + 6 * 86400000 + 86399999);
    if (sonGun < ilkGun || sonGun.getTime() - ilkGun.getTime() > 93 * 86400000) throw new BadRequestException("Kapasite aralığı en fazla 93 gün olabilir");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const merkezler = await tx.isMerkezi.findMany({ where: { aktif: true }, orderBy: { kod: "asc" } });
      const tatiller = await this.takvim?.tatilHaritasi(tx, ilkGun, sonGun);
      const operasyonlar = await tx.uretimEmriOperasyonu.findMany({ where: { durum: { notIn: ["iptal", "tamamlandi"] }, uretimEmri: { durum: { notIn: ["iptal", "tamamlandi"] } }, planlananBaslangic: { lte: sonGun }, planlananBitis: { gte: ilkGun } }, include: { uretimEmri: { select: { id: true, no: true, durum: true, stok: { select: { kod: true, ad: true } } } } }, orderBy: { planlananBaslangic: "asc" } });
      return merkezler.map((merkez) => {
        const etkinKapasite = D(merkez.gunlukKapasiteDakika).mul(merkez.verimlilikYuzdesi).div(100);
        const merkezOperasyonlari = operasyonlar.filter((o) => o.isMerkeziId === merkez.id);
        const yuk = merkezOperasyonlari.reduce((t, o) => t.add(o.planlananDakika), D(0));
        const kapasite = etkinKapasite.mul(kapasiteGunu(ilkGun, sonGun, tatiller));
        return { isMerkezi: merkez, baslangic: ilkGun, bitis: sonGun, kapasiteDakika: kapasite.toFixed(2), planlananDakika: yuk.toFixed(2), dolulukYuzdesi: kapasite.isZero() ? "0.00" : yuk.mul(100).div(kapasite).toFixed(2), asimDakika: Prisma.Decimal.max(D(0), yuk.sub(kapasite)).toFixed(2), operasyonlar: merkezOperasyonlari };
      });
    });
  }

  async maliyet(id: string) {
    const { tenantId } = aktifBaglam();
    const emir = await this.prisma.tenantIslem(tenantId, (tx) => tx.uretimEmri.findUnique({ where: { id, tenantId }, include: { stok: { select: { kod: true, ad: true, anaBirim: true, takipTipi: true } }, kalemler: { include: { malzeme: { select: { kod: true, ad: true } } } }, operasyonlar: { include: { isMerkezi: { select: { kod: true, ad: true } } } }, giderler: { orderBy: { sira: "asc" } }, bildirimler: { include: { sarflar: true } }, sarfDuzeltmeleri: { select: { tip: true, miktar: true, birimMaliyet: true } } } }));
    if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
    return this.maliyetOzeti(emir);
  }

  async maliyetRaporu(baslangic?: string, bitis?: string) {
    const { tenantId } = aktifBaglam();
    const ilkGun = trGunBasi(baslangic && /^\d{4}-\d{2}-\d{2}$/.test(baslangic) ? baslangic : `${bugunTR().slice(0, 7)}-01`);
    const sonGun = bitis && /^\d{4}-\d{2}-\d{2}$/.test(bitis) ? trGunSonu(bitis) : new Date();
    if (sonGun < ilkGun || sonGun.getTime() - ilkGun.getTime() > 366 * 86400000) throw new BadRequestException("Maliyet raporu aralığı en fazla 366 gün olabilir");
    const emirler = await this.prisma.tenantIslem(tenantId, (tx) => tx.uretimEmri.findMany({ where: { tenantId, tarih: { gte: ilkGun, lte: sonGun }, durum: { not: "iptal" } }, orderBy: { tarih: "desc" }, include: { stok: { select: { kod: true, ad: true, anaBirim: true } }, kalemler: { include: { malzeme: { select: { kod: true, ad: true } } } }, operasyonlar: { include: { isMerkezi: { select: { kod: true, ad: true } } } }, giderler: { orderBy: { sira: "asc" } }, bildirimler: { include: { sarflar: true } }, sarfDuzeltmeleri: { select: { tip: true, miktar: true, birimMaliyet: true } } } }));
    const satirlar = emirler.map((emir) => this.maliyetOzeti(emir));
    const toplamlar = satirlar.reduce((t, s) => ({ planlanan: t.planlanan.add(s.toplamlar.planlanan), gerceklesen: t.gerceklesen.add(s.toplamlar.gerceklesen) }), { planlanan: D(0), gerceklesen: D(0) });
    return { baslangic: ilkGun, bitis: sonGun, toplamlar: { planlanan: toplamlar.planlanan.toFixed(4), gerceklesen: toplamlar.gerceklesen.toFixed(4), sapma: toplamlar.gerceklesen.sub(toplamlar.planlanan).toFixed(4), sapmaYuzdesi: toplamlar.planlanan.isZero() ? "0.00" : toplamlar.gerceklesen.sub(toplamlar.planlanan).mul(100).div(toplamlar.planlanan).toFixed(2) }, emirler: satirlar };
  }

  private maliyetOzeti(emir: any) {
    // Plan, üretilen miktara oranlanır: 10'luk emirde 6 üretildiyse 6'nın planı
    // kıyaslanır. Henüz üretim yoksa planın tamamı gösterilir.
    const planOrani = D(emir.uretilenMiktar).gt(0) ? D(emir.uretilenMiktar).div(emir.planlananMiktar) : D(1);
    const planlananMalzeme = emir.kalemler.reduce((t: Prisma.Decimal, k: any) => t.add(D(k.planlananMiktar).mul(k.planlananBirimMaliyet)), D(0)).mul(planOrani);
    const bildirimSarflari = emir.bildirimler.flatMap((b: any) => b.sarflar);
    // Ek sarf ve iade, bildirimden sonra da girilebilir; her biri kendi birim maliyetiyle.
    const duzeltmeler = (emir.sarfDuzeltmeleri ?? []).reduce((t: Prisma.Decimal, d: any) => t.add(D(d.miktar).mul(d.birimMaliyet).mul(d.tip === "iade" ? -1 : 1)), D(0));
    const gerceklesenMalzeme = bildirimSarflari.length || emir.sarfDuzeltmeleri?.length
      ? bildirimSarflari.reduce((t: Prisma.Decimal, s: any) => t.add(D(s.miktar).mul(s.birimMaliyet)), D(0)).add(duzeltmeler)
      : emir.kalemler.reduce((t: Prisma.Decimal, k: any) => t.add(D(k.sarfEdilenMiktar).mul(k.birimMaliyet)), D(0));
    const planlananOperasyon = emir.operasyonlar.reduce((t: Prisma.Decimal, o: any) => t.add(D(o.planlananDakika).mul(o.saatlikMaliyet).div(60)), D(0)).mul(planOrani);
    const gerceklesenOperasyon = emir.operasyonlar.reduce((t: Prisma.Decimal, o: any) => t.add(D(o.gerceklesenDakika).mul(o.saatlikMaliyet).div(60)), D(0));
    // Operasyonun işçilik / makine / genel gider kırılımı (emirdeki saatlik kopya).
    const kirilim = (alan: "planlananDakika" | "gerceklesenDakika") => emir.operasyonlar.reduce((t: { iscilik: Prisma.Decimal; makine: Prisma.Decimal; genelGider: Prisma.Decimal }, o: any) => {
      const k = operasyonKirilimi({ dakika: D(o[alan]), iscilikSaatlik: D(o.iscilikSaatlik ?? 0), makineSaatlik: D(o.makineSaatlik ?? 0), genelGiderSaatlik: D(o.genelGiderSaatlik ?? 0) });
      return { iscilik: t.iscilik.add(k.iscilik), makine: t.makine.add(k.makine), genelGider: t.genelGider.add(k.genelGider) };
    }, { iscilik: D(0), makine: D(0), genelGider: D(0) });
    const planKirilim = kirilim("planlananDakika");
    const gercekKirilim = kirilim("gerceklesenDakika");
    const planlananEkGider = (emir.giderler ?? []).reduce((t: Prisma.Decimal, g: any) => t.add(g.planlananTutar), D(0)).mul(planOrani);
    const gerceklesenEkGider = (emir.giderler ?? []).reduce((t: Prisma.Decimal, g: any) => t.add(g.gerceklesenTutar), D(0));
    const planlanan = planlananMalzeme.add(planlananOperasyon).add(planlananEkGider);
    const gerceklesen = gerceklesenMalzeme.add(gerceklesenOperasyon).add(gerceklesenEkGider);
    const sapma = gerceklesen.sub(planlanan);
    const kalem = (p: Prisma.Decimal, g: Prisma.Decimal) => ({ planlanan: p.toFixed(4), gerceklesen: g.toFixed(4), sapma: g.sub(p).toFixed(4) });
    return {
      emirId: emir.id, no: emir.no, tarih: emir.tarih, durum: emir.durum, stok: emir.stok, planlananMiktar: emir.planlananMiktar, uretilenMiktar: emir.uretilenMiktar, planOrani: planOrani.toFixed(4),
      kalemler: {
        malzeme: kalem(planlananMalzeme, gerceklesenMalzeme),
        operasyon: kalem(planlananOperasyon, gerceklesenOperasyon),
        iscilik: kalem(planKirilim.iscilik.mul(planOrani), gercekKirilim.iscilik),
        makine: kalem(planKirilim.makine.mul(planOrani), gercekKirilim.makine),
        genelGider: kalem(planKirilim.genelGider.mul(planOrani), gercekKirilim.genelGider),
        ekGider: kalem(planlananEkGider, gerceklesenEkGider),
      },
      ekGiderler: (emir.giderler ?? []).map((g: any) => ({ ad: g.ad, yontem: g.yontem, deger: D(g.deger).toFixed(), ...kalem(D(g.planlananTutar).mul(planOrani), D(g.gerceklesenTutar)) })),
      toplamlar: { planlanan: planlanan.toFixed(4), gerceklesen: gerceklesen.toFixed(4), sapma: sapma.toFixed(4), sapmaYuzdesi: planlanan.isZero() ? "0.00" : sapma.mul(100).div(planlanan).toFixed(2) },
    };
  }

  /** Kapsamın (genel ya da tek varyant) güncel reçetesi; varyantId boşsa genel reçete. */
  async receteGetir(stokId: string, varyantId: string | null = null) {
    const { tenantId, userId } = aktifBaglam();
    const recete = await this.prisma.tenantIslem(tenantId, (tx) => tx.urunRecetesi.findFirst({
      where: { stokId, varyantId, durum: { in: ["taslak", "onay_bekliyor", "aktif"] } },
      orderBy: { surum: "desc" },
      include: { ciktilar: { orderBy: { id: "asc" }, include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true } } } }, operasyonlar: { orderBy: { sira: "asc" }, include: { isMerkezi: true } }, giderler: { orderBy: { sira: "asc" } }, kalemler: { orderBy: { id: "asc" }, include: { malzeme: { select: { id: true, kod: true, ad: true, anaBirim: true, mevcutMiktar: true, ortalamaMaliyet: true } }, malzemeVaryant: { select: { id: true, kod: true, ad: true } } } } },
    }));
    // Dört göz: sürümü hazırlayan onay düğmesini görmez.
    return recete && { ...recete, kalemler: recete.kalemler.map(receteKalemGorunumu), onaylayabilir: recete.olusturanUserId !== userId };
  }

  /** Kendi reçetesi (taslak, onay bekleyen ya da aktif) olan varyantlar ve durumları. */
  async ozelReceteliVaryantlar(stokId: string) {
    const { tenantId } = aktifBaglam();
    const receteler = await this.prisma.tenantIslem(tenantId, (tx) => tx.urunRecetesi.findMany({
      where: { stokId, varyantId: { not: null }, durum: { in: ["taslak", "onay_bekliyor", "aktif"] } },
      orderBy: { surum: "desc" },
      select: { varyantId: true, durum: true, surum: true },
    }));
    const gorulen = new Set<string>();
    return receteler.filter((r) => !gorulen.has(r.varyantId!) && gorulen.add(r.varyantId!));
  }

  async receteSurumleri(stokId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.urunRecetesi.findMany({ where: { stokId }, orderBy: { surum: "desc" }, include: { varyant: { select: { id: true, kod: true, ad: true } }, operasyonlar: { orderBy: { sira: "asc" }, include: { isMerkezi: true } }, giderler: { orderBy: { sira: "asc" } }, kalemler: { include: { malzeme: { select: { id: true, kod: true, ad: true, anaBirim: true } } } }, _count: { select: { uretimEmirleri: true } } } })).then((surumler) => surumler.map((r) => ({ ...r, kalemler: r.kalemler.map(receteKalemGorunumu) })));
  }

  async receteKaydet(stokId: string, girdi: z.infer<typeof receteKaydetSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mamul = await tx.stokKart.findUnique({ where: { id: stokId } });
      if (!mamul || mamul.tip === "hizmet") throw new BadRequestException("Reçete yalnız stoklu ürünlere tanımlanabilir");
      // Varyanta özel reçete yalnız bu ürünün aktif varyantına tanımlanır.
      await this.stokService.varyantDogrula(tx, stokId, girdi.varyantId);
      if (girdi.kalemler.some((k) => k.malzemeStokId === stokId)) throw new BadRequestException("Ürün kendi reçetesinde malzeme olamaz");
      const kalemVerileri: Prisma.UrunRecetesiKalemUncheckedCreateWithoutReceteInput[] = [];
      for (const kalem of girdi.kalemler) {
        const malzeme = await tx.stokKart.findUnique({ where: { id: kalem.malzemeStokId } });
        if (!malzeme || malzeme.tip === "hizmet") throw new BadRequestException("Geçersiz reçete malzemesi");
        await this.stokService.varyantDogrula(tx, kalem.malzemeStokId, kalem.malzemeVaryantId);
        // Miktar girilen birimde saklanır; emir, sarf ve maliyet ana birim karşılığını kullanır.
        const birim = kalem.birim && kalem.birim !== malzeme.anaBirim ? kalem.birim : null;
        const anaMiktar = D(kalem.miktar).mul(await receteBirimKatsayisi(tx, malzeme, birim)).toDecimalPlaces(12);
        if (anaMiktar.isZero()) throw new BadRequestException(`${malzeme.kod} miktarı ana birimde (${malzeme.anaBirim}) 12 basamağa sığmayacak kadar küçük`);
        kalemVerileri.push({ tenantId, malzemeStokId: kalem.malzemeStokId, malzemeVaryantId: kalem.malzemeVaryantId, miktar: anaMiktar, birim, girilenMiktar: birim ? D(kalem.miktar) : null, fireOrani: D(kalem.fireOrani) });
      }
      for (const cikti of girdi.ciktilar) {
        if (cikti.stokId === stokId || girdi.ciktilar.filter((x) => x.stokId === cikti.stokId && x.varyantId === cikti.varyantId).length > 1) throw new BadRequestException("Yan/ortak ürünler mamulden farklı ve tekil olmalıdır");
        const kart = await tx.stokKart.findUnique({ where: { id: cikti.stokId } });
        if (!kart || kart.tip === "hizmet") throw new BadRequestException("Geçersiz yan/ortak ürün stok kartı");
        await this.stokService.varyantDogrula(tx, cikti.stokId, cikti.varyantId);
      }
      // Varyantlı malzeme/yan ürün varyantsız girilemez: sarf ve giriş o varyantın stoğunda olur.
      await receteVaryantlariniDogrula(tx, "Malzeme listesi", girdi.kalemler.map((k) => ({ stokId: k.malzemeStokId, varyantId: k.malzemeVaryantId })));
      await receteVaryantlariniDogrula(tx, "Yan/ortak ürünler", girdi.ciktilar);
      await this.donguDenetle(tx, stokId, girdi.kalemler.map((k) => k.malzemeStokId));
      if (girdi.yanUrunMaliyetYontemi === "satis_degeri" && girdi.ciktilar.length) {
        const kartlar = await tx.stokKart.findMany({ where: { id: { in: [stokId, ...girdi.ciktilar.map((c) => c.stokId)] } }, select: { kod: true, satisFiyati: true, satisFiyatiDoviz: true } });
        const eksik = kartlar.filter((k) => !k.satisFiyati || D(k.satisFiyati).lte(0) || k.satisFiyatiDoviz !== "TRY");
        if (eksik.length) throw new BadRequestException(`Satış değerine göre pay için ana ürün ve yan ürünlerin TL satış fiyatı tanımlı olmalı: ${eksik.map((k) => k.kod).join(", ")}`);
      }
      const merkezIds = [...new Set(girdi.operasyonlar.map((o) => o.isMerkeziId))];
      if (merkezIds.length) {
        const merkezSayisi = await tx.isMerkezi.count({ where: { id: { in: merkezIds }, aktif: true } });
        if (merkezSayisi !== merkezIds.length) throw new BadRequestException("Operasyon rotasında geçersiz veya pasif iş merkezi var");
      }
      const son = await tx.urunRecetesi.findFirst({ where: { stokId }, orderBy: { surum: "desc" }, select: { surum: true } });
      return tx.urunRecetesi.create({
        data: { tenantId, stokId, varyantId: girdi.varyantId ?? null, surum: (son?.surum ?? 0) + 1, durum: "taslak", aktif: false, ciktiMiktari: D(girdi.ciktiMiktari), aciklama: girdi.aciklama, degisiklikNedeni: girdi.degisiklikNedeni, yururlukBaslangic: girdi.yururlukBaslangic ? new Date(girdi.yururlukBaslangic) : null, kaliteKontrolGerekli: girdi.kaliteKontrolGerekli, olusturanUserId: userId, yanUrunMaliyetYontemi: girdi.yanUrunMaliyetYontemi, kalemler: { create: kalemVerileri }, ciktilar: { create: girdi.ciktilar.map((c) => ({ tenantId, stokId: c.stokId, varyantId: c.varyantId, tip: c.tip, miktar: D(c.miktar), birimMaliyet: girdi.yanUrunMaliyetYontemi === "sabit_deger" && c.birimMaliyet != null ? D(c.birimMaliyet) : null })) }, operasyonlar: { create: girdi.operasyonlar.map((o, index) => ({ tenantId, isMerkeziId: o.isMerkeziId, sira: index + 1, operasyonKodu: o.operasyonKodu, operasyonAdi: o.operasyonAdi, hazirlikDakika: D(o.hazirlikDakika), cevrimDakika: D(o.cevrimDakika) })) }, giderler: { create: girdi.giderler.map((g, index) => ({ tenantId, sira: index + 1, ad: g.ad, yontem: g.yontem, deger: D(g.deger) })) } },
        include: { kalemler: true, giderler: true },
      });
    });
  }

  async receteSil(stokId: string, varyantId: string | null = null) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.urunRecetesi.updateMany({ where: { stokId, varyantId, durum: { in: ["taslak", "onay_bekliyor", "aktif"] } }, data: { durum: "arsiv", aktif: false, yururlukBitis: new Date() } }));
  }

  async receteOnayla(stokId: string, surumId: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const surum = await tx.urunRecetesi.findFirst({ where: { id: surumId, stokId } });
      if (!surum) throw new NotFoundException("Reçete sürümü bulunamadı");
      if (!["taslak", "onay_bekliyor"].includes(surum.durum)) throw new BadRequestException("Yalnız taslak veya onay bekleyen reçete etkinleştirilebilir");
      // Dört göz: sürümü hazırlayan onaylayamaz, rolü ne olursa olsun.
      if (surum.olusturanUserId && surum.olusturanUserId === userId) throw new BadRequestException("Reçeteyi hazırlayan onaylayamaz; başka bir yetkili onaylamalı");
      const simdi = new Date();
      const bugun = new Date(bugunTR());
      const baslangic = surum.yururlukBaslangic ?? bugun;
      if (baslangic > bugun) {
        // İleri tarihli sürüm: eskisi yeni sürüm yürürlüğe girene kadar geçerli
        // kalır, yoksa aradaki günlerde emir açılamaz.
        await tx.urunRecetesi.updateMany({ where: { stokId, varyantId: surum.varyantId, durum: "aktif", id: { not: surumId } }, data: { yururlukBitis: new Date(baslangic.getTime() - 86400000) } });
      } else {
        await tx.urunRecetesi.updateMany({ where: { stokId, varyantId: surum.varyantId, durum: "aktif", id: { not: surumId } }, data: { durum: "pasif", aktif: false, yururlukBitis: simdi } });
      }
      return tx.urunRecetesi.update({ where: { id: surumId }, data: { durum: "aktif", aktif: true, onaylayanUserId: userId, onayZamani: simdi, yururlukBaslangic: baslangic, yururlukBitis: null }, include: { kalemler: true } });
    });
  }

  async emirleriListele(sorgu: z.infer<typeof uretimEmriListeSemasi>) {
    const { tenantId } = aktifBaglam();
    const where: Prisma.UretimEmriWhereInput = { tenantId };
    if (sorgu.durum) where.durum = sorgu.durum;
    // ARA-01: stok tarafı aksansız `arama_normal` kolonundan aranır.
    if (sorgu.arama) where.OR = [{ no: { contains: sorgu.arama, mode: "insensitive" } }, { stok: { aramaNormal: { contains: metinNormalize(sorgu.arama) } } }];
    if (sorgu.geciken === "true") where.AND = [gecikmeKosulu(), { durum: { notIn: ["tamamlandi", "iptal"] } }];
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimEmri.findMany({ where, orderBy: [{ tarih: "desc" }, { createdAt: "desc" }], include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true, takipTipi: true } }, varyant: { select: { id: true, kod: true, ad: true } }, hedefDepo: { select: { id: true, kod: true, ad: true } }, satisSiparisSatiri: { select: { belge: { select: { id: true, no: true } } } }, _count: { select: { kalemler: true } } } }));
  }

  async emirGetir(id: string) {
    const { tenantId } = aktifBaglam();
    const emir = await this.prisma.tenantIslem(tenantId, (tx) => tx.uretimEmri.findUnique({ where: { id, tenantId }, include: { stok: true, varyant: { select: { id: true, kod: true, ad: true } }, recete: { select: { surum: true, varyantId: true } }, hedefDepo: true, operasyonlar: { orderBy: { sira: "asc" }, include: { isMerkezi: true, vardiya: true, operator: { select: { id: true, adSoyad: true } }, duruslar: { orderBy: { baslangic: "desc" } } } }, bildirimler: { orderBy: { bildirimTarihi: "desc" }, include: { sarflar: true } }, sarfDuzeltmeleri: { orderBy: { createdAt: "desc" }, include: { depo: { select: { kod: true, ad: true } }, uretimEmriKalem: { include: { malzeme: { select: { kod: true, ad: true, anaBirim: true } } } } } }, kalemler: { include: { malzeme: true, malzemeVaryant: true } } } }));
    if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
    return { ...emir, operasyonlar: emir.operasyonlar.map(({ duruslar, ...operasyon }) => ({ ...operasyon, durus: duruslar })) };
  }

  async malzemeUygunlugu(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const emir = await tx.uretimEmri.findUnique({
        where: { id, tenantId },
        include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true } }, kalemler: { include: { malzeme: { select: { id: true, kod: true, ad: true, anaBirim: true, takipTipi: true } }, malzemeVaryant: { select: { id: true, kod: true, ad: true } }, rezervasyonlar: true } } },
      });
      if (!emir) throw new NotFoundException("Üretim emri bulunamadı");

      const kalemler = await Promise.all(emir.kalemler.map(async (kalem) => {
        const bakiyeSatirlari = kalem.malzemeVaryantId
          ? await tx.stokVaryantDepoBakiye.findMany({ where: { varyantId: kalem.malzemeVaryantId, depo: sarfaUygunDepo }, include: { depo: { select: { id: true, kod: true, ad: true, varsayilan: true } } } })
          : await tx.stokDepoBakiye.findMany({ where: { stokId: kalem.malzemeStokId, depo: sarfaUygunDepo }, include: { depo: { select: { id: true, kod: true, ad: true, varsayilan: true } } } });
        const depolar = bakiyeSatirlari.map((b) => {
          const mevcut = D(b.mevcutMiktar);
          const rezerve = D(b.rezerveMiktar);
          const emirRezervi = kalem.rezervasyonlar.filter((r) => r.depoId === b.depo.id).reduce((toplam, r) => toplam.add(D(r.rezerveMiktar).sub(r.sarfEdilenMiktar).sub(r.cozulenMiktar)), D(0));
          const kullanilabilir = Prisma.Decimal.max(D(0), mevcut.sub(rezerve).add(emirRezervi));
          return { depoId: b.depo.id, depoKod: b.depo.kod, depoAd: b.depo.ad, varsayilan: b.depo.varsayilan, mevcutMiktar: mevcut.toFixed(3), rezerveMiktar: rezerve.toFixed(3), emirRezervi: emirRezervi.toFixed(3), kullanilabilirMiktar: kullanilabilir.toFixed(3) };
        }).sort((a, b) => Number(b.varsayilan) - Number(a.varsayilan) || Number(b.kullanilabilirMiktar) - Number(a.kullanilabilirMiktar));
        const kullanilabilir = depolar.reduce((toplam, depo) => toplam.add(D(depo.kullanilabilirMiktar)), D(0));
        const gereken = D(kalem.planlananMiktar).add(kalem.ekIhtiyacMiktari ?? 0).sub(kalem.sarfEdilenMiktar);
        const eksik = Prisma.Decimal.max(D(0), gereken.sub(kullanilabilir));
        const rezerveEdilen = kalem.rezervasyonlar.reduce((toplam, r) => toplam.add(D(r.rezerveMiktar).sub(r.sarfEdilenMiktar).sub(r.cozulenMiktar)), D(0));
        return {
          kalemId: kalem.id,
          stokId: kalem.malzemeStokId,
          stokKod: kalem.malzeme.kod,
          stokAd: kalem.malzeme.ad,
          takipTipi: kalem.malzeme.takipTipi,
          varyant: kalem.malzemeVaryant,
          birim: kalem.malzeme.anaBirim,
          gerekenMiktar: gereken.toFixed(3),
          rezerveEdilenMiktar: rezerveEdilen.toFixed(3),
          kullanilabilirMiktar: kullanilabilir.toFixed(3),
          eksikMiktar: eksik.toFixed(3),
          yeterli: eksik.isZero(),
          depolar,
        };
      }));
      const eksikKalemSayisi = kalemler.filter((kalem) => !kalem.yeterli).length;
      return { emirId: emir.id, emirNo: emir.no, mamul: emir.stok, planlananMiktar: emir.planlananMiktar.toFixed(3), uretimeHazir: eksikKalemSayisi === 0, eksikKalemSayisi, kalemler };
    });
  }

  async emirOlustur(girdi: z.infer<typeof uretimEmriOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const emirTarihi = new Date(girdi.tarih);
      await this.uretimDonemiAcikOlmali(tx, emirTarihi);
      if (girdi.satisSiparisSatirId) {
        const siparisSatiri = await tx.belgeSatir.findFirst({ where: { id: girdi.satisSiparisSatirId, stokId: girdi.stokId, belge: { tur: "siparis", yon: "satis", durum: { in: ["onaylandi", "kapandi"] } } }, include: { belge: { select: { no: true } }, uretimEmirleri: { where: { durum: { not: "iptal" } }, select: { durum: true, planlananMiktar: true, uretilenMiktar: true } } } });
        if (!siparisSatiri) throw new BadRequestException("Seçilen satış siparişi satırı ürünle eşleşmiyor veya üretime uygun değil");
        // Siparişten açılan emir sipariş satırının varyantını üretir.
        if (girdi.varyantId && girdi.varyantId !== siparisSatiri.varyantId) throw new BadRequestException("Üretilecek varyant sipariş satırındaki varyantla aynı olmalı");
        girdi = { ...girdi, varyantId: siparisSatiri.varyantId };
        const planlanan = siparisKarsiligi(siparisSatiri.uretimEmirleri);
        if (planlanan.add(girdi.planlananMiktar).gt(siparisSatiri.miktar)) throw new BadRequestException(`${siparisSatiri.belge.no ?? "Satış siparişi"} için kalan üretim ihtiyacı aşılamaz`);
      }
      // Varyantlı mamulde hangi renk/beden üretildiği seçilmeli; giriş o varyantın stoğuna olur.
      try {
        await satirVaryantlariniDogrula(tx, [{ stokId: girdi.stokId, varyantId: girdi.varyantId }]);
      } catch (hata) {
        if (hata instanceof BadRequestException) throw new BadRequestException("Bu ürünün varyantları var; üretilecek varyantı seçin (ya da varyant bu ürüne ait değil / pasif)");
        throw hata;
      }
      // Varyantın kendi onaylı reçetesi varsa o, yoksa genel reçete kullanılır.
      const receteBul = (varyantId: string | null) => tx.urunRecetesi.findFirst({ where: { stokId: girdi.stokId, varyantId, durum: "aktif", aktif: true, OR: [{ yururlukBaslangic: null }, { yururlukBaslangic: { lte: emirTarihi } }], AND: [{ OR: [{ yururlukBitis: null }, { yururlukBitis: { gte: emirTarihi } }] }] }, orderBy: { surum: "desc" }, include: { kalemler: { include: { malzeme: { select: { kod: true, anaBirim: true, ortalamaMaliyet: true } } } }, ciktilar: true, giderler: { orderBy: { sira: "asc" } }, operasyonlar: { orderBy: { sira: "asc" }, include: { isMerkezi: { select: { saatlikMaliyet: true, iscilikSaatlik: true, makineSaatlik: true, genelGiderSaatlik: true, gunlukKapasiteDakika: true, verimlilikYuzdesi: true } } } } } });
      const recete = (girdi.varyantId ? await receteBul(girdi.varyantId) : null) ?? await receteBul(null);
      if (!recete?.kalemler.length) throw new BadRequestException(girdi.varyantId ? "Bu varyant için üretim tarihinde geçerli, onaylı reçete yok (ne varyanta özel ne genel)" : "Bu stok kartında üretim tarihinde geçerli, onaylı reçete yok");
      const depo = await tx.depo.findFirst({ where: { id: girdi.hedefDepoId, aktif: true } });
      if (!depo) throw new BadRequestException("Hedef depo bulunamadı");
      const oran = D(girdi.planlananMiktar).div(recete.ciktiMiktari);
      // Stok ana birimde 3 basamak tutulur: ihtiyacı 0'a yuvarlanan malzeme hiç
      // sarf edilmezdi, sessizce geçilmez.
      const malzemeIhtiyaclari = recete.kalemler.map((k) => ({ k, ...emirMalzemeMiktari(k.miktar, oran, k.fireOrani) }));
      const cokKucuk = malzemeIhtiyaclari.filter((m) => m.miktar.isZero() && m.ham.gt(0));
      if (cokKucuk.length) throw new BadRequestException(`Şu malzemelerin bu emirdeki ihtiyacı stokta tutulabilen en küçük miktarın (0,001 ana birim) altında: ${cokKucuk.map((m) => `${m.k.malzeme.kod} ${m.ham.toSignificantDigits(3).toFixed().replace(".", ",")} ${m.k.malzeme.anaBirim}`).join(", ")}. Emir miktarını artırın ya da malzemenin ana birimini küçültün (ör. kg yerine gram).`);
      const yil = Number(girdi.tarih.slice(0, 4));
      const sayac = await tx.uretimSayac.upsert({
        where: { tenantId_yil: { tenantId, yil } },
        create: { tenantId, yil, sonSira: 1 },
        update: { sonSira: { increment: 1 } },
      });
      // Operasyonlar firmanın çalışma takvimine yerleşir: ayardaki başlangıç
      // saatinden günlük etkin kapasite kadar; cumartesi yarım, pazar ve
      // tatiller yok, arife yarım (kapasite hesabıyla aynı).
      const takvimAyari = this.takvim ? { baslangicSaati: await this.takvim.gunBaslangicSaati(tx), tatiller: await this.takvim.tatilHaritasi(tx, emirTarihi, new Date(emirTarihi.getTime() + 730 * 86400000)) } : {};
      const takvim = operasyonlariPlanla(trGunBasi(girdi.tarih), recete.operasyonlar.map((o) => ({ o, dakika: D(o.hazirlikDakika).add(D(o.cevrimDakika).mul(girdi.planlananMiktar)).toDecimalPlaces(2), gunlukKapasiteDakika: o.isMerkezi.gunlukKapasiteDakika, verimlilikYuzdesi: o.isMerkezi.verimlilikYuzdesi })), takvimAyari);
      const operasyonlar = takvim.map(({ o, dakika, baslangic, bitis }) => ({ tenantId, isMerkeziId: o.isMerkeziId, sira: o.sira, operasyonKodu: o.operasyonKodu, operasyonAdi: o.operasyonAdi, planlananDakika: dakika, saatlikMaliyet: o.isMerkezi.saatlikMaliyet, iscilikSaatlik: o.isMerkezi.iscilikSaatlik, makineSaatlik: o.isMerkezi.makineSaatlik, genelGiderSaatlik: o.isMerkezi.genelGiderSaatlik, planlananBaslangic: baslangic, planlananBitis: bitis }));
      const planlananMalzeme = recete.kalemler.reduce((t, k) => t.add(k.miktar.mul(oran).mul(D(1).add(k.fireOrani.div(100))).mul(k.malzeme.ortalamaMaliyet)), D(0));
      const planlananOperasyon = operasyonlar.reduce((t, o) => t.add(D(o.planlananDakika).mul(o.saatlikMaliyet).div(60)), D(0));
      // Ek giderler emre kopyalanır; plan standart malzeme maliyetiyle hesaplanır.
      const planlananMiktar = D(girdi.planlananMiktar);
      const giderler = (recete.giderler ?? []).map((g) => ({ tenantId, sira: g.sira, ad: g.ad, yontem: g.yontem, deger: g.deger, planlananTutar: ekGiderTutari(g, { malzeme: planlananMalzeme, miktar: planlananMiktar, emirMiktari: planlananMiktar }) }));
      const planlananEkGider = giderler.reduce((t, g) => t.add(g.planlananTutar), D(0));
      const planlananMaliyet = planlananMalzeme.add(planlananOperasyon).add(planlananEkGider).toDecimalPlaces(4);
      // Girilmediyse operasyon planının bittiği gün; operasyon yoksa emir günü.
      const sonOperasyon = operasyonlar.at(-1)?.planlananBitis;
      const planlananBitis = girdi.planlananBitis ? new Date(girdi.planlananBitis) : sonOperasyon ? new Date(tarihTR(sonOperasyon)) : emirTarihi;
      return tx.uretimEmri.create({ data: { tenantId, no: `URT-${yil}-${String(sayac.sonSira).padStart(6, "0")}`, stokId: girdi.stokId, varyantId: girdi.varyantId ?? null, receteId: recete.id, hedefDepoId: girdi.hedefDepoId, satisSiparisSatirId: girdi.satisSiparisSatirId, planlananMiktar: D(girdi.planlananMiktar), planlananMaliyet, planlananBitis, kaliteKontrolGerekli: recete.kaliteKontrolGerekli, tarih: emirTarihi, aciklama: girdi.aciklama, kalemler: { create: malzemeIhtiyaclari.map(({ k, miktar }) => ({ tenantId, malzemeStokId: k.malzemeStokId, malzemeVaryantId: k.malzemeVaryantId, planlananMiktar: miktar, planlananBirimMaliyet: k.malzeme.ortalamaMaliyet })) }, ciktilar: { create: (recete.ciktilar ?? []).map((c) => ({ tenantId, receteCiktiId: c.id, stokId: c.stokId, varyantId: c.varyantId, tip: c.tip, planlananMiktar: c.miktar.mul(oran).toDecimalPlaces(3) })) }, operasyonlar: { create: operasyonlar }, giderler: { create: giderler } }, include: { kalemler: true, operasyonlar: true, ciktilar: true, giderler: true, satisSiparisSatiri: { include: { belge: true } } } });
    });
  }

  async planla(id: string) {
    return this.durumGecisi(id, ["taslak"], "planlandi", "Yalnız taslak üretim emri planlanabilir");
  }

  async rezerveEt(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const emir = await tx.uretimEmri.findUnique({ where: { id, tenantId }, include: { kalemler: { include: { malzeme: true, rezervasyonlar: true } } } });
      if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
      // URT-HURDA: hurda/red ek ihtiyacı için üretimdeki emre de ek ayrım yapılır; durumu değişmez.
      const uretimde = URETIM_SUREN_DURUMLAR.includes(emir.durum);
      if (!uretimde && !["planlandi", "malzeme_bekliyor", "hazir"].includes(emir.durum)) throw new BadRequestException("Yalnız planlanmış, malzeme bekleyen ya da üretimdeki emir için rezervasyon yapılabilir");

      let eksikVar = false;
      for (const kalem of emir.kalemler) {
        const aktifRezerv = kalem.rezervasyonlar.reduce((toplam, r) => toplam.add(this.aktifRezervMiktari(r)), D(0));
        let kalan = Prisma.Decimal.max(D(0), D(kalem.planlananMiktar).add(kalem.ekIhtiyacMiktari ?? 0).sub(kalem.sarfEdilenMiktar).sub(aktifRezerv));
        if (kalan.isZero()) continue;

        const bakiyeler = kalem.malzemeVaryantId
          ? await tx.stokVaryantDepoBakiye.findMany({ where: { varyantId: kalem.malzemeVaryantId, depo: sarfaUygunDepo }, include: { depo: true } })
          : await tx.stokDepoBakiye.findMany({ where: { stokId: kalem.malzemeStokId, depo: sarfaUygunDepo }, include: { depo: true } });
        const adaylar = bakiyeler.map((b) => ({ ...b, kullanilabilir: Prisma.Decimal.max(D(0), D(b.mevcutMiktar).sub(b.rezerveMiktar)) })).filter((b) => b.kullanilabilir.gt(0)).sort((a, b) => Number(b.depo.varsayilan) - Number(a.depo.varsayilan) || b.kullanilabilir.comparedTo(a.kullanilabilir));

        for (const aday of adaylar) {
          if (kalan.isZero()) break;
          const miktar = Prisma.Decimal.min(kalan, aday.kullanilabilir);
          const sonuc = kalem.malzemeVaryantId
            ? await tx.stokVaryantDepoBakiye.updateMany({ where: { id: aday.id, rezerveMiktar: aday.rezerveMiktar, mevcutMiktar: { gte: D(aday.rezerveMiktar).add(miktar) } }, data: { rezerveMiktar: { increment: miktar } } })
            : await tx.stokDepoBakiye.updateMany({ where: { id: aday.id, rezerveMiktar: aday.rezerveMiktar, mevcutMiktar: { gte: D(aday.rezerveMiktar).add(miktar) } }, data: { rezerveMiktar: { increment: miktar } } });
          if (sonuc.count !== 1) throw new BadRequestException("Stok rezervasyon sırasında değişti; uygunluğu yenileyip tekrar deneyin");

          await tx.stokKart.update({ where: { id: kalem.malzemeStokId }, data: { rezerveMiktar: { increment: miktar } } });
          if (kalem.malzemeVaryantId) {
            await tx.stokVaryant.update({ where: { id: kalem.malzemeVaryantId }, data: { rezerveMiktar: { increment: miktar } } });
            await tx.stokDepoBakiye.upsert({ where: { tenantId_stokId_depoId: { tenantId, stokId: kalem.malzemeStokId, depoId: aday.depoId } }, create: { tenantId, stokId: kalem.malzemeStokId, depoId: aday.depoId, rezerveMiktar: miktar }, update: { rezerveMiktar: { increment: miktar } } });
          }
          await tx.uretimMalzemeRezervasyon.upsert({
            where: { tenantId_uretimEmriKalemId_depoId: { tenantId, uretimEmriKalemId: kalem.id, depoId: aday.depoId } },
            create: { tenantId, uretimEmriKalemId: kalem.id, depoId: aday.depoId, rezerveMiktar: miktar },
            update: { rezerveMiktar: { increment: miktar } },
          });
          kalan = kalan.sub(miktar);
        }
        if (kalan.gt(0)) eksikVar = true;
      }

      if (!uretimde) await tx.uretimEmri.update({ where: { id, tenantId }, data: { durum: eksikVar ? "malzeme_bekliyor" : "hazir" } });
      return tx.uretimEmri.findUniqueOrThrow({ where: { id, tenantId }, include: { stok: true, hedefDepo: true, kalemler: { include: { malzeme: true, malzemeVaryant: true, rezervasyonlar: { include: { depo: true } } } } } });
    });
  }

  async baslat(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.uretimEmri.updateMany({ where: { id, tenantId, durum: "hazir" }, data: { durum: "uretimde" } });
      if (sonuc.count !== 1) throw new BadRequestException("Üretim yalnız tüm malzemeleri rezerve edilmiş hazır emirlerde başlatılabilir");
      const ilk = await tx.uretimEmriOperasyonu.findFirst({ where: { uretimEmriId: id }, orderBy: { sira: "asc" } });
      if (ilk) await tx.uretimEmriOperasyonu.updateMany({ where: { id: ilk.id, durum: "planlandi" }, data: { durum: "hazir" } });
      return tx.uretimEmri.findUniqueOrThrow({ where: { id, tenantId }, include: { stok: true, hedefDepo: true, operasyonlar: { orderBy: { sira: "asc" }, include: { isMerkezi: true } } } });
    });
  }

  async operasyonBaslat(emirId: string, operasyonId: string, girdi: z.infer<typeof operasyonBaslatSemasi>) {
    const { tenantId, userId, rol } = aktifBaglam();
    // Operatör izi: operatör yalnız kendi adına başlatır; yönetici atama yapabilir.
    if (rol !== "yonetici" && girdi.operatorId !== userId) throw new ForbiddenException("Operasyonu yalnız kendi adınıza başlatabilirsiniz");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const operasyon = await tx.uretimEmriOperasyonu.findFirst({ where: { id: operasyonId, uretimEmriId: emirId }, include: { uretimEmri: true } });
      if (!operasyon) throw new NotFoundException("Üretim operasyonu bulunamadı");
      // Kalite bekleyen parti varken hat çalışmaya devam eder.
      if (!URETIM_SUREN_DURUMLAR.includes(operasyon.uretimEmri.durum)) throw new BadRequestException("Operasyon için üretim emri başlatılmış olmalıdır");
      const tamamlanmayanOnceki = await tx.uretimEmriOperasyonu.count({ where: { uretimEmriId: emirId, sira: { lt: operasyon.sira }, durum: { not: "tamamlandi" } } });
      if (tamamlanmayanOnceki) throw new BadRequestException("Önce önceki operasyonlar tamamlanmalıdır");
      const [vardiya, operator] = await Promise.all([tx.uretimVardiya.findFirst({ where: { id: girdi.vardiyaId, aktif: true } }), tx.user.findFirst({ where: { id: girdi.operatorId, aktif: true, rol: { in: OPERATOR_ROLLERI } } })]);
      if (!vardiya) throw new BadRequestException("Aktif üretim vardiyası bulunamadı");
      if (!operator) throw new BadRequestException("Aktif üretim operatörü bulunamadı");
      const simdi = new Date();
      const acikDurus = await tx.uretimDurus.findFirst({ where: { operasyonId, bitis: null }, orderBy: { baslangic: "desc" } });
      if (acikDurus) await tx.uretimDurus.update({ where: { id: acikDurus.id }, data: { bitis: simdi, sureDakika: D(Math.max(0, (simdi.getTime() - acikDurus.baslangic.getTime()) / 60000)).toDecimalPlaces(2) } });
      const sonuc = await tx.uretimEmriOperasyonu.updateMany({ where: { id: operasyonId, durum: { in: ["hazir", "beklemede"] } }, data: { durum: "devam_ediyor", fiiliBaslangic: simdi, vardiyaId: girdi.vardiyaId, operatorId: girdi.operatorId } });
      if (sonuc.count !== 1) throw new BadRequestException("Yalnız hazır veya bekleyen operasyon başlatılabilir");
      return tx.uretimEmriOperasyonu.findUniqueOrThrow({ where: { id: operasyonId }, include: { isMerkezi: true, vardiya: true, operator: { select: { id: true, adSoyad: true } }, duruslar: true } });
    });
  }

  async operasyonBeklet(emirId: string, operasyonId: string, girdi: z.infer<typeof operasyonBekletSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const operasyon = await tx.uretimEmriOperasyonu.findFirst({ where: { id: operasyonId, uretimEmriId: emirId, durum: "devam_ediyor" } });
      if (!operasyon?.fiiliBaslangic) throw new BadRequestException("Yalnız devam eden operasyon bekletilebilir");
      const gecen = D(Math.max(0, (Date.now() - operasyon.fiiliBaslangic.getTime()) / 60000)).toDecimalPlaces(2);
      await tx.uretimEmriOperasyonu.update({ where: { id: operasyonId }, data: { durum: "beklemede", gerceklesenDakika: { increment: gecen }, fiiliBaslangic: null } });
      await tx.uretimDurus.create({ data: { tenantId, operasyonId, nedenKodu: girdi.nedenKodu, aciklama: girdi.aciklama, planli: girdi.planli, olusturanUserId: userId } });
      return tx.uretimEmriOperasyonu.findUniqueOrThrow({ where: { id: operasyonId }, include: { isMerkezi: true, vardiya: true, operator: { select: { id: true, adSoyad: true } }, duruslar: true } });
    });
  }

  async operasyonTamamla(emirId: string, operasyonId: string, girdi: z.infer<typeof operasyonTamamlaSemasi>) {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const operasyon = await tx.uretimEmriOperasyonu.findFirst({ where: { id: operasyonId, uretimEmriId: emirId, durum: "devam_ediyor" } });
      if (!operasyon?.fiiliBaslangic) throw new BadRequestException("Yalnız devam eden operasyon tamamlanabilir");
      // Süre ve maliyet başlatan operatöre yazılı; başkası tamamlayamaz. Devir için
      // operasyon bekletilir (herkes bekletebilir) ve devralan kendi adına başlatır.
      if (rol !== "yonetici" && operasyon.operatorId && operasyon.operatorId !== userId) throw new ForbiddenException("Operasyonu başlatan operatör tamamlayabilir; devralmak için bekletip kendi adınıza yeniden başlatın");
      const gecen = D(Math.max(0, (Date.now() - operasyon.fiiliBaslangic.getTime()) / 60000));
      const gerceklesen = girdi.gerceklesenDakika === undefined ? D(operasyon.gerceklesenDakika).add(gecen).toDecimalPlaces(2) : D(girdi.gerceklesenDakika);
      const sonuc = await tx.uretimEmriOperasyonu.updateMany({ where: { id: operasyonId, durum: "devam_ediyor" }, data: { durum: "tamamlandi", gerceklesenDakika: gerceklesen, fiiliBitis: new Date() } });
      if (sonuc.count !== 1) throw new BadRequestException("Operasyon durumu başka bir işlem tarafından değiştirildi");
      const operasyonMaliyeti = gerceklesen.mul(operasyon.saatlikMaliyet).div(60).toDecimalPlaces(4);
      await tx.uretimEmri.update({ where: { id: emirId, tenantId }, data: { toplamMaliyet: { increment: operasyonMaliyeti } } });
      const sonraki = await tx.uretimEmriOperasyonu.findFirst({ where: { uretimEmriId: emirId, sira: { gt: operasyon.sira }, durum: "planlandi" }, orderBy: { sira: "asc" } });
      if (sonraki) await tx.uretimEmriOperasyonu.updateMany({ where: { id: sonraki.id, durum: "planlandi" }, data: { durum: "hazir" } });
      return tx.uretimEmriOperasyonu.findUniqueOrThrow({ where: { id: operasyonId }, include: { isMerkezi: true } });
    });
  }

  async bildir(id: string, girdi: z.infer<typeof uretimBildirimiSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.uretimDonemiAcikOlmali(tx, girdi.bildirimTarihi ? new Date(girdi.bildirimTarihi) : new Date());
      const onceki = await tx.uretimBildirimi.findUnique({ where: { tenantId_idempotencyAnahtari: { tenantId, idempotencyAnahtari: girdi.idempotencyAnahtari } }, include: { sarflar: true } });
      if (onceki) {
        if (onceki.uretimEmriId !== id) throw new BadRequestException("Bildirim anahtarı başka bir üretim emrinde kullanılmış");
        return onceki;
      }
      const emir = await tx.uretimEmri.findUnique({ where: { id, tenantId }, include: { stok: true, recete: { select: { yanUrunMaliyetYontemi: true } }, operasyonlar: { select: { planlananDakika: true, saatlikMaliyet: true, durum: true } }, giderler: true, ciktilar: { include: { stok: true, receteCikti: { select: { birimMaliyet: true } } } }, kalemler: { include: { malzeme: true, rezervasyonlar: true } } } });
      if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
      // Önceki partinin kalite kararı beklenmez; her bildirim kendi karantina kaydını açar.
      if (!URETIM_SUREN_DURUMLAR.includes(emir.durum)) throw new BadRequestException("Yalnız üretimde olan emre bildirim girilebilir");
      const uretilen = D(girdi.uretilenMiktar);
      const yeniToplam = D(emir.uretilenMiktar).add(uretilen);
      if (yeniToplam.gt(emir.planlananMiktar)) throw new BadRequestException(`Bildirim kalan üretim miktarını aşıyor (${D(emir.planlananMiktar).sub(emir.uretilenMiktar).toFixed(3)})`);

      const girilenSarflar = new Map((girdi.sarflar ?? []).map((s) => [s.uretimEmriKalemId, D(s.miktar)]));
      if (girilenSarflar.size !== (girdi.sarflar ?? []).length || [...girilenSarflar.keys()].some((kalemId) => !emir.kalemler.some((k) => k.id === kalemId))) throw new BadRequestException("Gerçek sarf satırları bu üretim emrine ait ve benzersiz olmalıdır");
      // STK-24: sarf, mamul ve yan ürün kartları döngüden önce sırayla kilitlenir.
      await this.stokService.kartlariKilitle(tx, [...emir.kalemler.map((k) => k.malzemeStokId), emir.stokId, ...(emir.ciktilar ?? []).map((c) => c.stokId)]);
      let toplamMaliyet = D(0);
      const sarfKayitlari: { uretimEmriKalemId: string; miktar: Prisma.Decimal; birimMaliyet: Prisma.Decimal }[] = [];
      const hurda = D(girdi.hurdaMiktari);
      const bildirimTarihi = new Date(girdi.bildirimTarihi ?? Date.now());
      for (const kalem of emir.kalemler) {
        const pay = (m: Prisma.Decimal) => D(kalem.planlananMiktar).mul(m).div(emir.planlananMiktar).toDecimalPlaces(3);
        // URT-HURDA: hurda da malzeme tüketir. Gerçek sarf girilmediyse iyi
        // üretim ile hurdanın reçete payı düşülür; girildiyse girilen geçerlidir.
        const planPayi = pay(uretilen);
        const miktar = girilenSarflar.get(kalem.id) ?? planPayi.add(pay(hurda));
        if (miktar.lte(0)) continue;
        // Emrin planlanan payı ayrılmış stoktan düşer; aşan kısım (hurda ya da
        // fazla sarf) önce serbest stoktan alınır ki kalan üretimin ayrımı bozulmasın.
        const rezervdenDusulecek = Prisma.Decimal.min(miktar, planPayi);
        const fazla = miktar.sub(rezervdenDusulecek);
        const aktifRezervasyonlar = kalem.rezervasyonlar.map((r) => ({ ...r, aktifMiktar: this.aktifRezervMiktari(r) })).filter((r) => r.aktifMiktar.gt(0));
        if (aktifRezervasyonlar.reduce((t, r) => t.add(r.aktifMiktar), D(0)).lt(rezervdenDusulecek)) throw new BadRequestException(`${kalem.malzeme.ad} için ayrılmış stok gerçek sarfı karşılamıyor`);
        const sarfHareketi = (depoId: string, sarf: Prisma.Decimal, aciklama: string) => this.stokService.hareketEkle(tx, { stokId: kalem.malzemeStokId, varyantId: kalem.malzemeVaryantId, depoId, tip: "cikis", miktar: sarf, girilenBirim: kalem.malzeme.anaBirim, girilenMiktar: sarf, birimMaliyet: D(0), tarih: bildirimTarihi, aciklama, kaynakTur: "uretim_bildirimi_sarf", kaynakRef: girdi.idempotencyAnahtari });
        let kalan = rezervdenDusulecek;
        for (const rezervasyon of aktifRezervasyonlar) {
          if (kalan.isZero()) break;
          const sarf = Prisma.Decimal.min(kalan, rezervasyon.aktifMiktar);
          await this.rezervasyonBakiyesiCoz(tx, kalem, rezervasyon.depoId, sarf, rezervasyon.id, "sarf");
          rezervasyon.aktifMiktar = rezervasyon.aktifMiktar.sub(sarf);
          await sarfHareketi(rezervasyon.depoId, sarf, `${emir.no} üretim bildirimi sarfı`);
          kalan = kalan.sub(sarf);
        }
        if (fazla.gt(0)) {
          await this.fazlaSarfEt(tx, kalem, aktifRezervasyonlar, fazla, (depoId, sarf) => sarfHareketi(depoId, sarf, `${emir.no} ${hurda.gt(0) ? "hurda payı" : "plan üstü"} sarfı`));
        }
        toplamMaliyet = toplamMaliyet.add(miktar.mul(kalem.malzeme.ortalamaMaliyet));
        sarfKayitlari.push({ uretimEmriKalemId: kalem.id, miktar, birimMaliyet: kalem.malzeme.ortalamaMaliyet });
        // Plan dışı tüketim ek ihtiyaçtır: kalan üretim için gereken miktar
        // (plan + ek − sarf) değişmez, depo gerekirse ek rezervasyon yapar.
        await tx.uretimEmriKalem.update({ where: { id: kalem.id, tenantId }, data: { sarfEdilenMiktar: { increment: miktar }, birimMaliyet: kalem.malzeme.ortalamaMaliyet, ...(fazla.gt(0) ? { ekIhtiyacMiktari: { increment: fazla } } : {}) } });
      }
      // Mamul maliyeti = gerçek malzeme + planlanan işçilik/makine payı
      // (standart maliyet; gerçek süre farkı sapma raporunda görünür). Saatlik
      // maliyet ya da operasyon yoksa pay sıfırdır.
      const operasyonMaliyeti = planlananOperasyonMaliyeti(emir.operasyonlar).mul(uretilen).div(emir.planlananMiktar).toDecimalPlaces(4);
      // Reçete ek giderleri: yüzde bu bildirimin gerçek malzemesine, birim başı
      // üretilene, emir başı üretilen orana göre uygulanır.
      const ekGiderler = (emir.giderler ?? []).map((g) => ({ id: g.id, tutar: ekGiderTutari(g, { malzeme: toplamMaliyet, miktar: uretilen, emirMiktari: D(emir.planlananMiktar) }) }));
      const ekGiderMaliyeti = ekGiderler.reduce((t, g) => t.add(g.tutar), D(0));
      for (const g of ekGiderler) if (!g.tutar.isZero()) await tx.uretimEmriGider.update({ where: { id: g.id }, data: { gerceklesenTutar: { increment: g.tutar } } });
      const ciktiMiktarlari = (emir.ciktilar ?? []).map((c) => D(c.planlananMiktar).mul(uretilen).div(emir.planlananMiktar).toDecimalPlaces(3));
      const dagitim = maliyetDagit({
        toplam: toplamMaliyet.add(operasyonMaliyeti).add(ekGiderMaliyeti),
        mamulMiktar: uretilen,
        mamulSatisFiyati: emir.stok.satisFiyatiDoviz === "TRY" ? emir.stok.satisFiyati : null,
        yontem: emir.recete?.yanUrunMaliyetYontemi ?? "sifir",
        ciktilar: (emir.ciktilar ?? []).map((c, i) => ({ miktar: ciktiMiktarlari[i], birimMaliyet: c.receteCikti?.birimMaliyet ?? null, satisFiyati: c.stok.satisFiyatiDoviz === "TRY" ? c.stok.satisFiyati : null })),
      });
      const birimMaliyet = dagitim.mamulBirimMaliyeti;
      // Lot üretim tarihi bildirimin Türkiye günüdür (UTC kesimi gece yarısından sonra bir gün geri yazıyordu).
      const uretimTarihi = girdi.uretimTarihi ?? tarihTR(bildirimTarihi);
      let partiler: NonNullable<Parameters<StokService["hareketEkle"]>[1]["partiler"]> = [];
      if (emir.stok.takipTipi === "lot") partiler = [{ lotNo: girdi.lotNo ?? emir.no, sonKullanmaTarihi: girdi.sonKullanmaTarihi, uretimTarihi, miktar: uretilen }];
      if (emir.stok.takipTipi === "seri") {
        const seriler = [...(girdi.seriNumaralari ?? []), ...(girdi.seriNo ? [girdi.seriNo] : [])];
        if (!uretilen.isInteger() || seriler.length !== uretilen.toNumber()) throw new BadRequestException(`Seri takibinde ${uretilen.toFixed(0)} benzersiz seri numarası gerekli`);
        partiler = seriler.map((seriNo) => ({ lotNo: girdi.lotNo ?? emir.no, seriNo, sonKullanmaTarihi: girdi.sonKullanmaTarihi, uretimTarihi, miktar: D(1) }));
      }
      const karantinaDepo = emir.kaliteKontrolGerekli ? await tx.depo.upsert({ where: { tenantId_kod: { tenantId, kod: KARANTINA_DEPO_KODU } }, create: { tenantId, kod: KARANTINA_DEPO_KODU, ad: "Kalite Karantina Deposu", aktif: true, varsayilan: false }, update: { aktif: true } }) : null;
      const girisDepoId = karantinaDepo?.id ?? emir.hedefDepoId;
      await this.stokService.hareketEkle(tx, { stokId: emir.stokId, varyantId: emir.varyantId, depoId: girisDepoId, tip: "giris", miktar: uretilen, girilenBirim: emir.stok.anaBirim, girilenMiktar: uretilen, birimMaliyet, tarih: bildirimTarihi, aciklama: karantinaDepo ? `${emir.no} kalite karantina girişi` : `${emir.no} üretim bildirimi girişi`, kaynakTur: "uretim_bildirimi_giris", kaynakRef: girdi.idempotencyAnahtari, partiler });
      for (const [i, cikti] of (emir.ciktilar ?? []).entries()) {
        const miktar = ciktiMiktarlari[i];
        if (miktar.lte(0)) continue;
        await this.stokService.hareketEkle(tx, { stokId: cikti.stokId, varyantId: cikti.varyantId, depoId: girisDepoId, tip: "giris", miktar, girilenBirim: cikti.stok.anaBirim, girilenMiktar: miktar, birimMaliyet: dagitim.ciktiBirimMaliyetleri[i], tarih: new Date(girdi.bildirimTarihi ?? Date.now()), aciklama: `${emir.no} ${cikti.tip === "yan_urun" ? "yan ürün" : "ortak ürün"} girişi`, kaynakTur: "uretim_cikti_giris", kaynakRef: girdi.idempotencyAnahtari });
        await tx.uretimEmriCikti.update({ where: { id: cikti.id }, data: { uretilenMiktar: { increment: miktar } } });
      }
      const tamamlandi = yeniToplam.eq(emir.planlananMiktar);
      const bildirim = await tx.uretimBildirimi.create({ data: { tenantId, uretimEmriId: id, idempotencyAnahtari: girdi.idempotencyAnahtari, uretilenMiktar: uretilen, hurdaMiktari: D(girdi.hurdaMiktari), hurdaNedeni: girdi.hurdaNedeni, yenidenIslemeMiktari: D(girdi.yenidenIslemeMiktari), yenidenIslemeNedeni: girdi.yenidenIslemeNedeni, toplamMaliyet, operasyonMaliyeti, ekGiderMaliyeti, mamulBirimMaliyeti: birimMaliyet, bildirimTarihi: new Date(girdi.bildirimTarihi ?? Date.now()), aciklama: girdi.aciklama, sarflar: { create: sarfKayitlari.map((s) => ({ tenantId, ...s })) } }, include: { sarflar: true } });
      if (karantinaDepo) await tx.uretimKaliteKontrol.create({ data: { tenantId, uretimEmriId: id, uretimBildirimiId: bildirim.id, karantinaDepoId: karantinaDepo.id, miktar: uretilen } });
      await tx.uretimEmri.update({ where: { id, tenantId }, data: { durum: karantinaDepo ? "kalite_bekliyor" : tamamlandi ? "tamamlandi" : "kismen_tamamlandi", uretilenMiktar: { increment: uretilen }, hurdaMiktari: { increment: D(girdi.hurdaMiktari) }, yenidenIslemeMiktari: { increment: D(girdi.yenidenIslemeMiktari) }, toplamMaliyet: { increment: toplamMaliyet.add(ekGiderMaliyeti) }, tamamlanmaTarihi: !karantinaDepo && tamamlandi ? new Date() : null } });
      if (tamamlandi && !karantinaDepo) await this.emirRezervasyonlariniCoz(tx, id);
      return bildirim;
    });
  }

  async kaliteKontrolleri(durum?: string) {
    const { tenantId } = aktifBaglam();
    const filtre = ["bekliyor", "yeniden_isleme", "kabul", "red"].includes(durum ?? "") ? durum as "bekliyor" | "yeniden_isleme" | "kabul" | "red" : undefined;
    return this.prisma.tenantIslem(tenantId, (tx) => tx.uretimKaliteKontrol.findMany({ where: filtre ? { durum: filtre } : undefined, orderBy: { createdAt: "desc" }, include: { karantinaDepo: { select: { kod: true, ad: true } }, uretimBildirimi: true, uretimEmri: { include: { stok: { select: { kod: true, ad: true, anaBirim: true, takipTipi: true } }, varyant: { select: { kod: true, ad: true } }, hedefDepo: { select: { kod: true, ad: true } } } } } }));
  }

  async kaliteKarari(id: string, girdi: z.infer<typeof kaliteKararSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Kabul/red karantinadan stok hareketi yazar; kapalı döneme kayıt girmez.
      await this.uretimDonemiAcikOlmali(tx, new Date());
      const kontrol = await tx.uretimKaliteKontrol.findFirst({ where: { id, durum: "bekliyor" }, include: { uretimBildirimi: true, uretimEmri: { include: { stok: true, kalemler: true } } } });
      if (!kontrol) throw new NotFoundException("Bekleyen kalite kontrol kaydı bulunamadı");
      if (girdi.karar === "yeniden_isleme") {
        const sonuc = await tx.uretimKaliteKontrol.updateMany({ where: { id, durum: "bekliyor" }, data: { durum: "yeniden_isleme", kontrolNotu: girdi.kontrolNotu, olcumler: girdi.olcumler ?? undefined, kontrolEdenUserId: userId, kontrolZamani: new Date(), yenidenIslemeSayisi: { increment: 1 }, yenidenIslemeBaslangic: new Date(), yenidenIslemeBitis: null } });
        if (sonuc.count !== 1) throw new BadRequestException("Kalite kaydı başka bir işlem tarafından değiştirildi");
        await tx.uretimEmri.update({ where: { id: kontrol.uretimEmriId, tenantId }, data: { durum: "kalite_bekliyor", yenidenIslemeMiktari: { increment: kontrol.miktar } } });
        return tx.uretimKaliteKontrol.findUniqueOrThrow({ where: { id }, include: { uretimEmri: { include: { stok: true } }, karantinaDepo: true } });
      }
      // Bildirimde mamule verilen birim maliyet (operasyon payı dahil, yan ürün payı düşülmüş).
      const birimMaliyet = kontrol.uretimBildirimi.mamulBirimMaliyeti ?? D(kontrol.uretimBildirimi.toplamMaliyet).div(kontrol.miktar).toDecimalPlaces(4);
      const cikis = await this.stokService.hareketEkle(tx, { stokId: kontrol.uretimEmri.stokId, varyantId: kontrol.uretimEmri.varyantId, depoId: kontrol.karantinaDepoId, tip: "cikis", miktar: kontrol.miktar, girilenBirim: kontrol.uretimEmri.stok.anaBirim, girilenMiktar: kontrol.miktar, birimMaliyet: D(0), tarih: new Date(), aciklama: `${kontrol.uretimEmri.no} kalite ${girdi.karar === "kabul" ? "kabul" : "red"} çıkışı`, kaynakTur: `uretim_kalite_${girdi.karar}`, kaynakRef: kontrol.id });
      if (girdi.karar === "kabul") {
        await this.stokService.hareketEkle(tx, { stokId: kontrol.uretimEmri.stokId, varyantId: kontrol.uretimEmri.varyantId, depoId: kontrol.uretimEmri.hedefDepoId, tip: "giris", miktar: kontrol.miktar, girilenBirim: kontrol.uretimEmri.stok.anaBirim, girilenMiktar: kontrol.miktar, birimMaliyet, tarih: new Date(), aciklama: `${kontrol.uretimEmri.no} kalite kabul girişi`, kaynakTur: "uretim_kalite_kabul", kaynakRef: kontrol.id, partiler: cikis.partiTahsisleri });
      }
      const sonuc = await tx.uretimKaliteKontrol.updateMany({ where: { id, durum: "bekliyor" }, data: { durum: girdi.karar, kontrolNotu: girdi.kontrolNotu, olcumler: girdi.olcumler ?? undefined, kontrolEdenUserId: userId, kontrolZamani: new Date() } });
      if (sonuc.count !== 1) throw new BadRequestException("Kalite kararı başka bir işlem tarafından verilmiş");
      if (girdi.karar === "red") {
        for (const kalem of kontrol.uretimEmri.kalemler) {
          const ekIhtiyac = D(kalem.planlananMiktar).mul(kontrol.miktar).div(kontrol.uretimEmri.planlananMiktar).toDecimalPlaces(3);
          if (ekIhtiyac.gt(0)) await tx.uretimEmriKalem.update({ where: { id: kalem.id, tenantId }, data: { ekIhtiyacMiktari: { increment: ekIhtiyac } } });
        }
      }
      // Aynı emrin partileri ayrı ayrı karara bağlanabilir: emir satırı kilitlenir
      // ki iki karar üretilen miktarı birbirinin üstüne yazmasın.
      await tx.$queryRaw`SELECT id FROM uretim_emirleri WHERE id = ${kontrol.uretimEmriId}::uuid FOR UPDATE`;
      const emir = await tx.uretimEmri.findUniqueOrThrow({ where: { id: kontrol.uretimEmriId, tenantId } });
      // Red, başka parti beklese de hemen düşer (önceden yalnız son karar düşüyordu).
      const kabulEdilen = girdi.karar === "red" ? D(emir.uretilenMiktar).sub(kontrol.miktar) : D(emir.uretilenMiktar);
      const acikKontrol = await tx.uretimKaliteKontrol.count({ where: { uretimEmriId: kontrol.uretimEmriId, durum: { in: ACIK_KALITE_DURUMLARI }, id: { not: id } } });
      const tamamlandi = !acikKontrol && kabulEdilen.gte(emir.planlananMiktar);
      await tx.uretimEmri.update({ where: { id: emir.id, tenantId }, data: {
        durum: acikKontrol ? "kalite_bekliyor" : tamamlandi ? "tamamlandi" : girdi.karar === "red" ? "malzeme_bekliyor" : "kismen_tamamlandi",
        uretilenMiktar: kabulEdilen,
        // Reddedilen mamul karantinadan çıkıp yok edilir; hurda oranına girer.
        ...(girdi.karar === "red" ? { hurdaMiktari: { increment: kontrol.miktar } } : {}),
        tamamlanmaTarihi: tamamlandi ? new Date() : null,
      } });
      if (tamamlandi) await this.emirRezervasyonlariniCoz(tx, emir.id);
      return tx.uretimKaliteKontrol.findUniqueOrThrow({ where: { id }, include: { uretimEmri: { include: { stok: true } }, karantinaDepo: true } });
    });
  }

  async yenidenIslemeTamamla(id: string, girdi: z.infer<typeof yenidenIslemeTamamlaSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kontrol = await tx.uretimKaliteKontrol.findFirst({ where: { id, durum: "yeniden_isleme" } });
      if (!kontrol) throw new NotFoundException("Yeniden işlemede kalite kaydı bulunamadı");
      const sonuc = await tx.uretimKaliteKontrol.updateMany({ where: { id, durum: "yeniden_isleme" }, data: { durum: "bekliyor", kontrolNotu: girdi.aciklama, kontrolZamani: null, kontrolEdenUserId: null, yenidenIslemeBitis: new Date() } });
      if (sonuc.count !== 1) throw new BadRequestException("Yeniden işleme kaydı başka bir işlem tarafından değiştirildi");
      return tx.uretimKaliteKontrol.findUniqueOrThrow({ where: { id }, include: { uretimEmri: { include: { stok: true } }, karantinaDepo: true } });
    });
  }

  async sarfDuzelt(id: string, girdi: z.infer<typeof sarfDuzeltmeSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.uretimDonemiAcikOlmali(tx, new Date());
      const onceki = await tx.uretimSarfDuzeltme.findUnique({ where: { tenantId_idempotencyAnahtari: { tenantId, idempotencyAnahtari: girdi.idempotencyAnahtari } } });
      if (onceki) {
        if (onceki.uretimEmriId !== id) throw new BadRequestException("Düzeltme anahtarı başka bir üretim emrinde kullanılmış");
        return onceki;
      }
      const kalem = await tx.uretimEmriKalem.findFirst({ where: { id: girdi.uretimEmriKalemId, uretimEmriId: id, tenantId }, include: { malzeme: true, uretimEmri: true } });
      if (!kalem) throw new NotFoundException("Üretim emri malzemesi bulunamadı");
      if (!["uretimde", "kismen_tamamlandi", "kalite_bekliyor", "malzeme_bekliyor"].includes(kalem.uretimEmri.durum)) throw new BadRequestException("Bu durumdaki üretim emrinde sarf düzeltilemez");
      const miktar = D(girdi.miktar);
      if (girdi.tip === "iade" && miktar.gt(kalem.sarfEdilenMiktar)) throw new BadRequestException("İade miktarı toplam gerçek sarfı aşamaz");
      const seriler = girdi.seriNumaralari ?? [];
      if (girdi.tip === "iade" && kalem.malzeme.takipTipi === "lot" && !girdi.lotNo) throw new BadRequestException("Lot takipli malzeme iadesinde lot numarası gerekli");
      if (girdi.tip === "iade" && kalem.malzeme.takipTipi === "seri" && (!miktar.isInteger() || seriler.length !== miktar.toNumber() || new Set(seriler).size !== seriler.length)) throw new BadRequestException("Seri takipli iadede miktar kadar benzersiz seri numarası gerekli");
      const partiler = girdi.tip === "iade" && kalem.malzeme.takipTipi === "lot" ? [{ lotNo: girdi.lotNo!, miktar }] : girdi.tip === "iade" && kalem.malzeme.takipTipi === "seri" ? seriler.map((seriNo) => ({ lotNo: girdi.lotNo ?? kalem.uretimEmri.no, seriNo, miktar: D(1) })) : undefined;
      const sonuc = await this.stokService.hareketEkle(tx, { stokId: kalem.malzemeStokId, varyantId: kalem.malzemeVaryantId, depoId: girdi.depoId, tip: girdi.tip === "ek_sarf" ? "cikis" : "giris", miktar, girilenBirim: kalem.malzeme.anaBirim, girilenMiktar: miktar, birimMaliyet: girdi.tip === "iade" ? kalem.birimMaliyet : D(0), tarih: new Date(), aciklama: `${kalem.uretimEmri.no} ${girdi.tip === "ek_sarf" ? "ek sarf" : "malzeme iadesi"}: ${girdi.neden}`, kaynakTur: `uretim_sarf_${girdi.tip}`, kaynakRef: girdi.idempotencyAnahtari, partiler });
      const birimMaliyet = girdi.tip === "ek_sarf" ? D(kalem.malzeme.ortalamaMaliyet) : D(kalem.birimMaliyet);
      const maliyetFarki = miktar.mul(birimMaliyet).mul(girdi.tip === "ek_sarf" ? 1 : -1).toDecimalPlaces(4);
      await tx.uretimEmriKalem.update({ where: { id: kalem.id, tenantId }, data: { sarfEdilenMiktar: { increment: girdi.tip === "ek_sarf" ? miktar : miktar.negated() }, birimMaliyet } });
      await tx.uretimEmri.update({ where: { id, tenantId }, data: { toplamMaliyet: { increment: maliyetFarki } } });
      const partiBilgileri = sonuc.partiTahsisleri.map((p) => ({ ...p, miktar: p.miktar.toFixed(3) }));
      return tx.uretimSarfDuzeltme.create({ data: { tenantId, uretimEmriId: id, uretimEmriKalemId: kalem.id, depoId: girdi.depoId, tip: girdi.tip, miktar, birimMaliyet, neden: girdi.neden, idempotencyAnahtari: girdi.idempotencyAnahtari, partiBilgileri }, include: { depo: true, uretimEmriKalem: { include: { malzeme: true } } } });
    });
  }

  async iptal(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const emir = await tx.uretimEmri.findUnique({ where: { id, tenantId } });
      if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
      if (!["taslak", "planlandi", "malzeme_bekliyor", "hazir"].includes(emir.durum)) throw new BadRequestException("Başlamış veya tamamlanmış üretim emri iptal edilemez");
      await this.emirRezervasyonlariniCoz(tx, id);
      const sonuc = await tx.uretimEmri.updateMany({ where: { id, tenantId, durum: emir.durum }, data: { durum: "iptal" } });
      if (sonuc.count !== 1) throw new BadRequestException("Üretim emrinin durumu başka bir işlem tarafından değiştirildi");
      await this.acikOperasyonlariIptalEt(tx, id);
      return tx.uretimEmri.findUniqueOrThrow({ where: { id, tenantId } });
    });
  }

  /**
   * Başlamış emri kalan miktarı üretmeden kapatır: üretilen kadarıyla
   * tamamlanır (hiç bildirim yoksa iptal olur), kalan malzeme ayrımı çözülür, açık operasyonlar iptal edilir.
   * Kalite kararı bekleyen ya da operasyonu süren emir kapatılmaz; o işin
   * sonucu stok ve maliyeti değiştirir.
   */
  async kapat(id: string, girdi: z.infer<typeof uretimEmriKapatSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const emir = await tx.uretimEmri.findUnique({ where: { id, tenantId } });
      if (!emir) throw new NotFoundException("Üretim emri bulunamadı");
      if (!["uretimde", "kismen_tamamlandi", "malzeme_bekliyor"].includes(emir.durum)) throw new BadRequestException("Yalnız üretimi süren ya da kalite reddinden dönen emir kapatılabilir");
      // Hiç bildirim ya da ek sarf yoksa ne mamul girdi ne malzeme çıktı: emir iptal sayılır.
      const bildirimVar = (await tx.uretimBildirimi.count({ where: { uretimEmriId: id } })) + (await tx.uretimSarfDuzeltme.count({ where: { uretimEmriId: id } })) > 0;
      const suren = await tx.uretimEmriOperasyonu.count({ where: { uretimEmriId: id, durum: "devam_ediyor" } });
      if (suren) throw new BadRequestException("Süren operasyon var; önce bekletin ya da tamamlayın");
      const sonuc = await tx.uretimEmri.updateMany({ where: { id, tenantId, durum: emir.durum }, data: { durum: bildirimVar ? "tamamlandi" : "iptal", tamamlanmaTarihi: bildirimVar ? new Date() : null, kapanisNedeni: girdi.neden } });
      if (sonuc.count !== 1) throw new BadRequestException("Üretim emrinin durumu başka bir işlem tarafından değiştirildi");
      await this.emirRezervasyonlariniCoz(tx, id);
      await this.acikOperasyonlariIptalEt(tx, id);
      return tx.uretimEmri.findUniqueOrThrow({ where: { id, tenantId } });
    });
  }

  /**
   * Mamul, malzemelerinin (yürürlükteki ya da bekleyen) reçete ağacında
   * yeniden geçiyorsa reçete döngüseldir: A → B → A. Emir açılışında sonsuz
   * ihtiyaç doğurur, maliyet hesaplanamaz.
   */
  private async donguDenetle(tx: Prisma.TransactionClient, mamulId: string, malzemeIds: string[]) {
    // ust: ağaca giren her ürünü malzeme olarak kullanan üst ürün; döngü yolu buradan geri izlenir.
    const ust = new Map<string, string>();
    let sinir = [...new Set(malzemeIds)];
    for (const id of sinir) ust.set(id, mamulId);
    while (sinir.length && !sinir.includes(mamulId)) {
      const kalemler = await tx.urunRecetesiKalem.findMany({ where: { recete: { stokId: { in: sinir }, durum: { in: ["taslak", "onay_bekliyor", "aktif"] } } }, select: { malzemeStokId: true, recete: { select: { stokId: true } } } });
      const sonraki: string[] = [];
      for (const k of kalemler) {
        if (ust.has(k.malzemeStokId)) continue;
        ust.set(k.malzemeStokId, k.recete.stokId);
        sonraki.push(k.malzemeStokId);
      }
      sinir = sonraki;
    }
    if (!sinir.includes(mamulId)) return;
    const yol = [mamulId];
    for (let id = ust.get(mamulId)!; id !== mamulId; id = ust.get(id)!) yol.unshift(id);
    yol.unshift(mamulId);
    const kodlar = new Map((await tx.stokKart.findMany({ where: { id: { in: yol } }, select: { id: true, kod: true } })).map((k) => [k.id, k.kod]));
    throw new BadRequestException(`Döngüsel reçete: ${yol.map((id) => kodlar.get(id) ?? id).join(" → ")}`);
  }

  /** Bitmemiş operasyonlar kapasite yükünde kalmasın diye iptal edilir. */
  private async acikOperasyonlariIptalEt(tx: Prisma.TransactionClient, emirId: string) {
    await tx.uretimEmriOperasyonu.updateMany({ where: { uretimEmriId: emirId, durum: { in: ["planlandi", "hazir", "beklemede"] } }, data: { durum: "iptal" } });
  }

  private async uretimDonemiAcikOlmali(tx: Prisma.TransactionClient, tarih: Date) {
    // Dönem Türkiye takvimiyle: 1 Kasım 00:30 (TR) kasımdır, sunucu UTC'de olsa da.
    const [yil, ay] = tarihTR(tarih).split("-").map(Number);
    const kilit = await tx.uretimDonemKilidi.findFirst({ where: { yil, ay } });
    if (kilit) throw new BadRequestException(`${String(kilit.ay).padStart(2, "0")}/${kilit.yil} üretim dönemi kapalı; bu tarihe hareket kaydedilemez`);
  }

  /**
   * URT-HURDA: planın üstündeki sarf. Önce emrin ayrımı olan depolardaki,
   * sonra diğer depolardaki serbest (mevcut − rezerve) stoktan; yetmezse bu
   * emrin kalan ayrımından düşülür. Hiçbiri yetmezse kalan, ilk adaya yazılır
   * ve firmanın eksi stok politikası (engelle / uyar / izin) karar verir.
   */
  private async fazlaSarfEt(
    tx: Prisma.TransactionClient,
    kalem: { malzemeStokId: string; malzemeVaryantId: string | null },
    rezervasyonlar: { id: string; depoId: string; aktifMiktar: Prisma.Decimal }[],
    miktar: Prisma.Decimal,
    hareket: (depoId: string, miktar: Prisma.Decimal) => Promise<unknown>,
  ) {
    const bakiyeler = kalem.malzemeVaryantId
      ? await tx.stokVaryantDepoBakiye.findMany({ where: { varyantId: kalem.malzemeVaryantId, depo: sarfaUygunDepo }, include: { depo: true } })
      : await tx.stokDepoBakiye.findMany({ where: { stokId: kalem.malzemeStokId, depo: sarfaUygunDepo }, include: { depo: true } });
    const emirDepolari = new Set(rezervasyonlar.map((r) => r.depoId));
    const adaylar = bakiyeler
      .map((b) => ({ depoId: b.depoId, varsayilan: b.depo.varsayilan, serbest: Prisma.Decimal.max(D(0), D(b.mevcutMiktar).sub(b.rezerveMiktar)) }))
      .sort((a, b) => Number(emirDepolari.has(b.depoId)) - Number(emirDepolari.has(a.depoId)) || Number(b.varsayilan) - Number(a.varsayilan) || b.serbest.comparedTo(a.serbest));
    let kalan = miktar;
    for (const aday of adaylar) {
      if (kalan.isZero()) break;
      const sarf = Prisma.Decimal.min(kalan, aday.serbest);
      if (sarf.lte(0)) continue;
      await hareket(aday.depoId, sarf);
      kalan = kalan.sub(sarf);
    }
    for (const rezervasyon of rezervasyonlar) {
      if (kalan.isZero()) break;
      const sarf = Prisma.Decimal.min(kalan, rezervasyon.aktifMiktar);
      if (sarf.lte(0)) continue;
      await this.rezervasyonBakiyesiCoz(tx, kalem, rezervasyon.depoId, sarf, rezervasyon.id, "sarf");
      rezervasyon.aktifMiktar = rezervasyon.aktifMiktar.sub(sarf);
      await hareket(rezervasyon.depoId, sarf);
      kalan = kalan.sub(sarf);
    }
    if (kalan.gt(0)) {
      const depoId = adaylar[0]?.depoId ?? rezervasyonlar[0]?.depoId;
      if (!depoId) throw new BadRequestException("Hurda/fazla sarf için malzemenin bulunduğu bir depo yok");
      await hareket(depoId, kalan);
    }
  }

  private aktifRezervMiktari(rezervasyon: { rezerveMiktar: Prisma.Decimal; sarfEdilenMiktar: Prisma.Decimal; cozulenMiktar: Prisma.Decimal }) {
    return Prisma.Decimal.max(D(0), D(rezervasyon.rezerveMiktar).sub(rezervasyon.sarfEdilenMiktar).sub(rezervasyon.cozulenMiktar));
  }

  private async rezervasyonBakiyesiCoz(
    tx: Prisma.TransactionClient,
    kalem: { malzemeStokId: string; malzemeVaryantId: string | null },
    depoId: string,
    miktar: Prisma.Decimal,
    rezervasyonId: string,
    neden: "sarf" | "iptal",
  ) {
    const { tenantId } = aktifBaglam();
    await tx.stokKart.update({ where: { id: kalem.malzemeStokId }, data: { rezerveMiktar: { decrement: miktar } } });
    await tx.stokDepoBakiye.update({ where: { tenantId_stokId_depoId: { tenantId, stokId: kalem.malzemeStokId, depoId } }, data: { rezerveMiktar: { decrement: miktar } } });
    if (kalem.malzemeVaryantId) {
      await tx.stokVaryant.update({ where: { id: kalem.malzemeVaryantId }, data: { rezerveMiktar: { decrement: miktar } } });
      await tx.stokVaryantDepoBakiye.update({ where: { tenantId_varyantId_depoId: { tenantId, varyantId: kalem.malzemeVaryantId, depoId } }, data: { rezerveMiktar: { decrement: miktar } } });
    }
    await tx.uretimMalzemeRezervasyon.update({ where: { id: rezervasyonId }, data: neden === "sarf" ? { sarfEdilenMiktar: { increment: miktar } } : { cozulenMiktar: { increment: miktar } } });
  }

  private async emirRezervasyonlariniCoz(tx: Prisma.TransactionClient, emirId: string) {
    const rezervasyonlar = await tx.uretimMalzemeRezervasyon.findMany({ where: { uretimEmriKalem: { uretimEmriId: emirId } }, include: { uretimEmriKalem: true } });
    for (const rezervasyon of rezervasyonlar) {
      const aktifMiktar = this.aktifRezervMiktari(rezervasyon);
      if (aktifMiktar.gt(0)) await this.rezervasyonBakiyesiCoz(tx, rezervasyon.uretimEmriKalem, rezervasyon.depoId, aktifMiktar, rezervasyon.id, "iptal");
    }
  }

  private async durumGecisi(id: string, kaynaklar: ("taslak" | "planlandi" | "hazir")[], hedef: "planlandi" | "uretimde", hataMesaji: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.uretimEmri.updateMany({ where: { id, tenantId, durum: { in: kaynaklar } }, data: { durum: hedef } });
      if (sonuc.count !== 1) throw new BadRequestException(hataMesaji);
      return tx.uretimEmri.findUniqueOrThrow({ where: { id, tenantId }, include: { stok: true, hedefDepo: true, kalemler: { include: { malzeme: true, malzemeVaryant: true } } } });
    });
  }

  async uretilebilirUrunler() {
    const { tenantId } = aktifBaglam();
    const receteler = await this.prisma.tenantIslem(tenantId, (tx) => tx.urunRecetesi.findMany({ where: { aktif: true, durum: "aktif", stok: { aktif: true } }, orderBy: [{ stok: { ad: "asc" } }, { surum: "desc" }], include: { stok: { select: { id: true, kod: true, ad: true, anaBirim: true, mevcutMiktar: true, takipTipi: true, varyantlar: { where: { aktif: true }, orderBy: { kod: "asc" }, select: { id: true, kod: true, ad: true, mevcutMiktar: true } } } }, _count: { select: { kalemler: true } } } }));
    // İleri tarihli sürüm onaylıyken aynı ürünün iki aktif sürümü olur; liste
    // ürün başına tek satırdır, emir açılışı tarihe uyan sürümü kendisi seçer.
    // Varyanta özel reçeteler kartın satırında toplanır: form genel reçete yoksa
    // yalnız kendi reçetesi olan varyantları üretilebilir gösterir.
    const kartlar = new Map<string, (typeof receteler)[number] & { genelRecete: boolean; receteliVaryantIdleri: string[] }>();
    for (const r of receteler) {
      const kart = kartlar.get(r.stokId) ?? { ...r, genelRecete: false, receteliVaryantIdleri: [] };
      if (r.varyantId) { if (!kart.receteliVaryantIdleri.includes(r.varyantId)) kart.receteliVaryantIdleri.push(r.varyantId); }
      else kart.genelRecete = true;
      kartlar.set(r.stokId, kart);
    }
    return [...kartlar.values()];
  }
}

async function receteVaryantlariniDogrula(tx: Prisma.TransactionClient, bolum: string, satirlar: { stokId: string; varyantId?: string | null }[]) {
  try {
    await satirVaryantlariniDogrula(tx, satirlar);
  } catch (hata) {
    if (hata instanceof BadRequestException) throw new BadRequestException(`${bolum}: ${hata.message}`);
    throw hata;
  }
}

