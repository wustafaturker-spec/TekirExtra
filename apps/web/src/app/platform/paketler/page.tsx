"use client";
import Link from "next/link";
import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, TableWrap } from "@/components/ui";
import { PlatformListeDurumu } from "@/components/platform-liste";
import { PlatformPaketFormu } from "@/components/platform-paket-formu";
import { KATALOG_KAPSAMI, PAKET_DURUMU, type PaketIcerigi, type PaketListesi } from "@/lib/platform-paketler";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { platformApi } from "@/lib/platform-api";

function sayfaYaz(sayfa: number, arama: string) {
  const p = new URLSearchParams({ ...(arama ? { arama } : {}), ...(sayfa > 1 ? { sayfa: String(sayfa) } : {}) });
  window.history.replaceState(null, "", `/platform/paketler${p.size ? `?${p}` : ""}`);
}
function Paketler() {
  const p = useSearchParams(), router = useRouter();
  const arama = (p.get("arama") ?? "").slice(0, 100);
  const n = Number(p.get("sayfa") ?? 1), sayfa = Number.isInteger(n) && n > 0 && n <= 100000 ? n : 1;
  const q = new URLSearchParams({ arama, sayfa: String(sayfa) });
  const { veri, yukleniyor, hata, yenile } = usePlatformVerisi<PaketListesi>(`/platform/paketler?${q}`);
  const [yeni, setYeni] = useState(false), [mesgul, setMesgul] = useState(false), [islemHatasi, setIslemHatasi] = useState("");
  const donus = `/platform/paketler${arama || sayfa > 1 ? `?${q}` : ""}`;
  function ara(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); sayfaYaz(1, String(new FormData(e.currentTarget).get("arama") ?? "").trim().slice(0, 100));
  }
  async function olustur(g: PaketIcerigi & { kod: string }) {
    setMesgul(true); setIslemHatasi("");
    try { const r = await platformApi<{ id: string }>("/platform/paketler", { method: "POST", body: JSON.stringify(g) }); router.push(`/platform/paketler/${r.id}?${new URLSearchParams({ donus })}`); }
    catch (e) { setIslemHatasi(e instanceof Error ? e.message : "Paket oluşturulamadı."); }
    finally { setMesgul(false); }
  }
  return <div className="stack">
    <PageHeader title="Paket kataloğu" subtitle="Paket tanımları, taslaklar ve değiştirilemez yayın sürümleri." actions={<div className="platform-row-actions"><Button disabled={mesgul} onClick={yenile}>Yenile</Button><Button disabled={mesgul} aria-expanded={yeni} onClick={() => { setYeni(!yeni); setIslemHatasi(""); }}>Yeni paket</Button></div>} />
    <p className="subtle">{KATALOG_KAPSAMI}</p>
    <div className="row-tight" style={{ flexWrap: "wrap" }}><Link href="/platform/paketler/gecis">Abonelik geçiş karşılaştırması</Link><Link href="/platform/paketler/planli-atamalar">Planlı atamalar</Link></div>
    <Alert tone="error">{islemHatasi}</Alert>
    {yeni && <Card title="Yeni paket taslağı"><PlatformPaketFormu ilk={{ ad: "", aciklama: "", ozellikler: [], siralama: 100 }} kodGerekli mesgul={mesgul} onKaydet={olustur} onVazgec={() => { setYeni(false); setIslemHatasi(""); }} /></Card>}
    <Card><form onSubmit={ara} className="platform-row-actions" key={arama}><Field label="Kod veya son sürüm adı"><Input name="arama" maxLength={100} defaultValue={arama} placeholder="Paket ara" /></Field><Button type="submit">Ara</Button>{arama && <Button type="button" onClick={() => sayfaYaz(1, "")}>Aramayı temizle</Button>}</form></Card>
    <Card title="Paketler"><p className="subtle">Her paketin son sürümü gösterilir. Katalog sırası son sürümün değeridir; taslaklar da liste sırasını etkiler. Yayın geçmişi paket detayındadır.</p>
      <TableWrap><thead><tr><th>Paket</th><th>Kod</th><th>Son sürüm</th><th>Son sürüm durumu</th><th>Katalog satışı</th><th>Sıra</th><th>Kaynak</th></tr></thead><tbody>
        <PlatformListeDurumu sutun={7} yukleniyor={yukleniyor} hata={hata} bos={Boolean(veri && !veri.kayitlar.length)} baslik="Bu kapsamda paket yok" onTekrar={yenile} />
        {veri?.kayitlar.map((r) => <tr key={r.id}><td><Link href={`/platform/paketler/${r.id}?${new URLSearchParams({ donus })}`}>{r.sonSurum.ad}</Link></td><td>{r.kod}</td><td>{r.sonSurum.surumNo}</td><td><Badge variant={r.sonSurum.durum === "yayinlandi" ? "success" : "neutral"}>{PAKET_DURUMU[r.sonSurum.durum]}</Badge></td><td>{r.satisAcik ? "Açık olarak seçili" : "Kapalı"}</td><td>{r.sonSurum.siralama}</td><td>{r.eskiPlanKodu ? "Mevcut paket tanımı" : "Yeni katalog paketi"}</td></tr>)}
      </tbody></TableWrap>
      {veri && <div className="platform-pagination"><span>{veri.toplam} paket · Sayfa {sayfa} / {Math.max(1, Math.ceil(veri.toplam / 25))}</span><div className="platform-row-actions"><Button disabled={sayfa <= 1} onClick={() => sayfaYaz(sayfa - 1, arama)}>Önceki</Button><Button disabled={sayfa * 25 >= veri.toplam} onClick={() => sayfaYaz(sayfa + 1, arama)}>Sonraki</Button>{sayfa > 1 && !veri.kayitlar.length && <Button onClick={() => sayfaYaz(1, arama)}>İlk sayfaya dön</Button>}</div></div>}
    </Card>
  </div>;
}
export default function PaketKatalogu() { return <Suspense fallback={<p role="status">Paketler yükleniyor…</p>}><Paketler /></Suspense>; }
