import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { aktifBaglam, baglamlaCalistir } from "../core/istek-baglami";
import { nabizla } from "../core/nabiz/nabiz";
import { PrismaService } from "../core/prisma.service";
import { TaramaKuyrugu, taramaKuyruguEtkin } from "../core/tarama-kuyrugu";
import { ARALIK_SECENEKLERI, IS_ADI, OTOMATIK_ISLER, type IsDurumu, type OtomatikIs, isUygun, sonrakiCalisma, varsayilanAralik } from "./otomatik-is";
import { PazaryeriService } from "./pazaryeri.service";

const BES_DAKIKA_MS = 5 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";
const NABIZ_ADI = "pazaryeri-otomatik";

export interface PazaryeriOtomatikIsi { tenantId: string; baglantiId: string; is: OtomatikIs }

type Kayit = Pick<IsDurumu, "aralikDk" | "sonDeneme" | "sonBasari" | "ardisikHata" | "sonHata" | "durduNedeni" | "beklemeCarpani"> & { is: string };

/** Kayıt yoksa varsayılan aralıkla boş durum. */
function durumu(is: OtomatikIs, kayit?: Kayit) {
  return kayit ?? { is, aralikDk: varsayilanAralik(is), sonDeneme: null, sonBasari: null, ardisikHata: 0, sonHata: null, durduNedeni: null, beklemeCarpani: 1 };
}

/**
 * PZR-18: pazaryeri otomatik çekimi. Worker'da 5 dakikada bir planlayıcı
 * aralığı dolan bağlantı işlerini kuyruğa koyar (BLD-17 kuyruğu, iş kimliği
 * `<bağlantı>-<iş>`); iş, düğmenin çağırdığı servisi sistem kullanıcısıyla
 * çalıştırır (kilit ve durum yazımı serviste). Askıdaki/satış modülü kapalı
 * firmada çalışmaz. Kuyruk kapalıysa (test, `TARAMA_KUYRUGU_KAPALI=1`) sırayla.
 */
