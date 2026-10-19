import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { belgeNoMetni } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { INCELENECEK, epostaKutudaMi } from "./is-kutusu.kurallari";

type Tx = Prisma.TransactionClient;
export type Kapsam = "bana" | "firma";

/** Yanıt gelen teklif bu kadar gün iş kutusunda kalır (siparişe dönüşmediyse). */
const YANIT_GUN = 14;
const SINIR = 50;

const kisa = (m: string | null | undefined, n = 240) => (m && m.length > n ? `${m.slice(0, n - 1)}…` : m ?? "");

/**
 * AI-48…51: teklif sürecindeki açık işler tek ekranda. Yalnız okur; eylemler
 * mevcut uçlarla (teklif talebi, teklif takibi) yapılır. Kapsam varsayılan
 * olarak kullanıcının kendi işleri (çalıştıran / sorumlu); yönetici firma
 * genelini görebilir.
 */
@Injectable()
export class IsKutusuService {
  constructor(private readonly prisma: PrismaService) {}

  private kapsamCoz(kapsam: Kapsam) {
    const { tenantId, userId, rol } = aktifBaglam();
    if (kapsam === "firma" && rol !== "yonetici") throw new ForbiddenException("Firma geneli iş kutusunu yalnız yönetici görebilir");
    return { tenantId, userId, firma: kapsam === "firma" };
  }

