"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAdresDurumu } from "@/lib/adres-durumu";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Segmented, Select, TableSkeleton, TableWrap } from "@/components/ui";

/** ILT-07: firmanın e-posta gönderimleri. İleti gövdesi kayıtlı değildir, yeniden gönderim belgenin ekranından yapılır. */
type Durum = "gonderiliyor" | "gonderildi" | "basarisiz" | "belirsiz";
interface Satir { id: string; alici: string; konu: string; tur: string; durum: Durum; ekSayisi: number; hataMesaji: string | null; gonderen: "firma" | "platform"; deneme: number; createdAt: string }
interface SmsSatir { id: string; tur: string; telefon: string; durum: Durum; parca: number; hata: string | null; createdAt: string; cari: { unvan: string } | null }
interface Yanit { satirlar: (Satir & SmsSatir)[]; toplam: number; sayfa: number; sayfaBoyutu: number; turler: string[] }

const DURUM: Record<Durum, { ad: string; rozet: "success" | "danger" | "warning" }> = {
  gonderiliyor: { ad: "Gönderiliyor", rozet: "warning" }, gonderildi: { ad: "Gönderildi", rozet: "success" }, basarisiz: { ad: "Başarısız", rozet: "danger" }, belirsiz: { ad: "Belirsiz", rozet: "warning" },
};
const TUR: Record<string, string> = { bildirim: "Bildirim", kritik_bildirim: "Kritik bildirim", belge: "Belge", rapor: "Rapor", ileti: "E-posta ekranı", bilgi: "Bilgilendirme", genel: "Genel", efatura: "e-Fatura", odeme_sozu_hatirlatma: "Ödeme sözü hatırlatması", vade_hatirlatma: "Vade hatırlatması", odeme_baglantisi: "Ödeme bağlantısı" };
const turAdi = (t: string) => TUR[t] ?? t;

export default function GonderimlerSayfasi() {
  const [adres, guncelle, hazir] = useAdresDurumu({ kanal: "eposta", durum: "", tur: "", baslangic: "", bitis: "", sayfa: "1" });
  const [veri, setVeri] = useState<Yanit | null>(null);
  const [hata, setHata] = useState("");
  const sayfa = Number(adres.sayfa) || 1;
  const yukle = useCallback(async () => {
    setHata("");
    const p = new URLSearchParams(Object.entries(adres).filter(([k, v]) => v && k !== "kanal"));
    try { setVeri(await api<Yanit>(`/eposta/${adres.kanal === "sms" ? "sms-gonderimler" : "gonderimler"}?${p}`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Gönderimler yüklenemedi"); }
  }, [adres]);
  useEffect(() => { if (hazir) void yukle(); }, [yukle, hazir]);
  const sayfaSayisi = veri ? Math.max(1, Math.ceil(veri.toplam / veri.sayfaBoyutu)) : 1;
  const suz = (k: Partial<typeof adres>) => guncelle({ ...k, sayfa: "1" });

  return <div>
    <PageHeader title="Gönderimler" subtitle="Firmanızdan çıkan e-posta ve SMS'lerin sonucu. İleti içeriği saklanmaz." actions={<Link className="btn btn--ghost" href="/panel/ayarlar/eposta">E-posta ayarları</Link>} />
    <Alert tone="error">{hata}</Alert>
    <div style={{ marginBottom: "0.8rem" }}><Segmented ariaLabel="Kanal" value={adres.kanal} onChange={(k) => { setVeri(null); guncelle({ kanal: k, durum: "", tur: "", sayfa: "1" }); }} items={[{ deger: "eposta", baslik: "E-posta" }, { deger: "sms", baslik: "SMS" }]} /></div>
    <Card title="Süzgeç">
      <div className="form-grid">
        <Field label="Durum"><Select value={adres.durum} onChange={(e) => suz({ durum: e.target.value })}><option value="">Tümü</option>{(Object.keys(DURUM) as Durum[]).filter((d) => adres.kanal === "sms" || d !== "gonderiliyor").map((d) => <option key={d} value={d}>{DURUM[d].ad}</option>)}</Select></Field>
        <Field label="Tür"><Select value={adres.tur} onChange={(e) => suz({ tur: e.target.value })}><option value="">Tümü</option>{veri?.turler.map((t) => <option key={t} value={t}>{turAdi(t)}</option>)}</Select></Field>
        <Field label="Başlangıç"><Input type="date" value={adres.baslangic} onChange={(e) => suz({ baslangic: e.target.value })} /></Field>
        <Field label="Bitiş"><Input type="date" value={adres.bitis} onChange={(e) => suz({ bitis: e.target.value })} /></Field>
      </div>
    </Card>
    <Card pad={false} title={veri ? `${veri.toplam.toLocaleString("tr-TR")} gönderim` : "Gönderimler"}>
      {!veri ? <TableSkeleton /> : adres.kanal === "sms" ? <TableWrap><table className="table">
        <thead><tr><th>Zaman</th><th>Telefon</th><th>Cari</th><th>Tür</th><th>Parça</th><th>Durum</th><th>Hata</th></tr></thead>
        <tbody>
          {veri.satirlar.map((s) => <tr key={s.id}><td>{new Date(s.createdAt).toLocaleString("tr-TR")}</td><td>{s.telefon}</td><td>{s.cari?.unvan ?? ""}</td><td>{turAdi(s.tur)}</td><td>{s.parca}</td><td><Badge variant={DURUM[s.durum]?.rozet ?? "warning"}>{DURUM[s.durum]?.ad ?? s.durum}</Badge></td><td className="muted" style={{ overflowWrap: "anywhere" }}>{s.hata ?? ""}</td></tr>)}
          {!veri.satirlar.length && <tr><td colSpan={7} className="muted">SMS gönderimi yok.</td></tr>}
        </tbody>
      </table></TableWrap> : <TableWrap><table className="table">
        <thead><tr><th>Zaman</th><th>Alıcı</th><th>Konu</th><th>Tür</th><th>Hesap</th><th>Durum</th><th>Hata</th></tr></thead>
        <tbody>
          {veri.satirlar.map((s) => <tr key={s.id}>
            <td>{new Date(s.createdAt).toLocaleString("tr-TR")}</td>
            <td style={{ overflowWrap: "anywhere" }}>{s.alici}</td>
            <td>{s.konu}{s.ekSayisi > 0 && <span className="muted"> · {s.ekSayisi} ek</span>}</td>
            <td>{turAdi(s.tur)}</td>
            <td>{s.gonderen === "firma" ? "Firma" : "TekirExtra"}</td>
            <td><Badge variant={DURUM[s.durum]?.rozet ?? "warning"}>{DURUM[s.durum]?.ad ?? s.durum}</Badge></td>
            <td className="muted" style={{ overflowWrap: "anywhere" }}>{s.hataMesaji ?? ""}</td>
          </tr>)}
          {!veri.satirlar.length && <tr><td colSpan={7} className="muted">Gönderim bulunamadı.</td></tr>}
        </tbody>
      </table></TableWrap>}
      {sayfaSayisi > 1 && <div className="row-tight" style={{ padding: "0.8rem 1.25rem" }}><Button size="sm" disabled={sayfa <= 1} onClick={() => guncelle({ sayfa: String(sayfa - 1) })}>Önceki</Button><span className="muted">{sayfa} / {sayfaSayisi}</span><Button size="sm" disabled={sayfa >= sayfaSayisi} onClick={() => guncelle({ sayfa: String(sayfa + 1) })}>Sonraki</Button></div>}
    </Card>
  </div>;
}
