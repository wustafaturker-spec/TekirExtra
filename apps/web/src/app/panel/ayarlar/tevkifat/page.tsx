"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, TableWrap } from "@/components/ui";
import { TEVKIFAT_KODLARI, tevkifatAyarHatalari, tevkifatTablosuCoz, type TevkifatDegisikligi } from "@tekirextra/shared";

/** Ekrandaki satır: oranlar virgülle yazılır ("2/10, 5/10"). */
interface Satir { kod: string; ad: string; oranlarMetni: string; pasif: boolean }

const oranlariAyir = (metin: string) => metin.split(/[,;\s]+/).map((o) => o.trim()).filter(Boolean);
const varsayilanBul = (kod: string) => TEVKIFAT_KODLARI.find((k) => k.kod === kod);

/** Ekran satırlarından yalnız varsayılandan farklı olanlar saklanır. */
function degisiklikleriCikar(satirlar: Satir[]): TevkifatDegisikligi[] {
  return satirlar.flatMap((s): TevkifatDegisikligi[] => {
    const oranlar = oranlariAyir(s.oranlarMetni);
    const v = varsayilanBul(s.kod);
    if (!v) return [{ kod: s.kod.trim(), ad: s.ad.trim(), oranlar, ...(s.pasif ? { pasif: true } : {}) }];
    const adFarkli = s.ad.trim() !== "" && s.ad.trim() !== v.ad;
    const oranFarkli = oranlar.join(",") !== v.oranlar.join(",");
    if (!adFarkli && !oranFarkli && !s.pasif) return [];
    return [{ kod: s.kod, ...(adFarkli ? { ad: s.ad.trim() } : {}), ...(oranFarkli ? { oranlar } : {}), ...(s.pasif ? { pasif: true } : {}) }];
  });
}

const satirlaraCevir = (degisiklikler: TevkifatDegisikligi[]): Satir[] =>
  tevkifatTablosuCoz(degisiklikler).map((k) => ({ kod: k.kod, ad: k.ad, oranlarMetni: k.oranlar.join(", "), pasif: Boolean(k.pasif) }));

/**
 * FTR-35: KDV tevkifat kodları ve oranları. Varsayılan GİB kod listesinden
 * gelir; mevzuat değişince yönetici oranı değiştirir, yeni kodu ekler ya da
 * kullanmadığı kodu pasif yapar. Kesinleşmiş faturalar etkilenmez; taslaklar
 * bir sonraki kaydedişte yeni oranla hesaplanır.
 */
