import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { bugunTR } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { kanuniDegerOku, yillikDegerOku } from "../mevzuat/kanuni-deger";
import {
  binekKkeg, gecerliYukumlulukler, kategoriOner, plakaGeciyor, sonrakiBakim, tuketim, yukumlulukDurumu, type GiderKategorisi, type KkegSonucu,
} from "./arac-hesap";
import type { aracGuncelleSemasi, bakimSemasi, cezaSemasi, giderBagSemasi, kmSemasi, yukumlulukSemasi } from "./arac-takip.semalar";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const SIFIR = D(0);
const yuvarla = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const gun = (t: Date | string) => (typeof t === "string" ? t.slice(0, 10) : t.toISOString().slice(0, 10));
const tarihD = (t: string) => new Date(`${t}T00:00:00Z`);
const kurus = (n: number) => Math.round(n * 100) / 100;

export const KATEGORI_ADLARI: Record<GiderKategorisi, string> = {
  akaryakit: "Akaryakıt", bakim: "Bakım-onarım", lastik: "Lastik", hgs: "HGS/OGS", otopark: "Otopark", sigorta: "Sigorta", mtv: "MTV", ceza: "Ceza", kira: "Kira", diger: "Diğer",
};
export const YUKUMLULUK_ADLARI: Record<string, string> = {
  muayene: "Muayene", trafik_sigortasi: "Trafik sigortası", kasko: "Kasko", mtv: "MTV", egzoz: "Egzoz emisyon", takograf: "Takograf", diger: "Diğer",
};

/** Masrafın ya da fatura satırının KDV hariç TL tutarı (fatura satırı muhasebe fişindeki gibi pay alır). */
async function kaynakOku(tx: Tx, g: { masrafId?: string; faturaSatirId?: string }) {
  if (g.masrafId) {
    const m = await tx.masraf.findUnique({ where: { id: g.masrafId }, select: { id: true, durum: true, tarih: true, matrah: true, kur: true, belgeNo: true, aciklama: true, saticiUnvan: true, kategori: { select: { ad: true } } } });
    if (!m) throw new NotFoundException("Masraf bulunamadı");
    if (m.durum !== "onaylandi") throw new BadRequestException("Yalnız onaylı masraf araca bağlanır");
    return { tarih: gun(m.tarih), tutarTry: yuvarla(D(m.matrah).mul(m.kur)), metin: [m.kategori.ad, m.saticiUnvan, m.aciklama, m.belgeNo].filter(Boolean).join(" · ") };
  }
  const s = await tx.faturaSatir.findUnique({
    where: { id: g.faturaSatirId! },
    select: { matrah: true, ekVergiTutari: true, stok: { select: { ad: true } }, fatura: { select: { tip: true, durum: true, tarih: true, no: true, kur: true, toplamMatrah: true, cari: { select: { unvan: true } }, satirlar: { select: { matrah: true } } } } },
  });
  if (!s) throw new NotFoundException("Fatura satırı bulunamadı");
  if (s.fatura.tip !== "alis" || s.fatura.durum !== "kesin") throw new BadRequestException("Yalnız kesin alış faturasının satırı araca bağlanır");
  const toplam = s.fatura.satirlar.reduce((t, x) => t.add(x.matrah), SIFIR);
  const pay = toplam.isZero() ? D(s.matrah) : D(s.fatura.toplamMatrah).mul(s.matrah).div(toplam);
  return { tarih: gun(s.fatura.tarih), tutarTry: yuvarla(pay.add(s.ekVergiTutari).mul(s.fatura.kur)), metin: [s.stok.ad, s.fatura.cari.unvan, s.fatura.no].filter(Boolean).join(" · ") };
}

@Injectable()
export class AracTakipService {
  constructor(private readonly prisma: PrismaService) {}

  private async aracAl(tx: Tx, id: string) {
    const a = await tx.arac.findUnique({ where: { id } });
    if (!a) throw new NotFoundException("Araç bulunamadı");
    return a;
  }

