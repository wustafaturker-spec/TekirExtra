"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { api, apiDosyaIndir } from "@/lib/api";
import { Alert, Button, Field, Input, Select } from "@/components/ui";

interface DovizBakiyesi { dovizCinsi: string; bakiye: string }
interface Talep {
  firma: string;
  cari: string;
  mutabakatTarihi: string;
  baslangicTarihi: string | null;
  sonYanitTarihi: string;
  bakiyeler: DovizBakiyesi[];
  cumle: string;
  durum: "goruldu" | "mutabik" | "itiraz" | "suresi_doldu";
  yanit: { tur: "mutabik" | "itiraz"; ad: string; gorev: string; tarih: string; aciklama: string | null; karsiBakiyeler: DovizBakiyesi[] | null; ekDosyaAdi: string | null } | null;
}
interface KarsiSatir { dovizCinsi: string; tutar: string; yon: "borcluyuz" | "alacakliyiz" | "sifir" }

const trTarih = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");
const para = (v: string | number) => Math.abs(Number(v)).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const birim = (d: string) => (d === "TRY" ? "TL" : d);
const EK_EN_BUYUK = 5 * 1024 * 1024;

/**
 * CARI-42: karşı tarafın girişsiz mutabakat sayfası. Bağlantı e-postayla
 * gelir; sayfa talep anında dondurulan bakiyeyi ve ekstreyi gösterir, tek
 * yanıt alır (mutabık ya da kendi bakiyesiyle itiraz + isteğe bağlı dosya).
 */
