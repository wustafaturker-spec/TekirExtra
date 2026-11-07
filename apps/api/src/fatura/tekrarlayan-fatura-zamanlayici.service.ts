import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { BildirimService } from "../bildirimler/bildirim.service";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { aktifBaglam, baglamlaCalistir } from "../core/istek-baglami";
import { nabizla } from "../core/nabiz/nabiz";
import { PrismaService } from "../core/prisma.service";
import { AbonelikService } from "../tenant/abonelik.service";
import { FaturaService } from "./fatura.service";

const BIR_GUN_MS = 24 * 60 * 60 * 1000;
const ISTANBUL_UTC_FARKI_MS = 3 * 60 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";
const NABIZ_ADI = "tekrarlayan-fatura-zamanlayici";

/** Bir sonraki İstanbul saati 00:15 çalışmasına kalan süre. */
export function sonrakiGunlukKontrolMs(simdiMs = Date.now()): number {
  const istanbul = new Date(simdiMs + ISTANBUL_UTC_FARKI_MS);
  let hedefMs = Date.UTC(istanbul.getUTCFullYear(), istanbul.getUTCMonth(), istanbul.getUTCDate(), 0, 15) - ISTANBUL_UTC_FARKI_MS;
  if (hedefMs <= simdiMs) hedefMs += BIR_GUN_MS;
  return hedefMs - simdiMs;
}

/** İstanbul takvim gününün UTC başlangıcı ve YYYY-AA-GG anahtarı. */
export function istanbulGunu(simdiMs = Date.now()): { baslangic: Date; anahtar: string } {
  const istanbul = new Date(simdiMs + ISTANBUL_UTC_FARKI_MS);
  const baslangicMs = Date.UTC(istanbul.getUTCFullYear(), istanbul.getUTCMonth(), istanbul.getUTCDate()) - ISTANBUL_UTC_FARKI_MS;
  return { baslangic: new Date(baslangicMs), anahtar: istanbul.toISOString().slice(0, 10) };
}

export interface FirmaUretimSonucu { uretilenAdet: number; kotaDoldu: boolean; hata?: string }

/**
 * FTR-43: FTR-10 planlarını worker'da her gün kendiliğinden üretir. Yalnız
 * taslak açılır; kesinleştirme kullanıcıdadır.
 */
