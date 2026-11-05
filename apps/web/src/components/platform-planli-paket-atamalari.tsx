"use client";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Button, Card, Field, TableWrap } from "@/components/ui";
import { PlatformListeDurumu } from "@/components/platform-liste";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { platformApi } from "@/lib/platform-api";
import type { PlanliPaketAtamaListesi } from "@/lib/platform-paketler";

const durumAdi = { planlandi: "Planlandı", uygulandi: "Uygulandı", iptal: "İptal edildi", inceleme: "İnceleme gerekiyor" };
const engelAdi: Record<string, string> = { atama_yetki: "Onaylayan yöneticinin yetkisi değişti.", atama_kaynak_degisti: "Firmanın abonelik kaydı değişti.", atama_hedef_degisti: "Hedef sürüm değişti veya arşivlendi.", atama_plan_cakismasi: "Firma için başka bir plan var." };
export function PlatformPlanliPaketAtamalari({ surumId }: { surumId?: string }) {
  const p = useSearchParams(), kimlik = useId(), kilit = useRef(false);
  const ham = Number(p.get("planSayfa") ?? 1), sayfa = Number.isInteger(ham) && ham > 0 && ham <= 100000 ? ham : 1;
  const q = new URLSearchParams({ sayfa: String(sayfa), ...(surumId ? { surumId } : {}) });
  const { veri, hata, yukleniyor, yenile } = usePlatformVerisi<PlanliPaketAtamaListesi>(`/platform/paketler/planli-atamalar?${q}`);
  const [iptal, setIptal] = useState<string | null>(null), [neden, setNeden] = useState("");
  const [mesgul, setMesgul] = useState(false), [islemHatasi, setIslemHatasi] = useState(""), [basari, setBasari] = useState("");
  function sayfala(n: number) {
    const qp = new URLSearchParams(p.toString()); qp.set("planSayfa", String(n));
    window.history.replaceState(null, "", `${window.location.pathname}?${qp}`);
  }
  async function iptalEt() {
    if (!iptal || kilit.current) return;
    kilit.current = true; setMesgul(true); setIslemHatasi(""); setBasari("");
    try {
      await platformApi(`/platform/paketler/planli-atamalar/${iptal}/iptal`, { method: "POST", body: JSON.stringify({ neden }) });
      setIptal(null); setNeden(""); setBasari("Plan iptal edildi. Firma fiyatları değiştirilmedi."); yenile();
    } catch (e) { setIslemHatasi(e instanceof Error ? e.message : "Plan iptal edilemedi."); }
    finally { kilit.current = false; setMesgul(false); }
  }
  return <Card title="Planlı fiyat atamaları">
    <p>Onaylanmış planlar ve sonuçları. İnceleme gerektiren planın firmalarında yeni ödeme bekler; planı iptal edip güncel koşullarla yeni önizleme hazırlayabilirsiniz.</p>
    <Button disabled={mesgul} onClick={yenile}>Planları yenile</Button>
    <Alert tone="error">{islemHatasi}</Alert><Alert tone="success">{basari}</Alert>
    {iptal && <section aria-label="Plan iptal onayı" className="stack"><p>Planı iptal etmek firmaların mevcut fiyatını değiştirmez.</p>
      <Field label="Plan iptal nedeni" htmlFor={`${kimlik}-neden`}><textarea id={`${kimlik}-neden`} className="input" minLength={5} maxLength={1000} disabled={mesgul} value={neden} onChange={(e) => setNeden(e.target.value)} /></Field>
      <div className="platform-row-actions"><Button disabled={mesgul || neden.trim().length < 5} onClick={() => void iptalEt()}>Planı iptal etmeyi onayla</Button><Button disabled={mesgul} onClick={() => { setIptal(null); setIslemHatasi(""); }}>İptalden vazgeç</Button></div>
    </section>}
    <TableWrap><thead><tr><th>Hedef / firma</th><th>Uygulama zamanı (Türkiye)</th><th>Durum ve neden</th><th>İşlem</th></tr></thead><tbody>
      <PlatformListeDurumu sutun={4} yukleniyor={yukleniyor} hata={hata} bos={!!veri && !veri.kayitlar.length} baslik="Bu sayfada planlı atama yok" onTekrar={yenile} />
      {veri?.kayitlar.map((r) => <tr key={r.id}><td>{r.hedefPaketAdi} · Sürüm {r.hedefSurumNo}<br /><small>{r.atamaKapsami === "kapsam" ? "Modül, kota ve fiyat" : "Yalnız fiyat"}</small><ul>{r.firmalar.map((f) => <li key={f.tenantId}><Link href={`/platform/firmalar/${f.tenantId}`}>{f.unvan}</Link></li>)}</ul></td>
        <td>{new Date(r.uygulanacakAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}<br /><small>{r.uygulamaTuru === "donem_sonu" ? "Dönem sonunda" : "Seçili tarihte"}</small></td>
        <td>{durumAdi[r.durum]}<p>{r.neden}</p>{r.engelNedeni && <p>{engelAdi[r.engelNedeni] ?? "Koşulların yeniden incelenmesi gerekiyor."}</p>}{r.iptalNedeni && <p>İptal nedeni: {r.iptalNedeni}</p>}</td>
        <td>{["planlandi", "inceleme"].includes(r.durum) && <Button disabled={mesgul || !!iptal} onClick={() => { setIptal(r.id); setNeden(""); setBasari(""); setIslemHatasi(""); }}>Planı iptal et</Button>}</td></tr>)}
    </tbody></TableWrap>
    {veri && <div className="platform-pagination"><span>{veri.toplam} plan · Sayfa {sayfa} / {Math.max(1, Math.ceil(veri.toplam / veri.sayfaBoyutu))}</span><div className="platform-row-actions"><Button disabled={mesgul || !!iptal || sayfa <= 1} onClick={() => sayfala(sayfa - 1)}>Önceki plan sayfası</Button><Button disabled={mesgul || !!iptal || sayfa * veri.sayfaBoyutu >= veri.toplam} onClick={() => sayfala(sayfa + 1)}>Sonraki plan sayfası</Button>{sayfa > 1 && !veri.kayitlar.length && <Button disabled={mesgul || !!iptal} onClick={() => sayfala(1)}>İlk plan sayfasına dön</Button>}</div></div>}
  </Card>;
}
