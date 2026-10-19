/**
 * Sayfaların liste dışı biçim bekleyen ortak uçları için gerçek API biçimi. Taklidi yazılmamış
 * uca `{}` ya da `[]` dönmek, sonradan eklenen bir uç nesne beklediğinde sayfayı çökertir.
 */
export function ortakYanit(yol: string): { status?: number; json: unknown } | null {
  // Mevzuat tabloları yoksa sayfa gömülü varsayılanlarla çalışır.
  if (yol.includes("/mevzuat/")) return { status: 404, json: { message: "Bulunamadı" } };
  if (yol.endsWith("/bildirimler/ozet")) return { json: { okunmamis: 0, acik: 0, kritik: 0 } };
  if (yol.endsWith("/bildirimler")) return { json: { kayitlar: [] } };
  if (yol.endsWith("/hareketler")) return { json: { kayitlar: [], sonrakiImlec: null, toplamlar: { adet: 0, dovizler: [] } } };
  if (yol.endsWith("/durum-gecmisi")) return { json: [] };
  if (yol.endsWith("/surumler")) return { json: [] };
  if (yol.endsWith("/kasa-banka/cek-senet-ozet")) return { json: { acik: { adet: 0, toplamTry: "0" }, geciken: { adet: 0, toplamTry: "0" } } };
  if (yol.endsWith("/kasa-banka/cek-senet-vade-analizi")) return { json: { bugun: "2026-08-07", uyari: "", gruplar: [] } };
  if (yol.endsWith("/fatura/is-kuyrugu-ozeti")) return { json: { taslakSatis: 0, taslakAlis: 0, ebelgeHata: 0, acikTahsilat: 0, acikOdeme: 0 } };
  if (yol.endsWith("/stok/kritik-ozeti")) return { json: { kritikStok: 0 } };
  if (yol.endsWith("/stok/sayimlar/sistem")) return { json: { satirlar: [] } };
  if (/\/stok\/[^/]+\/(fiyatlar|partiler|depo-bakiyeleri)$/.test(yol)) return { json: [] };
  if (yol.endsWith("/rapor/gunluk")) return { json: { satis: { toplam: "0", adet: 0 }, tahsilat: { toplam: "0", adet: 0 } } };
  if (yol.endsWith("/rapor/vadesi-gecenler")) return { json: { alacaklar: [], borclar: [], toplamAlacak: "0.00", toplamBorc: "0.00" } };
  if (yol.endsWith("/doviz-kurlari")) return { json: { kurTarihi: "2026-08-07", kurlar: {} } };
  if (yol.endsWith("/raporlar/tercihler")) return { json: { favoriler: [], sonKullanilanlar: [] } };
  // Yönetici özeti kartı yüklenemezse kendi hatasını gösterir; panelin geri kalanı çalışır.
  if (yol.endsWith("/ai/rapor/yonetici-ozeti")) return { status: 404, json: { message: "Bulunamadı" } };
  return null;
}
