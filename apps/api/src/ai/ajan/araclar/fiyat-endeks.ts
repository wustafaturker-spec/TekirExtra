import { z } from "zod";
import { adres, arac, BUGUN, cagir, uuid } from "./arac";
import { UC } from "./uclar";

/**
 * END-21: fiyat–endeks okuma araçları. İkisi de ekran uçlarını çağırır;
 * rol, özel rol, plan özelliği ve satış/alış erişimi ekranla aynıdır. Çıktı
 * decimal-string taşır; oranları uygulama hesaplar, model hesaplamaz
 * (finans kaynak kartı + olgu sözleşmesi).
 */
const ay = (aciklama: string) => z.string().regex(/^\d{4}-\d{2}$/, "Ay YYYY-AA olmalıdır").describe(aciklama);
const endeksKodu = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Endeks kodu büyük harf (ör. TUFE)");
const buAy = () => BUGUN().slice(0, 7);
const ayGeri = (n: number) => { const [y, a] = buAy().split("-").map(Number); return new Date(Date.UTC(y, a - 1 - n, 1)).toISOString().slice(0, 7); };

export const FIYAT_ENDEKS_ARACLARI = [
  arac({
    ad: "endeks_getir",
    aciklama: "TÜFE, Yİ-ÜFE gibi endekslerin ya da USD/EUR kurunun (TCMB alış, aylık ortalama) aylık değerleri; her ay için aylık ve yıllık değişim, dönem değişimi, son açıklanan ay. Enflasyon, endeks, kur artışı sorularında kullan. Geçerli kodlar için önce kod vermeden çağır: seçenek listesini döner. Yüzdeleri kendin hesaplama; araçtakileri aktar.",
    sinif: "okuma",
    girdi: z.object({
      kod: endeksKodu.optional().describe("Seri kodu (ör. TUFE, YIUFE, USD, EUR). Boşsa seçilebilir endeksler listelenir."),
      baslangic: ay("Başlangıç ayı; varsayılan 12 ay önce").optional(),
      bitis: ay("Bitiş ayı; varsayılan bu ay").optional(),
    }),
    uc: UC.fiyatEndeksSecenekleri,
    async calistir(b, g) {
      if (!g.kod) {
        const s = await cagir(b, UC.fiyatEndeksSecenekleri, []);
        return { endeksler: (s.endeksler ?? []).map((e: any) => ({ kod: e.kod, ad: e.ad, tur: e.tur, bazYili: e.bazYili, sonAciklananDonem: e.sonDonem })), not: "Değerler için kod ile yeniden çağır." };
      }
      const r = await cagir(b, UC.fiyatEndeksEndeks, [g.kod, g.baslangic ?? ayGeri(12), g.bitis ?? buAy()]);
      return { ...r, adres: "/panel/stok" };
    },
  }),
  arac({
    ad: "fiyat_endeks_karsilastir",
    aciklama: "Bir ürünün faturalardan gerçekleşen aylık satış (ve izin varsa alış) fiyatını seçilen endekslerle karşılaştırır: baz ay = 100, fiyat değişimi, endeks değişimi, reel değişim ve endekse göre olması gereken fiyat. Ürün kimliği için önce stok_ara. Birçok ürün için rapor_calistir ile 'stok.fiyat_endeks' raporunu kullan. Yüzde ve tutarları kendin hesaplama; araçtakileri aktar.",
    sinif: "okuma",
    girdi: z.object({
      stokId: uuid("Stok kartı kimliği (stok_ara ile bulunur)"),
      endeksler: z.array(endeksKodu).min(1).max(4).describe("Karşılaştırılacak endeks kodları (ör. [\"TUFE\", \"USD\"])"),
      baslangic: ay("Başlangıç ayı; varsayılan 12 ay önce").optional(),
      bitis: ay("Bitiş ayı; varsayılan bu ay").optional(),
      baz: ay("Baz ay (= 100); varsayılan başlangıç ayı").optional(),
      fiyatListeleri: z.array(z.string().uuid()).max(5).optional().describe("Doluysa yalnız bu fiyat listelerine bağlı carilerin satışları; boşsa tüm satışlar"),
      alis: z.boolean().optional().describe("Alış fiyatını da ekle (alış erişimi gerekir)"),
    }),
    uc: UC.fiyatEndeksUrun,
    async calistir(b, g) {
      const q: Record<string, string> = { baslangic: g.baslangic ?? ayGeri(11), bitis: g.bitis ?? buAy(), endeksler: g.endeksler.join(",") };
      if (g.baz) q.baz = g.baz;
      if (g.fiyatListeleri?.length) { q.satisKapsami = "liste"; q.listeler = g.fiyatListeleri.join(","); }
      if (g.alis) q.alis = "1";
      const r = await cagir(b, UC.fiyatEndeksUrun, [g.stokId, q], g.stokId);
      return {
        stok: r.stok, baz: r.baz, esik: r.esik,
        seriler: (r.seriler ?? []).map((s: any) => ({
          ad: s.ad, taraf: s.taraf,
          karsilastirmalar: s.karsilastirmalar,
          aylar: s.satirlar.map((x: any) => ({ ay: x.ay.slice(0, 7), durum: x.durum, satir: x.satir, fiyat: x.fiyat, baz100: x.endeks100, yillikDegisim: x.yillikDegisim })),
        })),
        endeksler: (r.endeksler ?? []).map((e: any) => ({ kod: e.kod, ad: e.ad, tur: e.tur, bazYili: e.bazYili, sonAciklananDonem: e.sonDonem?.slice(0, 7) ?? null })),
        uyarilar: r.uyarilar,
        adres: adres.stok(g.stokId),
      };
    },
  }),
];
