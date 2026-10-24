import { BadGatewayException, BadRequestException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { PrismaService } from "../core/prisma.service";
import { EkstreService } from "./ekstre.service";
import { SaglayiciKimlikHatasi, type BankaSaglayicisi } from "./banka-saglayici";
import { CEKILEN_SAGLAYICILAR, saglayiciBul } from "./banka-saglayici-kaydi";
import { VomsisAdapter, type VomsisConfig } from "./vomsis.adapter";

/** Çekilen (API'li) banka bağlantıları; webhook bağlantısı hareketi kendisi iter. */
const cekilenBaglanti = () => ({ aile: "banka" as const, saglayici: { in: CEKILEN_SAGLAYICILAR() } }) satisfies Prisma.BaglantiWhereInput;

@Injectable()
export class BankaEntegrasyonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ekstre: EkstreService,
  ) {}

  async eslemeleriListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaBaglantiHesap.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          baglanti: { select: { id: true, saglayici: true, durum: true } },
          bankaHesap: { select: { id: true, ad: true, bankaAdi: true, dovizCinsi: true } },
        },
      }),
    );
  }

  private ayarCoz(sifreliConfig: string): Record<string, unknown> {
    return JSON.parse(coz(sifreliConfig)) as Record<string, unknown>;
  }

  private saglayici(kod: string): BankaSaglayicisi {
    const s = saglayiciBul(kod);
    if (!s) throw new BadRequestException(`'${kod}' için banka sağlayıcısı tanımlı değil`);
    return s;
  }

  private async baglantiGetir(baglantiId: string, aktif = false) {
    const { tenantId } = aktifBaglam();
    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findFirst({ where: { id: baglantiId, ...cekilenBaglanti(), ...(aktif ? { durum: "aktif" } : {}) }, include: { bankaHesapEslemeleri: true } }),
    );
    if (!baglanti) throw new NotFoundException(aktif ? "Aktif banka bağlantısı bulunamadı" : "Banka bağlantısı bulunamadı");
    return baglanti;
  }

  /** Ayarlar ekranının Vomsis hesap listesi (ham Vomsis alanlarıyla; ekran bunları gösterir). */
  async vomsisHesaplari(baglantiId: string) {
    const { tenantId } = aktifBaglam();
    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findFirst({ where: { id: baglantiId, aile: "banka", saglayici: "vomsis" } }),
    );
    if (!baglanti) throw new NotFoundException("Vomsis bağlantısı bulunamadı");
    const a = this.ayarCoz(baglanti.sifreliConfig);
    const config: VomsisConfig = { appKey: String(a.kullaniciAdi ?? ""), appSecret: String(a.parola ?? ""), baseUrl: a.servisAdresi ? String(a.servisAdresi) : undefined };
    const adapter = new VomsisAdapter();
    try {
      return await adapter.hesaplariCek(config, await adapter.tokenAl(config, true));
    } catch (hata) {
      throw new BadGatewayException(hata instanceof Error ? hata.message : "Vomsis hesapları alınamadı");
    }
  }

  /** KSB-30: herhangi bir çekilen sağlayıcının hesapları, ortak biçimde. */
  async saglayiciHesaplari(baglantiId: string) {
    const baglanti = await this.baglantiGetir(baglantiId);
    try {
      return await this.saglayici(baglanti.saglayici).hesaplar(this.ayarCoz(baglanti.sifreliConfig));
    } catch (hata) {
      if (hata instanceof HttpException) throw hata;
      throw new BadGatewayException(hata instanceof Error ? hata.message : "Sağlayıcı hesapları alınamadı");
    }
  }

  async eslemeEkle(girdi: { baglantiId: string; bankaHesapId: string; disHesapId: string }) {
    const { tenantId } = aktifBaglam();
    const baglanti = await this.baglantiGetir(girdi.baglantiId);
    const hesap = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaHesap.findUnique({ where: { id: girdi.bankaHesapId } }));
    if (!hesap) throw new NotFoundException("Banka hesabı bulunamadı");
    const saglayici = this.saglayici(baglanti.saglayici);
    const disHesap = (await saglayici.hesaplar(this.ayarCoz(baglanti.sifreliConfig))).find((h) => h.id === girdi.disHesapId);
    if (!disHesap) throw new NotFoundException(`${saglayici.ad} hesabı bulunamadı`);
    if (disHesap.dovizCinsi !== hesap.dovizCinsi)
      throw new BadRequestException(`Döviz cinsi uyuşmuyor: ${saglayici.ad} ${disHesap.dovizCinsi}, TekirExtra ${hesap.dovizCinsi}`);
    return this.prisma.tenantIslem(tenantId, (tx) => tx.bankaBaglantiHesap.create({ data: { tenantId, ...girdi } }));
  }

  async senkronize(baglantiId: string, otomatik = false) {
    const { tenantId } = aktifBaglam();
    const baglanti = await this.baglantiGetir(baglantiId, true);
    if (!baglanti.bankaHesapEslemeleri.length) throw new BadRequestException("Banka hesabı eşlemesi bulunamadı");
    const saglayici = this.saglayici(baglanti.saglayici);
    const ayar = this.ayarCoz(baglanti.sifreliConfig);
    const baslangicZamani = new Date();
    try {
      let yeniSatir = 0;
      let yinelenenSatir = 0;
      const bakiyeFarklari: { bankaHesapId: string; fark: string; tarih: string }[] = [];
      for (const esleme of baglanti.bankaHesapEslemeleri) {
        const simdi = new Date();
        const bitis = new Date(simdi.getTime() + 86_400_000);
        const baslangic = esleme.sonSenkronTarihi
          ? new Date(esleme.sonSenkronTarihi.getTime() - 86_400_000)
          : new Date(simdi.getTime() - 7 * 86_400_000);
        const { hareketler, imlec } = await saglayici.hareketler(ayar, esleme.disHesapId, { baslangic, bitis, imlec: esleme.sonHareketId });
        // Kaynak anahtarı değişmez ("vomsis:<bağlantı>"): önceki satırlar yinelenen sayılır.
        const sonuc = hareketler.length
          ? await this.ekstre.webhookHareketleriniAl(tenantId, esleme.bankaHesapId, `${baglanti.saglayici}:${baglanti.id}`, hareketler)
          : { yeniSatir: 0, yinelenenSatir: 0 };
        yeniSatir += sonuc.yeniSatir;
        yinelenenSatir += sonuc.yinelenenSatir;
        await this.prisma.tenantIslem(tenantId, (tx) =>
          tx.bankaBaglantiHesap.update({
            where: { id: esleme.id },
            data: { sonHareketId: imlec ?? esleme.sonHareketId, sonSenkronTarihi: new Date() },
          }),
        );
        // KSB-31: yeni hareket geldiyse bankanın bildirdiği bakiye sistemle karşılaştırılır.
        if (sonuc.yeniSatir) {
          const durum = await this.ekstre.bakiyeDurumu(tenantId, esleme.bankaHesapId);
          if (durum && !durum.tutarli) bakiyeFarklari.push({ bankaHesapId: esleme.bankaHesapId, fark: durum.aciklanmayanFark, tarih: durum.tarih });
        }
      }
      // KSB-15: başarılı çekim hata sayacını sıfırlar ve durdurulmuş otomatik çekimi yeniden açar.
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.baglanti.update({
          where: { id: baglanti.id },
          data: {
            sonSenkronTarihi: new Date(),
            sonSenkronDenemesi: baslangicZamani,
            sonSenkronHatasi: null,
            ardisikHata: 0,
            otomatikDurduNedeni: null,
          },
        }),
      );
      return { yeniSatir, yinelenenSatir, bakiyeFarklari };
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : `${saglayici.ad} senkronizasyonu başarısız`;
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.baglanti.update({
          where: { id: baglanti.id },
          data: {
            sonSenkronHatasi: mesaj,
            sonSenkronDenemesi: baslangicZamani,
            ardisikHata: { increment: 1 },
            ...(otomatik && hata instanceof SaglayiciKimlikHatasi ? { otomatikDurduNedeni: mesaj } : {}),
          },
        }),
      );
      // Sağlayıcı hatası kullanıcıya nedeniyle döner; önceden "Beklenmeyen sunucu hatası" (500) görünüyordu.
      throw hata instanceof HttpException ? hata : new BadGatewayException(mesaj);
    }
  }

  /** KSB-15: çekilen banka bağlantılarının otomatik çekim ayarı ve son durumu. */
  async senkronDurumlari() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findMany({
        where: cekilenBaglanti(),
        select: {
          id: true,
          saglayici: true,
          durum: true,
          otomatikSenkronDk: true,
          sonSenkronTarihi: true,
          sonSenkronDenemesi: true,
          sonSenkronHatasi: true,
          ardisikHata: true,
          otomatikDurduNedeni: true,
        },
      }),
    );
  }

  /** KSB-15: aralığı kaydetmek durdurulmuş otomatik çekimi de yeniden açar. */
  async otomatikSenkronAyarla(baglantiId: string, dakika: number) {
    const { tenantId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.updateMany({
        where: { id: baglantiId, ...cekilenBaglanti() },
        data: { otomatikSenkronDk: dakika, otomatikDurduNedeni: null },
      }),
    );
    if (sonuc.count !== 1) throw new NotFoundException("Banka bağlantısı bulunamadı");
    return { otomatikSenkronDk: dakika };
  }

  /**
   * KSB-15: worker girişi — kiracının aralığı dolmuş aktif çekilen banka
   * bağlantılarını çeker. Hata çağırana taşınmaz; bağlantıda saklanır.
   */
  async vadesiGelenleriCek(simdi = new Date()): Promise<{ denenen: number; basarisiz: number }> {
    const { tenantId } = aktifBaglam();
    const adaylar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findMany({
        where: {
          ...cekilenBaglanti(),
          durum: "aktif",
          otomatikSenkronDk: { gt: 0 },
          otomatikDurduNedeni: null,
          bankaHesapEslemeleri: { some: {} },
        },
        select: { id: true, otomatikSenkronDk: true, sonSenkronDenemesi: true },
      }),
    );
    let denenen = 0;
    let basarisiz = 0;
    for (const b of adaylar) {
      if (b.sonSenkronDenemesi && simdi.getTime() - b.sonSenkronDenemesi.getTime() < b.otomatikSenkronDk * 60_000) continue;
      denenen++;
      try {
        await this.senkronize(b.id, true);
      } catch {
        basarisiz++;
      }
    }
    return { denenen, basarisiz };
  }
}
