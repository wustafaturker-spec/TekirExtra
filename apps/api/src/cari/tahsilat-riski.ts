import { Injectable } from "@nestjs/common";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { cariDavranisAnalizi, type CariAnalizSonucu } from "./cari-analiz";

/*
 * AI-17/AI-18: tahsilat gecikme tahmini ve önceliklendirme. Tek risk ölçüsü
 * cari kartındaki "Ödeme Davranışı Analizi"dir (cari-analiz.ts; kullanıcı
 * kararı 2026-10-13): risk seviyesi ve tahmini gecikme oradan gelir, burada
 * yeniden hesaplanmaz. Dil modeli kullanılmaz.
 */

export type RiskSeviyesi = CariAnalizSonucu["riskSeviyesi"];

export const RISK_KATSAYISI: Record<RiskSeviyesi, number> = { dusuk: 1, orta: 1.5, yuksek: 2 };
const GUN_MS = 86_400_000;
const YAKLASAN_GUN = 7;
const PARCA = 200;

/** AI-18: kalan tutar × risk katsayısı × (1 + gecikme günü / 30); vadesi gelmemişte gecikme 0. */
export function oncelikPuani(kalanTry: number, risk: RiskSeviyesi, gecikmeGun: number): number {
  return Math.round(kalanTry * RISK_KATSAYISI[risk] * (1 + Math.max(0, gecikmeGun) / 30));
}

/** AI-17: beklenen ödeme = vade + tahmini gecikme; bugünden önce olamaz. */
export function beklenenOdemeTarihi(vade: Date, tahminiGecikmeGun: number | null, bugun: Date): string {
  const t = new Date(vade.getTime() + Math.max(0, tahminiGecikmeGun ?? 0) * GUN_MS);
  return (t < bugun ? bugun : t).toISOString().slice(0, 10);
}

export interface AcikFatura {
  faturaId: string;
  no: string | null;
  cariId: string;
  cariUnvan: string;
  vadeTarihi: string;
  gecikmeGun: number;
  kalanTry: number;
  beklenenOdemeTarihi: string;
}

const bugunGunu = () => new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" })}T00:00:00Z`);

@Injectable()
export class TahsilatRiskiService {
  constructor(private readonly prisma: PrismaService) {}

  /** Carilerin ödeme davranışı analizi (cari kartıyla aynı fonksiyon ve veri). */
  private async analizler(cariIdler: string[]): Promise<Map<string, CariAnalizSonucu>> {
    const { tenantId } = aktifBaglam();
    const sonuc = new Map<string, CariAnalizSonucu>();
    for (let i = 0; i < cariIdler.length; i += PARCA) {
      const cariler = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariHesap.findMany({
          where: { id: { in: cariIdler.slice(i, i + PARCA) } },
          select: { id: true, riskLimiti: true, hareketler: { select: { tip: true, tutarTry: true, tarih: true, vadeTarihi: true }, orderBy: { tarih: "asc" } } },
        }),
      );
      for (const c of cariler) {
        sonuc.set(c.id, cariDavranisAnalizi(c.hareketler.map((h) => ({ ...h, tutarTry: Number(h.tutarTry) })), c.riskLimiti === null ? null : Number(c.riskLimiti)));
      }
    }
    return sonuc;
  }

  /** Kalanı olan kesin satış faturaları (vadesi geçenler raporuyla aynı kalan TL hesabı). */
  private async acikFaturalar(secenek: { cariId?: string; vadeSonu?: Date }) {
    const { tenantId } = aktifBaglam();
    const faturalar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.findMany({
        where: {
          tenantId, tip: "satis", durum: "kesin", vadeTarihi: { not: null, ...(secenek.vadeSonu ? { lte: secenek.vadeSonu } : {}) },
          ...(secenek.cariId ? { cariId: secenek.cariId } : {}),
        },
        select: { id: true, no: true, durum: true, vadeTarihi: true, genelToplam: true, kur: true, cari: { select: { id: true, unvan: true } }, ...FATURA_ODEME_SECIMI },
        orderBy: { vadeTarihi: "asc" },
      }),
    );
    return faturalar
      .map((f) => ({ f, kalanTry: faturaOdemeDurumu(f).kalan.mul(f.kur).toDecimalPlaces(2).toNumber() }))
      .filter((x) => x.kalanTry > 0);
  }

  /** AI-17: carinin açık faturaları ve beklenen ödeme tarihleri (risk = cari kartındaki analiz). */
  async cariRiski(cariId: string) {
    const bugun = bugunGunu();
    const [analiz, acik] = await Promise.all([this.analizler([cariId]), this.acikFaturalar({ cariId })]);
    const a = analiz.get(cariId) ?? null;
    return {
      riskSeviyesi: a?.riskSeviyesi ?? null,
      tahminiGecikmeGun: a?.tahminiGecikmeGun ?? null,
      guven: a?.guven ?? null,
      acikFaturalar: acik.map(({ f, kalanTry }): AcikFatura => ({
        faturaId: f.id, no: f.no, cariId, cariUnvan: f.cari.unvan, vadeTarihi: f.vadeTarihi!.toISOString().slice(0, 10),
        gecikmeGun: Math.round((bugun.getTime() - f.vadeTarihi!.getTime()) / GUN_MS), kalanTry,
        beklenenOdemeTarihi: beklenenOdemeTarihi(f.vadeTarihi!, a?.tahminiGecikmeGun ?? null, bugun),
      })),
    };
  }

  /**
   * AI-18: vadesi geçmiş ya da 7 gün içinde dolacak alacaklar, cari başına
   * öncelik puanıyla ("bugün kimi aramalı"); puanın bileşenleri de döner.
   */
  async oncelikler(adet = 50) {
    const bugun = bugunGunu();
    const acik = await this.acikFaturalar({ vadeSonu: new Date(bugun.getTime() + YAKLASAN_GUN * GUN_MS) });
    const analiz = await this.analizler([...new Set(acik.map((x) => x.f.cari.id))]);
    const cariler = new Map<string, { cariId: string; cariUnvan: string; kalanTry: number; enEskiGecikmeGun: number; faturaSayisi: number; puan: number }>();
    for (const { f, kalanTry } of acik) {
      const risk = analiz.get(f.cari.id)?.riskSeviyesi ?? "orta";
      const gecikme = Math.round((bugun.getTime() - f.vadeTarihi!.getTime()) / GUN_MS);
      const c = cariler.get(f.cari.id) ?? { cariId: f.cari.id, cariUnvan: f.cari.unvan, kalanTry: 0, enEskiGecikmeGun: -Infinity, faturaSayisi: 0, puan: 0 };
      c.kalanTry = Math.round((c.kalanTry + kalanTry) * 100) / 100;
      c.enEskiGecikmeGun = Math.max(c.enEskiGecikmeGun, gecikme);
      c.faturaSayisi++;
      c.puan += oncelikPuani(kalanTry, risk, gecikme);
      cariler.set(f.cari.id, c);
    }
    return [...cariler.values()]
      .sort((a, b) => b.puan - a.puan)
      .slice(0, adet)
      .map((c) => {
        const a = analiz.get(c.cariId);
        return { ...c, risk: a?.riskSeviyesi ?? "orta", riskSkoru: a?.riskSkoru ?? null, riskKatsayisi: RISK_KATSAYISI[a?.riskSeviyesi ?? "orta"], tahminiGecikmeGun: a?.tahminiGecikmeGun ?? null, guven: a?.guven ?? null };
      });
  }
}
