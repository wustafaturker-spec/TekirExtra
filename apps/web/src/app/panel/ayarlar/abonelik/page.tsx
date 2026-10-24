"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, TableWrap } from "@/components/ui";

type Limitler = { kullanici: number | null; cari: number | null; stok: number | null; aylikFatura: number | null };
interface Plan { kod: string; ad: string; aciklama: string; aylikFiyat: number | null; onerilen?: boolean; limitler: Limitler; ozellikler: readonly string[] }
interface Abonelik { planKodu: string; durum: "deneme" | "aktif" | "askida" | "iptal"; faturaEpostasi?: string; faturalandirmaUnvani?: string; donemBaslangici?: string; donemSonu?: string; iptalTarihi?: string }
/** Platform P0-1: plan değişikliği talep olarak açılır, TekirExtra ekibi onaylar. */
interface Talep { id: string; mevcutPlan: string; istenenPlan: string; durum: "bekliyor" | "onaylandi" | "reddedildi" | "geri_cekildi"; kararNotu?: string | null; createdAt: string; kararAt?: string | null }
interface Ozet { abonelik: Abonelik; plan: Plan; planlar: Plan[]; kullanim: Record<keyof Limitler, number>; sonTalep?: Talep | null }
interface Gecmis { id: string; oncekiPlan?: string; yeniPlan: string; oncekiDurum?: string; yeniDurum: string; neden?: string; createdAt: string }

const LIMIT_ADI: Record<keyof Limitler, string> = { kullanici: "Aktif kullanıcı", cari: "Aktif cari", stok: "Aktif stok kartı", aylikFatura: "Bu ay oluşturulan fatura" };
const DURUM_ADI: Record<string, string> = { deneme: "Deneme", aktif: "Aktif", askida: "Askıda", iptal: "Dönem sonunda iptal" };
const tarih = (deger?: string) => deger ? new Date(deger).toLocaleDateString("tr-TR") : "—";

