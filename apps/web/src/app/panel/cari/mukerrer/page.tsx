"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Modal, PageHeader, Segmented, TableWrap } from "@/components/ui";

type Tur = "ayni_kimlik" | "kimlik_farkli_unvan" | "unvan" | "iban" | "farkli_rol";
interface Kart {
  id: string; kod: string; unvan: string; tip: string; aktif: boolean; karaListe: boolean; dovizCinsi: string; vknTckn: string | null; personel: boolean;
  bakiyeTry: string; hareketSayisi: number; faturaSayisi: number; sonHareket: string | null;
}
interface Grup { tur: Tur; nedenler: string[]; birlestirilebilir: boolean; kartlar: Kart[] }
interface Rapor { gruplar: Grup[]; istisnaSayisi: number }
interface Istisna { id: string; a: { kod: string; unvan: string } | null; b: { kod: string; unvan: string } | null; tarih: string }
interface TasinanOnizleme { cari: { id: string; kod: string; unvan: string }; engeller: string[]; uyarilar: string[]; kayitlar: { ad: string; adet: number }[]; doldurulacaklar: string[] }
interface Onizleme { ana: { kod: string; unvan: string }; anaEngelleri: string[]; tasinanlar: TasinanOnizleme[]; birlestirilebilir: boolean }

const TUR: Record<Tur, { ad: string; rozet: "danger" | "warning" | "info" | "neutral" }> = {
  ayni_kimlik: { ad: "Aynı VKN/TCKN", rozet: "danger" },
  kimlik_farkli_unvan: { ad: "Aynı kimlik, farklı firma", rozet: "warning" },
  unvan: { ad: "Benzer unvan", rozet: "info" },
  iban: { ad: "Aynı IBAN", rozet: "info" },
  farkli_rol: { ad: "Farklı rol", rozet: "neutral" },
};
const TIP: Record<string, string> = { musteri: "Müşteri", tedarikci: "Tedarikçi", her_ikisi: "Müşteri + tedarikçi", personel: "Personel", ortak: "Ortak", diger: "Diğer" };
type Suzgec = "hepsi" | "kimlik" | "unvan" | "farkli_rol";

