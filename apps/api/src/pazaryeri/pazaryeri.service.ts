import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { bugunTR } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { FaturaService } from "../fatura/fatura.service";
import { coz } from "../core/kripto";
import { TrendyolAdapter, type NormalizeKesinti, type PazaryeriConfig } from "./trendyol.adapter";
import { cekimPencereleri } from "./trendyol-finans";
import { HepsiburadaAdapter } from "./hepsiburada.adapter";
import { N11Adapter } from "./n11.adapter";
import { AmazonAdapter } from "./amazon.adapter";
import { Prisma } from "@prisma/client";
import { kurZorunlu } from "../doviz/kur-coz";
import { pazaryeriKesintiGiderlestirSemasi, pazaryeriKesintiSemasi, pazaryeriSiparisSemasi } from "./pazaryeri.semalar";
import { pazaryeriFaturaSatirlari } from "./pazaryeri-fiyat";
import { kesintiBaslangicDurumu, kesintiSinifiBul, type KesintiSinifi } from "./pazaryeri-kesinti-sinifi";

@Injectable()
export class PazaryeriService {
  constructor(private readonly prisma: PrismaService, private readonly faturalar: FaturaService, @Optional() private readonly donemKilidi?: DonemKilidiService) {}

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
          where: { id: istek.siparisId }, include: { satirlar: { include: { stok: { select: { anaBirim: true, kdvOrani: true } } } } },
        }));
        if (!siparis) throw new NotFoundException("Sipariş bulunamadı");
        if (siparis.faturaId) { sonuclar.push({ siparisId: siparis.id, faturaId: siparis.faturaId }); continue; }
        if (siparis.durum !== "faturalanmaya_hazir") throw new BadRequestException("Yalnızca faturalanmaya hazır siparişler işlenebilir");
        if (siparis.satirlar.some((s) => !s.stokId)) throw new BadRequestException("Eşleşmemiş ürün kalemi var");
        const cari = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findFirst({ where: { id: istek.cariId, aktif: true }, select: { id: true } }));
        if (!cari) throw new BadRequestException("Aktif cari hesap bulunamadı");
        const kur = siparis.dovizCinsi === "TRY" ? new Prisma.Decimal(1) : await this.prisma.tenantIslem(tenantId, (tx) => kurZorunlu(tx, siparis.dovizCinsi, siparis.siparisTarihi, "alis", tenantId));
        // PZR-01/03: pazaryeri fiyatı KDV dahildir; matrah iç yüzdeyle ayrılır, toplam siparişle kuruşuna eşleşmezse fatura açılmaz.
        // KDV oranı pazaryerinin gönderdiği (müşteriden o alındı), yoksa stok kartınınki.
        const net = pazaryeriFaturaSatirlari(siparis.satirlar.map((s) => ({
          stokId: s.stokId!, miktar: s.miktar, kdvDahilBirimFiyat: s.birimFiyat, kdvOrani: s.kdvOrani ?? s.stok?.kdvOrani ?? 20,
        })), siparis.toplam);
        const hak = await this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriSiparis.updateMany({ where: { id: siparis.id, faturaId: null, durum: "faturalanmaya_hazir" }, data: { durum: "yeni", hataMesaji: null } }));
        if (hak.count !== 1) throw new BadRequestException("Sipariş başka bir işlem tarafından işleniyor");
        const fatura = await this.faturalar.olustur({
          tip: "satis", tarih: siparis.siparisTarihi.toISOString().slice(0, 10), cariId: istek.cariId,
          dovizCinsi: siparis.dovizCinsi, kur: kur.toString(), genelIskontoYuzdesi: "0", genelIskontoTutari: "0",
          // PZR-01: KDV satır yuvarlamasından doğan kuruş farkı açıklamada belirtilir.
          aciklama: `Pazaryeri siparişi ${siparis.siparisNo}` + (Number(net.fark) ? ` · Pazaryeri tahsilatı ${new Prisma.Decimal(siparis.toplam).toFixed(2)}; KDV satır yuvarlaması farkı ${net.fark}` : ""),
          satirlar: siparis.satirlar.map((s, i) => ({ stokId: s.stokId!, varyantId: s.varyantId, miktar: s.miktar.toString(), birim: s.stok?.anaBirim ?? "adet", birimFiyat: net.satirlar[i].birimFiyat, iskontoOrani: "0", kdvOrani: net.satirlar[i].kdvOrani })),
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
      include: { masraf: { select: { id: true, durum: true, kategori: { select: { ad: true } } } }, baglanti: { select: { id: true, saglayici: true, sonSenkronTarihi: true, sonSenkronHatasi: true } }, hareket: { select: { id: true, kasaId: true, bankaHesapId: true, kur: true, tutarTry: true } } },
    }));
  }

  async kesintiIceAktar(girdi: z.infer<typeof pazaryeriKesintiSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const baglanti = await tx.baglanti.findFirst({ where: { id: girdi.baglantiId, aile: "pazaryeri" }, select: { id: true } });
      if (!baglanti) throw new NotFoundException("Pazaryeri bağlantısı bulunamadı");
      // PZR-08: kullanıcının bu bağlantı ve tür için seçtiği sınıf, ad kalıbından önce gelir.
      const kural = await tx.pazaryeriKesintiKurali.findUnique({ where: { tenantId_baglantiId_tur: { tenantId, baglantiId: girdi.baglantiId, tur: girdi.tur } }, select: { sinif: true } });
      const sinif = kural?.sinif ?? kesintiSinifiBul(girdi.tur);
      return tx.pazaryeriKesinti.upsert({
        where: { tenantId_baglantiId_hariciId: { tenantId, baglantiId: girdi.baglantiId, hariciId: girdi.hariciId } },
        // PZR-06/08: sınıf ad kalıbından; faturasız sınıf doğrudan `faturasiz`. Güncellemede sınıf/duruma dokunulmaz (kullanıcı seçimi korunur).
        create: { ...girdi, tenantId, tarih: new Date(girdi.tarih), hamVeri: girdi.hamVeri as Prisma.InputJsonValue | undefined, sinif, durum: kesintiBaslangicDurumu(sinif) },
        update: { ...(girdi.siparisNo ? { siparisNo: girdi.siparisNo } : {}), tur: girdi.tur, aciklama: girdi.aciklama, tarih: new Date(girdi.tarih), ...(girdi.hamVeri ? { hamVeri: girdi.hamVeri as Prisma.InputJsonValue } : {}) },
      });
    });
  }

  /**
   * PZR-11: eski giderleştirmelerin taraması. PZR-06 öncesinde kesinti doğrudan
   * kasa/banka gider hareketine (760) dönüştürülebiliyordu; aynı dönemin
   * komisyon e-Faturası da alış olarak işlendiyse gider iki kez yazılmıştır.
   * - `ciftKayitAdaylari`: stopaj dışı giderleştirilmiş kesinti + aynı ay,
   *   bağlantının fatura kesen VKN'sinden alış faturasına dönüşmüş e-Fatura.
   * - `yanlisHesapStopaj`: stopaj olduğu hâlde eski türle (760) yazılmış.
   * - `faturasiBulunamayan`: stopaj dışı giderleştirilmiş, aynı ay işlenmiş fatura yok (bilgi).
   * - `denetlenemeyen`: bağlantının fatura kesen VKN'si yok.
   * Yalnız rapordur; düzeltme `giderlestirmeyiGeriAl` ile kullanıcı onayıyla.
   */
  async giderlestirmeTaramasi() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kesintiler = await tx.pazaryeriKesinti.findMany({
        where: { durum: "giderlesti", hareketId: { not: null } },
        select: { id: true, tur: true, sinif: true, tarih: true, tutar: true, dovizCinsi: true, siparisNo: true, baglanti: { select: { id: true, saglayici: true, faturaKesenVkn: true } }, hareket: { select: { id: true, kaynakTur: true, tarih: true, tutarTry: true } } },
        orderBy: { tarih: "asc" }, take: 5_000,
      });
      const ayAnahtari = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      const vknler = [...new Set(kesintiler.map((k) => k.baglanti.faturaKesenVkn).filter((v): v is string => Boolean(v)))];
      const faturalar = vknler.length ? await tx.gelenEbelge.findMany({ where: { gonderenVkn: { in: vknler }, faturaId: { not: null } }, select: { id: true, gonderenVkn: true, belgeNo: true, tarih: true, genelToplam: true, faturaId: true } }) : [];
      const faturaHaritasi = new Map<string, typeof faturalar>();
      for (const f of faturalar) { const a = `${f.gonderenVkn}|${ayAnahtari(f.tarih)}`; faturaHaritasi.set(a, [...(faturaHaritasi.get(a) ?? []), f]); }
      const ozet = (k: (typeof kesintiler)[number]) => ({ id: k.id, tur: k.tur, sinif: k.sinif, tarih: k.tarih, tutar: k.tutar.toFixed(2), dovizCinsi: k.dovizCinsi, siparisNo: k.siparisNo, saglayici: k.baglanti.saglayici, hareketId: k.hareket!.id, hareketTry: k.hareket!.tutarTry.toFixed(2) });
      const ciftKayitAdaylari = []; const yanlisHesapStopaj = []; const faturasiBulunamayan = []; let denetlenemeyen = 0;
      for (const k of kesintiler) {
        if (k.sinif === "stopaj") { if (k.hareket?.kaynakTur === "pazaryeri_kesinti") yanlisHesapStopaj.push(ozet(k)); continue; }
        if (!k.baglanti.faturaKesenVkn) { denetlenemeyen++; continue; }
        const ayinFaturalari = faturaHaritasi.get(`${k.baglanti.faturaKesenVkn}|${ayAnahtari(k.tarih)}`) ?? [];
        if (ayinFaturalari.length) ciftKayitAdaylari.push({ ...ozet(k), faturalar: ayinFaturalari.map((f) => ({ id: f.id, belgeNo: f.belgeNo, tarih: f.tarih, toplam: f.genelToplam?.toFixed(2) ?? null, faturaId: f.faturaId })) });
        else faturasiBulunamayan.push(ozet(k));
      }
      return { ciftKayitAdaylari, yanlisHesapStopaj, faturasiBulunamayan, denetlenemeyen };
    });
  }

  /**
   * PZR-11: giderleştirmeyi geri alır (kullanıcı onayıyla). Hareketin dönemi
   * açıksa hareket silinir; kapalıysa bugünün tarihiyle ters kayıt atılır.
   * Banka ekstresine eşleşmiş hareket önce ekstreden çözülmelidir. Kesinti
   * sınıfının başlangıç durumuna döner (faturalı → bekliyor, eşleştirmeye
   * girer; stopaj → bekliyor, "Stopajı kaydet" ile 193'e yeniden yazılır).
   */
  async giderlestirmeyiGeriAl(kesintiIds: string[]) {
    const { tenantId } = aktifBaglam();
    const kapaliMi = async (tarih: Date) => {
      try { await this.donemKilidi?.tarihDogrula(tenantId, tarih, "geri alma"); return false; }
      catch (hata) { if (hata instanceof ConflictException) return true; throw hata; }
    };
    const kesintiler = await this.prisma.tenantIslem(tenantId, (tx) => tx.pazaryeriKesinti.findMany({ where: { id: { in: kesintiIds } }, select: { id: true, sinif: true, durum: true, hareket: { select: { id: true, tarih: true, ekstreSatirId: true } } } }));
    if (kesintiler.length !== kesintiIds.length) throw new NotFoundException("Kesinti kayıtlarından biri bulunamadı");
    if (kesintiler.some((k) => k.durum !== "giderlesti" || !k.hareket)) throw new BadRequestException("Yalnız kasa/banka hareketine dönüşmüş (giderleştirilmiş) kesinti geri alınabilir");
    if (kesintiler.some((k) => k.hareket!.ekstreSatirId)) throw new BadRequestException("Hareketlerden biri banka ekstresine eşleşmiş; önce Banka Ekstresi ekranından eşleşmeyi geri alın");
    const kapalilar = new Set<string>();
    for (const k of kesintiler) if (await kapaliMi(k.hareket!.tarih)) kapalilar.add(k.id);
    const bugun = new Date(`${bugunTR()}T00:00:00.000Z`);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (kapalilar.size) await this.donemKilidi?.tarihDogrula(tenantId, bugun, "ters kayıt", tx);
      let silinen = 0; let tersKayit = 0;
      for (const k of kesintiler) {
        const { count } = await tx.pazaryeriKesinti.updateMany({ where: { id: k.id, durum: "giderlesti", hareketId: k.hareket!.id }, data: { durum: kesintiBaslangicDurumu(k.sinif as KesintiSinifi), hareketId: null } });
        if (count !== 1) throw new BadRequestException("Kesintilerden biri bu sırada değişti; listeyi yenileyip yeniden deneyin");
        const h = await tx.kasaBankaHareket.findUniqueOrThrow({ where: { id: k.hareket!.id } });
        if (kapalilar.has(k.id)) {
          await tx.kasaBankaHareket.create({ data: {
            tenantId, kasaId: h.kasaId, bankaHesapId: h.bankaHesapId, tip: h.tip === "tediye" ? "tahsilat" : "tediye", tutar: h.tutar, dovizCinsi: h.dovizCinsi, kur: h.kur, tutarTry: h.tutarTry, tarih: bugun,
            aciklama: `Ters kayıt: ${h.aciklama ?? "pazaryeri kesintisi"} — giderleştirme geri alındı (PZR-11)`.slice(0, 500), kaynakTur: "ters_kayit", kaynakRef: h.id,
          } });
          tersKayit++;
        } else {
          await tx.kasaBankaHareket.delete({ where: { id: h.id } });
          silinen++;
        }
      }
      return { geriAlinan: kesintiler.length, silinen, tersKayit };
    });
  }

  /**
   * PZR-10: faturasız kesintiyi (ceza, diğer) masraf kaydına dönüştürür.
   * Kesinti başına bir masraf: KDV'siz, seçilen kategoride, pazaryeri carisine
   * borç (komisyon faturalarıyla aynı cari), **onaylı**; ödemesi pazaryeri
   * hakedişinden mahsup edilir (kasa/banka hareketi açılmaz). Masraf, masraflar
   * ekranından iptal edilirse kesinti faturasıza döner. Tek işlem.
   */
  async kesintileriMasrafla(girdi: { kesintiIds: string[]; kategoriId: string; cariId: string; kur?: number }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [kategori, cari, kesintiler] = await Promise.all([
        tx.masrafKategori.findUnique({ where: { id: girdi.kategoriId }, select: { id: true, ad: true } }),
        tx.cariHesap.findFirst({ where: { id: girdi.cariId, aktif: true }, select: { id: true, unvan: true, vknTckn: true } }),
        tx.pazaryeriKesinti.findMany({ where: { id: { in: girdi.kesintiIds } }, include: { baglanti: { select: { saglayici: true } } } }),
      ]);
      if (!kategori) throw new BadRequestException("Masraf kategorisi bulunamadı");
      if (!cari) throw new BadRequestException("Aktif cari hesap bulunamadı");
      if (kesintiler.length !== girdi.kesintiIds.length) throw new NotFoundException("Kesinti kayıtlarından biri bulunamadı");
      if (kesintiler.some((k) => k.sinif !== "ceza" && k.sinif !== "diger_faturasiz")) throw new BadRequestException("Yalnız ceza ve diğer faturasız kesintiler masrafa dönüştürülür; faturalı kesintinin gideri e-Faturadan, stopaj 193'e yazılır");
      if (kesintiler.some((k) => !k.tutar.gt(0))) throw new BadRequestException("Eksi tutarlı (satıcı lehine) kesinti masrafa dönüştürülemez");
      if (kesintiler.some((k) => k.durum !== "faturasiz" || k.masrafId || k.hareketId)) throw new BadRequestException("Seçilen kesintilerden biri faturasız durumda değil ya da zaten işlenmiş");
      const masrafIdleri: string[] = [];
      for (const k of kesintiler) {
        await this.donemKilidi?.tarihDogrula(tenantId, k.tarih, "pazaryeri kesintisinin masraf kaydı", tx);
        const kur = k.dovizCinsi === "TRY" ? new Prisma.Decimal(1) : girdi.kur ? new Prisma.Decimal(girdi.kur) : await kurZorunlu(tx, k.dovizCinsi, k.tarih);
        const aciklama = `Pazaryeri ${k.sinif === "ceza" ? "cezası" : "kesintisi"} · ${k.tur}${k.siparisNo ? ` · sipariş ${k.siparisNo}` : ""}${k.aciklama ? ` · ${k.aciklama}` : ""}`.slice(0, 500);
        const masraf = await tx.masraf.create({ data: {
          tenantId, kategoriId: kategori.id, cariId: cari.id, belgeTuru: "diger", belgeNo: k.siparisNo ?? null, tarih: k.tarih,
          saticiUnvan: cari.unvan, vknTckn: cari.vknTckn ?? null, aciklama, matrah: k.tutar, kdvOrani: 0, kdvTutari: 0, toplam: k.tutar,
          dovizCinsi: k.dovizCinsi, kur, durum: "onaylandi", kaynakTur: "pazaryeri_kesinti",
        } });
        // Masraf onayıyla aynı: carinin alacağı (MasraflarService.onayla).
        await tx.cariHareket.create({ data: {
          tenantId, cariId: cari.id, tip: "alacak", tutar: k.tutar, dovizCinsi: k.dovizCinsi, kur, tutarTry: k.tutar.mul(kur).toDecimalPlaces(2),
          tarih: k.tarih, aciklama: `${cari.unvan} masraf kaydı (${kategori.ad} · pazaryeri kesintisi)`, kaynakTur: "masraf", kaynakRef: masraf.id,
        } });
        const { count } = await tx.pazaryeriKesinti.updateMany({ where: { id: k.id, durum: "faturasiz", masrafId: null, hareketId: null }, data: { durum: "masrafa_donustu", masrafId: masraf.id } });
        if (count !== 1) throw new BadRequestException("Kesintilerden biri bu sırada değişti; listeyi yenileyip yeniden deneyin");
        masrafIdleri.push(masraf.id);
      }
      return { masrafaDonusen: masrafIdleri.length, masrafIdleri };
    });
  }

  /**
   * PZR-09: yıllık e-ticaret stopajı özeti (beyannamede mahsup için). Aylara
   * göre kesilen stopaj (pazaryerinin dövizinde), kasa/banka hareketine
   * kaydedilen (TRY karşılığı) ve kaydedilmeyi bekleyen kesintiler.
   */
  async stopajOzeti(yil: number) {
    const { tenantId } = aktifBaglam();
    const bas = new Date(Date.UTC(yil, 0, 1)); const son = new Date(Date.UTC(yil + 1, 0, 1));
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kesintiler = await tx.pazaryeriKesinti.findMany({
        where: { sinif: "stopaj", tarih: { gte: bas, lt: son } },
        select: { tarih: true, tutar: true, dovizCinsi: true, durum: true, hareket: { select: { tutarTry: true } } },
      });
      const aylar = Array.from({ length: 12 }, (_, i) => ({ ay: i + 1, kesilen: {} as Record<string, string>, kaydedilenAdet: 0, kaydedilenTry: "0.00", bekleyenAdet: 0 }));
      let yilKaydedilenTry = new Prisma.Decimal(0); const yilKesilen: Record<string, string> = {};
      for (const k of kesintiler) {
        const a = aylar[k.tarih.getUTCMonth()];
        a.kesilen[k.dovizCinsi] = new Prisma.Decimal(a.kesilen[k.dovizCinsi] ?? 0).add(k.tutar).toFixed(2);
        yilKesilen[k.dovizCinsi] = new Prisma.Decimal(yilKesilen[k.dovizCinsi] ?? 0).add(k.tutar).toFixed(2);
        if (k.hareket) { a.kaydedilenAdet++; a.kaydedilenTry = new Prisma.Decimal(a.kaydedilenTry).add(k.hareket.tutarTry).toFixed(2); yilKaydedilenTry = yilKaydedilenTry.add(k.hareket.tutarTry); }
        else if (k.durum === "bekliyor") a.bekleyenAdet++;
      }
      return { yil, aylar, toplam: { kesilen: yilKesilen, kaydedilenTry: yilKaydedilenTry.toFixed(2), kaydedilenAdet: aylar.reduce((t, a) => t + a.kaydedilenAdet, 0), bekleyenAdet: aylar.reduce((t, a) => t + a.bekleyenAdet, 0) } };
    });
  }

  /**
   * PZR-08: kesinti türleri (bağlantı + tür adı) ve geçerli sınıfları. `kural`:
   * kullanıcı seçti; değilse ad kalıbından. Adet/tutar işlenmemiş (bekleyen,
   * faturasız) kesintiler içindir.
   */
  async kesintiTurleri() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [gruplar, kurallar, baglantilar] = await Promise.all([
        tx.pazaryeriKesinti.groupBy({ by: ["baglantiId", "tur", "sinif", "dovizCinsi"], where: { durum: { in: ["bekliyor", "faturasiz"] } }, _count: { _all: true }, _sum: { tutar: true } }),
        tx.pazaryeriKesintiKurali.findMany({ select: { baglantiId: true, tur: true, sinif: true, updatedAt: true } }),
        tx.baglanti.findMany({ where: { aile: "pazaryeri" }, select: { id: true, saglayici: true } }),
      ]);
      const kuralHaritasi = new Map(kurallar.map((k) => [`${k.baglantiId}|${k.tur}`, k]));
      const saglayici = new Map(baglantilar.map((b) => [b.id, b.saglayici]));
      const turler = new Map<string, { baglantiId: string; saglayici: string; tur: string; sinif: KesintiSinifi; kural: boolean; adet: number; tutarlar: Record<string, string> }>();
      for (const g of gruplar) {
        const anahtar = `${g.baglantiId}|${g.tur}`;
        const kural = kuralHaritasi.get(anahtar);
        const t = turler.get(anahtar) ?? { baglantiId: g.baglantiId, saglayici: saglayici.get(g.baglantiId) ?? "", tur: g.tur, sinif: (kural?.sinif ?? g.sinif) as KesintiSinifi, kural: Boolean(kural), adet: 0, tutarlar: {} };
        t.adet += g._count._all;
        t.tutarlar[g.dovizCinsi] = new Prisma.Decimal(t.tutarlar[g.dovizCinsi] ?? 0).add(g._sum.tutar ?? 0).toFixed(2);
        turler.set(anahtar, t);
      }
      // İşlenmemiş kesintisi kalmamış kurallar da görünür (düzeltilebilsin).
      for (const k of kurallar) {
        const anahtar = `${k.baglantiId}|${k.tur}`;
        if (!turler.has(anahtar)) turler.set(anahtar, { baglantiId: k.baglantiId, saglayici: saglayici.get(k.baglantiId) ?? "", tur: k.tur, sinif: k.sinif as KesintiSinifi, kural: true, adet: 0, tutarlar: {} });
      }
      return [...turler.values()].sort((a, b) => Number(b.sinif === "siniflandirilmamis") - Number(a.sinif === "siniflandirilmamis") || b.adet - a.adet || a.tur.localeCompare(b.tur, "tr"));
    });
  }

  /**
   * PZR-08: türün sınıfını seçer ve kalıcı kural yapar. O bağlantıdaki aynı
   * türün işlenmemiş (bekleyen ya da faturasız) kesintileri yeni sınıfa ve
   * başlangıç durumuna geçer; giderleştirilmiş ya da faturayla eşleşmiş
   * kayıtlara dokunulmaz.
   */
  async kesintiTuruSinifla(girdi: { baglantiId: string; tur: string; sinif: KesintiSinifi }) {
    const { tenantId } = aktifBaglam();
    if (girdi.sinif === "siniflandirilmamis") throw new BadRequestException("Bir sınıf seçin");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const baglanti = await tx.baglanti.findFirst({ where: { id: girdi.baglantiId, aile: "pazaryeri" }, select: { id: true } });
      if (!baglanti) throw new NotFoundException("Pazaryeri bağlantısı bulunamadı");
      await tx.pazaryeriKesintiKurali.upsert({
        where: { tenantId_baglantiId_tur: { tenantId, baglantiId: girdi.baglantiId, tur: girdi.tur } },
        create: { tenantId, baglantiId: girdi.baglantiId, tur: girdi.tur, sinif: girdi.sinif },
        update: { sinif: girdi.sinif },
      });
      const { count } = await tx.pazaryeriKesinti.updateMany({
        where: { baglantiId: girdi.baglantiId, tur: girdi.tur, durum: { in: ["bekliyor", "faturasiz"] }, hareketId: null },
        data: { sinif: girdi.sinif, durum: kesintiBaslangicDurumu(girdi.sinif) },
      });
      return { guncellenen: count };
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
      if (kesintiler.some((k) => !k.tutar.gt(0))) throw new BadRequestException("Eksi tutarlı (iptal/iade) kesinti tek başına kaydedilemez; hakedişte ilgili kesintiyle birlikte netleşir");
      // PZR-06: gider pazaryerinin e-Faturasından yazılır; kesinti yalnız mutabakat kaydıdır. Yalnız stopaj kasa/banka hareketine döner (PZR-09).
      const stopajDisi = kesintiler.filter((k) => k.sinif !== "stopaj");
      if (stopajDisi.length) {
        const faturali = stopajDisi.some((k) => k.sinif === "faturali");
        throw new BadRequestException(faturali
          ? "Faturalı kesinti (komisyon, kargo, hizmet, reklam) giderleştirilmez: gider, pazaryerinin kestiği e-Faturadan alış olarak yazılır; kesinti o faturayla eşleştirilir."
          : "Yalnız stopaj kesintisi kasa/banka hareketine (mahsup edilecek stopaj, 193) kaydedilebilir. Sınıflandırılmamış kesintinin önce türünü belirleyin; ceza ve diğer faturasız kesintiler masraf kaydına dönüştürülür.");
      }
      if (kesintiler.some((k) => k.durum !== "bekliyor")) throw new BadRequestException("Yalnız bekleyen kesinti giderleştirilebilir");
      if (kesintiler.some((k) => k.dovizCinsi !== hesap.dovizCinsi)) throw new BadRequestException("Kesinti dövizi ile hesap dövizi aynı olmalıdır");
      for (const kesinti of kesintiler) {
        const kur = kesinti.dovizCinsi === "TRY" ? new Prisma.Decimal(1) : girdi.kur ? new Prisma.Decimal(girdi.kur) : await kurZorunlu(tx, kesinti.dovizCinsi, kesinti.tarih);
        const hak = await tx.pazaryeriKesinti.updateMany({ where: { id: kesinti.id, durum: "bekliyor", hareketId: null }, data: { durum: "giderlesti" } });
        if (hak.count !== 1) throw new BadRequestException("Kesinti başka bir işlem tarafından giderleştirildi");
        const hareket = await tx.kasaBankaHareket.create({ data: {
          tenantId, kasaId: girdi.kasaId, bankaHesapId: girdi.bankaHesapId, tip: "tediye",
          tutar: kesinti.tutar, dovizCinsi: kesinti.dovizCinsi, kur,
          tutarTry: kesinti.tutar.mul(kur).toDecimalPlaces(2), tarih: kesinti.tarih,
          // PZR-09: stopaj gider değil, gelir/kurumlar vergisinden mahsup edilecek peşin vergidir (muhasebede 193).
          aciklama: `Pazaryeri stopajı (mahsup edilecek) · ${kesinti.tur}${kesinti.siparisNo ? ` · ${kesinti.siparisNo}` : ""}${kesinti.aciklama ? ` · ${kesinti.aciklama}` : ""}`,
          kaynakTur: "pazaryeri_stopaj", kaynakRef: kesinti.id,
        } });
        await tx.pazaryeriKesinti.update({ where: { id: kesinti.id }, data: { hareketId: hareket.id } });
      }
      return { giderlestirilen: kesintiler.length };
    });
  }

  async kesintileriSenkronizeEt(baglantiId?: string) {
    const { tenantId } = aktifBaglam();
    const baglantilar = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findMany({ where: { aile: "pazaryeri", durum: "aktif", saglayici: { in: ["amazon_tr", "trendyol"] }, ...(baglantiId ? { id: baglantiId } : {}) } }));
    if (baglantiId && !baglantilar.length) throw new NotFoundException("Finans hareketi çekilebilen aktif pazaryeri bağlantısı bulunamadı (Amazon TR, Trendyol)");
    const sonuclar = [];
    for (const baglanti of baglantilar) {
      try {
        const config = JSON.parse(coz(baglanti.sifreliConfig)) as PazaryeriConfig;
        if (baglanti.saglayici === "trendyol") { sonuclar.push(await this.trendyolKesintileriCek(tenantId, baglanti, config)); continue; }
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

  /** PZR-15: Trendyol cari hesap ekstresinden kesintiler; 15 günlük pencereler, imleç son bitiş. */
  private async trendyolKesintileriCek(tenantId: string, baglanti: { id: string; saglayici: string; kesintiSenkronImleci: string | null }, config: PazaryeriConfig) {
    let sonBitis: number | null = null;
    try { sonBitis = baglanti.kesintiSenkronImleci ? Number((JSON.parse(baglanti.kesintiSenkronImleci) as { sonBitis?: number }).sonBitis) || null : null; } catch { sonBitis = null; }
    const pencereler = cekimPencereleri(sonBitis, Date.now() - 60_000);
    let alinan = 0; let eklenen = 0; let sayfaSayisi = 0;
    for (const p of pencereler) {
      const { kesintiler, istekSayisi } = await new TrendyolAdapter().finansKesintileriCek(config, p.baslangic, p.bitis);
      alinan += kesintiler.length; sayfaSayisi += istekSayisi;
      eklenen += await this.kesintileriTopluAktar(tenantId, baglanti.id, kesintiler);
      // Pencere bitince imleç ilerler; yarıda kalan çekim kaldığı pencereden sürer.
      await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.update({ where: { id: baglanti.id }, data: { kesintiSenkronImleci: JSON.stringify({ sonBitis: p.bitis }) } }));
    }
    await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.update({ where: { id: baglanti.id }, data: { sonSenkronTarihi: new Date(), sonSenkronHatasi: null } }));
    return { baglantiId: baglanti.id, saglayici: baglanti.saglayici, alinan, eklenen, sayfaSayisi };
  }

  /**
   * PZR-15: kesintileri tek işlemde aktarır; var olan (`hariciId`) değişmez.
   * Sınıf PZR-08 kuralından, yoksa ad kalıbından. Eklenen sayısını döner.
   */
  async kesintileriTopluAktar(tenantId: string, baglantiId: string, kesintiler: NormalizeKesinti[]): Promise<number> {
    if (!kesintiler.length) return 0;
    const tekil = [...new Map(kesintiler.map((k) => [k.hariciId, k])).values()];
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = new Set((await tx.pazaryeriKesinti.findMany({ where: { baglantiId, hariciId: { in: tekil.map((k) => k.hariciId) } }, select: { hariciId: true } })).map((k) => k.hariciId));
      const yeni = tekil.filter((k) => !mevcut.has(k.hariciId));
      if (!yeni.length) return 0;
      const kurallar = new Map((await tx.pazaryeriKesintiKurali.findMany({ where: { baglantiId, tur: { in: [...new Set(yeni.map((k) => k.tur))] } }, select: { tur: true, sinif: true } })).map((k) => [k.tur, k.sinif]));
      const { count } = await tx.pazaryeriKesinti.createMany({
        skipDuplicates: true,
        data: yeni.map((k) => {
          const sinif = kurallar.get(k.tur) ?? kesintiSinifiBul(k.tur);
          return { tenantId, baglantiId, hariciId: k.hariciId, siparisNo: k.siparisNo, tur: k.tur, aciklama: k.aciklama, tarih: new Date(k.tarih), tutar: k.tutar, dovizCinsi: k.dovizCinsi, hamVeri: k.hamVeri as Prisma.InputJsonValue | undefined, sinif, durum: kesintiBaslangicDurumu(sinif) };
        }),
      });
      return count;
    }, { timeout: 60_000 });
  }
}
