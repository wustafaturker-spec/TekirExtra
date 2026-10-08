"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { useDepolar } from "@/lib/depolar";
import { DepoSecici } from "@/components/depo-secici";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Stat,
  StatGrid,
  TableWrap,
} from "@/components/ui";
import { bugunTR } from "@tekirextra/shared";

/** STK-29…31: sayım tarihindeki sistem miktarı; varyantlı kart varyant başına satır. */
interface SistemPartisi { lotNo: string; seriNo: string | null; sonKullanmaTarihi: string | null; sistemMiktar: string }
interface SistemSatiri {
  stokId: string;
  varyantId: string | null;
  kod: string;
  ad: string;
  varyantAd: string | null;
  anaBirim: string;
  takipTipi: "yok" | "lot" | "seri";
  sistemMiktar: string;
  partiler: SistemPartisi[];
}
/** Formda girilen parti satırı; `yeni` sayımda bulunan, sistemde olmayan lot. */
interface PartiGirdisi { lotNo: string; seriNo: string; sonKullanmaTarihi: string; sistemMiktar: string; fiili: string; yeni?: boolean }

const satirAnahtari = (s: { stokId: string; varyantId: string | null }) => `${s.stokId}|${s.varyantId ?? ""}`;

interface DepoBilgi {
  id: string;
  kod: string;
  ad: string;
}

interface SayimOzet {
  id: string;
  tarih: string;
  aciklama: string | null;
  durum: string;
  onayZamani: string | null;
  depo: DepoBilgi | null;
  _count: { kalemler: number };
}

interface SayimKalem {
  id: string;
  stokId: string;
  sistemMiktar: string;
  fiiliMiktar: string;
  stok: { id: string; kod: string; ad: string; anaBirim: string } | null;
  varyant: { id: string; kod: string; ad: string } | null;
  partiler: { lotNo: string; seriNo: string | null; sonKullanmaTarihi: string | null; sistemMiktar: string; fiiliMiktar: string }[] | null;
}

interface SayimDetay extends Omit<SayimOzet, "_count"> {
  kalemler: SayimKalem[];
}

const adet = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

const bugun = () => bugunTR();

