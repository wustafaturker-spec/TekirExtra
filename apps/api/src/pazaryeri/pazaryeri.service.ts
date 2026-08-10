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
import { pazaryeriSiparisSemasi } from "./pazaryeri.semalar";

@Injectable()
export class PazaryeriService {
  constructor(private readonly prisma: PrismaService, private readonly faturalar: FaturaService) {}

  async listele(durum?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriSiparis.findMany({
      where: durum ? { durum: durum as never } : undefined,
      orderBy: { siparisTarihi: "desc" }, include: { satirlar: true, baglanti: { select: { saglayici: true } }, cari: { select: { kod: true, unvan: true } }, fatura: { select: { id: true, no: true } } },
    }));
  }

  /** Adaptörlerin ortak biçime çevirdiği siparişi idempotent olarak kutuya alır. */
  async iceAktar(girdi: z.infer<typeof pazaryeriSiparisSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const baglanti = await tx.baglanti.findFirst({ where: { id: girdi.baglantiId, aile: "pazaryeri" } });
      if (!baglanti) throw new NotFoundException("Pazaryeri bağlantısı bulunamadı");
      const mevcut = await tx.pazaryeriSiparis.findUnique({ where: { tenantId_baglantiId_hariciId: { tenantId, baglantiId: girdi.baglantiId, hariciId: girdi.hariciId } } });
      if (mevcut) return mevcut;

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

  async faturalastir(siparisler: { siparisId: string; cariId: string }[]) {
    const { tenantId } = aktifBaglam();
    const sonuclar: { siparisId: string; faturaId?: string; hata?: string }[] = [];
    for (const istek of siparisler) {
      try {
        const siparis = await this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriSiparis.findUnique({
          where: { id: istek.siparisId }, include: { satirlar: true },
        }));
        if (!siparis) throw new NotFoundException("Sipariş bulunamadı");
        if (siparis.faturaId) { sonuclar.push({ siparisId: siparis.id, faturaId: siparis.faturaId }); continue; }
        if (siparis.satirlar.some((s) => !s.stokId)) throw new BadRequestException("Eşleşmemiş ürün kalemi var");
        const fatura = await this.faturalar.olustur({
          tip: "satis", tarih: siparis.siparisTarihi.toISOString().slice(0, 10), cariId: istek.cariId,
          dovizCinsi: siparis.dovizCinsi, kur: "1", genelIskontoYuzdesi: "0", genelIskontoTutari: "0",
          aciklama: `Pazaryeri siparişi ${siparis.siparisNo}`,
          satirlar: siparis.satirlar.map((s) => ({ stokId: s.stokId!, varyantId: s.varyantId, miktar: s.miktar.toString(), birim: "adet", birimFiyat: s.birimFiyat.toString(), iskontoOrani: "0", kdvOrani: s.kdvOrani.toString() })),
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
        const sayfa = await adapter.siparisleriCek(config, baglanti.senkronImleci);
        let eklenen = 0;
        for (const siparis of sayfa.siparisler) {
          const once = await this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriSiparis.findUnique({ where: { tenantId_baglantiId_hariciId: { tenantId, baglantiId: baglanti.id, hariciId: siparis.hariciId } }, select: { id: true } }));
          await this.iceAktar({ ...siparis, baglantiId: baglanti.id }); if (!once) eklenen += 1;
        }
        await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.update({ where: { id: baglanti.id }, data: { senkronImleci: sayfa.sonrakiImlec, sonSenkronTarihi: new Date(), sonSenkronHatasi: null } }));
        sonuclar.push({ baglantiId: baglanti.id, saglayici: baglanti.saglayici, alinan: sayfa.siparisler.length, eklenen, devamImleci: Boolean(sayfa.sonrakiImlec) });
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
}
