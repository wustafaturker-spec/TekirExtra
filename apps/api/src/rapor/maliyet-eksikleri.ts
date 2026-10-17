import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { maliyetBilinmiyor, satisSatirlari, type SatisSatiri } from "../stok/satis-ozeti";

const gun = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
});
const sema = z.object({
  baslangic: gun, bitis: gun,
  stokId: z.string().uuid().optional(),
  neden: z.enum(["hepsi", "hareket_yok", "sifir_maliyet"]).default("hepsi"),
  sayfa: z.coerce.number().int().min(1).max(100000).default(1),
  sayfaBoyutu: z.coerce.number().int().min(1).max(100).default(50),
});
export function maliyetEksigiSorgusu(sorgu: Record<string, unknown>) {
  const p = sema.safeParse(sorgu);
  if (!p.success) throw new BadRequestException("Geçerli başlangıç/bitiş tarihi, filtre ve sayfalama bilgisi girin.");
  const { baslangic, bitis } = p.data;
  const fark = Date.parse(bitis) - Date.parse(baslangic);
  if (fark < 0 || fark > 365 * 86400000) throw new BadRequestException("En fazla 366 günlük, sıralı bir tarih aralığı seçin.");
  return p.data;
}
type Sorgu = ReturnType<typeof maliyetEksigiSorgusu>;
const nedenBul = (s: SatisSatiri) => s.hareketPaylari.length ? "sifir_maliyet" : "hareket_yok";
const ozet = (satirlar: SatisSatiri[]) => ({
  satir: satirlar.length,
  ciro: satirlar.reduce((t, s) => t.add(s.ciro), new Prisma.Decimal(0)).toFixed(2),
});

/** Aynı muhasebe kaynağı ve aynı uyarı koşulu; sıfır maliyetin nedenini tahmin etmez. */
export function maliyetEksigiListesi(satirlar: SatisSatiri[], q: Sorgu, kapsam: "sayfa" | "tum" = "sayfa") {
  const donem = satirlar.filter(maliyetBilinmiyor);
  const suzulen = donem.filter((s) => (!q.stokId || s.stokId === q.stokId) && (q.neden === "hepsi" || nedenBul(s) === q.neden));
  return {
    baslangic: q.baslangic, bitis: q.bitis,
    donemOzeti: ozet(donem), filtreOzeti: ozet(suzulen),
    sayfa: q.sayfa, sayfaBoyutu: q.sayfaBoyutu, toplamSayfa: Math.ceil(suzulen.length / q.sayfaBoyutu),
    satirlar: (kapsam === "tum" ? suzulen : suzulen.slice((q.sayfa - 1) * q.sayfaBoyutu, q.sayfa * q.sayfaBoyutu)).map((s) => ({
      id: s.faturaSatirId!, faturaId: s.faturaId, faturaNo: s.faturaNo,
      tarih: s.tarih.toISOString().slice(0, 10), cariUnvan: s.cariUnvan,
      stokId: s.stokId, kod: s.kod, ad: s.ad, miktar: s.miktar.toString(),
      varyantId: s.varyantId ?? null, varyantKod: s.varyantKod ?? null, varyantAd: s.varyantAd ?? null,
      ciro: s.ciro.toFixed(2), maliyet: s.maliyet.toFixed(2), neden: nedenBul(s),
      guncelStokEksi: s.mevcutMiktar.lt(0),
    })),
  };
}

export async function maliyetEksikleriniOku(tx: Prisma.TransactionClient, tenantId: string, q: Sorgu, kapsam: "sayfa" | "tum" = "sayfa") {
  return maliyetEksigiListesi(await maliyetKaynaklariniOku(tx, tenantId, q), q, kapsam);
}

export async function maliyetKaynaklariniOku(tx: Prisma.TransactionClient, tenantId: string, q: Sorgu) {
  const tarih = { gte: new Date(`${q.baslangic}T00:00:00.000Z`), lte: new Date(`${q.bitis}T23:59:59.999Z`) };
  // Tam dönem toplamı sayfalama öncesi hesaplanır. Aşırı yükte kısmi sonuç gösterilmez.
  const adet = await tx.faturaSatir.count({ where: { tenantId, fatura: { durum: "kesin", tip: { in: ["satis", "satis_iade"] }, tarih } } });
  if (adet > 20000) throw new BadRequestException("Bu dönem 20.000 satış/iade satırını aşıyor. Tarih aralığını daraltın.");
  return satisSatirlari(tx, tarih);
}