  private async personelAdlari(tx: Tx, idler: (string | null | undefined)[]) {
    const u = [...new Set(idler.filter((x): x is string => Boolean(x)))];
    if (!u.length) return new Map<string, string>();
    const p = await tx.personel.findMany({ where: { id: { in: u } }, select: { id: true, ad: true, soyad: true } });
    return new Map(p.map((x) => [x.id, `${x.ad} ${x.soyad}`]));
  }

  /** ARC-02: öz malda sorumlu demirbaş zimmetinden (verilen günde), değilse araç kartından. */
  private async sorumlu(tx: Tx, a: { demirbasId: string | null; sorumluPersonelId: string | null }, tarih = bugunTR()): Promise<string | null> {
    if (a.demirbasId) {
      const t = tarihD(tarih);
      const z = await tx.demirbasZimmet.findFirst({
        where: { demirbasId: a.demirbasId, personelId: { not: null }, baslangic: { lte: t }, OR: [{ bitis: null }, { bitis: { gt: t } }] },
        orderBy: { baslangic: "desc" }, select: { personelId: true },
      });
      if (z?.personelId) return z.personelId;
    }
    return a.sorumluPersonelId;
  }

  private async guncelKm(tx: Tx, aracId: string): Promise<number | null> {
    const k = await tx.aracKmKaydi.aggregate({ where: { aracId }, _max: { km: true } });
    return k._max.km;
  }

  /** ARC-08: önceki en büyük km'den düşük değer gerekçe ister. */
  private async kmYaz(tx: Tx, aracId: string, tarih: string, km: number, kaynak: "elle" | "gider" | "bakim", kaynakId: string | null, gerekce: string | null | undefined) {
    const { tenantId, userId } = aktifBaglam();
    const enBuyuk = await this.guncelKm(tx, aracId);
    if (enBuyuk != null && km < enBuyuk && !gerekce?.trim()) throw new BadRequestException(`Km (${km.toLocaleString("tr-TR")}) önceki kayıttan (${enBuyuk.toLocaleString("tr-TR")}) düşük; gerekçe yazın`);
    await tx.aracKmKaydi.create({ data: { tenantId, aracId, tarih: tarihD(tarih), km, kaynak, kaynakId, gerekce: gerekce?.trim() || null, userId } });
  }

  // ─── Liste ve kart ────────────────────────────────────────────────────

