import { BadGatewayException, BadRequestException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { aktifBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { PrismaService } from "../core/prisma.service";
import { EkstreService } from "./ekstre.service";
import { VomsisAdapter, VomsisKimlikHatasi, type VomsisConfig } from "./vomsis.adapter";

@Injectable()
export class BankaEntegrasyonService {
  constructor(private readonly prisma: PrismaService, private readonly ekstre: EkstreService) {}

  async eslemeleriListele() { const { tenantId } = aktifBaglam(); return this.prisma.tenantIslem(tenantId, (tx) => tx.bankaBaglantiHesap.findMany({ orderBy: { createdAt: "asc" }, include: { baglanti: { select: { id: true, saglayici: true, durum: true } }, bankaHesap: { select: { id: true, ad: true, bankaAdi: true, dovizCinsi: true } } } })); }

  private vomsisConfig(sifreliConfig: string): VomsisConfig { const c = JSON.parse(coz(sifreliConfig)) as any; return { appKey: c.kullaniciAdi, appSecret: c.parola, baseUrl: c.servisAdresi }; }

  async vomsisHesaplari(baglantiId: string) { const { tenantId } = aktifBaglam(); const baglanti = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findFirst({ where: { id: baglantiId, aile: "banka", saglayici: "vomsis" } })); if (!baglanti) throw new NotFoundException("Vomsis bağlantısı bulunamadı"); const adapter = new VomsisAdapter(); const config = this.vomsisConfig(baglanti.sifreliConfig); try { const token = await adapter.tokenAl(config); return await adapter.hesaplariCek(config, token); } catch (hata) { throw new BadGatewayException(hata instanceof Error ? hata.message : "Vomsis hesapları alınamadı"); } }

  async eslemeEkle(girdi: { baglantiId: string; bankaHesapId: string; disHesapId: string }) {
    const { tenantId } = aktifBaglam();
    const [baglanti, hesap] = await this.prisma.tenantIslem(tenantId, async (tx) => Promise.all([tx.baglanti.findFirst({ where: { id: girdi.baglantiId, aile: "banka", saglayici: "vomsis" } }), tx.bankaHesap.findUnique({ where: { id: girdi.bankaHesapId } })]));
    if (!baglanti) throw new NotFoundException("Vomsis bağlantısı bulunamadı"); if (!hesap) throw new NotFoundException("Banka hesabı bulunamadı");
    const adapter = new VomsisAdapter(); const config = this.vomsisConfig(baglanti.sifreliConfig); const token = await adapter.tokenAl(config); const disHesap = (await adapter.hesaplariCek(config, token)).find((h) => String(h.id) === girdi.disHesapId);
    if (!disHesap) throw new NotFoundException("Vomsis hesabı bulunamadı"); const disDoviz = disHesap.fec_name === "TL" ? "TRY" : disHesap.fec_name;
    if (disDoviz !== hesap.dovizCinsi) throw new BadRequestException(`Döviz cinsi uyuşmuyor: Vomsis ${disDoviz}, TekirExtra ${hesap.dovizCinsi}`);
    return this.prisma.tenantIslem(tenantId, (tx) => tx.bankaBaglantiHesap.create({ data: { tenantId, ...girdi } }));
  }

  async senkronize(baglantiId: string, otomatik = false) {
    const { tenantId } = aktifBaglam();
    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findFirst({ where: { id: baglantiId, aile: "banka", saglayici: "vomsis", durum: "aktif" }, include: { bankaHesapEslemeleri: true } }));
    if (!baglanti) throw new NotFoundException("Aktif Vomsis bağlantısı bulunamadı");
    if (!baglanti.bankaHesapEslemeleri.length) throw new BadRequestException("Vomsis hesabı eşlemesi bulunamadı");
    const config = this.vomsisConfig(baglanti.sifreliConfig);
    const adapter = new VomsisAdapter();
    const baslangicZamani = new Date();
    try {
      const token = await adapter.tokenAl(config);
      let yeniSatir = 0;
      let yinelenenSatir = 0;
      for (const esleme of baglanti.bankaHesapEslemeleri) {
        const simdi = new Date();
        const bitis = new Date(simdi.getTime() + 86_400_000);
        const baslangic = esleme.sonSenkronTarihi ? new Date(esleme.sonSenkronTarihi.getTime() - 86_400_000) : new Date(simdi.getTime() - 7 * 86_400_000);
        const hareketler = await adapter.hareketleriCek(config, token, esleme.disHesapId, baslangic, bitis, esleme.sonHareketId);
        const sonuc = hareketler.length
          ? await this.ekstre.webhookHareketleriniAl(tenantId, esleme.bankaHesapId, `vomsis:${baglanti.id}`, hareketler.map((h) => ({ id: String(h.id), tarih: (h.accounting_date || h.system_date).slice(0, 10), tutar: (h.type === "borclu" ? -1 : 1) * Math.abs(Number(h.amount)), aciklama: h.description || "Vomsis banka hareketi", dekontNo: h.fis_no ?? h.resource_code ?? undefined, karsiIban: h.opponent_iban ?? undefined, karsiUnvan: h.opponent_title ?? undefined, bakiye: h.current_balance == null ? undefined : Number(h.current_balance) })))
          : { yeniSatir: 0, yinelenenSatir: 0 };
        yeniSatir += sonuc.yeniSatir;
        yinelenenSatir += sonuc.yinelenenSatir;
        const sonId = hareketler.reduce((m, h) => Math.max(m, h.id), Number(esleme.sonHareketId ?? 0));
        await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaBaglantiHesap.update({ where: { id: esleme.id }, data: { sonHareketId: sonId ? String(sonId) : esleme.sonHareketId, sonSenkronTarihi: new Date() } }));
      }
      // KSB-15: başarılı çekim hata sayacını sıfırlar ve durdurulmuş otomatik çekimi yeniden açar.
      await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.update({ where: { id: baglanti.id }, data: { sonSenkronTarihi: new Date(), sonSenkronDenemesi: baslangicZamani, sonSenkronHatasi: null, ardisikHata: 0, otomatikDurduNedeni: null } }));
      return { yeniSatir, yinelenenSatir };
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : "Vomsis senkronizasyonu başarısız";
      await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.update({
        where: { id: baglanti.id },
        data: {
          sonSenkronHatasi: mesaj,
          sonSenkronDenemesi: baslangicZamani,
          ardisikHata: { increment: 1 },
          ...(otomatik && hata instanceof VomsisKimlikHatasi ? { otomatikDurduNedeni: mesaj } : {}),
        },
      }));
      // Sağlayıcı hatası kullanıcıya nedeniyle döner; önceden "Beklenmeyen sunucu hatası" (500) görünüyordu.
      throw hata instanceof HttpException ? hata : new BadGatewayException(mesaj);
    }
  }

  /** KSB-15: Vomsis bağlantılarının otomatik çekim ayarı ve son durumu. */
  async senkronDurumlari() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findMany({
      where: { aile: "banka", saglayici: "vomsis" },
      select: { id: true, durum: true, otomatikSenkronDk: true, sonSenkronTarihi: true, sonSenkronDenemesi: true, sonSenkronHatasi: true, ardisikHata: true, otomatikDurduNedeni: true },
    }));
  }

  /** KSB-15: aralığı kaydetmek durdurulmuş otomatik çekimi de yeniden açar. */
  async otomatikSenkronAyarla(baglantiId: string, dakika: number) {
    const { tenantId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.updateMany({
      where: { id: baglantiId, aile: "banka", saglayici: "vomsis" },
      data: { otomatikSenkronDk: dakika, otomatikDurduNedeni: null },
    }));
    if (sonuc.count !== 1) throw new NotFoundException("Vomsis bağlantısı bulunamadı");
    return { otomatikSenkronDk: dakika };
  }

  /**
   * KSB-15: worker girişi — kiracının aralığı dolmuş aktif Vomsis
   * bağlantılarını çeker. Hata çağırana taşınmaz; bağlantıda saklanır.
   */
  async vadesiGelenleriCek(simdi = new Date()): Promise<{ denenen: number; basarisiz: number }> {
    const { tenantId } = aktifBaglam();
    const adaylar = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findMany({
      where: { aile: "banka", saglayici: "vomsis", durum: "aktif", otomatikSenkronDk: { gt: 0 }, otomatikDurduNedeni: null, bankaHesapEslemeleri: { some: {} } },
      select: { id: true, otomatikSenkronDk: true, sonSenkronDenemesi: true },
    }));
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
