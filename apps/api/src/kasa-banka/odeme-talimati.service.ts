/**
 * ENT-07: banka ödeme talimatı.
 *
 * Akış: oluştur (cari + fatura bağıyla ya da vadesi gelen borçlardan toplu)
 * → ikinci kullanıcı TOTP ile onaylar (planlı ödeme; nakit akışında görünür)
 * → aynı kaynak hesabın onaylı talimatları numaralı ödeme paketine alınır,
 * paketin dosyası indirilince talimatlar "bankaya gönderildi" olur → banka
 * ekstresinde eşleşince ya da kullanıcı "gerçekleşti" deyince fatura başına
 * tediye fişi yazılır. Reddedilen talimat "başarısız" işaretlenir.
 *
 * Bir faturanın açık talimatlardaki (onay bekleyen, onaylı, gönderilmiş)
 * tutarı "planlanan" sayılır; yeni talimat kalan − planlananı aşamaz.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type BankaOdemeTalimatDurumu } from "@prisma/client";
import * as ExcelJS from "exceljs";
import { bugunTR, ibanGecerliMi } from "@tekirextra/shared";
import type { z } from "zod";
import { AuthService } from "../auth/auth.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { KasaBankaService } from "./kasa-banka.service";
import { csvUret, dosyaSatirlari, odemeDosyaProfiliSemasi, pain001Uret, VARSAYILAN_PROFIL, type DosyaTalimati, type OdemeDosyaProfili } from "./odeme-dosyasi";
import type { odemeTalimatiOlusturSemasi, odemeTalimatiTopluSemasi } from "./odeme-talimati.semalar";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);
const gunMetni = (t: Date) => t.toISOString().slice(0, 10);
/** Faturayı bağlayan, henüz sonuçlanmamış talimat durumları. */
const ACIK_DURUMLAR: BankaOdemeTalimatDurumu[] = ["onay_bekliyor", "onaylandi", "gonderildi"];

const LISTE_ICERIGI = {
  bankaHesap: { select: { id: true, ad: true, bankaAdi: true } },
  cari: { select: { id: true, kod: true, unvan: true } },
  olusturan: { select: { id: true, adSoyad: true } },
  onaylayan: { select: { id: true, adSoyad: true } },
  paket: { select: { id: true, no: true } },
  faturalar: { select: { tutar: true, fatura: { select: { id: true, no: true, tarih: true, vadeTarihi: true, tip: true } } } },
} satisfies Prisma.BankaOdemeTalimatiInclude;

type OlusturGirdisi = z.infer<typeof odemeTalimatiOlusturSemasi>;

