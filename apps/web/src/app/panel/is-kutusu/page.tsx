"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Badge, Button, Card, PageHeader, Segmented } from "@/components/ui";

type Kapsam = "bana" | "firma";
interface Aday { cariId: string; kod: string | null; unvan: string; gerekceler: string[] }
interface EpostaIsi {
  id: string; durum: string; epostaId: string; konu: string; gonderen: string; epostaTarihi: string; zaman: string; uyarilar: string[];
  cariAdaylari: Aday[]; kim: string | null; belge: { id: string; durum: string; tutar: string; doviz: string; cari: { id: string; unvan: string } } | null; adres: string;
}
interface Onay { id: string; arac: string; ozet: string; kaynak: string; zaman: string; gecerlilikSonu: string; kim: string; benim: boolean; adres: string }
interface Takip { id: string; belgeId: string; no: string | null; tutar: string; doviz: string; cari: { id: string; unvan: string }; gonderildiAt: string; hatirlatmaGunu: string; alici: string | null; gonderimSayisi: number; gecerlilik: string | null; kim: string | null; adres: string }
interface Yanit { id: string; belgeId: string; no: string | null; tutar: string; doviz: string; cari: { id: string; unvan: string }; yanitAt: string; yanitEpostaId: string | null; not: string | null; kim: string | null; adres: string }
interface Kutu { kapsam: Kapsam; cariSecimi: EpostaIsi[]; taslaklar: EpostaIsi[]; incelenecek: EpostaIsi[]; onaylar: Onay[]; takipEdilecek: Takip[]; yanitGelen: Yanit[] }

const DURUM_ADI: Record<string, string> = { incelenmeli: "Model emin değil", cari_yok: "Cari bulunamadı", sinirda: "AI sınırında", hata: "Hata" };
const tarih = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
const gun = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");
const tutar = (t: string, d: string) => `${Number(t).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${d}`;

function Grup({ baslik, aciklama, sayi, children }: { baslik: string; aciklama: string; sayi: number; children: ReactNode }) {
  if (!sayi) return null;
  return (
    <Card title={<span className="row-tight">{baslik} <Badge variant="info">{sayi}</Badge></span>}>
      <p className="muted is-kutusu__aciklama">{aciklama}</p>
      <ul className="is-kutusu__liste">{children}</ul>
    </Card>
  );
}

/**
 * AI-48…51: teklif sürecindeki açık işler. Yalnız riski olmayan eylemler
 * burada; onay ve e-posta gönderimi kendi ekranında önizlemeyle yapılır.
 */
