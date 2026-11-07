"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Input, TableWrap } from "@/components/ui";

/**
 * PZR-07: faturalı pazaryeri kesintilerini pazaryerinin komisyon e-Faturasıyla
 * eşleştirme. Gider faturadan yazılır (PZR-06); burası mutabakattır. Sistem
 * önerir, kullanıcı onaylar; tutmazsa kesintiler elle seçilir.
 */
interface Aday { id: string; tarih: string; tutar: string; dovizCinsi: string; tur: string; siparisNo: string | null }
interface Fatura {
  id: string; belgeNo: string; tarih: string; toplam: string; dovizCinsi: string; gonderenUnvan: string;
  eslesen: { adet: number; toplam: string } | null;
  oneri: { kesintiIds: string[]; toplam: string } | null;
}
interface BaglantiDurumu {
  baglantiId: string; saglayici: string; faturaKesenVkn: string | null;
  vknOnerileri: { vkn: string; unvan: string; faturaSayisi: number }[];
  faturalar: Fatura[]; adaylar: Aday[];
  faturasiGelmeyen: { adet: number; tutarlar: Record<string, string>; gun: number };
  kesintisiOlmayanFatura: number;
}

const SAGLAYICI_ADI: Record<string, string> = { amazon_tr: "Amazon", trendyol: "Trendyol", hepsiburada: "Hepsiburada", n11: "N11" };
const para = (v: string | number, d = "TRY") => Number(v).toLocaleString("tr-TR", { style: "currency", currency: d });
const tarih = (v: string) => new Date(v).toLocaleDateString("tr-TR");