export default function AbonelikSayfasi() {
  const [ozet, setOzet] = useState<Ozet | null>(null); const [gecmis, setGecmis] = useState<Gecmis[]>([]);
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islem, setIslem] = useState("");
  const [eposta, setEposta] = useState(""); const [unvan, setUnvan] = useState("");
  async function yukle() { const [o, g] = await Promise.all([api<Ozet>("/abonelik"), api<Gecmis[]>("/abonelik/gecmis")]); setOzet(o); setGecmis(g); setEposta(o.abonelik.faturaEpostasi ?? ""); setUnvan(o.abonelik.faturalandirmaUnvani ?? ""); }
  useEffect(() => { yukle().catch((e) => setHata(e instanceof Error ? e.message : "Abonelik bilgileri yüklenemedi")); }, []);
  async function planTalebi(plan: Plan) { if (!confirm(`${plan.ad} planı için talep gönderilsin mi? TekirExtra ekibi onayladığında geçerli olur.`)) return; setIslem(plan.kod); setHata(""); try { await api("/abonelik/plan-talebi", { method: "POST", body: JSON.stringify({ planKodu: plan.kod }) }); setBasari(`${plan.ad} planı talebiniz alındı; onaylandığında geçerli olacak.`); await yukle(); } catch (e) { setHata(e instanceof Error ? e.message : "Talep gönderilemedi"); } finally { setIslem(""); } }
  async function talebiGeriCek() { setIslem("talep"); setHata(""); try { await api("/abonelik/plan-talebi/geri-cek", { method: "POST" }); setBasari("Plan talebi geri çekildi."); await yukle(); } catch (e) { setHata(e instanceof Error ? e.message : "Talep geri çekilemedi"); } finally { setIslem(""); } }
  async function iletisimKaydet(e: FormEvent) { e.preventDefault(); setIslem("iletisim"); setHata(""); try { await api("/abonelik/faturalama", { method: "PATCH", body: JSON.stringify({ faturaEpostasi: eposta, faturalandirmaUnvani: unvan }) }); setBasari("Faturalama bilgileri güncellendi."); await yukle(); } catch (err) { setHata(err instanceof Error ? err.message : "Bilgiler kaydedilemedi"); } finally { setIslem(""); } }
  async function durumDegistir() { if (!ozet) return; const iptal = ozet.abonelik.durum !== "iptal"; if (iptal && !confirm("Abonelik dönem sonunda iptal edilsin mi?")) return; setIslem("durum"); try { await api(`/abonelik/${iptal ? "iptal" : "yeniden-etkinlestir"}`, { method: "POST" }); setBasari(iptal ? "İptal talebi alındı; erişim dönem sonuna kadar sürer." : "Abonelik yeniden etkinleştirildi."); await yukle(); } catch (e) { setHata(e instanceof Error ? e.message : "İşlem tamamlanamadı"); } finally { setIslem(""); } }
  return <div><PageHeader title="Abonelik ve Paket Yönetimi" subtitle="Paketinizi, kullanım limitlerinizi ve faturalama bilgilerinizi tek yerden yönetin." /><Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>{ozet && <div className="stack">
    <Card><div className="between"><div><div className="subtle">Mevcut plan</div><h2 style={{ margin: ".2rem 0" }}>{ozet.plan.ad}</h2><div className="muted">Dönem: {tarih(ozet.abonelik.donemBaslangici)} – {tarih(ozet.abonelik.donemSonu)}</div></div><Badge variant={ozet.abonelik.durum === "aktif" ? "success" : ozet.abonelik.durum === "askida" ? "danger" : "neutral"}>{DURUM_ADI[ozet.abonelik.durum]}</Badge></div></Card>
    {ozet.sonTalep && (ozet.sonTalep.durum === "bekliyor" || ozet.sonTalep.durum === "reddedildi") && <Card>
      <div className="between">
        <div>
          <strong>{ozet.sonTalep.durum === "bekliyor" ? `${ozet.planlar.find((p) => p.kod === ozet.sonTalep?.istenenPlan)?.ad ?? ozet.sonTalep.istenenPlan} planı talebiniz onay bekliyor` : `${ozet.planlar.find((p) => p.kod === ozet.sonTalep?.istenenPlan)?.ad ?? ozet.sonTalep.istenenPlan} planı talebiniz reddedildi`}</strong>
          <div className="muted">{tarih(ozet.sonTalep.createdAt)}{ozet.sonTalep.kararNotu ? ` · Not: ${ozet.sonTalep.kararNotu}` : ""}</div>
        </div>
        {ozet.sonTalep.durum === "bekliyor" && <Button disabled={Boolean(islem)} onClick={talebiGeriCek}>Talebi geri çek</Button>}
      </div>
    </Card>}
    <Card title="Kullanım ve limitler"><div className="metric-bands">{(Object.keys(LIMIT_ADI) as (keyof Limitler)[]).map((anahtar) => { const limit = ozet.plan.limitler[anahtar]; const kullanim = ozet.kullanim[anahtar]; const oran = limit ? Math.min(100, kullanim / limit * 100) : 0; return <div key={anahtar} style={{ padding: ".75rem" }}><div className="between"><strong>{LIMIT_ADI[anahtar]}</strong><span>{kullanim} / {limit ?? "Sınırsız"}</span></div>{limit !== null && <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 8, marginTop: 8, overflow: "hidden" }}><div style={{ width: `${oran}%`, height: "100%", background: oran >= 90 ? "var(--danger)" : "var(--brand)" }} /></div>}</div>; })}</div></Card>
    <div className="card-grid">{ozet.planlar.map((plan) => <Card key={plan.kod}><div className="between"><h2 style={{ margin: 0, fontSize: "1.15rem" }}>{plan.ad}</h2>{plan.onerilen && <Badge variant="info">Önerilen</Badge>}</div><p className="muted">{plan.aciklama}</p><div style={{ fontSize: "1.35rem", fontWeight: 700, marginBottom: ".8rem" }}>{plan.aylikFiyat === null ? "Teklif alın" : `${plan.aylikFiyat.toLocaleString("tr-TR")} TL / ay`}</div><ul>{plan.ozellikler.map((o) => <li key={o}>{o}</li>)}</ul><Button variant="primary" block disabled={ozet.plan.kod === plan.kod || Boolean(islem) || ozet.sonTalep?.durum === "bekliyor" || ozet.abonelik.durum === "askida"} onClick={() => planTalebi(plan)}>{ozet.plan.kod === plan.kod ? "Mevcut plan" : ozet.sonTalep?.durum === "bekliyor" && ozet.sonTalep.istenenPlan === plan.kod ? "Talep bekliyor" : islem === plan.kod ? "Gönderiliyor…" : "Bu planı talep et"}</Button></Card>)}</div>
    <Card title="Faturalama bilgileri"><form className="form-grid" onSubmit={iletisimKaydet}><Field label="Fatura e-postası"><Input type="email" required value={eposta} onChange={(e) => setEposta(e.target.value)} /></Field><Field label="Faturalandırma unvanı"><Input required value={unvan} onChange={(e) => setUnvan(e.target.value)} /></Field><div><Button variant="primary" type="submit" disabled={Boolean(islem)}>{islem === "iletisim" ? "Kaydediliyor…" : "Bilgileri kaydet"}</Button></div></form></Card>
    <Card title="Abonelik geçmişi">{gecmis.length ? <TableWrap><thead><tr><th>Tarih</th><th>Değişiklik</th><th>Durum</th><th>Açıklama</th></tr></thead><tbody>{gecmis.map((g) => <tr key={g.id}><td>{new Date(g.createdAt).toLocaleString("tr-TR")}</td><td>{g.oncekiPlan ?? "—"} → {g.yeniPlan}</td><td>{DURUM_ADI[g.yeniDurum] ?? g.yeniDurum}</td><td>{g.neden ?? "—"}</td></tr>)}</tbody></TableWrap> : <p className="muted">Henüz plan değişikliği yok.</p>}</Card>
    <Card title="Aboneliği yönet">{ozet.abonelik.durum === "askida" ? <p className="muted">Aboneliğiniz askıda; firmanız salt okunur. Kayıtlarınızı görüntüleyip dışa aktarabilirsiniz. Yeniden açmak için TekirExtra ekibiyle iletişime geçin.</p> : <><p className="muted">İptal edildiğinde mevcut dönem sonuna kadar erişim devam eder; sonra firmanız salt okunur olur, verileriniz silinmez.</p><Button variant={ozet.abonelik.durum === "iptal" ? "primary" : "danger"} disabled={Boolean(islem)} onClick={durumDegistir}>{ozet.abonelik.durum === "iptal" ? "Aboneliği yeniden etkinleştir" : "Dönem sonunda iptal et"}</Button></>}</Card>
  </div>}</div>;
}
