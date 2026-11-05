"use client";

import { Alert, Card, TableWrap } from "@/components/ui";
import { type BuyumeDonemi, type BuyumeRaporu, type FirmaIstatistikRaporu, donemFarki } from "@/lib/platform-istatistikleri";
import { tarih } from "@/lib/platform-firmalar";

const sayi = (n: number | null) => n === null ? "—" : n.toLocaleString("tr-TR");
const zaman = (an: string) => new Date(an).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
const metrikler = [
  ["baslangicFirma", "Dönem başı firma"], ["bitisFirma", "Dönem sonu firma"],
  ["yeniFirma", "Yeni firma"], ["silinenFirma", "Silinen firma"],
  ["netDegisim", "Net firma değişimi"], ["iptalFirma", "Aboneliği iptale geçen firma"],
] as const;

export function PlatformBuyumeOzeti({ rapor, bugunDahil, aralik }: { rapor: BuyumeRaporu; bugunDahil: boolean; aralik: FirmaIstatistikRaporu["aralik"] }) {
  const satir = (ad: string, d: BuyumeDonemi) => <tr key={ad}><td>{ad}</td><td>{sayi(d.deneme.baslayan)}</td><td>{sayi(d.deneme.olgunlasan)}</td><td>{sayi(d.deneme.donusen)}</td><td>{sayi(d.deneme.bekleyen)}</td><td>{d.deneme.oran === null ? "—" : `%${sayi(d.deneme.oran)}`}</td></tr>;
  return <section aria-label="Büyüme ve deneme dönüşümü">
    <h2>Büyüme ve deneme dönüşümü</h2>
    <p className="subtle">Seçili dönem: {tarih(aralik.baslangic)} – {tarih(aralik.bitis)}. Önceki eşit dönem: {tarih(aralik.oncekiBaslangic)} – {tarih(aralik.oncekiBitis)}.</p>
    <p className="subtle">Yaşam döngüsü ölçüm başlangıcı: {zaman(rapor.olcumBaslangici)}. Aboneliği iptal edilen firma, firma kaydı silinmedikçe firma sayısından düşmez.</p>
    <p className="subtle">Paket filtresi her dönemin sonundaki pakete göre uygulanır; silinen firmada son bilinen paket kullanılır. Dönem başı dahil tüm büyüme metrikleri bu sabit firma kümesini kullanır. Kullanım kartlarının günlük paket kapsamından ayrıdır.</p>
    {!rapor.donem.tam && <Alert tone="warning">Seçili dönem yaşam döngüsü ölçüm başlangıcından önceye uzanıyor. Büyüme ve dönüşüm değerleri sıfır yerine boş gösterilir; geçmiş olaylar tahmin edilmez.</Alert>}
    {bugunDahil && <p className="subtle">Bugün sürüyor; dönem sonu sayısı rapor anındaki durumu gösterir.</p>}
    <div className="platform-overview">
      {metrikler.map(([kod, ad]) => <div className="platform-metric" key={kod}><span>{ad}</span><strong>{sayi(rapor.donem[kod])}</strong><small>{kod === "netDegisim"
        ? rapor.onceki[kod] === null ? "Önceki dönem ölçümü eksik" : `Önceki dönem: ${sayi(rapor.onceki[kod])}`
        : donemFarki(rapor.donem[kod], rapor.onceki[kod], bugunDahil)}</small></div>)}
    </div>
    <Card title="14 günlük deneme kohortu">
      <p className="subtle">Seçili dönemde ilk denemesine başlayan yeni firmalar. Yalnız ölçüm başladıktan sonra kaydedilen ve denemeden önce pozitif abonelik ödemesi olmayan firmalar dahildir. Mevcut firmaların bilinmeyen deneme geçmişi bu kohorta katılmaz.</p>
      <p className="subtle">Dönüşüm: deneme başlangıcından itibaren ilk 14 günde pozitif tutarlı abonelik ödemesi kaydı. Elle ve sağlayıcı ödemeleri dahildir; aktif durum tek başına ödeme sayılmaz. Sonraki iadeler bu ilk ödeme olayını geri almaz.</p>
      <p className="subtle">Oran = dönüşen / 14 günü tamamlayan firma. 14 günü dolmayan firmalar, ödeme yapmış olsalar da bekleyendedir. Sonuçlar dönem bitişinden sonraki 14 günlük ödemeleri de kapsayabilir; gözlem anı: {zaman(rapor.hesaplandiAt)}.</p>
      <TableWrap><thead><tr><th>Dönem</th><th>Denemeye başlayan</th><th>14 günü tamamlayan</th><th>Dönüşen</th><th>Gözlem süresi beklenen</th><th>Dönüşüm oranı</th></tr></thead><tbody>{satir("Seçili dönem", rapor.donem)}{satir("Önceki eşit dönem", rapor.onceki)}</tbody></TableWrap>
      {rapor.donem.deneme.olgunlasan === 0 && <p>14 günlük gözlemi tamamlayan firma olmadığı için oran gösterilmiyor.</p>}
    </Card>
  </section>;
}
