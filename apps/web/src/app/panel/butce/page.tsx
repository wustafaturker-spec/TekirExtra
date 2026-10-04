"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Para, Segmented, Select, Stat, StatGrid, TableWrap, Tarih } from "@/components/ui";

interface Kalem { anahtar: string; tur: "gelir" | "gider"; anaKategori: string; altKategori: string }
interface Revizyon { id: string; revizyon: number; durum: "taslak" | "onayli" | "yerine_gecildi"; gerekce: string | null; onayTarihi: string | null; onaylayan: string | null; olusturuldu: string }
interface Butce {
  yil: number;
  kalemler: Kalem[];
  revizyonlar: Revizyon[];
  taslak: (Revizyon & { tutarlar: Record<string, number[]> }) | null;
  gecerli: (Revizyon & { tutarlar: Record<string, number[]> }) | null;
  olaylar: { tur: string; gerekce: string | null; revizyon: number; kullanici: string; zaman: string }[];
}
interface Toplam { plan: number; ilkPlan: number; planBugune: number; gerceklesen: number }
interface KSatir extends Kalem {
  toplam: Toplam & { fark: number; oran: number | null; durum: "asim" | "eksik" | "uygun" | "plansiz" };
}
interface Karsilastirma { yil: number; sonAy: number; gecerliRevizyon: number | null; ilkRevizyon: number | null; satirlar: KSatir[]; toplamlar: { gelir: Toplam; gider: Toplam; net: Toplam }; uyarilar: string[] }

const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const DURUM_ADI: Record<Revizyon["durum"], string> = { taslak: "Taslak", onayli: "Onaylı", yerine_gecildi: "Yerine geçildi" };
const OLAY_ADI: Record<string, string> = { olusturuldu: "Oluşturuldu", onaylandi: "Onaylandı", revizyon_acildi: "Revizyon açıldı" };
const SATIR_DURUMU: Record<KSatir["toplam"]["durum"], { ad: string; ton: "danger" | "warning" | "success" | "neutral" }> = {
  asim: { ad: "Aşım", ton: "danger" },
  eksik: { ad: "Hedefin altında", ton: "warning" },
  uygun: { ad: "Plana uygun", ton: "success" },
  plansiz: { ad: "Plansız", ton: "neutral" },
};

/** Yıllık tutarı 12 aya böler; kuruş farkı son aya (BUT-08). */
function yillikDagit(yillik: number): string[] {
  const kurus = Math.round(yillik * 100);
  const aylik = Math.floor(kurus / 12);
  return Array.from({ length: 12 }, (_, i) => ((i === 11 ? aylik + (kurus - aylik * 12) : aylik) / 100).toFixed(2));
}
const bosSatir = () => Array.from({ length: 12 }, () => "");
const kalemAdi = (k: Kalem) => (k.altKategori && k.altKategori !== "Genel" && k.altKategori !== "Genel Masraf" ? `${k.anaKategori} › ${k.altKategori}` : k.anaKategori);

