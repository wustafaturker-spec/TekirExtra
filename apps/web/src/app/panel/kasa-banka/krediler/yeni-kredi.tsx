"use client";

import { useMemo, useState } from "react";
import { ayEkle, bugunTR, krediPlaniHesapla, yillikFaizKarsiligi, type KrediPlanSatiri } from "@tekirextra/shared";
import { api, ApiHata } from "@/lib/api";
import { Alert, Button, Field, Input, Select, TableWrap } from "@/components/ui";

interface Banka { id: string; ad: string; bankaAdi: string; dovizCinsi: string; aktif: boolean }
type Tur = "taksitli" | "spot" | "rotatif";

const sayi = (v: string) => Number(String(v).replace(",", ".")) || 0;
const para = (v: number) => v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * KRD-01/02: yeni kredi. Taksitli ve spotta plan ekranda hesaplanır, satırlar
 * bankanın planına göre düzeltilebilir; kayıtta düzeltilmiş plan gönderilir.
 */
export function YeniKredi({ bankalar, onKaydedildi }: { bankalar: Banka[]; onKaydedildi: (id: string) => void }) {
  const aktifler = bankalar.filter((b) => b.aktif);
  const [f, setF] = useState({
    bankaHesapId: aktifler[0]?.id ?? "", ad: "", tur: "taksitli" as Tur, planTuru: "esit_taksit" as "esit_taksit" | "esit_anapara",
    anapara: "", aylikFaiz: "", bsmvOrani: "5", kkdfOrani: "0", kullanimTarihi: bugunTR(), taksitSayisi: "12",
    ilkTaksitTarihi: ayEkle(bugunTR(), 1), vadeTarihi: ayEkle(bugunTR(), 3), tahsisUcreti: "0", aciklama: "",
  });
  const [duzeltme, setDuzeltme] = useState<Record<number, Partial<Record<keyof KrediPlanSatiri, string>>>>({});
  const [hata, setHata] = useState("");
  const [eksiOnay, setEksiOnay] = useState<string | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const guncelle = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setDuzeltme({}); };
  const banka = aktifler.find((b) => b.id === f.bankaHesapId);

  const hesaplanan = useMemo(() => (f.tur === "rotatif" || !sayi(f.anapara) ? [] : krediPlaniHesapla({
    tur: f.tur, planTuru: f.planTuru, anapara: sayi(f.anapara), aylikFaiz: sayi(f.aylikFaiz), bsmvOrani: sayi(f.bsmvOrani), kkdfOrani: sayi(f.kkdfOrani),
    kullanimTarihi: f.kullanimTarihi, taksitSayisi: Math.max(1, Math.floor(sayi(f.taksitSayisi))), ilkTaksitTarihi: f.ilkTaksitTarihi || undefined, vadeTarihi: f.vadeTarihi,
  })), [f]);
  const plan = hesaplanan.map((s) => {
    const d = duzeltme[s.sira] ?? {};
    const deger = (k: "anapara" | "faiz" | "bsmv" | "kkdf") => (d[k] !== undefined ? sayi(d[k]!) : s[k]);
    const satir = { ...s, vadeTarihi: d.vadeTarihi ?? s.vadeTarihi, anapara: deger("anapara"), faiz: deger("faiz"), bsmv: deger("bsmv"), kkdf: deger("kkdf") };
    return { ...satir, toplam: satir.anapara + satir.faiz + satir.bsmv + satir.kkdf };
  });
  const planAnapara = Math.round(plan.reduce((t, s) => t + s.anapara, 0) * 100) / 100;
  const tutmuyor = f.tur !== "rotatif" && plan.length > 0 && Math.abs(planAnapara - sayi(f.anapara)) > 0.004;
  const yillik = yillikFaizKarsiligi(sayi(f.aylikFaiz));

  async function kaydet(e: React.FormEvent, onayli = false) {
    e.preventDefault();
    setHata("");
    setKaydediliyor(true);
    try {
      const sonuc = await api<{ id: string }>("/kasa-banka/krediler", {
        method: "POST",
        body: JSON.stringify({
          ...f, aylikFaiz: sayi(f.aylikFaiz), bsmvOrani: sayi(f.bsmvOrani), kkdfOrani: sayi(f.kkdfOrani), taksitSayisi: sayi(f.taksitSayisi) || null,
          anapara: String(sayi(f.anapara)), tahsisUcreti: String(sayi(f.tahsisUcreti)), aciklama: f.aciklama || null,
          vadeTarihi: f.tur === "spot" || f.tur === "rotatif" ? f.vadeTarihi || null : null,
          plan: f.tur === "rotatif" ? undefined : plan.map((s) => ({ vadeTarihi: s.vadeTarihi, anapara: s.anapara.toFixed(2), faiz: s.faiz.toFixed(2), bsmv: s.bsmv.toFixed(2), kkdf: s.kkdf.toFixed(2) })),
          eksiBakiyeOnay: onayli,
        }),
      });
      onKaydedildi(sonuc.id);
    } catch (err) {
      if (err instanceof ApiHata && err.durum === 409 && /eksi bakiye/i.test(err.message)) setEksiOnay(err.message);
      else setHata(err instanceof Error ? err.message : "Kredi kaydedilemedi");
    } finally {
      setKaydediliyor(false);
    }
  }

  const duzelt = (sira: number, alan: keyof KrediPlanSatiri, deger: string) => setDuzeltme({ ...duzeltme, [sira]: { ...duzeltme[sira], [alan]: deger } });

  return (
    <form className="kredi-form" onSubmit={(e) => void kaydet(e)}>
      {hata && <Alert tone="error">{hata}</Alert>}
      {eksiOnay && (
        <Alert tone="warning"><span>{eksiOnay} <Button size="sm" onClick={(e) => void kaydet(e as unknown as React.FormEvent, true)}>Yine de kaydet</Button></span></Alert>
      )}
      <div className="kredi-form__alanlar">
        <Field label="Banka hesabı">
          <Select value={f.bankaHesapId} onChange={(e) => guncelle({ bankaHesapId: e.target.value })} required>
            {aktifler.map((b) => <option key={b.id} value={b.id}>{b.bankaAdi} · {b.ad} ({b.dovizCinsi})</option>)}
          </Select>
        </Field>
        <Field label="Kredi adı / no"><Input value={f.ad} onChange={(e) => guncelle({ ad: e.target.value })} required minLength={2} maxLength={120} placeholder="ör. Ticari kredi 2026/14" /></Field>
        <Field label="Tür">
          <Select value={f.tur} onChange={(e) => guncelle({ tur: e.target.value as Tur })}>
            <option value="taksitli">Taksitli</option><option value="spot">Spot (vadede tek ödeme)</option><option value="rotatif">Rotatif (limitli)</option>
          </Select>
        </Field>
        <Field label={f.tur === "rotatif" ? `Limit (${banka?.dovizCinsi ?? ""})` : `Kredi tutarı (${banka?.dovizCinsi ?? ""})`}><Input inputMode="decimal" value={f.anapara} onChange={(e) => guncelle({ anapara: e.target.value })} required /></Field>
        <Field label={`Aylık faiz % ${sayi(f.aylikFaiz) ? `(yıllık ${yillik.nominal}, bileşik ${yillik.efektif})` : ""}`}><Input inputMode="decimal" value={f.aylikFaiz} onChange={(e) => guncelle({ aylikFaiz: e.target.value })} required /></Field>
        <Field label="BSMV %"><Input inputMode="decimal" value={f.bsmvOrani} onChange={(e) => guncelle({ bsmvOrani: e.target.value })} /></Field>
        <Field label="KKDF %"><Input inputMode="decimal" value={f.kkdfOrani} onChange={(e) => guncelle({ kkdfOrani: e.target.value })} /></Field>
        <Field label={f.tur === "rotatif" ? "Açılış tarihi" : "Kullanım tarihi"}><Input type="date" value={f.kullanimTarihi} onChange={(e) => guncelle({ kullanimTarihi: e.target.value })} required /></Field>
        {f.tur === "taksitli" && (
          <>
            <Field label="Plan"><Select value={f.planTuru} onChange={(e) => guncelle({ planTuru: e.target.value as typeof f.planTuru })}><option value="esit_taksit">Eşit taksit</option><option value="esit_anapara">Eşit anapara</option></Select></Field>
            <Field label="Taksit sayısı"><Input type="number" min={1} max={360} value={f.taksitSayisi} onChange={(e) => guncelle({ taksitSayisi: e.target.value })} /></Field>
            <Field label="İlk taksit"><Input type="date" min={f.kullanimTarihi} value={f.ilkTaksitTarihi} onChange={(e) => guncelle({ ilkTaksitTarihi: e.target.value })} /></Field>
          </>
        )}
        {f.tur !== "taksitli" && <Field label={f.tur === "spot" ? "Vade tarihi" : "Limit bitişi (isteğe bağlı)"}><Input type="date" min={f.kullanimTarihi} value={f.vadeTarihi} onChange={(e) => guncelle({ vadeTarihi: e.target.value })} required={f.tur === "spot"} /></Field>}
        {f.tur !== "rotatif" && <Field label="Tahsis ücreti / masraf"><Input inputMode="decimal" value={f.tahsisUcreti} onChange={(e) => guncelle({ tahsisUcreti: e.target.value })} /></Field>}
        <Field label="Açıklama"><Input value={f.aciklama} maxLength={500} onChange={(e) => setF({ ...f, aciklama: e.target.value })} /></Field>
      </div>

      {f.tur !== "rotatif" && plan.length > 0 && (
        <>
          <p className="kredi-form__not">
            Hesaba geçecek: <strong>{para(sayi(f.anapara) - sayi(f.tahsisUcreti))} {banka?.dovizCinsi}</strong> · Toplam geri ödeme: <strong>{para(plan.reduce((t, s) => t + s.toplam, 0))}</strong>.
            Bankanın planı farklıysa satırları düzeltin; anapara toplamı kredi tutarıyla tutmalıdır.
          </p>
          <TableWrap>
            <thead><tr><th>#</th><th>Vade</th><th className="num">Anapara</th><th className="num">Faiz</th><th className="num">BSMV</th><th className="num">KKDF</th><th className="num">Taksit</th></tr></thead>
            <tbody>
              {plan.map((s) => (
                <tr key={s.sira}>
                  <td>{s.sira}</td>
                  <td><Input type="date" aria-label={`${s.sira}. taksit vadesi`} value={s.vadeTarihi} onChange={(e) => duzelt(s.sira, "vadeTarihi", e.target.value)} /></td>
                  {(["anapara", "faiz", "bsmv", "kkdf"] as const).map((k) => (
                    <td key={k} className="num"><Input className="kredi-tutar" inputMode="decimal" aria-label={`${s.sira}. taksit ${k}`} value={duzeltme[s.sira]?.[k] ?? s[k].toFixed(2)} onChange={(e) => duzelt(s.sira, k, e.target.value)} /></td>
                  ))}
                  <td className="num">{para(s.toplam)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {tutmuyor && <Alert tone="error">Plandaki anapara toplamı {para(planAnapara)}, kredi tutarı {para(sayi(f.anapara))}.</Alert>}
        </>
      )}
      <footer className="kredi-form__alt">
        <Button type="submit" variant="primary" disabled={kaydediliyor || tutmuyor || !f.bankaHesapId}>{kaydediliyor ? "Kaydediliyor…" : "Krediyi kaydet"}</Button>
      </footer>
    </form>
  );
}
