import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { bugunTR } from "@tekirextra/shared";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { yillikDegerOku } from "../mevzuat/kanuni-deger";
import { amortismanPlani, cikisSonucu, eksikOncekiYillar, type Plan } from "./amortisman-hesap";
import { listeKalemi } from "./amortisman-listesi";
import { acilisOku } from "./demirbas-dosya";
import type { DemirbasAyari, DemirbasGuncelle, ListeSorgusu } from "./demirbas.semalar";
import {
  cikisSemasi, DEMIRBAS_MODULU, demirbasAyariSemasi, demirbasOlusturSemasi, ilaveBedelSemasi, zimmetIadeSemasi, zimmetSemasi,
} from "./demirbas.semalar";
import type { z } from "zod";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const SIFIR = D(0);
const yuvarla = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const gun = (t: Date | string) => (typeof t === "string" ? t.slice(0, 10) : t.toISOString().slice(0, 10));
const tarihD = (t: string) => new Date(`${t}T00:00:00Z`);
/** Dönem kilidi yerel saatle ay okur; gün ortası her saat diliminde aynı aya düşer. */
const kilitTarihi = (t: string) => new Date(`${t}T12:00:00Z`);

export const SINIF_ADLARI: Record<string, string> = {
  bina: "Bina", tesis_makine: "Tesis, makine ve cihaz", tasit: "Taşıt", demirbas: "Demirbaş", hak: "Hak", ozel_maliyet: "Özel maliyet",
};
export const CIKIS_ADLARI: Record<string, string> = { satis: "Satış", hurda: "Hurdaya ayırma", kayip: "Kayıp", bagis: "Bağış" };

export type KartKaydi = Prisma.DemirbasGetPayload<{ include: { ilaveBedeller: true; amortismanlar: { include: { donem: { select: { durum: true } } } } } }>;

/** Kartın amortismana esas bedeli: edinme bedeli + ilave bedeller. */
export function kartBedeli(k: Pick<KartKaydi, "edinmeBedeli" | "ilaveBedeller">): Prisma.Decimal {
  return k.ilaveBedeller.reduce((t, i) => t.add(i.tutar), D(k.edinmeBedeli));
}

/** Kesin (geri alınmamış) dönemlerdeki satırlar: yıl → satır. */
export function kesinSatirlar(k: Pick<KartKaydi, "amortismanlar">) {
  return new Map(k.amortismanlar.filter((a) => a.donem.durum === "kesin").map((a) => [a.yil, a]));
}

/** Yıllık sınırlar edinme yılına göre okunur (GVK 40/5 "iktisap tarihinde yürürlükte olan tutar"). */
export async function binekSiniri(tx: Tx, k: Pick<KartKaydi, "binekOto" | "binekVergili" | "binekSinirYok" | "edinmeTarihi">) {
  if (!k.binekOto || k.binekSinirYok) return null;
  return yillikDegerOku(tx, k.binekVergili ? "binek_amortisman_siniri_vergili" : "binek_amortisman_siniri", k.edinmeTarihi.getUTCFullYear());
}

export function kartPlani(k: KartKaydi, sinir: number | null, cikisYoksay = false): Plan {
  return amortismanPlani({
    bedel: kartBedeli(k),
    edinmeTarihi: gun(k.edinmeTarihi),
    faydaliOmur: k.faydaliOmur,
    yontem: k.yontem as "normal" | "azalan",
    normaleGecisYili: k.normaleGecisYili,
    binekOto: k.binekOto,
    acilis: k.acilis ? { birikmis: D(k.acilisBirikmis), sonYil: k.acilisSonYil } : null,
    cikisYili: !cikisYoksay && k.cikisTarihi ? k.cikisTarihi.getUTCFullYear() : null,
    kesinler: new Map([...kesinSatirlar(k)].map(([yil, a]) => [yil, D(a.tutar)])),
    binekSiniri: sinir,
  });
}

/** Açılış birikmişi + kesin satırlar. */
export function birikmis(k: KartKaydi): Prisma.Decimal {
  return [...kesinSatirlar(k).values()].reduce((t, a) => t.add(a.tutar), D(k.acilis ? k.acilisBirikmis : 0));
}

const KART_INCLUDE = { ilaveBedeller: { orderBy: { tarih: "asc" } }, amortismanlar: { include: { donem: { select: { durum: true } } }, orderBy: { yil: "asc" } } } satisfies Prisma.DemirbasInclude;

