import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaService } from "../core/prisma.service";
import { kurCoz } from "../doviz/kur-coz";

const BIR_GUN_MS = 24 * 60 * 60 * 1000;
const ISTANBUL_UTC_FARKI_MS = 3 * 60 * 60 * 1000;

/** Bir sonraki İstanbul saati 00:05 çalışmasına kalan süre. */
function sonrakiGunlukKontrolMs(simdiMs = Date.now()): number {
  const istanbul = new Date(simdiMs + ISTANBUL_UTC_FARKI_MS);
  let hedefMs = Date.UTC(istanbul.getUTCFullYear(), istanbul.getUTCMonth(), istanbul.getUTCDate(), 0, 5) - ISTANBUL_UTC_FARKI_MS;
  if (hedefMs <= simdiMs) hedefMs += BIR_GUN_MS;
  return hedefMs - simdiMs;
}

/** Worker içinde aktif sözleşmelerin eksik aylık tahakkuklarını tamamlar. */
@Injectable()
export class KiraTahakkukZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KiraTahakkukZamanlayiciService.name);
  private ilkGunlukKontrol?: NodeJS.Timeout;
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void this.calistir());
    this.ilkGunlukKontrol = setTimeout(() => {
      void this.calistir();
      this.zamanlayici = setInterval(() => void this.calistir(), BIR_GUN_MS);
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

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      const simdi = new Date(); const mevcutDonem = new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth(), 1));
      let toplam = 0;
      for (const tenantId of await this.tenantIdleriAl()) {
        toplam += await this.prisma.tenantIslem(tenantId, async (tx) => {
          const sozlesmeler = await tx.kiraSozlesme.findMany({ where: { aktif: true, baslangicTarihi: { lte: new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth() + 1, 0)) } }, include: { cari: { select: { unvan: true } }, masraflar: { select: { kiraDonemi: true } } } });
          let olusan = 0;
          for (const s of sozlesmeler) {
            const mevcut = new Set(s.masraflar.map((m) => m.kiraDonemi?.toISOString().slice(0, 7)));
            let donem = new Date(Date.UTC(s.baslangicTarihi.getUTCFullYear(), s.baslangicTarihi.getUTCMonth(), 1));
            const bitis = s.bitisTarihi ? new Date(Date.UTC(s.bitisTarihi.getUTCFullYear(), s.bitisTarihi.getUTCMonth(), 1)) : mevcutDonem;
            const sonDonem = bitis < mevcutDonem ? bitis : mevcutDonem;
            const kayitlar: Prisma.MasrafCreateManyInput[] = [];
            let kursuz = 0;
            while (donem <= sonDonem) {
              const anahtar = donem.toISOString().slice(0, 7);
              if (!mevcut.has(anahtar)) {
                const aySonu = new Date(Date.UTC(donem.getUTCFullYear(), donem.getUTCMonth() + 1, 0)).getUTCDate();
                const kdvTutari = s.matrah.mul(s.kdvOrani).div(100).toDecimalPlaces(2); const stopajTutari = s.matrah.mul(s.stopajOrani).div(100).toDecimalPlaces(2);
                // Kuru bilinmeyen dövizli dönem atlanır: 1 ile yazmak döviz
                // tutarını TL sanmak olurdu. Kullanıcı kurları güncelleyince
                // bir sonraki tarama dönemi oluşturur.
                const kur = await kurCoz(tx, tenantId, s.dovizCinsi, donem);
                if (kur) kayitlar.push({ tenantId, kategoriId: s.kategoriId, cariId: s.cariId, belgeTuru: "kira", tarih: donem, vadeTarihi: new Date(Date.UTC(donem.getUTCFullYear(), donem.getUTCMonth(), Math.min(s.odemeGunu, aySonu))), saticiUnvan: s.kirayaVeren || s.cari?.unvan, vknTckn: s.vknTckn, iban: s.iban, aciklama: `${s.baslik} - ${anahtar} kira dönemi (otomatik)`, matrah: s.matrah, kdvOrani: s.kdvOrani, kdvTutari, toplam: s.matrah.add(kdvTutari), dovizCinsi: s.dovizCinsi, kur, stopajOrani: s.stopajOrani, stopajTutari, kiraSozlesmeId: s.id, kiraDonemi: donem });
                else kursuz += 1;
              }
              donem = new Date(Date.UTC(donem.getUTCFullYear(), donem.getUTCMonth() + 1, 1));
            }
            if (kursuz) this.logger.warn(`${s.baslik}: ${kursuz} ${s.dovizCinsi} kira dönemi, kur kaydı bulunmadığı için oluşturulmadı`);
            if (kayitlar.length) olusan += (await tx.masraf.createMany({ data: kayitlar, skipDuplicates: true })).count;
          }
          return olusan;
        });
      }
      if (toplam) this.logger.log(`${toplam} eksik kira tahakkuku otomatik oluşturuldu`);
      else this.logger.debug("Otomatik kira tahakkukları güncel");
    } catch (hata) { this.logger.error("Otomatik kira tahakkuk kontrolü başarısız", hata instanceof Error ? hata.stack : String(hata)); }
    finally { this.calisiyor = false; }
  }
}
