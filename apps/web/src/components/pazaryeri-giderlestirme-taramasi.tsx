"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, TableWrap } from "@/components/ui";

/**
 * PZR-11: eski giderleştirmelerin taraması. PZR-06 öncesinde faturalı kesinti
 * de doğrudan gider (760) hareketine dönüştürülebiliyordu; aynı ayın komisyon
 * e-Faturası da alış olarak işlendiyse gider iki kez yazılmıştır. Rapor
 * otomatik düzeltmez; geri alma kullanıcı onayıyla yapılır.
 */
interface Kayit { id: string; tur: string; sinif: string; tarih: string; tutar: string; dovizCinsi: string; siparisNo: string | null; saglayici: string; hareketTry: string }
interface Aday extends Kayit { faturalar: { id: string; belgeNo: string; tarih: string; toplam: string | null }[] }
interface Tarama { ciftKayitAdaylari: Aday[]; yanlisHesapStopaj: Kayit[]; faturasiBulunamayan: Kayit[]; denetlenemeyen: number }

const para = (v: string | number, d = "TRY") => Number(v).toLocaleString("tr-TR", { style: "currency", currency: d });
const tarih = (v: string) => new Date(v).toLocaleDateString("tr-TR");

export function PazaryeriGiderlestirmeTaramasi({ onDegisti, yenile }: { onDegisti?: () => void | Promise<void>; yenile?: number }) {
  const [tarama, setTarama] = useState<Tarama | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [islem, setIslem] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    try { setTarama(await api<Tarama>("/pazaryeri/kesintiler/giderlestirme-taramasi")); }
    catch (e) { setHata(e instanceof Error ? e.message : "Tarama yüklenemedi"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle, yenile]);

  if (!tarama) return hata ? <Alert tone="error">{hata}</Alert> : null;
  const bos = !tarama.ciftKayitAdaylari.length && !tarama.yanlisHesapStopaj.length && !tarama.faturasiBulunamayan.length && !tarama.denetlenemeyen;
  if (bos && !basari) return null;

  const sec = (id: string, deger: boolean) => setSecili((x) => { const s = new Set(x); if (deger) s.add(id); else s.delete(id); return s; });
  async function geriAl() {
    if (!secili.size) return setHata("Geri alınacak kayıt seçin.");
    if (!confirm(`${secili.size} kesintinin giderleştirmesi geri alınacak. Hareketin mali dönemi açıksa kasa/banka hareketi silinir, kapalıysa bugünün tarihiyle ters kayıt atılır. Kesintiler bekleyene döner: faturalı olanlar komisyon faturasıyla eşleştirilir, stopaj "Stopajı kaydet" ile 193'e yeniden yazılır. Devam edilsin mi?`)) return;
    setIslem(true); setHata(""); setBasari("");
    try {
      const r = await api<{ geriAlinan: number; silinen: number; tersKayit: number }>("/pazaryeri/kesintiler/giderlestirme-geri-al", { method: "POST", body: JSON.stringify({ kesintiIds: [...secili] }) });
      setBasari(`${r.geriAlinan} giderleştirme geri alındı (${r.silinen} hareket silindi, ${r.tersKayit} ters kayıt).`);
      setSecili(new Set());
      await yukle(); await onDegisti?.();
    } catch (e) { setHata(e instanceof Error ? e.message : "Geri alma başarısız"); }
    finally { setIslem(false); }
  }

  const satir = (k: Kayit, ek?: React.ReactNode) => (
    <tr key={k.id}>
      <td><input type="checkbox" aria-label={`${k.tur} giderleştirmesini geri almak için seç`} checked={secili.has(k.id)} onChange={(e) => sec(k.id, e.target.checked)} /></td>
      <td>{tarih(k.tarih)}</td><td>{k.tur}{k.siparisNo ? <small> · {k.siparisNo}</small> : null}</td>
      <td className="num">{para(k.tutar, k.dovizCinsi)}</td><td>{ek ?? "—"}</td>
    </tr>
  );

  return (
    <Card title="Eski giderleştirmeler (çift kayıt taraması)" pad={false}>
      <div style={{ display: "grid", gap: "0.6rem", padding: "0.75rem 1rem" }}>
        <small className="subtle">Bu kayıtlar, kuralın değişmesinden önce kasa/banka gider hareketine dönüştürülmüş kesintilerdir. Rapor hiçbir şeyi kendiliğinden düzeltmez; geri almak istediklerinizi seçip onaylayın.</small>
        {hata && <Alert tone="error">{hata}</Alert>}
        {basari && <Alert tone="success">{basari}</Alert>}
        {tarama.denetlenemeyen > 0 && <Alert tone="warning">{tarama.denetlenemeyen} giderleştirilmiş kesintinin bağlantısında fatura kesen VKN yok; çift kayıt denetlenemedi. VKN'yi "Komisyon faturası eşleştirme" kartından girin.</Alert>}
      </div>
      {tarama.ciftKayitAdaylari.length > 0 && <>
        <div style={{ padding: "0 1rem" }}><strong>Olası çift kayıt</strong> <small className="subtle">— aynı ayın komisyon faturası alış olarak işlenmiş; gider iki kez yazılmış olabilir.</small></div>
        <TableWrap><thead><tr><th>Seç</th><th>Tarih</th><th>Tür</th><th className="num">Tutar</th><th>Aynı ayın işlenmiş faturası</th></tr></thead>
          <tbody>{tarama.ciftKayitAdaylari.map((k) => satir(k, k.faturalar.map((f) => `${f.belgeNo} (${tarih(f.tarih)}${f.toplam ? ` · ${para(f.toplam, k.dovizCinsi)}` : ""})`).join(", ")))}</tbody></TableWrap>
      </>}
      {tarama.yanlisHesapStopaj.length > 0 && <>
        <div style={{ padding: "0.75rem 1rem 0" }}><strong>Gider olarak yazılmış stopaj</strong> <small className="subtle">— 193 yerine 760'a gitmiş; geri alıp "Stopajı kaydet" ile yeniden kaydedin.</small></div>
        <TableWrap><thead><tr><th>Seç</th><th>Tarih</th><th>Tür</th><th className="num">Tutar</th><th></th></tr></thead>
          <tbody>{tarama.yanlisHesapStopaj.map((k) => satir(k))}</tbody></TableWrap>
      </>}
      {tarama.faturasiBulunamayan.length > 0 && <>
        <div style={{ padding: "0.75rem 1rem 0" }}><strong>Faturası bulunamayan giderleştirmeler</strong> <small className="subtle">— aynı ay işlenmiş komisyon faturası yok; çift kayıt değil, bilgi için.</small></div>
        <TableWrap><thead><tr><th>Seç</th><th>Tarih</th><th>Tür</th><th className="num">Tutar</th><th></th></tr></thead>
          <tbody>{tarama.faturasiBulunamayan.map((k) => satir(k))}</tbody></TableWrap>
      </>}
      {(tarama.ciftKayitAdaylari.length + tarama.yanlisHesapStopaj.length + tarama.faturasiBulunamayan.length) > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0.75rem 1rem" }}>
          <Button variant="danger" disabled={islem || !secili.size} onClick={() => void geriAl()}>{islem ? "Geri alınıyor…" : `Seçilenleri geri al (${secili.size})`}</Button>
        </div>
      )}
    </Card>
  );
}
