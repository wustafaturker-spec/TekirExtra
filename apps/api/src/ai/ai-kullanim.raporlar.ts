import { Prisma } from "@prisma/client";
import { registerRapor, type RaporSatiri } from "../core/raporlar/rapor-kayit";

/**
 * AI-101 (birleşik plan P-17): firmanın yapay zekâ kullanımı. Kaynak
 * `ai_cagri_izleri`'dir; mesaj, belge ve yanıt içeriği okunmaz. Yalnız
 * yönetici görür. Maliyet sağlayıcının bildirdiği token ve firmanın girdiği
 * fiyatla hesaplanır; token bildirilmediğinde metin uzunluğundan tahmin
 * edilen kısım ayrıca gösterilir.
 */
export const OZELLIK_ADLARI: Record<string, string> = {
  asistan: "Asistan", tarama: "Tarama (OCR)", ozet: "Özet ve brifing", gorev: "Zamanlanmış görev", ekstre: "Banka ekstresi",
  hatirlatma: "Hatırlatma", teklif: "E-postadan teklif", ondenetim: "e-Belge ön denetim", gelendenetim: "Gelen belge denetimi",
};

const tarih = (v: unknown, sonGun = false) => {
  const s = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  if (!s) throw new Error("Başlangıç ve bitiş tarihi gerekli");
  const t = new Date(`${s}T00:00:00+03:00`);
  return sonGun ? new Date(t.getTime() + 86_400_000) : t;
};

const yuzdeMetni = (pay: number, payda: number) => (payda > 0 ? ((pay / payda) * 100).toFixed(2) : null);

registerRapor({
  kod: "genel.yapay_zeka_kullanimi",
  modul: "genel",
  ad: "Yapay Zekâ Kullanımı",
  aciklama: "Özellik, sağlayıcı ve model bazında yapay zekâ çağrıları: başarı oranı, hata türleri, iptal ve yeniden denemeler, maliyet. İçerik gösterilmez.",
  // Yalnız yönetici (yönetici her raporu görür; başka rol yok).
  roller: [],
  filtreler: [
    { alan: "baslangic", ad: "Başlangıç", tip: "tarih", zorunlu: true },
    { alan: "bitis", ad: "Bitiş", tip: "tarih", zorunlu: true },
    { alan: "ozellik", ad: "Özellik", tip: "secim", secenekler: Object.entries(OZELLIK_ADLARI).map(([deger, ad]) => ({ deger, ad })) },
  ],
  kolonlar: [
    { alan: "ozellikAdi", baslik: "Özellik", tip: "metin" },
    { alan: "saglayici", baslik: "Sağlayıcı", tip: "metin" },
    { alan: "model", baslik: "Model", tip: "metin" },
    { alan: "cagri", baslik: "Çağrı", tip: "sayi", toplam: true },
    { alan: "basarili", baslik: "Başarılı", tip: "sayi", toplam: true },
    { alan: "basariOrani", baslik: "Başarı oranı", tip: "yuzde" },
    { alan: "iptal", baslik: "İptal", tip: "sayi", toplam: true },
    { alan: "yenidenDeneme", baslik: "Yeniden deneme / yedek", tip: "sayi", toplam: true },
    { alan: "hatalar", baslik: "Hata türleri (en sık 3)", tip: "metin" },
    { alan: "sureP50", baslik: "Süre p50 (sn)", tip: "sayi" },
    { alan: "maliyet", baslik: "Maliyet", tip: "para", dovizAlani: "doviz", toplam: true },
    { alan: "tahminiMaliyetli", baslik: "Tahmini maliyetli çağrı", tip: "sayi", toplam: true },
  ],
  async calistir(girdi, { tenantId, tx }) {
    const f = girdi.filtreler ?? {};
    const bas = tarih(f.baslangic), bit = tarih(f.bitis, true);
    const ozellik = typeof f.ozellik === "string" && f.ozellik in OZELLIK_ADLARI ? f.ozellik : null;
    const ozellikKosulu = ozellik ? Prisma.sql`AND ozellik = ${ozellik}` : Prisma.empty;
    const satirlar = await tx.$queryRaw<Array<{ ozellik: string; saglayici: string; model: string; cagri: number; basarili: number; iptal: number; yeniden: number; tahmini: number; maliyet: string | null; p50: number | null }>>`
      SELECT ozellik, saglayici, coalesce(model, '-') AS model, count(*)::int AS cagri,
        count(*) FILTER (WHERE basarili)::int AS basarili,
        count(*) FILTER (WHERE hata_sinifi = 'IPTAL')::int AS iptal,
        count(*) FILTER (WHERE deneme > 1)::int AS yeniden,
        count(*) FILTER (WHERE maliyet_tahmini)::int AS tahmini,
        sum(maliyet_usd)::text AS maliyet,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY sure_ms)::int AS p50
      FROM ai_cagri_izleri
      WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${bas} AND created_at < ${bit} ${ozellikKosulu}
      GROUP BY 1, 2, 3 ORDER BY cagri DESC`;
    const hatalar = await tx.$queryRaw<Array<{ ozellik: string; saglayici: string; model: string; sinif: string; adet: number }>>`
      SELECT ozellik, saglayici, coalesce(model, '-') AS model, coalesce(hata_sinifi, 'belirtilmemis') AS sinif, count(*)::int AS adet
      FROM ai_cagri_izleri
      WHERE tenant_id = ${tenantId}::uuid AND NOT basarili AND created_at >= ${bas} AND created_at < ${bit} ${ozellikKosulu}
      GROUP BY 1, 2, 3, 4 ORDER BY adet DESC`;
    return satirlar.map((r): RaporSatiri => {
      const anahtar = `${r.ozellik}|${r.saglayici}|${r.model}`;
      const siniflar = hatalar.filter((h) => `${h.ozellik}|${h.saglayici}|${h.model}` === anahtar).slice(0, 3);
      return {
        ozellikAdi: OZELLIK_ADLARI[r.ozellik] ?? r.ozellik,
        saglayici: r.saglayici,
        model: r.model,
        cagri: r.cagri,
        basarili: r.basarili,
        basariOrani: yuzdeMetni(r.basarili, r.cagri),
        iptal: r.iptal,
        yenidenDeneme: r.yeniden,
        hatalar: siniflar.map((h) => `${h.sinif}: ${h.adet}`).join(", ") || "—",
        sureP50: r.p50 === null ? null : Math.round(r.p50 / 100) / 10,
        maliyet: r.maliyet === null ? null : new Prisma.Decimal(r.maliyet).toDecimalPlaces(4).toFixed(4),
        doviz: "USD",
        tahminiMaliyetli: r.tahmini,
      };
    });
  },
});
