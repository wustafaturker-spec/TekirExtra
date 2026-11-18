import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type AiHafiza } from "@prisma/client";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import {
  AZAMI_TERCIH_ONERISI, ORNEK_SAYISI, TERCIH_METNI, adresAnahtari, ifadeAnahtari, onaydanOgrenilecekler, ornekMetni, tercihAnahtari,
  type HafizaDurumu, type HafizaKaynagi, type HafizaTuru, type HafizaKapsami, type OgrenmeKalemi,
} from "./hafiza.kurallari";

/** Yönetici ve muhasebe firmanın tüm hafızasını yönetir; diğer roller yalnız kendi oluşturduklarını (AI-59). */
const FIRMA_GENELI = new Set(["yonetici", "muhasebe"]);
/** AI-61: onaylanmış sayılan teklif durumları (satırları artık kullanıcının son kararıdır). */
const ONAYLI = new Set(["onaylandi", "kismen_kapandi", "kapandi", "revize_edildi"]);
const TARAMA_PARTISI = 20;

interface YazGirdisi {
  tur: HafizaTuru; anahtar: string; kaynak: HafizaKaynagi; durum?: HafizaDurumu;
  kapsam?: HafizaKapsami;
  cariId?: string | null; stokId?: string | null; varyantId?: string | null; metin?: string | null; etiket?: "teklif" | "teklif_degil" | "yarar" | "yaramaz" | "getirme" | null;
  kaynakEpostaId?: string | null;
  gecerlilikBitisAt?: Date | null;
  nedenOnerildi?: string | null;
}

export interface UrunHatirlama { id: string; stokId: string; varyantId: string | null }

export interface HafizaGorunumu {
  id: string; tur: string; anahtar: string; kapsam: string; metin: string | null; etiket: string | null; kaynak: string; durum: string;
  cari: { id: string; kod: string; unvan: string } | null;
  stok: { id: string; kod: string; ad: string; aktif: boolean } | null;
  varyant: { id: string; kod: string; ad: string; aktif: boolean } | null;
  olusturan: string | null; onaylayan: string | null; kaynakEpostaId: string | null;
  surum: number; sonDogrulamaAt: string | null; gecerlilikBitisAt: string | null; nedenOnerildi: string | null;
  kullanimSayisi: number; sonKullanimAt: string | null; olusturuldu: string; guncellendi: string;
}

/**
 * AI-58…65 / P-16: kiracıya ait ajan hafızası. Yalnız eşleşme, tercih ve örnek
 * tutar; tutar/fiyat/bakiye yazılmaz. Okumalar pasif kartı, kapanmış cariyi ve onaylanmamış
 * öneriyi döndürmez; hafıza hiçbir aracı kendiliğinden çağırmaz.
 */
