import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { birimKatsayisiBul } from "./birim-cevrim";
import { alisBirimMaliyeti, maliyetleriYenidenHesapla, type MaliyetKurali, type YenidenHareket } from "./maliyet";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const FATURA_TERSLERI = ["fatura_iptal", "fatura_geri_alma"];

export interface KartMaliyetSonucu {
  stokId: string; kod: string; ad: string; mevcut: string;
  eskiOrtalama: string; yeniOrtalama: string; eskiDeger: string; yeniDeger: string;
  degisenHareket: number; uretimSarfiDegisen: number;
  /** Kartta tanımsız birimle yazılmış eski fatura satırları (katsayı 1 sayıldı). */
  tanimsizBirimler: string[];
  /** uygulamada yazılacak hareket maliyetleri */
  yazilacak: { id: string; eski: Prisma.Decimal; maliyet: Prisma.Decimal }[];
}

/**
 * STK-28: maliyeti yeniden hesapla. Hareketler tarih ve kayıt sırasıyla
 * yeniden işlenir; kurallar canlı yoldakiyle aynıdır (`maliyet.ts`). Son
 * kapalı mali dönemin sonuna kadarki hareketler sabittir.
 */
@Injectable()
export class StokMaliyetService {
  constructor(private readonly prisma: PrismaService) {}

  /** Yeniden yazımın başladığı gün: son kapalı ayın ertesi ayının 1'i (kapalı ay yoksa null). */
  private async acikBaslangic(tx: Tx): Promise<Date | null> {
    const son = await tx.maliDonem.findFirst({ where: { durum: "kapali" }, orderBy: [{ yil: "desc" }, { ay: "desc" }], select: { yil: true, ay: true } });
    return son ? new Date(Date.UTC(son.yil, son.ay, 1)) : null;
  }

