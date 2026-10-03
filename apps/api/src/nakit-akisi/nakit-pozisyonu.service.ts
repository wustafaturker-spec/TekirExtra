import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DovizService } from "../doviz/doviz.service";
import { NakitAkisiService } from "./nakit-akisi.service";

/**
 * NAK-15 (karar 2026-10-03, finans incelemesi P3-3): anlık nakit pozisyonu.
 * Hazır değerler (kasa, banka, POS'ta bekleyen, portföydeki alınan çek/senet)
 * ve kısa vadeli finansal borçlar (kredi kartı, kredilerin kalan anaparası,
 * verilen çek/senet) döviz bazında; TL karşılığı TCMB döviz alış kuruyla.
 * Yakın vadeler (7/30 gün) nakit akışı tahmininden gelir.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const girisMi = (tip: string) => tip === "tahsilat" || tip === "virman_gelis";

export interface PozisyonKalemi {
  tur: "kasa" | "banka" | "pos" | "alinan_cek" | "kart" | "kredi" | "verilen_cek";
  id: string;
  ad: string;
  dovizCinsi: string;
  tutar: string;
  tl: string | null;
  baglanti: string;
}

const KAYNAK_ADI: Record<string, string> = {
  fatura: "Fatura vadeleri", cek_senet: "Çek/senet", masraf: "Masraflar", kira: "Kira", kart_ekstre: "Kart ekstresi",
  kredi_taksit: "Kredi taksitleri", bordro: "Maaş", tekrarlayan_fatura: "Tekrarlayan fatura", odeme_talimati: "Ödeme talimatı",
};

@Injectable()
export class NakitPozisyonuService {
  private readonly logger = new Logger(NakitPozisyonuService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly doviz: DovizService,
    private readonly nakitAkisi: NakitAkisiService,
  ) {}

  async pozisyon() {
    const { tenantId } = aktifBaglam();
    const ham = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const [kasalar, bankalar, poslar, hareketler, cekler, kartlar, kartGruplari, krediler, krediGruplari] = await Promise.all([
        tx.kasa.findMany({ where: { aktif: true }, select: { id: true, ad: true, dovizCinsi: true } }),
        tx.bankaHesap.findMany({ where: { aktif: true }, select: { id: true, ad: true, bankaAdi: true, dovizCinsi: true } }),
        tx.posHesap.findMany({ where: { aktif: true }, select: { id: true, ad: true, dovizCinsi: true } }),
        tx.kasaBankaHareket.groupBy({ by: ["kasaId", "bankaHesapId", "posHesapId", "tip"], _sum: { tutar: true } }),
        tx.cekSenet.groupBy({ by: ["yon", "dovizCinsi"], where: { OR: [{ yon: "alinan", durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi"] } }, { yon: "verilen", durum: "verildi" }] }, _sum: { tutar: true }, _count: { _all: true } }),
        tx.krediKarti.findMany({ where: { aktif: true }, select: { id: true, ad: true, sonDortHane: true, dovizCinsi: true } }),
        tx.krediKartiHareket.groupBy({ by: ["krediKartiId", "tip"], _sum: { tutar: true } }),
        tx.bankaKredisi.findMany({ where: { durum: "aktif" }, select: { id: true, ad: true, dovizCinsi: true } }),
        tx.bankaKrediIslemi.groupBy({ by: ["krediId", "tip"], _sum: { anapara: true } }),
      ]);
      const bakiye = (alan: "kasaId" | "bankaHesapId" | "posHesapId", id: string) =>
        hareketler.filter((h) => h[alan] === id).reduce((t, h) => (girisMi(h.tip) ? t.add(h._sum.tutar ?? 0) : t.sub(h._sum.tutar ?? 0)), D(0));
      const kartBorcu = (id: string) =>
        Prisma.Decimal.max(0, kartGruplari.filter((g) => g.krediKartiId === id).reduce((t, g) => (["harcama", "faiz", "aidat"].includes(g.tip) ? t.add(g._sum.tutar ?? 0) : t.sub(g._sum.tutar ?? 0)), D(0)));
      const krediKalani = (id: string) =>
        krediGruplari.filter((g) => g.krediId === id).reduce((t, g) => (g.tip === "kullanim" ? t.add(g._sum.anapara ?? 0) : g.tip === "faiz" ? t : t.sub(g._sum.anapara ?? 0)), D(0));
      const kalem = (tur: PozisyonKalemi["tur"], id: string, ad: string, dovizCinsi: string, tutar: Prisma.Decimal, baglanti: string) => ({ tur, id, ad, dovizCinsi, tutar, baglanti });
      return {
        varliklar: [
          ...kasalar.map((k) => kalem("kasa", k.id, k.ad, k.dovizCinsi, bakiye("kasaId", k.id), `/panel/kasa-banka/hesap-ekstresi?hesap=kasa:${k.id}`)),
          ...bankalar.map((b) => kalem("banka", b.id, `${b.bankaAdi} · ${b.ad}`, b.dovizCinsi, bakiye("bankaHesapId", b.id), `/panel/kasa-banka/hesap-ekstresi?hesap=banka:${b.id}`)),
          ...poslar.map((p) => kalem("pos", p.id, `${p.ad} (bankaya geçecek)`, p.dovizCinsi, bakiye("posHesapId", p.id), "/panel/kasa-banka/pos")).filter((k) => !k.tutar.isZero()),
          ...cekler.filter((c) => c.yon === "alinan").map((c) => kalem("alinan_cek", `alinan:${c.dovizCinsi}`, `Portföydeki çek/senet (${c._count._all} evrak)`, c.dovizCinsi, D(c._sum.tutar ?? 0), "/panel/kasa-banka/cek-senet")),
        ],
        borclar: [
          ...kartlar.map((k) => kalem("kart", k.id, `${k.ad} •••• ${k.sonDortHane}`, k.dovizCinsi, kartBorcu(k.id), `/panel/kasa-banka/kredi-kartlari?kart=${k.id}`)).filter((k) => k.tutar.gt(0)),
          ...krediler.map((k) => kalem("kredi", k.id, k.ad, k.dovizCinsi, krediKalani(k.id), `/panel/kasa-banka/krediler?kredi=${k.id}`)).filter((k) => k.tutar.gt(0)),
          ...cekler.filter((c) => c.yon === "verilen").map((c) => kalem("verilen_cek", `verilen:${c.dovizCinsi}`, `Verilen çek/senet (${c._count._all} evrak)`, c.dovizCinsi, D(c._sum.tutar ?? 0), "/panel/kasa-banka/cek-senet")),
        ],
      };
    });

    // TL karşılığı TCMB döviz alış; kuru olmayan döviz toplama girmez, uyarılır.
    const dovizler = new Set([...ham.varliklar, ...ham.borclar].map((k) => k.dovizCinsi).filter((d) => d !== "TRY"));
    let kurlar: Record<string, number> = {};
    let kurTarihi: string | null = null;
    if (dovizler.size) {
      try {
        const k = await this.doviz.kurlariGetir(undefined, "alis");
        kurlar = k.kurlar;
        kurTarihi = k.kurTarihi;
      } catch (hata) {
        this.logger.warn(`Nakit pozisyonu için kur alınamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
      }
    }
    const tl = (doviz: string, tutar: Prisma.Decimal) => (doviz === "TRY" ? tutar : kurlar[doviz] ? tutar.mul(kurlar[doviz]).toDecimalPlaces(2) : null);
    const disaVer = (k: (typeof ham.varliklar)[number]): PozisyonKalemi => ({ ...k, tutar: k.tutar.toFixed(2), tl: tl(k.dovizCinsi, k.tutar)?.toFixed(2) ?? null });
    const varliklar = ham.varliklar.map(disaVer);
    const borclar = ham.borclar.map(disaVer);

    const dovizOzet = new Map<string, { varlik: Prisma.Decimal; borc: Prisma.Decimal }>();
    for (const [liste, alan] of [[ham.varliklar, "varlik"], [ham.borclar, "borc"]] as const) {
      for (const k of liste) {
        const o = dovizOzet.get(k.dovizCinsi) ?? { varlik: D(0), borc: D(0) };
        o[alan] = o[alan].add(k.tutar);
        dovizOzet.set(k.dovizCinsi, o);
      }
    }
    const topla = (liste: PozisyonKalemi[]) => liste.reduce((t, k) => t.add(k.tl ?? 0), D(0));
    const varlikTl = topla(varliklar);
    const borcTl = topla(borclar);

    // Yakın vadeler: nakit akışının 30 günlük tahmini; 7 gün ondan süzülür.
    let vadeler: Record<"7" | "30", { giris: number; cikis: number; net: number; kaynaklar: Array<{ ad: string; giris: number; cikis: number }>; kalemler: Array<{ tarih: string; vade: string; gecikmis: boolean; yon: string; tutar: number; aciklama: string; kaynak: string }> }> | null = null;
    try {
      const t = await this.nakitAkisi.tahmin(30);
      const ufuk = (gun: number) => {
        const sinir = new Date(Date.parse(`${t.bugun}T00:00:00Z`) + (gun - 1) * 86_400_000).toISOString().slice(0, 10);
        // Baz senaryonun beklenen tarihi: vadesi geçmiş kalem bugüne alınmıştır.
        const beklenen = (k: (typeof t.kalemler)[number]) => k.tarihler?.baz?.tarih ?? k.vade;
        const kalemler = t.kalemler.filter((k) => beklenen(k) <= sinir);
        const kaynaklar = new Map<string, { ad: string; giris: number; cikis: number }>();
        for (const k of kalemler) {
          const o = kaynaklar.get(k.kaynak) ?? { ad: KAYNAK_ADI[k.kaynak] ?? k.kaynak, giris: 0, cikis: 0 };
          o[k.yon === "giris" ? "giris" : "cikis"] += k.tutar;
          kaynaklar.set(k.kaynak, o);
        }
        const giris = kalemler.filter((k) => k.yon === "giris").reduce((s, k) => s + k.tutar, 0);
        const cikis = kalemler.filter((k) => k.yon === "cikis").reduce((s, k) => s + k.tutar, 0);
        const yuvarla = (n: number) => Math.round(n * 100) / 100;
        return {
          giris: yuvarla(giris), cikis: yuvarla(cikis), net: yuvarla(giris - cikis),
          kaynaklar: [...kaynaklar.values()].map((k) => ({ ...k, giris: yuvarla(k.giris), cikis: yuvarla(k.cikis) })),
          kalemler: [...kalemler].sort((a, b) => beklenen(a).localeCompare(beklenen(b)) || a.vade.localeCompare(b.vade)).slice(0, 60)
            .map((k) => ({ tarih: beklenen(k), vade: k.vade, gecikmis: k.vade < t.bugun, yon: k.yon, tutar: k.tutar, aciklama: k.aciklama, kaynak: KAYNAK_ADI[k.kaynak] ?? k.kaynak })),
        };
      };
      vadeler = { "7": ufuk(7), "30": ufuk(30) };
    } catch (hata) {
      this.logger.warn(`Nakit pozisyonu vadeleri hesaplanamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
    }

    return {
      kurTarihi,
      kurEksik: [...dovizler].filter((d) => !kurlar[d]),
      varliklar,
      borclar,
      dovizler: [...dovizOzet.entries()]
        .sort(([a], [b]) => (a === "TRY" ? -1 : b === "TRY" ? 1 : a.localeCompare(b)))
        .map(([dovizCinsi, o]) => ({ dovizCinsi, varlik: o.varlik.toFixed(2), borc: o.borc.toFixed(2), net: o.varlik.sub(o.borc).toFixed(2), kur: dovizCinsi === "TRY" ? 1 : kurlar[dovizCinsi] ?? null })),
      toplamTl: { varlik: varlikTl.toFixed(2), borc: borcTl.toFixed(2), net: varlikTl.sub(borcTl).toFixed(2) },
      vadeler,
    };
  }
}