export default function IsKutusuSayfasi() {
  const [kapsam, setKapsam] = useState<Kapsam>("bana");
  const [kutu, setKutu] = useState<Kutu | null>(null);
  const [yonetici, setYonetici] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    setHata("");
    try { setKutu(await api<Kutu>(`/is-kutusu?kapsam=${kapsam}`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "İş kutusu yüklenemedi"); }
  }, [kapsam]);
  useEffect(() => {
    if (!tokenAl()) return;
    void api<{ rol: string }>("/auth/ben").then((b) => setYonetici(b.rol === "yonetici")).catch(() => undefined);
  }, []);
  useEffect(() => { if (tokenAl()) void yukle(); }, [yukle]);

  async function eylem(anahtar: string, yol: string, govde: unknown, mesaj: string) {
    setIslem(anahtar); setHata(""); setBasari("");
    try { await api(yol, { method: "POST", body: JSON.stringify(govde) }); setBasari(mesaj); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "İşlem yapılamadı"); }
    finally { setIslem(null); }
  }

  const toplam = kutu ? kutu.cariSecimi.length + kutu.taslaklar.length + kutu.incelenecek.length + kutu.onaylar.length + kutu.takipEdilecek.length + kutu.yanitGelen.length : 0;
  const benimMi = kapsam === "bana";
  return <>
    <PageHeader
      title="Teklif İş Kutusu"
      subtitle="Gelen teklif taleplerinden yanıt bekleyen tekliflere kadar sizi bekleyen işler. Onaylar ve müşteriye gönderim kendi ekranında yapılır."
      actions={yonetici ? <Segmented ariaLabel="Kapsam" value={kapsam} onChange={setKapsam} items={[{ deger: "bana", baslik: "Benim işlerim" }, { deger: "firma", baslik: "Firma geneli" }]} /> : undefined}
    />
    <Alert tone="error">{hata}</Alert>
    {basari && <Alert tone="success">{basari}</Alert>}
    {kutu && !toplam && <Card><p className="muted">Bekleyen iş yok.</p></Card>}

    {kutu && <div className="stack">
      <Grup baslik="Cari seçimi bekleyen e-postalar" aciklama="Gönderen kayıtlı bir cariyle kesin eşleşmedi; doğru cariyi seçince taslak hazırlanır ve adres o cariye öğretilir." sayi={kutu.cariSecimi.length}>
        {kutu.cariSecimi.map((i) => (
          <li key={i.id}>
            <div className="is-kutusu__baslik"><strong>{i.konu}</strong><span className="muted">{i.gonderen} · {tarih(i.epostaTarihi)}{!benimMi && i.kim ? ` · ${i.kim}` : ""}</span></div>
            <ul className="is-kutusu__adaylar">
              {i.cariAdaylari.map((a) => (
                <li key={a.cariId}>
                  <span>{a.unvan}{a.kod ? <span className="muted"> · {a.kod}</span> : null} <span className="muted">— {a.gerekceler.join(" · ")}</span></span>
                  <Button size="sm" variant="primary" disabled={islem !== null} onClick={() => void eylem(`${i.id}:${a.cariId}`, `/ai/teklif-talepleri/${i.epostaId}/hazirla`, { cariId: a.cariId }, `${a.unvan} için taslak hazırlandı.`)}>Bu cari</Button>
                </li>
              ))}
            </ul>
            <div className="row-tight"><Link href="/panel/eposta">E-postada başka cari seç / yeni cari aç</Link></div>
          </li>
        ))}
      </Grup>

      <Grup baslik="Kontrol bekleyen taslaklar" aciklama="E-postadan açılan numarasız taslak teklifler. Kontrol edip onaylayın; gönderim ayrıca yapılır." sayi={kutu.taslaklar.length}>
        {kutu.taslaklar.map((i) => (
          <li key={i.id}>
            <div className="is-kutusu__baslik"><strong>{i.belge!.cari.unvan}</strong><span className="muted">{tutar(i.belge!.tutar, i.belge!.doviz)} · “{i.konu}” · {tarih(i.zaman)}{!benimMi && i.kim ? ` · ${i.kim}` : ""}</span></div>
            {!!i.uyarilar.length && <ul className="is-kutusu__uyarilar">{i.uyarilar.map((u, n) => <li key={n}>{u}</li>)}</ul>}
            <div className="row-tight"><Link href={i.adres}>Taslağı aç</Link></div>
          </li>
        ))}
      </Grup>

      <Grup baslik="İncelenecek e-posta talepleri" aciklama="Teklif talebi olabilir ama taslak açılamadı." sayi={kutu.incelenecek.length}>
        {kutu.incelenecek.map((i) => (
          <li key={i.id}>
            <div className="is-kutusu__baslik"><strong>{i.konu}</strong><span className="muted">{i.gonderen} · {tarih(i.epostaTarihi)}{!benimMi && i.kim ? ` · ${i.kim}` : ""}</span></div>
            <div className="row-tight"><Badge variant={i.durum === "hata" || i.durum === "sinirda" ? "danger" : "warning"}>{DURUM_ADI[i.durum] ?? i.durum}</Badge></div>
            {!!i.uyarilar.length && <ul className="is-kutusu__uyarilar">{i.uyarilar.map((u, n) => <li key={n}>{u}</li>)}</ul>}
            <div className="row-tight">
              <Link href="/panel/eposta">E-postayı aç</Link>
              {i.durum !== "cari_yok" && <Button size="sm" disabled={islem !== null} onClick={() => void eylem(i.id, `/ai/teklif-talepleri/${i.epostaId}/hazirla`, {}, "Yeniden denendi.")}>Yeniden dene</Button>}
            </div>
          </li>
        ))}
      </Grup>

      <Grup baslik={benimMi ? "Onayımı bekleyenler" : "Onay bekleyenler"} aciklama="Onay talebini yalnız açan kullanıcı onaylar; ayrıntı ve önizleme onay ekranındadır." sayi={kutu.onaylar.length}>
        {kutu.onaylar.map((o) => (
          <li key={o.id}>
            <div className="is-kutusu__baslik"><strong>{o.ozet}</strong><span className="muted">{tarih(o.zaman)} · {o.kaynak === "otomasyon" ? "e-posta teklif talebi" : o.kaynak === "mcp" ? "MCP" : "asistan"}{!o.benim ? ` · ${o.kim}` : ""} · son: {tarih(o.gecerlilikSonu)}</span></div>
            <div className="row-tight"><Link href={o.adres}>{o.benim ? "Onay ekranında aç" : "Ayrıntı"}</Link></div>
          </li>
        ))}
      </Grup>

      <Grup baslik="Yanıt yok — takip edin" aciklama="Hatırlatma süresi doldu ve müşteriden yanıt gelmedi. Takip e-postası teklif ekranından gönderilir." sayi={kutu.takipEdilecek.length}>
        {kutu.takipEdilecek.map((t) => (
          <li key={t.id}>
            <div className="is-kutusu__baslik"><strong>{t.no ?? "Teklif"} · {t.cari.unvan}</strong><span className="muted">{tutar(t.tutar, t.doviz)} · gönderim {tarih(t.gonderildiAt)}{t.alici ? ` (${t.alici})` : ""}{t.gecerlilik ? ` · geçerlilik ${gun(t.gecerlilik)}` : ""}{!benimMi && t.kim ? ` · ${t.kim}` : ""}</span></div>
            <div className="row-tight">
              <Link href={t.adres}>Takip e-postası</Link>
              <Button size="sm" disabled={islem !== null} onClick={() => void eylem(`${t.id}:e`, `/belgeler/${t.belgeId}/takip/ertele`, { isGunu: 3 }, `${t.no} takibi 3 iş günü ertelendi.`)}>3 iş günü ertele</Button>
              <Button size="sm" disabled={islem !== null} onClick={() => void eylem(`${t.id}:y`, `/belgeler/${t.belgeId}/takip/kapat`, { yanitAlindi: true }, `${t.no}: yanıt alındı olarak işaretlendi.`)}>Yanıt alındı</Button>
              <Button size="sm" disabled={islem !== null} onClick={() => void eylem(`${t.id}:k`, `/belgeler/${t.belgeId}/takip/kapat`, { yanitAlindi: false }, `${t.no} takibi kapatıldı.`)}>Takibi kapat</Button>
            </div>
          </li>
        ))}
      </Grup>

      <Grup baslik="Yanıt gelen teklifler" aciklama="Son 14 günde yanıt gelen ve henüz siparişe dönüşmeyen teklifler." sayi={kutu.yanitGelen.length}>
        {kutu.yanitGelen.map((t) => (
          <li key={t.id}>
            <div className="is-kutusu__baslik"><strong>{t.no ?? "Teklif"} · {t.cari.unvan}</strong><span className="muted">{tutar(t.tutar, t.doviz)} · yanıt {tarih(t.yanitAt)}{t.not ? ` · ${t.not}` : ""}{!benimMi && t.kim ? ` · ${t.kim}` : ""}</span></div>
            <div className="row-tight"><Link href={t.adres}>Teklifi aç (siparişe dönüştür)</Link>{t.yanitEpostaId && <Link href="/panel/eposta">Yanıt e-postası</Link>}</div>
          </li>
        ))}
      </Grup>
    </div>}
  </>;
}
