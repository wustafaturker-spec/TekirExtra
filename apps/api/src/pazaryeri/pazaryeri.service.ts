import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { FaturaService } from "../fatura/fatura.service";
import { coz } from "../core/kripto";
import { TrendyolAdapter, type PazaryeriConfig } from "./trendyol.adapter";
import { HepsiburadaAdapter } from "./hepsiburada.adapter";
import { N11Adapter } from "./n11.adapter";
import { AmazonAdapter } from "./amazon.adapter";
import { Prisma } from "@prisma/client";
import { kurZorunlu } from "../doviz/kur-coz";
import { pazaryeriKesintiGiderlestirSemasi, pazaryeriKesintiSemasi, pazaryeriSiparisSemasi } from "./pazaryeri.semalar";

@Injectable()
export class PazaryeriService {
  constructor(private readonly prisma: PrismaService, private readonly faturalar: FaturaService) {}

  async listele(durum?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriSiparis.findMany({
      where: durum ? { durum: durum as never } : undefined,
      orderBy: { siparisTarihi: "desc" }, include: { satirlar: true, baglanti: { select: { id: true, saglayici: true, durum: true, sonSenkronTarihi: true, sonSenkronHatasi: true } }, cari: { select: { kod: true, unvan: true } }, fatura: { select: { id: true, no: true } } },
    }));
  }

  /** Adaptörlerin ortak biçime çevirdiği siparişi idempotent olarak kutuya alır. */
  async iceAktar(girdi: z.infer<typeof pazaryeriSiparisSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const baglanti = await tx.baglanti.findFirst({ where: { id: girdi.baglantiId, aile: "pazaryeri" } });
      if (!baglanti) throw new NotFoundException("Pazaryeri bağlantısı bulunamadı");
      const mevcut = await tx.pazaryeriSiparis.findUnique({ where: { tenantId_baglantiId_hariciId: { tenantId, baglantiId: girdi.baglantiId, hariciId: girdi.hariciId } } });
      if (mevcut) {
        if (mevcut.faturaId) return mevcut;
        const iptal = /cancel|iptal|cancelled|canceled/i.test(girdi.hariciDurum ?? "");
        return tx.pazaryeriSiparis.update({ where: { id: mevcut.id }, data: { hariciDurum: girdi.hariciDurum, siparisTarihi: new Date(girdi.siparisTarihi), musteriUnvani: girdi.musteriUnvani, musteriEposta: girdi.musteriEposta, musteriTelefon: girdi.musteriTelefon, vknTckn: girdi.vknTckn, toplam: girdi.toplam, teslimatAdresi: girdi.teslimatAdresi as never, hamVeri: girdi as never, ...(iptal ? { durum: "iptal", hataMesaji: null } : {}) }, include: { satirlar: true } });
      }

      const eslenen = await Promise.all(girdi.satirlar.map(async (satir) => {
        const varyant = await tx.stokVaryant.findFirst({ where: { aktif: true, OR: [{ kod: satir.sku }, ...(satir.barkod ? [{ barkod: satir.barkod }] : [])] }, select: { id: true, stokId: true } });
        if (varyant) return { ...satir, stokId: varyant.stokId, varyantId: varyant.id };
        const stok = await tx.stokKart.findFirst({ where: { aktif: true, OR: [{ kod: satir.sku }, ...(satir.barkod ? [{ barkod: satir.barkod }, { barkodlar: { some: { barkod: satir.barkod } } }] : [])] }, select: { id: true } });
        return { ...satir, stokId: stok?.id ?? null, varyantId: null };
      }));
      const tumuEslesti = eslenen.every((s) => s.stokId);
      return tx.pazaryeriSiparis.create({ data: {
        tenantId, baglantiId: girdi.baglantiId, hariciId: girdi.hariciId, siparisNo: girdi.siparisNo,
        hariciDurum: girdi.hariciDurum, siparisTarihi: new Date(girdi.siparisTarihi), musteriUnvani: girdi.musteriUnvani,
        musteriEposta: girdi.musteriEposta, musteriTelefon: girdi.musteriTelefon, vknTckn: girdi.vknTckn,
        dovizCinsi: girdi.dovizCinsi, toplam: girdi.toplam, teslimatAdresi: girdi.teslimatAdresi as never,
        durum: tumuEslesti ? "faturalanmaya_hazir" : "esleme_bekliyor", hamVeri: girdi as never,
        satirlar: { create: eslenen.map((s) => ({ tenantId, hariciSatirId: s.hariciSatirId, sku: s.sku, barkod: s.barkod, urunAdi: s.urunAdi, miktar: s.miktar, birimFiyat: s.birimFiyat, kdvOrani: s.kdvOrani, stokId: s.stokId, varyantId: s.varyantId })) },
      }, include: { satirlar: true } });
    });
  }

  async satirEsle(siparisId: string, satirId: string, girdi: { stokId: string; varyantId?: string | null }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const siparis = await tx.pazaryeriSiparis.findUnique({ where: { id: siparisId }, include: { satirlar: true } });
      if (!siparis) throw new NotFoundException("Sipariş bulunamadı");
      if (siparis.faturaId || siparis.durum === "iptal") throw new BadRequestException("Faturalanmış veya iptal edilmiş sipariş değiştirilemez");
      const satir = siparis.satirlar.find((s) => s.id === satirId); if (!satir) throw new NotFoundException("Sipariş satırı bulunamadı");
      const stok = await tx.stokKart.findUnique({ where: { id: girdi.stokId }, select: { id: true, aktif: true } });
      if (!stok?.aktif) throw new BadRequestException("Aktif stok kartı bulunamadı");
      if (girdi.varyantId) { const varyant = await tx.stokVaryant.findFirst({ where: { id: girdi.varyantId, stokId: girdi.stokId, aktif: true } }); if (!varyant) throw new BadRequestException("Stok varyantı bulunamadı"); }
      await tx.pazaryeriSiparisSatiri.update({ where: { id: satirId }, data: { stokId: girdi.stokId, varyantId: girdi.varyantId || null } });
      const kalan = siparis.satirlar.filter((s) => s.id !== satirId).some((s) => !s.stokId);
      return tx.pazaryeriSiparis.update({ where: { id: siparisId }, data: { durum: kalan ? "esleme_bekliyor" : "faturalanmaya_hazir", hataMesaji: null }, include: { satirlar: true } });
    });
  }

  async faturalastir(siparisler: { siparisId: string; cariId: string }[]) {
    const { tenantId } = aktifBaglam();
    const sonuclar: { siparisId: string; faturaId?: string; hata?: string }[] = [];
    for (const istek of siparisler) {
      try {
        const siparis = await this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriSiparis.findUnique({
          where: { id: istek.siparisId }, include: { satirlar: { include: { stok: { select: { anaBirim: true } } } } },
        }));
        if (!siparis) throw new NotFoundException("Sipariş bulunamadı");
        if (siparis.faturaId) { sonuclar.push({ siparisId: siparis.id, faturaId: siparis.faturaId }); continue; }
        if (siparis.durum !== "faturalanmaya_hazir") throw new BadRequestException("Yalnızca faturalanmaya hazır siparişler işlenebilir");
        if (siparis.satirlar.some((s) => !s.stokId)) throw new BadRequestException("Eşleşmemiş ürün kalemi var");
        const cari = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findFirst({ where: { id: istek.cariId, aktif: true }, select: { id: true } }));
        if (!cari) throw new BadRequestException("Aktif cari hesap bulunamadı");
        const kur = siparis.dovizCinsi === "TRY" ? new Prisma.Decimal(1) : await this.prisma.tenantIslem(tenantId, (tx) => kurZorunlu(tx, siparis.dovizCinsi, siparis.siparisTarihi, "alis", tenantId));
        const hak = await this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriSiparis.updateMany({ where: { id: siparis.id, faturaId: null, durum: "faturalanmaya_hazir" }, data: { durum: "yeni", hataMesaji: null } }));
        if (hak.count !== 1) throw new BadRequestException("Sipariş başka bir işlem tarafından işleniyor");
        const fatura = await this.faturalar.olustur({
          tip: "satis", tarih: siparis.siparisTarihi.toISOString().slice(0, 10), cariId: istek.cariId,
          dovizCinsi: siparis.dovizCinsi, kur: kur.toString(), genelIskontoYuzdesi: "0", genelIskontoTutari: "0",
          aciklama: `Pazaryeri siparişi ${siparis.siparisNo}`,
          satirlar: siparis.satirlar.map((s) => ({ stokId: s.stokId!, varyantId: s.varyantId, miktar: s.miktar.toString(), birim: s.stok?.anaBirim ?? "adet", birimFiyat: s.birimFiyat.toString(), iskontoOrani: "0", kdvOrani: s.kdvOrani.toString() })),
        });
        await this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriSiparis.update({ where: { id: siparis.id }, data: { cariId: istek.cariId, faturaId: fatura.id, durum: "faturalandi", hataMesaji: null } }));
        sonuclar.push({ siparisId: siparis.id, faturaId: fatura.id });
      } catch (hata) {
        const mesaj = hata instanceof Error ? hata.message : "Faturalaştırma hatası";
        await this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriSiparis.updateMany({ where: { id: istek.siparisId, faturaId: null }, data: { durum: "hata", hataMesaji: mesaj } }));
        sonuclar.push({ siparisId: istek.siparisId, hata: mesaj });
      }
    }
    return { sonuclar, basarili: sonuclar.filter((s) => s.faturaId).length, hatali: sonuclar.filter((s) => s.hata).length };
  }

  async senkronizeEt(baglantiId?: string) {
    const { tenantId } = aktifBaglam();
    const baglantilar = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findMany({
      where: { aile: "pazaryeri", durum: "aktif", ...(baglantiId ? { id: baglantiId } : {}) },
    }));
    if (baglantiId && !baglantilar.length) throw new NotFoundException("Aktif pazaryeri bağlantısı bulunamadı");
    const sonuclar = [];
    for (const baglanti of baglantilar) {
      try {
        const config = JSON.parse(coz(baglanti.sifreliConfig)) as PazaryeriConfig;
        const adapter = baglanti.saglayici === "trendyol" ? new TrendyolAdapter() : baglanti.saglayici === "hepsiburada" ? new HepsiburadaAdapter() : baglanti.saglayici === "n11" ? new N11Adapter() : baglanti.saglayici === "amazon_tr" ? new AmazonAdapter() : null;
        if (!adapter) throw new BadRequestException(`${baglanti.saglayici} canlı adaptörü henüz etkin değil`);
        let imlec = baglanti.senkronImleci; let eklenen = 0; let alinan = 0; let sayfaSayisi = 0;
        do {
          const sayfa = await adapter.siparisleriCek(config, imlec); sayfaSayisi += 1; alinan += sayfa.siparisler.length;
          for (const siparis of sayfa.siparisler) {
            const once = await this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriSiparis.findUnique({ where: { tenantId_baglantiId_hariciId: { tenantId, baglantiId: baglanti.id, hariciId: siparis.hariciId } }, select: { id: true } }));
            await this.iceAktar({ ...siparis, baglantiId: baglanti.id }); if (!once) eklenen += 1;
          }
          imlec = sayfa.sonrakiImlec;
          await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.update({ where: { id: baglanti.id }, data: { senkronImleci: imlec, sonSenkronTarihi: new Date(), sonSenkronHatasi: null } }));
        } while (imlec && sayfaSayisi < 50);
        sonuclar.push({ baglantiId: baglanti.id, saglayici: baglanti.saglayici, alinan, eklenen, sayfaSayisi, devamImleci: Boolean(imlec) });
      } catch (hata) {
        const mesaj = hata instanceof Error ? hata.message : "Senkronizasyon hatası";
        await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.update({ where: { id: baglanti.id }, data: { sonSenkronTarihi: new Date(), sonSenkronHatasi: mesaj } }));
        sonuclar.push({ baglantiId: baglanti.id, saglayici: baglanti.saglayici, alinan: 0, eklenen: 0, hata: mesaj });
      }
    }
    return { sonuclar };
  }

  async stokFiyatSenkronizeEt(baglantiId?: string) {
    const { tenantId } = aktifBaglam();
    const baglantilar = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findMany({
      where: { aile: "pazaryeri", durum: "aktif", saglayici: { in: ["trendyol", "hepsiburada", "n11", "amazon_tr"] }, ...(baglantiId ? { id: baglantiId } : {}) },
    }));
    if (baglantiId && !baglantilar.length) throw new NotFoundException("Stok/fiyat destekli aktif pazaryeri bağlantısı bulunamadı");
    const stoklar = await this.prisma.tenantIslem(tenantId, (tx) => tx.stokKart.findMany({
      where: { aktif: true, tip: "urun" },
      select: { kod: true, barkod: true, satisFiyati: true, mevcutMiktar: true, rezerveMiktar: true, varyantlar: { where: { aktif: true }, select: { kod: true, barkod: true, satisFiyati: true, mevcutMiktar: true, rezerveMiktar: true } } },
    }));
    const kalemler = stoklar.flatMap((stok) => {
      const kaynaklar = stok.varyantlar.length ? stok.varyantlar : [stok];
      return kaynaklar.map((k) => ({ sku: k.kod, barkod: k.barkod ?? "", miktar: Math.max(0, Number(k.mevcutMiktar) - Number(k.rezerveMiktar)), fiyat: Number(k.satisFiyati ?? stok.satisFiyati ?? 0) }));
    });
    const sonuclar = [];
    for (const baglanti of baglantilar) {
      try {
        const config = JSON.parse(coz(baglanti.sifreliConfig)) as PazaryeriConfig;
        const gecerli = kalemler.filter((k) => k.fiyat > 0 && (baglanti.saglayici !== "trendyol" || k.barkod));
        const adapter = baglanti.saglayici === "trendyol" ? new TrendyolAdapter() : baglanti.saglayici === "hepsiburada" ? new HepsiburadaAdapter() : baglanti.saglayici === "n11" ? new N11Adapter() : new AmazonAdapter();
        const sonuc = await adapter.stokFiyatGonder(config, gecerli);
        sonuclar.push({ baglantiId: baglanti.id, saglayici: baglanti.saglayici, ...sonuc, atlanan: kalemler.length - gecerli.length });
      } catch (hata) {
        sonuclar.push({ baglantiId: baglanti.id, saglayici: baglanti.saglayici, gonderilen: 0, islemIdleri: [], atlanan: kalemler.filter((k) => k.fiyat <= 0 || (baglanti.saglayici === "trendyol" && !k.barkod)).length, hata: hata instanceof Error ? hata.message : "Stok/fiyat senkronizasyon hatası" });
      }
    }
    return { sonuclar };
  }

  async kesintileriListele(durum?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriKesinti.findMany({
      where: durum ? { durum: durum as never } : undefined,
      orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
      include: { baglanti: { select: { id: true, saglayici: true, sonSenkronTarihi: true, sonSenkronHatasi: true } }, hareket: { select: { id: true, kasaId: true, bankaHesapId: true, kur: true, tutarTry: true } } },
    }));
  }

  async kesintiIceAktar(girdi: z.infer<typeof pazaryeriKesintiSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const baglanti = await tx.baglanti.findFirst({ where: { id: girdi.baglantiId, aile: "pazaryeri" }, select: { id: true } });
      if (!baglanti) throw new NotFoundException("Pazaryeri bağlantısı bulunamadı");
      return tx.pazaryeriKesinti.upsert({
        where: { tenantId_baglantiId_hariciId: { tenantId, baglantiId: girdi.baglantiId, hariciId: girdi.hariciId } },
        create: { ...girdi, tenantId, tarih: new Date(girdi.tarih), hamVeri: girdi.hamVeri as Prisma.InputJsonValue | undefined },
        update: { ...(girdi.siparisNo ? { siparisNo: girdi.siparisNo } : {}), tur: girdi.tur, aciklama: girdi.aciklama, tarih: new Date(girdi.tarih), ...(girdi.hamVeri ? { hamVeri: girdi.hamVeri as Prisma.InputJsonValue } : {}) },
      });
    });
  }

  async kesintileriGiderlestir(girdi: z.infer<typeof pazaryeriKesintiGiderlestirSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hesap = girdi.kasaId
        ? await tx.kasa.findFirst({ where: { id: girdi.kasaId, aktif: true }, select: { dovizCinsi: true } })
        : await tx.bankaHesap.findFirst({ where: { id: girdi.bankaHesapId, aktif: true }, select: { dovizCinsi: true } });
      if (!hesap) throw new NotFoundException("Aktif kasa/banka hesabı bulunamadı");
      const kesintiler = await tx.pazaryeriKesinti.findMany({ where: { id: { in: girdi.kesintiIds } } });
      if (kesintiler.length !== girdi.kesintiIds.length) throw new NotFoundException("Kesinti kayıtlarından biri bulunamadı");
      if (kesintiler.some((k) => k.durum === "giderlesti")) throw new BadRequestException("Seçilen kayıtlardan biri daha önce giderleştirilmiş");
      if (kesintiler.some((k) => k.dovizCinsi !== hesap.dovizCinsi)) throw new BadRequestException("Kesinti dövizi ile hesap dövizi aynı olmalıdır");
      for (const kesinti of kesintiler) {
        const kur = kesinti.dovizCinsi === "TRY" ? new Prisma.Decimal(1) : girdi.kur ? new Prisma.Decimal(girdi.kur) : await kurZorunlu(tx, kesinti.dovizCinsi, kesinti.tarih);
        const hak = await tx.pazaryeriKesinti.updateMany({ where: { id: kesinti.id, durum: "bekliyor", hareketId: null }, data: { durum: "giderlesti" } });
        if (hak.count !== 1) throw new BadRequestException("Kesinti başka bir işlem tarafından giderleştirildi");
        const hareket = await tx.kasaBankaHareket.create({ data: {
          tenantId, kasaId: girdi.kasaId, bankaHesapId: girdi.bankaHesapId, tip: "tediye",
          tutar: kesinti.tutar, dovizCinsi: kesinti.dovizCinsi, kur,
          tutarTry: kesinti.tutar.mul(kur).toDecimalPlaces(2), tarih: kesinti.tarih,
          aciklama: `Pazaryeri ${kesinti.tur}${kesinti.siparisNo ? ` · ${kesinti.siparisNo}` : ""}${kesinti.aciklama ? ` · ${kesinti.aciklama}` : ""}`,
          kaynakTur: "pazaryeri_kesinti", kaynakRef: kesinti.id,
        } });
        await tx.pazaryeriKesinti.update({ where: { id: kesinti.id }, data: { hareketId: hareket.id } });
      }
      return { giderlestirilen: kesintiler.length };
    });
  }

  async kesintileriSenkronizeEt(baglantiId?: string) {
    const { tenantId } = aktifBaglam();
    const baglantilar = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findMany({ where: { aile: "pazaryeri", durum: "aktif", saglayici: "amazon_tr", ...(baglantiId ? { id: baglantiId } : {}) } }));
    if (baglantiId && !baglantilar.length) throw new NotFoundException("Aktif Amazon TR bağlantısı bulunamadı");
    const sonuclar = [];
    for (const baglanti of baglantilar) {
      try {
        const config = JSON.parse(coz(baglanti.sifreliConfig)) as PazaryeriConfig;
        let imlec = baglanti.kesintiSenkronImleci; let eklenen = 0; let alinan = 0; let sayfaSayisi = 0;
        do {
          const sayfa = await new AmazonAdapter().komisyonKayitlariCek(config, imlec); sayfaSayisi += 1; alinan += sayfa.kesintiler.length;
          for (const kesinti of sayfa.kesintiler) {
            const once = await this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriKesinti.findUnique({ where: { tenantId_baglantiId_hariciId: { tenantId, baglantiId: baglanti.id, hariciId: kesinti.hariciId } }, select: { id: true } }));
            await this.kesintiIceAktar({ ...kesinti, baglantiId: baglanti.id }); if (!once) eklenen += 1;
          }
          imlec = sayfa.sonrakiImlec;
          const parsed = JSON.parse(imlec) as { token?: string };
          if (!parsed.token) break;
        } while (sayfaSayisi < 50);
        await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.update({ where: { id: baglanti.id }, data: { kesintiSenkronImleci: imlec, sonSenkronTarihi: new Date(), sonSenkronHatasi: null } }));
        sonuclar.push({ baglantiId: baglanti.id, saglayici: baglanti.saglayici, alinan, eklenen, sayfaSayisi });
      } catch (hata) {
        const mesaj = hata instanceof Error ? hata.message : "Kesinti senkronizasyon hatası";
        await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.update({ where: { id: baglanti.id }, data: { sonSenkronTarihi: new Date(), sonSenkronHatasi: mesaj } }));
        sonuclar.push({ baglantiId: baglanti.id, saglayici: baglanti.saglayici, alinan: 0, eklenen: 0, hata: mesaj });
      }
    }
    return { sonuclar };
  }
}