export default function SayimSayfasi() {
  const [sayimlar, setSayimlar] = useState<SayimOzet[]>([]);
  const [detay, setDetay] = useState<SayimDetay | null>(null);
  const [satirlar, setSatirlar] = useState<SistemSatiri[]>([]);
  const [formAcik, setFormAcik] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  // Taslak formu
  const [tarih, setTarih] = useState(bugun());
  const [depoId, setDepoId] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [arama, setArama] = useState("");
  /** satır anahtarı → fiili miktar; boş bırakılanlar sayıma girmez. */
  const [fiili, setFiili] = useState<Record<string, string>>({});
  /** lot/seri takipli satırların parti girdileri (STK-31). */
  const [partiGirdileri, setPartiGirdileri] = useState<Record<string, PartiGirdisi[]>>({});
  const [acikPartiler, setAcikPartiler] = useState<string | null>(null);

  const { cokluDepo } = useDepolar();

  const yukle = useCallback(async () => {
    try {
      setSayimlar(await api<SayimOzet[]>("/stok/sayimlar"));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sayımlar yüklenemedi");
    }
  }, []);

  /** Sistem miktarı sayım tarihinin gün sonu itibarıyla, seçili depoda (STK-29). */
  const sistemiYukle = useCallback(async () => {
    if (!formAcik || !tarih) return;
    try {
      const q = new URLSearchParams({ tarih, ...(depoId ? { depoId } : {}) });
      setSatirlar((await api<{ satirlar: SistemSatiri[] }>(`/stok/sayimlar/sistem?${q.toString()}`)).satirlar);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sistem miktarları alınamadı");
    }
  }, [formAcik, tarih, depoId]);

  useEffect(() => {
    if (!tokenAl()) return;
    void yukle();
  }, [yukle]);
  useEffect(() => { void sistemiYukle(); }, [sistemiYukle]);

  const partileriAc = (s: SistemSatiri) => {
    const a = satirAnahtari(s);
    setPartiGirdileri((g) => g[a] ? g : { ...g, [a]: s.partiler.map((p) => ({ lotNo: p.lotNo, seriNo: p.seriNo ?? "", sonKullanmaTarihi: p.sonKullanmaTarihi ?? "", sistemMiktar: p.sistemMiktar, fiili: "" })) });
    setAcikPartiler((x) => (x === a ? null : a));
  };
  const partiDegistir = (a: string, i: number, ek: Partial<PartiGirdisi>) => setPartiGirdileri((g) => ({ ...g, [a]: g[a].map((p, j) => (j === i ? { ...p, ...ek } : p)) }));
  /** Lotlu satırın fiilisi parti girdilerinin toplamı; hiç girilmemişse boş. */
  const lotluFiili = (a: string) => {
    const g = partiGirdileri[a];
    if (!g || g.every((p) => p.fiili.trim() === "")) return "";
    return String(g.reduce((t, p) => t + Number(p.fiili || 0), 0));
  };
  const fiiliDegeri = (s: SistemSatiri) => (s.takipTipi === "yok" ? fiili[satirAnahtari(s)] ?? "" : lotluFiili(satirAnahtari(s)));

  const suzulmus = useMemo(() => {
    const a = arama.trim().toLocaleLowerCase("tr");
    if (!a) return satirlar;
    return satirlar.filter(
      (s) => s.ad.toLocaleLowerCase("tr").includes(a) || s.kod.toLocaleLowerCase("tr").includes(a) || (s.varyantAd ?? "").toLocaleLowerCase("tr").includes(a),
    );
  }, [satirlar, arama]);

  const girilenler = useMemo(
    () => satirlar.filter((s) => fiiliDegeri(s).trim() !== ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [satirlar, fiili, partiGirdileri],
  );

  async function taslakKaydet() {
    setHata("");
    setBasari("");
    try {
      const kalemler = girilenler.map((s) => ({
        stokId: s.stokId,
        varyantId: s.varyantId,
        fiiliMiktar: Number(fiiliDegeri(s)).toFixed(3),
        ...(s.takipTipi !== "yok" && {
          partiler: (partiGirdileri[satirAnahtari(s)] ?? [])
            .filter((p) => p.fiili.trim() !== "" && p.lotNo.trim() !== "")
            .map((p) => ({ lotNo: p.lotNo.trim(), seriNo: p.seriNo.trim() || null, sonKullanmaTarihi: p.sonKullanmaTarihi || null, fiiliMiktar: Number(p.fiili).toFixed(3) })),
        }),
      }));
      await api("/stok/sayimlar", {
        method: "POST",
        body: JSON.stringify({
          tarih,
          depoId: depoId || null,
          aciklama: aciklama.trim() === "" ? null : aciklama.trim(),
          kalemler,
        }),
      });
      setBasari(`${kalemler.length} kalemli sayım taslağı oluşturuldu.`);
      setFormAcik(false);
      setFiili({});
      setPartiGirdileri({});
      setAcikPartiler(null);
      setAciklama("");
      setArama("");
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sayım kaydedilemedi");
    }
  }

  async function detayAc(id: string) {
    setHata("");
    try {
      setDetay(await api<SayimDetay>(`/stok/sayimlar/${id}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sayım detayı alınamadı");
    }
  }

  async function onayla(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/stok/sayimlar/${id}/onayla`, { method: "POST" });
      setBasari("Sayım onaylandı; farklar sayım düzeltme hareketi olarak stoğa işlendi.");
      await yukle();
      await detayAc(id);
      void sistemiYukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sayım onaylanamadı");
    }
  }

  return (
    <div>
      <PageHeader
        title="Stok Sayımı"
        subtitle="Fiili sayım sonuçlarını taslak olarak kaydedin; onayladığınızda farklar stoğa işlenir."
        actions={
          <>
            <ButtonLabel as="a" href="/panel/stok">
              ← Stok Listesi
            </ButtonLabel>
            <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
              {formAcik ? "Vazgeç" : "➕ Yeni Sayım"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {formAcik && (
        <Card style={{ marginBottom: "1.5rem" }}>
          <div className="card__title">Yeni Sayım Taslağı</div>
          <div className="row">
            <div style={{ flex: 1, minWidth: 170 }}>
              <Field label="Sayım Tarihi *">
                <Input type="date" max={bugun()} value={tarih} onChange={(e) => setTarih(e.target.value)} />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <DepoSecici deger={depoId} onChange={setDepoId} label="Depo *" />
            </div>
            <div style={{ flex: 3, minWidth: 240 }}>
              <Field label="Açıklama">
                <Input
                  value={aciklama}
                  onChange={(e) => setAciklama(e.target.value)}
                  placeholder="Örn. Yıl sonu deposu sayımı"
                />
              </Field>
            </div>
          </div>

          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Yalnız <strong>fiili miktar girdiğiniz</strong> satırlar sayıma dahil edilir; boş bıraktıklarınız
            etkilenmez. Sistem miktarı <strong>sayım tarihinin gün sonu</strong> itibarıyladır; onayda fark bu
            tarihe göre işlenir, sayımdan sonraki satış ve alışlar korunur. Varyantlı ürünler varyant başına,
            lot/seri takipli ürünler parti başına sayılır.
            {cokluDepo && " Bir sayım tek depoyu kapsar."}
          </p>

          <SearchInput
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            placeholder="Ürün adı veya kodu ile filtrele..."
          />

          <div style={{ maxHeight: 420, overflowY: "auto", marginTop: "0.75rem" }}>
            <TableWrap>
              <thead>
                <tr>
                  <th>Kod</th>
                  <th>Ürün</th>
                  <th className="num">Sistem</th>
                  <th className="num" style={{ width: 160 }}>
                    Fiili
                  </th>
                  <th className="num">Fark</th>
                </tr>
              </thead>
              <tbody>
                {suzulmus.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      Filtreye uyan ürün yok.
                    </td>
                  </tr>
                ) : (
                  suzulmus.map((s) => {
                    const a = satirAnahtari(s);
                    const lotlu = s.takipTipi !== "yok";
                    const girilen = fiiliDegeri(s);
                    const sistem = s.sistemMiktar;
                    const fark = girilen.trim() === "" ? null : Number(girilen) - Number(sistem);
                    const partiler = partiGirdileri[a] ?? [];
                    return (
                      <Fragment key={a}>
                      <tr>
                        <td className="mono">{s.kod}</td>
                        <td>{s.ad}{s.varyantAd && <span className="muted"> · {s.varyantAd}</span>}</td>
                        <td className="num">
                          {adet(sistem)} {s.anaBirim}
                        </td>
                        <td className="num">
                          {lotlu ? (
                            <Button size="sm" onClick={() => partileriAc(s)}>{girilen === "" ? "Partileri say" : adet(girilen)} ({s.takipTipi === "seri" ? "seri" : "lot"})</Button>
                          ) : (
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              aria-label={`${s.kod} fiili miktar`}
                              value={girilen}
                              onChange={(e) => setFiili((f) => ({ ...f, [a]: e.target.value }))}
                              placeholder="—"
                              style={{ textAlign: "right" }}
                            />
                          )}
                        </td>
                        <td
                          className="num"
                          style={{
                            fontWeight: 700,
                            color:
                              fark === null || fark === 0
                                ? "var(--text-subtle)"
                                : fark > 0
                                  ? "var(--success)"
                                  : "var(--danger)",
                          }}
                        >
                          {fark === null ? "—" : `${fark > 0 ? "+" : ""}${adet(fark)}`}
                        </td>
                      </tr>
                      {lotlu && acikPartiler === a && (
                        <tr>
                          <td colSpan={5}>
                            <TableWrap>
                              <thead><tr><th>Lot</th>{s.takipTipi === "seri" && <th>Seri no</th>}<th>Son kullanma</th><th className="num">Sistem</th><th className="num" style={{ width: 140 }}>Fiili</th></tr></thead>
                              <tbody>
                                {partiler.map((p, i) => (
                                  <tr key={`${p.lotNo}-${p.seriNo}-${i}`}>
                                    <td>{p.yeni ? <Input aria-label="Lot no" value={p.lotNo} onChange={(e) => partiDegistir(a, i, { lotNo: e.target.value })} /> : <span className="mono">{p.lotNo}</span>}</td>
                                    {s.takipTipi === "seri" && <td>{p.yeni ? <Input aria-label="Seri no" value={p.seriNo} onChange={(e) => partiDegistir(a, i, { seriNo: e.target.value })} /> : <span className="mono">{p.seriNo}</span>}</td>}
                                    <td>{p.yeni ? <Input type="date" aria-label="Son kullanma" value={p.sonKullanmaTarihi} onChange={(e) => partiDegistir(a, i, { sonKullanmaTarihi: e.target.value })} /> : (p.sonKullanmaTarihi || "—")}</td>
                                    <td className="num">{adet(p.sistemMiktar)}</td>
                                    <td className="num"><Input type="number" step={s.takipTipi === "seri" ? "1" : "0.001"} min="0" max={s.takipTipi === "seri" ? "1" : undefined} aria-label="Parti fiili miktar" value={p.fiili} onChange={(e) => partiDegistir(a, i, { fiili: e.target.value })} placeholder="0" style={{ textAlign: "right" }} /></td>
                                  </tr>
                                ))}
                                {!partiler.length && <tr><td colSpan={5} className="muted">Sayım tarihinde bu depoda parti yok.</td></tr>}
                              </tbody>
                            </TableWrap>
                            <div className="row-tight" style={{ marginTop: "0.5rem" }}>
                              <Button size="sm" onClick={() => setPartiGirdileri((g) => ({ ...g, [a]: [...(g[a] ?? []), { lotNo: "", seriNo: "", sonKullanmaTarihi: "", sistemMiktar: "0", fiili: "", yeni: true }] }))}>+ Sayımda bulunan yeni {s.takipTipi === "seri" ? "seri" : "lot"}</Button>
                              <small className="muted">Girilmeyen parti bulunamadı (0) sayılır.</small>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </TableWrap>
          </div>

          <div className="between" style={{ marginTop: "1rem" }}>
            <span className="muted" style={{ fontSize: "0.9rem" }}>
              {girilenler.length} satır sayıma dahil edilecek
            </span>
            <Button variant="primary" onClick={taslakKaydet} disabled={girilenler.length === 0}>
              Taslağı Kaydet
            </Button>
          </div>
        </Card>
      )}

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Tarih</th>
              {cokluDepo && <th>Depo</th>}
              <th>Açıklama</th>
              <th>Durum</th>
              <th className="num">Kalem</th>
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {sayimlar.length === 0 ? (
              <tr>
                <td colSpan={cokluDepo ? 6 : 5} className="empty">
                  Henüz sayım kaydı yok.
                </td>
              </tr>
            ) : (
              sayimlar.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.tarih.slice(0, 10)}</td>
                  {cokluDepo && <td>{s.depo?.ad ?? "—"}</td>}
                  <td>{s.aciklama ?? "—"}</td>
                  <td>
                    <Badge variant={s.durum === "onaylandi" ? "success" : "warning"}>
                      {s.durum === "onaylandi" ? "✅ Onaylandı" : "📝 Taslak"}
                    </Badge>
                  </td>
                  <td className="num">{s._count.kalemler}</td>
                  <td className="center">
                    <div className="row-tight" style={{ justifyContent: "center" }}>
                      <Button size="sm" onClick={() => detayAc(s.id)}>
                        🔍 Detay
                      </Button>
                      {s.durum === "taslak" && (
                        <Button size="sm" variant="primary" onClick={() => onayla(s.id)}>
                          ✅ Onayla
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>

      {detay && <SayimDetayKarti detay={detay} onKapat={() => setDetay(null)} onOnayla={() => onayla(detay.id)} />}
    </div>
  );
}

/* ─── Sayım detayı ───────────────────────────────────────────────────────── */

function SayimDetayKarti({
  detay,
  onKapat,
  onOnayla,
}: {
  detay: SayimDetay;
  onKapat: () => void;
  onOnayla: () => void;
}) {
  const taslak = detay.durum === "taslak";
  const farklar = detay.kalemler.map((k) => Number(k.fiiliMiktar) - Number(k.sistemMiktar));
  const fazla = farklar.filter((f) => f > 0).length;
  const eksik = farklar.filter((f) => f < 0).length;

  return (
    <Card style={{ marginTop: "1.5rem", borderColor: "var(--accent)" }}>
      <div className="between" style={{ alignItems: "flex-start" }}>
        <div>
          <h3 style={{ fontSize: "1.15rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {detay.tarih.slice(0, 10)} tarihli sayım
            {detay.depo && <Badge variant="info">{detay.depo.ad}</Badge>}
            <Badge variant={taslak ? "warning" : "success"}>{taslak ? "📝 Taslak" : "✅ Onaylandı"}</Badge>
          </h3>
          <p className="muted" style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
            {detay.aciklama ?? "Açıklama yok"}
            {detay.onayZamani ? ` · Onay: ${new Date(detay.onayZamani).toLocaleString("tr-TR")}` : ""}
          </p>
        </div>
        <div className="row-tight">
          {taslak && (
            <Button size="sm" variant="primary" onClick={onOnayla}>
              ✅ Onayla
            </Button>
          )}
          <Button size="sm" onClick={onKapat}>
            ✖ Kapat
          </Button>
        </div>
      </div>

      <StatGrid>
        <Stat label="Kalem" value={detay.kalemler.length} hint="Sayılan ürün" />
        <Stat label="Fazla Çıkan" value={fazla} tone={fazla > 0 ? "success" : "default"} hint="Fiili > sistem" />
        <Stat label="Eksik Çıkan" value={eksik} tone={eksik > 0 ? "danger" : "default"} hint="Fiili < sistem" />
      </StatGrid>

      {taslak && (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Sistem miktarı sayım tarihinin gün sonu itibarıyladır. Onayda bu tarihe göre yeniden hesaplanır
          (sonradan geçmiş tarihli hareket girildiyse güncellenir) ve fark sayım tarihli <strong>sayım düzeltme</strong>
          hareketi olarak işlenir; sayımdan sonraki hareketler korunur.
        </p>
      )}

      <TableWrap>
        <thead>
          <tr>
            <th>Kod</th>
            <th>Ürün</th>
            <th className="num">Sistem</th>
            <th className="num">Fiili</th>
            <th className="num">Fark</th>
          </tr>
        </thead>
        <tbody>
          {detay.kalemler.map((k) => {
            const fark = Number(k.fiiliMiktar) - Number(k.sistemMiktar);
            return (
              <Fragment key={k.id}>
              <tr>
                <td className="mono">{k.varyant?.kod ?? k.stok?.kod ?? "—"}</td>
                <td>{k.stok?.ad ?? "(silinmiş ürün)"}{k.varyant && <span className="muted"> · {k.varyant.ad}</span>}</td>
                <td className="num">{adet(k.sistemMiktar)}</td>
                <td className="num">{adet(k.fiiliMiktar)}</td>
                <td
                  className="num"
                  style={{
                    fontWeight: 700,
                    color: fark === 0 ? "var(--text-subtle)" : fark > 0 ? "var(--success)" : "var(--danger)",
                  }}
                >
                  {fark > 0 ? "+" : ""}
                  {adet(fark)} {k.stok?.anaBirim ?? ""}
                </td>
              </tr>
              {(k.partiler ?? []).map((p) => {
                const pf = Number(p.fiiliMiktar) - Number(p.sistemMiktar);
                return (
                  <tr key={`${k.id}-${p.lotNo}-${p.seriNo}`} className="muted">
                    <td />
                    <td style={{ paddingLeft: "1.5rem" }}>Lot {p.lotNo}{p.seriNo ? ` · seri ${p.seriNo}` : ""}{p.sonKullanmaTarihi ? ` · SKT ${p.sonKullanmaTarihi}` : ""}</td>
                    <td className="num">{adet(p.sistemMiktar)}</td>
                    <td className="num">{adet(p.fiiliMiktar)}</td>
                    <td className="num">{pf > 0 ? "+" : ""}{adet(pf)}</td>
                  </tr>
                );
              })}
              </Fragment>
            );
          })}
        </tbody>
      </TableWrap>
    </Card>
  );
}