@Injectable()
export class HafizaService {
  private readonly logger = new Logger(HafizaService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tekil (tür, cari, anahtar) kaydı yazar. Kullanıcının pasife aldığı kaydı yalnız kullanıcı yeniden açar;
   * kullanıcı kaydının üstüne AI önerisi yazılmaz.
   */
  async yaz(g: YazGirdisi): Promise<AiHafiza> {
    const { tenantId, userId } = aktifBaglam();
    const cariId = g.cariId ?? null;
    const kapsam: HafizaKapsami = g.kapsam ?? (g.cariId ? "cari" : g.tur === "musteri_tercihi" && g.kaynak === "kullanici" ? "kullanici" : "firma");
    const veri = {
      kapsam,
      stokId: g.stokId ?? null, varyantId: g.varyantId ?? null, metin: g.metin?.slice(0, 1000) ?? null, etiket: g.etiket ?? null,
      kaynak: g.kaynak, durum: g.durum ?? "aktif", kaynakEpostaId: g.kaynakEpostaId ?? null,
      gecerlilikBitisAt: g.gecerlilikBitisAt ?? null,
      nedenOnerildi: g.nedenOnerildi?.slice(0, 1000) ?? null,
    };
    const olusturanUserId = g.kaynak === "otomatik" ? null : userId;
    for (let deneme = 0; deneme < 2; deneme++) {
      try {
        return await this.prisma.tenantIslem(tenantId, async (tx) => {
          const mevcut = await tx.aiHafiza.findFirst({ where: { tenantId, tur: g.tur, cariId, anahtar: g.anahtar } });
          if (!mevcut) {
            return tx.aiHafiza.create({
              data: {
                tenantId, tur: g.tur, anahtar: g.anahtar, cariId, olusturanUserId,
                onaylayanUserId: g.kaynak === "kullanici" ? userId : null,
                sonDogrulamaAt: g.kaynak === "kullanici" ? new Date() : null,
                surum: 1,
                ...veri,
              },
            });
          }
          // P-16: Pasife alınmış kayıt yeniden otomatik öğrenilemez ya da AI önerisiyle ezilemez. Yalnız kullanıcı açabilir.
          if (mevcut.durum === "pasif" && g.kaynak !== "kullanici") return mevcut;
          // AI önerisi var olan kaydı değiştirmez (onaylanmış öneri öneriye geri dönmez)
          if (g.kaynak === "ai_onerisi") return mevcut;
          // Kullanıcı kaydının üstüne otomatik öğrenme yazılmaz
          if (g.kaynak === "otomatik" && (mevcut.kaynak === "kullanici" || mevcut.durum === "pasif")) return mevcut;

          const yeniSurum = (mevcut.surum ?? 1) + 1;
          return tx.aiHafiza.update({
            where: { id: mevcut.id },
            data: {
              ...veri,
              surum: yeniSurum,
              ...(g.kaynak === "kullanici" ? { olusturanUserId, onaylayanUserId: userId, sonDogrulamaAt: new Date() } : {}),
              updatedAt: new Date(),
            },
          });
        });
      } catch (hata) {
        // Eşzamanlı ilk yazım: tekil indeks ikinciyi reddeder, güncellemeyle yeniden denenir.
        if (deneme === 0 && hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") continue;
        throw hata;
      }
    }
    throw new Error("Hafıza kaydı yazılamadı");
  }

  /**
   * AI-61 / P-16: aynı cari için öğrenilmiş ürünler (kesin) ve başka carilerde öğrenilmiş
   * ürünler (yalnız aday). Kartı, varyantı ya da cari pasif olan kayıt veya süresi dolan kayıt döndürülmez.
   */
  async urunleriHatirla(cariId: string, ifadeler: string[]): Promise<{ kesin: Map<string, UrunHatirlama>; aday: Map<string, UrunHatirlama[]> }> {
    const { tenantId } = aktifBaglam();
    const anahtarlar = [...new Set(ifadeler.map(ifadeAnahtari).filter(Boolean))];
    const kesin = new Map<string, UrunHatirlama>();
    const aday = new Map<string, UrunHatirlama[]>();
    if (!anahtarlar.length) return { kesin, aday };
    const simdi = new Date();
    const kayitlar = await this.prisma.tenantIslem(tenantId, async (tx) => {
      // Cari aktif değilse hafıza işletilmez
      const cari = await tx.cariHesap.findFirst({ where: { id: cariId, tenantId, aktif: true }, select: { id: true } });
      if (!cari) return [];

      const k = await tx.aiHafiza.findMany({
        where: {
          tenantId, tur: "urun_eslesme", durum: "aktif", anahtar: { in: anahtarlar },
          OR: [{ gecerlilikBitisAt: null }, { gecerlilikBitisAt: { gte: simdi } }],
        },
        orderBy: { updatedAt: "desc" },
      });
      const stokIds = [...new Set(k.map((x) => x.stokId!).filter(Boolean))];
      const varyantIds = [...new Set(k.map((x) => x.varyantId).filter((x): x is string => Boolean(x)))];
      const [stoklar, varyantlar] = await Promise.all([
        tx.stokKart.findMany({ where: { tenantId, id: { in: stokIds }, aktif: true }, select: { id: true } }),
        varyantIds.length ? tx.stokVaryant.findMany({ where: { tenantId, id: { in: varyantIds }, aktif: true }, select: { id: true, stokId: true } }) : [],
      ]);
      const aktifStok = new Set(stoklar.map((s) => s.id));
      const aktifVaryant = new Map(varyantlar.map((v) => [v.id, v.stokId]));
      return k.filter((x) => x.stokId && aktifStok.has(x.stokId) && (!x.varyantId || aktifVaryant.get(x.varyantId) === x.stokId));
    });
    for (const x of kayitlar) {
      const h = { id: x.id, stokId: x.stokId!, varyantId: x.varyantId };
      if (x.cariId === cariId) { if (!kesin.has(x.anahtar)) kesin.set(x.anahtar, h); continue; }
      const liste = aday.get(x.anahtar) ?? [];
      if (!liste.some((l) => l.stokId === h.stokId && l.varyantId === h.varyantId)) aday.set(x.anahtar, [...liste, h]);
    }
    return { kesin, aday };
  }

  /** Kullanılan kayıtların sayacı; hata işi durdurmaz. */
  async kullanildi(idler: string[]): Promise<void> {
    if (!idler.length) return;
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.aiHafiza.updateMany({ where: { tenantId, id: { in: [...new Set(idler)] } }, data: { kullanimSayisi: { increment: 1 }, sonKullanimAt: new Date() } }))
      .catch((hata: unknown) => this.logger.warn(`Hafıza kullanımı yazılamadı: ${String(hata)}`));
  }

  urunOgret(g: { cariId: string; ifade: string; stokId: string; varyantId: string | null; kaynak: HafizaKaynagi; kaynakEpostaId?: string | null }) {
    const anahtar = ifadeAnahtari(g.ifade);
    if (!anahtar) return Promise.resolve(null);
    return this.yaz({ tur: "urun_eslesme", anahtar, cariId: g.cariId, stokId: g.stokId, varyantId: g.varyantId, metin: g.ifade.slice(0, 200), kaynak: g.kaynak, kaynakEpostaId: g.kaynakEpostaId });
  }

  /**
   * CNL-11: haftalık fikre verilen işaret. "getirme" türün tamamı içindir (anahtar `<tür>:*`);
   * "yarar"/"yaramaz" o kayda. Kullanıcı hafıza ekranından kapatırsa etkisi kalkar.
   */
  fikirIsaretle(g: { tur: string; varlikId: string | null; isaret: "yarar" | "yaramaz" | "getirme"; baslik: string }) {
    const anahtar = `${g.tur}:${g.isaret === "getirme" ? "*" : g.varlikId ?? "-"}`;
    return this.yaz({ tur: "fikir_isareti", anahtar, metin: g.baslik.slice(0, 200), etiket: g.isaret, kaynak: "kullanici" });
  }

  /** CNL-11: etkin fikir işaretleri (seçime girer). */
  async fikirIsaretleri(): Promise<Array<{ tur: string; varlikId: string | null; isaret: string; at: Date }>> {
    const { tenantId } = aktifBaglam();
    const l = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiHafiza.findMany({ where: { tenantId, tur: "fikir_isareti", durum: "aktif" }, select: { anahtar: true, etiket: true, updatedAt: true }, take: 500 }));
    return l.map((k) => {
      const [tur, varlik] = k.anahtar.split(":");
      return { tur, varlikId: varlik === "*" || varlik === "-" ? null : varlik, isaret: k.etiket ?? "", at: k.updatedAt };
    });
  }

