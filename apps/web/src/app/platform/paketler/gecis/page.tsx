"use client";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Card, Field, PageHeader, Select, TableWrap } from "@/components/ui";
import { PlatformListeDurumu } from "@/components/platform-liste";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import type { PaketGecisRaporu } from "@/lib/platform-paketler";

const adlar: Record<string, string> = { kullanici: "Kullanıcı", cari: "Cari", stok: "Stok", aylikFatura: "Aylık fatura" };
const tutar = (v: { matrah: string; kdv: string; toplam: string } | null | undefined) => v ? `${v.toplam.replace(".", ",")} TRY (matrah ${v.matrah.replace(".", ",")}, KDV ${v.kdv.replace(".", ",")})` : "Çevrim içi fiyat yok";
const limit = (v: number | null | undefined) => v === undefined ? "Bilinmiyor" : v === null ? "Sınırsız" : v.toLocaleString("tr-TR");
function Gecis() {
  const p = useSearchParams(), ham = Number(p.get("sayfa") ?? 1), sayfa = Number.isInteger(ham) && ham >= 1 && ham <= 100000 ? ham : 1;
  const ay = [1, 3, 6, 12].includes(Number(p.get("ay"))) ? Number(p.get("ay")) : 1;
  const { veri, hata, yukleniyor, yenile } = usePlatformVerisi<PaketGecisRaporu>(`/platform/paketler/gecis-durumu?sayfa=${sayfa}`);
  function sec(n: number, sure = ay) {
    const q = new URLSearchParams({ ...(n > 1 ? { sayfa: String(n) } : {}), ...(sure !== 1 ? { ay: String(sure) } : {}) });
    window.history.replaceState(null, "", `/platform/paketler/gecis${q.size ? `?${q}` : ""}`);
  }
  return <div className="stack">
    <PageHeader title="Abonelik katalog geçişi" subtitle="Mevcut koşulların korunması ve bilinmeyen planların incelemesi." actions={<Button onClick={yenile}>Yenile</Button>} />
    <Link href="/platform/paketler">Paket kataloğuna dön</Link>
    <p>Bilinen eski planlar ilk katalog sürümüne, mevcut fiyat ve limitleri korunarak bağlanır. Bu rapor eski sabit kaynak ile kayıtlı koşulları karşılaştırır. Sonradan yayınlanan katalog fiyatı mevcut aboneye otomatik uygulanmaz.</p>
    {veri && <Card><p>{veri.toplam} abonelik · {veri.bagli} sürüme bağlı · {veri.bilinmeyenPlan} bilinmeyen plan</p><p className="subtle">Abonelik kaydı olmayan firmalar bu sayıya dahil değildir. Bilinmeyen planlar ilk sırada gösterilir; fiyat veya limitleri varsayılmaz.</p></Card>}
    <Field label="Karşılaştırılacak dönem"><Select value={ay} onChange={(e) => sec(sayfa, Number(e.target.value))}>{[1, 3, 6, 12].map((n) => <option key={n} value={n}>{n} ay</option>)}</Select></Field>
    <Card title="Koşul karşılaştırması"><TableWrap><thead><tr><th>Firma / plan</th><th>Sürüm bağı</th><th>Eski sabit fiyat</th><th>Korunan dönem fiyatı</th><th>Sonuç ve limitler</th></tr></thead><tbody>
      <PlatformListeDurumu sutun={5} yukleniyor={yukleniyor} hata={hata} bos={!!veri && !veri.kayitlar.length} baslik="Bu sayfada abonelik yok" onTekrar={yenile} />
      {veri?.kayitlar.map((r) => {
        const d = r.donemler.find((d) => d.aySayisi === ay);
        return <tr key={r.tenantId}>
          <td><Link href={`/platform/firmalar/${r.tenantId}`}>{r.unvan}</Link><br /><small>{r.planKodu}</small></td>
          <td>{r.paketSurumId ? <><span>{r.kaynak === "katalog_atamasi" ? "Atanan katalog sürümü" : "İlk katalog sürümü"}</span><br /><small>{r.kaynak === "katalog_atamasi" ? "Onaylanan katalog koşulları" : "Korunan eski koşullar"}</small></> : "Bilinmeyen plan · bağlanmadı"}</td>
          <td>{tutar(d?.once)}</td><td>{r.paketSurumId ? tutar(d?.sonra) : "İnceleme bekliyor"}</td>
          <td><Badge variant={r.kosullarEsit === true ? "success" : "neutral"}>{r.kosullarEsit === true ? "Fiyat ve limitler eşit" : r.kosullarEsit === false ? "Koşullar farklı" : "İnceleme bekliyor"}</Badge>
            {r.oncekiLimitler && <details><summary>Limitleri karşılaştır</summary><TableWrap><thead><tr><th>Limit</th><th>Eski kaynak</th><th>Korunan koşul</th></tr></thead><tbody>{Object.keys(adlar).map((k) => <tr key={k}><td>{adlar[k]}</td><td>{limit(r.oncekiLimitler?.[k])}</td><td>{limit(r.sonrakiLimitler?.[k])}</td></tr>)}</tbody></TableWrap></details>}
          </td>
        </tr>;
      })}
    </tbody></TableWrap></Card>
    {veri && <div className="platform-pagination"><span>{veri.toplam} abonelik · Sayfa {sayfa} / {Math.max(1, Math.ceil(veri.toplam / 25))}</span><div className="platform-row-actions"><Button disabled={sayfa <= 1} onClick={() => sec(sayfa - 1)}>Önceki</Button><Button disabled={sayfa * 25 >= veri.toplam} onClick={() => sec(sayfa + 1)}>Sonraki</Button>{sayfa > 1 && !veri.kayitlar.length && <Button onClick={() => sec(1)}>İlk sayfaya dön</Button>}</div></div>}
  </div>;
}
export default function AbonelikKatalogGecisi() { return <Suspense fallback={<p role="status">Geçiş raporu yükleniyor…</p>}><Gecis /></Suspense>; }
