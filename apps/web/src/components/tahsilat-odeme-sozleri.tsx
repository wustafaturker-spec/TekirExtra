"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { odemeSozuListesiniDogrula, sozParaBicimi, type OdemeSozuListesi, type SozDurumu } from "@/lib/odeme-sozu";
import { Alert, Badge, Button, Card, Input, TableWrap } from "@/components/ui";
import { ArrowRight, ArrowUpRight, CalendarDays, CheckCheck, Clock3, RefreshCw, Search, Wallet } from "lucide-react";

const durumlar: Record<SozDurumu, string> = { aktif: "Aktif", kismen_gerceklesti: "Kısmen gerçekleşti", gerceklesti: "Gerçekleşti", gecikti: "Gecikti", iptal: "İptal edildi", revize: "Revize edildi", kaynak_gecersiz: "Fatura geçersiz" };
export function TahsilatOdemeSozleri() {
  const [veri, setVeri] = useState<{ kayitlar: OdemeSozuListesi[]; sonrakiImlec: string | null } | null>(null);
  const [imlec, setImlec] = useState<string | null>(null), [yenile, setYenile] = useState(0), [hata, setHata] = useState(""), [yuk, setYuk] = useState(true);
  const [arama, setArama] = useState(""), [filtre, setFiltre] = useState("tum");
  useEffect(() => {
    let etkin = true; setYuk(true); setHata(""); setVeri(null);
    void api<unknown>(`/cari/odeme-sozleri/is-listesi${imlec ? `?${new URLSearchParams({ imlec })}` : ""}`).then(v => {
      const r = v as { kayitlar?: OdemeSozuListesi[]; sonrakiImlec?: unknown };
      if (!Array.isArray(r?.kayitlar) || r.kayitlar.length > 20 || !(r.sonrakiImlec === null || (typeof r.sonrakiImlec === "string" && /^[0-9a-f-]{36}$/i.test(r.sonrakiImlec)))) throw Error("Ödeme sözü listesi doğrulanamadı.");
      const kayitlar = r.kayitlar.map(k => {
        const kayit = odemeSozuListesiniDogrula(k, k?.cari?.id);
        if (kayit.sozler.length !== 1 || kayit.sozler[0].kayitDurumu !== "aktif") throw Error("Ödeme sözü listesi doğrulanamadı.");
        return kayit;
      });
      if (etkin) setVeri({ kayitlar, sonrakiImlec: r.sonrakiImlec as string | null });
    }).catch(e => { if (etkin) setHata(e instanceof Error ? e.message : "Ödeme sözleri alınamadı."); }).finally(() => { if (etkin) setYuk(false); });
    return () => { etkin = false; };
  }, [imlec, yenile]);
  function tazele() { setImlec(null); setYenile(n => n + 1); }
  const bugun = veri?.kayitlar[0] ? new Date(veri.kayitlar[0].alindigiZaman).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }) : "";
  const kayitlar = veri?.kayitlar ?? [];
  const gecikti = (k: OdemeSozuListesi) => k.sozler[0].gerceklesme.durum === "gecikti";
  const tamam = (k: OdemeSozuListesi) => k.sozler[0].gerceklesme.durum === "gerceklesti";
  const yakin = (k: OdemeSozuListesi) => !tamam(k) && k.sozler[0].gerceklesme.durum !== "kaynak_gecersiz" && k.sozler[0].sozTarihi >= bugun;
  const gorunen = kayitlar.filter(k => (filtre === "tum" || (filtre === "geciken" && gecikti(k)) || (filtre === "yaklasan" && yakin(k)) || (filtre === "tamam" && tamam(k))) && `${k.cari.unvan} ${k.sozler[0].faturaNo ?? ""}`.toLocaleLowerCase("tr-TR").includes(arama.trim().toLocaleLowerCase("tr-TR")));
  return <section aria-label="Tahsilat ödeme sözleri" className="collection-promises stack">
    <div className="collection-metrics" aria-label="Bu sayfadaki ödeme sözlerinin özeti">
      {[{ ad: "Ödeme sözü", sayi: kayitlar.length, ikon: Wallet, ton: "neutral", not: "Yüklenen söz kayıtları" }, { ad: "Geciken söz", sayi: kayitlar.filter(gecikti).length, ikon: Clock3, ton: "danger", not: "Öncelikli takip gerektirir" }, { ad: "Bugün ve sonrası", sayi: kayitlar.filter(yakin).length, ikon: CalendarDays, ton: "info", not: "Beklenen ödeme sözleri" }, { ad: "Gerçekleşen", sayi: kayitlar.filter(tamam).length, ikon: CheckCheck, ton: "success", not: "Güncel ödemelerle karşılanan" }].map(m => <article key={m.ad} className={`collection-metric collection-metric--${m.ton}`}><span className="collection-metric__icon"><m.ikon size={20} aria-hidden="true"/></span><span className="collection-metric__label">{m.ad}</span><strong>{!veri ? "—" : m.sayi}</strong><small>{m.not}</small></article>)}
    </div>
    <Card pad={false} className="collection-panel"><div className="collection-panel__head"><div className="collection-heading"><span className="collection-heading__icon"><Wallet size={20} aria-hidden="true"/></span><div><h2>Ödeme sözleri</h2><p>Taahhütleri ve güncel tahsilat durumunu bir arada izleyin.</p></div></div><Button disabled={yuk} onClick={tazele}><RefreshCw size={15} aria-hidden="true"/>Ödeme sözlerini yenile</Button></div>
    <div className="collection-toolbar"><div className="collection-filters" aria-label="Ödeme sözü filtresi">{[["tum", "Tümü"], ["geciken", "Gecikenler"], ["yaklasan", "Bugün ve sonrası"], ["tamam", "Gerçekleşenler"]].map(([v, ad]) => <button key={v} type="button" aria-pressed={filtre === v} onClick={() => setFiltre(v)}>{ad}</button>)}</div><label className="collection-search"><Search size={16} aria-hidden="true"/><Input aria-label="Bu sayfadaki sözlerde ara" placeholder="Cari veya fatura ara…" value={arama} onChange={e => setArama(e.target.value)}/></label></div>
    <div className="collection-feedback">
    <Alert tone="error">{hata}</Alert>{yuk && <p role="status">Ödeme sözleri yükleniyor…</p>}
    </div>
    {veri && (gorunen.length === 0 ? <div className="collection-empty"><span><Search size={26} aria-hidden="true"/></span><h3>{kayitlar.length ? "Aramanıza uygun söz bulunamadı" : "Ödeme sözleri burada görünecek"}</h3><p>{kayitlar.length ? "Bu sayfadaki kayıtlar için aramayı veya filtreyi değiştirin." : "Cari hesabından eklediğiniz ödeme sözlerini bu alandan takip edebilirsiniz."}</p>{(arama || filtre !== "tum") && <Button onClick={() => { setArama(""); setFiltre("tum"); }}>Filtreleri temizle</Button>}</div> : <TableWrap><caption>Tahsilat ödeme sözleri</caption><thead><tr><th>Cari / Fatura</th><th>Söz tarihi</th><th className="num">Söz tutarı</th><th className="num">Gerçekleşen</th><th className="num">Kalan</th><th>Durum</th></tr></thead><tbody>{gorunen.map(k => {
      const s = k.sozler[0];
      const gec = gecikti(k), gecersiz = s.gerceklesme.durum === "kaynak_gecersiz";
      const oran = Number(BigInt(s.gerceklesme.gerceklesen.replace(".", "")) * 100n / BigInt(s.tutar.replace(".", "")));
      return <tr key={s.id} className={gec ? "collection-row--overdue" : ""}><td data-label="Cari / Fatura"><div className="collection-customer"><span className="collection-avatar" aria-hidden="true">{k.cari.unvan.trim().slice(0, 2).toLocaleUpperCase("tr-TR")}</span><div><a href={`/panel/cari/${k.cari.id}`}>{k.cari.unvan}<ArrowUpRight size={13} aria-hidden="true"/></a><a className="collection-invoice" href={`/panel/fatura?fatura=${s.faturaId}`}>{s.faturaNo ?? "Faturayı görüntüle"}</a></div></div></td><td data-label="Söz tarihi"><span className={`collection-date${gec ? " is-overdue" : ""}`}><CalendarDays size={15} aria-hidden="true"/>{s.sozTarihi.split("-").reverse().join(".")}</span>{gec && <small className="collection-date-hint">Söz günü geçti</small>}</td><td data-label="Söz tutarı" className="num collection-money">{sozParaBicimi(s.tutar, s.dovizCinsi)}</td><td data-label="Gerçekleşen" className="num"><span className="collection-paid">{gecersiz ? "—" : sozParaBicimi(s.gerceklesme.gerceklesen, s.dovizCinsi)}</span>{!gecersiz && <div className="collection-progress" role="progressbar" aria-label={`${k.cari.unvan} gerçekleşme oranı`} aria-valuenow={oran} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${oran}%` }}/></div>}</td><td data-label="Kalan" className={`num collection-money${gec ? " is-overdue" : ""}`}>{gecersiz ? "—" : sozParaBicimi(s.gerceklesme.kalan, s.dovizCinsi)}</td><td data-label="Durum"><Badge variant={gec ? "danger" : tamam(k) ? "success" : gecersiz ? "warning" : "info"}>{durumlar[s.gerceklesme.durum]}</Badge></td></tr>;
    })}</tbody></TableWrap>)}
    <footer className="collection-footer"><span>{veri ? `${gorunen.length} / ${kayitlar.length} söz gösteriliyor` : "Kayıtlar hazırlanıyor"}<small>Özet ve filtreler bu sayfadaki sözleri kapsar.</small></span><div className="row-tight">{imlec && <Button disabled={yuk} onClick={tazele}>İlk sözlere dön</Button>}{veri?.sonrakiImlec && <Button disabled={yuk} onClick={() => { setImlec(veri.sonrakiImlec); setArama(""); }}>Sonraki ödeme sözleri<ArrowRight size={14} aria-hidden="true"/></Button>}</div></footer>
    </Card>
  </section>;
}