const tl = (v: string) => `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
const tarih = (t: string | null) => (t ? new Date(t).toLocaleDateString("tr-TR") : "—");
/** Önerilen ana kart: en çok kaydı olan, eşitlikte etkin olan. */
const anaOner = (g: Grup) => [...g.kartlar].sort((a, b) => (b.hareketSayisi + b.faturaSayisi) - (a.hareketSayisi + a.faturaSayisi) || Number(b.aktif) - Number(a.aktif))[0].id;

/**
 * CARI-56…62: mükerrer cari şüphesi raporu. Yönetici grubu ana karta
 * birleştirebilir ya da "aynı değil" işaretleyebilir; birleştirme geri alınmaz.
 */
export default function MukerrerCariSayfasi() {
  const [rapor, setRapor] = useState<Rapor | null>(null);
  const [yonetici, setYonetici] = useState(false);
  const [suzgec, setSuzgec] = useState<Suzgec>("hepsi");
  const [istisnalar, setIstisnalar] = useState<Istisna[] | null>(null);
  const [birlestirme, setBirlestirme] = useState<{ grup: Grup; ana: string; tasinan: Set<string> } | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    try { setRapor(await api<Rapor>("/cari/mukerrer")); }
    catch (h) { setHata(h instanceof Error ? h.message : "Rapor yüklenemedi"); }
  }, []);

  useEffect(() => {
    void yukle();
    api<{ rol: string }>("/auth/ben").then((ben) => setYonetici(ben.rol === "yonetici")).catch(() => undefined);
  }, [yukle]);

  const gruplar = useMemo(() => (rapor?.gruplar ?? []).filter((g) =>
    suzgec === "hepsi" || (suzgec === "kimlik" ? g.tur === "ayni_kimlik" || g.tur === "kimlik_farkli_unvan" : suzgec === "unvan" ? g.tur === "unvan" || g.tur === "iban" : g.tur === "farkli_rol")), [rapor, suzgec]);
  const sayi = (s: Suzgec) => (rapor?.gruplar ?? []).filter((g) => s === "kimlik" ? g.tur === "ayni_kimlik" || g.tur === "kimlik_farkli_unvan" : s === "unvan" ? g.tur === "unvan" || g.tur === "iban" : g.tur === "farkli_rol").length;

  async function ayniDegil(g: Grup) {
    if (!window.confirm(`${g.kartlar.map((k) => k.kod).join(", ")} kartları "aynı değil" işaretlensin mi? Bu grup raporda bir daha çıkmaz.`)) return;
    setHata(""); setBasari("");
    try {
      await api("/cari/mukerrer/istisnalar", { method: "POST", body: JSON.stringify({ cariIdler: g.kartlar.map((k) => k.id) }) });
      setBasari("İşaretlendi; grup rapordan kaldırıldı.");
      await yukle();
      if (istisnalar) await istisnaYukle();
    } catch (h) { setHata(h instanceof Error ? h.message : "İşaretlenemedi"); }
  }

  async function istisnaYukle() {
    try { setIstisnalar(await api<Istisna[]>("/cari/mukerrer/istisnalar")); }
    catch (h) { setHata(h instanceof Error ? h.message : "İşaretler yüklenemedi"); }
  }

  async function istisnaKaldir(i: Istisna) {
    setHata(""); setBasari("");
    try {
      await api(`/cari/mukerrer/istisnalar/${i.id}`, { method: "DELETE" });
      setBasari("İşaret kaldırıldı; çift yeniden şüpheliyse raporda görünür.");
      await Promise.all([istisnaYukle(), yukle()]);
    } catch (h) { setHata(h instanceof Error ? h.message : "İşaret kaldırılamadı"); }
  }

  return (
    <div>
      <PageHeader
        title="👥 Mükerrer Cari Kartlar"
        subtitle="Aynı VKN/TCKN, benzer unvan ya da aynı IBAN taşıyan kartlar. Ana kart seçilip öbürleri ona birleştirilir; bakiye ve geçmiş tek kartta toplanır."
        actions={<ButtonLabel as="a" href="/panel/cari">← Cari Hesaplar</ButtonLabel>}
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <div className="mukerrer__ust">
        <Segmented<Suzgec>
          ariaLabel="Şüphe türü"
          value={suzgec}
          onChange={setSuzgec}
          items={[
            { deger: "hepsi", baslik: `Tümü (${rapor?.gruplar.length ?? 0})` },
            { deger: "kimlik", baslik: `Aynı kimlik (${sayi("kimlik")})` },
            { deger: "unvan", baslik: `Benzer unvan / IBAN (${sayi("unvan")})` },
            { deger: "farkli_rol", baslik: `Farklı rol (${sayi("farkli_rol")})` },
          ]}
        />
        {rapor && rapor.istisnaSayisi > 0 && (
          <Button size="sm" onClick={() => (istisnalar ? setIstisnalar(null) : void istisnaYukle())}>
            {istisnalar ? "İşaretleri gizle" : `"Aynı değil" işaretleri (${rapor.istisnaSayisi})`}
          </Button>
        )}
      </div>

      {istisnalar && (
        <Card title={`"Aynı değil" işaretli çiftler`}>
          {istisnalar.length === 0 ? <p className="subtle">İşaret yok.</p> : (
            <TableWrap>
              <thead><tr><th>Kart</th><th>Kart</th><th>İşaret tarihi</th>{yonetici && <th />}</tr></thead>
              <tbody>
                {istisnalar.map((i) => (
                  <tr key={i.id}>
                    <td>{i.a ? `${i.a.kod} ${i.a.unvan}` : "—"}</td>
                    <td>{i.b ? `${i.b.kod} ${i.b.unvan}` : "—"}</td>
                    <td>{tarih(i.tarih)}</td>
                    {yonetici && <td><Button size="sm" onClick={() => void istisnaKaldir(i)}>Kaldır</Button></td>}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}

      {rapor === null ? <Card><p className="subtle">Yükleniyor…</p></Card>
        : gruplar.length === 0 ? <Card><p className="subtle">{rapor.gruplar.length ? "Bu süzgeçte şüpheli kart yok." : "Mükerrer şüphesi olan kart bulunmadı."}</p></Card>
        : gruplar.map((g) => (
          <Card key={g.kartlar.map((k) => k.id).join("|")} className="mukerrer__grup">
            <div className="mukerrer__bas">
              <div>
                <Badge variant={TUR[g.tur].rozet}>{TUR[g.tur].ad}</Badge>
                <ul className="mukerrer__nedenler">{g.nedenler.map((n) => <li key={n}>{n}</li>)}</ul>
              </div>
              {yonetici && (
                <div className="row-tight">
                  {g.birlestirilebilir && <Button size="sm" variant="primary" onClick={() => { const ana = anaOner(g); setBirlestirme({ grup: g, ana, tasinan: new Set(g.kartlar.filter((k) => k.id !== ana).map((k) => k.id)) }); }}>Birleştir…</Button>}
                  <Button size="sm" onClick={() => void ayniDegil(g)}>Aynı değil</Button>
                </div>
              )}
            </div>
            <TableWrap>
              <thead>
                <tr><th>Cari</th><th>Tür</th><th>VKN/TCKN</th><th className="num">Bakiye</th><th className="num">Hareket</th><th className="num">Fatura</th><th>Son hareket</th></tr>
              </thead>
              <tbody>
                {g.kartlar.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <a href={`/panel/cari/${k.id}`}><strong>{k.unvan}</strong></a>
                      <div className="subtle">{k.kod}{!k.aktif && <> · <Badge variant="warning">Pasif</Badge></>}{k.karaListe && <> · <Badge variant="danger">Bloke</Badge></>}</div>
                    </td>
                    <td>{TIP[k.tip] ?? k.tip}</td>
                    <td>{k.vknTckn ?? "—"}</td>
                    <td className={`num money ${Number(k.bakiyeTry) > 0 ? "pos" : Number(k.bakiyeTry) < 0 ? "neg" : ""}`}>{tl(k.bakiyeTry)}</td>
                    <td className="num">{k.hareketSayisi}</td>
                    <td className="num">{k.faturaSayisi}</td>
                    <td>{tarih(k.sonHareket)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        ))}

      {birlestirme && (
        <BirlestirmePenceresi
          durum={birlestirme}
          degistir={setBirlestirme}
          kapat={() => setBirlestirme(null)}
          bitti={async (mesaj) => { setBirlestirme(null); setHata(""); setBasari(mesaj); await yukle(); }}
        />
      )}
    </div>
  );
}

function BirlestirmePenceresi({ durum, degistir, kapat, bitti }: {
  durum: { grup: Grup; ana: string; tasinan: Set<string> };
  degistir: (d: { grup: Grup; ana: string; tasinan: Set<string> }) => void;
  kapat: () => void;
  bitti: (mesaj: string) => Promise<void>;
}) {
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [onay, setOnay] = useState(false);
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const tasinanlar = useMemo(() => [...durum.tasinan].filter((id) => id !== durum.ana), [durum]);

  useEffect(() => {
    setOnizleme(null); setOnay(false); setHata("");
    if (!tasinanlar.length) return;
    let iptal = false;
    api<Onizleme>(`/cari/mukerrer/onizleme?${new URLSearchParams({ ana: durum.ana, tasinan: tasinanlar.join(",") })}`)
      .then((o) => { if (!iptal) setOnizleme(o); })
      .catch((h) => { if (!iptal) setHata(h instanceof Error ? h.message : "Önizleme alınamadı"); });
    return () => { iptal = true; };
  }, [durum.ana, tasinanlar]);

  function anaSec(id: string) {
    const tasinan = new Set(durum.grup.kartlar.map((k) => k.id).filter((k) => k !== id && (durum.tasinan.has(k) || k === durum.ana)));
    degistir({ ...durum, ana: id, tasinan });
  }
  function tasinanDegistir(id: string, secili: boolean) {
    const tasinan = new Set(durum.tasinan);
    if (secili) tasinan.add(id); else tasinan.delete(id);
    degistir({ ...durum, tasinan });
  }

  async function birlestir(e: React.FormEvent) {
    e.preventDefault();
    setIsleniyor(true); setHata("");
    try {
      const s = await api<{ sonuclar: { cari: { kod: string }; tasinanKayit: number }[] }>("/cari/mukerrer/birlestir", { method: "POST", body: JSON.stringify({ anaCariId: durum.ana, tasinanCariIdler: tasinanlar }) });
      const ana = durum.grup.kartlar.find((k) => k.id === durum.ana)!;
      await bitti(`${s.sonuclar.map((x) => x.cari.kod).join(", ")} → ${ana.kod} kartına birleştirildi (${s.sonuclar.reduce((t, x) => t + x.tasinanKayit, 0)} kayıt taşındı).`);
    } catch (h) { setHata(h instanceof Error ? h.message : "Birleştirilemedi"); }
    finally { setIsleniyor(false); }
  }

  return (
    <Modal genis baslik="Kartları birleştir" aciklama="Seçilen kartların bütün kayıtları ana karta taşınır; taşınan kartlar pasif kalır ve ana karta yönlendirir. Birleştirme geri alınamaz." onKapat={kapat}>
      <form onSubmit={birlestir}>
        <TableWrap>
          <thead><tr><th>Ana kart</th><th>Taşınacak</th><th>Cari</th><th className="num">Hareket</th><th className="num">Fatura</th></tr></thead>
          <tbody>
            {durum.grup.kartlar.map((k) => (
              <tr key={k.id}>
                <td><input type="radio" name="ana" aria-label={`${k.kod} ana kart`} checked={durum.ana === k.id} onChange={() => anaSec(k.id)} /></td>
                <td><input type="checkbox" aria-label={`${k.kod} taşınsın`} disabled={durum.ana === k.id} checked={durum.ana !== k.id && durum.tasinan.has(k.id)} onChange={(e) => tasinanDegistir(k.id, e.target.checked)} /></td>
                <td><strong>{k.kod}</strong> {k.unvan}{!k.aktif && <> · <Badge variant="warning">Pasif</Badge></>}</td>
                <td className="num">{k.hareketSayisi}</td>
                <td className="num">{k.faturaSayisi}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>

        <Alert tone="error">{hata}</Alert>
        {!tasinanlar.length ? <p className="subtle">Taşınacak en az bir kart seçin.</p> : !onizleme ? (!hata && <p className="subtle">Önizleme hazırlanıyor…</p>) : (
          <div className="mukerrer__onizleme">
            {onizleme.anaEngelleri.map((m) => <Alert key={m} tone="error">{m}</Alert>)}
            {onizleme.tasinanlar.map((t) => (
              <div key={t.cari.id} className="mukerrer__tasinan">
                <strong>{t.cari.kod} {t.cari.unvan} → {onizleme.ana.kod}</strong>
                {t.engeller.map((m) => <Alert key={m} tone="error">Birleştirilemez: {m}</Alert>)}
                {t.uyarilar.map((m) => <Alert key={m} tone="warning">{m}</Alert>)}
                <div className="subtle">
                  {t.kayitlar.length ? `Taşınacak: ${t.kayitlar.map((x) => `${x.adet} ${x.ad.toLocaleLowerCase("tr-TR")}`).join(", ")}` : "Bağlı kayıt yok."}
                  {t.doldurulacaklar.length > 0 && <> · Ana kartta boş olup bu karttan dolacak: {t.doldurulacaklar.join(", ")}</>}
                </div>
              </div>
            ))}
          </div>
        )}

        <label className="mukerrer__onay">
          <input type="checkbox" checked={onay} onChange={(e) => setOnay(e.target.checked)} disabled={!onizleme?.birlestirilebilir} />
          Birleştirmenin geri alınamayacağını biliyorum.
        </label>
        <div className="row-tight" style={{ justifyContent: "flex-end" }}>
          <Button type="button" onClick={kapat}>Vazgeç</Button>
          <Button type="submit" variant="danger" disabled={isleniyor || !onay || !onizleme?.birlestirilebilir}>{isleniyor ? "Birleştiriliyor…" : "Birleştir"}</Button>
        </div>
      </form>
    </Modal>
  );
}
