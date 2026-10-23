"use client";

/**
 * MUH-01…07: muhasebe aktarımı. Seçilen dönemin kayıtlarından Tekdüzen
 * yevmiye fişleri üretilir, önizlenir ve mali müşavirin programına Excel/CSV
 * ya da PDF yevmiye dökümü olarak verilir. Hesap kodları, alt hesaplar ve
 * dosya profili aynı ekrandan ayarlanır.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ayBasiTR, bugunTR } from "@tekirextra/shared";
import { api, apiDosyaIndir, tokenAl } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader, Para, TableWrap, Tabs, TabPanel, Tarih } from "@/components/ui";
import { HesapPlani } from "./hesap-plani";
import { AltHesaplar } from "./alt-hesaplar";
import { DosyaProfili } from "./dosya-profili";

type Sekme = "fisler" | "hesap-plani" | "alt-hesaplar" | "profil";

interface Kaynak { tur: "fatura" | "hareket" | "masraf" | "gelir" | "cek" | "kart" | "doviz_islem" | "cari_hareket" | "bordro" | "amortisman" | "demirbas"; id: string; etiket: string }
interface Onizleme {
  baslangic: string;
  bitis: string;
  ozet: { fisSayisi: number; satirSayisi: number; borc: string; alacak: string };
  kontroller: Array<{ kaynak: Kaynak; mesaj: string }>;
  fisler: Array<{
    no: number;
    tarih: string;
    tur: "mahsup" | "tahsil" | "tediye";
    aciklama: string;
    belgeNo: string | null;
    kaynak: Kaynak;
    satirlar: Array<{ hesapKodu: string; aciklama: string; borc: string; alacak: string; doviz: { cins: string; tutar: string; kur: string } | null }>;
  }>;
}
interface Aktarim { id: string; baslangic: string; bitis: string; bicim: string; fisSayisi: number; borcToplami: string; zaman: string; kullanici: string | null; degisti: boolean | null }

const KAYNAK_YOLU: Record<Kaynak["tur"], (id: string) => string> = {
  fatura: (id) => `/panel/fatura/yeni?ac=${id}`,
  hareket: () => "/panel/kasa-banka",
  masraf: () => "/panel/masraflar",
  gelir: () => "/panel/gelirler",
  cek: () => "/panel/kasa-banka/cek-senet",
  kart: () => "/panel/kasa-banka/kredi-kartlari",
  doviz_islem: () => "/panel/kasa-banka",
  cari_hareket: () => "/panel/cari",
  bordro: (id) => `/panel/personel/bordrolar/${id}`,
  amortisman: () => "/panel/demirbas/amortisman",
  demirbas: (id) => `/panel/demirbas/${id}`,
};
const FIS_TURU = { mahsup: "Mahsup", tahsil: "Tahsil", tediye: "Tediye" };
const SAYFA = 40;

function gecenAy(): [string, string] {
  const d = new Date();
  const bas = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const son = new Date(d.getFullYear(), d.getMonth(), 0);
  const iso = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  return [iso(bas), iso(son)];
}

export default function MuhasebeAktarimiSayfasi() {
  const [sekme, setSekme] = useState<Sekme>("fisler");
  const [baslangic, setBaslangic] = useState(ayBasiTR());
  const [bitis, setBitis] = useState(bugunTR());
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [aktarimlar, setAktarimlar] = useState<Aktarim[]>([]);
  const [arama, setArama] = useState("");
  const [sayfa, setSayfa] = useState(1);
  const [islem, setIslem] = useState("");
  const [hata, setHata] = useState("");

  const aktarimlariYukle = useCallback(() => {
    void api<Aktarim[]>("/mali-musavir/muhasebe/aktarimlar").then(setAktarimlar).catch(() => setAktarimlar([]));
  }, []);
  useEffect(() => {
    if (tokenAl()) aktarimlariYukle();
  }, [aktarimlariYukle]);

  async function onizle(e?: React.FormEvent) {
    e?.preventDefault();
    setIslem("onizle");
    setHata("");
    try {
      setOnizleme(await api<Onizleme>(`/mali-musavir/muhasebe/onizleme?baslangic=${baslangic}&bitis=${bitis}`));
      setSayfa(1);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Fişler hazırlanamadı");
    } finally {
      setIslem("");
    }
  }

  async function indir(bicim: "xlsx" | "csv" | "pdf") {
    setIslem(bicim);
    setHata("");
    try {
      await apiDosyaIndir(`/mali-musavir/muhasebe/disa-aktar?baslangic=${baslangic}&bitis=${bitis}&bicim=${bicim}`, `muhasebe-fisleri-${baslangic}-${bitis}.${bicim}`);
      aktarimlariYukle();
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Dosya hazırlanamadı");
    } finally {
      setIslem("");
    }
  }

  const suzulmus = useMemo(() => {
    if (!onizleme) return [];
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    if (!q) return onizleme.fisler;
    return onizleme.fisler.filter((f) => `${f.aciklama} ${f.belgeNo ?? ""} ${f.satirlar.map((s) => s.hesapKodu).join(" ")}`.toLocaleLowerCase("tr-TR").includes(q));
  }, [onizleme, arama]);
  const sayfaSayisi = Math.max(1, Math.ceil(suzulmus.length / SAYFA));
  const gorunen = suzulmus.slice((sayfa - 1) * SAYFA, sayfa * SAYFA);
  const dengede = onizleme ? onizleme.ozet.borc === onizleme.ozet.alacak : true;

  return (
    <div className="muh-page">
      <PageHeader
        title="Muhasebe aktarımı"
        subtitle="Dönemin faturaları, kasa-banka hareketleri, çek, kart, masraf ve gelirleri Tekdüzen hesap planına göre yevmiye fişine dönüşür; mali müşavirin programına Excel/CSV olarak verilir."
        actions={<ButtonLabel as="a" href="/panel/mali-musavir">← Mali müşavir portalı</ButtonLabel>}
      />
      <Tabs<Sekme>
        ariaLabel="Muhasebe aktarımı bölümleri"
        idPrefix="muh"
        value={sekme}
        onChange={setSekme}
        items={[
          { deger: "fisler", baslik: "Fişler" },
          { deger: "hesap-plani", baslik: "Hesap planı" },
          { deger: "alt-hesaplar", baslik: "Alt hesaplar" },
          { deger: "profil", baslik: "Dosya profili" },
        ]}
      />
      {hata && <Alert tone="error">{hata}</Alert>}

      {sekme === "fisler" && (
        <TabPanel idPrefix="muh" value="fisler">
          <Card>
            <form className="muh-donem" onSubmit={onizle}>
              <Field label="Başlangıç"><Input type="date" value={baslangic} max={bitis} onChange={(e) => setBaslangic(e.target.value)} /></Field>
              <Field label="Bitiş"><Input type="date" value={bitis} min={baslangic} onChange={(e) => setBitis(e.target.value)} /></Field>
              <div className="muh-hizli">
                <Button type="button" size="sm" onClick={() => { setBaslangic(ayBasiTR()); setBitis(bugunTR()); }}>Bu ay</Button>
                <Button type="button" size="sm" onClick={() => { const [b, s] = gecenAy(); setBaslangic(b); setBitis(s); }}>Geçen ay</Button>
              </div>
              <Button type="submit" variant="primary" disabled={Boolean(islem)}>{islem === "onizle" ? "Hazırlanıyor…" : "Fişleri önizle"}</Button>
            </form>
          </Card>

          {onizleme && (
            <>
              <section className="muh-ozet">
                <div><span>Fiş</span><strong>{onizleme.ozet.fisSayisi.toLocaleString("tr-TR")}</strong><small>{onizleme.ozet.satirSayisi.toLocaleString("tr-TR")} satır</small></div>
                <div><span>Borç toplamı</span><strong><Para deger={onizleme.ozet.borc} dovizCinsi="TRY" /></strong></div>
                <div><span>Alacak toplamı</span><strong><Para deger={onizleme.ozet.alacak} dovizCinsi="TRY" /></strong></div>
                <div className={onizleme.kontroller.length || !dengede ? "is-warning" : "is-ok"}>
                  <span>Kontrol</span>
                  <strong>{onizleme.kontroller.length || !dengede ? `${onizleme.kontroller.length} kayıt` : "Sorun yok"}</strong>
                  <small>{dengede ? "Borç = alacak" : "Borç ve alacak tutmuyor"}</small>
                </div>
              </section>

              {onizleme.kontroller.length > 0 && (
                <Alert tone="warning">
                  <span>
                    Aşağıdaki kayıtların hesap kodu belirlenemedi ya da fişi tutmuyor; aktarım yapılabilir ama mali müşavirin bu satırları elle düzeltmesi gerekir.
                    <ul className="muh-kontrol">
                      {onizleme.kontroller.slice(0, 50).map((k, i) => (
                        <li key={`${k.kaynak.id}-${i}`}><a href={KAYNAK_YOLU[k.kaynak.tur](k.kaynak.id)}>{k.kaynak.etiket}</a> — {k.mesaj}</li>
                      ))}
                    </ul>
                    {onizleme.kontroller.length > 50 && <small>… ve {onizleme.kontroller.length - 50} kayıt daha</small>}
                  </span>
                </Alert>
              )}

              <Card
                pad={false}
                title={<div><span className="muh-ust">YEVMİYE</span><h2>Fişler</h2></div>}
                actions={
                  <div className="muh-indir">
                    <Button size="sm" variant="primary" onClick={() => void indir("xlsx")} disabled={Boolean(islem)}>{islem === "xlsx" ? "Hazırlanıyor…" : "Excel"}</Button>
                    <Button size="sm" onClick={() => void indir("csv")} disabled={Boolean(islem)}>{islem === "csv" ? "Hazırlanıyor…" : "CSV"}</Button>
                    <Button size="sm" onClick={() => void indir("pdf")} disabled={Boolean(islem)}>{islem === "pdf" ? "Hazırlanıyor…" : "PDF yevmiye"}</Button>
                  </div>
                }
              >
                <div className="muh-arama">
                  <Input value={arama} onChange={(e) => { setArama(e.target.value); setSayfa(1); }} placeholder="Açıklama, belge no ya da hesap koduyla ara…" aria-label="Fişlerde ara" />
                </div>
                <TableWrap>
                  <thead>
                    <tr><th>Hesap</th><th>Açıklama</th><th className="num">Borç</th><th className="num">Alacak</th></tr>
                  </thead>
                  {gorunen.map((f) => (
                    <tbody key={f.no} className="muh-fis">
                      <tr className="muh-fis-bas">
                        <td colSpan={4}>
                          <strong>{f.no}</strong> · <Tarih deger={f.tarih} /> · <Badge variant={f.tur === "mahsup" ? "neutral" : f.tur === "tahsil" ? "success" : "danger"}>{FIS_TURU[f.tur]}</Badge> {f.aciklama}
                          <a className="muh-kaynak" href={KAYNAK_YOLU[f.kaynak.tur](f.kaynak.id)}>{f.kaynak.etiket}</a>
                        </td>
                      </tr>
                      {f.satirlar.map((s, i) => (
                        <tr key={i}>
                          <td className="mono">{s.hesapKodu || <Badge variant="danger">kod yok</Badge>}</td>
                          <td>{s.aciklama}{s.doviz && <small className="muh-doviz">{Number(s.doviz.tutar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {s.doviz.cins} × {Number(s.doviz.kur).toLocaleString("tr-TR", { maximumFractionDigits: 6 })}</small>}</td>
                          <td className="num">{Number(s.borc) ? <Para deger={s.borc} dovizCinsi="TRY" /> : ""}</td>
                          <td className="num">{Number(s.alacak) ? <Para deger={s.alacak} dovizCinsi="TRY" /> : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </TableWrap>
                {!suzulmus.length && <p className="muh-bos">{onizleme.fisler.length ? "Aramaya uyan fiş yok." : "Bu dönemde fişe dönüşecek kayıt yok."}</p>}
                {sayfaSayisi > 1 && (
                  <div className="muh-sayfa">
                    <Button size="sm" disabled={sayfa === 1} onClick={() => setSayfa(sayfa - 1)}>← Önceki</Button>
                    <span>{sayfa} / {sayfaSayisi}</span>
                    <Button size="sm" disabled={sayfa === sayfaSayisi} onClick={() => setSayfa(sayfa + 1)}>Sonraki →</Button>
                  </div>
                )}
              </Card>
            </>
          )}

          <Card pad={false} title={<div><span className="muh-ust">GEÇMİŞ</span><h2>Yapılan aktarımlar</h2></div>}>
            <TableWrap>
              <thead><tr><th>Zaman</th><th>Dönem</th><th>Biçim</th><th className="num">Fiş</th><th className="num">Borç toplamı</th><th>Kullanıcı</th><th>Durum</th></tr></thead>
              <tbody>
                {aktarimlar.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.zaman).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td><Tarih deger={a.baslangic} /> – <Tarih deger={a.bitis} /></td>
                    <td>{a.bicim.toUpperCase()}</td>
                    <td className="num">{a.fisSayisi}</td>
                    <td className="num"><Para deger={a.borcToplami} dovizCinsi="TRY" /></td>
                    <td>{a.kullanici ?? "—"}</td>
                    <td>
                      {a.degisti === true ? <span title="Aktarımdan sonra bu dönemde kayıt eklendi, değişti ya da silindi"><Badge variant="warning">Aktarımdan sonra değişti</Badge></span>
                        : a.degisti === false ? <Badge variant="success">Güncel</Badge>
                        : <span className="muted">denetlenmedi</span>}
                    </td>
                  </tr>
                ))}
                {!aktarimlar.length && <tr><td colSpan={7} className="muh-bos">Henüz aktarım yapılmadı.</td></tr>}
              </tbody>
            </TableWrap>
          </Card>
        </TabPanel>
      )}
      {sekme === "hesap-plani" && <TabPanel idPrefix="muh" value="hesap-plani"><HesapPlani /></TabPanel>}
      {sekme === "alt-hesaplar" && <TabPanel idPrefix="muh" value="alt-hesaplar"><AltHesaplar /></TabPanel>}
      {sekme === "profil" && <TabPanel idPrefix="muh" value="profil"><DosyaProfili /></TabPanel>}
    </div>
  );
}
