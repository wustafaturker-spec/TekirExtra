"use client";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ENTEGRASYON_KATALOGU, ENTEGRASYON_KATEGORILERI, type EntegrasyonKategorisi, type KatalogKaydi } from "@tekirextra/shared";
import { api, tumSayfalariAl } from "@/lib/api";
import { Alert, Badge, Button, Field, Input } from "@/components/ui";
import { CariSecici, type CariSecenegi } from "@/components/cari-secici";
import { PazaryeriOtomatikCekim } from "@/components/pazaryeri-otomatik-cekim";

interface Baglanti { id: string; aile: string; saglayici: string; durum: string; kullaniciAdiMaskeli: string }
interface BaglantiCarisi { id: string; saglayici: string; varsayilanAliciCariId: string | null }
type Suzgec = "tumu" | EntegrasyonKategorisi;

/** ETC-01/02: entegrasyon kataloğu — kategorili kartlar, bağlantı penceresi, "Yakında" talepleri. */
export default function EntegrasyonKatalogu() {
  const [kayitlar, setKayitlar] = useState<Baglanti[]>([]);
  const [cariBaglari, setCariBaglari] = useState<BaglantiCarisi[]>([]);
  const [talepler, setTalepler] = useState<string[]>([]);
  const [cariler, setCariler] = useState<CariSecenegi[]>([]);
  const [suzgec, setSuzgec] = useState<Suzgec>("tumu");
  const [arama, setArama] = useState("");
  const [acik, setAcik] = useState<KatalogKaydi | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState(""); const [mesaj, setMesaj] = useState("");
  const [sinama, setSinama] = useState<{ basarili: boolean; mesaj: string } | null>(null);
  const [varsayilanCari, setVarsayilanCari] = useState("");

  const yukle = useCallback(async () => {
    const [b, t, c] = await Promise.all([
      api<Baglanti[]>("/baglantilar"),
      api<Array<{ saglayici: string }>>("/pazaryeri/entegrasyon-talepleri").catch(() => []),
      api<BaglantiCarisi[]>("/pazaryeri/hakedis/baglantilar").catch(() => []),
    ]);
    setKayitlar(b.filter((x) => x.aile === "pazaryeri")); setTalepler(t.map((x) => x.saglayici)); setCariBaglari(c);
  }, []);
  useEffect(() => { void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Bağlantılar yüklenemedi")); }, [yukle]);

  const baglanti = (kod: string) => kayitlar.find((x) => x.saglayici === kod);
  const gorunen = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    const bagli = new Set(kayitlar.map((x) => x.saglayici));
    return ENTEGRASYON_KATALOGU.filter((k) => (suzgec === "tumu" || k.kategori === suzgec) && (!q || k.ad.toLocaleLowerCase("tr-TR").includes(q)))
      .slice().sort((a, b) => Number(bagli.has(b.kod)) - Number(bagli.has(a.kod)) || Number(a.durum === "yakinda") - Number(b.durum === "yakinda"));
  }, [arama, suzgec, kayitlar]);
  const kategoriler = (Object.keys(ENTEGRASYON_KATEGORILERI) as EntegrasyonKategorisi[]).filter((k) => ENTEGRASYON_KATALOGU.some((x) => x.kategori === k));

  function ac(k: KatalogKaydi) {
    setHata(""); setMesaj(""); setSinama(null); setAcik(k);
    const b = baglanti(k.kod);
    setVarsayilanCari(b ? cariBaglari.find((x) => x.id === b.id)?.varsayilanAliciCariId ?? "" : "");
    if (k.kategori === "eticaret" && !cariler.length) void tumSayfalariAl<CariSecenegi>("/cari").then(setCariler).catch(() => undefined);
  }

  async function sina(id: string) {
    const test = await api<{ basarili: boolean; mesaj?: string }>(`/baglantilar/${id}/test`, { method: "POST" });
    if (!test.basarili) { setSinama({ basarili: false, mesaj: test.mesaj ?? "Bilgiler eksik" }); return; }
    await api(`/baglantilar/${id}/aktif-et`, { method: "POST" });
    setSinama(await api<{ basarili: boolean; mesaj: string }>(`/pazaryeri/baglantilar/${id}/sina`, { method: "POST" }));
  }

  async function kaydet(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!acik) return;
    const f = new FormData(e.currentTarget);
    const config: Record<string, string> = {};
    for (const a of acik.alanlar ?? []) { const v = String(f.get(a.alan) ?? "").trim(); if (v) config[a.alan] = v; }
    setIsleniyor(true); setHata(""); setSinama(null);
    try {
      const mevcut = baglanti(acik.kod);
      const kayit = mevcut
        ? await api<Baglanti>(`/baglantilar/${mevcut.id}`, { method: "PATCH", body: JSON.stringify({ config }) })
        : await api<Baglanti>("/baglantilar", { method: "POST", body: JSON.stringify({ aile: "pazaryeri", saglayici: acik.kod, config: { kullaniciAdi: "", ...config } }) });
      if (acik.kategori === "eticaret") await api(`/pazaryeri/baglantilar/${kayit.id}/varsayilan-alici`, { method: "POST", body: JSON.stringify({ cariId: varsayilanCari || null }) });
      await sina(kayit.id);
      setMesaj(`${acik.ad} bağlantısı kaydedildi.`);
      await yukle();
    } catch (x) { setHata(x instanceof Error ? x.message : "Bağlantı kaydedilemedi"); } finally { setIsleniyor(false); }
  }

  async function ilgileniyorum(k: KatalogKaydi) {
    try {
      await api("/pazaryeri/entegrasyon-talepleri", { method: "POST", body: JSON.stringify({ saglayici: k.kod }) });
      setTalepler((t) => [...new Set([...t, k.kod])]); setMesaj(`${k.ad} için talebiniz alındı; sıralamayı talepler belirliyor.`);
    } catch (x) { setHata(x instanceof Error ? x.message : "Talep kaydedilemedi"); }
  }

  const aktifSayisi = kayitlar.filter((b) => b.durum === "aktif").length;
  const mevcut = acik ? baglanti(acik.kod) : undefined;

  return <div className="market-page marketplace-settings-page">
    <header className="market-hero"><div><span>ENTEGRASYON MERKEZİ</span><h1>Pazaryeri ve e-ticaret</h1><p>Pazaryeri mağazalarınızı ve kendi e-ticaret sitenizi bağlayın; siparişler otomatik gelsin, stok ve fiyat buradan gitsin.</p></div><div><Button variant="primary" onClick={() => void yukle()}>↻ Yenile</Button></div></header>
    <Alert tone="error">{!acik ? hata : ""}</Alert><Alert tone="success">{!acik ? mesaj : ""}</Alert>
    <section className="market-kpis"><div className="is-lead"><span>Bağlı kanal</span><strong>{kayitlar.length}</strong><small>Tanımlı mağaza</small></div><div className={aktifSayisi ? "is-success" : ""}><span>Aktif</span><strong>{aktifSayisi}</strong><small>Sipariş çekmeye hazır</small></div><div><span>Kullanılabilir</span><strong>{ENTEGRASYON_KATALOGU.filter((k) => k.durum === "etkin").length}</strong><small>Bağlanabilen platform</small></div><div><span>Güvenlik</span><strong>Şifreli</strong><small>Anahtarlar şifreli saklanır</small></div></section>

    <div className="entegrasyon-arac">
      <Input aria-label="Platform ara" placeholder="Platform ara" value={arama} onChange={(e) => setArama(e.target.value)} />
      <div className="entegrasyon-suzgec" role="group" aria-label="Kategori">
        {(["tumu", ...kategoriler] as Suzgec[]).map((k) => <button key={k} type="button" className={suzgec === k ? "is-active" : ""} aria-pressed={suzgec === k} onClick={() => setSuzgec(k)}>{k === "tumu" ? "Tümü" : ENTEGRASYON_KATEGORILERI[k]}</button>)}
      </div>
    </div>

    <div className="entegrasyon-grid">{gorunen.map((k) => {
      const b = baglanti(k.kod);
      const yakinda = k.durum === "yakinda";
      return <article key={k.kod} className={`entegrasyon-kart${b ? " is-bagli" : ""}${yakinda ? " is-yakinda" : ""}`}>
        {b && <span className="entegrasyon-kart__isaret" aria-label={b.durum === "aktif" ? "Bağlı ve aktif" : "Bağlı, sınama bekliyor"}>✓</span>}
        <button type="button" className="entegrasyon-kart__logo" onClick={() => (yakinda ? undefined : ac(k))} disabled={yakinda} aria-label={`${k.ad} ${yakinda ? "(yakında)" : b ? "bağlantısını düzenle" : "bağla"}`}>
          {k.logo ? <img src={`/entegrasyon/${k.logo}`} alt="" /> : <span className="entegrasyon-kart__ad-logo">{k.ad}</span>}
        </button>
        <div className="entegrasyon-kart__alt">
          <div><strong>{k.ad}</strong><small>{ENTEGRASYON_KATEGORILERI[k.kategori]}</small></div>
          {yakinda
            ? (talepler.includes(k.kod) ? <Badge variant="info">Talep alındı</Badge> : <Button size="sm" onClick={() => void ilgileniyorum(k)}>İlgileniyorum</Button>)
            : b ? <Badge variant={b.durum === "aktif" ? "success" : "warning"}>{b.durum === "aktif" ? "Bağlı" : "Sınama bekliyor"}</Badge>
            : <Button size="sm" variant="primary" onClick={() => ac(k)}>Bağla</Button>}
        </div>
        {yakinda && <span className="entegrasyon-kart__yakinda">Yakında</span>}
      </article>;
    })}</div>
    {!gorunen.length && <p className="muted">Aramaya uyan platform yok.</p>}

    <PazaryeriOtomatikCekim yonetici />

    {acik && <div className="market-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setAcik(null); }}>
      <section className="market-drawer marketplace-settings-drawer" role="dialog" aria-modal="true" aria-labelledby="entegrasyon-baslik">
        <header><div><span>{ENTEGRASYON_KATEGORILERI[acik.kategori].toLocaleUpperCase("tr-TR")}</span><h2 id="entegrasyon-baslik">{acik.ad} bağlantısı</h2><p className="muted">{mevcut ? "Gizli alanları boş bırakırsanız kayıtlı değer korunur." : "Bilgiler şifreli saklanır."}</p></div><button type="button" aria-label="Pencereyi kapat" onClick={() => setAcik(null)}>×</button></header>
        <form className="market-settings-form" onSubmit={(e) => void kaydet(e)}>
          {acik.anahtarYeri && <div className="market-info-box"><strong>Anahtarı nereden alırım?</strong><span>{acik.anahtarYeri}</span></div>}
          {hata && <Alert tone="error">{hata}</Alert>}
          {sinama && <Alert tone={sinama.basarili ? "success" : "error"}>{sinama.mesaj}</Alert>}
          <div className="market-settings-grid">
            {(acik.alanlar ?? []).map((a) => <Field key={a.alan} label={`${a.etiket}${a.zorunlu ? " *" : ""}`}>
              {/* Düzenlemede kullanıcı adı ve gizli alanlar boş bırakılırsa sunucu kayıtlı değeri korur. */}
              <Input name={a.alan} type={a.gizli ? "password" : "text"} placeholder={mevcut && (a.gizli || a.alan === "kullaniciAdi") ? "Kayıtlı değer korunur" : a.ipucu} autoComplete="off" required={Boolean(a.zorunlu && !(mevcut && (a.gizli || a.alan === "kullaniciAdi")))} />
            </Field>)}
          </div>
          {acik.kategori === "eticaret" && <Field label="Bireysel alıcıların carisi">
            <CariSecici cariler={cariler} deger={varsayilanCari} onChange={setVarsayilanCari} placeholder="Ör. Perakende Müşteri" />
            <small className="muted">VKN'li alıcı kendi carisine gider (yoksa açılır). Bireysel alıcı bu cariye faturalanır, kişi bilgisi e-Arşiv'e yazılır. Boşsa cari siparişte seçilir. Siteye stok ve KDV dahil satış fiyatı gönderilir.</small>
          </Field>}
          <footer>
            {mevcut && <Button type="button" disabled={isleniyor} onClick={() => { setIsleniyor(true); setSinama(null); void sina(mevcut.id).then(yukle).catch((x) => setHata(x instanceof Error ? x.message : "Sınanamadı")).finally(() => setIsleniyor(false)); }}>Sına</Button>}
            <Button type="button" onClick={() => setAcik(null)}>Kapat</Button>
            <Button type="submit" variant="primary" disabled={isleniyor}>{isleniyor ? "Kaydediliyor…" : "Kaydet ve sına"}</Button>
          </footer>
        </form>
      </section>
    </div>}
  </div>;
}