@Injectable()
export class DemirbasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly donemKilidi: DonemKilidiService,
    private readonly ayarlar: AyarlarService,
  ) {}

  async ayar(tx?: Tx): Promise<DemirbasAyari> {
    return demirbasAyariSemasi.parse(await this.ayarlar.getir(DEMIRBAS_MODULU, tx));
  }

  // ─── Fatura satırı (DMR-02/08) ──────────────────────────────────────────

  /**
   * Satırın TL tutarı muhasebe fişindeki gibi: fatura matrahı satır matrahları
   * oranında dağıtılır (genel iskonto), KDV dışı vergi eklenir, belge kuruyla çevrilir.
   */
  private async satirOku(tx: Tx, satirId: string, tip: "alis" | "satis") {
    const satir = await tx.faturaSatir.findUnique({
      where: { id: satirId },
      select: {
        id: true, miktar: true, matrah: true, ekVergiTutari: true, birim: true,
        stok: { select: { ad: true, tip: true } },
        fatura: { select: { id: true, no: true, tip: true, durum: true, tarih: true, cariId: true, dovizCinsi: true, kur: true, toplamMatrah: true, satirlar: { select: { matrah: true } } } },
      },
    });
    if (!satir) throw new NotFoundException("Fatura satırı bulunamadı");
    const f = satir.fatura;
    if (f.tip !== tip || f.durum !== "kesin") throw new BadRequestException(`Yalnız kesinleşmiş ${tip === "alis" ? "alış" : "satış"} faturasının satırı seçilebilir`);
    const toplam = f.satirlar.reduce((t, s) => t.add(s.matrah), SIFIR);
    const pay = toplam.isZero() ? D(satir.matrah) : D(f.toplamMatrah).mul(satir.matrah).div(toplam);
    const belgeTutari = yuvarla(pay.add(tip === "alis" ? satir.ekVergiTutari : 0));
    const tl = yuvarla(belgeTutari.mul(f.kur));
    return { satir, fatura: f, tl, belgeTutari };
  }

  /** DMR-02/08: numarayla kesin fatura bulunur, satırları bağlı kartlarıyla döner. */
  async faturaSatirlari(no: string, tip: "alis" | "satis") {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const faturalar = await tx.fatura.findMany({
        where: { tip, durum: "kesin", no: { contains: no.trim(), mode: "insensitive" } },
        select: { id: true, no: true, tarih: true, cari: { select: { unvan: true } }, dovizCinsi: true, satirlar: { select: { id: true } } },
        orderBy: { tarih: "desc" }, take: 10,
      });
      const sonuc = [];
      for (const f of faturalar) {
        const satirlar = [];
        for (const { id } of f.satirlar) {
          const s = await this.satirOku(tx, id, tip);
          const bagli = tip === "alis"
            ? await tx.demirbas.findMany({ where: { faturaSatirId: id }, select: { id: true, kod: true, ad: true } })
            : await tx.demirbas.findMany({ where: { cikisFaturaSatirId: id }, select: { id: true, kod: true, ad: true, cikisBedeli: true } });
          satirlar.push({ id, stokAdi: s.satir.stok.ad, stokTipi: s.satir.stok.tip, miktar: s.satir.miktar, birim: s.satir.birim, tutarTl: s.tl, belgeTutari: s.belgeTutari, bagliKartlar: bagli });
        }
        sonuc.push({ id: f.id, no: f.no, tarih: gun(f.tarih), cari: f.cari?.unvan ?? null, dovizCinsi: f.dovizCinsi, satirlar });
      }
      return sonuc;
    });
  }

  // ─── Okuma ─────────────────────────────────────────────────────────────

  async listele(s: ListeSorgusu) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const acikZimmet = s.personelId || s.konum
        ? { zimmetler: { some: { bitis: null, ...(s.personelId ? { personelId: s.personelId } : {}), ...(s.konum ? { konum: { contains: s.konum, mode: "insensitive" as const } } : {}) } } }
        : {};
      const kartlar = await tx.demirbas.findMany({
        where: {
          ...(s.durum === "tumu" ? {} : { durum: s.durum }),
          ...(s.sinif ? { sinif: s.sinif } : {}),
          ...(s.ara ? { OR: [{ kod: { contains: s.ara, mode: "insensitive" } }, { ad: { contains: s.ara, mode: "insensitive" } }, { seriNo: { contains: s.ara, mode: "insensitive" } }] } : {}),
          ...acikZimmet,
        },
        include: { ...KART_INCLUDE, zimmetler: { where: { bitis: null } } },
        orderBy: { kod: "asc" },
      });
      const personeller = await this.personelAdlari(tx, kartlar.flatMap((k) => k.zimmetler.map((z) => z.personelId)));
      const yil = Number(bugunTR().slice(0, 4));
      const sonuc = [];
      for (const k of kartlar) {
        const plan = kartPlani(k, await binekSiniri(tx, k));
        const bedel = kartBedeli(k);
        const b = birikmis(k);
        const zimmet = k.zimmetler[0];
        sonuc.push({
          id: k.id, kod: k.kod, ad: k.ad, sinif: k.sinif, edinmeTarihi: gun(k.edinmeTarihi), bedel, birikmis: b, netDeger: k.durum === "elden_cikti" ? SIFIR : bedel.sub(b),
          buYil: plan.satirlar.find((p) => p.yil === yil)?.tutar ?? SIFIR, faydaliOmur: k.faydaliOmur, yontem: k.yontem, durum: k.durum, acilis: k.acilis,
          konum: zimmet?.konum ?? k.konum, zimmetli: zimmet?.personelId ? personeller.get(zimmet.personelId) ?? null : null,
          cikisTuru: k.cikisTuru, cikisTarihi: k.cikisTarihi ? gun(k.cikisTarihi) : null,
        });
      }
      return sonuc;
    });
  }

  private async personelAdlari(tx: Tx, idler: (string | null)[]) {
    const benzersiz = [...new Set(idler.filter((x): x is string => Boolean(x)))];
    if (!benzersiz.length) return new Map<string, string>();
    const p = await tx.personel.findMany({ where: { id: { in: benzersiz } }, select: { id: true, ad: true, soyad: true } });
    return new Map(p.map((x) => [x.id, `${x.ad} ${x.soyad}`]));
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.demirbas.findUnique({ where: { id }, include: { ...KART_INCLUDE, zimmetler: { orderBy: { baslangic: "desc" } } } });
      if (!k) throw new NotFoundException("Demirbaş bulunamadı");
      const sinir = await binekSiniri(tx, k);
      const plan = kartPlani(k, sinir);
      const personeller = await this.personelAdlari(tx, k.zimmetler.map((z) => z.personelId));
      const [tedarikci, giris, cikis] = await Promise.all([
        k.tedarikciCariId ? tx.cariHesap.findUnique({ where: { id: k.tedarikciCariId }, select: { id: true, unvan: true } }) : null,
        k.faturaSatirId ? this.faturaOzeti(tx, k.faturaSatirId) : null,
        k.cikisFaturaSatirId ? this.faturaOzeti(tx, k.cikisFaturaSatirId) : null,
      ]);
      const bedel = kartBedeli(k);
      const b = birikmis(k);
      return {
        ...k,
        edinmeTarihi: gun(k.edinmeTarihi), cikisTarihi: k.cikisTarihi ? gun(k.cikisTarihi) : null,
        bedel, birikmis: b, netDeger: k.durum === "elden_cikti" ? SIFIR : bedel.sub(b), binekSiniri: sinir,
        liste: listeKalemi(k.listeKodu) ?? null,
        kesinYilVar: kesinSatirlar(k).size > 0,
        plan: plan.satirlar.map((p) => ({ ...p })),
        tedarikci, girisFaturasi: giris, cikisFaturasi: cikis,
        zimmetler: k.zimmetler.map((z) => ({ ...z, baslangic: gun(z.baslangic), bitis: z.bitis ? gun(z.bitis) : null, personel: z.personelId ? personeller.get(z.personelId) ?? null : null })),
        ilaveBedeller: k.ilaveBedeller.map((i) => ({ ...i, tarih: gun(i.tarih) })),
        cikisSonucu: k.durum === "elden_cikti" && k.cikisBirikmis != null ? cikisSonucu(bedel, D(k.cikisBirikmis), D(k.cikisBedeli ?? 0)) : null,
      };
    });
  }

  private async faturaOzeti(tx: Tx, satirId: string) {
    const s = await tx.faturaSatir.findUnique({ where: { id: satirId }, select: { fatura: { select: { id: true, no: true, tarih: true, tip: true } }, stok: { select: { ad: true } } } });
    return s ? { faturaId: s.fatura.id, no: s.fatura.no, tarih: gun(s.fatura.tarih), tip: s.fatura.tip, satir: s.stok.ad } : null;
  }

  // ─── Kart açma ve düzenleme (DMR-01/02/03/11) ───────────────────────────

  private async sonrakiKodlar(tx: Tx, adet: number): Promise<string[]> {
    const kodlar = await tx.demirbas.findMany({ where: { kod: { startsWith: "DMR-" } }, select: { kod: true } });
    let enBuyuk = 0;
    for (const { kod } of kodlar) {
      const m = /^DMR-(\d{6})$/.exec(kod);
      if (m) enBuyuk = Math.max(enBuyuk, Number(m[1]));
    }
    return Array.from({ length: adet }, (_, i) => `DMR-${String(enBuyuk + i + 1).padStart(6, "0")}`);
  }

  private async yontemDogrula(tx: Tx, yontem: string, binekOto: boolean) {
    if (yontem !== "azalan") return;
    if (binekOto) throw new BadRequestException("Binek otoda bu sürümde azalan bakiyeler yöntemi desteklenmez");
    if ((await this.ayar(tx)).defterTuru !== "bilanco") throw new BadRequestException("Azalan bakiyeler yöntemi yalnız bilanço esasında seçilebilir (Demirbaş ayarlarından defter türü)");
  }

  async olustur(g: z.infer<typeof demirbasOlusturSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.yontemDogrula(tx, g.yontem, g.binekOto);
      const uyarilar: string[] = [];
      let bedeller: Prisma.Decimal[];
      let edinmeTarihi: string;
      let tedarikciCariId = g.tedarikciCariId ?? null;
      let dovizBilgisi: { dovizCinsi: "TRY" | "USD" | "EUR" | "GBP" | string; dovizTutari: Prisma.Decimal | null; kur: Prisma.Decimal | null } = { dovizCinsi: "TRY", dovizTutari: null, kur: null };
      if (g.faturaSatirId) {
        const s = await this.satirOku(tx, g.faturaSatirId, "alis");
        await this.donemKilidi.tarihDogrula(tenantId, kilitTarihi(gun(s.fatura.tarih)), "kapalı dönemdeki faturayı demirbaşa bağlama", tx);
        if (await tx.demirbas.count({ where: { faturaSatirId: g.faturaSatirId } })) throw new ConflictException("Bu fatura satırından zaten demirbaş açılmış");
        const toplam = g.edinmeBedeli != null && g.adet === 1 ? D(g.edinmeBedeli) : s.tl;
        const birim = yuvarla(toplam.div(g.adet));
        bedeller = Array.from({ length: g.adet }, (_, i) => (i === g.adet - 1 ? toplam.sub(birim.mul(g.adet - 1)) : birim));
        edinmeTarihi = g.edinmeTarihi ?? gun(s.fatura.tarih);
        tedarikciCariId = s.fatura.cariId;
        if (s.fatura.dovizCinsi !== "TRY") dovizBilgisi = { dovizCinsi: s.fatura.dovizCinsi, dovizTutari: yuvarla(s.belgeTutari.div(g.adet)), kur: D(s.fatura.kur) };
        if (s.satir.stok.tip === "urun") uyarilar.push(`"${s.satir.stok.ad}" stok kartı ürün tipinde; bu satır stoğa da girdi. Demirbaş alımı için hizmet ya da sarf tipli stok kartı kullanın.`);
      } else {
        bedeller = [D(g.edinmeBedeli!)];
        edinmeTarihi = g.edinmeTarihi!;
      }
      if (!g.acilis && bedeller.some((b) => b.lte(0))) throw new BadRequestException("Bedel sıfırdan büyük olmalıdır");
      if (g.acilis && D(g.acilisBirikmis).gt(bedeller[0])) throw new BadRequestException("Birikmiş amortisman bedeli aşamaz");
      if (g.acilis && g.acilisSonYil != null && g.acilisSonYil < Number(edinmeTarihi.slice(0, 4))) throw new BadRequestException("Birikmişin son yılı edinme yılından önce olamaz");
      // DMR-03: doğrudan gider sınırı (edinme yılının tutarı; yoksa denetlenmez).
      if (!g.acilis) {
        const sinir = await yillikDegerOku(tx, "dogrudan_gider_siniri", Number(edinmeTarihi.slice(0, 4)));
        if (sinir && bedeller[0].lt(sinir)) uyarilar.push(`Bedel (${bedeller[0].toFixed(2)} TL) ${edinmeTarihi.slice(0, 4)} yılının doğrudan gider sınırının (${sinir.toLocaleString("tr-TR")} TL, VUK 313) altında; demirbaş olarak izlemeden doğrudan gidere yazılabilir.`);
      }
      if (uyarilar.length && !g.uyarilariKabulEt) return { olusturuldu: false as const, uyarilar };
      const kodlar = g.kod && bedeller.length === 1 ? [g.kod] : await this.sonrakiKodlar(tx, bedeller.length);
      const idler: string[] = [];
      for (const [i, bedel] of bedeller.entries()) {
        try {
          const k = await tx.demirbas.create({
            data: {
              tenantId, kod: kodlar[i], ad: bedeller.length > 1 ? `${g.ad} (${i + 1}/${bedeller.length})` : g.ad, sinif: g.sinif,
              hesapKodu: g.hesapKodu ?? null, giderHesapKodu: g.giderHesapKodu ?? null, listeKodu: g.listeKodu ?? null,
              faydaliOmur: g.faydaliOmur, yontem: g.yontem, binekOto: g.binekOto, binekVergili: g.binekVergili, binekSinirYok: g.binekSinirYok,
              edinmeTarihi: tarihD(edinmeTarihi), edinmeBedeli: bedel, ...dovizBilgisi, dovizCinsi: dovizBilgisi.dovizCinsi as "TRY",
              tedarikciCariId, faturaSatirId: g.faturaSatirId ?? null,
              seriNo: g.seriNo ?? null, konum: g.konum ?? null, aciklama: g.aciklama ?? null,
              acilis: g.acilis, acilisBirikmis: g.acilis ? g.acilisBirikmis : 0, acilisSonYil: g.acilis ? g.acilisSonYil ?? null : null,
            },
          });
          idler.push(k.id);
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException(`${kodlar[i]} kodu kullanılıyor`);
          throw e;
        }
      }
      await tx.auditLog.create({ data: { tenantId, userId, islem: "demirbas_acildi", varlik: "demirbas", varlikId: idler[0], detay: { kodlar, faturaSatirId: g.faturaSatirId ?? null, acilis: g.acilis } } });
      return { olusturuldu: true as const, idler, uyarilar };
    });
  }

  async guncelle(id: string, g: DemirbasGuncelle) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.demirbas.findUnique({ where: { id }, include: KART_INCLUDE });
      if (!k) throw new NotFoundException("Demirbaş bulunamadı");
      const kesinVar = kesinSatirlar(k).size > 0;
      const hesapAlanlari = ["edinmeTarihi", "edinmeBedeli", "faydaliOmur", "yontem", "binekOto", "binekVergili", "binekSinirYok", "acilisBirikmis", "acilisSonYil"] as const;
      const degisen = hesapAlanlari.filter((a) => g[a] !== undefined);
      if (k.durum === "elden_cikti" && Object.keys(g).some((a) => !["ad", "aciklama"].includes(a))) throw new ConflictException("Elden çıkmış kartta yalnız ad ve açıklama değişir");
      if (kesinVar && degisen.length) throw new ConflictException(`Kesin amortismanı olan kartta ${degisen.join(", ")} değiştirilemez (DMR-04)`);
      if (k.faturaSatirId && (g.edinmeTarihi !== undefined || g.edinmeBedeli !== undefined)) throw new ConflictException("Faturadan açılan kartın tarih ve bedeli faturadan gelir");
      if (!k.acilis && (g.acilisBirikmis !== undefined || g.acilisSonYil !== undefined)) throw new BadRequestException("Birikmiş amortisman yalnız açılış kartında girilir");
      await this.yontemDogrula(tx, g.yontem ?? k.yontem, g.binekOto ?? k.binekOto);
      if (g.kod && g.kod !== k.kod && (await tx.demirbas.count({ where: { kod: g.kod } }))) throw new ConflictException(`${g.kod} kodu kullanılıyor`);
      return tx.demirbas.update({
        where: { id },
        data: {
          ...g,
          ...(g.edinmeTarihi ? { edinmeTarihi: tarihD(g.edinmeTarihi) } : {}),
          ...(g.yontem === "normal" ? { normaleGecisYili: null } : {}),
        },
      });
    });
  }

  async sil(id: string) {
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.demirbas.findUnique({ where: { id }, include: KART_INCLUDE });
      if (!k) throw new NotFoundException("Demirbaş bulunamadı");
      if (k.amortismanlar.length) throw new ConflictException("Amortisman kaydı olan kart silinemez; elden çıkarın");
      if (k.durum === "elden_cikti") throw new ConflictException("Elden çıkmış kart silinemez");
      await tx.demirbas.delete({ where: { id } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "demirbas_silindi", varlik: "demirbas", varlikId: id, detay: { kod: k.kod, ad: k.ad } } });
    });
    return { silindi: true };
  }

  // ─── İlave bedel ve normale geçiş (DMR-02/04) ────────────────────────────

  async ilaveBedelEkle(id: string, g: z.infer<typeof ilaveBedelSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.demirbas.findUnique({ where: { id }, include: KART_INCLUDE });
      if (!k) throw new NotFoundException("Demirbaş bulunamadı");
      if (k.acilis) throw new ConflictException("Açılış kartına ilave bedel eklenmez; bedeli düzenleyin");
      if (k.durum === "elden_cikti" || kesinSatirlar(k).size) throw new ConflictException("İlave bedel yalnız ilk amortisman kesinleşmeden önce eklenir");
      let tarih = g.tarih;
      let tutar = g.tutar != null ? D(g.tutar) : null;
      if (g.faturaSatirId) {
        const s = await this.satirOku(tx, g.faturaSatirId, "alis");
        await this.donemKilidi.tarihDogrula(tenantId, kilitTarihi(gun(s.fatura.tarih)), "kapalı dönemdeki faturayı demirbaşa bağlama", tx);
        if (await tx.demirbas.count({ where: { faturaSatirId: g.faturaSatirId } }) || await tx.demirbasIlaveBedel.count({ where: { faturaSatirId: g.faturaSatirId } })) throw new ConflictException("Bu fatura satırı zaten bir demirbaşa bağlı");
        tarih = tarih ?? gun(s.fatura.tarih);
        tutar = tutar ?? s.tl;
      }
      return tx.demirbasIlaveBedel.create({ data: { tenantId, demirbasId: id, tarih: tarihD(tarih!), tutar: tutar!, faturaSatirId: g.faturaSatirId ?? null, aciklama: g.aciklama, userId } });
    });
  }

  async ilaveBedelSil(ilaveId: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const i = await tx.demirbasIlaveBedel.findUnique({ where: { id: ilaveId }, include: { demirbas: { include: KART_INCLUDE } } });
      if (!i) throw new NotFoundException("İlave bedel bulunamadı");
      if (kesinSatirlar(i.demirbas).size || i.demirbas.durum === "elden_cikti") throw new ConflictException("Kesin amortismanı olan kartın ilave bedeli silinemez");
      await tx.demirbasIlaveBedel.delete({ where: { id: ilaveId } });
    });
    return { silindi: true };
  }

  async normaleGecis(id: string, yil: number) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.demirbas.findUnique({ where: { id }, include: KART_INCLUDE });
      if (!k) throw new NotFoundException("Demirbaş bulunamadı");
      if (k.yontem !== "azalan") throw new BadRequestException("Yalnız azalan bakiyeler yöntemindeki kart normale geçer");
      if (k.normaleGecisYili != null) throw new ConflictException(`Kart ${k.normaleGecisYili} yılında normale geçti; geçiş bir kez yapılır`);
      const sonKesin = Math.max(0, ...kesinSatirlar(k).keys());
      if (yil <= sonKesin) throw new ConflictException(`${sonKesin} yılı kesinleşmiş; geçiş daha sonraki bir yıl olmalıdır`);
      return tx.demirbas.update({ where: { id }, data: { normaleGecisYili: yil } });
    });
  }

  // ─── Elden çıkarma (DMR-08) ───────────────────────────────────────────

  async cikis(id: string, g: z.infer<typeof cikisSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.demirbas.findUnique({ where: { id }, include: KART_INCLUDE });
      if (!k) throw new NotFoundException("Demirbaş bulunamadı");
      if (k.durum === "elden_cikti") throw new ConflictException("Kart zaten elden çıkmış");
      let tarih = g.tarih;
      let bedel = D(g.bedel ?? 0);
      if (g.tur === "satis") {
        const s = await this.satirOku(tx, g.faturaSatirId!, "satis");
        tarih = gun(s.fatura.tarih);
        const onceki = await tx.demirbas.aggregate({ where: { cikisFaturaSatirId: g.faturaSatirId }, _sum: { cikisBedeli: true } });
        const kalan = s.tl.sub(onceki._sum.cikisBedeli ?? 0);
        bedel = g.bedel != null ? D(g.bedel) : kalan;
        if (bedel.gt(kalan)) throw new BadRequestException(`Satırın bağlanabilir kalan tutarı ${kalan.toFixed(2)} TL`);
      } else {
        bedel = SIFIR;
      }
      if (tarih! < gun(k.edinmeTarihi)) throw new BadRequestException("Çıkış tarihi edinme tarihinden önce olamaz");
      await this.donemKilidi.tarihDogrula(tenantId, kilitTarihi(tarih!), "demirbaş elden çıkarma", tx);
      const cikisYili = Number(tarih!.slice(0, 4));
      const kesin = kesinSatirlar(k);
      if ([...kesin.keys()].some((y) => y >= cikisYili)) throw new ConflictException(`${cikisYili} ve sonrası için kesin amortisman var; önce o yılları geri alın`);
      const eksik = eksikOncekiYillar(kartPlani(k, await binekSiniri(tx, k), true), cikisYili);
      if (eksik.length) throw new ConflictException(`Önce ${eksik.join(", ")} amortismanını kesinleştirin; çıkıştaki birikmiş amortisman eksik kalır`);
      const b = birikmis(k);
      await tx.demirbas.update({
        where: { id },
        data: { durum: "elden_cikti", cikisTuru: g.tur, cikisTarihi: tarihD(tarih!), cikisBedeli: bedel, cikisFaturaSatirId: g.tur === "satis" ? g.faturaSatirId! : null, cikisGerekcesi: g.gerekce, cikisBirikmis: b, cikisUserId: userId },
      });
      await tx.demirbasZimmet.updateMany({ where: { demirbasId: id, bitis: null }, data: { bitis: tarihD(tarih!) } });
      // ARC-02: bağlı araç pasif olur.
      await tx.arac.updateMany({ where: { demirbasId: id }, data: { aktif: false } });
      const sonuc = cikisSonucu(kartBedeli(k), b, bedel);
      await tx.auditLog.create({ data: { tenantId, userId, islem: "demirbas_cikis", varlik: "demirbas", varlikId: id, detay: { tur: g.tur, tarih, bedel: bedel.toFixed(2), birikmis: b.toFixed(2), fark: sonuc.fark.toFixed(2), gerekce: g.gerekce } } });
      const uyarilar = g.tur === "bagis" || g.tur === "hurda" || g.tur === "kayip"
        ? ["Bağış, hurda ya da kayıpta alışta indirilen KDV'nin düzeltilmesi gerekebilir (KDVK 30/c); mali müşavirinize danışın."]
        : [];
      return { netDeger: sonuc.netDeger, fark: sonuc.fark, uyarilar };
    });
  }

  async cikisGeriAl(id: string, gerekce: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.demirbas.findUnique({ where: { id } });
      if (!k || k.durum !== "elden_cikti" || !k.cikisTarihi) throw new NotFoundException("Elden çıkmış kart bulunamadı");
      await this.donemKilidi.tarihDogrula(tenantId, kilitTarihi(gun(k.cikisTarihi)), "demirbaş çıkışını geri alma", tx);
      const sonraki = await tx.amortismanDonemi.findFirst({ where: { durum: "kesin", yil: { gte: k.cikisTarihi.getUTCFullYear() } }, select: { yil: true } });
      if (sonraki) throw new ConflictException(`${sonraki.yil} amortismanı kesinleşmiş; çıkış geri alınırsa kart o yıl eksik kalır. Önce o yılı geri alın.`);
      await tx.demirbas.update({ where: { id }, data: { durum: "kullanimda", cikisTuru: null, cikisTarihi: null, cikisBedeli: null, cikisFaturaSatirId: null, cikisGerekcesi: null, cikisBirikmis: null, cikisUserId: null } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "demirbas_cikis_geri_alindi", varlik: "demirbas", varlikId: id, detay: { gerekce, tur: k.cikisTuru, tarih: gun(k.cikisTarihi) } } });
      return { geriAlindi: true };
    });
  }

  // ─── Zimmet (DMR-10) ──────────────────────────────────────────────────

  async zimmetle(id: string, g: z.infer<typeof zimmetSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.demirbas.findUnique({ where: { id }, select: { durum: true } });
      if (!k) throw new NotFoundException("Demirbaş bulunamadı");
      if (k.durum === "elden_cikti") throw new ConflictException("Elden çıkmış kart zimmetlenemez");
      if (g.personelId && !(await tx.personel.findUnique({ where: { id: g.personelId }, select: { id: true } }))) throw new NotFoundException("Personel bulunamadı");
      const acik = await tx.demirbasZimmet.findFirst({ where: { demirbasId: id, bitis: null } });
      if (acik) {
        if (gun(acik.baslangic) > g.baslangic) throw new BadRequestException("Yeni zimmet önceki zimmetin başlangıcından önce olamaz");
        await tx.demirbasZimmet.update({ where: { id: acik.id }, data: { bitis: tarihD(g.baslangic) } });
      }
      return tx.demirbasZimmet.create({ data: { tenantId, demirbasId: id, personelId: g.personelId ?? null, konum: g.konum ?? null, baslangic: tarihD(g.baslangic), aciklama: g.aciklama ?? null, userId } });
    });
  }

  async zimmetIade(zimmetId: string, g: z.infer<typeof zimmetIadeSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const z = await tx.demirbasZimmet.findUnique({ where: { id: zimmetId } });
      if (!z || z.bitis) throw new NotFoundException("Açık zimmet bulunamadı");
      if (g.bitis < gun(z.baslangic)) throw new BadRequestException("İade tarihi zimmet başlangıcından önce olamaz");
      return tx.demirbasZimmet.update({ where: { id: zimmetId }, data: { bitis: tarihD(g.bitis), aciklama: g.aciklama ? [z.aciklama, `İade: ${g.aciklama}`].filter(Boolean).join(" · ") : z.aciklama } });
    });
  }

  /** DMR-10: personelin iade edilmemiş zimmetleri (çıkış uyarısı). */
  async acikZimmetler(personelId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const z = await tx.demirbasZimmet.findMany({ where: { personelId, bitis: null }, include: { demirbas: { select: { id: true, kod: true, ad: true, seriNo: true } } }, orderBy: { baslangic: "asc" } });
      return z.map((x) => ({ id: x.id, baslangic: gun(x.baslangic), demirbas: x.demirbas }));
    });
  }

  async zimmetTutanagiVerisi(zimmetId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const z = await tx.demirbasZimmet.findUnique({ where: { id: zimmetId }, include: { demirbas: true } });
      if (!z) throw new NotFoundException("Zimmet bulunamadı");
      const [personel, firma] = await Promise.all([
        z.personelId ? tx.personel.findUnique({ where: { id: z.personelId }, select: { ad: true, soyad: true, personelNo: true, unvan: true } }) : null,
        tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }),
      ]);
      return { zimmet: { ...z, baslangic: gun(z.baslangic), bitis: z.bitis ? gun(z.bitis) : null }, personel, firma: firma?.unvan ?? "" };
    });
  }

  // ─── Açılış içe aktarma (DMR-11) ────────────────────────────────────────

  /** Dosyayı doğrular; hatalı satır varsa `hatalar` doludur ve uygulama hiçbirini yazmaz. */
  async acilisOnizle(buffer: Buffer) {
    const { tenantId } = aktifBaglam();
    const satirlar = await acilisOku(buffer).catch(() => { throw new BadRequestException("Excel dosyası okunamadı"); });
    if (!satirlar.length) throw new BadRequestException("Dosyada demirbaş satırı yok");
    if (satirlar.length > 2000) throw new BadRequestException("Bir dosyada en çok 2000 satır olabilir");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const defterTuru = (await this.ayar(tx)).defterTuru;
      const mevcut = new Set((await tx.demirbas.findMany({ where: { kod: { in: satirlar.map((x) => x.kod).filter((k): k is string => Boolean(k)) } }, select: { kod: true } })).map((x) => x.kod));
      const dosyadaki = new Set<string>();
      const hatalar: { satirNo: number; mesaj: string }[] = [];
      const gecerli: { satirNo: number; veri: z.infer<typeof demirbasOlusturSemasi> }[] = [];
      for (const x of satirlar) {
        const liste = listeKalemi(x.listeKodu);
        if (x.listeKodu && !liste) hatalar.push({ satirNo: x.satirNo, mesaj: `Liste no ${x.listeKodu} amortisman listesinde yok` });
        const sonuc = demirbasOlusturSemasi.safeParse({
          kod: x.kod, ad: x.ad, sinif: x.sinif, listeKodu: x.listeKodu ?? null, faydaliOmur: x.faydaliOmur ?? liste?.omur, yontem: x.yontem,
          binekOto: x.binekOto || Boolean(liste?.binekOto), binekVergili: x.binekVergili, edinmeTarihi: x.edinmeTarihi, edinmeBedeli: x.edinmeBedeli,
          acilis: true, acilisBirikmis: x.acilisBirikmis, acilisSonYil: x.acilisSonYil ?? null, seriNo: x.seriNo ?? null, konum: x.konum ?? null, aciklama: x.aciklama ?? null,
          uyarilariKabulEt: true,
        });
        if (!sonuc.success) { hatalar.push({ satirNo: x.satirNo, mesaj: sonuc.error.issues.map((i) => `${i.path.join(".") || "satır"}: ${i.message}`).join("; ") }); continue; }
        const v = sonuc.data;
        const ek: string[] = [];
        if (v.kod && (mevcut.has(v.kod) || dosyadaki.has(v.kod))) ek.push(`${v.kod} kodu kullanılıyor`);
        if (v.kod) dosyadaki.add(v.kod);
        if (v.yontem === "azalan" && defterTuru !== "bilanco") ek.push("azalan bakiyeler yalnız bilanço esasında");
        if (v.acilisBirikmis > (v.edinmeBedeli ?? 0)) ek.push("birikmiş amortisman bedeli aşıyor");
        if (v.acilisSonYil != null && v.edinmeTarihi && v.acilisSonYil < Number(v.edinmeTarihi.slice(0, 4))) ek.push("birikmişin son yılı edinme yılından önce");
        if (v.edinmeTarihi && v.edinmeTarihi > bugunTR()) ek.push("edinme tarihi ileride");
        if (ek.length) { hatalar.push({ satirNo: x.satirNo, mesaj: ek.join("; ") }); continue; }
        gecerli.push({ satirNo: x.satirNo, veri: v });
      }
      return {
        hatalar,
        satirlar: gecerli.map((g) => ({ satirNo: g.satirNo, kod: g.veri.kod ?? null, ad: g.veri.ad, sinif: g.veri.sinif, faydaliOmur: g.veri.faydaliOmur, edinmeTarihi: g.veri.edinmeTarihi, edinmeBedeli: g.veri.edinmeBedeli, acilisBirikmis: g.veri.acilisBirikmis, acilisSonYil: g.veri.acilisSonYil ?? null })),
        _gecerli: gecerli,
      };
    });
  }

  async acilisUygula(buffer: Buffer) {
    const { tenantId, userId } = aktifBaglam();
    const o = await this.acilisOnizle(buffer);
    if (o.hatalar.length) throw new BadRequestException(`${o.hatalar.length} satırda hata var; hiçbir kart yazılmadı`);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kodsuz = o._gecerli.filter((g) => !g.veri.kod).length;
      const yeniKodlar = await this.sonrakiKodlar(tx, kodsuz);
      let i = 0;
      for (const { veri: v } of o._gecerli) {
        await tx.demirbas.create({
          data: {
            tenantId, kod: v.kod ?? yeniKodlar[i++], ad: v.ad, sinif: v.sinif, listeKodu: v.listeKodu ?? null, faydaliOmur: v.faydaliOmur, yontem: v.yontem,
            binekOto: v.binekOto, binekVergili: v.binekVergili, edinmeTarihi: tarihD(v.edinmeTarihi!), edinmeBedeli: v.edinmeBedeli!,
            acilis: true, acilisBirikmis: v.acilisBirikmis, acilisSonYil: v.acilisSonYil ?? null, seriNo: v.seriNo ?? null, konum: v.konum ?? null, aciklama: v.aciklama ?? null,
          },
        });
      }
      await tx.auditLog.create({ data: { tenantId, userId, islem: "demirbas_acilis_aktarildi", varlik: "demirbas", detay: { kart: o._gecerli.length } } });
      return { aktarilan: o._gecerli.length };
    });
  }

  /** Kart formu için: yılın doğrudan gider ve binek sınırları, defter türü. */
  async sinirlar(yil: number) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => ({
      yil,
      dogrudanGider: await yillikDegerOku(tx, "dogrudan_gider_siniri", yil),
      binek: await yillikDegerOku(tx, "binek_amortisman_siniri", yil),
      binekVergili: await yillikDegerOku(tx, "binek_amortisman_siniri_vergili", yil),
      defterTuru: (await this.ayar(tx)).defterTuru,
    }));
  }
}