  /** AI-62: kullanıcının seçtiği cari, gönderen adresi için hatırlanır. */
  cariOgret(adres: string, cariId: string, kaynakEpostaId: string | null) {
    return this.yaz({ tur: "cari_eslesme", anahtar: adresAnahtari(adres), cariId, metin: adres.trim().slice(0, 320), kaynak: "kullanici", kaynakEpostaId });
  }

  /** AI-62: adres için hatırlanan aktif cariler (cari de aktif olmalı). */
  async adresCarileri(adres: string): Promise<string[]> {
    const { tenantId } = aktifBaglam();
    const anahtar = adresAnahtari(adres);
    if (!anahtar) return [];
    const k = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.aiHafiza.findMany({ where: { tenantId, tur: "cari_eslesme", durum: "aktif", anahtar }, select: { id: true, cariId: true } });
      const cariler = await tx.cariHesap.findMany({ where: { tenantId, aktif: true, id: { in: kayitlar.map((x) => x.cariId!).filter(Boolean) } }, select: { id: true } });
      const aktif = new Set(cariler.map((c) => c.id));
      return kayitlar.filter((x) => x.cariId && aktif.has(x.cariId));
    });
    await this.kullanildi(k.map((x) => x.id));
    return k.map((x) => x.cariId!);
  }

  /** AI-63 / P-16: isteme ve taslağa yalnız aktif ve geçerli tercihler girer. Kullanıcı kapsamındaki tercihler diğer kullanıcıya uygulanmaz. */
  async aktifTercihler(cariId: string): Promise<string[]> {
    const { tenantId, userId } = aktifBaglam();
    const simdi = new Date();
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiHafiza.findMany({
      where: {
        tenantId, tur: "musteri_tercihi", durum: "aktif", cariId,
        OR: [{ gecerlilikBitisAt: null }, { gecerlilikBitisAt: { gte: simdi } }],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, metin: true, kapsam: true, olusturanUserId: true },
    }));
    // P-16: Kullanıcıya özel tercih diğer kullanıcıya uygulanmaz
    const gecerli = k.filter((x) => x.kapsam !== "kullanici" || !x.olusturanUserId || x.olusturanUserId === userId);
    await this.kullanildi(gecerli.map((x) => x.id));
    return gecerli.map((x) => x.metin ?? "").filter(Boolean);
  }

  /** Panel: carinin aktif tercihleri ve bekleyen önerileri. */
  async tercihler(cariId: string) {
    const { tenantId } = aktifBaglam();
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiHafiza.findMany({ where: { tenantId, tur: "musteri_tercihi", cariId, durum: { in: ["aktif", "oneri"] } }, orderBy: { createdAt: "asc" } }));
    return k.map((x) => ({ id: x.id, metin: x.metin ?? "", durum: x.durum, kaynak: x.kaynak, kapsam: x.kapsam, nedenOnerildi: x.nedenOnerildi }));
  }

  async tercihEkle(
    cariId: string,
    metin: string,
    kaynak: "kullanici" | "ai_onerisi",
    kaynakEpostaId: string | null = null,
    secenekler: { kapsam?: HafizaKapsami; gecerlilikBitisAt?: Date | null; nedenOnerildi?: string | null } = {},
  ) {
    const { tenantId } = aktifBaglam();
    // Yabancı anahtar denetimi RLS'i görmez; cari bu kiracıda olmalı.
    if (!(await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findFirst({ where: { id: cariId, tenantId }, select: { id: true } })))) throw new NotFoundException("Cari bulunamadı");
    const temiz = metin.replace(/\s+/g, " ").trim().slice(0, TERCIH_METNI);
    return this.yaz({
      tur: "musteri_tercihi", anahtar: tercihAnahtari(temiz), cariId, metin: temiz,
      kaynak, durum: kaynak === "kullanici" ? "aktif" : "oneri", kaynakEpostaId,
      kapsam: secenekler.kapsam ?? "cari",
      gecerlilikBitisAt: secenekler.gecerlilikBitisAt ?? null,
      nedenOnerildi: secenekler.nedenOnerildi ?? null,
    });
  }

  /** AI-63 / P-16: modelin önerdiği kalıcı tercihler gerekçesiyle öneri olarak yazılır; kullanıcı onaylamadan kullanılmaz. */
  async tercihOnerileri(cariId: string, metinler: string[], kaynakEpostaId: string, gerekceler?: string[]): Promise<number> {
    let n = 0;
    for (let i = 0; i < Math.min(metinler.length, AZAMI_TERCIH_ONERISI); i++) {
      const m = metinler[i];
      if (m.trim().length < 3) continue;
      const gerekce = gerekceler?.[i] ?? "E-posta teklif talebi içeriğinden önerilen müşteri tercihi";
      const k = await this.tercihEkle(cariId, m, "ai_onerisi", kaynakEpostaId, { nedenOnerildi: gerekce });
      if (k.durum === "oneri") n++;
    }
    return n;
  }

  /** AI-64: kullanıcının sınıflandırma kararı; e-posta başına tek örnek. */
  siniflandirmaKaydet(e: { id: string; konu: string; icerikMetin: string | null }, etiket: "teklif" | "teklif_degil") {
    return this.yaz({ tur: "siniflandirma", anahtar: e.id, etiket, metin: ornekMetni(e.konu, e.icerikMetin), kaynak: "kullanici", kaynakEpostaId: e.id });
  }

  async siniflandirmaOrnekleri(): Promise<Array<{ metin: string | null; etiket: string | null }>> {
    const { tenantId } = aktifBaglam();
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiHafiza.findMany({ where: { tenantId, tur: "siniflandirma", durum: "aktif" }, orderBy: { updatedAt: "desc" }, take: ORNEK_SAYISI, select: { id: true, metin: true, etiket: true } }));
    await this.kullanildi(k.map((x) => x.id));
    return k.reverse();
  }

  sustur(adres: string, kaynakEpostaId: string | null) {
    return this.yaz({ tur: "susturma", anahtar: adresAnahtari(adres), metin: adres.trim().slice(0, 320), kaynak: "kullanici", kaynakEpostaId });
  }

  async susturulduMu(adres: string): Promise<boolean> {
    const { tenantId } = aktifBaglam();
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiHafiza.findFirst({ where: { tenantId, tur: "susturma", durum: "aktif", anahtar: adresAnahtari(adres) }, select: { id: true } }));
    if (k) await this.kullanildi([k.id]);
    return Boolean(k);
  }

  /**
   * AI-61: e-postadan açılmış ve taslak dışına çıkmış teklifler bir kez öğrenilir
   * (iptal edilen öğrenilmez). Worker'dan kiracı bağlamında çağrılır.
   */
  async tekliftenOgren(): Promise<number> {
    const { tenantId } = aktifBaglam();
    const islemler = await this.prisma.tenantIslem(tenantId, (tx) => tx.epostaTeklifIslemi.findMany({
      where: { tenantId, belgeId: { not: null }, cariId: { not: null }, hafizaIslendiAt: null },
      select: { id: true, belgeId: true, cariId: true, gelenEpostaId: true, kalemler: true }, take: TARAMA_PARTISI, orderBy: { updatedAt: "asc" },
    }));
    let ogrenilen = 0;
    for (const i of islemler) {
      const belge = await this.prisma.tenantIslem(tenantId, (tx) => tx.belge.findFirst({ where: { id: i.belgeId!, tenantId }, select: { durum: true, cariId: true, satirlar: { select: { stokId: true, varyantId: true } } } }));
      if (belge && belge.durum === "taslak") continue;
      if (belge && ONAYLI.has(belge.durum) && belge.cariId === i.cariId) {
        const kalemler = ((i.kalemler as unknown as Array<Record<string, any>>) ?? []).map((k): OgrenmeKalemi => ({
          ifade: String(k.ifade ?? ""), stokId: k.stokId ?? null, varyantId: k.varyantId ?? null, belirsizStokId: k.belirsizKart?.stokId ?? null,
        })).filter((k) => k.ifade);
        for (const o of onaydanOgrenilecekler(kalemler, belge.satirlar)) {
          await this.urunOgret({ cariId: i.cariId!, ifade: o.ifade, stokId: o.stokId, varyantId: o.varyantId, kaynak: "otomatik", kaynakEpostaId: i.gelenEpostaId });
          ogrenilen++;
        }
      }
      await this.prisma.tenantIslem(tenantId, (tx) => tx.epostaTeklifIslemi.update({ where: { id: i.id }, data: { hafizaIslendiAt: new Date() } }));
    }
    return ogrenilen;
  }

  // ─── Hafıza ekranı (AI-59 / P-16) ────────────────────────────────────────

  private kapsam(): Prisma.AiHafizaWhereInput {
    const { tenantId, userId, rol } = aktifBaglam();
    return FIRMA_GENELI.has(rol) ? { tenantId } : { tenantId, olusturanUserId: userId };
  }

  async liste(f: { tur?: HafizaTuru; durum?: HafizaDurumu; cariId?: string; sayfa: number; adet: number }) {
    const { tenantId } = aktifBaglam();
    const where: Prisma.AiHafizaWhereInput = { ...this.kapsam(), ...(f.tur ? { tur: f.tur } : {}), ...(f.durum ? { durum: f.durum } : {}), ...(f.cariId ? { cariId: f.cariId } : {}) };
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [toplam, kayitlar] = await Promise.all([
        tx.aiHafiza.count({ where }),
        tx.aiHafiza.findMany({ where, orderBy: [{ durum: "asc" }, { updatedAt: "desc" }], skip: (f.sayfa - 1) * f.adet, take: f.adet }),
      ]);
      const benzersiz = (d: Array<string | null>) => [...new Set(d.filter((x): x is string => Boolean(x)))];
      const [cariler, stoklar, varyantlar, kullanicilar, onaylayanlar] = await Promise.all([
        tx.cariHesap.findMany({ where: { tenantId, id: { in: benzersiz(kayitlar.map((k) => k.cariId)) } }, select: { id: true, kod: true, unvan: true } }),
        tx.stokKart.findMany({ where: { tenantId, id: { in: benzersiz(kayitlar.map((k) => k.stokId)) } }, select: { id: true, kod: true, ad: true, aktif: true } }),
        tx.stokVaryant.findMany({ where: { tenantId, id: { in: benzersiz(kayitlar.map((k) => k.varyantId)) } }, select: { id: true, kod: true, ad: true, aktif: true } }),
        tx.user.findMany({ where: { tenantId, id: { in: benzersiz(kayitlar.map((k) => k.olusturanUserId)) } }, select: { id: true, adSoyad: true, eposta: true } }),
        tx.user.findMany({ where: { tenantId, id: { in: benzersiz(kayitlar.map((k) => k.onaylayanUserId)) } }, select: { id: true, adSoyad: true, eposta: true } }),
      ]);
      const harita = <T extends { id: string }>(l: T[]) => new Map(l.map((x) => [x.id, x]));
      const c = harita(cariler), s = harita(stoklar), v = harita(varyantlar), u = harita(kullanicilar), o = harita(onaylayanlar);
      return {
        toplam,
        kayitlar: kayitlar.map((k): HafizaGorunumu => ({
          id: k.id, tur: k.tur, anahtar: k.anahtar, kapsam: k.kapsam, metin: k.metin, etiket: k.etiket, kaynak: k.kaynak, durum: k.durum,
          cari: k.cariId ? c.get(k.cariId) ?? null : null, stok: k.stokId ? s.get(k.stokId) ?? null : null, varyant: k.varyantId ? v.get(k.varyantId) ?? null : null,
          olusturan: k.olusturanUserId ? (u.get(k.olusturanUserId)?.adSoyad || u.get(k.olusturanUserId)?.eposta || null) : null,
          onaylayan: k.onaylayanUserId ? (o.get(k.onaylayanUserId)?.adSoyad || o.get(k.onaylayanUserId)?.eposta || null) : null,
          kaynakEpostaId: k.kaynakEpostaId, surum: k.surum,
          sonDogrulamaAt: k.sonDogrulamaAt?.toISOString() ?? null,
          gecerlilikBitisAt: k.gecerlilikBitisAt?.toISOString() ?? null,
          nedenOnerildi: k.nedenOnerildi,
          kullanimSayisi: k.kullanimSayisi, sonKullanimAt: k.sonKullanimAt?.toISOString() ?? null,
          olusturuldu: k.createdAt.toISOString(), guncellendi: k.updatedAt.toISOString(),
        })),
      };
    });
  }

  private async yetkiliKayit(id: string): Promise<AiHafiza> {
    const { tenantId } = aktifBaglam();
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiHafiza.findFirst({ where: { id, tenantId } }));
    if (!k) throw new NotFoundException("Hafıza kaydı bulunamadı");
    const kapsam = this.kapsam();
    if (kapsam.olusturanUserId && k.olusturanUserId !== kapsam.olusturanUserId) throw new ForbiddenException("Bu hafıza kaydını yalnız oluşturan ya da yönetici/muhasebe yönetebilir");
    return k;
  }

  /** P-16: Öneriyi onaylama (aktif) ya da reddetme/devre dışı bırakma (pasif); sürüm ve onaylayan kaydedilir. */
  async durumDegistir(id: string, durum: "aktif" | "pasif") {
    const { tenantId, userId } = aktifBaglam();
    const k = await this.yetkiliKayit(id);
    const yeniSurum = (k.surum ?? 1) + 1;
    await this.prisma.tenantIslem(tenantId, (tx) => tx.aiHafiza.update({
      where: { id: k.id },
      data: { durum, onaylayanUserId: userId, sonDogrulamaAt: new Date(), surum: yeniSurum, updatedAt: new Date() },
    }));
    return { id, durum, surum: yeniSurum };
  }

  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    const k = await this.yetkiliKayit(id);
    await this.prisma.tenantIslem(tenantId, (tx) => tx.aiHafiza.delete({ where: { id: k.id } }));
    return { silindi: true };
  }
}
