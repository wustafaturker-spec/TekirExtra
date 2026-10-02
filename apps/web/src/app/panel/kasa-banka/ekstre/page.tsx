"use client";

/**
 * Banka ekstresi çalışma alanı (KSB-06).
 *
 * Solda satır listesi, sağda seçilen satırın eşleştirme paneli. Banka hesabı
 * seçilince üstte bakiye mutabakatı görünür: ekstreye göre bakiye, sistemdeki
 * bakiye ve farkın ne kadarının bekleyen/yoksayılan satırlardan geldiği.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import { Alert, Badge, Button, Input, Para, Segmented, Select, Tarih } from "@/components/ui";
import { EkstreYukleme, type BankaHesap } from "./ekstre-yukleme";
import { ESLESME_ADI, EslestirmePaneli, type EkstreSatiri, type PosHesabi } from "./ekstre-panel";

type Suzgec = "beklemede" | "eslesti" | "yoksayildi" | "hepsi";

interface Mutabakat {
  bakiyeSutunuVar: boolean;
  son: { tarih: string; banka: string; sistem: string; fark: string; bekleyen: string; yoksayilan: string } | null;
  farkBaslangici: string | null;
  acilisBakiyesiEksikOlabilir: boolean;
  aciklanmayanFark: string;
}

interface KuralSatiri {
  id: string;
  anahtar: string;
  yon: "giris" | "cikis";
  eslesmeTuru: keyof typeof ESLESME_ADI;
  aktif: boolean;
  kullanimSayisi: number;
  hesapAdi: string | null;
  hedefAdi: string | null;
}

export default function EkstreSayfasi() {
  const [hesaplar, setHesaplar] = useState<BankaHesap[]>([]);
  const [posHesaplari, setPosHesaplari] = useState<PosHesabi[]>([]);
  const [cariler, setCariler] = useState<Array<{ id: string; unvan: string }>>([]);
  const [satirlar, setSatirlar] = useState<EkstreSatiri[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [seciliId, setSeciliId] = useState<string | null>(null);
  const [suzgec, setSuzgec] = useState<Suzgec>("beklemede");
  const [bankaFiltresi, setBankaFiltresi] = useState("");
  const [yonFiltresi, setYonFiltresi] = useState<"" | "tahsilat" | "tediye">("");
  const [arama, setArama] = useState("");
  const [baslangic, setBaslangic] = useState("");
  const [bitis, setBitis] = useState("");
  const [mutabakat, setMutabakat] = useState<Mutabakat | null>(null);
  const [yuklemeAcik, setYuklemeAcik] = useState(false);
  const [kurallarAcik, setKurallarAcik] = useState(false);
  const [kurallar, setKurallar] = useState<KuralSatiri[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const listeRef = useRef<HTMLDivElement>(null);

  const listeYukle = useCallback(async () => {
    const qs = new URLSearchParams();
    if (suzgec !== "hepsi") qs.set("durum", suzgec);
    if (bankaFiltresi) qs.set("bankaHesapId", bankaFiltresi);
    if (yonFiltresi) qs.set("yon", yonFiltresi);
    if (arama.trim()) qs.set("arama", arama.trim());
    if (baslangic) qs.set("baslangic", baslangic);
    if (bitis) qs.set("bitis", bitis);
    try {
      const liste = await api<EkstreSatiri[]>(`/kasa-banka/ekstre/satirlar?${qs}`);
      setSatirlar(liste);
      setSeciliId((onceki) => (onceki && liste.some((s) => s.id === onceki) ? onceki : liste[0]?.id ?? null));
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Ekstre satırları yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [suzgec, bankaFiltresi, yonFiltresi, arama, baslangic, bitis]);

  const mutabakatYukle = useCallback(async () => {
    if (!bankaFiltresi) { setMutabakat(null); return; }
    try {
      setMutabakat(await api<Mutabakat>(`/kasa-banka/ekstre/mutabakat/${bankaFiltresi}`));
    } catch {
      setMutabakat(null);
    }
  }, [bankaFiltresi]);

  useEffect(() => {
    if (!tokenAl()) return;
    const zamanlayici = setTimeout(() => void listeYukle(), arama ? 250 : 0);
    return () => clearTimeout(zamanlayici);
  }, [listeYukle, arama]);
  useEffect(() => { if (tokenAl()) void mutabakatYukle(); }, [mutabakatYukle]);
  useEffect(() => {
    if (!tokenAl()) return;
    void Promise.all([api<BankaHesap[]>("/kasa-banka/bankalar"), api<PosHesabi[]>("/kasa-banka/pos-hesaplari"), tumSayfalariAl<{ id: string; unvan: string }>("/cari")])
      .then(([b, p, c]) => { setHesaplar(b); setPosHesaplari(p); setCariler(c); })
      .catch(() => undefined);
  }, []);

  const secili = satirlar.find((s) => s.id === seciliId) ?? null;
  const ozet = useMemo(() => ({
    bekleyen: satirlar.filter((s) => s.durum === "beklemede").length,
    kuralli: satirlar.filter((s) => s.durum === "beklemede" && s.kuralOnerisi).length,
  }), [satirlar]);

  /** İşlemden sonra listeyi tazeler ve sıradaki bekleyen satıra geçer. */
  async function islemSonrasi(mesaj: string) {
    setBasari(mesaj);
    setHata("");
    const sira = satirlar.findIndex((s) => s.id === seciliId);
    const sonraki = satirlar.slice(sira + 1).find((s) => s.durum === "beklemede") ?? satirlar.slice(0, Math.max(sira, 0)).find((s) => s.durum === "beklemede");
    if (sonraki) setSeciliId(sonraki.id);
    await Promise.all([listeYukle(), mutabakatYukle()]);
  }

  function klavye(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = satirlar.findIndex((s) => s.id === seciliId);
    const yeni = satirlar[Math.min(Math.max(i + (e.key === "ArrowDown" ? 1 : -1), 0), satirlar.length - 1)];
    if (yeni) {
      setSeciliId(yeni.id);
      listeRef.current?.querySelector<HTMLElement>(`[data-satir="${yeni.id}"]`)?.focus();
    }
  }

  async function kurallariAc() {
    setKurallarAcik(true);
    try { setKurallar(await api<KuralSatiri[]>("/kasa-banka/ekstre/kurallar")); } catch (e) { setHata(e instanceof Error ? e.message : "Kurallar yüklenemedi"); }
  }

  async function kuralDegistir(k: KuralSatiri, islem: "aktif" | "sil") {
    try {
      if (islem === "sil") await api(`/kasa-banka/ekstre/kurallar/${k.id}`, { method: "DELETE" });
      else await api(`/kasa-banka/ekstre/kurallar/${k.id}`, { method: "PATCH", body: JSON.stringify({ aktif: !k.aktif }) });
      setKurallar(await api<KuralSatiri[]>("/kasa-banka/ekstre/kurallar"));
      await listeYukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Kural güncellenemedi");
    }
  }

  const seciliHesap = hesaplar.find((h) => h.id === bankaFiltresi);
  const fark = mutabakat?.son ? Number(mutabakat.son.fark) : 0;

  return (
    <div className="statement-page">
      <section className="statement-hero">
        <div>
          <span>BANKA MUTABAKAT MERKEZİ</span>
          <h1>Banka ekstresi çalışma alanı</h1>
          <p>Ekstreleri içeri alın; her satırı cari, fatura, masraf, gelir, virman, çek ya da kart ödemesiyle eşleştirin. Banka bakiyesiyle sistem bakiyesi aynı kalsın.</p>
        </div>
        <div>
          <Button onClick={() => void kurallariAc()}>Kurallar</Button>
          <Button variant="primary" onClick={() => setYuklemeAcik(true)}>Ekstre yükle</Button>
        </div>
      </section>

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {yuklemeAcik && (
        <EkstreYukleme
          hesaplar={hesaplar}
          varsayilanHesap={bankaFiltresi}
          onKapat={() => setYuklemeAcik(false)}
          onYuklendi={async (mesaj, hesapId) => {
            setYuklemeAcik(false);
            setBasari(mesaj);
            setSuzgec("beklemede");
            setBankaFiltresi(hesapId);
          }}
        />
      )}

      <div className="statement-toolbar">
        <Select aria-label="Banka hesabı" value={bankaFiltresi} onChange={(e) => setBankaFiltresi(e.target.value)}>
          <option value="">Tüm banka hesapları</option>
          {hesaplar.map((h) => <option key={h.id} value={h.id}>{h.ad} · {h.dovizCinsi}</option>)}
        </Select>
        <Segmented<Suzgec>
          ariaLabel="Satır durumu"
          value={suzgec}
          onChange={setSuzgec}
          items={[
            { deger: "beklemede", baslik: `Bekleyen${suzgec === "beklemede" && ozet.bekleyen ? ` (${ozet.bekleyen})` : ""}` },
            { deger: "eslesti", baslik: "Eşleşen" },
            { deger: "yoksayildi", baslik: "Yoksayılan" },
            { deger: "hepsi", baslik: "Tümü" },
          ]}
        />
        <Select aria-label="Hareket yönü" value={yonFiltresi} onChange={(e) => setYonFiltresi(e.target.value as typeof yonFiltresi)}>
          <option value="">Giriş ve çıkış</option>
          <option value="tahsilat">Yalnız girişler</option>
          <option value="tediye">Yalnız çıkışlar</option>
        </Select>
        <Input aria-label="Ekstre ara" value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Açıklama, dekont, IBAN, cari…" />
        <Input aria-label="Başlangıç tarihi" type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} />
        <Input aria-label="Bitiş tarihi" type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} />
      </div>

      {seciliHesap && mutabakat && (
        <section className={`reconcile${!mutabakat.son ? "" : fark === 0 ? " is-ok" : " is-off"}`} aria-label="Bakiye mutabakatı">
          {!mutabakat.bakiyeSutunuVar || !mutabakat.son ? (
            <p>Bu hesabın ekstrelerinde bakiye sütunu yok. Mutabakat için yüklemede <strong>Bakiye</strong> sütununu eşleyin.</p>
          ) : (
            <>
              <div><span>Bankaya göre bakiye</span><strong><Para deger={mutabakat.son.banka} dovizCinsi={seciliHesap.dovizCinsi} /></strong><small><Tarih deger={mutabakat.son.tarih} /> gün sonu</small></div>
              <div><span>Sistemdeki bakiye</span><strong><Para deger={mutabakat.son.sistem} dovizCinsi={seciliHesap.dovizCinsi} /></strong><small>aynı gün sonu</small></div>
              <div className="reconcile__diff">
                <span>Fark</span>
                <strong><Para deger={mutabakat.son.fark} dovizCinsi={seciliHesap.dovizCinsi} /></strong>
                <small>{fark === 0 ? "Hesap mutabık" : mutabakat.farkBaslangici ? <>ilk kez <Tarih deger={mutabakat.farkBaslangici} /> günü açıldı</> : "fark ilk günden beri var"}</small>
              </div>
              {fark !== 0 && (
                <div className="reconcile__why">
                  <span>Farkın kaynağı</span>
                  <ul>
                    {Number(mutabakat.son.bekleyen) !== 0 && <li>Onay bekleyen satırlar: <Para deger={mutabakat.son.bekleyen} dovizCinsi={seciliHesap.dovizCinsi} /></li>}
                    {Number(mutabakat.son.yoksayilan) !== 0 && <li>Yoksayılan satırlar: <Para deger={mutabakat.son.yoksayilan} dovizCinsi={seciliHesap.dovizCinsi} /></li>}
                    {Number(mutabakat.aciklanmayanFark) !== 0 && <li>Açıklanamayan: <Para deger={mutabakat.aciklanmayanFark} dovizCinsi={seciliHesap.dovizCinsi} />{mutabakat.acilisBakiyesiEksikOlabilir ? " — hesabın açılış bakiyesi girilmemiş olabilir" : " — ekstrede olmayan elle girilmiş fiş olabilir"}</li>}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <div className="statement-workspace">
        <div className="statement-list" ref={listeRef} onKeyDown={klavye} role="listbox" aria-label="Ekstre satırları" aria-activedescendant={seciliId ?? undefined}>
          <header>
            <strong>{satirlar.length} satır</strong>
            {suzgec === "beklemede" && ozet.kuralli > 0 && <Badge variant="info">{ozet.kuralli} satırda kural önerisi var</Badge>}
          </header>
          {yukleniyor && <p className="statement-list__empty">Satırlar yükleniyor…</p>}
          {!yukleniyor && satirlar.length === 0 && (
            <div className="statement-list__empty">
              {suzgec === "beklemede" ? <><strong>Bekleyen satır yok.</strong><span>Yeni ekstre yükleyerek devam edebilirsiniz.</span></> : "Filtreye uyan satır yok."}
            </div>
          )}
          {satirlar.map((s) => {
            const giris = s.yon === "tahsilat";
            return (
              <div
                key={s.id}
                id={s.id}
                data-satir={s.id}
                role="option"
                aria-selected={s.id === seciliId}
                tabIndex={0}
                className={`statement-row${s.id === seciliId ? " is-selected" : ""}`}
                onClick={() => setSeciliId(s.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSeciliId(s.id); } }}
              >
                <span className="statement-row__date"><Tarih deger={s.tarih} /></span>
                <span className="statement-row__text">
                  <strong>{s.aciklama}</strong>
                  <small>
                    {!bankaFiltresi && `${s.bankaHesap.ad} · `}
                    {s.durum === "eslesti" && s.eslesmeTuru ? ESLESME_ADI[s.eslesmeTuru] + (s.hareketler[0]?.cari ? ` · ${s.hareketler[0].cari.unvan}` : s.hareketler[0]?.kategori ? ` · ${s.hareketler[0].kategori}` : "")
                      : s.durum === "yoksayildi" ? "Yoksayıldı"
                      : s.kuralOnerisi ? `Kural önerisi: ${ESLESME_ADI[s.kuralOnerisi.eslesmeTuru]}`
                      : s.karsiUnvan ?? "Onay bekliyor"}
                  </small>
                </span>
                <span className={`statement-row__amount ${giris ? "is-in" : "is-out"}`}>
                  {giris ? "+" : "−"}<Para deger={Math.abs(Number(s.tutar))} dovizCinsi={s.bankaHesap.dovizCinsi} />
                </span>
                <span className={`statement-row__dot is-${s.durum}${s.durum === "beklemede" && s.kuralOnerisi ? " has-rule" : ""}`} aria-hidden="true" />
              </div>
            );
          })}
        </div>

        {secili ? (
          <EslestirmePaneli satir={secili} cariler={cariler} posHesaplari={posHesaplari} onDegisti={(m) => void islemSonrasi(m)} />
        ) : (
          <aside className="match-panel match-panel--empty"><p>Eşleştirmek için soldan bir satır seçin.</p></aside>
        )}
      </div>

      {kurallarAcik && (
        <div className="treasury-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setKurallarAcik(false); }}>
          <section className="treasury-modal" role="dialog" aria-label="Eşleme kuralları">
            <header>
              <div><span>BANKA EKSTRESİ</span><h2>Eşleme kuralları</h2></div>
              <button onClick={() => setKurallarAcik(false)} aria-label="Kapat">×</button>
            </header>
            <div className="rule-list">
              <p className="match-panel__note">Kurallar yalnız öneri üretir; satır yine sizin onayınızla işlenir. Eşleştirirken “Benzer satırlar için kural kaydet” ile yeni kural eklenir.</p>
              {kurallar.length === 0 && <p className="statement-list__empty">Henüz kural yok.</p>}
              {kurallar.map((k) => (
                <div key={k.id} className={`rule-list__row${k.aktif ? "" : " is-passive"}`}>
                  <div>
                    <strong>“{k.anahtar}”</strong>
                    <small>{k.yon === "giris" ? "Giriş" : "Çıkış"} → {ESLESME_ADI[k.eslesmeTuru]}{k.hedefAdi ? ` · ${k.hedefAdi}` : ""} · {k.hesapAdi ?? "tüm hesaplar"} · {k.kullanimSayisi} kez kullanıldı</small>
                  </div>
                  <div className="row-tight">
                    <Button size="sm" onClick={() => void kuralDegistir(k, "aktif")}>{k.aktif ? "Pasife al" : "Etkinleştir"}</Button>
                    <Button size="sm" variant="danger" onClick={() => void kuralDegistir(k, "sil")}>Sil</Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
