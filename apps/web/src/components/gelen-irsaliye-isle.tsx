"use client";

/**
 * SAT-12: gelen e-İrsaliyeden alış irsaliyesi. Satırlar stok kartlarıyla
 * eşleştirilir (öneri gelen e-Faturadaki sırayla gelir), onaylanınca onaylı
 * alış irsaliyesi (AIR…) oluşur; tedarikçinin irsaliye numarası belgeye
 * yazılır, fiyat tedarikçi/kart alış fiyatıdır.
 */
import { useEffect, useState } from "react";
import { api, tumSayfalariAl } from "@/lib/api";
import { AramaSecici } from "@/components/arama-secici";
import { Alert, Badge, Button } from "@/components/ui";

interface Oneri {
  siraNo: number;
  ad: string;
  saticiUrunKodu: string | null;
  barkod: string | null;
  miktar: string;
  birim: string;
  onerilenStokId: string | null;
  onerilenStok: { id: string; kod: string; ad: string; anaBirim: string; birimler: string[] } | null;
  eslesmeKaynagi: string | null;
}
interface Eslesme {
  id: string;
  belgeNo: string;
  gonderenUnvan: string;
  gonderenVkn: string;
  yanit: string;
  kendiSevkimiz: boolean;
  cari: { id: string; kod: string; unvan: string } | null;
  alisIrsaliyesi: { id: string; no: string | null } | null;
  satirlar: Oneri[];
}
interface Stok { id: string; kod: string; ad: string; anaBirim: string; birimler?: { ad: string }[] }

export function GelenIrsaliyeIsle({ gelenId, onKapat, onTamam }: {
  gelenId: string;
  onKapat: () => void;
  /** Oluşan alış irsaliyesinin numarasıyla çağrılır. */
  onTamam: (no: string | null, id: string) => void;
}) {
  const [veri, setVeri] = useState<Eslesme | null>(null);
  const [stoklar, setStoklar] = useState<Stok[]>([]);
  const [secim, setSecim] = useState<Record<number, string>>({});
  const [yeniCariOnay, setYeniCariOnay] = useState(false);
  const [hata, setHata] = useState("");
  const [islemde, setIslemde] = useState(false);

  useEffect(() => {
    void api<Eslesme>(`/belgeler/gelen-eirsaliye/${gelenId}/eslesme`).then((v) => {
      setVeri(v);
      setSecim(Object.fromEntries(v.satirlar.filter((s) => s.onerilenStokId).map((s) => [s.siraNo, s.onerilenStokId as string])));
    }).catch((e: unknown) => setHata(e instanceof Error ? e.message : "Belge okunamadı"));
    void tumSayfalariAl<Stok>("/stok").then(setStoklar).catch(() => undefined);
  }, [gelenId]);

  const eksik = veri ? veri.satirlar.filter((s) => !secim[s.siraNo]).length : 0;
  /** Belgedeki birim seçilen kartta yoksa kaydetme reddeder; önceden söylenir. */
  const birimUyarisi = (s: Oneri) => {
    const stok = stoklar.find((x) => x.id === secim[s.siraNo]);
    if (!stok || !s.birim || s.birim === stok.anaBirim || stok.birimler?.some((b) => b.ad === s.birim)) return null;
    return `Belgedeki birim '${s.birim}', kartın birimi '${stok.anaBirim}'. Karta '${s.birim}' ek birimini (katsayısıyla) ekleyin.`;
  };

  async function isle() {
    if (!veri) return;
    setIslemde(true); setHata("");
    try {
      const b = await api<{ id: string; no: string | null }>(`/belgeler/gelen-eirsaliye/${gelenId}/alis-irsaliyesi`, {
        method: "POST",
        body: JSON.stringify({ satirEslesmeleri: veri.satirlar.map((s) => ({ siraNo: s.siraNo, stokId: secim[s.siraNo] })), yeniCariOnay }),
      });
      onTamam(b.no, b.id);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Alış irsaliyesi oluşturulamadı");
    } finally {
      setIslemde(false);
    }
  }

  return (
    <div className="incoming-backdrop incoming-backdrop--confirm" onMouseDown={(e) => { if (e.target === e.currentTarget) onKapat(); }}>
      <section className="incoming-confirm despatch-match" role="dialog" aria-modal="true" aria-label="Alış irsaliyesine işle">
        <header className="is-success"><div><h3>Alış irsaliyesine işle</h3><p>{veri ? `${veri.belgeNo} · ${veri.gonderenUnvan}` : "Belge okunuyor…"}</p></div></header>
        <div className="despatch-match__body">
          {hata && <Alert tone="error">{hata}</Alert>}
          {veri?.alisIrsaliyesi && <Alert tone="warning">Bu belgeden {veri.alisIrsaliyesi.no ?? "bir"} alış irsaliyesi zaten oluşturulmuş.</Alert>}
          {veri && !veri.cari && (
            <label className="row" style={{ gap: "0.4rem", alignItems: "center" }}>
              <input type="checkbox" checked={yeniCariOnay} onChange={(e) => setYeniCariOnay(e.target.checked)} />
              <span>{veri.gonderenUnvan} (VKN {veri.gonderenVkn}) cari olarak kayıtlı değil; tedarikçi carisi açılsın</span>
            </label>
          )}
          {veri && (
            <table className="table despatch-match__table">
              <thead><tr><th>#</th><th>Belgedeki ürün</th><th className="num">Miktar</th><th>Stok kartı</th></tr></thead>
              <tbody>
                {veri.satirlar.map((s) => {
                  const uyari = birimUyarisi(s);
                  return (
                    <tr key={s.siraNo}>
                      <td>{s.siraNo}</td>
                      <td><strong>{s.ad}</strong><small className="muted">{[s.saticiUrunKodu, s.barkod].filter(Boolean).join(" · ") || "Kod yok"}</small></td>
                      <td className="num">{Number(s.miktar).toLocaleString("tr-TR")} {s.birim}</td>
                      <td>
                        <AramaSecici
                          ariaLabel={`${s.siraNo}. satır stok kartı`}
                          deger={secim[s.siraNo] ?? ""}
                          onChange={(deger) => setSecim((x) => ({ ...x, [s.siraNo]: deger }))}
                          placeholder="Kod veya ürün adıyla ara"
                          secenekler={stoklar.map((k) => ({ deger: k.id, baslik: k.ad, aciklama: `${k.kod} · ${k.anaBirim}`, aramaMetni: k.kod }))}
                        />
                        {s.onerilenStokId && secim[s.siraNo] === s.onerilenStokId && <Badge variant="info">otomatik eşleşti</Badge>}
                        {uyari && <small className="field-error">{uyari}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="muted">Fiyat e-İrsaliyede yoktur: tedarikçinin karttaki fiyatı, yoksa kartın alış fiyatı yazılır. Fatura geldiğinde bu irsaliyeyle eşleşir.</p>
        </div>
        <footer>
          <Button onClick={onKapat}>Vazgeç</Button>
          <Button variant="primary" disabled={!veri || islemde || eksik > 0 || Boolean(veri.alisIrsaliyesi) || (!veri.cari && !yeniCariOnay)} onClick={() => void isle()}>
            {islemde ? "Oluşturuluyor…" : eksik > 0 ? `${eksik} satır eşleşmedi` : "Alış irsaliyesi oluştur"}
          </Button>
        </footer>
      </section>
    </div>
  );
}
