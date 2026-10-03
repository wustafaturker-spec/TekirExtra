"use client";

/**
 * KRD-01…08: banka kredileri. Solda krediler (kalan anapara, sıradaki taksit,
 * gecikme), sağda seçili kredinin planı, işlemleri ve eylemleri.
 */
import { useCallback, useEffect, useState } from "react";
import { yillikFaizKarsiligi } from "@tekirextra/shared";
import { api, tokenAl } from "@/lib/api";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { Alert, Badge, Button, ButtonLabel, Card, Input, PageHeader, Para, TableWrap, Tarih } from "@/components/ui";
import { YeniKredi } from "./yeni-kredi";
import { IslemFormu, type AcikTaksit, type IslemTipi } from "./islem-formu";

interface Banka { id: string; ad: string; bankaAdi: string; dovizCinsi: string; aktif: boolean }
interface KrediOzeti {
  id: string; ad: string; tur: "taksitli" | "spot" | "rotatif"; planTuru: string | null; dovizCinsi: string; bankaHesapId: string; anapara: string; aylikFaiz: string; bsmvOrani: string; kkdfOrani: string;
  kullanimTarihi: string; vadeTarihi: string | null; taksitSayisi: number | null; tahsisUcreti: string; durum: string; aciklama: string | null;
  kalanAnapara: string; kullanilabilir: string | null; odenenTaksit: number; gecikenTaksit: number;
  siradakiTaksit: { id: string; sira: number; vadeTarihi: string; toplam: string } | null;
  banka: { id: string; ad: string; bankaAdi: string } | null;
}
interface KrediAyrinti extends KrediOzeti {
  taksitler: Array<AcikTaksit & { islemId: string | null; gecikti: boolean }>;
  islemler: Array<{ id: string; tip: IslemTipi; tarih: string; anapara: string; faiz: string; bsmv: string; kkdf: string; masraf: string; tutar: string | null; ekstreyeBagli: boolean; aciklama: string | null; banka: { id: string; ad: string; bankaAdi: string } | null }>;
}

const TUR = { taksitli: "Taksitli", spot: "Spot", rotatif: "Rotatif" };
const ISLEM = { kullanim: "Kullanım", taksit: "Taksit ödemesi", geri_odeme: "Anapara geri ödemesi", faiz: "Faiz tahsili" };

