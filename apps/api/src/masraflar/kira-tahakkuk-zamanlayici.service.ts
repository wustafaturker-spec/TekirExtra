import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { Prisma, PrismaClient } from "@prisma/client";
import { BildirimService } from "../bildirimler/bildirim.service";
import { baglamlaCalistir } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DovizService } from "../doviz/doviz.service";
import { KUR_GERI_BAKIS_GUN, kurCoz } from "../doviz/kur-coz";
import { nabizla } from "../core/nabiz/nabiz";

const BIR_GUN_MS = 24 * 60 * 60 * 1000;
const ISTANBUL_UTC_FARKI_MS = 3 * 60 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

/** Bir sonraki İstanbul saati 00:05 çalışmasına kalan süre. */
function sonrakiGunlukKontrolMs(simdiMs = Date.now()): number {
  const istanbul = new Date(simdiMs + ISTANBUL_UTC_FARKI_MS);
  let hedefMs = Date.UTC(istanbul.getUTCFullYear(), istanbul.getUTCMonth(), istanbul.getUTCDate(), 0, 5) - ISTANBUL_UTC_FARKI_MS;
  if (hedefMs <= simdiMs) hedefMs += BIR_GUN_MS;
  return hedefMs - simdiMs;
}

const ayBasi = (tarih: Date) => new Date(Date.UTC(tarih.getUTCFullYear(), tarih.getUTCMonth(), 1));
const sonrakiAy = (tarih: Date) => new Date(Date.UTC(tarih.getUTCFullYear(), tarih.getUTCMonth() + 1, 1));

type Sozlesme = {
  baslangicTarihi: Date;
  bitisTarihi: Date | null;
  masraflar: { kiraDonemi: Date | null }[];
};

/** Sözleşmenin henüz tahakkuk etmemiş dönemleri (ayın ilk günü). */
function eksikDonemler(s: Sozlesme, mevcutDonem: Date): Date[] {
  const mevcut = new Set(s.masraflar.map((m) => m.kiraDonemi?.toISOString().slice(0, 7)));
  const bitis = s.bitisTarihi ? ayBasi(s.bitisTarihi) : mevcutDonem;
  const sonDonem = bitis < mevcutDonem ? bitis : mevcutDonem;
  const donemler: Date[] = [];
  for (let donem = ayBasi(s.baslangicTarihi); donem <= sonDonem; donem = sonrakiAy(donem)) {
    if (!mevcut.has(donem.toISOString().slice(0, 7))) donemler.push(donem);
  }
  return donemler;
}

