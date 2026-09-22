import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { GibBelgeTuru } from "@prisma/client";
import type { EntegratorConfig, MukellefDurum } from "@tekirextra/baglanti";
import { MUKELLEF_TURU_KAMU } from "@tekirextra/shared";
import { PrismaService } from "../core/prisma.service";
import { MetricsService } from "../core/observability/metrics.service";
import { BaglantilarService } from "../tenant/baglantilar.service";

/** Senkron durumu tek satırda tutulur; tablonun anahtarı sabittir. */
const SENKRON_ID = "tek";

/**
 * Listenin kaç saate kadar taze sayılacağı. Kılavuz günde bir senkronu yeterli
 * gördüğü için 24 saat yeter; 48 saat, bir senkronun kaçırılmasına tolerans
 * bırakır. Bunun ötesinde gönderim durur (S-01 kararı 2) — yanlış kanal seçmek
 * yasal hata olduğundan tahmin etmektense durmak tercih edildi.
 */
const TAZELIK_SAATI = Number(process.env.EBLG_MUKELLEF_TAZELIK_SAAT || 48);

/** İki senkron arasındaki asgari süre; kılavuz "günde bir kez" diyor. */
const SENKRON_ARALIK_SAATI = Number(process.env.EBLG_MUKELLEF_SENKRON_SAAT || 24);

const BATCH = 1000;

export interface MukellefListesiDurumu {
  sonSenkronAt: Date | null;
  kayitSayisi: number;
  durum: string;
  hataMesaji: string | null;
  saglayici: string | null;
  taze: boolean;
}

/**
 * GİB mükellef listesinin lokal kopyası (EBLG-10).
 *
 * Daha önce her fatura gönderiminde entegratöre tam liste sorulurdu; Sovos'un
 * kılavuzu bunu bloklanma sebebi olarak sayıyor ("tam pk listesi günde sadece
 * bir kere indirilmeli ve alıcının GİB'e kayıtlı mı değil mi işlemleri kendi
 * lokalinde yapılmalıdır"). Liste kamuya açık ve her kiracı için aynı
 * olduğundan tablo globaldir; kiracı başına kopyalanmaz.
 *
 * Tekil sorgusu ucuz olan sağlayıcılar (adaptörü `mukellefListesiCek`
 * uygulamayanlar) bu katmanı atlar ve kendi tekil sorgusuna düşer — toplu liste
 * indirmeyen bir entegratör için lokal kopya tutmanın anlamı yok.
 */
@Injectable()
export class MukellefListesiService {
  private readonly logger = new Logger(MukellefListesiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly baglantilarService: BaglantilarService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Gönderim kanalını belirler: alıcı e-Fatura mükellefi mi, hangi posta
   * kutusuna gönderilecek. Karar lokal listeden verilir; entegratöre sorulmaz.
   */
  async kanalBelirle(
    saglayici: string,
    cfg: EntegratorConfig,
    vknTckn: string,
    belgeTuru: GibBelgeTuru = "efatura",
  ): Promise<MukellefDurum> {
    const adapter = this.baglantilarService.adapterCoz(saglayici);
    if (!adapter.mukellefListesiCek) {
      this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "mukellefSorgula", saglayici });
      return adapter.mukellefSorgula(cfg, vknTckn);
    }

    const durum = await this.durum();
    if (!durum.taze) {
      throw new BadRequestException(
        durum.sonSenkronAt
          ? "GİB mükellef listesi güncel değil; belge göndermeden önce Ayarlar > Entegratörler ekranından listeyi güncelleyin"
          : "GİB mükellef listesi henüz indirilmedi; belge göndermeden önce Ayarlar > Entegratörler ekranından listeyi güncelleyin",
      );
    }

    // Bir VKN'nin birden çok etiketi olabilir; sıralama deterministik olsun ki
    // aynı alıcıya her seferinde aynı kutuya gönderilsin.
    const kayit = await this.prisma.gibMukellef.findFirst({
      where: { vknTckn, belgeTuru },
      orderBy: { postaKutusu: "asc" },
    });