export default function ButceSayfasi() {
  const buYil = new Date().getFullYear();
  const [yil, setYil] = useState(buYil);
  const [sekme, setSekme] = useState<"plan" | "karsilastirma">("plan");
  const [veri, setVeri] = useState<Butce | null>(null);
  const [karsi, setKarsi] = useState<Karsilastirma | null>(null);
  const [rol, setRol] = useState("");
  const [duzen, setDuzen] = useState<Record<string, string[]>>({});
  const [yillikGirdi, setYillikGirdi] = useState<Record<string, string>>({});
  const [yalnizDolu, setYalnizDolu] = useState(false);
  const [kaynak, setKaynak] = useState<"bos" | "gecen_yil">("bos");
  const [artis, setArtis] = useState("0");
  const [gerekce, setGerekce] = useState("");
  const [calisiyor, setCalisiyor] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async (hedefYil: number) => {
    setHata("");
    try {
      const [b, k, ben] = await Promise.all([
        api<Butce>(`/butce/${hedefYil}`),
        api<Karsilastirma>(`/butce/${hedefYil}/karsilastirma`),
        api<{ rol: string }>("/auth/ben"),
      ]);
      setVeri(b);
      setKarsi(k);
      setRol(ben.rol);
      const kaynakTutar = b.taslak?.tutarlar ?? b.gecerli?.tutarlar ?? {};
      setDuzen(Object.fromEntries(b.kalemler.map((kalem) => [kalem.anahtar, (kaynakTutar[kalem.anahtar] ?? []).length ? kaynakTutar[kalem.anahtar].map((v) => (v ? v.toFixed(2) : "")) : bosSatir()])));
      setYillikGirdi({});
      setYalnizDolu(!b.taslak);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Bütçe yüklenemedi");
    }
  }, []);

  useEffect(() => {
    void yukle(yil);
  }, [yil, yukle]);

  async function islem(is: () => Promise<unknown>, mesaj: string) {
    setCalisiyor(true);
    setHata("");
    setBasari("");
    try {
      await is();
      setBasari(mesaj);
      await yukle(yil);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem yapılamadı");
    } finally {
      setCalisiyor(false);
    }
  }

  const taslak = veri?.taslak ?? null;
  const gosterilen = taslak ?? veri?.gecerli ?? null;
  const duzenlenebilir = Boolean(taslak);

  const satirlariGonder = () =>
    api(`/butce/revizyon/${taslak!.id}/satirlar`, {
      method: "PUT",
      body: JSON.stringify({
        satirlar: Object.entries(duzen).flatMap(([anahtar, aylar]) =>
          aylar.map((v, i) => ({ anahtar, ay: i + 1, tutar: Number(v || 0).toFixed(2) })).filter((s) => Number(s.tutar) > 0),
        ),
      }),
    });

  const gruplar = useMemo(() => {
    if (!veri) return [];
    const dolu = (k: Kalem) => (duzen[k.anahtar] ?? []).some((v) => Number(v) > 0);
    return (["gelir", "gider"] as const).map((tur) => ({
      tur,
      kalemler: veri.kalemler.filter((k) => k.tur === tur && (!yalnizDolu || dolu(k))),
    }));
  }, [veri, duzen, yalnizDolu]);

  const satirToplami = (anahtar: string) => (duzen[anahtar] ?? []).reduce((t, v) => t + Math.round(Number(v || 0) * 100), 0) / 100;
  const turToplami = (tur: "gelir" | "gider") => (veri?.kalemler ?? []).filter((k) => k.tur === tur).reduce((t, k) => t + Math.round(satirToplami(k.anahtar) * 100), 0) / 100;

  return (
    <div className="stack">
      <PageHeader
        title="Bütçe"
        subtitle="Yıllık, aylara dağıtılmış plan ve gelir-gider raporuyla aynı hesaptan gelen gerçekleşen (tahakkuk, KDV hariç)."
        actions={
          <div className="row-tight">
            <Select aria-label="Yıl" value={String(yil)} onChange={(e) => setYil(Number(e.target.value))} style={{ width: "auto" }}>
              {[buYil - 1, buYil, buYil + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            <Segmented items={[{ deger: "plan", baslik: "Plan" }, { deger: "karsilastirma", baslik: "Plan / gerçekleşen" }]} value={sekme} onChange={setSekme} ariaLabel="Görünüm" />
          </div>
        }
      />

      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}

      {veri && !veri.revizyonlar.length && (
        <Card title={`${yil} bütçesi henüz yok`}>
          <div className="row-tight" style={{ alignItems: "flex-end" }}>
            <Field label="Başlangıç">
              <Select value={kaynak} onChange={(e) => setKaynak(e.target.value as "bos" | "gecen_yil")}>
                <option value="bos">Boş bütçe</option>
                <option value="gecen_yil">{yil - 1} gerçekleşeninden</option>
              </Select>
            </Field>
            {kaynak === "gecen_yil" && (
              <Field label="Artış (%)"><Input type="number" step="0.1" value={artis} onChange={(e) => setArtis(e.target.value)} style={{ width: "7rem" }} /></Field>
            )}
            <Button variant="primary" disabled={calisiyor} onClick={() => void islem(() => api(`/butce/${yil}`, { method: "POST", body: JSON.stringify({ kaynak, artisYuzde: Number(artis || 0) }) }), `${yil} bütçe taslağı oluşturuldu.`)}>
              Taslak oluştur
            </Button>
          </div>
        </Card>
      )}

      {veri && gosterilen && sekme === "plan" && (
        <>
          <Card>
            <div className="between" style={{ flexWrap: "wrap" }}>
              <div className="row-tight">
                <strong>Revizyon {gosterilen.revizyon}</strong>
                <Badge variant={gosterilen.durum === "taslak" ? "warning" : "success"}>{DURUM_ADI[gosterilen.durum]}</Badge>
                {gosterilen.gerekce && <span className="muted">Gerekçe: {gosterilen.gerekce}</span>}
                {gosterilen.onayTarihi && <span className="muted">Onaylayan {gosterilen.onaylayan ?? "—"} · <Tarih deger={gosterilen.onayTarihi} /></span>}
              </div>
              <div className="row-tight">
                {duzenlenebilir ? (
                  <>
                    <Button disabled={calisiyor} onClick={() => void islem(satirlariGonder, "Taslak kaydedildi.")}>Taslağı kaydet</Button>
                    {rol === "yonetici" && (
                      <Button variant="primary" disabled={calisiyor} onClick={() => {
                        if (window.confirm(`Revizyon ${taslak!.revizyon} onaylansın mı? Onaylı bütçe değiştirilemez; sonraki değişiklik yeni revizyonla yapılır.`)) {
                          void islem(async () => { await satirlariGonder(); await api(`/butce/revizyon/${taslak!.id}/onayla`, { method: "POST" }); }, `Revizyon ${taslak!.revizyon} onaylandı.`);
                        }
                      }}>Kaydet ve onayla</Button>
                    )}
                  </>
                ) : (
                  <>
                    <Input placeholder="Revizyon gerekçesi" value={gerekce} onChange={(e) => setGerekce(e.target.value)} style={{ width: "18rem" }} />
                    <Button disabled={calisiyor || gerekce.trim().length < 5} onClick={() => void islem(async () => { await api(`/butce/${yil}/revizyon`, { method: "POST", body: JSON.stringify({ gerekce }) }); setGerekce(""); }, "Yeni revizyon taslak olarak açıldı.")}>
                      Revizyon aç
                    </Button>
                  </>
                )}
                <label className="row-tight muted" style={{ fontSize: "0.85rem" }}>
                  <input type="checkbox" checked={yalnizDolu} onChange={(e) => setYalnizDolu(e.target.checked)} /> Yalnız dolu satırlar
                </label>
              </div>
            </div>
            {duzenlenebilir && rol !== "yonetici" && <p className="muted" style={{ margin: "0.75rem 0 0" }}>Taslağı yönetici onaylar.</p>}
          </Card>

          <StatGrid>
            <Stat label="Planlanan gelir" tone="success" value={<Para deger={turToplami("gelir")} />} hint={`${yil} toplamı`} />
            <Stat label="Planlanan gider" tone="danger" value={<Para deger={turToplami("gider")} />} hint={`${yil} toplamı`} />
            <Stat label="Planlanan net" value={<Para deger={turToplami("gelir") - turToplami("gider")} isaretle />} />
          </StatGrid>

          <Card pad={false}>
            <TableWrap>
              <thead>
                <tr>
                  <th style={{ minWidth: "16rem" }}>Kalem</th>
                  {AYLAR.map((a) => <th key={a} className="num">{a}</th>)}
                  <th className="num">Yıllık</th>
                  {duzenlenebilir && <th>Yıllığı dağıt</th>}
                </tr>
              </thead>
              <tbody>
                {gruplar.map((grup) => (
                  <GrupSatirlari key={grup.tur} baslik={grup.tur === "gelir" ? "Gelirler" : "Giderler"} sutun={duzenlenebilir ? 15 : 14}>
                    {grup.kalemler.map((k) => (
                      <tr key={k.anahtar}>
                        <td>{kalemAdi(k)}</td>
                        {(duzen[k.anahtar] ?? bosSatir()).map((v, i) => (
                          <td key={i} className="num">
                            {duzenlenebilir ? (
                              <Input
                                aria-label={`${kalemAdi(k)} ${AYLAR[i]}`}
                                type="number" min="0" step="0.01" inputMode="decimal" value={v}
                                onChange={(e) => setDuzen((d) => ({ ...d, [k.anahtar]: (d[k.anahtar] ?? bosSatir()).map((x, j) => (j === i ? e.target.value : x)) }))}
                                style={{ width: "7rem", textAlign: "right" }}
                              />
                            ) : Number(v) ? <Para deger={Number(v)} /> : <span className="muted">—</span>}
                          </td>
                        ))}
                        <td className="num"><strong><Para deger={satirToplami(k.anahtar)} /></strong></td>
                        {duzenlenebilir && (
                          <td>
                            <div className="row-tight" style={{ flexWrap: "nowrap" }}>
                              <Input aria-label={`${kalemAdi(k)} yıllık`} type="number" min="0" step="0.01" value={yillikGirdi[k.anahtar] ?? ""} onChange={(e) => setYillikGirdi((y) => ({ ...y, [k.anahtar]: e.target.value }))} style={{ width: "8rem" }} />
                              <Button size="sm" disabled={!Number(yillikGirdi[k.anahtar])} onClick={() => setDuzen((d) => ({ ...d, [k.anahtar]: yillikDagit(Number(yillikGirdi[k.anahtar])) }))}>Dağıt</Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </GrupSatirlari>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        </>
      )}

      {veri && sekme === "karsilastirma" && karsi && (
        !karsi.gecerliRevizyon ? (
          <Card><p className="muted" style={{ margin: 0 }}>{yil} için onaylı bütçe yok; karşılaştırma onaydan sonra görünür.</p></Card>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Revizyon {karsi.gecerliRevizyon} ile {karsi.sonAy === 0 ? "henüz başlamamış yıl" : karsi.sonAy === 12 ? "yılın tamamı" : `Ocak–${AYLAR[karsi.sonAy - 1]} dönemi`} karşılaştırılıyor.
              {karsi.ilkRevizyon && ` İlk onaylı plan: revizyon ${karsi.ilkRevizyon}.`} Personel gideri işveren maliyetidir (brüt ücret + işveren SGK ve işsizlik payı); net ücretli bordroda kazanç toplamı.
            </p>
            {karsi.uyarilar.map((u) => <div key={u} className="approval-impact is-warning">{u}</div>)}
            <StatGrid>
              <Stat label="Gelir" tone="success" value={<Para deger={karsi.toplamlar.gelir.gerceklesen} />} hint={<>Plan <Para deger={karsi.toplamlar.gelir.planBugune} /></>} />
              <Stat label="Gider" tone="danger" value={<Para deger={karsi.toplamlar.gider.gerceklesen} />} hint={<>Plan <Para deger={karsi.toplamlar.gider.planBugune} /></>} />
              <Stat label="Net" value={<Para deger={karsi.toplamlar.net.gerceklesen} isaretle />} hint={<>Plan <Para deger={karsi.toplamlar.net.planBugune} /></>} />
            </StatGrid>
            <Card pad={false}>
              <TableWrap>
                <thead>
                  <tr>
                    <th>Kalem</th>
                    {karsi.ilkRevizyon && <th className="num">İlk plan (yıl)</th>}
                    <th className="num">Plan (yıl)</th>
                    <th className="num">Plan (dönem)</th>
                    <th className="num">Gerçekleşen</th>
                    <th className="num">Fark</th>
                    <th className="num">Oran</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {(["gelir", "gider"] as const).map((tur) => (
                    <GrupSatirlari key={tur} baslik={tur === "gelir" ? "Gelirler" : "Giderler"} sutun={karsi.ilkRevizyon ? 8 : 7}>
                      {karsi.satirlar.filter((s) => s.tur === tur).map((s) => (
                        <tr key={s.anahtar}>
                          <td>{kalemAdi(s)}</td>
                          {karsi.ilkRevizyon && <td className="num"><Para deger={s.toplam.ilkPlan} /></td>}
                          <td className="num"><Para deger={s.toplam.plan} /></td>
                          <td className="num"><Para deger={s.toplam.planBugune} /></td>
                          <td className="num"><Para deger={s.toplam.gerceklesen} /></td>
                          <td className="num"><Para deger={s.toplam.fark} isaretle /></td>
                          <td className="num">{s.toplam.oran === null ? "—" : `%${s.toplam.oran.toLocaleString("tr-TR")}`}</td>
                          <td><Badge variant={SATIR_DURUMU[s.toplam.durum].ton}>{SATIR_DURUMU[s.toplam.durum].ad}</Badge></td>
                        </tr>
                      ))}
                    </GrupSatirlari>
                  ))}
                </tbody>
              </TableWrap>
            </Card>
          </>
        )
      )}

      {veri && veri.olaylar.length > 0 && (
        <Card title="Revizyon geçmişi" pad={false}>
          <TableWrap>
            <thead><tr><th>Zaman</th><th>Revizyon</th><th>Olay</th><th>Kullanıcı</th><th>Gerekçe</th></tr></thead>
            <tbody>
              {veri.olaylar.map((o, i) => (
                <tr key={i}>
                  <td><Tarih deger={o.zaman} saatli /></td>
                  <td>{o.revizyon}</td>
                  <td>{OLAY_ADI[o.tur] ?? o.tur}</td>
                  <td>{o.kullanici}</td>
                  <td>{o.gerekce ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}

function GrupSatirlari({ baslik, sutun, children }: { baslik: string; sutun: number; children: React.ReactNode }) {
  return (
    <>
      <tr><td colSpan={sutun}><strong>{baslik}</strong></td></tr>
      {children}
    </>
  );
}
