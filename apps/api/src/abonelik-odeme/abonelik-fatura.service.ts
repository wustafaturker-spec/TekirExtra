import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CariService } from "../cari/cari.service";
import { baglamlaCalistir } from "../core/istek-baglami";
import { nabizla } from "../core/nabiz/nabiz";
import { PrismaService } from "../core/prisma.service";
import { faturaKilitleVeKalaniGetir } from "../fatura/odeme-durumu";
import { faturaOlusturSemasi } from "../fatura/fatura.semalar";
import { FaturaService } from "../fatura/fatura.service";
import { KasaBankaService } from "../kasa-banka/kasa-banka.service";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { adSoyadAyir } from "./abonelik-odeme.service";
import { ABONELIK_KDV_ORANI, fiyatPlani } from "./abonelik-tutari";
import { SAGLAYICI_ADI } from "./abonelik-saglayici";

/** PLT-21: faturalayan firmadaki hizmet kartı; yoksa bir kez açılır. */
export const ABONELIK_STOK_KODU = "TEKIREXTRA-ABONELIK";
const ON_DAKIKA_MS = 10 * 60 * 1000;

const gunTR = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const tarihTR = (d: Date) => d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
const kisalt = (h: unknown) => (h instanceof Error ? h.message : String(h)).slice(0, 500);

export interface FaturasizOdeme {
  odeme_id: string; tenant_id: string; odeme_at: Date; ay_sayisi: number; tutar: Prisma.Decimal; matrah: Prisma.Decimal | null; kdv: Prisma.Decimal | null;
  kaynak: string; saglayici: string | null; onceki_donem_sonu: Date | null; yeni_donem_sonu: Date; plan_kodu: string;
  unvan: string; faturalandirma_unvani: string | null; vkn: string; vergi_dairesi: string | null; adres: string | null; il: string | null; ilce: string | null; posta_kodu: string | null; eposta: string | null;
}

/**
 * Matrah: sağlayıcı ödemesinde kayıtlı; elle ödemede (yalnız KDV dahil toplam
 * girilir) toplamdan geri hesaplanır. KDV'yi fatura kendisi hesaplar, toplam
 * en fazla 1 kuruş sapabilir.
 */
