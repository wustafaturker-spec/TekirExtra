import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as ExcelJS from "exceljs";
import { cariHareketKurTipi, GIRIS_KUR_TIPI } from "@tekirextra/shared";
import { CariIceAktarmaService } from "../cari/cari-ice-aktarma.service";
import { sablonOlustur as cariSablonu } from "../cari/cari-ice-aktarma";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { kurCoz } from "../doviz/kur-coz";
import { KasaBankaService } from "../kasa-banka/kasa-banka.service";
import { MevzuatService } from "../mevzuat/mevzuat.service";
import { StokService } from "../stok/stok.service";
import { ACIK_FATURA_SUTUNLARI, acikFaturaPlanla } from "./adim-acik-fatura";
import { ACILIS_STOK_SUTUNLARI, acilisStokPlanla } from "./adim-acilis-stok";
import { KASA_BANKA_SUTUNLARI, kasaBankaPlanla } from "./adim-kasa-banka";
import { STOK_SUTUNLARI, stokPlanla, stokYaz } from "./adim-stok";
import { ADIM_ADLARI, bosOlusturulanlar, ozetle, VERI_AKTARIMI_MODULU, type Adim, type Olusturulanlar, type SatirSonucu } from "./adim";
import { hataliSatirlarYaz, sablonYaz, tabloOku, type BaslikEslemeleri, type OkunanTablo, type SutunTanimi, type TabloSatiri } from "./tablo";
import { CARI_SUTUNLARI } from "../cari/cari-ice-aktarma";

type Tx = Prisma.TransactionClient;
const D = (d: Prisma.Decimal.Value) => new Prisma.Decimal(d);
const ISLEM_SURESI_MS = 180_000;
/** Önizlemede gösterilen satır sınırı (özet bütün dosyadan). */
const ONIZLEME_SATIRI = 1000;

const SUTUNLAR: Record<Adim, readonly SutunTanimi[]> = {
  cari: CARI_SUTUNLARI,
  stok: STOK_SUTUNLARI,
  acilis_stok: ACILIS_STOK_SUTUNLARI,
  kasa_banka: KASA_BANKA_SUTUNLARI,
  acik_fatura: ACIK_FATURA_SUTUNLARI,
};

const KURALLAR: Record<Adim, string[]> = {
  cari: ["Eşleşen kartta yalnız dolu hücreler yazılır; boş hücre mevcut değeri silmez.", "Açılış tarihi boşsa sihirbazdaki geçiş tarihi kullanılır."],
  stok: ["Eşleşen kartta yalnız dolu hücreler yazılır.", "Güncellenen kartlar aktarım geri alınsa da eski haline dönmez."],
  acilis_stok: ["Stok kartları önce açılmış olmalı.", "Kartta açılış tarihinden önce hareket varsa satır reddedilir.", "Aynı kart, varyant ve depo için ikinci açılış yazılmaz."],
  kasa_banka: ["Hesaplar önce Kasa & Banka ekranında açılmış olmalı; sihirbaz hesap açmaz.", "Açılışı olan hesap sihirbazdan değiştirilmez."],
  acik_fatura: ["Cari kartlar önce açılmış olmalı.", "Toplam açılış bakiyesi girilmiş caride açık fatura girilmez (ya toplam ya belge bazında).", "Fatura oluşmaz; stok, KDV, e-Belge ve muhasebe aktarımı etkilenmez."],
};

interface Plan { satirlar: SatirSonucu[]; tablo: Pick<OkunanTablo, "basliklar" | "taninmayanlar"> }

/**
 * VAK-01…09: veri aktarım sihirbazı. Her adım aynı akışı izler: dosya başlığa göre okunur,
 * satırlar önizlenir, onayda dosya yeniden doğrulanır ve hatasız satırlar tek işlemde yazılır.
 * Her uygulama bir partidir; yönetici partiyi geri alabilir.
 */