    return { vknTckn, eFaturaMukellefi: Boolean(kayit), postaKutusu: kayit?.postaKutusu, kamu: kayit?.tur === MUKELLEF_TURU_KAMU };
  }

  /**
   * Alıcının listedeki türü (KAMU senaryosu). Sihirbaz kanal kararından önce
   * belgenin KAMU gidip gitmeyeceğini göstermek için okur; liste bayatsa ya da
   * entegratör tür taşımıyorsa boş döner ve kart işareti belirleyici olur.
   */
  async listeTuru(vknTckn: string | null | undefined): Promise<string | undefined> {
    if (!vknTckn) return undefined;
    const kayit = await this.prisma.gibMukellef.findFirst({
      where: { vknTckn, belgeTuru: "efatura", tur: { not: null } },
      select: { tur: true },
    });
    return kayit?.tur ?? undefined;
  }

  async durum(): Promise<MukellefListesiDurumu> {
    const kayit = await this.prisma.gibMukellefSenkron.findUnique({ where: { id: SENKRON_ID } });
    const yasSaat = kayit?.sonSenkronAt ? (Date.now() - kayit.sonSenkronAt.getTime()) / 3_600_000 : Infinity;
    return {
      sonSenkronAt: kayit?.sonSenkronAt ?? null,
      kayitSayisi: kayit?.kayitSayisi ?? 0,
      durum: kayit?.durum ?? "beklemede",
      hataMesaji: kayit?.hataMesaji ?? null,
      saglayici: kayit?.saglayici ?? null,
      taze: yasSaat <= TAZELIK_SAATI,
    };
  }

  /** Zamanlanmış senkronun sırası geldi mi (kılavuz: günde bir kez). */
  async senkronVaktiGeldi(): Promise<boolean> {
    const kayit = await this.prisma.gibMukellefSenkron.findUnique({ where: { id: SENKRON_ID } });
    if (!kayit?.sonSenkronAt) return true;
    return Date.now() - kayit.sonSenkronAt.getTime() >= SENKRON_ARALIK_SAATI * 3_600_000;
  }

  /**
   * Tam listeyi indirip lokale yazar. Liste indirme uzun sürdüğünden ve
   * kısmen yazılmış bir liste yanlış kanal kararı ürettiğinden, yazım tek
   * transaction içinde "sil + yaz" olarak yapılır: ya tüm liste yenilenir ya
   * da eski liste olduğu gibi kalır.
   */
  async senkronEt(saglayici: string, cfg: EntegratorConfig): Promise<MukellefListesiDurumu> {
    const adapter = this.baglantilarService.adapterCoz(saglayici);
    if (!adapter.mukellefListesiCek) {
      throw new BadRequestException(`${saglayici} toplu mükellef listesi sunmuyor`);
    }

    const baslangic = Date.now();
    try {
      this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "mukellefListesiCek", saglayici });
      const kayitlar = await adapter.mukellefListesiCek(cfg);
      if (kayitlar.length === 0) {
        // Boş liste neredeyse kesinlikle bir aktarım hatasıdır; mevcut listeyi
        // silmek tüm gönderimleri e-Arşiv'e kaydırırdı.
        throw new Error("Entegratör boş mükellef listesi döndürdü");
      }

      // Aynı (vkn, etiket) çifti listede birden çok kez görünebilir; teklik
      // kısıtına takılmamak için yazımdan önce indirgenir.
      const tekil = new Map<string, { vknTckn: string; belgeTuru: GibBelgeTuru; postaKutusu: string; unvan: string | null; tur: string | null; ilkKayitZamani: Date | null }>();
      for (const kayit of kayitlar) {
        tekil.set(`${kayit.vknTckn}|${kayit.belgeTuru}|${kayit.postaKutusu}`, {
          vknTckn: kayit.vknTckn,
          belgeTuru: kayit.belgeTuru,
          postaKutusu: kayit.postaKutusu,
          unvan: kayit.unvan ?? null,
          tur: kayit.tur ?? null,
          ilkKayitZamani: kayit.ilkKayitZamani ? new Date(kayit.ilkKayitZamani) : null,
        });
      }
      const satirlar = [...tekil.values()];

      await this.prisma.$transaction(
        async (tx) => {
          await tx.gibMukellef.deleteMany({});
          for (let i = 0; i < satirlar.length; i += BATCH) {
            await tx.gibMukellef.createMany({ data: satirlar.slice(i, i + BATCH) });
          }
        },
        { timeout: 600_000 },
      );

      const sonuc = await this.prisma.gibMukellefSenkron.upsert({
        where: { id: SENKRON_ID },
        create: { id: SENKRON_ID, sonSenkronAt: new Date(), kayitSayisi: satirlar.length, durum: "basarili", hataMesaji: null, saglayici },
        update: { sonSenkronAt: new Date(), kayitSayisi: satirlar.length, durum: "basarili", hataMesaji: null, saglayici },
      });

      this.metrics.increment("ebelge_mukellef_senkron_total", { result: "success" });
      this.metrics.set("ebelge_mukellef_kayit_sayisi", satirlar.length);
      this.metrics.set("ebelge_mukellef_senkron_suresi_saniye", (Date.now() - baslangic) / 1000);
      this.logger.log(`GİB mükellef listesi güncellendi: ${satirlar.length} etiket (${saglayici})`);
      return {
        sonSenkronAt: sonuc.sonSenkronAt,
        kayitSayisi: sonuc.kayitSayisi,
        durum: sonuc.durum,
        hataMesaji: sonuc.hataMesaji,
        saglayici: sonuc.saglayici,
        taze: true,
      };
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : "Mükellef listesi indirilemedi";
      // Başarısız senkron `sonSenkronAt`'i ilerletmez: liste bayat kalır ve
      // gönderim durmaya devam eder. Aksi halde eski listeyle taze sanılırdı.
      await this.prisma.gibMukellefSenkron.upsert({
        where: { id: SENKRON_ID },
        create: { id: SENKRON_ID, kayitSayisi: 0, durum: "hata", hataMesaji: mesaj.slice(0, 500), saglayici },
        update: { durum: "hata", hataMesaji: mesaj.slice(0, 500), saglayici },
      });
      this.metrics.increment("ebelge_mukellef_senkron_total", { result: "failed" });
      this.logger.error(`GİB mükellef listesi güncellenemedi: ${mesaj}`);
      throw hata instanceof BadRequestException ? hata : new BadRequestException(`Mükellef listesi güncellenemedi: ${mesaj}`);
    }
  }
}