export function abonelikMatrahi(o: Pick<FaturasizOdeme, "tutar" | "matrah">): Prisma.Decimal {
  if (o.matrah) return new Prisma.Decimal(o.matrah);
  return new Prisma.Decimal(o.tutar).mul(100).div(100 + ABONELIK_KDV_ORANI).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Dönem aralığı: eski dönem sonundan (yoksa ödeme gününden) yeni dönem sonuna. */
export function abonelikAciklamasi(o: Pick<FaturasizOdeme, "plan_kodu" | "ay_sayisi" | "onceki_donem_sonu" | "yeni_donem_sonu" | "odeme_at" | "kaynak" | "saglayici">): string {
  const plan = fiyatPlani(o.plan_kodu)?.ad ?? o.plan_kodu;
  const bas = o.onceki_donem_sonu ?? o.odeme_at;
  const odeme = o.kaynak === "saglayici" ? `kartla (${SAGLAYICI_ADI[o.saglayici as keyof typeof SAGLAYICI_ADI] ?? o.saglayici})` : "havale/elle";
  return `TekirExtra ${plan} abonelik, ${o.ay_sayisi} ay (${tarihTR(bas)}–${tarihTR(o.yeni_donem_sonu)}); ödeme ${tarihTR(o.odeme_at)}, ${odeme}`;
}

/**
 * PLT-20…23: abonelik ödemesi → faturalayan firmada taslak satış faturası;
 * fatura orada kesinleşince tahsilat açılır ve faturayı kapatır. Bir ödeme için
 * tek fatura ve tek tahsilat (`abonelik_faturalari` satırı). Ödeme listesi
 * platform işlevinden gelir (worker, 10 dakikada bir); yazma faturalayan
 * firmanın kendi kiracı bağlamında, mevcut fatura/cari/kasa servisleriyle yapılır.
 */
@Injectable()
export class AbonelikFaturaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AbonelikFaturaService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformPrismaService,
    private readonly fatura: FaturaService,
    private readonly cari: CariService,
    private readonly kasa: KasaBankaService,
  ) {}

  onModuleInit(): void {
    this.fatura.kesinlesinceCalistir((tenantId, faturaId) => this.faturaKesinlesti(tenantId, faturaId));
    if (process.env.TEKIR_WORKER !== "1" || !process.env.DATABASE_URL_PLATFORM) return;
    setImmediate(() => void nabizla("abonelik-fatura", () => this.bekleyenleriIsle()));
    this.zamanlayici = setInterval(() => void nabizla("abonelik-fatura", () => this.bekleyenleriIsle()), ON_DAKIKA_MS);
  }

  onModuleDestroy(): void { if (this.zamanlayici) clearInterval(this.zamanlayici); }

  private ayar() {
    return this.prisma.abonelikFaturaAyari.findUnique({ where: { id: 1 } });
  }

  async bekleyenleriIsle(): Promise<{ islenen: number; hata: number }> {
    if (this.calisiyor) return { islenen: 0, hata: 0 };
    this.calisiyor = true;
    try {
      const ayar = await this.ayar();
      if (!ayar?.faturalayanTenantId) return { islenen: 0, hata: 0 };
      const odemeler = await this.platform.db.$queryRaw<FaturasizOdeme[]>`SELECT * FROM platform_faturasiz_abonelik_odemeleri()`;
      let islenen = 0; let hata = 0;
      for (const o of odemeler) {
        try { if (await this.faturala(o, ayar.faturalayanTenantId)) islenen++; } catch (h) {
          hata++;
          this.logger.error(JSON.stringify({ event: "subscription_invoice_failed", odemeId: o.odeme_id, error: kisalt(h) }));
        }
      }
      return { islenen, hata };
    } finally {
      this.calisiyor = false;
    }
  }

  /** Faturalayan firmada işi yapacak gerçek kullanıcı (denetim izi için): ilk aktif yönetici. */
  private async aktor(faturalayan: string) {
    const k = await this.prisma.tenantIslem(faturalayan, (tx) => tx.user.findFirst({ where: { aktif: true, rol: "yonetici" }, orderBy: { createdAt: "asc" }, select: { id: true } }));
    if (!k) throw new BadRequestException("Faturalayan firmada aktif yönetici yok");
    return k.id;
  }

  /** PLT-21: taslak fatura. Satır zaten taslak/kesin ise dokunmaz (tek fatura). */
  async faturala(o: FaturasizOdeme, faturalayan: string): Promise<boolean> {
    const mevcut = await this.prisma.abonelikFaturasi.findUnique({ where: { odemeId: o.odeme_id } });
    if (mevcut && mevcut.durum !== "bekliyor" && mevcut.durum !== "hata") return false;
    if (mevcut?.faturaId) return false; // fatura açılmış, kesinleşmeyi bekliyor
    await this.prisma.abonelikFaturasi.upsert({
      where: { odemeId: o.odeme_id },
      create: { odemeId: o.odeme_id, odeyenTenantId: o.tenant_id, faturalayanTenantId: faturalayan, durum: "bekliyor", deneme: 1 },
      update: { faturalayanTenantId: faturalayan, deneme: { increment: 1 }, updatedAt: new Date() },
    });
    try {
      const userId = await this.aktor(faturalayan);
      const faturaId = await baglamlaCalistir({ tenantId: faturalayan, userId, rol: "yonetici" }, async () => {
        const cariId = await this.cariBul(faturalayan, o);
        const stokId = await this.hizmetKarti(faturalayan);
        const girdi = faturaOlusturSemasi.parse({
          tip: "satis", cariId, tarih: gunTR(o.odeme_at), dovizCinsi: "TRY",
          aciklama: abonelikAciklamasi(o),
          satirlar: [{ stokId, miktar: "1", birim: "adet", birimFiyat: abonelikMatrahi(o).toFixed(2), kdvOrani: String(ABONELIK_KDV_ORANI) }],
        });
        return (await this.fatura.olustur(girdi)).id as string;
      });
      await this.prisma.abonelikFaturasi.update({ where: { odemeId: o.odeme_id }, data: { faturaId, durum: "taslak", hata: null, updatedAt: new Date() } });
      return true;
    } catch (h) {
      await this.prisma.abonelikFaturasi.update({ where: { odemeId: o.odeme_id }, data: { durum: "hata", hata: kisalt(h), updatedAt: new Date() } });
      throw h;
    }
  }

  /** Alıcının carisi VKN'yle bulunur; yoksa firmanın kayıt bilgileriyle açılır (+ fatura adresi). */
  private async cariBul(faturalayan: string, o: FaturasizOdeme): Promise<string> {
    const vkn = o.vkn?.trim();
    if (!vkn || !/^\d{10,11}$/.test(vkn)) throw new BadRequestException(`Firmanın VKN/TCKN'si geçersiz (${vkn || "boş"}); fatura kesilemez`);
    const bulunan = await this.prisma.tenantIslem(faturalayan, (tx) => tx.cariHesap.findFirst({ where: { vknTckn: vkn, aktif: true }, orderBy: { createdAt: "asc" }, select: { id: true, tip: true } }));
    if (bulunan) {
      if (bulunan.tip === "tedarikci") await this.prisma.tenantIslem(faturalayan, (tx) => tx.cariHesap.update({ where: { id: bulunan.id }, data: { tip: "her_ikisi" } }));
      return bulunan.id;
    }
    const unvan = (o.faturalandirma_unvani || o.unvan).trim();
    const gercek = vkn.length === 11;
    const kisi = gercek ? adSoyadAyir(unvan) : null;
    const yeni = await this.cari.olustur({
      kod: `ABN-${vkn}`, unvan, tip: "musteri", kisiTipi: gercek ? "gercek" : "tuzel",
      ...(kisi ? { ad: kisi.ad, soyad: kisi.soyad } : {}),
      vknTckn: vkn, ...(o.vergi_dairesi ? { vergiDairesi: o.vergi_dairesi.trim() } : {}),
      ...(o.eposta?.includes("@") ? { eposta: o.eposta.trim() } : {}),
      karaListe: false, dovizCinsi: "TRY",
    } as Parameters<CariService["olustur"]>[0], { mukerrerVknOnayi: true });
    if (o.adres && o.adres.trim().length >= 2) {
      await this.cari.adresEkle(yeni.id, { tip: "fatura", baslik: "Fatura adresi", adres: o.adres.trim(), ...(o.il ? { il: o.il } : {}), ...(o.ilce ? { ilce: o.ilce } : {}), ...(o.posta_kodu ? { postaKodu: o.posta_kodu } : {}), ulke: "TR" });
    }
    return yeni.id;
  }

  private hizmetKarti(faturalayan: string): Promise<string> {
    return this.prisma.tenantIslem(faturalayan, async (tx) => {
      const mevcut = await tx.stokKart.findFirst({ where: { kod: ABONELIK_STOK_KODU }, select: { id: true } });
      if (mevcut) return mevcut.id;
      return (await tx.stokKart.create({ data: { tenantId: faturalayan, kod: ABONELIK_STOK_KODU, ad: "TekirExtra abonelik hizmeti", tip: "hizmet", kdvOrani: new Prisma.Decimal(ABONELIK_KDV_ORANI) } })).id;
    });
  }

  /**
   * PLT-22: faturalayan firmada fatura kesinleşti → tahsilat. Kartla ödeme kart
   * hesabına, elle ödeme elle hesabına; hesap seçilmemişse satır "kesinleşti"de
   * kalır ve platformda hata olarak görünür. Fatura başka yoldan kapanmışsa
   * (ör. cari avansı) ikinci tahsilat açılmaz.
   */
  async faturaKesinlesti(tenantId: string, faturaId: string): Promise<void> {
    const bag = await this.prisma.abonelikFaturasi.findFirst({ where: { faturalayanTenantId: tenantId, faturaId } });
    if (!bag || bag.durum === "tahsil_edildi") return;
    // Ödeme satırı ödeyen firmanındır (RLS); faturalayanın bağlamında include edilemez.
    const odeme = await this.prisma.tenantIslem(bag.odeyenTenantId, (tx) => tx.abonelikOdemesi.findUniqueOrThrow({ where: { id: bag.odemeId }, select: { kaynak: true, createdAt: true } }));
    const ayar = await this.ayar();
    const kart = odeme.kaynak === "saglayici";
    const hesapTur = kart ? ayar?.kartHesapTur : ayar?.elleHesapTur;
    const hesapId = kart ? ayar?.kartHesapId : ayar?.elleHesapId;
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const f = await faturaKilitleVeKalaniGetir(tx, faturaId);
      if (f.durum !== "kesin") return { durum: "taslak" as const, faturaNo: f.no, hareketId: null, hata: null };
      if (!hesapTur || !hesapId) return { durum: "kesinlesti" as const, faturaNo: f.no, hareketId: null, hata: `${kart ? "Kartla" : "Elle"} alınan ödemeler için tahsilat hesabı seçilmemiş (Platform › Abonelik ödemesi)` };
      if (f.kalan.isZero()) return { durum: "tahsil_edildi" as const, faturaNo: f.no, hareketId: null, hata: "Fatura başka bir kayıtla zaten kapanmıştı; tahsilat açılmadı" };
      const hareket = await this.kasa.hareketOlustur(tx, tenantId, {
        ...(hesapTur === "kasa" ? { kasaId: hesapId } : hesapTur === "banka" ? { bankaHesapId: hesapId } : { posHesapId: hesapId }),
        tip: "tahsilat", tutar: f.kalan.toFixed(2), dovizCinsi: "TRY", tarih: gunTR(odeme.createdAt), faturaId,
        aciklama: `${f.no ?? "Abonelik faturası"} abonelik tahsilatı (${kart ? "kart" : "havale/elle"})`,
      } as Parameters<KasaBankaService["hareketOlustur"]>[2]);
      return { durum: "tahsil_edildi" as const, faturaNo: f.no, hareketId: (hareket as { id?: string })?.id ?? null, hata: null };
    }).catch((h) => ({ durum: "kesinlesti" as const, faturaNo: null, hareketId: null, hata: `Tahsilat açılamadı: ${kisalt(h)}` }));
    await this.prisma.abonelikFaturasi.update({
      where: { odemeId: bag.odemeId },
      data: { durum: sonuc.durum, ...(sonuc.faturaNo ? { faturaNo: sonuc.faturaNo } : {}), tahsilatHareketId: sonuc.hareketId, hata: sonuc.hata, updatedAt: new Date() },
    });
  }

  /**
   * PLT-23: firma kendi abonelik faturasının PDF'ini indirir. Ödeme firmanın
   * kendisine ait olmalı (RLS) ve fatura faturalayan firmada kesinleşmiş olmalı;
   * PDF faturalayan firmanın bağlamında üretilir.
   */
  async faturaPdf(odeyenTenantId: string, odemeId: string) {
    const odeme = await this.prisma.tenantIslem(odeyenTenantId, (tx) => tx.abonelikOdemesi.findUnique({ where: { id: odemeId }, select: { id: true, fatura: true } }));
    const bag = odeme?.fatura;
    if (!bag?.faturaId || (bag.durum !== "kesinlesti" && bag.durum !== "tahsil_edildi")) throw new NotFoundException("Bu ödemenin kesinleşmiş faturası yok");
    const userId = await this.aktor(bag.faturalayanTenantId);
    return baglamlaCalistir({ tenantId: bag.faturalayanTenantId, userId, rol: "yonetici" }, () => this.fatura.pdfUret(bag.faturaId!));
  }

  /** PLT-23: platformdan yeniden deneme — fatura yoksa açar, kesinse tahsilatı yeniden dener. */
  async yenidenDene(odemeId: string) {
    const bag = await this.prisma.abonelikFaturasi.findUnique({ where: { odemeId } });
    if (bag?.faturaId) {
      const userId = await this.aktor(bag.faturalayanTenantId);
      await baglamlaCalistir({ tenantId: bag.faturalayanTenantId, userId, rol: "yonetici" }, () => this.faturaKesinlesti(bag.faturalayanTenantId, bag.faturaId!));
    } else {
      const ayar = await this.ayar();
      if (!ayar?.faturalayanTenantId) throw new BadRequestException("Faturalayan firma seçilmemiş");
      const o = (await this.platform.db.$queryRaw<FaturasizOdeme[]>`SELECT * FROM platform_faturasiz_abonelik_odemeleri(true)`).find((x) => x.odeme_id === odemeId);
      if (!o) throw new NotFoundException("Faturalanacak ödeme bulunamadı (faturalama başlangıcından önce ya da faturalayan firmanın kendi ödemesi olabilir)");
      await this.faturala(o, ayar.faturalayanTenantId);
    }
    return this.prisma.abonelikFaturasi.findUnique({ where: { odemeId } });
  }
}