export default function KredilerSayfasi() {
  const [krediler, setKrediler] = useState<KrediOzeti[]>([]);
  const [bankalar, setBankalar] = useState<Banka[]>([]);
  const [secili, setSecili] = useState<KrediAyrinti | null>(null);
  const [panel, setPanel] = useState<null | { tur: "yeni" } | { tur: "islem"; tip: IslemTipi; taksit?: AcikTaksit }>(null);
  const [planDuzenle, setPlanDuzenle] = useState<Record<string, Partial<AcikTaksit>> | null>(null);
  const [mesaj, setMesaj] = useState<{ tur: "success" | "error"; metin: string } | null>(null);

  const listele = useCallback(async () => {
    const [k, b] = await Promise.all([api<KrediOzeti[]>("/kasa-banka/krediler"), api<Banka[]>("/kasa-banka/bankalar")]);
    setKrediler(k);
    setBankalar(b);
    return k;
  }, []);
  const ac = useCallback(async (id: string) => {
    setSecili(await api<KrediAyrinti>(`/kasa-banka/krediler/${id}`));
    setPlanDuzenle(null);
  }, []);
  useEffect(() => {
    if (!tokenAl()) return;
    void listele().then((k) => {
      const istenen = new URLSearchParams(location.search).get("kredi");
      const ilk = istenen ?? k.find((x) => x.durum === "aktif")?.id;
      if (ilk) void ac(ilk);
    }).catch((e) => setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Krediler yüklenemedi" }));
  }, [listele, ac]);

  async function yenile(mesajMetni: string, id = secili?.id) {
    setPanel(null);
    setMesaj({ tur: "success", metin: mesajMetni });
    await listele();
    if (id) await ac(id);
  }
  async function geriAl(islemId: string) {
    if (!secili) return;
    try {
      setSecili(await api<KrediAyrinti>(`/kasa-banka/krediler/islemler/${islemId}/geri-al`, { method: "POST" }));
      setMesaj({ tur: "success", metin: "İşlem geri alındı; banka hareketi ve masrafı silindi." });
      await listele();
    } catch (e) {
      setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Geri alınamadı" });
    }
  }
  async function sil() {
    if (!secili) return;
    try {
      await api(`/kasa-banka/krediler/${secili.id}`, { method: "DELETE" });
      setSecili(null);
      setMesaj({ tur: "success", metin: "Kredi ve kullanım hareketi silindi." });
      await listele();
    } catch (e) {
      setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Silinemedi" });
    }
  }
  async function planKaydet() {
    if (!secili || !planDuzenle) return;
    try {
      const satirlar = secili.taksitler.filter((t) => !t.islemId).map((t) => ({ id: t.id, vadeTarihi: planDuzenle[t.id]?.vadeTarihi ?? t.vadeTarihi, anapara: planDuzenle[t.id]?.anapara ?? t.anapara, faiz: planDuzenle[t.id]?.faiz ?? t.faiz, bsmv: planDuzenle[t.id]?.bsmv ?? t.bsmv, kkdf: planDuzenle[t.id]?.kkdf ?? t.kkdf }));
      setSecili(await api<KrediAyrinti>(`/kasa-banka/krediler/${secili.id}/plan`, { method: "PATCH", body: JSON.stringify({ satirlar }) }));
      setPlanDuzenle(null);
      setMesaj({ tur: "success", metin: "Ödeme planı güncellendi." });
      await listele();
    } catch (e) {
      setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Plan kaydedilemedi" });
    }
  }

  const yillik = secili ? yillikFaizKarsiligi(Number(secili.aylikFaiz)) : null;
  return (
    <div className="kredi-page">
      <PageHeader
        title="Banka kredileri"
        subtitle="Taksitli, spot ve rotatif kredilerin ödeme planı, taksit ödemeleri ve kalan borcu. Ödemeler banka hesabına, faiz ve vergiler Finansman Giderleri'ne işlenir."
        actions={<><ButtonLabel as="a" href="/panel/kasa-banka">← Kasa & Banka</ButtonLabel><Button variant="primary" onClick={() => setPanel({ tur: "yeni" })}>+ Yeni kredi</Button></>}
      />
      {mesaj && <Alert tone={mesaj.tur}>{mesaj.metin}</Alert>}
      <div className="kredi-duzen">
        <section className="kredi-liste" aria-label="Krediler">
          {krediler.map((k) => (
            <button key={k.id} type="button" className={`kredi-kart${secili?.id === k.id ? " is-secili" : ""}${k.durum !== "aktif" ? " is-kapali" : ""}`} onClick={() => void ac(k.id)}>
              <span className="kredi-kart__ust"><strong>{k.ad}</strong><Badge variant={k.durum !== "aktif" ? "neutral" : k.gecikenTaksit ? "danger" : "info"}>{k.durum !== "aktif" ? "Kapandı" : k.gecikenTaksit ? `${k.gecikenTaksit} taksit gecikti` : TUR[k.tur]}</Badge></span>
              <small>{k.banka?.bankaAdi} · {k.banka?.ad}</small>
              <span className="kredi-kart__alt">
                <span>Kalan anapara<strong><Para deger={k.kalanAnapara} dovizCinsi={k.dovizCinsi} /></strong></span>
                {k.tur === "rotatif"
                  ? <span>Kullanılabilir<strong><Para deger={k.kullanilabilir ?? "0"} dovizCinsi={k.dovizCinsi} /></strong></span>
                  : k.siradakiTaksit && <span>Sıradaki taksit<strong><Tarih deger={k.siradakiTaksit.vadeTarihi} /> · <Para deger={k.siradakiTaksit.toplam} dovizCinsi={k.dovizCinsi} /></strong></span>}
              </span>
            </button>
          ))}
          {!krediler.length && <p className="kredi-bos">Henüz kredi yok. "Yeni kredi" ile banka kredinizi ve ödeme planını girin.</p>}
        </section>

        {secili && (
          <section className="kredi-ayrinti" aria-label={`${secili.ad} ayrıntısı`}>
            <Card
              title={<div><span className="kredi-ust">{TUR[secili.tur].toUpperCase()} KREDİ</span><h2>{secili.ad}</h2><small>{secili.banka?.bankaAdi} · {secili.banka?.ad}{secili.aciklama ? ` · ${secili.aciklama}` : ""}</small></div>}
              actions={
                <div className="kredi-eylem">
                  {secili.tur === "rotatif" && secili.durum === "aktif" && (
                    <>
                      <Button size="sm" variant="primary" onClick={() => setPanel({ tur: "islem", tip: "kullanim" })}>Kullan</Button>
                      <Button size="sm" onClick={() => setPanel({ tur: "islem", tip: "geri_odeme" })}>Geri öde</Button>
                      <Button size="sm" onClick={() => setPanel({ tur: "islem", tip: "faiz" })}>Faiz tahsili</Button>
                    </>
                  )}
                  {(secili.tur === "rotatif" ? secili.islemler.length === 0 : secili.islemler.length <= 1) && <Button size="sm" variant="danger" onClick={() => void sil()}>Krediyi sil</Button>}
                </div>
              }
            >
              <dl className="kredi-ozet">
                <div><dt>{secili.tur === "rotatif" ? "Limit" : "Kredi tutarı"}</dt><dd><Para deger={secili.anapara} dovizCinsi={secili.dovizCinsi} /></dd></div>
                <div><dt>Kalan anapara</dt><dd><Para deger={secili.kalanAnapara} dovizCinsi={secili.dovizCinsi} /></dd></div>
                <div><dt>Faiz</dt><dd>aylık %{Number(secili.aylikFaiz).toLocaleString("tr-TR")} <small>(yıllık %{yillik?.nominal}, bileşik %{yillik?.efektif})</small></dd></div>
                <div><dt>Vergiler</dt><dd>BSMV %{Number(secili.bsmvOrani)} · KKDF %{Number(secili.kkdfOrani)}</dd></div>
                <div><dt>{secili.tur === "rotatif" ? "Açılış" : "Kullanım"}</dt><dd><Tarih deger={secili.kullanimTarihi} /></dd></div>
                {secili.vadeTarihi && <div><dt>Son vade</dt><dd><Tarih deger={secili.vadeTarihi} /></dd></div>}
                {secili.tur !== "rotatif" && <div><dt>Ödenen</dt><dd>{secili.odenenTaksit} / {secili.taksitler.length} taksit</dd></div>}
              </dl>
            </Card>

            {secili.tur !== "rotatif" && (
              <Card
                pad={false}
                title={<div><span className="kredi-ust">PLAN</span><h2>Ödeme planı</h2></div>}
                actions={planDuzenle
                  ? <div className="kredi-eylem"><Button size="sm" onClick={() => setPlanDuzenle(null)}>Vazgeç</Button><Button size="sm" variant="primary" onClick={() => void planKaydet()}>Planı kaydet</Button></div>
                  : secili.taksitler.some((t) => !t.islemId) && <Button size="sm" onClick={() => setPlanDuzenle({})}>Planı düzenle</Button>}
              >
                <TableWrap>
                  <thead><tr><th>#</th><th>Vade</th><th className="num">Anapara</th><th className="num">Faiz</th><th className="num">BSMV+KKDF</th><th className="num">Taksit</th><th>Durum</th></tr></thead>
                  <tbody>
                    {secili.taksitler.map((t) => {
                      const duzenle = planDuzenle && !t.islemId;
                      const alan = (k: "anapara" | "faiz" | "bsmv" | "kkdf") => <Input className="kredi-tutar" inputMode="decimal" aria-label={`${t.sira}. taksit ${k}`} value={planDuzenle?.[t.id]?.[k] ?? t[k]} onChange={(e) => setPlanDuzenle({ ...planDuzenle, [t.id]: { ...planDuzenle?.[t.id], [k]: e.target.value } })} />;
                      return (
                        <tr key={t.id} className={t.islemId ? "is-odendi" : t.gecikti ? "is-gecikti" : ""}>
                          <td>{t.sira}</td>
                          <td>{duzenle ? <Input type="date" aria-label={`${t.sira}. taksit vadesi`} value={planDuzenle?.[t.id]?.vadeTarihi ?? t.vadeTarihi} onChange={(e) => setPlanDuzenle({ ...planDuzenle, [t.id]: { ...planDuzenle?.[t.id], vadeTarihi: e.target.value } })} /> : <Tarih deger={t.vadeTarihi} />}</td>
                          <td className="num">{duzenle ? alan("anapara") : <Para deger={t.anapara} dovizCinsi={secili.dovizCinsi} />}</td>
                          <td className="num">{duzenle ? alan("faiz") : <Para deger={t.faiz} dovizCinsi={secili.dovizCinsi} />}</td>
                          <td className="num">{duzenle ? <span className="kredi-iki">{alan("bsmv")}{alan("kkdf")}</span> : <Para deger={(Number(t.bsmv) + Number(t.kkdf)).toFixed(2)} dovizCinsi={secili.dovizCinsi} />}</td>
                          <td className="num"><strong><Para deger={t.toplam} dovizCinsi={secili.dovizCinsi} /></strong></td>
                          <td>
                            {t.islemId ? <Badge variant="success">Ödendi</Badge>
                              : !planDuzenle && <Button size="sm" variant={t.gecikti ? "danger" : undefined} onClick={() => setPanel({ tur: "islem", tip: "taksit", taksit: t })}>{t.gecikti ? "Gecikti · öde" : "Öde"}</Button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableWrap>
              </Card>
            )}

            <Card pad={false} title={<div><span className="kredi-ust">HAREKETLER</span><h2>İşlemler</h2></div>}>
              <TableWrap>
                <thead><tr><th>Tarih</th><th>İşlem</th><th>Hesap</th><th className="num">Anapara</th><th className="num">Faiz + vergi</th><th className="num">Banka</th><th /></tr></thead>
                <tbody>
                  {secili.islemler.map((i) => (
                    <tr key={i.id}>
                      <td><Tarih deger={i.tarih} /></td>
                      <td>{ISLEM[i.tip]}{i.aciklama && <small className="kredi-alt"> {i.aciklama}</small>}{Number(i.masraf) > 0 && <small className="kredi-alt"> · tahsis ücreti <Para deger={i.masraf} dovizCinsi={secili.dovizCinsi} /></small>}</td>
                      <td>{i.banka ? `${i.banka.bankaAdi} · ${i.banka.ad}` : "—"}</td>
                      <td className="num"><Para deger={i.anapara} dovizCinsi={secili.dovizCinsi} /></td>
                      <td className="num"><Para deger={(Number(i.faiz) + Number(i.bsmv) + Number(i.kkdf)).toFixed(2)} dovizCinsi={secili.dovizCinsi} /></td>
                      <td className="num">{i.tutar && <span className={i.tip === "kullanim" ? "treasury-in" : "treasury-out"}>{i.tip === "kullanim" ? "+" : "−"}<Para deger={i.tutar} dovizCinsi={secili.dovizCinsi} /></span>}</td>
                      <td>{(i.tip !== "kullanim" || secili.tur === "rotatif") && (i.ekstreyeBagli ? <small className="kredi-alt">ekstreye bağlı</small> : <Button size="sm" onClick={() => void geriAl(i.id)}>Geri al</Button>)}</td>
                    </tr>
                  ))}
                  {!secili.islemler.length && <tr><td colSpan={7} className="kredi-bos">Henüz işlem yok.</td></tr>}
                </tbody>
              </TableWrap>
            </Card>
          </section>
        )}
      </div>

      {panel?.tur === "yeni" && (
        <HizliKayitPaneli baslik="Yeni banka kredisi" onKapat={() => setPanel(null)}>
          <YeniKredi bankalar={bankalar} onKaydedildi={(id) => void yenile("Kredi kaydedildi; kullanım tutarı banka hesabına işlendi.", id)} />
        </HizliKayitPaneli>
      )}
      {panel?.tur === "islem" && secili && (
        <HizliKayitPaneli baslik={`${secili.ad} · ${ISLEM[panel.tip]}`} onKapat={() => setPanel(null)}>
          <IslemFormu krediId={secili.id} krediHesapId={secili.bankaHesapId} bankalar={bankalar} dovizCinsi={secili.dovizCinsi} tip={panel.tip} taksit={panel.taksit} onTamam={(m) => void yenile(m)} />
        </HizliKayitPaneli>
      )}
    </div>
  );
}
