"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, ButtonLabel, Card, Field, Input, PageHeader } from "@/components/ui";

type Kaynak = { erisim?:{mod:string;yazabilir:boolean}; satirId: string; kaynakOzeti: string; kalanMiktar: string; anaBirim: string; tarih: string | null; surum: number; gecerli: boolean; gerekce: string | null; stok?:{kod:string;ad:string};siparisNo?:string|null };
const bugun = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });

export default function GirisTarihleriSayfasi() {
  const [id, setId] = useState("");
  const [rol, setRol] = useState("");
  const [kaynak, setKaynak] = useState<Kaynak | null>(null);
  const [tarih, setTarih] = useState("");
  const [gerekce, setGerekce] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [bekliyor, setBekliyor] = useState(false);
  const [yenileGerekli, setYenileGerekli] = useState(false);
  const sira = useRef(0);
  async function yukle(satirId: string) {
    const n = ++sira.current;
    setKaynak(null); setHata(""); setBasari(""); setBekliyor(true);
    try {
      const k = await api<Kaynak>(`/stok/ihtiyac-plani/giris-tarihleri/${encodeURIComponent(satirId)}`, { cache: "no-store" });
      if (n !== sira.current) return;
      setKaynak(k); setTarih(k.tarih ?? ""); setGerekce(""); setYenileGerekli(false);
    } catch (e) { if (n === sira.current) setHata(e instanceof Error ? e.message : "Sipariş satırı okunamadı."); }
    finally { if (n === sira.current) setBekliyor(false); }
  }
  useEffect(() => {
    let aktif = true;
    void api<{ rol: string }>("/auth/ben").then(b => {
      if (!aktif) return;
      if (!["yonetici", "muhasebe", "depo"].includes(b.rol)) throw Error("Bu ekran için yetkiniz yok.");
      setRol(b.rol);
      const satirId = new URLSearchParams(window.location.search).get("satirId");
      if (satirId) { setId(satirId); void yukle(satirId); }
    }).catch(e => { if (aktif) setHata(e.message); });
    return () => { aktif = false; sira.current++; };
  }, []);
  async function kaydet(kaldir: boolean) {
    if (!kaynak || bekliyor || yenileGerekli) return;
    if ((!kaldir && !tarih) || gerekce.trim().length < 5) { setHata("Giriş gününü ve en az 5 karakterlik doğrulama gerekçesini girin."); return; }
    setBekliyor(true); setHata(""); setBasari("");
    try {
      const r = await api<{ tarih: string | null; surum: number; kaynakOzeti: string }>(`/stok/ihtiyac-plani/giris-tarihleri/${kaynak.satirId}`, {
        method: "PUT", body: JSON.stringify({ tarih: kaldir ? null : tarih, gerekce: gerekce.trim(), beklenenSurum: kaynak.surum, beklenenKaynakOzeti: kaynak.kaynakOzeti }),
      });
      setKaynak({ ...kaynak, ...r, gecerli: r.tarih !== null, gerekce: gerekce.trim() }); setTarih(r.tarih ?? ""); setGerekce("");
      setBasari(kaldir ? "Giriş tarihi doğrulaması kaldırıldı." : "Beklenen depo giriş tarihi doğrulandı.");
    } catch (e) { setYenileGerekli(true); setHata(`${e instanceof Error ? e.message : "İşlem sonucu alınamadı."} Satırı yeniden yükleyerek güncel durumu kontrol edin.`); }
    finally { setBekliyor(false); }
  }
  const yazabilir = ["yonetici", "muhasebe"].includes(rol)&&!!kaynak?.erisim?.yazabilir;
  return <div className="stack">
    <PageHeader title="Sipariş giriş tarihi" subtitle="Açık alış siparişinin teslim edilmemiş kalanı için beklenen depo giriş gününü doğrulayın." actions={<ButtonLabel as="a" href="/panel/stok/ihtiyac">İhtiyaç önizlemesi</ButtonLabel>} />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    <Card><form onSubmit={e => { e.preventDefault(); void yukle(id); }} className="stack">
      <Field label="Sipariş satırı kimliği"><Input required value={id} disabled={!rol || bekliyor} onChange={e => { sira.current++; setId(e.target.value); setKaynak(null); setHata(""); setBasari(""); }} /></Field>
      <div><Button type="submit" disabled={!rol || bekliyor || !id}>Satırı yeniden yükle</Button></div>
      <p>Satırı açık alış siparişinin kalemlerindeki “Giriş tarihi” bağlantısından seçebilirsiniz.</p>
    </form></Card>
    {kaynak && <Card title="Beklenen giriş">
      {kaynak.stok&&<p>{kaynak.siparisNo??'Alış siparişi'} · {kaynak.stok.kod} — {kaynak.stok.ad}</p>}
      <p>Teslim edilmemiş kalan: {kaynak.kalanMiktar} {kaynak.anaBirim}</p>
      <p>Doğrulanmış gün: {kaynak.tarih ?? "Yok"} · Sürüm {kaynak.surum}</p>
      {kaynak.tarih && !kaynak.gecerli && <Alert tone="warning">Sipariş kaynağı değişmiş. Tarih yeniden doğrulanana kadar ihtiyaç hesabına katılmaz.</Alert>}
      {kaynak.tarih && kaynak.tarih < bugun() && <Alert tone="warning">Giriş günü geçmiş. Bu giriş yeni ihtiyaç hesabına katılmaz.</Alert>}
      {kaynak.gerekce && <p>Son gerekçe: {kaynak.gerekce}</p>}
      {yazabilir ? <div className="stack">
        <Field label="Beklenen depo giriş günü"><Input type="date" min={bugun()} value={tarih} disabled={bekliyor || yenileGerekli} onChange={e => setTarih(e.target.value)} /></Field>
        <Field label="Doğrulama veya kaldırma gerekçesi"><Input maxLength={1000} value={gerekce} disabled={bekliyor || yenileGerekli} onChange={e => setGerekce(e.target.value)} /></Field>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><Button variant="primary" disabled={bekliyor || yenileGerekli} onClick={() => void kaydet(false)}>Giriş tarihini doğrula</Button><Button disabled={bekliyor || yenileGerekli || !kaynak.tarih} onClick={() => void kaydet(true)}>Doğrulamayı kaldır</Button></div>
      </div> : <p>{kaynak.erisim?.mod==='salt_okunur'?'Şirket modu salt okunur; giriş tarihi değiştirilemez.':'Depo rolü tarihleri okuyabilir; doğrulama için yönetici veya muhasebe gerekir.'}</p>}
      <p>Bu işlem stok girişi, rezerv veya sipariş onayı oluşturmaz. Doğrulanmış gün teslim garantisi değildir.</p>
    </Card>}
  </div>;
}
