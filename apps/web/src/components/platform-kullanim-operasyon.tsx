"use client";

import Link from "next/link";
import { Alert, Button, Card, Field, Select, TableWrap } from "@/components/ui";
import { type BaslamaDurumu, type BaslamaRaporu, type OperasyonRaporu, type OperasyonTuru } from "@/lib/platform-istatistikleri";
import { tarih } from "@/lib/platform-firmalar";

const sayi = (n: number | null) => n === null ? "—" : n.toLocaleString("tr-TR");
const BASLAMA: Record<BaslamaDurumu, string> = { baslamayan: "Etkinlik kaydı olmayan yeni firma", baslayan: "Etkinliği gözlenen firma", belirsiz: "Geçmişi yetersiz firma" };
const OPERASYON: Record<OperasyonTuru, string> = { hepsi: "Tüm bekleyen işler", gorev: "Açık firma görevleri", fatura: "Abonelik faturası işlemleri", iade: "İade muhasebeleştirmesi" };
type FiltreYaz = (ek: Record<string, string>) => void;

function Sayfalama({ sayfa, toplam, onSayfa }: { sayfa: number; toplam: number; onSayfa: (n: number) => void }) {
  return <div className="platform-pagination"><span>{sayi(toplam)} firma · Sayfa {sayfa} / {Math.max(1, Math.ceil(toplam / 25))}</span><div className="platform-row-actions">
    <Button disabled={sayfa === 1} onClick={() => onSayfa(sayfa - 1)}>Önceki</Button><Button disabled={sayfa * 25 >= toplam} onClick={() => onSayfa(sayfa + 1)}>Sonraki</Button>
    {sayfa > 1 && (sayfa - 1) * 25 >= toplam && <Button onClick={() => onSayfa(1)}>İlk sayfaya dön</Button>}
  </div></div>;
}

export function PlatformKullanimaBaslama({ veri, filtreYaz }: { veri: BaslamaRaporu; filtreYaz: FiltreYaz }) {
  return <section aria-label="Kullanıma başlama takibi"><h2>Kullanıma başlama takibi</h2>
    <p className="subtle">{tarih(veri.kesimGunu)} günü sonuna kadar; bitiş tarihinde kapanmış son gün kullanılır. Tarih başlangıcından bağımsızdır. Paket, o günün sonundaki pakettir; o gün mevcut firmalar gösterilir.</p>
    <details><summary>Sınıflandırma nasıl yapılır?</summary><p>Etkinlik, kayda geçen başarılı giriş veya izin verilen modül işlemidir. Hiç etkinlik kaydı olmayan yeni firma sayısı yalnız ölçüm sonrası kaydı bilinen ve kayıt gününden kesim gününe kadar her günlük özeti tamamlanmış firmaları içerir. Eski veya eksik geçmişi olan firmalar bu sayıya eklenmez. Bu ayrım bütün ürün kullanımını ölçtüğü iddiası taşımaz.</p></details>
    {!veri.hazir && <Alert tone="warning">Bu kesim günü için yaşam döngüsü veya kullanım ölçümü henüz başlamamış. Sayılar sıfır yerine boş gösterilir.</Alert>}
    <div className="platform-overview platform-status-metrics">{(Object.entries(BASLAMA) as [BaslamaDurumu, string][]).map(([kod, ad]) => <button className="platform-metric" key={kod} disabled={!veri.hazir} aria-pressed={veri.durum === kod} onClick={() => filtreYaz({ baslamaDurum: kod })}><span>{ad}</span><strong>{sayi(veri.sayilar[kod])}</strong><small>Firmaları aşağıda incele</small></button>)}</div>
    <Card title="Kullanıma başlama ayrıntıları"><Field label="Kullanıma başlama durumu"><Select disabled={!veri.hazir} value={veri.durum} onChange={(e) => filtreYaz({ baslamaDurum: e.target.value })}>{Object.entries(BASLAMA).map(([kod, ad]) => <option key={kod} value={kod}>{ad}</option>)}</Select></Field>
      <p className="subtle">Ölçüm başlangıcı: {tarih(veri.olcumBaslangici)}. Son günlük üretim: {veri.sonUretim ? new Date(veri.sonUretim).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "Yok"}. Eksik gün veya eksik firma özeti, etkinlik kaydı olmayan firmayı belirsiz sınıfına taşır.</p>
      <TableWrap><thead><tr><th>Firma</th><th>Kesim günündeki paket</th><th>Gözlenen kayıt günü</th><th>Son gözlenen etkinlik</th></tr></thead><tbody>{veri.kayitlar.map((f) => <tr key={f.tenantId}><td>{f.unvan ? <Link href={`/platform/firmalar/${f.tenantId}`}>{f.unvan}</Link> : "Arşiv firma"}</td><td>{f.planKodu}</td><td>{f.kayitGunu ? tarih(f.kayitGunu) : "Geçmiş bilinmiyor"}</td><td>{f.sonEtkinGun ? tarih(f.sonEtkinGun) : "Gözlenmedi"}</td></tr>)}{!veri.kayitlar.length && <tr><td colSpan={4}>{veri.hazir ? "Bu sınıfta firma yok." : "Bu kesim gününde ölçüm yok."}</td></tr>}</tbody></TableWrap>
      {veri.hazir && <Sayfalama sayfa={veri.sayfa} toplam={veri.toplam ?? 0} onSayfa={(n) => filtreYaz({ baslamaSayfa: String(n) })} />}
    </Card>
  </section>;
}