  async listele(kapsam: Kapsam = "bana") {
    const { tenantId, userId, firma } = this.kapsamCoz(kapsam);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [islemler, onaylar, takipEdilecek, yanitGelen] = await Promise.all([
        this.epostaIslemleri(tx, tenantId, firma ? null : userId),
        tx.aiOnayTalebi.findMany({
          // Onay talebini yalnız açan kullanıcı onaylar; firma görünümünde diğerleri bilgi içindir.
          where: { tenantId, durum: "bekliyor", gecerlilikSonu: { gt: new Date() }, ...(firma ? {} : { userId }) },
          select: { id: true, arac: true, ozet: true, kaynak: true, createdAt: true, gecerlilikSonu: true, userId: true, user: { select: { adSoyad: true } } },
          orderBy: { createdAt: "desc" }, take: SINIR,
        }),
        tx.teklifTakibi.findMany({
          where: { tenantId, durum: "hatirlatildi", ...(firma ? {} : { sorumluUserId: userId }) },
          select: { id: true, belgeId: true, gonderildiAt: true, hatirlatmaGunu: true, alici: true, gonderimSayisi: true, sorumluUserId: true, belge: { select: { no: true, revizyonNo: true, genelToplam: true, dovizCinsi: true, gecerlilikTarihi: true, cari: { select: { id: true, unvan: true } } } } },
          orderBy: { hatirlatmaGunu: "asc" }, take: SINIR,
        }),
        tx.teklifTakibi.findMany({
          where: { tenantId, durum: "yanit_geldi", yanitAt: { gte: new Date(Date.now() - YANIT_GUN * 86_400_000) }, belge: { durum: "onaylandi" }, ...(firma ? {} : { sorumluUserId: userId }) },
          select: { id: true, belgeId: true, yanitAt: true, yanitEpostaId: true, kapanisNedeni: true, sorumluUserId: true, belge: { select: { no: true, revizyonNo: true, genelToplam: true, dovizCinsi: true, cari: { select: { id: true, unvan: true } } } } },
          orderBy: { yanitAt: "desc" }, take: SINIR,
        }),
      ]);
      const kullanicilar = await this.adlar(tx, tenantId, [...takipEdilecek, ...yanitGelen].map((t) => t.sorumluUserId));
      const teklif = (b: { no: string | null; revizyonNo: number; genelToplam: Prisma.Decimal; dovizCinsi: string; cari: { id: string; unvan: string } }) => ({
        no: b.no ? belgeNoMetni(b.no, b.revizyonNo) : null, tutar: b.genelToplam.toString(), doviz: b.dovizCinsi, cari: b.cari,
      });
      return {
        kapsam,
        cariSecimi: islemler.filter((i) => i.durum === "cari_secimi"),
        taslaklar: islemler.filter((i) => i.belge?.durum === "taslak"),
        incelenecek: islemler.filter((i) => INCELENECEK.includes(i.durum) && !i.belge),
        onaylar: onaylar.map((o) => ({ id: o.id, arac: o.arac, ozet: kisa(o.ozet), kaynak: o.kaynak, zaman: o.createdAt.toISOString(), gecerlilikSonu: o.gecerlilikSonu.toISOString(), kim: o.user.adSoyad, benim: o.userId === userId, adres: `/panel/ai?talep=${o.id}` })),
        takipEdilecek: takipEdilecek.map((t) => ({
          id: t.id, belgeId: t.belgeId, ...teklif(t.belge), gonderildiAt: t.gonderildiAt.toISOString(), hatirlatmaGunu: t.hatirlatmaGunu.toISOString().slice(0, 10),
          alici: t.alici, gonderimSayisi: t.gonderimSayisi, gecerlilik: t.belge.gecerlilikTarihi?.toISOString().slice(0, 10) ?? null,
          kim: t.sorumluUserId ? kullanicilar.get(t.sorumluUserId) ?? null : null, adres: `/panel/belgeler?odak=${t.belgeId}`,
        })),
        yanitGelen: yanitGelen.map((t) => ({
          id: t.id, belgeId: t.belgeId, ...teklif(t.belge), yanitAt: t.yanitAt!.toISOString(), yanitEpostaId: t.yanitEpostaId, not: t.kapanisNedeni,
          kim: t.sorumluUserId ? kullanicilar.get(t.sorumluUserId) ?? null : null, adres: `/panel/belgeler?odak=${t.belgeId}`,
        })),
      };
    });
  }

  /** AI-51: menü rozeti — yalnız kendi açık işleri, hafif sayım. */
  async sayac(): Promise<{ toplam: number }> {
    const { tenantId, userId } = aktifBaglam();
    const sayilar = await this.prisma.tenantIslem(tenantId, async (tx) => Promise.all([
      tx.epostaTeklifIslemi.count({ where: { tenantId, calistiranUserId: userId, durum: { in: ["cari_secimi", ...INCELENECEK] }, belgeId: null } }),
      (async () => {
        const idler = (await tx.epostaTeklifIslemi.findMany({ where: { tenantId, calistiranUserId: userId, belgeId: { not: null }, durum: { notIn: ["kapatildi", "teklif_degil"] } }, select: { belgeId: true }, take: 500 })).map((k) => k.belgeId!);
        return idler.length ? tx.belge.count({ where: { tenantId, id: { in: idler }, durum: "taslak" } }) : 0;
      })(),
      tx.aiOnayTalebi.count({ where: { tenantId, userId, durum: "bekliyor", gecerlilikSonu: { gt: new Date() } } }),
      tx.teklifTakibi.count({ where: { tenantId, sorumluUserId: userId, OR: [{ durum: "hatirlatildi" }, { durum: "yanit_geldi", yanitAt: { gte: new Date(Date.now() - YANIT_GUN * 86_400_000) }, belge: { durum: "onaylandi" } }] } }),
    ]));
    return { toplam: sayilar.reduce((t, x) => t + x, 0) };
  }

  private async epostaIslemleri(tx: Tx, tenantId: string, userId: string | null) {
    const kayitlar = await tx.epostaTeklifIslemi.findMany({
      where: {
        tenantId, ...(userId ? { calistiranUserId: userId } : {}),
        // AI-68: kaldırılan işlem (elle girilmiş teklife bağlı olsa da) kutuya dönmez.
        OR: [{ durum: { in: ["cari_secimi", ...INCELENECEK] } }, { belgeId: { not: null }, durum: { notIn: ["kapatildi", "teklif_degil"] } }],
      },
      select: {
        id: true, durum: true, uyarilar: true, cariAdaylari: true, belgeId: true, updatedAt: true, calistiranUserId: true,
        gelenEposta: { select: { id: true, konu: true, gonderenAdi: true, gonderenEposta: true, tarih: true } },
      },
      orderBy: { updatedAt: "desc" }, take: SINIR * 2,
    });
    const belgeler = await tx.belge.findMany({
      where: { tenantId, id: { in: kayitlar.map((k) => k.belgeId).filter((x): x is string => Boolean(x)) } },
      select: { id: true, durum: true, genelToplam: true, dovizCinsi: true, cari: { select: { id: true, unvan: true } } },
    });
    const belgeHaritasi = new Map(belgeler.map((b) => [b.id, b]));
    const adlar = await this.adlar(tx, tenantId, kayitlar.map((k) => k.calistiranUserId));
    return kayitlar
      .map((k) => {
        const b = k.belgeId ? belgeHaritasi.get(k.belgeId) ?? null : null;
        return {
          id: k.id, durum: k.durum, epostaId: k.gelenEposta.id, konu: k.gelenEposta.konu, gonderen: k.gelenEposta.gonderenAdi ? `${k.gelenEposta.gonderenAdi} <${k.gelenEposta.gonderenEposta}>` : k.gelenEposta.gonderenEposta,
          epostaTarihi: k.gelenEposta.tarih.toISOString(), zaman: k.updatedAt.toISOString(), uyarilar: (k.uyarilar as string[]).map((u) => kisa(u)),
          cariAdaylari: k.cariAdaylari as unknown as Array<{ cariId: string; kod: string | null; unvan: string; gerekceler: string[] }>,
          kim: k.calistiranUserId ? adlar.get(k.calistiranUserId) ?? null : null,
          belge: b ? { id: b.id, durum: b.durum, tutar: b.genelToplam.toString(), doviz: b.dovizCinsi, cari: b.cari } : null,
          adres: b ? `/panel/belgeler?odak=${b.id}` : "/panel/eposta",
        };
      })
      .filter((k) => epostaKutudaMi(k.durum, k.belge?.durum ?? null))
      .slice(0, SINIR);
  }

  private async adlar(tx: Tx, tenantId: string, idler: Array<string | null>): Promise<Map<string, string>> {
    const benzersiz = [...new Set(idler.filter((x): x is string => Boolean(x)))];
    if (!benzersiz.length) return new Map();
    const kullanicilar = await tx.user.findMany({ where: { tenantId, id: { in: benzersiz } }, select: { id: true, adSoyad: true } });
    return new Map(kullanicilar.map((k) => [k.id, k.adSoyad]));
  }
}
