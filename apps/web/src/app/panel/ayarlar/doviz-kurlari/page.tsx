"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { bugunTR, gunEkleTR } from "@tekirextra/shared";
import { DovizSecenekleri } from "@/components/doviz-secenekleri";
import { DOVIZ_ADLARI, YABANCI_DOVIZLER, type YabanciDoviz } from "@tekirextra/shared";

type Doviz = YabanciDoviz;

interface KurHucresi {
  dovizCinsi: Doviz;
  tcmb: { alis: string; satis: string; kaynak: string; alindiAt: string } | null;
  elle: { alis: string; satis: string; gerekce: string; kullanici: string; guncellendi: string } | null;
  satisFarki: string | null;
}
interface KurGunu { tarih: string; isGunu: boolean; eksik: boolean; kurlar: KurHucresi[] }
interface KurListesi { baslangic: string; bitis: string; geriBakisGun: number; eksikGunler: string[]; gunler: KurGunu[] }
interface KurOlayi { tarih: string; dovizCinsi: Doviz; tur: "girildi" | "degistirildi" | "silindi"; eskiSatis: string | null; yeniSatis: string | null; gerekce: string; kullanici: string; zaman: string }

const bugunIso = () => bugunTR();
const gunOnce = (gun: number) => gunEkleTR(-gun);
const tarihGoster = (iso: string) => iso.split("-").reverse().join(".");
const kur = (deger: string) => Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
const OLAY_ADI: Record<KurOlayi["tur"], string> = { girildi: "Girildi", degistirildi: "Değiştirildi", silindi: "Silindi" };