export function PazaryeriFaturaEslestirme({ onDegisti }: { onDegisti?: () => void | Promise<void> }) {
  const [durum, setDurum] = useState<BaglantiDurumu[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [islem, setIslem] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [vknGirdi, setVknGirdi] = useState<Record<string, string>>({});
  const [vknDuzenle, setVknDuzenle] = useState<Record<string, boolean>>({});
  const [elle, setElle] = useState<{ baglantiId: string; fatura: Fatura; secili: Set<string> } | null>(null);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try { setDurum(await api<BaglantiDurumu[]>("/pazaryeri/kesintiler/eslestirme")); }
    catch (e) { setHata(e instanceof Error ? e.message : "Eşleştirme durumu yüklenemedi"); }
    finally { setYukleniyor(false); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  async function calis(ad: string, is: () => Promise<string>) {
    setIslem(ad); setHata(""); setBasari("");
    try { setBasari(await is()); await yukle(); await onDegisti?.(); }
    catch (e) { setHata(e instanceof Error ? e.message : "İşlem başarısız"); }
    finally { setIslem(""); }
  }

  const vknKaydet = (b: BaglantiDurumu, vkn: string | null) => calis(`vkn:${b.baglantiId}`, async () => {
    await api(`/pazaryeri/baglantilar/${b.baglantiId}/fatura-vkn`, { method: "POST", body: JSON.stringify({ vkn }) });
    setVknDuzenle((x) => ({ ...x, [b.baglantiId]: false }));
    return vkn ? `${SAGLAYICI_ADI[b.saglayici] ?? b.saglayici} için fatura kesen VKN ${vkn} kaydedildi.` : "Fatura kesen VKN kaldırıldı.";
  });

  const bagla = (f: Fatura, kesintiIds: string[]) => calis(`bagla:${f.id}`, async () => {
    const r = await api<{ eslesen: number; fark: string }>("/pazaryeri/kesintiler/eslestir", { method: "POST", body: JSON.stringify({ gelenEbelgeId: f.id, kesintiIds }) });
    setElle(null);
    return `${r.eslesen} kesinti ${f.belgeNo} faturasına bağlandı.${Number(r.fark) ? ` Fatura ile kesintiler arasında ${para(r.fark, f.dovizCinsi)} fark var.` : ""}`;
  });

  const kaldir = (f: Fatura) => {
    if (!confirm(`${f.belgeNo} faturasının kesinti eşleşmesi kaldırılsın mı? Kesintiler bekleyene döner.`)) return;
    void calis(`kaldir:${f.id}`, async () => {
      const r = await api<{ kaldirilan: number }>(`/pazaryeri/kesintiler/eslesme-kaldir/${f.id}`, { method: "POST", body: "{}" });
      return `${r.kaldirilan} kesintinin eşleşmesi kaldırıldı.`;
    });
  };

  const elleToplam = useMemo(() => {
    if (!elle) return 0;
    const b = durum.find((x) => x.baglantiId === elle.baglantiId);
    return (b?.adaylar ?? []).filter((k) => elle.secili.has(k.id)).reduce((t, k) => t + Number(k.tutar), 0);
  }, [elle, durum]);

  if (yukleniyor && !durum.length) return null;
  if (!durum.length) return null;

  return (
    <Card title="Komisyon faturası eşleştirme" pad={false}>
      <div style={{ display: "grid", gap: "0.75rem", padding: "0.75rem 1rem" }}>
        <small className="subtle">Faturalı kesintilerin (komisyon, kargo, hizmet, reklam) gideri pazaryerinin kestiği e-Faturadan yazılır. Burada kesintiler o faturayla eşleştirilir; sistem tutarı tutan kesintileri önerir, siz onaylarsınız.</small>
        {hata && <Alert tone="error">{hata}</Alert>}
        {basari && <Alert tone="success">{basari}</Alert>}
      </div>
      {durum.map((b) => {
        const ad = SAGLAYICI_ADI[b.saglayici] ?? b.saglayici;
        const vknAcik = !b.faturaKesenVkn || vknDuzenle[b.baglantiId];
        const gelmeyenTutar = Object.entries(b.faturasiGelmeyen.tutarlar).map(([d, v]) => para(v, d)).join(" · ");
        return (
          <section key={b.baglantiId} style={{ borderTop: "1px solid var(--border)", padding: "0.75rem 1rem", display: "grid", gap: "0.6rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", justifyContent: "space-between" }}>
              <strong>{ad}</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                {b.faturasiGelmeyen.adet > 0 && <Badge variant="warning">{b.faturasiGelmeyen.adet} kesintinin faturası {b.faturasiGelmeyen.gun}+ gündür gelmedi · {gelmeyenTutar}</Badge>}
                {b.kesintisiOlmayanFatura > 0 && <Badge variant="warning">{b.kesintisiOlmayanFatura} faturanın kesintisi yok</Badge>}
              </div>
            </div>

            {vknAcik ? (
              <div style={{ display: "grid", gap: "0.5rem" }}>
                {!b.faturaKesenVkn && <Alert tone="warning">{ad} komisyon faturalarını kesen VKN'yi girin; eşleştirme bu VKN'den gelen e-Faturalarla yapılır.</Alert>}
                {b.vknOnerileri.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {b.vknOnerileri.slice(0, 3).map((o) => <Button key={o.vkn} size="sm" disabled={!!islem} onClick={() => void vknKaydet(b, o.vkn)}>Kullan: {o.vkn} · {o.unvan} ({o.faturaSayisi} fatura)</Button>)}
                </div>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
                  <Input aria-label={`${ad} fatura kesen VKN`} inputMode="numeric" maxLength={11} placeholder="VKN (10 hane)" value={vknGirdi[b.baglantiId] ?? b.faturaKesenVkn ?? ""} onChange={(e) => setVknGirdi((x) => ({ ...x, [b.baglantiId]: e.target.value.replace(/\D/g, "") }))} style={{ maxWidth: 200 }} />
                  <Button size="sm" variant="primary" disabled={!!islem || !/^\d{10,11}$/.test(vknGirdi[b.baglantiId] ?? "")} onClick={() => void vknKaydet(b, vknGirdi[b.baglantiId])}>VKN'yi kaydet</Button>
                  {b.faturaKesenVkn && <Button size="sm" onClick={() => setVknDuzenle((x) => ({ ...x, [b.baglantiId]: false }))}>Vazgeç</Button>}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <small className="subtle">Fatura kesen VKN: <span className="mono">{b.faturaKesenVkn}</span></small>
                <Button size="sm" onClick={() => setVknDuzenle((x) => ({ ...x, [b.baglantiId]: true }))}>Değiştir</Button>
              </div>
            )}

            {b.faturaKesenVkn && (b.faturalar.length ? (
              <TableWrap>
                <thead><tr><th>Fatura</th><th>Tarih</th><th className="num">Tutar</th><th>Eşleşme</th><th></th></tr></thead>
                <tbody>
                  {b.faturalar.map((f) => {
                    const fark = f.eslesen ? Number(f.toplam) - Number(f.eslesen.toplam) : 0;
                    return (
                      <tr key={f.id}>
                        <td className="mono">{f.belgeNo}</td>
                        <td>{tarih(f.tarih)}</td>
                        <td className="num">{para(f.toplam, f.dovizCinsi)}</td>
                        <td>
                          {f.eslesen ? <><Badge variant={Math.abs(fark) < 0.005 ? "success" : "warning"}>{f.eslesen.adet} kesinti · {para(f.eslesen.toplam, f.dovizCinsi)}</Badge>{Math.abs(fark) >= 0.005 && <small> Fark {para(fark, f.dovizCinsi)}</small>}</>
                            : f.oneri ? <small>Öneri: {f.oneri.kesintiIds.length} kesinti · {para(f.oneri.toplam, f.dovizCinsi)}</small>
                            : <Badge variant="neutral">Eşleşen kesinti yok</Badge>}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {f.eslesen ? <Button size="sm" disabled={!!islem} onClick={() => kaldir(f)}>Eşleşmeyi kaldır</Button>
                            : <>
                              {f.oneri && <Button size="sm" variant="primary" disabled={!!islem} onClick={() => void bagla(f, f.oneri!.kesintiIds)}>Öneriyi onayla</Button>}
                              <Button size="sm" disabled={!!islem} onClick={() => setElle({ baglantiId: b.baglantiId, fatura: f, secili: new Set(f.oneri?.kesintiIds ?? []) })}>Elle eşleştir</Button>
                            </>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            ) : <small className="subtle">Bu VKN'den gelen e-Fatura yok.</small>)}

            {elle?.baglantiId === b.baglantiId && (() => {
              const adaylar = b.adaylar.filter((k) => k.dovizCinsi === elle.fatura.dovizCinsi);
              const fark = Number(elle.fatura.toplam) - elleToplam;
              return (
                <div style={{ border: "1px solid var(--border)", borderRadius: "0.6rem", padding: "0.6rem", display: "grid", gap: "0.5rem" }}>
                  <strong>{elle.fatura.belgeNo} için kesinti seçin</strong>
                  <small>Fatura {para(elle.fatura.toplam, elle.fatura.dovizCinsi)} · seçilen {para(elleToplam, elle.fatura.dovizCinsi)} · fark {para(fark, elle.fatura.dovizCinsi)}</small>
                  {adaylar.length ? <TableWrap>
                    <thead><tr><th>Seç</th><th>Tarih</th><th>Tür</th><th>Sipariş</th><th className="num">Tutar</th></tr></thead>
                    <tbody>{adaylar.map((k) => <tr key={k.id}>
                      <td><input type="checkbox" aria-label={`${tarih(k.tarih)} ${k.tur} kesintisini seç`} checked={elle.secili.has(k.id)} onChange={(e) => setElle((x) => { if (!x) return x; const s = new Set(x.secili); if (e.target.checked) s.add(k.id); else s.delete(k.id); return { ...x, secili: s }; })} /></td>
                      <td>{tarih(k.tarih)}</td><td>{k.tur}</td><td>{k.siparisNo ?? "—"}</td><td className="num">{para(k.tutar, k.dovizCinsi)}</td>
                    </tr>)}</tbody>
                  </TableWrap> : <small className="subtle">Bu dövizde bekleyen faturalı kesinti yok.</small>}
                  <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
                    <Button size="sm" onClick={() => setElle(null)}>Vazgeç</Button>
                    <Button size="sm" variant="primary" disabled={!!islem || !elle.secili.size} onClick={() => {
                      if (Math.abs(fark) >= 0.005 && !confirm(`Seçilen kesintiler faturadan ${para(fark, elle.fatura.dovizCinsi)} farklı. Yine de bağlansın mı? Fark kayıtta görünür.`)) return;
                      void bagla(elle.fatura, [...elle.secili]);
                    }}>Seçilenleri bağla ({elle.secili.size})</Button>
                  </div>
                </div>
              );
            })()}
          </section>
        );
      })}
    </Card>
  );
}