  private async kartHesabi(tx: Tx, stokId: string, acik: Date | null): Promise<KartMaliyetSonucu | null> {
    const kart = await tx.stokKart.findUnique({ where: { id: stokId }, select: { id: true, kod: true, ad: true, tip: true, mevcutMiktar: true, ortalamaMaliyet: true } });
    if (!kart || kart.tip === "hizmet") return null;
    const hareketler = await tx.stokHareket.findMany({ where: { stokId }, orderBy: [{ tarih: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true, tip: true, miktar: true, maliyet: true, tarih: true, kaynakTur: true, kaynakRef: true, varyantId: true } });
    if (!hareketler.length) return null;
    const faturaIdleri = [...new Set(hareketler.filter((h) => h.kaynakRef && (h.kaynakTur === "fatura" || FATURA_TERSLERI.includes(h.kaynakTur ?? ""))).map((h) => h.kaynakRef!))];
    const faturalar = new Map((await tx.fatura.findMany({
      where: { id: { in: faturaIdleri } },
      select: { id: true, tip: true, kur: true, satirlar: { where: { stokId }, select: { varyantId: true, miktar: true, birim: true, matrah: true } }, iadeReferanslari: { select: { kaynakFaturaId: true } } },
    })).map((f) => [f.id, f]));
    const katsayilar = new Map<string, Prisma.Decimal>();
    const tanimsizBirimler = new Set<string>();
    // Birim doğrulamasından önce yazılmış satırlar kartta tanımsız birim taşıyabilir;
    // kesinleştirme o zaman katsayıyı 1 saymıştı, aynısı yapılır ve önizlemede gösterilir.
    const katsayi = async (birim: string) => {
      if (!katsayilar.has(birim)) katsayilar.set(birim, await birimKatsayisiBul(tx, stokId, birim).catch(() => { tanimsizBirimler.add(birim); return D(1); }));
      return katsayilar.get(birim)!;
    };

    // Faturanın bu ürün/varyant satırlarının net TL birim maliyeti (STK-25).
    const alisMaliyeti = async (f: NonNullable<ReturnType<typeof faturalar.get>>, varyantId: string | null) => {
      let matrah = D(0), miktar = D(0);
      for (const s of f.satirlar.filter((s) => (s.varyantId ?? null) === varyantId)) { matrah = matrah.add(s.matrah); miktar = miktar.add(s.miktar.mul(await katsayi(s.birim))); }
      return alisBirimMaliyeti(matrah, f.kur, miktar);
    };

    // İptal/geri alma tersinin çevirdiği hareketler: faturanın henüz çevrilmemiş ters yönlü hareketleri.
    const cevrilmemis = new Map<string, { id: string; giris: boolean; varyantId: string | null }[]>();
    const girdi: YenidenHareket[] = [];
    for (const h of hareketler) {
      const giris = h.miktar.gt(0);
      const f = h.kaynakRef ? faturalar.get(h.kaynakRef) : undefined;
      let kural: MaliyetKurali = giris ? { tur: "kayitli" } : { tur: "ortalama" };
      let maliyetliCikis = false;
      if (h.kaynakTur === "fatura" && f) {
        if (f.tip === "alis" || f.tip === "alis_iade") { kural = { tur: "sabit", maliyet: await alisMaliyeti(f, h.varyantId) }; maliyetliCikis = f.tip === "alis_iade"; }
        else if (f.tip === "satis_iade") {
          const kaynaklar = new Set(f.iadeReferanslari.flatMap((r) => (r.kaynakFaturaId ? [r.kaynakFaturaId] : [])));
          const ids = hareketler.filter((x) => x.kaynakTur === "fatura" && x.kaynakRef && kaynaklar.has(x.kaynakRef) && x.miktar.lt(0) && x.varyantId === h.varyantId).map((x) => x.id);
          kural = ids.length ? { tur: "kaynak", hareketIdleri: ids } : { tur: "ortalama" };
        }
        const liste = cevrilmemis.get(f.id) ?? [];
        liste.push({ id: h.id, giris, varyantId: h.varyantId });
        cevrilmemis.set(f.id, liste);
      } else if (FATURA_TERSLERI.includes(h.kaynakTur ?? "") && h.kaynakRef) {
        const liste = cevrilmemis.get(h.kaynakRef) ?? [];
        const ters = liste.filter((x) => x.giris !== giris && x.varyantId === h.varyantId);
        cevrilmemis.set(h.kaynakRef, liste.filter((x) => !ters.includes(x)));
        kural = ters.length ? { tur: "kaynak", hareketIdleri: ters.map((x) => x.id) } : giris ? { tur: "kayitli" } : { tur: "ortalama" };
        maliyetliCikis = !giris && ters.length > 0;
      } else if (h.tip === "transfer_giris") kural = { tur: "ortalama" };
      else if (h.kaynakTur === "sayim") kural = { tur: "sayim" }; // canlı sayım onayıyla aynı kural
      girdi.push({ id: h.id, miktar: h.miktar, maliyet: h.maliyet, giris, maliyetliCikis, sabit: Boolean(acik && h.tarih < acik), kural });
    }

    const { maliyetler, ortalama } = maliyetleriYenidenHesapla(girdi);
    const yazilacak = hareketler.flatMap((h) => {
      const yeni = maliyetler.get(h.id)!.toDecimalPlaces(4);
      return yeni.eq(h.maliyet) ? [] : [{ id: h.id, eski: h.maliyet, maliyet: yeni }];
    });
    const degisen = new Set(yazilacak.map((y) => y.id));
    const yeniOrtalama = ortalama.toDecimalPlaces(4);
    if (!yazilacak.length && yeniOrtalama.eq(kart.ortalamaMaliyet)) return null;
    return {
      stokId, kod: kart.kod, ad: kart.ad, mevcut: kart.mevcutMiktar.toFixed(3),
      eskiOrtalama: kart.ortalamaMaliyet.toFixed(4), yeniOrtalama: yeniOrtalama.toFixed(4),
      eskiDeger: kart.mevcutMiktar.mul(kart.ortalamaMaliyet).toFixed(2), yeniDeger: kart.mevcutMiktar.mul(yeniOrtalama).toFixed(2),
      degisenHareket: yazilacak.length,
      tanimsizBirimler: [...tanimsizBirimler],
      uretimSarfiDegisen: hareketler.filter((h) => degisen.has(h.id) && (h.kaynakTur ?? "").startsWith("uretim_") && h.miktar.lt(0)).length,
      yazilacak,
    };
  }

  private async hedefKartlar(tx: Tx, stokId?: string) {
    return stokId ? [stokId] : (await tx.stokKart.findMany({ where: { tip: { not: "hizmet" } }, select: { id: true }, orderBy: { kod: "asc" } })).map((k) => k.id);
  }

  async onizle(stokId?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const acik = await this.acikBaslangic(tx);
      const kartlar: Omit<KartMaliyetSonucu, "yazilacak">[] = [];
      for (const id of await this.hedefKartlar(tx, stokId)) {
        const s = await this.kartHesabi(tx, id, acik);
        if (s) { const { yazilacak: _y, ...gorunum } = s; kartlar.push(gorunum); }
      }
      return ozet(kartlar, acik);
    });
  }

  /** Her kart kendi işleminde, kart satırı kilitliyken yeniden hesaplanıp yazılır. */
  async uygula(stokId?: string) {
    const { tenantId, userId } = aktifBaglam();
    const idler = await this.prisma.tenantIslem(tenantId, (tx) => this.hedefKartlar(tx, stokId));
    const kartlar: Omit<KartMaliyetSonucu, "yazilacak">[] = [];
    let acik: Date | null = null;
    const calismaId = randomUUID();
    for (const id of idler) {
      const s = await this.prisma.tenantIslem(tenantId, async (tx) => {
        await tx.$queryRaw`SELECT id FROM stok_kartlari WHERE id = ${id}::uuid FOR UPDATE`;
        acik = await this.acikBaslangic(tx);
        const sonuc = await this.kartHesabi(tx, id, acik);
        if (!sonuc) return null;
        // Hareket değişmez kayıttır (NFR-08): yalnız maliyet sütunu güncellenir, eski değer geçmişe yazılır.
        for (const y of sonuc.yazilacak) await tx.stokHareket.update({ where: { id: y.id }, data: { maliyet: y.maliyet } });
        if (sonuc.yazilacak.length) await tx.stokMaliyetDuzeltme.createMany({ data: sonuc.yazilacak.map((y) => ({ tenantId, hareketId: y.id, calismaId, eskiMaliyet: y.eski, yeniMaliyet: y.maliyet, userId })) });
        await tx.stokKart.update({ where: { id }, data: { ortalamaMaliyet: D(sonuc.yeniOrtalama) } });
        return sonuc;
      });
      if (s) { const { yazilacak: _y, ...gorunum } = s; kartlar.push(gorunum); }
    }
    const sonuc = ozet(kartlar, acik);
    await this.prisma.tenantIslem(tenantId, (tx) => tx.auditLog.create({ data: { tenantId, userId, islem: "stok_maliyet_yeniden_hesap", varlik: "stok", varlikId: stokId ?? null, detay: { calismaId, kapsam: stokId ? "tek" : "tum", acikBaslangic: sonuc.acikBaslangic, kartSayisi: kartlar.length, hareketSayisi: sonuc.degisenHareket, degerFarki: sonuc.degerFarki, kartlar: kartlar.slice(0, 100).map((k) => ({ kod: k.kod, eski: k.eskiOrtalama, yeni: k.yeniOrtalama })) } as Prisma.InputJsonValue } }));
    return sonuc;
  }
}

function ozet(kartlar: Omit<KartMaliyetSonucu, "yazilacak">[], acik: Date | null) {
  const toplam = (alan: "eskiDeger" | "yeniDeger") => kartlar.reduce((t, k) => t.add(k[alan]), D(0));
  return {
    acikBaslangic: acik ? acik.toISOString().slice(0, 10) : null,
    kartlar,
    degisenHareket: kartlar.reduce((t, k) => t + k.degisenHareket, 0),
    uretimSarfiDegisen: kartlar.reduce((t, k) => t + k.uretimSarfiDegisen, 0),
    eskiDeger: toplam("eskiDeger").toFixed(2), yeniDeger: toplam("yeniDeger").toFixed(2),
    degerFarki: toplam("yeniDeger").sub(toplam("eskiDeger")).toFixed(2),
  };
}
