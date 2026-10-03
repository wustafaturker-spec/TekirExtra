"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader } from "@/components/ui";

interface Baglanti { id: string; aile: string; saglayici: string; durum: string; kullaniciAdiMaskeli: string; }

export default function SmsAyarlari() {
  const [kayit, setKayit] = useState<Baglanti | null>(null); const [hata, setHata] = useState(""); const [basari, setBasari] = useState("");
  const yukle = useCallback(async () => setKayit((await api<Baglanti[]>("/baglantilar")).find((b) => b.aile === "sms" && b.saglayici === "netgsm") ?? null), []);
  useEffect(() => { void yukle(); }, [yukle]);
  async function kaydet(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setHata(""); const f = new FormData(e.currentTarget); try { await api("/baglantilar", { method: "POST", body: JSON.stringify({ aile: "sms", saglayici: "netgsm", config: { kullaniciAdi: f.get("kullaniciAdi"), parola: f.get("parola"), gondericiAdi: f.get("gondericiAdi") } }) }); setBasari("Netgsm bağlantısı kaydedildi."); await yukle(); } catch (x) { setHata(x instanceof Error ? x.message : "Bağlantı kaydedilemedi"); } }
  async function testEt() { if (!kayit) return; setHata(""); try { const s = await api<{ basarili: boolean; mesaj?: string }>(`/baglantilar/${kayit.id}/test`, { method: "POST" }); if (s.basarili) { await api(`/baglantilar/${kayit.id}/aktif-et`, { method: "POST" }); setBasari("Netgsm bağlantısı etkinleştirildi."); } else setHata(s.mesaj ?? "Doğrulama başarısız"); await yukle(); } catch (x) { setHata(x instanceof Error ? x.message : "Doğrulama başarısız"); } }
  return <div style={{ maxWidth: 900, margin: "0 auto" }}><PageHeader title="SMS Ayarları" subtitle="Ödeme bağlantılarını carilere Netgsm üzerinden otomatik gönderin."/><Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert><Card>{kayit ? <div className="between"><div><h3>Netgsm</h3><p>{kayit.kullaniciAdiMaskeli} · <Badge variant={kayit.durum === "aktif" ? "success" : "neutral"}>{kayit.durum}</Badge></p><small>Canlı gönderim ilk SMS sırasında doğrulanır.</small></div><Button onClick={() => void testEt()}>Bağlantıyı etkinleştir</Button></div> : <form className="stack" onSubmit={kaydet}><h3>Netgsm bağlantısı</h3><p className="muted">API yetkili alt kullanıcı bilgilerinizi girin. Onaylı gönderici başlığı zorunludur.</p><div className="row"><Field label="Abone / API kullanıcı adı"><Input name="kullaniciAdi" required /></Field><Field label="API alt kullanıcı parolası"><Input name="parola" type="password" required /></Field><Field label="Onaylı gönderici başlığı"><Input name="gondericiAdi" required /></Field></div><Button type="submit" variant="primary">Kaydet</Button></form>}</Card></div>;
}