@Injectable()
export class TekrarlayanFaturaZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TekrarlayanFaturaZamanlayiciService.name);
  private ilkGunlukKontrol?: NodeJS.Timeout;
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly faturalar: FaturaService,
    private readonly abonelik: AbonelikService,
    private readonly bildirimler: BildirimService,
    @Optional() private readonly erisim?: AbonelikErisimService,
  ) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    // Açılış çalışması worker kapalıyken kaçan günleri telafi eder.
    setImmediate(() => void nabizla(NABIZ_ADI, () => this.calistir()));
    this.ilkGunlukKontrol = setTimeout(() => {
      void nabizla(NABIZ_ADI, () => this.calistir());
      this.zamanlayici = setInterval(() => void nabizla(NABIZ_ADI, () => this.calistir(), BIR_GUN_MS), BIR_GUN_MS);
    }, sonrakiGunlukKontrolMs());
    this.logger.log("Tekrarlayan fatura üretimi her gün İstanbul saatiyle 00:15 için planlandı");
  }

  onModuleDestroy(): void {
    if (this.ilkGunlukKontrol) clearTimeout(this.ilkGunlukKontrol);
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  private async tenantIdleriAl(): Promise<string[]> {
    const yonetimUrl = process.env.DATABASE_URL_MIGRATE;
    if (!yonetimUrl) throw new Error("Tekrarlayan fatura üretimi için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: yonetimUrl });
    try {
      // Yalnız aktif planı olan firmalar taranır; geri kalanlar için firma bağlamı açmaya gerek yok.
      const satirlar = await yonetim.tekrarlayanFatura.findMany({ where: { aktif: true }, select: { tenantId: true }, distinct: ["tenantId"] });
      return satirlar.map((s) => s.tenantId);
    } finally { await yonetim.$disconnect(); }
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      let toplam = 0;
      for (const tenantId of await this.tenantIdleriAl()) {
        // PLT-05: askıdaki ya da paketinde fatura olmayan firmada üretim yapılmaz; açılınca eksikler tamamlanır.
        if (await this.erisim?.otomasyonDurdu(tenantId, "fatura")) continue;
        const sonuc = await this.firmaIcinUret(tenantId);
        toplam += sonuc.uretilenAdet;
      }
      if (toplam) this.logger.log(`${toplam} tekrarlayan fatura taslağı otomatik oluşturuldu`);
      else this.logger.debug("Tekrarlayan faturalar güncel");
    } catch (hata) {
      this.logger.error("Tekrarlayan fatura üretimi başarısız", hata instanceof Error ? hata.stack : String(hata));
    } finally { this.calisiyor = false; }
  }

  /** Tek firmanın üretimi; hata firmaya bildirilir, diğer firmaları durdurmaz. */
  async firmaIcinUret(tenantId: string, simdiMs = Date.now()): Promise<FirmaUretimSonucu> {
    const gun = istanbulGunu(simdiMs);
    return baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, async () => {
      try {
        const kota = await this.abonelik.kalanLimit("aylikFatura");
        const sonuc = kota.kalan === 0
          ? { uretilenAdet: 0, kotaDoldu: true, kursuzlar: [], fiyatUyarilari: [] }
          : await this.faturalar.vadesiGelenleriUret({ kalanKota: kota.kalan });
        if (sonuc.uretilenAdet) await this.uretimiBildir(gun);
        if (sonuc.kotaDoldu) await this.kotayiBildir(gun, kota.planAdi, kota.limit);
        for (const k of sonuc.kursuzlar ?? []) await this.kursuzuBildir(k);
        for (const u of sonuc.fiyatUyarilari ?? []) await this.fiyatUyarisiBildir(u);
        return { uretilenAdet: sonuc.uretilenAdet, kotaDoldu: sonuc.kotaDoldu };
      } catch (hata) {
        const mesaj = hata instanceof Error ? hata.message : String(hata);
        // Nabız hatası sayılmaz (warn): sorun firmaya özgüdür ve firmaya bildirilir.
        this.logger.warn(`${tenantId}: tekrarlayan fatura üretilemedi: ${mesaj}`);
        await this.guvenliBildir(() => this.bildirimler.uret({
          tur: "donem",
          onem: "uyari",
          baslik: "Tekrarlayan faturalar üretilemedi",
          aciklama: `Bugünkü otomatik üretim hata verdi: ${mesaj.slice(0, 300)}. Tekrarlayan Faturalar ekranından "Şimdi üret" ile yeniden deneyebilirsiniz; üretim yarın da kendiliğinden denenir.`,
          birlesimAnahtari: `tekrarlayan-fatura-hata:${gun.anahtar}`,
          kaynakTur: "tekrarlayan_fatura",
          hedefYol: "/panel/fatura/tekrarlayan",
          roller: ["yonetici", "muhasebe"],
        }));
        return { uretilenAdet: 0, kotaDoldu: false, hata: mesaj };
      }
    });
  }

  /**
   * Günlük tek bildirim: aynı gün ikinci çalışma (açılış + 00:15) yeni bildirim
   * açmaz, sayıyı günün toplamıyla günceller.
   */
  private async uretimiBildir(gun: { baslangic: Date; anahtar: string }) {
    const { tenantId } = aktifBaglam();
    const gunlukAdet = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.count({
      where: { tekrarlayanPlanId: { not: null }, durum: "taslak", createdAt: { gte: gun.baslangic } },
    }));
    await this.guvenliBildir(() => this.bildirimler.uret({
      tur: "donem",
      onem: "bilgi",
      baslik: `${gunlukAdet} tekrarlayan fatura taslağı oluştu`,
      aciklama: "Tekrarlayan fatura planlarından bugün taslak faturalar oluşturuldu. Kontrol edip kesinleştirin; kesinleşmeden stok ve cari etkisi doğmaz.",
      birlesimAnahtari: `tekrarlayan-fatura-uretim:${gun.anahtar}`,
      kaynakTur: "tekrarlayan_fatura",
      hedefYol: "/panel/fatura?durum=taslak",
      roller: ["yonetici", "muhasebe"],
    }));
  }

  private async kotayiBildir(gun: { anahtar: string }, planAdi: string, limit: number | null) {
    await this.guvenliBildir(() => this.bildirimler.uret({
      tur: "donem",
      onem: "uyari",
      baslik: "Fatura kotası doldu, tekrarlayan faturalar bekliyor",
      aciklama: `${planAdi} planının aylık ${limit ?? ""} fatura limiti doldu; bazı tekrarlayan faturalar üretilemedi. Planlar bekleyen dönemde kalır; kota açılınca (yeni ay ya da plan yükseltme) eksik dönemler kendiliğinden üretilir.`,
      birlesimAnahtari: `tekrarlayan-fatura-kota:${gun.anahtar}`,
      kaynakTur: "tekrarlayan_fatura",
      hedefYol: "/panel/fatura/tekrarlayan",
      roller: ["yonetici", "muhasebe"],
    }));
  }

  /** FTR-45: kuru olmayan dövizli dönem üretilmez; bildirim plan başına tektir, kur gelince üretilir. */
  private async kursuzuBildir(k: { planId: string; ad: string; dovizCinsi: string; tarih: string }) {
    await this.guvenliBildir(() => this.bildirimler.uret({
      tur: "donem",
      onem: "uyari",
      baslik: "Kur bulunamadığı için tekrarlayan fatura bekliyor",
      aciklama: `${k.ad}: ${k.tarih} dönemi için ${k.dovizCinsi} kuru bulunamadı (en fazla 10 gün geriye bakıldı). Ayarlar > Döviz Kurları ekranından kuru çekin ya da elle girin; taslak sonraki taramada oluşur.`,
      birlesimAnahtari: `tekrarlayan-fatura-kur:${k.planId}:${k.tarih}`,
      kaynakTur: "tekrarlayan_fatura",
      kaynakRef: k.planId,
      hedefYol: "/panel/ayarlar/doviz-kurlari",
      roller: ["yonetici", "muhasebe"],
    }));
  }

  /** FTR-45: güncel fiyatı bulunamayan satır şablon fiyatıyla kalır; kullanıcı kesinleştirmeden bakmalı. */
  private async fiyatUyarisiBildir(u: { planId: string; ad: string; faturaId: string; sorunlar: string[] }) {
    await this.guvenliBildir(() => this.bildirimler.uret({
      tur: "donem",
      onem: "uyari",
      baslik: "Tekrarlayan faturada bazı fiyatlar güncellenemedi",
      aciklama: `${u.ad}: şu satırlar şablon fiyatıyla bırakıldı, kesinleştirmeden önce kontrol edin. ${u.sorunlar.slice(0, 10).join("; ")}${u.sorunlar.length > 10 ? ` (+${u.sorunlar.length - 10} satır)` : ""}`.slice(0, 1500),
      birlesimAnahtari: `tekrarlayan-fatura-fiyat:${u.faturaId}`,
      kaynakTur: "fatura",
      kaynakRef: u.faturaId,
      hedefYol: `/panel/fatura?ac=${u.faturaId}`,
      roller: ["yonetici", "muhasebe"],
    }));
  }

  private async guvenliBildir(is: () => Promise<unknown>) {
    try { await is(); }
    catch (hata) { this.logger.warn(`Tekrarlayan fatura bildirimi üretilemedi: ${hata instanceof Error ? hata.message : String(hata)}`); }
  }
}