/** DVZ-06: TCMB gösterge kurları ve firmaya özel elle kurlar. */
export default function DovizKurlariSayfasi() {
  const [baslangic, setBaslangic] = useState(gunOnce(30));
  const [bitis, setBitis] = useState(bugunIso());
  const [liste, setListe] = useState<KurListesi | null>(null);
  const [olaylar, setOlaylar] = useState<KurOlayi[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [calisiyor, setCalisiyor] = useState(false);
  // DVZ-10: tabloda gösterilen dövizler; liste 21 döviz döndürür, tablo seçilenleri çizer.
  const [gosterilen, setGosterilen] = useState<Doviz[]>(["USD", "EUR"]);
  const [form, setForm] = useState({ tarih: bugunIso(), dovizCinsi: "USD" as Doviz, alis: "", satis: "", gerekce: "" });

  const yukle = useCallback(async (bas: string, son: string) => {
    setHata("");
    try {
      const [l, o] = await Promise.all([
        api<KurListesi>(`/doviz-kurlari/liste?baslangic=${bas}&bitis=${son}`),
        api<KurOlayi[]>("/doviz-kurlari/olaylar"),
      ]);
      setListe(l);
      setOlaylar(o);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kurlar yüklenemedi");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) void yukle(baslangic, bitis);
    // Yalnız ilk açılışta; aralık değişince kullanıcı "Listele"ye basar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yukle]);

  async function islem(is: () => Promise<string>) {
    setCalisiyor(true);
    setHata("");
    setBasari("");
    try {
      setBasari(await is());
      await yukle(baslangic, bitis);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem yapılamadı");
    } finally {
      setCalisiyor(false);
    }
  }

  const eksikleriCek = () =>
    islem(async () => {
      const s = await api<{ aday: number; cekilen: number; yayimlanmayan: string[] }>("/doviz-kurlari/eksikleri-cek", {
        method: "POST",
        body: JSON.stringify({ baslangic, bitis }),
      });
      if (!s.aday) return "Aralıkta eksik iş günü yok.";
      return `${s.aday} eksik iş gününden ${s.cekilen} tanesi TCMB'den çekildi.${s.yayimlanmayan.length ? ` TCMB'nin yayımlamadığı günler (tatil ya da yayım saati öncesi): ${s.yayimlanmayan.map(tarihGoster).join(", ")}.` : ""}`;
    });

  const elleKaydet = () =>
    islem(async () => {
      const s = await api<{ tur: string }>("/doviz-kurlari/elle", { method: "PUT", body: JSON.stringify(form) });
      setForm((f) => ({ ...f, alis: "", satis: "", gerekce: "" }));
      return `${tarihGoster(form.tarih)} ${form.dovizCinsi} elle kuru ${s.tur === "girildi" ? "girildi" : "güncellendi"}.`;
    });

  const elleSil = (tarih: string, dovizCinsi: Doviz) => {
    const gerekce = window.prompt(`${tarihGoster(tarih)} ${dovizCinsi} elle kurunu silme gerekçesi (en az 5 karakter):`);
    if (!gerekce) return;
    void islem(async () => {
      await api("/doviz-kurlari/elle", { method: "DELETE", body: JSON.stringify({ tarih, dovizCinsi, gerekce }) });
      return `${tarihGoster(tarih)} ${dovizCinsi} elle kuru silindi; o gün yine TCMB kuru geçerli.`;
    });
  };

  const duzenle = (tarih: string, h: KurHucresi) =>
    setForm({ tarih, dovizCinsi: h.dovizCinsi, alis: h.elle?.alis ?? h.tcmb?.alis ?? "", satis: h.elle?.satis ?? h.tcmb?.satis ?? "", gerekce: "" });

  const hucre = (g: KurGunu, h: KurHucresi) => {
    const gecerli = h.elle ?? h.tcmb;
    if (!gecerli) return <td key={h.dovizCinsi} colSpan={2} className="muted">{g.isGunu ? "—" : "hafta sonu"}</td>;
    // İki hücre tek dönüşten çıkıyor; anahtar listede React'in istediği yerde durmalı.
    return (
      <Fragment key={h.dovizCinsi}>
        <td className="num">{kur(gecerli.alis)}</td>
        <td className="num">
          {kur(gecerli.satis)}
          {h.elle && (
            <div style={{ fontSize: "0.8em" }}>
              <Badge variant="warning">Elle</Badge>{" "}
              {h.tcmb ? <span className="muted">TCMB {kur(h.tcmb.satis)} ({Number(h.satisFarki) >= 0 ? "+" : ""}{kur(h.satisFarki ?? "0")})</span> : <span className="muted">TCMB kuru yok</span>}
            </div>
          )}
        </td>
      </Fragment>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Döviz Kurları"
        subtitle={`TCMB gösterge kurları her gün otomatik çekilir. Belge tarihinde kur yoksa en fazla ${liste?.geriBakisGun ?? 10} gün öncesinin kuru kullanılır; firmanıza özel kur girerseniz o gün TCMB kurunun yerine geçer.`}
      />
      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}

      <Card>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <Field label="Başlangıç"><Input type="date" value={baslangic} max={bitis} onChange={(e) => setBaslangic(e.target.value)} /></Field>
          <Field label="Bitiş"><Input type="date" value={bitis} max={bugunIso()} onChange={(e) => setBitis(e.target.value)} /></Field>
          <Button disabled={calisiyor} onClick={() => void yukle(baslangic, bitis)}>Listele</Button>
          <Button variant="primary" disabled={calisiyor} onClick={() => void eksikleriCek()}>Eksikleri TCMB'den çek</Button>
        </div>
        {liste && liste.eksikGunler.length > 0 && (
          <p style={{ marginTop: "0.75rem", color: "var(--warning, #b45309)" }}>
            Aralıkta TCMB kuru olmayan {liste.eksikGunler.length} iş günü var: {liste.eksikGunler.slice(0, 8).map(tarihGoster).join(", ")}{liste.eksikGunler.length > 8 ? " …" : ""}. Tatil günlerinde TCMB kur yayımlamaz.
          </p>
        )}
      </Card>

      <Card>
        <h3>Firmaya özel (elle) kur</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <Field label="Tarih"><Input type="date" value={form.tarih} max={bugunIso()} onChange={(e) => setForm({ ...form, tarih: e.target.value })} /></Field>
          <Field label="Para birimi">
            <Select value={form.dovizCinsi} onChange={(e) => setForm({ ...form, dovizCinsi: e.target.value as Doviz })}>
              <DovizSecenekleri adli yalnizYabanci />
            </Select>
          </Field>
          <Field label="Alış"><Input inputMode="decimal" value={form.alis} onChange={(e) => setForm({ ...form, alis: e.target.value })} style={{ width: "8rem" }} /></Field>
          <Field label="Satış"><Input inputMode="decimal" value={form.satis} onChange={(e) => setForm({ ...form, satis: e.target.value })} style={{ width: "8rem" }} /></Field>
          <Field label="Gerekçe"><Input value={form.gerekce} placeholder="Örn. bankanın uyguladığı kur" onChange={(e) => setForm({ ...form, gerekce: e.target.value })} style={{ minWidth: "16rem" }} /></Field>
          <Button variant="primary" disabled={calisiyor || !form.alis || !form.satis || form.gerekce.trim().length < 5} onClick={() => void elleKaydet()}>Kaydet</Button>
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
          <span className="muted">Tablodaki dövizler:</span>
          {gosterilen.map((d) => (
            <Badge key={d} variant="neutral">
              {d}{" "}
              {gosterilen.length > 1 && (
                <button type="button" aria-label={`${d} sütununu kaldır`} onClick={() => setGosterilen(gosterilen.filter((x) => x !== d))} style={{ background: "none", border: 0, cursor: "pointer", color: "inherit", padding: 0 }}>×</button>
              )}
            </Badge>
          ))}
          <Select aria-label="Tabloya döviz ekle" value="" onChange={(e) => e.target.value && setGosterilen([...gosterilen, e.target.value as Doviz])} style={{ width: "auto" }}>
            <option value="">+ Döviz ekle</option>
            {YABANCI_DOVIZLER.filter((d) => !gosterilen.includes(d)).map((d) => <option key={d} value={d}>{d} — {DOVIZ_ADLARI[d]}</option>)}
          </Select>
        </div>
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>Tarih</th>
                {gosterilen.map((d) => (
                  <Fragment key={d}><th className="num">{d} alış</th><th className="num">{d} satış</th></Fragment>
                ))}
                <th>Kaynak</th><th />
              </tr>
            </thead>
            <tbody>
              {(liste?.gunler ?? []).map((g) => ({ ...g, kurlar: gosterilen.flatMap((d) => g.kurlar.filter((h) => h.dovizCinsi === d)) })).map((g) => (
                <tr key={g.tarih} className={g.isGunu ? "" : "muted"}>
                  <td>{tarihGoster(g.tarih)} {g.eksik && <Badge variant="danger">Eksik</Badge>}</td>
                  {g.kurlar.map((h) => hucre(g, h))}
                  <td>{[...new Set(g.kurlar.map((h) => (h.elle ? "Elle" : h.tcmb?.kaynak === "TCMB_EVDS" ? "TCMB EVDS" : h.tcmb ? "TCMB" : "")).filter(Boolean))].join(" + ") || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {g.kurlar.map((h) => (
                      <span key={h.dovizCinsi}>
                        <Button size="sm" onClick={() => duzenle(g.tarih, h)}>{h.dovizCinsi} elle</Button>{" "}
                        {h.elle && <Button size="sm" variant="danger" onClick={() => elleSil(g.tarih, h.dovizCinsi)}>Sil</Button>}{" "}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card>
        <h3>Elle kur geçmişi</h3>
        {olaylar.length === 0 ? (
          <p className="muted">Henüz elle kur girilmedi.</p>
        ) : (
          <TableWrap>
            <table>
              <thead><tr><th>Zaman</th><th>Kur günü</th><th>İşlem</th><th className="num">Satış (eski → yeni)</th><th>Gerekçe</th><th>Kullanıcı</th></tr></thead>
              <tbody>
                {olaylar.map((o) => (
                  <tr key={`${o.zaman}-${o.dovizCinsi}`}>
                    <td>{new Date(o.zaman).toLocaleString("tr-TR")}</td>
                    <td>{tarihGoster(o.tarih)} {o.dovizCinsi}</td>
                    <td>{OLAY_ADI[o.tur]}</td>
                    <td className="num">{o.eskiSatis ? kur(o.eskiSatis) : "—"} → {o.yeniSatis ? kur(o.yeniSatis) : "—"}</td>
                    <td>{o.gerekce}</td>
                    <td>{o.kullanici}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