  async listele(tumu = false) {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const araclar = await tx.arac.findMany({ where: tumu ? {} : { aktif: true }, include: { yukumlulukler: { select: { tur: true, bitis: true } } }, orderBy: { plaka: "asc" } });
      const kmler = await tx.aracKmKaydi.groupBy({ by: ["aracId"], where: { aracId: { in: araclar.map((a) => a.id) } }, _max: { km: true } });
      const kmHaritasi = new Map(kmler.map((k) => [k.aracId, k._max.km]));
      const sorumlular = new Map<string, string | null>();
      for (const a of araclar) sorumlular.set(a.id, await this.sorumlu(tx, a));
      const adlar = await this.personelAdlari(tx, [...sorumlular.values()]);
      return araclar.map((a) => {
        const gecerli = gecerliYukumlulukler(a.yukumlulukler.map((y) => ({ tur: y.tur, bitis: gun(y.bitis) })));
        const ilk = gecerli[0];
        const km = kmHaritasi.get(a.id) ?? null;
        const bakim = sonrakiBakim({ kmAraligi: a.bakimKmAraligi, ayAraligi: a.bakimAyAraligi, sonTarih: a.sonBakimTarihi ? gun(a.sonBakimTarihi) : null, sonKm: a.sonBakimKm, guncelKm: km, bugun });
        const sid = sorumlular.get(a.id);
        return {
          id: a.id, plaka: a.plaka, marka: a.marka, model: a.model, modelYili: a.modelYili, tur: a.tur, mulkiyet: a.mulkiyet, aktif: a.aktif, km,
          sorumlu: sid ? adlar.get(sid) ?? null : null,
          enYakinYukumluluk: ilk ? { tur: ilk.tur, bitis: ilk.bitis, ...yukumlulukDurumu(ilk.bitis, bugun) } : null,
          bakim,
        };
      });
    });
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const a = await tx.arac.findUnique({
        where: { id },
        include: {
          yukumlulukler: { orderBy: [{ tur: "asc" }, { bitis: "desc" }] }, giderler: { orderBy: { tarih: "desc" } },
          kmKayitlari: { orderBy: [{ tarih: "desc" }, { km: "desc" }], take: 50 }, bakimlar: { orderBy: { tarih: "desc" } }, cezalar: { orderBy: { tarih: "desc" } },
        },
      });
      if (!a) throw new NotFoundException("Araç bulunamadı");
      const km = await this.guncelKm(tx, id);
      const sorumluId = await this.sorumlu(tx, a);
      const adlar = await this.personelAdlari(tx, [sorumluId, a.sorumluPersonelId, ...a.cezalar.map((c) => c.personelId)]);
      const [demirbas, kira] = await Promise.all([
        a.demirbasId ? tx.demirbas.findUnique({ where: { id: a.demirbasId }, select: { id: true, kod: true, ad: true, durum: true } }) : null,
        a.kiraSozlesmeId ? tx.kiraSozlesme.findUnique({ where: { id: a.kiraSozlesmeId }, select: { id: true, baslik: true, matrah: true, dovizCinsi: true, baslangicTarihi: true, bitisTarihi: true } }) : null,
      ]);
      const giderKaynaklari = await this.giderEtiketleri(tx, a.giderler);
      const gecerli = new Set(gecerliYukumlulukler(a.yukumlulukler.map((y) => ({ id: y.id, tur: y.tur, bitis: gun(y.bitis) }))).map((y) => y.id));
      return {
        ...a,
        sonBakimTarihi: a.sonBakimTarihi ? gun(a.sonBakimTarihi) : null,
        km, sorumluId, sorumlu: sorumluId ? adlar.get(sorumluId) ?? null : null, sorumluKaynak: a.demirbasId && sorumluId && sorumluId !== a.sorumluPersonelId ? "zimmet" : "kart",
        demirbas, kira,
        bakim: sonrakiBakim({ kmAraligi: a.bakimKmAraligi, ayAraligi: a.bakimAyAraligi, sonTarih: a.sonBakimTarihi ? gun(a.sonBakimTarihi) : null, sonKm: a.sonBakimKm, guncelKm: km, bugun }),
        yukumlulukler: a.yukumlulukler.map((y) => ({ ...y, baslangic: y.baslangic ? gun(y.baslangic) : null, bitis: gun(y.bitis), gecerli: gecerli.has(y.id), ...yukumlulukDurumu(gun(y.bitis), bugun) })),
        giderler: a.giderler.map((g) => ({ ...g, tarih: gun(g.tarih), kaynak: giderKaynaklari.get(g.id) ?? null })),
        kmKayitlari: a.kmKayitlari.map((k) => ({ ...k, tarih: gun(k.tarih) })),
        bakimlar: a.bakimlar.map((b) => ({ ...b, tarih: gun(b.tarih) })),
        cezalar: a.cezalar.map((c) => ({ ...c, tarih: gun(c.tarih), personel: c.personelId ? adlar.get(c.personelId) ?? null : null })),
      };
    });
  }

  private async giderEtiketleri(tx: Tx, giderler: { id: string; masrafId: string | null; faturaSatirId: string | null }[]) {
    const [masraflar, satirlar] = await Promise.all([
      tx.masraf.findMany({ where: { id: { in: giderler.map((g) => g.masrafId).filter((x): x is string => Boolean(x)) } }, select: { id: true, belgeNo: true, saticiUnvan: true, aciklama: true, kategori: { select: { ad: true } } } }),
      tx.faturaSatir.findMany({ where: { id: { in: giderler.map((g) => g.faturaSatirId).filter((x): x is string => Boolean(x)) } }, select: { id: true, stok: { select: { ad: true } }, fatura: { select: { id: true, no: true, cari: { select: { unvan: true } } } } } }),
    ]);
    const m = new Map(masraflar.map((x) => [x.id, { tur: "masraf" as const, id: x.id, etiket: [x.kategori.ad, x.saticiUnvan, x.belgeNo].filter(Boolean).join(" · "), aciklama: x.aciklama }]));
    const f = new Map(satirlar.map((x) => [x.id, { tur: "fatura" as const, id: x.fatura.id, etiket: [x.fatura.no ?? "(numarasız)", x.fatura.cari.unvan].join(" · "), aciklama: x.stok.ad }]));
    return new Map(giderler.map((g) => [g.id, g.masrafId ? m.get(g.masrafId) : f.get(g.faturaSatirId!)]));
  }

  async guncelle(id: string, g: z.infer<typeof aracGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const a = await this.aracAl(tx, id);
      const mulkiyet = g.mulkiyet !== undefined ? g.mulkiyet : a.mulkiyet;
      const demirbasId = g.demirbasId !== undefined ? g.demirbasId : a.demirbasId;
      const kiraSozlesmeId = g.kiraSozlesmeId !== undefined ? g.kiraSozlesmeId : a.kiraSozlesmeId;
      if (demirbasId && mulkiyet !== "oz") throw new BadRequestException("Demirbaş bağı yalnız öz mal araçta olur");
      if (kiraSozlesmeId && mulkiyet !== "kiralik") throw new BadRequestException("Kira sözleşmesi bağı yalnız kiralık araçta olur");
      if (demirbasId && demirbasId !== a.demirbasId) {
        const d = await tx.demirbas.findUnique({ where: { id: demirbasId }, select: { sinif: true, durum: true } });
        if (!d) throw new NotFoundException("Demirbaş bulunamadı");
        if (d.sinif !== "tasit") throw new BadRequestException("Yalnız taşıt sınıfındaki demirbaş araca bağlanır");
        if (d.durum === "elden_cikti") throw new BadRequestException("Elden çıkmış demirbaş araca bağlanamaz");
        if (await tx.arac.count({ where: { demirbasId, id: { not: id } } })) throw new ConflictException("Bu demirbaş başka bir araca bağlı");
      }
      if (kiraSozlesmeId && kiraSozlesmeId !== a.kiraSozlesmeId && !(await tx.kiraSozlesme.findUnique({ where: { id: kiraSozlesmeId }, select: { id: true } }))) throw new NotFoundException("Kira sözleşmesi bulunamadı");
      if (g.sorumluPersonelId && !(await tx.personel.findUnique({ where: { id: g.sorumluPersonelId }, select: { id: true } }))) throw new NotFoundException("Personel bulunamadı");
      return tx.arac.update({
        where: { id },
        data: {
          ...g,
          ...(mulkiyet !== "oz" ? { demirbasId: null } : {}),
          ...(mulkiyet !== "kiralik" ? { kiraSozlesmeId: null } : {}),
          ...(g.sonBakimTarihi !== undefined ? { sonBakimTarihi: g.sonBakimTarihi ? tarihD(g.sonBakimTarihi) : null } : {}),
        },
      });
    });
  }

  // ─── Yükümlülükler (ARC-03) ─────────────────────────────────────────────

  async yukumlulukEkle(id: string, g: z.infer<typeof yukumlulukSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.aracAl(tx, id);
      if (g.baslangic && g.baslangic > g.bitis) throw new BadRequestException("Başlangıç bitişten sonra olamaz");
      return tx.aracYukumluluk.create({ data: { tenantId, aracId: id, tur: g.tur, baslangic: g.baslangic ? tarihD(g.baslangic) : null, bitis: tarihD(g.bitis), belgeNo: g.belgeNo ?? null, tutar: g.tutar ?? null, aciklama: g.aciklama ?? null, userId } });
    });
  }

  async yukumlulukSil(yukumlulukId: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      if (!(await tx.aracYukumluluk.findUnique({ where: { id: yukumlulukId }, select: { id: true } }))) throw new NotFoundException("Kayıt bulunamadı");
      await tx.aracYukumluluk.delete({ where: { id: yukumlulukId } });
    });
    return { silindi: true };
  }

  // ─── Gider bağı (ARC-05) ────────────────────────────────────────────────

  /**
   * Bağlanmamış onaylı masraflar ve kesin alış satırları. Arama metni yoksa
   * plakanın geçtiği kayıtlar önerilir; her birine kategori önerisi eklenir.
   */
  async giderAdaylari(id: string, s: { ara?: string; baslangic?: string; bitis?: string }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const a = await this.aracAl(tx, id);
      const aralik = { ...(s.baslangic ? { gte: tarihD(s.baslangic) } : {}), ...(s.bitis ? { lte: tarihD(s.bitis) } : {}) };
      const tarihSuzgeci = s.baslangic || s.bitis ? { tarih: aralik } : {};
      const bagli = await tx.aracGider.findMany({ select: { masrafId: true, faturaSatirId: true } });
      const bagliMasraf = new Set(bagli.map((b) => b.masrafId).filter(Boolean));
      const bagliSatir = new Set(bagli.map((b) => b.faturaSatirId).filter(Boolean));
      const ara = s.ara?.trim();
      const [masraflar, satirlar] = await Promise.all([
        tx.masraf.findMany({
          where: { durum: "onaylandi", ...tarihSuzgeci, ...(ara ? { OR: [{ aciklama: { contains: ara, mode: "insensitive" } }, { saticiUnvan: { contains: ara, mode: "insensitive" } }, { belgeNo: { contains: ara, mode: "insensitive" } }] } : {}) },
          select: { id: true, tarih: true, matrah: true, kur: true, belgeNo: true, aciklama: true, saticiUnvan: true, kategori: { select: { ad: true } } },
          orderBy: { tarih: "desc" }, take: ara ? 100 : 1000,
        }),
        tx.faturaSatir.findMany({
          where: { fatura: { tip: "alis", durum: "kesin", ...tarihSuzgeci, ...(ara ? { OR: [{ no: { contains: ara, mode: "insensitive" } }, { aciklama: { contains: ara, mode: "insensitive" } }, { cari: { unvan: { contains: ara, mode: "insensitive" } } }] } : {}) } },
          select: { id: true, matrah: true, stok: { select: { ad: true } }, fatura: { select: { id: true, no: true, tarih: true, aciklama: true, cari: { select: { unvan: true } } } } },
          orderBy: { fatura: { tarih: "desc" } }, take: ara ? 100 : 1000,
        }),
      ]);
      const sonuc: Array<{ tur: "masraf" | "fatura"; id: string; tarih: string; etiket: string; metin: string; tutarTry: Prisma.Decimal | null; kategori: GiderKategorisi }> = [];
      for (const m of masraflar) {
        if (bagliMasraf.has(m.id)) continue;
        const metin = [m.kategori.ad, m.saticiUnvan, m.aciklama, m.belgeNo].filter(Boolean).join(" · ");
        if (!ara && !plakaGeciyor(metin, a.plaka)) continue;
        sonuc.push({ tur: "masraf", id: m.id, tarih: gun(m.tarih), etiket: [m.saticiUnvan, m.belgeNo].filter(Boolean).join(" · ") || m.kategori.ad, metin, tutarTry: yuvarla(D(m.matrah).mul(m.kur)), kategori: kategoriOner(metin) });
      }
      for (const x of satirlar) {
        if (bagliSatir.has(x.id)) continue;
        const metin = [x.stok.ad, x.fatura.aciklama, x.fatura.cari.unvan, x.fatura.no].filter(Boolean).join(" · ");
        if (!ara && !plakaGeciyor(metin, a.plaka)) continue;
        sonuc.push({ tur: "fatura", id: x.id, tarih: gun(x.fatura.tarih), etiket: `${x.fatura.no ?? "(numarasız)"} · ${x.fatura.cari.unvan}`, metin: x.stok.ad, tutarTry: null, kategori: kategoriOner(metin) });
      }
      return sonuc.sort((p, q) => q.tarih.localeCompare(p.tarih)).slice(0, 100);
    });
  }

  async giderBagla(id: string, g: z.infer<typeof giderBagSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const a = await this.aracAl(tx, id);
      const k = await kaynakOku(tx, g);
      const onceki = await tx.aracGider.findFirst({ where: g.masrafId ? { masrafId: g.masrafId } : { faturaSatirId: g.faturaSatirId }, select: { aracId: true } });
      if (onceki) throw new ConflictException(onceki.aracId === id ? "Bu kayıt bu araca zaten bağlı" : "Bu kayıt başka bir araca bağlı");
      if (g.litre && g.kategori !== "akaryakit") throw new BadRequestException("Litre yalnız akaryakıtta girilir");
      const gider = await tx.aracGider.create({
        data: { tenantId, aracId: a.id, masrafId: g.masrafId ?? null, faturaSatirId: g.faturaSatirId ?? null, kategori: g.kategori, tarih: tarihD(k.tarih), tutarTry: k.tutarTry, litre: g.litre ?? null, km: g.km ?? null, userId },
      });
      if (g.km != null) await this.kmYaz(tx, a.id, k.tarih, g.km, "gider", gider.id, g.kmGerekcesi);
      return gider;
    });
  }

  async giderCoz(giderId: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const g = await tx.aracGider.findUnique({ where: { id: giderId }, select: { id: true } });
      if (!g) throw new NotFoundException("Gider bağı bulunamadı");
      await tx.aracKmKaydi.deleteMany({ where: { kaynak: "gider", kaynakId: giderId } });
      await tx.aracGider.delete({ where: { id: giderId } });
    });
    return { cozuldu: true };
  }

  // ─── Km, bakım, ceza (ARC-07/08/09) ────────────────────────────────────

  async kmEkle(id: string, g: z.infer<typeof kmSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.aracAl(tx, id);
      await this.kmYaz(tx, id, g.tarih, g.km, "elle", null, g.gerekce);
    });
    return { kaydedildi: true };
  }

  async bakimEkle(id: string, g: z.infer<typeof bakimSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const a = await this.aracAl(tx, id);
      if (g.aracGiderId && !(await tx.aracGider.findFirst({ where: { id: g.aracGiderId, aracId: id }, select: { id: true } }))) throw new NotFoundException("Gider bu araca bağlı değil");
      const b = await tx.aracBakim.create({ data: { tenantId, aracId: id, tarih: tarihD(g.tarih), km: g.km ?? null, aciklama: g.aciklama, aracGiderId: g.aracGiderId ?? null, userId } });
      if (g.km != null) await this.kmYaz(tx, id, g.tarih, g.km, "bakim", b.id, g.kmGerekcesi);
      // Plan yalnız daha yeni bakımla ilerler.
      if (!a.sonBakimTarihi || gun(a.sonBakimTarihi) <= g.tarih) {
        await tx.arac.update({ where: { id }, data: { sonBakimTarihi: tarihD(g.tarih), ...(g.km != null ? { sonBakimKm: g.km } : {}) } });
      }
      return b;
    });
  }

  async cezaEkle(id: string, g: z.infer<typeof cezaSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const a = await this.aracAl(tx, id);
      if (g.aracGiderId && !(await tx.aracGider.findFirst({ where: { id: g.aracGiderId, aracId: id }, select: { id: true } }))) throw new NotFoundException("Gider bu araca bağlı değil");
      const personelId = g.personelId !== undefined ? g.personelId : await this.sorumlu(tx, a, g.tarih);
      return tx.aracCeza.create({ data: { tenantId, aracId: id, tarih: tarihD(g.tarih), tutar: g.tutar, ihlal: g.ihlal, yer: g.yer ?? null, personelId, tahsilNotu: g.tahsilNotu ?? null, aracGiderId: g.aracGiderId ?? null, userId } });
    });
  }

  async kayitSil(tur: "bakim" | "ceza" | "km", kayitId: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      if (tur === "bakim") {
        const b = await tx.aracBakim.findUnique({ where: { id: kayitId } });
        if (!b) throw new NotFoundException("Kayıt bulunamadı");
        await tx.aracKmKaydi.deleteMany({ where: { kaynak: "bakim", kaynakId: kayitId } });
        await tx.aracBakim.delete({ where: { id: kayitId } });
        // Plan bir önceki bakıma döner.
        const son = await tx.aracBakim.findFirst({ where: { aracId: b.aracId }, orderBy: { tarih: "desc" } });
        await tx.arac.update({ where: { id: b.aracId }, data: { sonBakimTarihi: son?.tarih ?? null, sonBakimKm: son?.km ?? null } });
      } else if (tur === "ceza") {
        if (!(await tx.aracCeza.findUnique({ where: { id: kayitId }, select: { id: true } }))) throw new NotFoundException("Kayıt bulunamadı");
        await tx.aracCeza.delete({ where: { id: kayitId } });
      } else {
        const k = await tx.aracKmKaydi.findUnique({ where: { id: kayitId }, select: { kaynak: true } });
        if (!k) throw new NotFoundException("Kayıt bulunamadı");
        if (k.kaynak !== "elle") throw new ConflictException("Gider ya da bakımdan gelen km, o kayıt çözülünce silinir");
        await tx.aracKmKaydi.delete({ where: { id: kayitId } });
      }
    });
    return { silindi: true };
  }

  // ─── Rapor (ARC-06/10) ──────────────────────────────────────────────────

  /**
   * Dönemde araç başına maliyet, km, tüketim ve binek KKEG. Kiralık aracın
   * kira sözleşmesine bağlı onaylı masrafları ayrıca bağlanmasa da kira
   * gideridir (bağlıysa bir kez sayılır).
   */
  async rapor(baslangic: string, bitis: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const aralik = { gte: tarihD(baslangic), lte: tarihD(bitis) };
      const araclar = await tx.arac.findMany({ orderBy: { plaka: "asc" }, include: { giderler: { where: { tarih: aralik } }, kmKayitlari: { where: { tarih: aralik } }, cezalar: { where: { tarih: aralik } } } });
      const bagliMasraflar = new Set((await tx.aracGider.findMany({ where: { masrafId: { not: null } }, select: { masrafId: true } })).map((g) => g.masrafId));
      const oran = await kanuniDegerOku(tx, "binek_gider_orani", bitis, -1).then((v) => (v < 0 ? null : v));
      const sinirlar = new Map<number, number | null>();
      for (let y = Number(baslangic.slice(0, 4)); y <= Number(bitis.slice(0, 4)); y++) sinirlar.set(y, await yillikDegerOku(tx, "binek_kira_siniri", y));
      const satirlar = [];
      for (const a of araclar) {
        const giderler = a.giderler.map((g) => ({ kategori: g.kategori as GiderKategorisi, tarih: gun(g.tarih), tutarTry: Number(g.tutarTry), litre: g.litre ? Number(g.litre) : null, km: g.km }));
        if (a.mulkiyet === "kiralik" && a.kiraSozlesmeId) {
          const kiralar = await tx.masraf.findMany({ where: { kiraSozlesmeId: a.kiraSozlesmeId, durum: "onaylandi", tarih: aralik }, select: { id: true, tarih: true, matrah: true, kur: true } });
          for (const k of kiralar) if (!bagliMasraflar.has(k.id)) giderler.push({ kategori: "kira", tarih: gun(k.tarih), tutarTry: Number(yuvarla(D(k.matrah).mul(k.kur))), litre: null, km: null });
        }
        if (!giderler.length && !a.kmKayitlari.length && !a.cezalar.length && !a.aktif) continue;
        const kategoriler = Object.fromEntries(Object.keys(KATEGORI_ADLARI).map((k) => [k, kurus(giderler.filter((g) => g.kategori === k).reduce((t, g) => t + g.tutarTry, 0))]));
        const toplam = kurus(giderler.reduce((t, g) => t + g.tutarTry, 0));
        const kmler = a.kmKayitlari.map((k) => k.km);
        const yol = kmler.length >= 2 ? Math.max(...kmler) - Math.min(...kmler) : null;
        const kkeg: KkegSonucu | null = a.tur === "binek" && !a.binekSinirYok ? binekKkeg(giderler, oran, (y) => sinirlar.get(y) ?? null) : null;
        satirlar.push({
          id: a.id, plaka: a.plaka, marka: a.marka, model: a.model, tur: a.tur, mulkiyet: a.mulkiyet, kategoriler, toplam,
          yol, kmBasi: yol ? kurus(toplam / yol) : null, tuketim: tuketim(giderler.filter((g) => g.kategori === "akaryakit")),
          litre: kurus(giderler.reduce((t, g) => t + (g.litre ?? 0), 0)), kkeg, ceza: kurus(a.cezalar.reduce((t, c) => t + Number(c.tutar), 0)), cezaSayisi: a.cezalar.length,
        });
      }
      return { baslangic, bitis, binekGiderOrani: oran, kiraSinirlari: Object.fromEntries(sinirlar), satirlar, toplam: kurus(satirlar.reduce((t, s) => t + s.toplam, 0)), toplamKkeg: kurus(satirlar.reduce((t, s) => t + (s.kkeg?.toplamKkeg ?? 0), 0)) };
    });
  }

  /** ARC-04/10: geçerli yükümlülüklerden 30 gün içinde bitecek ya da geçmiş olanlar ve bakımı yaklaşan araçlar. */
  async yaklasanlar() {
    const liste = await this.listele();
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    const yukumlulukler = await this.prisma.tenantIslem(tenantId, (tx) => tx.aracYukumluluk.findMany({ where: { arac: { aktif: true } }, select: { id: true, aracId: true, tur: true, bitis: true, belgeNo: true } }));
    const araclar = new Map(liste.map((a) => [a.id, a]));
    const gruplar = new Map<string, { id: string; tur: string; bitis: string; belgeNo: string | null }[]>();
    for (const y of yukumlulukler) gruplar.set(y.aracId, [...(gruplar.get(y.aracId) ?? []), { id: y.id, tur: y.tur, bitis: gun(y.bitis), belgeNo: y.belgeNo }]);
    const sonuc: Array<{ aracId: string; plaka: string; tur: string; ad: string; tarih: string | null; kalanGun: number | null; kalanKm?: number | null; durum: "doldu" | "7" | "30" | "gecikti" | "yaklasiyor" }> = [];
    for (const [aracId, kayitlar] of gruplar) {
      for (const y of gecerliYukumlulukler(kayitlar)) {
        const d = yukumlulukDurumu(y.bitis, bugun);
        if (d.esik) sonuc.push({ aracId, plaka: araclar.get(aracId)?.plaka ?? "", tur: y.tur, ad: YUKUMLULUK_ADLARI[y.tur] ?? y.tur, tarih: y.bitis, kalanGun: d.kalanGun, durum: d.esik });
      }
    }
    for (const a of liste) {
      if (a.bakim && (a.bakim.gecikti || a.bakim.yaklasiyor)) sonuc.push({ aracId: a.id, plaka: a.plaka, tur: "bakim", ad: "Periyodik bakım", tarih: a.bakim.tarih, kalanGun: a.bakim.kalanGun, kalanKm: a.bakim.kalanKm, durum: a.bakim.gecikti ? "gecikti" : "yaklasiyor" });
    }
    return sonuc.sort((x, y) => (x.kalanGun ?? 0) - (y.kalanGun ?? 0));
  }
}