@Injectable()
export class VeriAktarimiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ayarlar: AyarlarService,
    private readonly donemKilidi: DonemKilidiService,
    private readonly cari: CariIceAktarmaService,
    private readonly stok: StokService,
    private readonly kasaBanka: KasaBankaService,
    @Optional() private readonly mevzuat?: MevzuatService,
  ) {}

  // ─── Durum ve geçiş tarihi ─────────────────────────────────────────────

  async gecisTarihi(tx?: Tx): Promise<string | null> {
    const a = await this.ayarlar.getir(VERI_AKTARIMI_MODULU, tx);
    return (a.gecisTarihi as string | null) ?? null;
  }

  async gecisTarihiKaydet(tarih: string) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, tarih, "geçiş tarihi seçme");
    await this.ayarlar.guncelle(VERI_AKTARIMI_MODULU, { gecisTarihi: tarih });
    return { gecisTarihi: tarih };
  }

  async durum() {
    const { tenantId } = aktifBaglam();
    const [gecisTarihi, partiler] = await Promise.all([
      this.gecisTarihi(),
      this.prisma.tenantIslem(tenantId, (tx) => tx.veriAktarimi.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, adim: true, dosyaAdi: true, ozet: true, kullaniciId: true, createdAt: true, geriAlindiAt: true } })),
    ]);
    return {
      gecisTarihi,
      adimlar: (Object.keys(ADIM_ADLARI) as Adim[]).map((a) => ({ adim: a, ad: ADIM_ADLARI[a], alanlar: SUTUNLAR[a].map((s) => ({ anahtar: s.anahtar, baslik: s.baslik, aciklama: s.aciklama })) })),
      partiler: partiler.map((p) => ({ ...p, adimAdi: ADIM_ADLARI[p.adim as Adim] ?? p.adim })),
    };
  }

  // ─── Şablon, önizleme, hatalı satırlar, uygulama ───────────────────────

  async sablon(adim: Adim): Promise<Buffer> {
    if (adim === "cari") return cariSablonu();
    return sablonYaz(ADIM_ADLARI[adim], SUTUNLAR[adim], KURALLAR[adim]);
  }

  async onizle(adim: Adim, buffer: Buffer, eslemeler: BaslikEslemeleri) {
    const { satirlar, tablo } = await this.planla(adim, buffer, eslemeler);
    return {
      ozet: ozetle(satirlar),
      basliklar: tablo.basliklar,
      taninmayanlar: tablo.taninmayanlar,
      satirlar: satirlar.slice(0, ONIZLEME_SATIRI),
      kirpildi: satirlar.length > ONIZLEME_SATIRI,
    };
  }

  async hataliSatirlar(adim: Adim, buffer: Buffer, eslemeler: BaslikEslemeleri): Promise<Buffer> {
    if (adim === "cari") return this.cari.hataliSatirlar(buffer, { eslemeler, varsayilanAcilisTarihi: await this.gecisTarihi() });
    const tablo = await this.oku(adim, buffer, eslemeler);
    const { satirlar } = await this.planla(adim, buffer, eslemeler);
    const hatali = new Map(satirlar.filter((s) => s.durum === "hatali").map((s) => [s.satir, s.hatalar]));
    return hataliSatirlarYaz(SUTUNLAR[adim], tablo.satirlar.filter((s) => hatali.has(s.satir)).map((s) => ({ ...s, hatalar: hatali.get(s.satir)! })));
  }

  async uygula(adim: Adim, buffer: Buffer, dosyaAdi: string, eslemeler: BaslikEslemeleri) {
    const { tenantId, userId } = aktifBaglam();
    const gecis = await this.gecisTarihi();
    const partiId = randomUUID();
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const olusturulanlar = bosOlusturulanlar();
      if (adim === "cari") {
        const r = await this.cari.iceAktar(buffer, { eslemeler, varsayilanAcilisTarihi: gecis }, tx);
        if (!r.yeni && !r.guncelle) throw new BadRequestException("Yazılacak hatasız satır yok");
        olusturulanlar.cariler = r.olusturulanlar.cariler;
        olusturulanlar.cariHareketler = r.olusturulanlar.cariHareketler;
        const ozet = { toplam: r.toplam, yeni: r.yeni, guncelle: r.guncelle, degisiklikYok: r.degisiklikYok, hatali: r.hatali };
        return this.partiYaz(tx, { partiId, tenantId, userId, adim, dosyaAdi, ozet, olusturulanlar });
      }
      const tablo = await this.oku(adim, buffer, eslemeler);
      const satirlar = await this.satirlariPlanla(tx, tenantId, adim, tablo.satirlar, gecis);
      const yazilacak = satirlar.filter((s) => s.durum === "yeni" || s.durum === "guncelle");
      if (!yazilacak.length) throw new BadRequestException("Yazılacak hatasız satır yok");
      if (adim === "stok") {
        olusturulanlar.stoklar = await stokYaz(tx, tenantId, satirlar as Awaited<ReturnType<typeof stokPlanla>>);
      } else if (adim === "acilis_stok") {
        for (const p of satirlar as Awaited<ReturnType<typeof acilisStokPlanla>>) {
          if (!p.hareket) continue;
          const h = p.hareket;
          const r = await this.stok.hareketEkle(tx, {
            stokId: h.stokId, varyantId: h.varyantId, depoId: h.depoId, tip: "acilis", miktar: h.miktar, girilenBirim: h.anaBirim, girilenMiktar: h.miktar,
            birimMaliyet: h.birimMaliyet, tarih: new Date(h.tarih), aciklama: "Açılış stoğu (veri aktarımı)", kaynakTur: "veri_aktarimi", kaynakRef: partiId,
            partiler: h.parti ? [{ lotNo: h.parti.lotNo, seriNo: h.parti.seriNo, sonKullanmaTarihi: h.parti.sonKullanmaTarihi, miktar: h.miktar }] : undefined,
          });
          olusturulanlar.stokHareketleri.push((r.hareket as { id: string }).id);
        }
      } else if (adim === "kasa_banka") {
        for (const p of satirlar as Awaited<ReturnType<typeof kasaBankaPlanla>>) {
          if (!p.acilis) continue;
          const a = p.acilis;
          const h = await this.kasaBanka.acilisYazIslemde(tx, a.tur, a.hesapId, { tutar: a.tutar, tarih: a.tarih, kur: a.kur, aciklama: a.aciklama ?? "Açılış bakiyesi (veri aktarımı)" });
          olusturulanlar.kasaBankaHareketleri.push(h.id);
        }
      } else if (adim === "acik_fatura") {
        for (const p of satirlar as Awaited<ReturnType<typeof acikFaturaPlanla>>) {
          if (!p.hareket) continue;
          const h = p.hareket;
          const k = await tx.cariHareket.create({
            select: { id: true },
            data: {
              tenantId, cariId: h.cariId, tip: h.tip, tutar: h.tutar, dovizCinsi: h.dovizCinsi as Prisma.CariHareketCreateInput["dovizCinsi"], kur: h.kur,
              tutarTry: h.tutar.mul(h.kur).toDecimalPlaces(2), tarih: new Date(gecis!), vadeTarihi: new Date(h.vade), aciklama: h.aciklama, kaynakTur: "acilis", kaynakRef: partiId,
            },
          });
          olusturulanlar.cariHareketler.push(k.id);
        }
      }
      return this.partiYaz(tx, { partiId, tenantId, userId, adim, dosyaAdi, ozet: ozetle(satirlar), olusturulanlar });
    }, { timeout: ISLEM_SURESI_MS });
    return sonuc;
  }

  private async partiYaz(tx: Tx, p: { partiId: string; tenantId: string; userId?: string | null; adim: Adim; dosyaAdi: string; ozet: Record<string, number>; olusturulanlar: Olusturulanlar }) {
    await tx.veriAktarimi.create({
      data: {
        id: p.partiId, tenantId: p.tenantId, adim: p.adim, dosyaAdi: p.dosyaAdi.slice(0, 255), ozet: p.ozet as Prisma.InputJsonValue,
        olusturulanlar: p.olusturulanlar as unknown as Prisma.InputJsonValue, kullaniciId: p.userId ?? null,
      },
    });
    return { partiId: p.partiId, ozet: p.ozet };
  }

  private async oku(adim: Adim, buffer: Buffer, eslemeler: BaslikEslemeleri) {
    try {
      return await tabloOku(buffer, SUTUNLAR[adim], eslemeler);
    } catch (hata) {
      throw new BadRequestException(hata instanceof Error ? hata.message : "Dosya okunamadı");
    }
  }

  private async planla(adim: Adim, buffer: Buffer, eslemeler: BaslikEslemeleri): Promise<Plan> {
    const { tenantId } = aktifBaglam();
    const gecis = await this.gecisTarihi();
    if (adim === "cari") {
      const r = await this.cari.onizleme(buffer, { eslemeler, varsayilanAcilisTarihi: gecis });
      return {
        tablo: { basliklar: r.basliklar as OkunanTablo["basliklar"], taninmayanlar: r.taninmayanlar },
        satirlar: r.satirlar.map((s) => ({
          satir: s.satir, durum: s.durum, etiket: s.kod, aciklama: s.unvan, hatalar: s.hatalar,
          uyarilar: [...s.uyarilar, ...(s.durum === "guncelle" ? [`Değişecek: ${s.degisenAlanlar.join(", ")} (güncelleme geri alınamaz)`] : [])],
        })),
      };
    }
    const tablo = await this.oku(adim, buffer, eslemeler);
    if (!tablo.satirlar.length) throw new BadRequestException("Dosyada başlık satırından sonra veri yok");
    const satirlar = await this.prisma.tenantIslem(tenantId, (tx) => this.satirlariPlanla(tx, tenantId, adim, tablo.satirlar, gecis), { timeout: ISLEM_SURESI_MS });
    return { satirlar, tablo };
  }

  private async satirlariPlanla(tx: Tx, tenantId: string, adim: Exclude<Adim, "cari">, satirlar: TabloSatiri[], gecis: string | null): Promise<SatirSonucu[]> {
    const tarihDenetle = async (tarih: string) => {
      try { await this.donemKilidi.tarihDogrula(tenantId, tarih, "açılış kaydı", tx); return null; } catch (e) { return e instanceof Error ? e.message : "Mali dönem kapalı"; }
    };
    if (adim === "stok") {
      const kdvDenetle = async (oran: number) => {
        try { await this.mevzuat?.kdvOranlariniDogrula([oran], new Date()); return null; } catch (e) { return e instanceof Error ? e.message : "KDV oranı geçersiz"; }
      };
      return stokPlanla(tx, satirlar as TabloSatiri<never>[], kdvDenetle);
    }
    if (adim === "acilis_stok") return acilisStokPlanla(tx, satirlar as TabloSatiri<never>[], gecis, tarihDenetle);
    if (adim === "kasa_banka") {
      const kurVarMi = async (doviz: string, tarih: string) => Boolean(await kurCoz(tx, tenantId, doviz, new Date(tarih), GIRIS_KUR_TIPI));
      return kasaBankaPlanla(tx, satirlar as TabloSatiri<never>[], gecis, tarihDenetle, kurVarMi);
    }
    if (!gecis) throw new BadRequestException("Açık faturalar için önce geçiş tarihini seçin");
    const donem = await tarihDenetle(gecis);
    if (donem) throw new BadRequestException(donem);
    const kurBul = (doviz: string, tarih: string, yon: "borc" | "alacak") => kurCoz(tx, tenantId, doviz, new Date(tarih), cariHareketKurTipi(yon));
    return acikFaturaPlanla(tx, satirlar as TabloSatiri<never>[], gecis, kurBul);
  }

  // ─── Geri alma (VAK-07) ────────────────────────────────────────────────

  async geriAl(partiId: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Aynı partinin iki kez geri alınmasını satır kilidi önler.
      await tx.$queryRaw`SELECT id FROM veri_aktarimlari WHERE id = ${partiId}::uuid FOR UPDATE`;
      const parti = await tx.veriAktarimi.findUnique({ where: { id: partiId } });
      if (!parti) throw new NotFoundException("Aktarım bulunamadı");
      if (parti.geriAlindiAt) throw new ConflictException("Bu aktarım zaten geri alındı");
      const o = { ...bosOlusturulanlar(), ...(parti.olusturulanlar as Partial<Olusturulanlar>) };
      const engeller = await this.geriAlmaEngelleri(tx, o);
      if (engeller.length) throw new BadRequestException(`Aktarım geri alınamaz: ${engeller.slice(0, 10).join("; ")}${engeller.length > 10 ? ` (+${engeller.length - 10})` : ""}`);
      const neden = `Veri aktarımı geri alındı (${ADIM_ADLARI[parti.adim as Adim] ?? parti.adim}, ${parti.dosyaAdi})`;

      // 1) Açılış cari hareketleri (CARI-28: elle açılış silinebilir).
      if (o.cariHareketler.length) {
        const hareketler = await tx.cariHareket.findMany({ where: { id: { in: o.cariHareketler } }, select: { id: true, tarih: true } });
        for (const t of new Set(hareketler.map((h) => h.tarih.toISOString().slice(0, 10)))) await this.donemKilidi.tarihDogrula(tenantId, t, "açılış bakiyesi silme", tx);
        await tx.cariHareket.deleteMany({ where: { id: { in: hareketler.map((h) => h.id) } } });
      }
      // 2) Kasa/banka açılışları.
      for (const id of o.kasaBankaHareketleri) await this.kasaBanka.acilisSilIslemde(tx, id, neden);
      // 3) Açılış stoğu: stok hareketi değişmez kayıttır, ters hareketle sıfırlanır.
      if (o.stokHareketleri.length) {
        const hareketler = await tx.stokHareket.findMany({
          where: { id: { in: o.stokHareketleri } },
          select: { id: true, stokId: true, varyantId: true, depoId: true, miktar: true, girilenBirim: true, maliyet: true, tarih: true, partiler: { select: { miktar: true, parti: { select: { lotNo: true, seriNo: true, sonKullanmaTarihi: true } } } } },
        });
        for (const h of hareketler) {
          await this.stok.hareketEkle(tx, {
            stokId: h.stokId, varyantId: h.varyantId, depoId: h.depoId, tip: "cikis", miktar: h.miktar.abs(), girilenBirim: h.girilenBirim, girilenMiktar: h.miktar.abs(),
            birimMaliyet: h.maliyet, maliyetliCikis: true, tarih: h.tarih, aciklama: "Açılış stoğu geri alındı (veri aktarımı)", kaynakTur: "veri_aktarimi_geri", kaynakRef: partiId,
            ...(h.partiler.length ? { partiSecimi: "belirtilen" as const, partiler: h.partiler.map((p) => ({ lotNo: p.parti.lotNo, seriNo: p.parti.seriNo, sonKullanmaTarihi: p.parti.sonKullanmaTarihi?.toISOString().slice(0, 10) ?? null, miktar: p.miktar.abs() })) } : {}),
          });
        }
      }
      // 4) Kartlar: hareketi kalmayan kart silinir; geri alınmış açılışı olan kart silinemez, pasife alınır.
      const pasif: string[] = [];
      for (const id of o.stoklar) {
        const hareketVar = await tx.stokHareket.count({ where: { stokId: id } });
        if (hareketVar) { await tx.stokKart.update({ where: { id }, data: { aktif: false } }); pasif.push(id); }
        else await tx.stokKart.delete({ where: { id } });
      }
      if (o.cariler.length) await tx.cariHesap.deleteMany({ where: { id: { in: o.cariler } } });
      await tx.veriAktarimi.update({ where: { id: partiId }, data: { geriAlindiAt: new Date(), geriAlanId: userId ?? null } });
      return { geriAlindi: true, pasifeAlinanStok: pasif.length };
    }, { timeout: ISLEM_SURESI_MS });
  }

  /** Partinin kayıtlarına sonradan başka işlem yapılmışsa geri alma reddedilir. */
  private async geriAlmaEngelleri(tx: Tx, o: Olusturulanlar): Promise<string[]> {
    const engeller: string[] = [];
    if (o.cariHareketler.length) {
      const kapali = await tx.faturaKapama.count({ where: { cariHareketId: { in: o.cariHareketler } } });
      if (kapali) engeller.push(`${kapali} açılış kalemi bir kapamaya bağlı`);
    }
    if (o.cariler.length) {
      const [hareket, fatura, belge, kasa] = await Promise.all([
        tx.cariHareket.groupBy({ by: ["cariId"], where: { cariId: { in: o.cariler }, id: { notIn: o.cariHareketler } }, _count: { _all: true } }),
        tx.fatura.groupBy({ by: ["cariId"], where: { cariId: { in: o.cariler } }, _count: { _all: true } }),
        tx.belge.groupBy({ by: ["cariId"], where: { cariId: { in: o.cariler } }, _count: { _all: true } }),
        tx.kasaBankaHareket.groupBy({ by: ["cariId"], where: { cariId: { in: o.cariler } }, _count: { _all: true } }),
      ]);
      const kullanilan = new Set([...hareket, ...fatura, ...belge, ...kasa].map((x) => x.cariId).filter(Boolean) as string[]);
      if (kullanilan.size) {
        const adlar = await tx.cariHesap.findMany({ where: { id: { in: [...kullanilan] } }, select: { kod: true }, take: 10 });
        engeller.push(`${kullanilan.size} cari kartta sonradan işlem var (${adlar.map((a) => a.kod).join(", ")})`);
      }
    }
    if (o.stokHareketleri.length || o.stoklar.length) {
      const acilislar = o.stokHareketleri.length ? await tx.stokHareket.findMany({ where: { id: { in: o.stokHareketleri } }, select: { stokId: true } }) : [];
      const kartlar = [...new Set([...o.stoklar, ...acilislar.map((a) => a.stokId)])];
      // Geri alınmış partilerin açılışı ve onun tersi engel sayılmaz (ikisi birbirini sıfırlar).
      const geriAlinmis = (await tx.veriAktarimi.findMany({ where: { adim: "acilis_stok", geriAlindiAt: { not: null } }, select: { id: true } })).map((p) => p.id);
      const baska = await tx.stokHareket.groupBy({
        by: ["stokId"],
        where: {
          stokId: { in: kartlar }, id: { notIn: o.stokHareketleri }, kaynakTur: { not: "veri_aktarimi_geri" },
          NOT: { kaynakTur: "veri_aktarimi", kaynakRef: { in: geriAlinmis } },
        },
        _count: { _all: true },
      });
      const satir = await Promise.all([
        tx.faturaSatir.groupBy({ by: ["stokId"], where: { stokId: { in: o.stoklar } }, _count: { _all: true } }),
        tx.belgeSatir.groupBy({ by: ["stokId"], where: { stokId: { in: o.stoklar } }, _count: { _all: true } }),
      ]);
      const kullanilan = new Set([...baska.map((b) => b.stokId), ...satir.flat().map((x) => x.stokId)].filter(Boolean) as string[]);
      if (kullanilan.size) {
        const adlar = await tx.stokKart.findMany({ where: { id: { in: [...kullanilan] } }, select: { kod: true }, take: 10 });
        engeller.push(`${kullanilan.size} stok kartında sonradan hareket ya da belge var (${adlar.map((a) => a.kod).join(", ")})`);
      }
    }
    return engeller;
  }

  // ─── Kontrol özeti (VAK-08) ────────────────────────────────────────────

  async kontrolOzeti() {
    const { tenantId } = aktifBaglam();
    const gecis = await this.gecisTarihi();
    const sinir = gecis ? new Date(gecis) : new Date();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [cari, cariSayisi, stokKartlari, kasaBanka, kasalar, bankalar] = await Promise.all([
        tx.cariHareket.groupBy({ by: ["dovizCinsi", "tip"], where: { tarih: { lte: sinir } }, _sum: { tutar: true, tutarTry: true } }),
        tx.cariHesap.count(),
        tx.stokKart.findMany({ where: { tip: "urun", aktif: true }, select: { mevcutMiktar: true, ortalamaMaliyet: true } }),
        tx.kasaBankaHareket.groupBy({ by: ["kasaId", "bankaHesapId", "dovizCinsi", "tip"], where: { tarih: { lte: sinir }, OR: [{ kasaId: { not: null } }, { bankaHesapId: { not: null } }] }, _sum: { tutar: true } }),
        tx.kasa.findMany({ select: { id: true, ad: true } }),
        tx.bankaHesap.findMany({ select: { id: true, ad: true } }),
      ]);
      const dovizler = [...new Set(cari.map((c) => c.dovizCinsi))].sort();
      const cariOzet = dovizler.map((d) => {
        const t = (tip: string) => cari.find((c) => c.dovizCinsi === d && c.tip === tip)?._sum;
        const borc = t("borc")?.tutar ?? D(0), alacak = t("alacak")?.tutar ?? D(0);
        return { dovizCinsi: d, borc: borc.toFixed(2), alacak: alacak.toFixed(2), bakiye: borc.sub(alacak).toFixed(2) };
      });
      const stokDegeri = stokKartlari.reduce((t, k) => t.add(D(k.mevcutMiktar).mul(k.ortalamaMaliyet)), D(0));
      const adlar = new Map([...kasalar.map((k) => [k.id, k.ad] as const), ...bankalar.map((b) => [b.id, b.ad] as const)]);
      const hesaplar = new Map<string, { ad: string; dovizCinsi: string; bakiye: Prisma.Decimal }>();
      for (const k of kasaBanka) {
        const id = (k.kasaId ?? k.bankaHesapId)!;
        const satir = hesaplar.get(id) ?? { ad: adlar.get(id) ?? id, dovizCinsi: k.dovizCinsi, bakiye: D(0) };
        const giris = k.tip === "tahsilat" || k.tip === "virman_gelis";
        satir.bakiye = giris ? satir.bakiye.add(k._sum.tutar ?? 0) : satir.bakiye.sub(k._sum.tutar ?? 0);
        hesaplar.set(id, satir);
      }
      return {
        tarih: gecis,
        cari: { kartSayisi: cariSayisi, dovizler: cariOzet },
        stok: { kalemSayisi: stokKartlari.filter((k) => !D(k.mevcutMiktar).isZero()).length, deger: stokDegeri.toFixed(2), not: "Stok değeri bugünkü miktar ve ortalama maliyettir" },
        kasaBanka: [...hesaplar.values()].map((h) => ({ ad: h.ad, dovizCinsi: h.dovizCinsi, bakiye: h.bakiye.toFixed(2) })).sort((a, b) => a.ad.localeCompare(b.ad, "tr")),
      };
    });
  }

  async kontrolOzetiExcel(): Promise<Buffer> {
    const o = await this.kontrolOzeti();
    const kitap = new ExcelJS.Workbook();
    const c = kitap.addWorksheet("Cari");
    c.columns = [{ header: "Döviz", key: "dovizCinsi", width: 10 }, { header: "Borç", key: "borc", width: 18 }, { header: "Alacak", key: "alacak", width: 18 }, { header: "Bakiye (borç − alacak)", key: "bakiye", width: 22 }];
    for (const d of o.cari.dovizler) c.addRow({ ...d, borc: Number(d.borc), alacak: Number(d.alacak), bakiye: Number(d.bakiye) });
    const k = kitap.addWorksheet("Kasa ve banka");
    k.columns = [{ header: "Hesap", key: "ad", width: 30 }, { header: "Döviz", key: "dovizCinsi", width: 10 }, { header: "Bakiye", key: "bakiye", width: 18 }];
    for (const h of o.kasaBanka) k.addRow({ ...h, bakiye: Number(h.bakiye) });
    const s = kitap.addWorksheet("Stok");
    s.addRows([["Stoklu kalem", o.stok.kalemSayisi], ["Stok değeri (TL)", Number(o.stok.deger)], ["Not", o.stok.not]]);
    for (const sayfa of [c, k]) sayfa.getRow(1).font = { bold: true };
    const bilgi = kitap.addWorksheet("Bilgi");
    bilgi.addRows([["Geçiş tarihi", o.tarih ?? "seçilmedi"], ["Cari kart sayısı", o.cari.kartSayisi], ["Açıklama", "Cari ve kasa/banka geçiş tarihi itibarıyla; eski programın mizanıyla karşılaştırın."]]);
    return Buffer.from(await kitap.xlsx.writeBuffer());
  }
}