@Injectable()
export class PazaryeriOtomatikService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PazaryeriOtomatikService.name);
  private zamanlayici?: NodeJS.Timeout;
  private kuyruk?: TaramaKuyrugu<PazaryeriOtomatikIsi>;
  private calisiyor = false;

  constructor(private readonly prisma: PrismaService, private readonly pazaryeri: PazaryeriService, @Optional() private readonly erisim?: AbonelikErisimService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1" || process.env.PAZARYERI_OTOMATIK_KAPALI === "1") return;
    if (taramaKuyruguEtkin()) {
      this.kuyruk = new TaramaKuyrugu<PazaryeriOtomatikIsi>({
        tur: "pazaryeri", nabizAdi: NABIZ_ADI, aralikMs: BES_DAKIKA_MS, planla: () => this.planla(), isle: (is) => this.isle(is),
        isKimligi: (is) => `${is.baglantiId}-${is.is}`, eszamanliDegiskeni: "PAZARYERI_ESZAMANLI",
      });
      void this.kuyruk.baslat().catch((hata) => this.logger.error(JSON.stringify({ event: "marketplace_auto_queue_failed", error: hata instanceof Error ? hata.message : String(hata) })));
      return;
    }
    this.zamanlayici = setInterval(() => void nabizla(NABIZ_ADI, () => this.sirayla(), BES_DAKIKA_MS), BES_DAKIKA_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
    await this.kuyruk?.kapat();
  }

  private async sirayla(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try { for (const is of await this.planla()) await this.isle(is); } finally { this.calisiyor = false; }
  }

  /** Aralığı dolan işler (kiracılar arası okuma yönetim bağlantısıyla, banka zamanlayıcısı gibi). */
  async planla(simdi = new Date()): Promise<PazaryeriOtomatikIsi[]> {
    const yonetimUrl = process.env.DATABASE_URL_MIGRATE;
    if (!yonetimUrl) throw new Error("Pazaryeri otomatik çekimi için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: yonetimUrl });
    try {
      const baglantilar = await yonetim.baglanti.findMany({ where: { aile: "pazaryeri", durum: "aktif" }, select: { id: true, tenantId: true, saglayici: true, baglantiOtomatikIsleri: true } });
      return await this.vadesiGelenler(baglantilar, simdi);
    } finally {
      await yonetim.$disconnect();
    }
  }

  async vadesiGelenler(baglantilar: { id: string; tenantId: string; saglayici: string; baglantiOtomatikIsleri: Kayit[] }[], simdi: Date): Promise<PazaryeriOtomatikIsi[]> {
    const isler: PazaryeriOtomatikIsi[] = [];
    const durdu = new Map<string, boolean>();
    for (const b of baglantilar) {
      for (const is of OTOMATIK_ISLER) {
        if (!isUygun(b.saglayici, is)) continue;
        const sonraki = sonrakiCalisma(durumu(is, b.baglantiOtomatikIsleri.find((k) => k.is === is)), simdi);
        if (!sonraki || sonraki > simdi) continue;
        // PLT-05: askıdaki ya da satış modülü kapalı firmada çalışmaz.
        if (!durdu.has(b.tenantId)) durdu.set(b.tenantId, Boolean(await this.erisim?.otomasyonDurdu(b.tenantId, "satis")));
        if (durdu.get(b.tenantId)) continue;
        isler.push({ tenantId: b.tenantId, baglantiId: b.id, is });
      }
    }
    return isler;
  }

  async isle({ tenantId, baglantiId, is }: PazaryeriOtomatikIsi): Promise<void> {
    try {
      const sonuc = await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => is === "siparis" ? this.pazaryeri.senkronizeEt(baglantiId) : this.pazaryeri.kesintileriSenkronizeEt(baglantiId));
      this.logger.log(JSON.stringify({ event: "marketplace_auto_sync", tenantId, baglantiId, is, sonuclar: sonuc.sonuclar }));
    } catch (hata) {
      // Bağlantı bu arada pasifleşmiş/silinmiş olabilir; sonraki turda zaten aday olmaz.
      this.logger.warn(JSON.stringify({ event: "marketplace_auto_sync_failed", tenantId, baglantiId, is, error: hata instanceof Error ? hata.message : String(hata) }));
    }
  }

  /** Ayar ekranı: pazaryeri bağlantıları ve işleri (kayıt yoksa varsayılan). */
  async liste() {
    const { tenantId } = aktifBaglam();
    const simdi = new Date();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const baglantilar = await tx.baglanti.findMany({ where: { aile: "pazaryeri" }, select: { id: true, saglayici: true, durum: true, baglantiOtomatikIsleri: true }, orderBy: { createdAt: "asc" } });
      return baglantilar.map((b) => ({
        baglantiId: b.id, saglayici: b.saglayici, durum: b.durum,
        isler: OTOMATIK_ISLER.filter((is) => isUygun(b.saglayici, is)).map((is) => {
          const kayit = b.baglantiOtomatikIsleri.find((k) => k.is === is);
          const d = durumu(is, kayit);
          return {
            is, ad: IS_ADI[is], aralikDk: d.aralikDk, varsayilan: !kayit, sonDeneme: d.sonDeneme, sonBasari: d.sonBasari, ardisikHata: d.ardisikHata,
            sonHata: d.sonHata, durduNedeni: d.durduNedeni, sonraki: b.durum === "aktif" ? sonrakiCalisma(d, simdi) : null,
          };
        }),
      }));
    });
  }

  /** Aralığı kaydeder; durmuş işi yeniden başlatır (sayaçlar sıfırlanır). */
  async aralikKaydet(baglantiId: string, is: OtomatikIs, aralikDk: number) {
    const { tenantId } = aktifBaglam();
    if (!(ARALIK_SECENEKLERI as readonly number[]).includes(aralikDk)) throw new BadRequestException("Geçersiz aralık");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const b = await tx.baglanti.findFirst({ where: { id: baglantiId, aile: "pazaryeri" }, select: { id: true, saglayici: true } });
      if (!b) throw new NotFoundException("Pazaryeri bağlantısı bulunamadı");
      if (!isUygun(b.saglayici, is)) throw new BadRequestException(`${IS_ADI[is]} bu pazaryerinde desteklenmiyor`);
      const sifirla = { aralikDk, durduNedeni: null, ardisikHata: 0, beklemeCarpani: 1 };
      await tx.baglantiOtomatikIsi.upsert({ where: { tenantId_baglantiId_is: { tenantId, baglantiId, is } }, create: { tenantId, baglantiId, is, ...sifirla }, update: sifirla });
      return { baglantiId, is, aralikDk };
    });
  }
}
