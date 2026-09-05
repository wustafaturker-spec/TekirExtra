"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";

interface Kontrol { id: string; basarili: boolean; aciklama: string }
interface Olay { id: string; gerekce: string; kullanici: { adSoyad: string } }
interface Donem { id: string; yil: number; ay: number; durum: "acik" | "kapali"; kontroller: Kontrol[]; olaylar: Olay[] }

export default function DonemKapatmaSayfasi() {
  const simdi = new Date(); const [yil, setYil] = useState(simdi.getFullYear()); const [ay, setAy] = useState(simdi.getMonth() + 1);
  const [gerekce, setGerekce] = useState(""); const [totp, setTotp] = useState(""); const [donemler, setDonemler] = useState<Donem[]>([]);
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islem, setIslem] = useState(false);
  const yukle = useCallback(async () => setDonemler(await api<Donem[]>("/donem-kapatma")), []);
  useEffect(() => { void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Dönemler yüklenemedi")); }, [yukle]);
  async function yap(is: () => Promise<unknown>, mesaj: string) { setIslem(true); setHata(""); setBasari(""); try { await is(); setBasari(mesaj); await yukle(); } catch (e) { setHata(e instanceof Error ? e.message : "İşlem tamamlanamadı"); } finally { setIslem(false); } }
  const kontrol = () => yap(() => api(`/donem-kapatma/kontroller?yil=${yil}&ay=${ay}`, { method: "POST" }), "Kontrol listesi güncellendi.");
  const kapat = () => yap(() => api("/donem-kapatma/kapat", { method: "POST", body: JSON.stringify({ yil, ay, gerekce }) }), "Mali dönem kapatıldı.");
  const ac = (id: string) => yap(() => api(`/donem-kapatma/${id}/yeniden-ac`, { method: "POST", body: JSON.stringify({ gerekce, totpKodu: totp }) }), "Mali dönem yeniden açıldı ve denetim izine kaydedildi.");
  return <div className="stack"><PageHeader title="Mali Dönem Kapatma" subtitle="Kontrolleri çalıştırın, dönemi kilitleyin ve yeniden açma olaylarını denetim iziyle yönetin." />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    <Card className="stack"><div className="row"><Field label="Yıl"><Input type="number" min={2020} max={2100} value={yil} onChange={(e) => setYil(Number(e.target.value))} /></Field><Field label="Ay"><Select value={ay} onChange={(e) => setAy(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}. ay</option>)}</Select></Field><Field label="Zorunlu gerekçe"><Input minLength={10} maxLength={500} value={gerekce} onChange={(e) => setGerekce(e.target.value)} /></Field><Field label="TOTP (yeniden açma)"><Input inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} /></Field></div><div className="row"><Button disabled={islem} onClick={() => void kontrol()}>Kontrolleri çalıştır</Button><Button variant="danger" disabled={islem || gerekce.trim().length < 10} onClick={() => void kapat()}>Dönemi kapat</Button></div></Card>
    <Card pad={false}><TableWrap><thead><tr><th>Dönem</th><th>Durum</th><th>Kontroller</th><th>Son olay</th><th>İşlem</th></tr></thead><tbody>{donemler.length === 0 ? <tr><td colSpan={5} className="empty">Henüz kontrol çalıştırılmadı.</td></tr> : donemler.map((d) => <tr key={d.id}><td><strong>{String(d.ay).padStart(2, "0")}/{d.yil}</strong></td><td><Badge variant={d.durum === "kapali" ? "warning" : "success"}>{d.durum === "kapali" ? "Kapalı" : "Açık"}</Badge></td><td>{d.kontroller.map((k) => <div key={k.id} style={{ color: k.basarili ? "var(--success)" : "var(--danger)" }}>{k.basarili ? "✓" : "✕"} {k.aciklama}</div>)}</td><td>{d.olaylar[0] ? <small>{d.olaylar[0].kullanici.adSoyad} · {d.olaylar[0].gerekce}</small> : "—"}</td><td>{d.durum === "kapali" ? <Button size="sm" disabled={islem || gerekce.trim().length < 10 || totp.length !== 6} onClick={() => void ac(d.id)}>Yeniden aç</Button> : "—"}</td></tr>)}</tbody></TableWrap></Card>
  </div>;
}
