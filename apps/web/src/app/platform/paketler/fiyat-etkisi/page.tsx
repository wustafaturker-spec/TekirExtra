"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Button, Card, Field, PageHeader, Select, TableWrap } from "@/components/ui";
import { PlatformListeDurumu } from "@/components/platform-liste";
import { PlatformPaketAtama } from "@/components/platform-paket-atama";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import type { PaketFiyatEtkiRaporu } from "@/lib/platform-paketler";

const tutar = (v: { matrah: string; kdv: string; toplam: string } | null | undefined) => v
  ? `${v.toplam.replace(".", ",")} TRY (matrah ${v.matrah.replace(".", ",")}, KDV ${v.kdv.replace(".", ",")})` : "Karşılaştırma yok";

function Rapor() {
  const p = useSearchParams(), surumId = p.get("surumId") ?? "";
  const [sonuc, setSonuc] = useState<{ surumId: string; mesaj: string } | null>(null);
  const ham = Number(p.get("sayfa") ?? 1), sayfa = Number.isInteger(ham) && ham > 0 && ham <= 100000 ? ham : 1;
  const ay = [1, 3, 6, 12].includes(Number(p.get("ay"))) ? Number(p.get("ay")) : 1;
  const { veri, hata, yukleniyor, yenile } = usePlatformVerisi<PaketFiyatEtkiRaporu>(`/platform/paketler/fiyat-etkisi?${new URLSearchParams({ surumId, sayfa: String(sayfa) })}`);
  function sec(n: number, sure = ay) {
    const q = new URLSearchParams({ surumId, ay: String(sure), sayfa: String(n) });
    window.history.replaceState(null, "", `/platform/paketler/fiyat-etkisi?${q}`);
  }
  return <div className="stack">
    <PageHeader title="Katalog fiyat etkisi" subtitle="Kayıtlı abonelik koşulları ile önerilen sürümün dönem fiyatları." actions={<Button onClick={yenile}>Yenile</Button>} />
    <Link href="/platform/paketler">Paket kataloğuna dön</Link>
    <Link href="/platform/paketler/planli-atamalar">Planlı atamaları ve sonuçlarını yönet</Link>
    <Alert tone="success">{sonuc?.surumId === surumId ? sonuc.mesaj : ""}</Alert>
    <p>Bu rapor dönem bedellerini karşılaştırır. Fark, tahsil edilecek ücret değildir. Önizlemeyi açmak abonelikleri değiştirmez; atama için aşağıdaki ayrı onay akışını kullanın. Eksik dönem fiyatı aylık bedelden türetilmez.</p>
    {veri && <Card><p>{veri.hedefPaketAdi} · Sürüm {veri.hedefSurumNo} · Fiyat geçerlilik tarihi: {veri.gecerlilikTarihi}</p><p className="subtle">{veri.kapsam} Geçerlilik tarihi otomatik fiyat geçişi başlatmaz. Kota ve erişim etkileri bu rapora dahil değildir.</p></Card>}
    <Field label="Karşılaştırılacak dönem"><Select value={ay} onChange={(e) => sec(sayfa, Number(e.target.value))}>{[1, 3, 6, 12].map((n) => <option key={n} value={n}>{n} ay</option>)}</Select></Field>
    <Card title="Firma bazında fiyat karşılaştırması"><TableWrap><thead><tr><th>Firma / plan</th><th>Kayıtlı dönem fiyatı</th><th>Hedef dönem fiyatı</th><th>Dönem bedeli farkı</th></tr></thead><tbody>
      <PlatformListeDurumu sutun={4} yukleniyor={yukleniyor} hata={hata} bos={!!veri && !veri.kayitlar.length} baslik="Bu sayfada abonelik yok" onTekrar={yenile} />
      {veri?.kayitlar.map((r) => {
        const d = r.donemler.find((d) => d.aySayisi === ay);
        return <tr key={r.tenantId}><td><Link href={`/platform/firmalar/${r.tenantId}`}>{r.unvan}</Link><br /><small>{r.planKodu}</small></td>
          <td>{tutar(d?.once)}</td><td>{tutar(d?.sonra)}</td>
          <td>{r.karsilastirilabilir ? tutar(d?.fark) : r.neden === "kayitli_kosul_yok" ? "Kayıtlı koşul yok · inceleme gerekli" : "Farklı veya eşlenmeyen plan"}</td></tr>;
      })}
    </tbody></TableWrap></Card>
    {veri?.hedefKapsamVar && <Alert tone="warning">Bu sürüm modül ve kota sözleşmesi içeriyor. Kapsam ataması modülleri, kullanım kotalarını ve fiyatları birlikte değiştirir; kapanacak modülleri ve yeni limitleri önizlemede inceleyin.</Alert>}
    {veri && !hata && <PlatformPaketAtama key={`${veri.hedefSurumId}:${sayfa}`} rapor={veri} onUygulandi={(mesaj) => { setSonuc({ surumId, mesaj }); yenile(); }} />}
    {veri && <div className="platform-pagination"><span>{veri.toplam} abonelik · Sayfa {sayfa} / {Math.max(1, Math.ceil(veri.toplam / veri.sayfaBoyutu))}</span><div className="platform-row-actions"><Button disabled={sayfa <= 1} onClick={() => sec(sayfa - 1)}>Önceki</Button><Button disabled={sayfa * veri.sayfaBoyutu >= veri.toplam} onClick={() => sec(sayfa + 1)}>Sonraki</Button>{sayfa > 1 && !veri.kayitlar.length && <Button onClick={() => sec(1)}>İlk sayfaya dön</Button>}</div></div>}
  </div>;
}
export default function FiyatEtkiSayfasi() { return <Suspense fallback={<p role="status">Fiyat etkisi yükleniyor…</p>}><Rapor /></Suspense>; }