export default function TevkifatAyarlariSayfasi() {
  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [kayitli, setKayitli] = useState<TevkifatDegisikligi[]>([]);
  const [yeni, setYeni] = useState<Satir>({ kod: "", ad: "", oranlarMetni: "", pasif: false });
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islem, setIslem] = useState(false);

  const yukle = useCallback(async () => {
    const ayar = await api<{ degisiklikler: TevkifatDegisikligi[] }>("/ayarlar/tevkifat");
    setKayitli(ayar.degisiklikler ?? []);
    setSatirlar(satirlaraCevir(ayar.degisiklikler ?? []));
  }, []);
  useEffect(() => { if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Tevkifat ayarları yüklenemedi")); }, [yukle]);

  const degisiklikler = useMemo(() => degisiklikleriCikar(satirlar), [satirlar]);
  const uyarilar = useMemo(() => tevkifatAyarHatalari(degisiklikler), [degisiklikler]);
  const kaydedilmemis = JSON.stringify(degisiklikler) !== JSON.stringify(degisiklikleriCikar(satirlaraCevir(kayitli)));

  const guncelle = (kod: string, alan: Partial<Satir>) => setSatirlar((eski) => eski.map((s) => (s.kod === kod ? { ...s, ...alan } : s)));
  const varsayilanaDon = (kod: string) => { const v = varsayilanBul(kod); if (v) guncelle(kod, { ad: v.ad, oranlarMetni: v.oranlar.join(", "), pasif: false }); };
  const kaldir = (kod: string) => setSatirlar((eski) => eski.filter((s) => s.kod !== kod));

  function kodEkle(e: React.FormEvent) {
    e.preventDefault(); setHata("");
    const kod = yeni.kod.trim();
    if (satirlar.some((s) => s.kod === kod)) { setHata(`${kod} kodu listede zaten var; oranını tablodan değiştirin`); return; }
    const sorun = tevkifatAyarHatalari([{ kod, ad: yeni.ad, oranlar: oranlariAyir(yeni.oranlarMetni) }]);
    if (sorun.length) { setHata(sorun[0]); return; }
    setSatirlar((eski) => [...eski, { ...yeni, kod, ad: yeni.ad.trim() }]);
    setYeni({ kod: "", ad: "", oranlarMetni: "", pasif: false });
  }

  async function kaydet() {
    if (uyarilar.length) { setHata(uyarilar[0]); return; }
    setIslem(true); setHata(""); setBasari("");
    try {
      await api("/ayarlar/tevkifat", { method: "PUT", body: JSON.stringify({ degisiklikler }) });
      await yukle();
      setBasari("Tevkifat oranları kaydedildi. Yeni faturalar ve kaydedilen taslaklar bu oranlarla hesaplanır; kesinleşmiş faturalar değişmez.");
    } catch (e) { setHata(e instanceof Error ? e.message : "Kaydedilemedi"); } finally { setIslem(false); }
  }

  return <div className="production-page">
    <PageHeader title="Tevkifat Oranları" subtitle="KDV tevkifat kodları GİB kod listesinden gelir. Mevzuat değişince oranı buradan güncelleyin; yeni kod ekleyebilir, kullanmadığınız kodu pasif yapabilirsiniz." />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    {uyarilar.length > 0 && <Alert tone="warning">{uyarilar.map((u) => <div key={u}>{u}</div>)}</Alert>}
    <Card
      title="Kodlar ve oranlar"
      actions={<Button variant="primary" disabled={islem || !kaydedilmemis || uyarilar.length > 0} onClick={() => void kaydet()}>{islem ? "Kaydediliyor..." : "Kaydet"}</Button>}
      pad={false}
    >
      <TableWrap>
        <thead><tr><th>Kod</th><th>Ad</th><th>Oranlar</th><th>GİB varsayılanı</th><th>Durum</th><th /></tr></thead>
        <tbody>
          {satirlar.map((s) => {
            const v = varsayilanBul(s.kod);
            const farkli = v ? oranlariAyir(s.oranlarMetni).join(",") !== v.oranlar.join(",") || (s.ad.trim() !== "" && s.ad.trim() !== v.ad) || s.pasif : true;
            return <tr key={s.kod}>
              <td><strong>{s.kod}</strong>{!v && <> <Badge variant="info">Eklenen</Badge></>}</td>
              <td><Input aria-label={`${s.kod} adı`} value={s.ad} maxLength={300} onChange={(e) => guncelle(s.kod, { ad: e.target.value })} /></td>
              <td><Input aria-label={`${s.kod} oranları`} value={s.oranlarMetni} onChange={(e) => guncelle(s.kod, { oranlarMetni: e.target.value })} placeholder="ör. 4/10" style={{ maxWidth: "10rem" }} /></td>
              <td className="muted">{v ? v.oranlar.join(", ") : "—"}</td>
              <td><label className="check"><input type="checkbox" checked={!s.pasif} onChange={(e) => guncelle(s.kod, { pasif: !e.target.checked })} /><span>{s.pasif ? "Pasif" : "Aktif"}</span></label></td>
              <td>{v
                ? farkli && <Button size="sm" onClick={() => varsayilanaDon(s.kod)}>Varsayılana dön</Button>
                : <Button size="sm" variant="danger" onClick={() => kaldir(s.kod)}>Kaldır</Button>}</td>
            </tr>;
          })}
        </tbody>
      </TableWrap>
      <p className="muted" style={{ padding: "0.8rem 1.25rem", margin: 0 }}>
        Birden çok oran yazılan kodda (ör. 650) faturada oran listeden seçilir. Pasif kod yeni faturada seçilemez; gelen e-Faturada yine tanınır.
        Kesinleşmiş faturalar sakladıkları oranla kalır, taslaklar bir sonraki kaydedişte yeni oranla hesaplanır.
      </p>
    </Card>
    <Card title="Yeni tevkifat kodu ekle"><form className="form-grid" onSubmit={kodEkle}>
      <Field label="Kod"><Input required inputMode="numeric" pattern="\d{3}" maxLength={3} value={yeni.kod} onChange={(e) => setYeni({ ...yeni, kod: e.target.value })} placeholder="ör. 628" /></Field>
      <Field label="Ad"><Input required maxLength={300} value={yeni.ad} onChange={(e) => setYeni({ ...yeni, ad: e.target.value })} placeholder="GİB kod listesindeki adı" /></Field>
      <Field label="Oranlar"><Input required value={yeni.oranlarMetni} onChange={(e) => setYeni({ ...yeni, oranlarMetni: e.target.value })} placeholder="ör. 5/10 ya da 2/10, 5/10" /></Field>
      <p className="muted">Kod GİB'in yayımladığı tevkifat kodu olmalıdır; UBL'e olduğu gibi yazılır. Eklenen kod listeye düşer, kalıcı olması için Kaydet'e basın.</p>
      <div><Button type="submit">Listeye ekle</Button></div>
    </form></Card>
  </div>;
}