@Injectable()
export class OdemeTalimatiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly kasaBanka: KasaBankaService,
    private readonly donemKilidi: DonemKilidiService,
  ) {}

  async listele(sorgu: { durum?: BankaOdemeTalimatDurumu; bankaHesapId?: string } = {}) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.bankaOdemeTalimati.findMany({
      where: { durum: sorgu.durum, bankaHesapId: sorgu.bankaHesapId },
      orderBy: [{ createdAt: "desc" }],
      take: 300,
      include: LISTE_ICERIGI,
    }));
  }

  /**
   * Vadesi gelen ödenecek faturalar (alış ve satış iadesi), carilere göre
   * gruplu; kalan, açık talimatlardaki planlanan tutar düşülerek verilir.
   */
  async adayBorclar(sorgu: { bankaHesapId: string; vadeBitis?: string; cariId?: string }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hesap = await tx.bankaHesap.findUnique({ where: { id: sorgu.bankaHesapId }, select: { dovizCinsi: true } });
      if (!hesap) throw new NotFoundException("Banka hesabı bulunamadı");
      const sinir = sorgu.vadeBitis ? new Date(sorgu.vadeBitis) : null;
      const faturalar = await tx.fatura.findMany({
        where: {
          durum: "kesin", tip: { in: ["alis", "satis_iade"] }, dovizCinsi: hesap.dovizCinsi, cariId: sorgu.cariId,
          ...(sinir ? { OR: [{ vadeTarihi: { lte: sinir } }, { vadeTarihi: null, tarih: { lte: sinir } }] } : {}),
        },
        select: { id: true, no: true, tip: true, tarih: true, vadeTarihi: true, genelToplam: true, durum: true, cariId: true, ...FATURA_ODEME_SECIMI },
        orderBy: [{ vadeTarihi: "asc" }, { tarih: "asc" }],
      });
      const planlanan = await this.planlananOdemeler(tx, faturalar.map((f) => f.id));
      const acik = faturalar
        .map((f) => ({ f, kalan: faturaOdemeDurumu(f).kalan.sub(planlanan.get(f.id) ?? 0) }))
        .filter((x) => x.kalan.gt(0));
      const cariIdleri = [...new Set(acik.map((x) => x.f.cariId))];
      const cariler = await tx.cariHesap.findMany({
        where: { id: { in: cariIdleri } },
        select: { id: true, kod: true, unvan: true, vknTckn: true, bankaHesaplari: { where: { paraBirimi: hesap.dovizCinsi }, select: { id: true, bankaAdi: true, iban: true, hesapSahibi: true } } },
      });
      return cariler.map((c) => {
        const kendi = acik.filter((x) => x.f.cariId === c.id);
        return {
          cari: { id: c.id, kod: c.kod, unvan: c.unvan, vknTckn: c.vknTckn },
          bankaHesaplari: c.bankaHesaplari,
          toplam: kendi.reduce((t, x) => t.add(x.kalan), D(0)).toFixed(2),
          faturalar: kendi.map((x) => ({
            id: x.f.id, no: x.f.no, tip: x.f.tip, tarih: gunMetni(x.f.tarih), vadeTarihi: gunMetni(x.f.vadeTarihi ?? x.f.tarih),
            genelToplam: x.f.genelToplam.toFixed(2), kalan: x.kalan.toFixed(2), planlanan: (planlanan.get(x.f.id) ?? D(0)).toFixed(2),
          })),
        };
      }).sort((a, b) => a.cari.unvan.localeCompare(b.cari.unvan, "tr"));
    });
  }

  async olustur(girdi: OlusturGirdisi) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => this.olusturTx(tx, tenantId, userId, girdi));
  }

  /** Vadesi gelen borçlardan cari başına bir talimat; hepsi tek işlemde. */
  async topluOlustur(girdi: z.infer<typeof odemeTalimatiTopluSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = [];
      for (const k of girdi.kalemler) {
        sonuc.push(await this.olusturTx(tx, tenantId, userId, {
          bankaHesapId: girdi.bankaHesapId, odemeTarihi: girdi.odemeTarihi, cariId: k.cariId, cariBankaHesapId: k.cariBankaHesapId,
          aciklama: girdi.aciklama || null, faturalar: k.faturalar, tutar: null, aliciIban: null, aliciUnvan: null,
        }));
      }
      return { adet: sonuc.length, toplam: sonuc.reduce((t, x) => t.add(x.tutar), D(0)).toFixed(2), talimatlar: sonuc.map((t) => ({ id: t.id, no: t.no })) };
    });
  }

  /**
   * Seçilen talimatları tek TOTP ile onaylar; oluşturan kendi talimatını
   * onaylayamaz (görev ayrılığı). Onaylanan talimat planlı ödeme olur.
   */
  async onayla(idler: string[], totpKodu: string) {
    const { tenantId, userId } = aktifBaglam();
    const talimatlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaOdemeTalimati.findMany({ where: { id: { in: idler } }, select: { id: true, no: true, olusturanUserId: true, durum: true } }));
    if (talimatlar.length !== new Set(idler).size) throw new NotFoundException("Ödeme talimatı bulunamadı");
    const kendi = talimatlar.find((t) => t.olusturanUserId === userId);
    if (kendi) throw new BadRequestException(`${kendi.no ?? "Talimat"}: talimatı oluşturan kullanıcı onaylayamaz`);
    const beklemeyen = talimatlar.find((t) => t.durum !== "onay_bekliyor");
    if (beklemeyen) throw new ConflictException(`${beklemeyen.no ?? "Talimat"} artık onay beklemiyor`);
    await this.auth.kritikIslemTotpDogrula(totpKodu);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.bankaOdemeTalimati.updateMany({ where: { id: { in: idler }, durum: "onay_bekliyor", onaylayanUserId: null }, data: { durum: "onaylandi", onaylayanUserId: userId, onayZamani: new Date() } });
      if (sonuc.count !== idler.length) throw new ConflictException("Talimatlardan biri başka bir kullanıcı tarafından işlendi; ekranı yenileyin");
      return { onaylanan: sonuc.count };
    });
  }

  async iptal(id: string) {
    const { tenantId, userId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaOdemeTalimati.updateMany({ where: { id, olusturanUserId: userId, durum: "onay_bekliyor" }, data: { durum: "iptal" } }));
    if (sonuc.count !== 1) throw new BadRequestException("Yalnız oluşturan kullanıcı, onay bekleyen talimatı iptal edebilir");
    return { basarili: true };
  }

  /** Banka reddetti ya da gönderilmedi: talimat sonuçlanır, faturalar yeniden ödenebilir. */
  async basarisiz(id: string, neden: string) {
    const { tenantId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaOdemeTalimati.updateMany({ where: { id, durum: { in: ["onaylandi", "gonderildi"] } }, data: { durum: "basarisiz", hataMesaji: neden } }));
    if (sonuc.count !== 1) throw new BadRequestException("Yalnız onaylı ya da bankaya gönderilmiş talimat başarısız işaretlenir");
    return { basarili: true };
  }

  // ─── ÖDEME PAKETİ VE DOSYA ────────────────────────────────────────────────

  async paketler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.odemePaketi.findMany({
      orderBy: { createdAt: "desc" }, take: 100,
      include: { bankaHesap: { select: { id: true, ad: true, bankaAdi: true } }, talimatlar: { select: { id: true, no: true, durum: true, aliciUnvan: true, tutar: true } } },
    }));
  }

  async paketOlustur(bankaHesapId: string, talimatIdleri: string[]) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hesap = await tx.bankaHesap.findUnique({ where: { id: bankaHesapId }, select: { odemeDosyaProfili: true } });
      if (!hesap) throw new NotFoundException("Banka hesabı bulunamadı");
      const talimatlar = await tx.bankaOdemeTalimati.findMany({ where: { id: { in: talimatIdleri } }, select: { id: true, no: true, durum: true, bankaHesapId: true, paketId: true, tutar: true } });
      if (talimatlar.length !== new Set(talimatIdleri).size) throw new NotFoundException("Talimatlardan biri bulunamadı");
      const uygunsuz = talimatlar.find((t) => t.durum !== "onaylandi" || t.paketId || t.bankaHesapId !== bankaHesapId);
      if (uygunsuz) throw new BadRequestException(`${uygunsuz.no ?? "Talimat"} pakete alınamaz: yalnız bu hesaptan, onaylı ve pakete girmemiş talimatlar seçilir`);
      const profil = this.profilCoz(hesap.odemeDosyaProfili);
      const paket = await tx.odemePaketi.create({
        data: {
          tenantId, no: await this.numaraAl(tx, tenantId, "OPK"), bankaHesapId, dosyaBicimi: profil.bicim, olusturanUserId: userId,
          toplam: talimatlar.reduce((t, x) => t.add(x.tutar), D(0)), adet: talimatlar.length,
        },
      });
      await tx.bankaOdemeTalimati.updateMany({ where: { id: { in: talimatIdleri }, paketId: null, durum: "onaylandi" }, data: { paketId: paket.id } });
      return paket;
    });
  }

  /** Paket indirilmeden iptal edilebilir; talimatlar yeniden pakete alınabilir. */
  async paketIptal(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const paket = await tx.odemePaketi.findUnique({ where: { id } });
      if (!paket || paket.iptal) throw new NotFoundException("Paket bulunamadı");
      if (paket.indirmeSayisi > 0) throw new BadRequestException("Dosyası indirilmiş paket iptal edilemez; banka reddettiyse talimatları başarısız işaretleyin");
      await tx.bankaOdemeTalimati.updateMany({ where: { paketId: id }, data: { paketId: null } });
      await tx.odemePaketi.update({ where: { id }, data: { iptal: true } });
      return { iptal: true };
    });
  }

  /**
   * Paketin toplu ödeme dosyası (hesabın profiline göre). İlk indirmede onaylı
   * talimatlar "bankaya gönderildi" olur; sonraki indirmeler sayılır.
   */
  async paketDosyasi(id: string): Promise<{ icerik: Buffer; dosyaAdi: string; mime: string }> {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const paket = await tx.odemePaketi.findUnique({
        where: { id },
        include: {
          bankaHesap: { select: { iban: true, odemeDosyaProfili: true } },
          talimatlar: { orderBy: { no: "asc" }, include: { cari: { select: { vknTckn: true } } } },
        },
      });
      if (!paket || paket.iptal) throw new NotFoundException("Paket bulunamadı");
      const talimatlar = paket.talimatlar.filter((t) => t.durum !== "iptal" && t.durum !== "basarisiz");
      if (!talimatlar.length) throw new BadRequestException("Pakette gönderilecek talimat kalmadı");
      const profil = this.profilCoz(paket.bankaHesap.odemeDosyaProfili);
      const bankaAdlari = new Map((await tx.cariBankaHesap.findMany({ where: { id: { in: talimatlar.map((t) => t.cariBankaHesapId).filter((x): x is string => Boolean(x)) } }, select: { id: true, bankaAdi: true } })).map((b) => [b.id, b.bankaAdi]));
      const satirlar: DosyaTalimati[] = talimatlar.map((t) => ({
        no: t.no ?? t.id.slice(0, 8), aliciUnvan: t.aliciUnvan, aliciIban: t.aliciIban, tutar: t.tutar.toFixed(2), dovizCinsi: t.dovizCinsi,
        aciklama: t.aciklama, odemeTarihi: gunMetni(t.odemeTarihi), aliciVkn: t.cari?.vknTckn ?? null, aliciBanka: t.cariBankaHesapId ? bankaAdlari.get(t.cariBankaHesapId) ?? null : null,
      }));

      let icerik: Buffer; let uzanti: string; let mime: string;
      if (profil.bicim === "pain001") {
        if (!paket.bankaHesap.iban) throw new BadRequestException("pain.001 dosyası için kaynak banka hesabının IBAN'ı tanımlı olmalıdır");
        const firma = await tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true, vkn: true } });
        icerik = Buffer.from(pain001Uret({ paketNo: paket.no, olusturma: new Date(), firmaUnvan: firma?.unvan ?? "", firmaVkn: firma?.vkn ?? null, borcluIban: paket.bankaHesap.iban, bic: profil.bic, talimatlar: satirlar }), "utf8");
        uzanti = "xml"; mime = "application/xml";
      } else if (profil.bicim === "csv") {
        icerik = Buffer.from("﻿" + csvUret(satirlar, profil), "utf8");
        uzanti = "csv"; mime = "text/csv";
      } else {
        const kitap = new ExcelJS.Workbook();
        const sayfa = kitap.addWorksheet("Toplu Ödeme");
        for (const satir of dosyaSatirlari(satirlar, profil)) sayfa.addRow(satir);
        // Hücreler metindir (IBAN ve tutar bankanın beklediği biçimde kalsın).
        sayfa.columns.forEach((k) => { k.width = 22; k.numFmt = "@"; });
        if (profil.baslikSatiri) sayfa.getRow(1).font = { bold: true };
        icerik = Buffer.from(await kitap.xlsx.writeBuffer());
        uzanti = "xlsx"; mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      }
      await tx.bankaOdemeTalimati.updateMany({ where: { paketId: id, durum: "onaylandi" }, data: { durum: "gonderildi" } });
      // Biçim indirme anındaki profilden gelir (profil paketten sonra düzeltilmiş olabilir).
      await tx.odemePaketi.update({ where: { id }, data: { indirmeSayisi: { increment: 1 }, sonIndirme: new Date(), dosyaBicimi: profil.bicim } });
      return { icerik, dosyaAdi: `${paket.no}.${uzanti}`, mime };
    });
  }

  // ─── GERÇEKLEŞME ──────────────────────────────────────────────────────────

  /** Banka ödemeyi yaptı: fatura başına tediye fişi, artanı cari bakiyesine. */
  async gerceklesti(id: string, tarih: string) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, tarih, "ödeme talimatı gerçekleşmesi");
    return this.prisma.tenantIslem(tenantId, (tx) => this.gerceklestirTx(tx, tenantId, id, tarih, null));
  }

  /** Ekstre eşleştirmesi de bunu kullanır (`ekstreSatirId` ile). */
  async gerceklestirTx(tx: Prisma.TransactionClient, tenantId: string, id: string, tarih: string, ekstreSatirId: string | null) {
    await tx.$queryRaw`SELECT id FROM banka_odeme_talimatlari WHERE id = ${id}::uuid FOR UPDATE`;
    const t = await tx.bankaOdemeTalimati.findUnique({ where: { id }, include: { faturalar: true } });
    if (!t) throw new NotFoundException("Ödeme talimatı bulunamadı");
    if (t.durum !== "onaylandi" && t.durum !== "gonderildi") throw new BadRequestException(`${t.no ?? "Talimat"} gerçekleşti işaretlenemez (durum: ${t.durum})`);
    const ortak = { kasaId: null, posHesapId: null, bankaHesapId: t.bankaHesapId, tip: "tediye" as const, dovizCinsi: t.dovizCinsi, tarih, aciklama: `${t.no ?? ""} ${t.aciklama}`.trim().slice(0, 500), cariId: t.cariId };
    const hareketIdleri: string[] = [];
    let dagitilan = D(0);
    for (const f of t.faturalar) {
      hareketIdleri.push((await this.kasaBanka.hareketOlustur(tx, tenantId, { ...ortak, tutar: f.tutar.toFixed(2), faturaId: f.faturaId })).id);
      dagitilan = dagitilan.add(f.tutar);
    }
    const kalan = t.tutar.sub(dagitilan);
    if (kalan.gt(0)) hareketIdleri.push((await this.kasaBanka.hareketOlustur(tx, tenantId, { ...ortak, tutar: kalan.toFixed(2), faturaId: null })).id);
    await tx.kasaBankaHareket.updateMany({ where: { id: { in: hareketIdleri } }, data: { kaynakTur: "odeme_talimati", kaynakRef: t.id, ...(ekstreSatirId ? { ekstreSatirId } : {}) } });
    await tx.bankaOdemeTalimati.update({ where: { id }, data: { durum: "gerceklesti", gerceklesmeTarihi: new Date(tarih) } });
    return { id: t.id, no: t.no, hareketIdleri };
  }

  /** Gerçekleşmeyi geri alır (KSB-08 kuralıyla); talimat bankaya gönderilmiş duruma döner. */
  async gerceklesmeyiGeriAl(id: string, neden: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const t = await tx.bankaOdemeTalimati.findUnique({ where: { id } });
      if (!t || t.durum !== "gerceklesti") throw new BadRequestException("Yalnız gerçekleşmiş talimatın kaydı geri alınır");
      const hareketler = await this.acikHareketler(tx, id);
      if (hareketler.some((h) => h.ekstreSatirId)) throw new BadRequestException("Bu ödeme banka ekstresinden eşleştirildi; geri almayı Banka Ekstresi ekranından yapın");
      for (const h of hareketler) await this.kasaBanka.geriAlIslem(tx, tenantId, h.id, neden, "tahsilat_tediye", false);
      await tx.bankaOdemeTalimati.update({ where: { id }, data: { durum: t.paketId ? "gonderildi" : "onaylandi", gerceklesmeTarihi: null } });
      return { geriAlindi: hareketler.length };
    });
  }

  /** Ekstre eşleşmesi geri alınınca: fişler ekstre tarafında silinir, talimat geri döner. */
  async ekstreEslesmesiGeriAlindi(tx: Prisma.TransactionClient, talimatId: string) {
    const t = await tx.bankaOdemeTalimati.findUnique({ where: { id: talimatId }, select: { paketId: true, durum: true } });
    if (t?.durum === "gerceklesti") await tx.bankaOdemeTalimati.update({ where: { id: talimatId }, data: { durum: t.paketId ? "gonderildi" : "onaylandi", gerceklesmeTarihi: null } });
  }

  /** Ekstre satırına önerilecek talimatlar: aynı hesap, aynı tutar, gönderilmiş/onaylı. */
  async ekstreAdaylari(bankaHesapId: string, tutar: Prisma.Decimal) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.bankaOdemeTalimati.findMany({
      where: { bankaHesapId, durum: { in: ["gonderildi", "onaylandi"] }, tutar },
      orderBy: { odemeTarihi: "asc" },
      select: { id: true, no: true, aliciUnvan: true, tutar: true, odemeTarihi: true, durum: true, aciklama: true },
    }));
  }

  // ─── DOSYA PROFİLİ ────────────────────────────────────────────────────────

  async profil(bankaHesapId: string) {
    const { tenantId } = aktifBaglam();
    const hesap = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaHesap.findUnique({ where: { id: bankaHesapId }, select: { odemeDosyaProfili: true } }));
    if (!hesap) throw new NotFoundException("Banka hesabı bulunamadı");
    return { profil: this.profilCoz(hesap.odemeDosyaProfili), tanimli: hesap.odemeDosyaProfili != null };
  }

  async profilKaydet(bankaHesapId: string, profil: OdemeDosyaProfili) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (!(await tx.bankaHesap.findUnique({ where: { id: bankaHesapId }, select: { id: true } }))) throw new NotFoundException("Banka hesabı bulunamadı");
      await tx.bankaHesap.update({ where: { id: bankaHesapId }, data: { odemeDosyaProfili: profil as unknown as Prisma.InputJsonValue } });
      return { profil };
    });
  }

  // ─── YARDIMCILAR ───────────────────────────────────────────────────────────

  private async olusturTx(tx: Prisma.TransactionClient, tenantId: string, userId: string, girdi: OlusturGirdisi) {
    const hesap = await tx.bankaHesap.findUnique({ where: { id: girdi.bankaHesapId } });
    if (!hesap?.aktif) throw new NotFoundException("Aktif banka hesabı bulunamadı");
    const cari = girdi.cariId ? await tx.cariHesap.findUnique({ where: { id: girdi.cariId }, select: { id: true, unvan: true, aktif: true } }) : null;
    if (girdi.cariId && !cari?.aktif) throw new BadRequestException("Aktif cari hesap bulunamadı");

    let aliciIban = girdi.aliciIban?.replace(/\s/g, "").toUpperCase() ?? null;
    let aliciUnvan = girdi.aliciUnvan ?? null;
    if (girdi.cariBankaHesapId) {
      const cbh = await tx.cariBankaHesap.findUnique({ where: { id: girdi.cariBankaHesapId } });
      if (!cbh || cbh.cariId !== girdi.cariId) throw new BadRequestException("Seçilen IBAN bu cariye ait değil");
      aliciIban = cbh.iban.replace(/\s/g, "").toUpperCase();
      aliciUnvan ??= cbh.hesapSahibi || cari?.unvan || null;
    }
    aliciUnvan ??= cari?.unvan ?? null;
    if (!aliciIban || !ibanGecerliMi(aliciIban)) throw new BadRequestException(`${cari?.unvan ?? aliciUnvan ?? "Alıcı"}: geçerli bir IBAN yok; cari kartına IBAN ekleyin ya da elle girin`);
    if (!aliciUnvan) throw new BadRequestException("Alıcı unvanı gerekli");

    // Fatura bağları: carinin, kesin, ödenecek (alış/satış iadesi) ve hesapla aynı dövizde.
    let faturaToplami = D(0);
    if (girdi.faturalar.length) {
      if (!cari) throw new BadRequestException("Fatura bağlamak için cari seçin");
      const faturalar = await tx.fatura.findMany({ where: { id: { in: girdi.faturalar.map((f) => f.faturaId) } }, select: { id: true, no: true, cariId: true, tip: true, durum: true, dovizCinsi: true, genelToplam: true, ...FATURA_ODEME_SECIMI } });
      const planlanan = await this.planlananOdemeler(tx, faturalar.map((f) => f.id));
      for (const g of girdi.faturalar) {
        const f = faturalar.find((x) => x.id === g.faturaId);
        if (!f || f.cariId !== cari.id || f.durum !== "kesin" || !["alis", "satis_iade"].includes(f.tip)) throw new BadRequestException("Yalnız seçili carinin kesinleşmiş alış/satış iadesi faturaları bağlanır");
        if (f.dovizCinsi !== hesap.dovizCinsi) throw new BadRequestException(`${f.no ?? "Fatura"} ile kaynak hesap aynı dövizde olmalıdır`);
        const odenebilir = faturaOdemeDurumu(f).kalan.sub(planlanan.get(f.id) ?? 0);
        if (D(g.tutar).gt(odenebilir)) throw new BadRequestException(`${f.no ?? "Fatura"} için ödenebilir tutar ${Prisma.Decimal.max(0, odenebilir).toFixed(2)} ${f.dovizCinsi} (açık talimatlardaki planlanan düşüldü)`);
        faturaToplami = faturaToplami.add(g.tutar);
      }
    }
    const tutar = girdi.tutar ? D(girdi.tutar) : faturaToplami;
    if (!tutar.gt(0)) throw new BadRequestException("Talimat tutarı sıfırdan büyük olmalıdır");
    if (faturaToplami.gt(tutar)) throw new BadRequestException("Faturalara dağıtılan tutar talimat tutarını aşamaz");

    const no = await this.numaraAl(tx, tenantId, "OT");
    const faturaNolari = girdi.faturalar.length
      ? (await tx.fatura.findMany({ where: { id: { in: girdi.faturalar.map((f) => f.faturaId) } }, select: { no: true } })).map((f) => f.no).filter(Boolean).join(", ")
      : "";
    const aciklama = (girdi.aciklama || (faturaNolari ? `${faturaNolari} ödemesi` : `${aliciUnvan} ödemesi`)).slice(0, 140);
    return tx.bankaOdemeTalimati.create({
      data: {
        tenantId, no, bankaHesapId: hesap.id, cariId: cari?.id ?? null, cariBankaHesapId: girdi.cariBankaHesapId ?? null, aliciUnvan, aliciIban, tutar,
        dovizCinsi: hesap.dovizCinsi, aciklama, odemeTarihi: new Date(girdi.odemeTarihi ?? bugunTR()), olusturanUserId: userId,
        faturalar: { create: girdi.faturalar.map((f) => ({ tenantId, faturaId: f.faturaId, tutar: D(f.tutar) })) },
      },
    });
  }

  /** Faturaların açık talimatlarda planlanan toplamı. */
  private async planlananOdemeler(tx: Prisma.TransactionClient, faturaIdleri: string[]) {
    if (!faturaIdleri.length) return new Map<string, Prisma.Decimal>();
    const gruplar = await tx.bankaOdemeTalimatiFatura.groupBy({ by: ["faturaId"], where: { faturaId: { in: faturaIdleri }, talimat: { durum: { in: ACIK_DURUMLAR } } }, _sum: { tutar: true } });
    return new Map(gruplar.map((g) => [g.faturaId, D(g._sum.tutar ?? 0)]));
  }

  private async acikHareketler(tx: Prisma.TransactionClient, talimatId: string) {
    const hareketler = await tx.kasaBankaHareket.findMany({ where: { kaynakTur: "odeme_talimati", kaynakRef: talimatId }, select: { id: true, ekstreSatirId: true } });
    const tersler = new Set((await tx.kasaBankaHareket.findMany({ where: { kaynakTur: "ters_kayit", kaynakRef: { in: hareketler.map((h) => h.id) } }, select: { kaynakRef: true } })).map((t) => t.kaynakRef));
    return hareketler.filter((h) => !tersler.has(h.id));
  }

  private profilCoz(ham: Prisma.JsonValue | null): OdemeDosyaProfili {
    if (ham == null) return VARSAYILAN_PROFIL;
    const sonuc = odemeDosyaProfiliSemasi.safeParse(ham);
    return sonuc.success ? sonuc.data : VARSAYILAN_PROFIL;
  }

  /** OT2026-000001 / OPK2026-000001; sayaç geri sarılmaz. */
  private async numaraAl(tx: Prisma.TransactionClient, tenantId: string, tur: "OT" | "OPK") {
    const yil = Number(bugunTR().slice(0, 4));
    const [{ son_sira: sira }] = await tx.$queryRaw<Array<{ son_sira: number }>>`
      INSERT INTO numara_sayaclari (tenant_id, tur, yil, son_sira) VALUES (${tenantId}::uuid, ${tur}, ${yil}, 1)
      ON CONFLICT (tenant_id, tur, yil) DO UPDATE SET son_sira = numara_sayaclari.son_sira + 1
      RETURNING son_sira`;
    return `${tur}${yil}-${String(sira).padStart(6, "0")}`;
  }
}