export default function MutabakatPortali() {
  const { tenantId, anahtar } = useParams<{ tenantId: string; anahtar: string }>();
  const yol = `/mutabakat/${tenantId}/${anahtar}`;
  const [talep, setTalep] = useState<Talep | null>(null);
  const [yukHata, setYukHata] = useState("");
  const [secim, setSecim] = useState<"mutabik" | "itiraz" | null>(null);
  const [ad, setAd] = useState("");
  const [gorev, setGorev] = useState("");
  const [eposta, setEposta] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [karsi, setKarsi] = useState<KarsiSatir[]>([]);
  const [ek, setEk] = useState<File | null>(null);
  const [hata, setHata] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [tamam, setTamam] = useState("");

  async function yukle() {
    try {
      const veri = await api<Talep>(yol);
      setTalep(veri);
      const dovizler = veri.bakiyeler.filter((b) => Math.abs(Number(b.bakiye)) >= 0.005);
      setKarsi((dovizler.length ? dovizler : [{ dovizCinsi: "TRY", bakiye: "0" }]).map((b) => ({ dovizCinsi: b.dovizCinsi, tutar: "", yon: Number(b.bakiye) < 0 ? "alacakliyiz" : "borcluyuz" })));
    } catch (h) {
      setYukHata(h instanceof Error ? h.message : "Mutabakat açılamadı");
    }
  }

  useEffect(() => { void yukle(); /* yalnız ilk açılışta */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yol]);

  async function gonder(e: FormEvent) {
    e.preventDefault();
    if (!secim) return;
    if (ek && ek.size > EK_EN_BUYUK) { setHata("Dosya en çok 5 MB olabilir"); return; }
    setHata(""); setGonderiliyor(true);
    try {
      const form = new FormData();
      form.set("yanit", secim);
      form.set("ad", ad); form.set("gorev", gorev); form.set("eposta", eposta); form.set("aciklama", aciklama);
      if (secim === "itiraz") {
        form.set("karsiBakiyeler", JSON.stringify(karsi.map((k) => ({ ...k, tutar: k.yon === "sifir" ? "0" : k.tutar.replace(/\./g, "").replace(",", ".") || "0" }))));
        if (ek) form.set("ek", ek);
      }
      const sonuc = await api<{ mesaj: string }>(`${yol}/yanit`, { method: "POST", body: form });
      setTamam(sonuc.mesaj);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Yanıt gönderilemedi");
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <main className="mutabakat-portal">
      <div className="auth-brand"><span className="sidebar__brand-mark">TE</span>Tekir<b>Extra</b></div>
      {yukHata && <div className="card card--pad"><Alert tone="error">{yukHata}</Alert></div>}
      {!talep && !yukHata && <p className="muted">Yükleniyor…</p>}
      {talep && (
        <div className="card card--pad mutabakat-portal__kart">
          <p className="subtle">{talep.firma}</p>
          <h1 className="mutabakat-portal__baslik">Cari hesap mutabakatı</h1>
          <p>Sayın <strong>{talep.cari}</strong>,</p>
          <p className="mutabakat-portal__cumle">{talep.cumle}</p>
          <table className="mutabakat-portal__tablo">
            <thead><tr><th>Döviz</th><th className="num">Bakiye</th><th>Yön</th></tr></thead>
            <tbody>
              {(talep.bakiyeler.length ? talep.bakiyeler : [{ dovizCinsi: "TRY", bakiye: "0" }]).map((b) => (
                <tr key={b.dovizCinsi}>
                  <td>{birim(b.dovizCinsi)}</td>
                  <td className="num"><strong>{para(b.bakiye)}</strong></td>
                  <td>{Number(b.bakiye) > 0.004 ? "Bize borçlusunuz" : Number(b.bakiye) < -0.004 ? "Bizden alacaklısınız" : "Bakiye yok"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <Button type="button" onClick={() => void apiDosyaIndir(`${yol}/ekstre`, `ekstre-${talep.mutabakatTarihi}.pdf`).catch((h) => setHata(h instanceof Error ? h.message : "Ekstre indirilemedi"))}>📄 Hesap ekstresini indir (PDF)</Button>
          </p>

          {tamam && <Alert tone="success">{tamam}</Alert>}

          {talep.yanit ? (
            <div className={`mutabakat-portal__yanit ${talep.yanit.tur === "itiraz" ? "is-itiraz" : ""}`}>
              <strong>{talep.yanit.tur === "mutabik" ? "✅ Mutabık olduğunuz kaydedildi" : "⚠️ İtirazınız kaydedildi"}</strong>
              <div className="subtle">{talep.yanit.ad} ({talep.yanit.gorev}) · {new Date(talep.yanit.tarih).toLocaleString("tr-TR")}</div>
              {talep.yanit.karsiBakiyeler && <div>Bildirdiğiniz bakiye: {talep.yanit.karsiBakiyeler.map((b) => `${para(b.bakiye)} ${birim(b.dovizCinsi)} ${Number(b.bakiye) > 0 ? "borcunuz" : Number(b.bakiye) < 0 ? "alacağınız" : ""}`).join(", ")}</div>}
              {talep.yanit.aciklama && <div>Açıklama: {talep.yanit.aciklama}</div>}
              {talep.yanit.ekDosyaAdi && <div>Ek: {talep.yanit.ekDosyaAdi}</div>}
              <p className="subtle">Değişiklik gerekiyorsa {talep.firma} ile iletişime geçin.</p>
            </div>
          ) : talep.durum === "suresi_doldu" ? (
            <Alert tone="warning">Yanıt süresi {trTarih(talep.sonYanitTarihi)} tarihinde doldu. Lütfen {talep.firma} ile iletişime geçin.</Alert>
          ) : (
            <form onSubmit={gonder} className="mutabakat-portal__form">
              <p><strong>{trTarih(talep.sonYanitTarihi)}</strong> tarihine kadar yanıtlayın:</p>
              <div className="mutabakat-portal__secim" role="radiogroup" aria-label="Yanıtınız">
                <button type="button" role="radio" aria-checked={secim === "mutabik"} className={secim === "mutabik" ? "is-secili" : ""} onClick={() => setSecim("mutabik")}>✅ Bakiyeye mutabıkız</button>
                <button type="button" role="radio" aria-checked={secim === "itiraz"} className={secim === "itiraz" ? "is-secili is-itiraz" : ""} onClick={() => setSecim("itiraz")}>⚠️ Mutabık değiliz</button>
              </div>

              {secim === "itiraz" && (
                <>
                  <p className="subtle">Kendi kayıtlarınızdaki {trTarih(talep.mutabakatTarihi)} tarihli bakiyeyi girin:</p>
                  {karsi.map((k, i) => (
                    <div key={i} className="mutabakat-portal__satir">
                      <Field label="Döviz"><Input value={birim(k.dovizCinsi)} readOnly /></Field>
                      <Field label="Tutar"><Input inputMode="decimal" required={k.yon !== "sifir"} disabled={k.yon === "sifir"} value={k.tutar} placeholder="0,00" onChange={(e) => setKarsi(karsi.map((x, j) => (j === i ? { ...x, tutar: e.target.value } : x)))} /></Field>
                      <Field label="Durum">
                        <Select value={k.yon} onChange={(e) => setKarsi(karsi.map((x, j) => (j === i ? { ...x, yon: e.target.value as KarsiSatir["yon"] } : x)))}>
                          <option value="borcluyuz">{talep.firma.slice(0, 30)} firmasına borçluyuz</option>
                          <option value="alacakliyiz">{talep.firma.slice(0, 30)} firmasından alacaklıyız</option>
                          <option value="sifir">Bakiye yok</option>
                        </Select>
                      </Field>
                    </div>
                  ))}
                  <Field label="İtirazın nedeni (zorunlu)" htmlFor="mutabakat-aciklama">
                    <textarea id="mutabakat-aciklama" className="textarea" rows={3} required minLength={5} maxLength={2000} value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Örn. 15.09 tarihli 12.000 TL ödememiz ekstrede görünmüyor" />
                  </Field>
                  <Field label="Hesap dökümünüz (isteğe bağlı; PDF, Excel ya da CSV, en çok 5 MB)" htmlFor="mutabakat-ek">
                    <input id="mutabakat-ek" type="file" accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" onChange={(e) => setEk(e.target.files?.[0] ?? null)} />
                  </Field>
                </>
              )}

              {secim && (
                <>
                  <div className="mutabakat-portal__satir">
                    <Field label="Adınız soyadınız"><Input required minLength={2} maxLength={120} value={ad} onChange={(e) => setAd(e.target.value)} autoComplete="name" /></Field>
                    <Field label="Göreviniz"><Input required minLength={2} maxLength={120} value={gorev} onChange={(e) => setGorev(e.target.value)} placeholder="Örn. Muhasebe müdürü" /></Field>
                    <Field label="E-posta (isteğe bağlı)"><Input type="email" value={eposta} onChange={(e) => setEposta(e.target.value)} autoComplete="email" /></Field>
                  </div>
                  {secim === "mutabik" && (
                    <Field label="Not (isteğe bağlı)" htmlFor="mutabakat-not"><textarea id="mutabakat-not" className="textarea" rows={2} maxLength={2000} value={aciklama} onChange={(e) => setAciklama(e.target.value)} /></Field>
                  )}
                  <Alert tone="error">{hata}</Alert>
                  <p className="subtle">Yanıt bir kez verilir; gönderim zamanı ve IP adresiniz kayıt altına alınır.</p>
                  <Button type="submit" variant="primary" disabled={gonderiliyor}>{gonderiliyor ? "Gönderiliyor…" : secim === "mutabik" ? "Mutabakatı onayla" : "İtirazı gönder"}</Button>
                </>
              )}
            </form>
          )}
        </div>
      )}
    </main>
  );
}