/** Worker içinde aktif sözleşmelerin eksik aylık tahakkuklarını tamamlar. */
@Injectable()
export class KiraTahakkukZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KiraTahakkukZamanlayiciService.name);
  private ilkGunlukKontrol?: NodeJS.Timeout;
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly doviz: DovizService,
    private readonly bildirimler: BildirimService,
    @Optional() private readonly erisim?: AbonelikErisimService,
  ) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void nabizla("kira-tahakkuk-zamanlayici", () => this.calistir()));
    this.ilkGunlukKontrol = setTimeout(() => {
      void this.calistir();
      this.zamanlayici = setInterval(() => void nabizla("kira-tahakkuk-zamanlayici", () => this.calistir()), BIR_GUN_MS);
    }, sonrakiGunlukKontrolMs());
    this.logger.log("Kira tahakkuk kontrolü her gün İstanbul saatiyle 00:05 için planlandı");
  }

  onModuleDestroy(): void {
    if (this.ilkGunlukKontrol) clearTimeout(this.ilkGunlukKontrol);
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  private async tenantIdleriAl(): Promise<string[]> {
    const yonetimUrl = process.env.DATABASE_URL_MIGRATE;
    if (!yonetimUrl) throw new Error("Otomatik tahakkuk için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: yonetimUrl });
    try { return (await yonetim.tenant.findMany({ select: { id: true } })).map((t) => t.id); }
    finally { await yonetim.$disconnect(); }
  }

  /**
   * DVZ-04: dövizli sözleşmelerin eksik dönemleri için kur, tahakkuk işleminden
   * önce çekilir — TCMB'ye gitmek veritabanı işleminin içinde yapılmaz.
   */
  private async kurlariHazirla(tenantId: string, mevcutDonem: Date) {
    const sozlesmeler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.kiraSozlesme.findMany({
        where: { aktif: true, dovizCinsi: { not: "TRY" }, baslangicTarihi: { lte: new Date(Date.UTC(mevcutDonem.getUTCFullYear(), mevcutDonem.getUTCMonth() + 1, 0)) } },
        select: { baslangicTarihi: true, bitisTarihi: true, masraflar: { select: { kiraDonemi: true } } },
      }),
    );
    const donemler = new Map<string, Date>();
    for (const s of sozlesmeler) for (const d of eksikDonemler(s, mevcutDonem)) donemler.set(d.toISOString(), d);
    for (const donem of donemler.values()) {
      try { await this.doviz.kurGarantile(donem); }
      catch (hata) { this.logger.warn(`${donem.toISOString().slice(0, 10)} kuru çekilemedi: ${hata instanceof Error ? hata.message : String(hata)}`); }
    }
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      const simdi = new Date(); const mevcutDonem = ayBasi(simdi);
      let toplam = 0;
      for (const tenantId of await this.tenantIdleriAl()) {
        // PLT-05: askıdaki firmada kira masrafı tahakkuk etmez; açılınca eksik dönemler tamamlanır.
        if (await this.erisim?.otomasyonDurdu(tenantId, "masraf_gelir")) continue;
        await this.kurlariHazirla(tenantId, mevcutDonem);
        const kursuzlar: { id: string; baslik: string; dovizCinsi: string; donemler: string[] }[] = [];
        toplam += await this.prisma.tenantIslem(tenantId, async (tx) => {
          const sozlesmeler = await tx.kiraSozlesme.findMany({ where: { aktif: true, baslangicTarihi: { lte: new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth() + 1, 0)) } }, include: { cari: { select: { unvan: true } }, masraflar: { select: { kiraDonemi: true } } } });
          let olusan = 0;
          for (const s of sozlesmeler) {
            const kayitlar: Prisma.MasrafCreateManyInput[] = [];
            const kursuzDonemler: string[] = [];
            for (const donem of eksikDonemler(s, mevcutDonem)) {
              const anahtar = donem.toISOString().slice(0, 7);
              const aySonu = new Date(Date.UTC(donem.getUTCFullYear(), donem.getUTCMonth() + 1, 0)).getUTCDate();
              const kdvTutari = s.matrah.mul(s.kdvOrani).div(100).toDecimalPlaces(2); const stopajTutari = s.matrah.mul(s.stopajOrani).div(100).toDecimalPlaces(2);
              // Kuru bilinmeyen dövizli dönem atlanır: 1 ile yazmak döviz
              // tutarını TL sanmak olurdu. Kur gelince bir sonraki tarama dönemi oluşturur.
              const kur = await kurCoz(tx, tenantId, s.dovizCinsi, donem);
              if (kur) kayitlar.push({ tenantId, kategoriId: s.kategoriId, cariId: s.cariId, belgeTuru: "kira", tarih: donem, vadeTarihi: new Date(Date.UTC(donem.getUTCFullYear(), donem.getUTCMonth(), Math.min(s.odemeGunu, aySonu))), saticiUnvan: s.kirayaVeren || s.cari?.unvan, vknTckn: s.vknTckn, iban: s.iban, aciklama: `${s.baslik} - ${anahtar} kira dönemi (otomatik)`, matrah: s.matrah, kdvOrani: s.kdvOrani, kdvTutari, toplam: s.matrah.add(kdvTutari), dovizCinsi: s.dovizCinsi, kur, stopajOrani: s.stopajOrani, stopajTutari, kiraSozlesmeId: s.id, kiraDonemi: donem });
              else kursuzDonemler.push(anahtar);
            }
            if (kursuzDonemler.length) {
              this.logger.warn(`${s.baslik}: ${kursuzDonemler.length} ${s.dovizCinsi} kira dönemi, kur kaydı bulunmadığı için oluşturulmadı`);
              kursuzlar.push({ id: s.id, baslik: s.baslik, dovizCinsi: s.dovizCinsi, donemler: kursuzDonemler });
            }
            if (kayitlar.length) olusan += (await tx.masraf.createMany({ data: kayitlar, skipDuplicates: true })).count;
          }
          return olusan;
        });
        await this.kursuzlariBildir(tenantId, kursuzlar);
      }
      if (toplam) this.logger.log(`${toplam} eksik kira tahakkuku otomatik oluşturuldu`);
      else this.logger.debug("Otomatik kira tahakkukları güncel");
    } catch (hata) { this.logger.error("Otomatik kira tahakkuk kontrolü başarısız", hata instanceof Error ? hata.stack : String(hata)); }
    finally { this.calisiyor = false; }
  }

  /** DVZ-07: kur yüzünden oluşturulamayan dönem yalnız loga değil, bildirime düşer. */
  private async kursuzlariBildir(tenantId: string, kursuzlar: { id: string; baslik: string; dovizCinsi: string; donemler: string[] }[]) {
    for (const k of kursuzlar) {
      try {
        await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () =>
          this.bildirimler.uret({
            tur: "entegrasyon",
            onem: "uyari",
            baslik: "Kur bulunamadığı için kira tahakkuku oluşturulamadı",
            aciklama: `${k.baslik}: ${k.donemler.join(", ")} dönemi için ${k.dovizCinsi} kuru bulunamadı (dönem başından en fazla ${KUR_GERI_BAKIS_GUN} gün öncesine kadar arandı). Ayarlar > Döviz Kurları ekranından kuru çekin ya da elle girin; tahakkuk bir sonraki taramada oluşur.`,
            birlesimAnahtari: `kira-kur-eksik:${k.id}`,
            kaynakTur: "kira_sozlesme",
            kaynakRef: k.id,
            hedefYol: "/panel/ayarlar/doviz-kurlari",
            roller: ["yonetici", "muhasebe"],
          }),
        );
      } catch (hata) {
        this.logger.warn(`${k.baslik}: kur eksikliği bildirimi üretilemedi: ${hata instanceof Error ? hata.message : String(hata)}`);
      }
    }
  }
}
