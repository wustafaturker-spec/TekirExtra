import { adres } from "./araclar/arac";

export interface FinansKaynagi {
  arac: string;
  baslik: string;
  adres: string;
  alindiAt: string;
  donem: { baslangic?: string; bitis?: string; aciklama: string };
  kalemler: Array<{ ad: string; deger: string; paraBirimi: string }>;
  uyarilar: string[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nesne = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
const metin = (x: unknown) => typeof x === "string" ? x.slice(0, 160) : "";
// Güvenli kuruş aralığını aşan JSON number zaten hassasiyet kaybetmiş olabilir.
// Büyük decimal-string korunur; number'dan kaybolan basamak icat edilmez.
const guvensizSayi = (x: unknown) => typeof x === "number" && (!Number.isFinite(x) || !Number.isSafeInteger(Math.round(x * 100)));
const tutar = (x: unknown) => !guvensizSayi(x) && (typeof x === "string" || typeof x === "number") && /^-?\d+(?:\.\d+)?$/.test(String(x)) ? String(x) : null;
const doviz = (x: unknown) => typeof x === "string" && /^[A-Z]{3}$/.test(x) ? x : null;
const gun = (x: unknown) => {
  const d = typeof x === "string" ? x.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return undefined;
  const zaman = new Date(`${d}T00:00:00Z`);
  return Number.isFinite(zaman.getTime()) && zaman.toISOString().slice(0, 10) === d ? d : undefined;
};

/** Yalnız başarılı, izinli finans araçlarının çıktıları çağıran tarafından verilir. */
export function finansKaynaklariCikar(arac: string, icerik: string, simdi = new Date()): FinansKaynagi[] {
  let r: Record<string, unknown>;
  try { r = nesne(JSON.parse(icerik)); } catch { return []; }
  const bugun = simdi.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
  const temel = { arac, alindiAt: simdi.toISOString(), donem: { bitis: bugun, aciklama: "Görüntülenme anındaki durum" }, uyarilar: [] as string[] };
  const oku = (x: unknown, uyarilar = temel.uyarilar) => {
    if (guvensizSayi(x)) {
      const uyari = "Güvenli sayı aralığı dışındaki tutar gösterilmedi; kaynaktan decimal-string olarak alınmalıdır.";
      if (!uyarilar.includes(uyari)) uyarilar.push(uyari);
    }
    return tutar(x);
  };
  const kalemler = (o: Record<string, unknown>, alanlar: Array<[string, string]>, paraBirimi = "TRY", uyarilar = temel.uyarilar) => alanlar.flatMap(([alan, ad]) => {
    const deger = oku(o[alan], uyarilar); return deger === null ? [] : [{ ad, deger, paraBirimi }];
  });
  if (arac === "finansal_ozet") {
    const k = kalemler(r, [["nakitVarliklar", "Nakit varlıklar"], ["envanterDegeri", "Stok değeri"], ["toplamAlacaklar", "Alacaklar"], ["toplamBorclar", "Borçlar"], ["netVarlikDegeri", "Net varlık"]]);
    const kurEksik = Array.isArray(r.kurEksik) ? r.kurEksik.length > 0 : Boolean(r.kurEksik);
    return k.length || temel.uyarilar.length ? [{ ...temel, baslik: "Finansal özet", adres: "/panel", kalemler: k, uyarilar: [...temel.uyarilar, ...(kurEksik ? ["Kur bilgisi eksik kayıtlar var; raporu kontrol edin."] : [])] }] : [];
  }
  if (arac === "vadesi_gecen_alacaklar") {
    const k = kalemler(r, [["toplamAlacakTry", "Vadesi geçen alacak"], ["toplamBorcTry", "Vadesi geçen borç"]]);
    return k.length || temel.uyarilar.length ? [{ ...temel, baslik: "Vadesi geçen alacak ve borç", adres: "/panel", kalemler: k }] : [];
  }
  if (arac === "gelir_gider" || arac === "rapor_calistir") {
    if (typeof r.adres !== "string" || !r.adres.startsWith("/panel/raporlar")) return [];
    const url = new URL(r.adres, "https://tekir.invalid");
    const yol = arac === "gelir_gider" ? "/panel/raporlar/gelir-gider" : "/panel/raporlar";
    if (url.origin !== "https://tekir.invalid" || url.pathname !== yol || url.hash) return [];
    const baslangic = gun(nesne(r.donem).baslangic ?? url.searchParams.get(arac === "gelir_gider" ? "baslangic" : "f.baslangic"));
    const bitis = gun(nesne(r.donem).bitis ?? url.searchParams.get(arac === "gelir_gider" ? "bitis" : "f.bitis"));
    const kaynak: FinansKaynagi = { ...temel, baslik: arac === "gelir_gider" ? "Gelir-gider ve kâr/zarar" : metin(r.ad) || "Rapor", adres: r.adres, donem: { baslangic, bitis, aciklama: baslangic || bitis ? "Rapor dönemi" : "Raporun seçili süzgeçleri" }, kalemler: [], uyarilar: Array.isArray(r.uyarilar) ? r.uyarilar.filter((x): x is string => typeof x === "string").slice(0, 10).map(x => x.slice(0, 500)) : [] };
    if (arac === "gelir_gider") {
      kaynak.kalemler = kalemler(nesne(r.karZarar), [["netSatis", "Net satış"], ["smm", "Satılan malın maliyeti"], ["brutKar", "Brüt kâr"], ["digerGelirler", "Diğer gelirler"], ["faaliyetGiderleri", "Faaliyet giderleri"], ["netKar", "Net kâr"]]);
    } else {
      const toplamlar = nesne(r.toplamlar);
      for (const kolon of Array.isArray(r.kolonlar) ? r.kolonlar : []) {
        const c = nesne(kolon), alan = metin(c.alan);
        if (c.tip !== "para") continue;
        const toplam = toplamlar[alan];
        if (toplam === "karisik") { kaynak.uyarilar.push(`${metin(c.baslik) || alan}: farklı para birimleri; tek toplam yok.`); continue; }
        if (toplam == null && r.satirSayisi === 1 && Array.isArray(r.satirlar) && r.satirlar.length === 1) {
          const satir = nesne(r.satirlar[0]), deger = oku(satir[alan]);
          const paraBirimi = c.dovizAlani ? doviz(satir[metin(c.dovizAlani)]) : "TRY";
          if (deger !== null && paraBirimi) kaynak.kalemler.push({ ad: `${metin(c.baslik) || alan} (tek satır)`, deger, paraBirimi });
          continue;
        }
        const t = nesne(toplam), deger = oku(t.deger);
        const paraBirimi = doviz(t.doviz) ?? (c.dovizAlani ? null : "TRY");
        if (deger !== null && paraBirimi) kaynak.kalemler.push({ ad: metin(c.baslik) || alan, deger, paraBirimi });
      }
      if (typeof r.satirSayisi === "number" && Array.isArray(r.satirlar) && r.satirSayisi > r.satirlar.length) kaynak.uyarilar.push(`Model ${r.satirlar.length} / ${r.satirSayisi} satırı gördü; tam liste rapor ekranındadır.`);
    }
    kaynak.uyarilar.push(...temel.uyarilar);
    return [kaynak];
  }
  if (["cari_ara", "cari_getir", "fatura_ara", "fatura_getir", "belge_ara", "belge_getir"].includes(arac)) {
    const liste = Array.isArray(r.kayitlar) ? r.kayitlar : [r];
    return liste.slice(0, 20).flatMap(x => {
      const k = nesne(x);
      if (typeof k.id !== "string" || !uuid.test(k.id)) return [];
      const cari = arac.startsWith("cari_");
      const sonuc: FinansKaynagi = { ...temel, uyarilar: [], baslik: metin(k.unvan ?? k.no ?? k.kod) || "Kayıt", adres: cari ? adres.cari(k.id) : arac.startsWith("fatura_") ? adres.fatura(k.id) : adres.belge(k.id), kalemler: [], donem: { bitis: cari ? bugun : gun(k.tarih), aciklama: cari ? "Görüntülenme anındaki bakiye" : gun(k.tarih) ? "Belge tarihi" : "Belge tarihi belirtilmemiş" } };
      if (cari && Array.isArray(k.bakiyeler)) for (const bakiye of k.bakiyeler) {
        const b = nesne(bakiye), paraBirimi = doviz(b.dovizCinsi);
        if (paraBirimi) sonuc.kalemler.push(...kalemler(b, [["bakiye", "Bakiye"]], paraBirimi, sonuc.uyarilar));
      }
      else { const paraBirimi = doviz(k.dovizCinsi); if (paraBirimi) sonuc.kalemler = kalemler(k, [["genelToplam", "Genel toplam"], ["toplamMatrah", "Matrah"], ["toplamKdv", "KDV"]], paraBirimi, sonuc.uyarilar); }
      return sonuc.kalemler.length || sonuc.uyarilar.length ? [sonuc] : [];
    });
  }
  return [];
}