export function PlatformBekleyenIsler({ veri, filtreYaz }: { veri: OperasyonRaporu; filtreYaz: FiltreYaz }) {
  return <section aria-label="Bekleyen operasyon işleri"><h2>Bekleyen operasyon işleri</h2>
    <p className="subtle">Canlı durum; tarih aralığından bağımsızdır. Güncel paket ve firma filtresi uygulanır. İşlem kaydı sayılır; aynı firmada birden fazla iş bulunabilir. E-belge kuyruğu ayrı olarak <Link href="/platform/sistem-sagligi">Sistem sağlığı</Link> ekranındadır.</p>
    <details><summary>Hangi işler bekleyen sayılır?</summary><p>Firma görevleri: açık veya devam ediyor. Abonelik faturası: bekliyor, hata ya da kesinleşmiş ve tahsilat kaydı bekleyen. Taslak ve tahsil edilmiş faturalar dahil değildir. İade muhasebeleştirmesi: bekliyor veya hata; yazıldı/gerekmiyor dahil değildir. Fatura ve iade hataları bekleyen toplamının alt kümesidir; toplama tekrar eklenmez.</p></details>
    <div className="platform-overview platform-stats-metrics">{(Object.entries(OPERASYON) as [OperasyonTuru, string][]).map(([kod, ad]) => <button className="platform-metric" key={kod} aria-pressed={veri.tur === kod} onClick={() => filtreYaz({ operasyon: kod })}><span>{ad}</span><strong>{sayi(kod === "hepsi" ? veri.sayilar.toplam : veri.sayilar[kod])}</strong><small>Firma listesini süz</small></button>)}</div>
    <Card title="Bekleyen iş bulunan firmalar"><Field label="Bekleyen iş türü"><Select value={veri.tur} onChange={(e) => filtreYaz({ operasyon: e.target.value })}>{Object.entries(OPERASYON).map(([kod, ad]) => <option key={kod} value={kod}>{ad}</option>)}</Select></Field>
      <p>Seçili türde {sayi(veri.filtreliIs)} iş · {sayi(veri.firmaToplam)} firma. Tüm türlerde hatalı işlem: {sayi(veri.sayilar.hatali)}.</p>
      <TableWrap><thead><tr><th>Firma</th><th>Görev</th><th>Fatura işlemi</th><th>İade işlemi</th><th>Hatalı</th><th>Toplam iş</th><th>İşlemler</th></tr></thead><tbody>{veri.kayitlar.map((f) => <tr key={f.tenantId}><td><Link href={`/platform/firmalar/${f.tenantId}`}>{f.unvan}</Link></td><td>{sayi(f.gorev)}</td><td>{sayi(f.fatura)}</td><td>{sayi(f.iade)}</td><td>{sayi(f.hatali)}</td><td>{sayi(f.toplam)}</td><td><Link href={`/platform/firmalar/${f.tenantId}`}>Firma işlemleri</Link>{f.gorev > 0 && <> · <Link href={`/platform/gorevler?firma=${f.tenantId}`}>Görevleri aç</Link></>}</td></tr>)}{!veri.kayitlar.length && <tr><td colSpan={7}>Seçili türde bekleyen iş bulunan firma yok.</td></tr>}</tbody></TableWrap>
      <Sayfalama sayfa={veri.sayfa} toplam={veri.firmaToplam} onSayfa={(n) => filtreYaz({ operasyonSayfa: String(n) })} />
      <p className="subtle">Gözlem anı: {new Date(veri.zaman).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}. Firma işlemleri bağlantısı mevcut abonelik, ödeme/iade ve takip çalışma alanını açar.</p>
    </Card>
  </section>;
}
