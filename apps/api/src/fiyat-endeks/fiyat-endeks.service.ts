import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { fiyatEndeksErisimi } from "./fiyat-endeks-erisim";
import { ayAraligi, ayBasiMetni, ayKaydir, endeksNormalle, fiyatSerisiHesapla, type AylikToplam } from "./fiyat-endeks-hesap";
import { aylikToplamlar, endeksVerisi, KUR_ENDEKSLERI } from "./fiyat-endeks-veri";
import { EK_CIZGILER, listeFiyatCizgileri, maliyetCizgisi, sonAlisCizgisi, type EkCizgi } from "./fiyat-endeks-cizgiler";
import { Prisma } from "@prisma/client";

/** Ekranda gösterilebilecek en uzun dönem (ay). */
export const EN_UZUN_DONEM_AY = 60;

const ay = z.string().regex(/^\d{4}-\d{2}$/, "Ay YYYY-MM biçiminde olmalıdır");
export const urunSorgusuSemasi = z.object({
  baslangic: ay,
  bitis: ay,
  baz: ay.optional(),
  endeksler: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/)).min(1, "En az bir endeks seçin").max(4, "En çok 4 endeks"),
  satisKapsami: z.enum(["tum", "liste"]).default("tum"),
  listeler: z.array(z.uuid()).max(5, "En çok 5 fiyat listesi").default([]),
  alis: z.boolean().default(false),
  varyantId: z.uuid().optional(),
  /** END-07: liste fiyatı, ağırlıklı ortalama maliyet, son alış fiyatı. */
  cizgiler: z.array(z.enum(EK_CIZGILER)).max(EK_CIZGILER.length).default([]),
});
export type UrunSorgusu = z.infer<typeof urunSorgusuSemasi>;

const buAy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }).slice(0, 7) + "-01";

