"use client";

import Link from "next/link";
import { Alert, Button, Card, TableWrap } from "@/components/ui";
import { type OperasyonGecmisi, type OperasyonSayilari, donemFarki } from "@/lib/platform-istatistikleri";
import { tarih } from "@/lib/platform-firmalar";

const sayi = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("tr-TR");
const zaman = (an: string | null) => an ? new Date(an).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "Gözlem yok";
const METRIKLER: [keyof OperasyonSayilari, string][] = [
  ["firma", "Firma"], ["aktif", "Aktif abonelik"], ["deneme", "Deneme"], ["askida", "Askıda"], ["iptal", "İptal"],
  ["geciken", "Ödemesi geciken"], ["yaklasan", "7 günde yenilenecek"], ["baglantiHatali", "Bağlantı hatası olan"],
  ["gorev", "Açık görev"], ["fatura", "Bekleyen fatura işlemi"], ["iade", "Bekleyen iade işlemi"], ["hatali", "Hatalı işlem"], ["toplam", "Toplam bekleyen iş"],
];
export function PlatformOperasyonGecmisi({ veri, filtreYaz }: { veri: OperasyonGecmisi; filtreYaz: (ek: Record<string, string>) => void }) {
  const d = veri.detay;
  const sonGun = veri.gunler.at(-1);
  return <section aria-label="Tarihsel abonelik ve operasyon"><h2>Tarihsel abonelik ve operasyon</h2>
    <p className="subtle">Her Türkiye günündeki son başarılı gözlem gösterilir; kesin gün sonu durumu değildir. Worker yaklaşık 10 dakikada bir gözlem alır. Paket ve firma kapsamı o gözlemden seçilir. Sonradan kapanan işler veya paket değişiklikleri geçmiş gözlemi değiştirmez.</p>
    <p>İlk gözlem günü: {veri.olcumBaslangici ? tarih(veri.olcumBaslangici) : "Henüz gözlem yok"}. Ölçülmemiş günler boş bırakılır; geçmiş günler bugünkü durumla doldurulmaz. Günlük bekleyen iş sayıları toplanmaz.</p>
    {veri.gunler.some((g) => !g.hazir) && <Alert tone="warning">Seçili dönemde eksik veya geçersiz gözlem var. Boş değerler sıfır anlamına gelmez.</Alert>}
    <Card title="Dönemlerin son gözlemlerini karşılaştır"><p>{sonGun ? tarih(sonGun.gun) : "—"} ve önceki eşit süreli dönemin son günü {tarih(veri.oncekiBitis)} karşılaştırılır. Aradaki değişim, yeni açılan veya kapanan iş sayısı değildir. Bugün devam ederken yüzde hesaplanmaz.</p>
      <TableWrap><thead><tr><th>Ölçüt</th><th>Seçili dönem sonu</th><th>Önceki dönem sonu</th><th>Değişim</th></tr></thead><tbody>{METRIKLER.map(([kod, ad]) => <tr key={kod}><td>{ad}</td><td>{sayi(veri.donemSonu?.[kod])}</td><td>{sayi(veri.oncekiDonemSonu?.[kod])}</td><td>{donemFarki(veri.donemSonu?.[kod] ?? null, veri.oncekiDonemSonu?.[kod] ?? null, sonGun?.gecici ?? false)}</td></tr>)}</tbody></TableWrap>
    </Card>
    <Card title="Günlük operasyon eğilimi"><p>Abonelik sütunları firma, görev/fatura/iade sütunları işlem sayısıdır. Hatalı işlemler bekleyen toplamın alt kümesidir. Günü seçerek aynı gözlemdeki firmaları inceleyin.</p>
      <TableWrap><thead><tr><th>Gün</th><th>Gözlem anı</th><th>Firma</th><th>Aktif</th><th>Geciken</th><th>Yenilenecek</th><th>Bağlantı hatası</th><th>Görev</th><th>Fatura</th><th>İade</th><th>Hatalı</th><th>Toplam iş</th></tr></thead><tbody>{veri.gunler.map((g) => <tr key={g.gun}><td><Button size="sm" aria-pressed={d.gun === g.gun} onClick={() => filtreYaz({ operasyonGun: g.gun })}>{tarih(g.gun)}{g.gecici ? " (bugün)" : ""}</Button></td><td>{zaman(g.gozlemAt)}{!g.hazir && " · ölçüm eksik"}</td>{(["firma", "aktif", "geciken", "yaklasan", "baglantiHatali", "gorev", "fatura", "iade", "hatali", "toplam"] as const).map((kod) => <td key={kod}>{sayi(g.sayilar?.[kod])}</td>)}</tr>)}</tbody></TableWrap>
    </Card>
    <Card title="Tarihsel gözlemdeki firmalar"><p>{tarih(d.gun)} · {zaman(d.gozlemAt)}. Toplam bekleyen iş: {sayi(d.sayilar?.toplam)}. Firmanın bugünkü adı gösterilir; bağlantılar güncel çalışma alanını açar.</p>
      <TableWrap><thead><tr><th>Firma</th><th>Gözlenen paket</th><th>Abonelik</th><th>Geciken</th><th>Yenilenecek</th><th>Bağlantı hatası</th><th>Görev</th><th>Fatura</th><th>İade</th><th>Hatalı</th><th>Toplam iş</th></tr></thead><tbody>{d.kayitlar.map((f) => <tr key={f.tenantId}><td>{f.unvan ? <Link href={`/platform/firmalar/${f.tenantId}`}>{f.unvan}</Link> : "Arşiv firma"}</td><td>{f.planKodu}</td><td>{({ aktif: "Aktif", deneme: "Deneme", askida: "Askıda", iptal: "İptal" } as Record<string, string>)[f.durum] ?? f.durum}</td><td>{f.geciken ? "Evet" : "Hayır"}</td><td>{f.yaklasan ? "Evet" : "Hayır"}</td><td>{f.baglantiHatali ? "Evet" : "Hayır"}</td>{(["gorev", "fatura", "iade", "hatali", "toplam"] as const).map((kod) => <td key={kod}>{sayi(f[kod])}</td>)}</tr>)}{!d.kayitlar.length && <tr><td colSpan={11}>{d.hazir ? "Bu gözlem kapsamında firma yok." : "Bu gün için geçerli gözlem yok."}</td></tr>}</tbody></TableWrap>
      {d.hazir && <div className="platform-pagination"><span>{sayi(d.toplam)} firma · Sayfa {d.sayfa} / {Math.max(1, Math.ceil((d.toplam ?? 0) / 25))}</span><div className="platform-row-actions"><Button disabled={d.sayfa <= 1} onClick={() => filtreYaz({ operasyonGecmisSayfa: String(d.sayfa - 1) })}>Önceki</Button><Button disabled={d.sayfa * 25 >= (d.toplam ?? 0)} onClick={() => filtreYaz({ operasyonGecmisSayfa: String(d.sayfa + 1) })}>Sonraki</Button>{d.sayfa > 1 && !d.kayitlar.length && <Button onClick={() => filtreYaz({ operasyonGecmisSayfa: "1" })}>İlk sayfaya dön</Button>}</div></div>}
    </Card>
  </section>;
}