@Injectable()
export class FiyatEndeksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ekranın seçenekleri: etkin endeksler, kurlar, fiyat listeleri ve kullanıcının erişimi. */
  async secenekler() {
    const { tenantId, rol } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const erisim = await fiyatEndeksErisimi(tx, tenantId, rol);
      const [seriler, listeler] = await Promise.all([
        tx.endeksSerisi.findMany({ where: { etkin: true }, orderBy: [{ sira: "asc" }, { kod: "asc" }], select: { kod: true, ad: true, tur: true, bazYili: true, kaynak: true, sonDonem: true, sonBasariliAt: true } }),
        erisim.satis ? tx.fiyatListesi.findMany({ where: { aktif: true }, orderBy: { ad: "asc" }, select: { id: true, ad: true, dovizCinsi: true } }) : Promise.resolve([]),
      ]);
      return {
        erisim,
        endeksler: [
          ...seriler.map((s) => ({ kod: s.kod, ad: s.ad, tur: s.tur === "kur" ? "kur" as const : "endeks" as const, bazYili: s.bazYili, kaynak: s.kaynak, sonDonem: s.tur === "kur" ? null : s.sonDonem?.toISOString().slice(0, 7) ?? null, guncellendiAt: s.sonBasariliAt })),
          // Katalogda olmayan (durdurulmuş ya da silinmiş) kur yine günlük kurlardan hesaplanabilir.
          ...Object.entries(KUR_ENDEKSLERI).filter(([kod]) => !seriler.some((s) => s.kod === kod)).map(([kod, ad]) => ({ kod, ad, tur: "kur" as const, bazYili: null, kaynak: "TCMB", sonDonem: null, guncellendiAt: null })),
        ],
        fiyatListeleri: listeler,
        buAy: buAy().slice(0, 7),
      };
    });
  }

  /** END-08…11: tek ürünün fiyat serileri ve seçilen endekslerle karşılaştırması. */
  async urun(stokId: string, s: UrunSorgusu) {
    const { tenantId, rol } = aktifBaglam();
    const baslangic = ayBasiMetni(s.baslangic)!, bitis = ayBasiMetni(s.bitis)!;
    const baz = ayBasiMetni(s.baz ?? s.baslangic)!;
    const aylar = ayAraligi(baslangic, bitis);
    if (!aylar.length) throw new BadRequestException("Başlangıç ayı bitiş ayından sonra olamaz.");
    if (aylar.length > EN_UZUN_DONEM_AY) throw new BadRequestException(`Dönem en çok ${EN_UZUN_DONEM_AY} ay olabilir.`);
    if (bitis > buAy()) throw new BadRequestException("Bitiş ayı içinde bulunulan aydan sonra olamaz.");
    if (baz < baslangic || baz > bitis) throw new BadRequestException("Baz ay seçilen dönemin içinde olmalıdır.");
    if (s.satisKapsami === "liste" && !s.listeler.length) throw new BadRequestException("Fiyat listesine göre karşılaştırma için en az bir liste seçin.");

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const erisim = await fiyatEndeksErisimi(tx, tenantId, rol);
      const stok = await tx.stokKart.findFirst({ where: { id: stokId }, select: { id: true, kod: true, ad: true, anaBirim: true } });
      if (!stok) throw new NotFoundException("Stok kartı bulunamadı");
      const satisAcik = erisim.satis, alisAcik = s.alis && erisim.alis;
      if (!satisAcik && !alisAcik) throw new ForbiddenException("Bu ürün için görebileceğiniz fiyat tarafı yok.");

      const toplamBasi = ayKaydir(baslangic, -12), toplamSonu = ayKaydir(bitis, 1);
      const endeksler = await Promise.all([...new Set(s.endeksler)].map((kod) => endeksVerisi(tx, kod, baslangic, bitis)));
      const endeksHaritasi = new Map(endeksler.map((e) => [e.kod, e.degerler]));
      const uyarilar: string[] = [];
      const seriler: { anahtar: string; ad: string; taraf: "satis" | "alis"; listeId: string | null; ozet: { satir: number }; satirlar: ReturnType<typeof fiyatSerisiHesapla>["satirlar"]; karsilastirmalar: ReturnType<typeof fiyatSerisiHesapla>["karsilastirmalar"] }[] = [];
      const ekle = (anahtar: string, ad: string, taraf: "satis" | "alis", listeId: string | null, toplamlar: Map<string, AylikToplam>) => {
        const h = fiyatSerisiHesapla(toplamlar, aylar, baz, endeksHaritasi);
        seriler.push({ anahtar, ad, taraf, listeId, ozet: { satir: h.satirlar.reduce((t, r) => t + r.satir, 0) }, ...h });
      };
      const harita = (satirlar: Awaited<ReturnType<typeof aylikToplamlar>>, grup: string) => new Map(satirlar.filter((r) => r.grup === grup).map((r) => [r.ay, r.toplam]));
      let birimsiz = 0, bugunku = 0;

      if (satisAcik) {
        const listeli = s.satisKapsami === "liste";
        const listeler = listeli ? await tx.fiyatListesi.findMany({ where: { id: { in: s.listeler } }, select: { id: true, ad: true } }) : [];
        if (listeli && listeler.length !== new Set(s.listeler).size) throw new BadRequestException("Seçilen fiyat listelerinden biri bulunamadı.");
        const satirlar = await aylikToplamlar(tx, { taraf: "satis", baslangic: toplamBasi, bitisHaric: toplamSonu, stokIdler: [stokId], varyantId: s.varyantId ?? null, listeler: listeli ? s.listeler : null });
        birimsiz += satirlar.reduce((t, r) => t + r.birimsiz, 0);
        bugunku += satirlar.filter((r) => r.ay >= baslangic).reduce((t, r) => t + r.bugunkuListe, 0);
        if (listeli) for (const l of listeler) ekle(`satis:${l.id}`, `Satış — ${l.ad}`, "satis", l.id, harita(satirlar, l.id));
        else ekle("satis", "Satış fiyatı (tüm satışlar)", "satis", null, harita(satirlar, "tum"));
      }
      if (alisAcik) {
        const satirlar = await aylikToplamlar(tx, { taraf: "alis", baslangic: toplamBasi, bitisHaric: toplamSonu, stokIdler: [stokId], varyantId: s.varyantId ?? null });
        birimsiz += satirlar.reduce((t, r) => t + r.birimsiz, 0);
        ekle("alis", "Alış fiyatı (tüm alışlar)", "alis", null, harita(satirlar, "tum"));
      }
      if (s.alis && !erisim.alis) uyarilar.push("Alış fiyatı tarafına erişiminiz olmadığı için gösterilmedi.");
      if (birimsiz) uyarilar.push(`${birimsiz} fatura satırının birimi ürün kartında tanımlı olmadığından ana birime çevrilemedi ve hesaba girmedi.`);
      if (bugunku) uyarilar.push(`${bugunku} satış satırının faturasında fiyat listesi izi yok (14.11.2026 öncesi); bu satırlar carinin bugünkü fiyat listesine göre sayıldı.`);
      const kismi = bitis === buAy();
      for (const e of endeksler) {
        if (e.tur === "endeks" && (!e.sonDonem || e.sonDonem < bitis)) uyarilar.push(`${e.ad}: en son ${e.sonDonem ? e.sonDonem.slice(0, 7) : "—"} dönemi açıklandı; karşılaştırma açıklanan son aya kadar yapılır.`);
        if (e.zincirlenenDonemSayisi) uyarilar.push(`${e.ad}: ${e.zincirlenenDonemSayisi} ay önceki baz yılı serisinden zincirlenerek gösterildi.`);
      }
      if (kismi && endeksler.some((e) => e.tur === "kur")) uyarilar.push("İçinde bulunulan ayın kur değeri ay başından bugüne ortalamadır.");

      // END-07: ek çizgiler ilk fiyat serisinin baz ay fiyatına göre aynı ölçeğe taşınır.
      const cizgiler = new Set(s.cizgiler);
      const olcekSerisi = seriler[0] ?? null;
      const bazMetni = olcekSerisi?.satirlar.find((r) => r.ay === baz)?.fiyat ?? null;
      const bazFiyat = bazMetni ? new Prisma.Decimal(bazMetni) : null;
      const ekCizgiler: EkCizgi[] = [];
      if (cizgiler.has("liste")) {
        if (!erisim.satis) uyarilar.push("Liste fiyatı satış tarafındadır; erişiminiz olmadığı için gösterilmedi.");
        else { const r = await listeFiyatCizgileri(tx, { stokId, aylar, listeIdleri: s.satisKapsami === "liste" ? s.listeler : null, bazFiyat }); ekCizgiler.push(...r.cizgiler); uyarilar.push(...r.uyarilar); }
      }
      const maliyetIstendi = cizgiler.has("maliyet") || cizgiler.has("sonAlis");
      if (maliyetIstendi && !erisim.alis) uyarilar.push("Maliyet ve son alış fiyatı alış tarafındadır; erişiminiz olmadığı için gösterilmedi.");
      if (erisim.alis && cizgiler.has("maliyet")) ekCizgiler.push(await maliyetCizgisi(tx, { stokId, varyantId: s.varyantId ?? null, aylar, bazFiyat }));
      if (erisim.alis && cizgiler.has("sonAlis")) ekCizgiler.push(await sonAlisCizgisi(tx, { stokId, varyantId: s.varyantId ?? null, aylar, bazFiyat }));
      if (ekCizgiler.length && !bazFiyat) uyarilar.push("Baz ayda gerçekleşen fiyat olmadığı için ek çizgiler grafikte ölçeklenemedi; TL değerleri tabloda.");

      return {
        stok, aylar, baz, erisim,
        esik: { enAzSatir: 2 },
        seriler,
        ekCizgiler,
        ekCizgiOlcegi: olcekSerisi && bazFiyat ? { seri: olcekSerisi.ad, bazFiyat: bazFiyat.toFixed(4) } : null,
        endeksler: endeksler.map((e) => ({ kod: e.kod, ad: e.ad, tur: e.tur, bazYili: e.bazYili, sonDonem: e.sonDonem, kismiAy: e.tur === "kur" && kismi ? bitis : null, degerler: endeksNormalle(e.degerler, aylar, baz) })),
        uyarilar,
      };
    }, { timeout: 20_000 });
  }
}

