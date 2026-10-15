"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, TableWrap } from "@/components/ui";

interface Kaynak {
  faturaId: string; no: string | null; tarih: string; unvan: string;
  netBirimFiyat: string; farkYuzde: string | null;
}
interface Donem { baslangic: string; bitisHaric: string; ortalama: string | null; faturaSayisi: number }
interface Yillik { onceki: Donem; son: Donem; artisYuzde: string | null }
interface Sonuc {
  aciklama: string;
  satirlar: { siraNo: number; ad: string; stokAd: string; uyari: string | null; analiz: {
    netBirimFiyat: string; birim: string; doviz: string; sonAlis: Kaynak | null;
    tedarikciler: (Kaynak & { enDusugeGoreFarkYuzde: string | null })[]; yillik: Yillik; tedarikciYillik: Yillik | null; uyarilar: string[];
  } | null }[];
}
const fiyat = (v: string) => v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "").replace(".", ",") : v;
const yuzde = (v: string | null) => v === null ? "Yeterli veri yok" : `${Number(v) > 0 ? "+" : ""}%${v.replace(".", ",")}`;

export function GelenFiyatAnalizi({ belgeId, eslesmeler }: {
  belgeId: string; eslesmeler: { siraNo: number; stokId: string; varyantId: string | null }[];
}) {
  const [sonuc, setSonuc] = useState<Sonuc | null>(null);
  const [hata, setHata] = useState("");
  const [bekliyor, setBekliyor] = useState(false);
  const anahtar = JSON.stringify({ belgeId, eslesmeler });
  const guncel = useRef(anahtar);
  const surum = useRef(0);
  guncel.current = anahtar;
  useEffect(() => {
    surum.current += 1;
    setSonuc(null); setHata(""); setBekliyor(false);
    return () => { surum.current += 1; };
  }, [anahtar]);
  const analizEt = async () => {
    const istek = anahtar;
    const istekSurumu = ++surum.current;
    const halaGuncel = () => guncel.current === istek && surum.current === istekSurumu;
    setBekliyor(true); setHata(""); setSonuc(null);
    try {
      const s = await api<Sonuc>(`/ebelge/gelen/${belgeId}/fiyat-analizi`, {
        method: "POST", body: JSON.stringify({ satirEslesmeleri: eslesmeler }),
      });
      if (halaGuncel()) setSonuc(s);
    } catch (h) {
      if (halaGuncel()) setHata(h instanceof Error ? h.message : "Fiyat analizi alınamadı");
    } finally { if (halaGuncel()) setBekliyor(false); }
  };
  return <Card style={{ marginTop: "1.25rem" }}>
    <div className="card__title">Tedarikçi ve geçmiş fiyat kontrolü</div>
    <p className="muted">Önce ürün/varyant eşleşmelerini kontrol edin. Analiz yalnız seçili satırları inceler; faturayı değiştirmez ve dış yapay zekâ servisine veri göndermez.</p>
    <Button onClick={() => void analizEt()} disabled={bekliyor || !eslesmeler.length || eslesmeler.length > 100}>
      {bekliyor ? "Karşılaştırılıyor…" : `Fiyatları karşılaştır (${eslesmeler.length} satır)`}
    </Button>
    {eslesmeler.length > 100 && <p>Bir analizde en çok 100 eşleşmiş satır destekleniyor.</p>}
    {hata && <Alert tone="error">{hata}</Alert>}
    {sonuc && <>
      <p className="muted">{sonuc.aciklama}</p>
      {sonuc.satirlar.map((s) => <details key={s.siraNo} style={{ marginTop: "1rem" }} open>
        <summary>{s.siraNo}. {s.ad} → {s.stokAd}{s.analiz && ` · Net ${fiyat(s.analiz.netBirimFiyat)} ${s.analiz.doviz}/${s.analiz.birim}`}</summary>
        {s.uyari && <p>{s.uyari}</p>}
        {s.analiz && <>
          <p>Aynı tedarikçinin son alışına göre: {s.analiz.sonAlis ? <>
            {yuzde(s.analiz.sonAlis.farkYuzde)} · <a href={`/panel/fatura?faturaId=${s.analiz.sonAlis.faturaId}`}>
              {s.analiz.sonAlis.no ?? "Fatura"}</a> ({s.analiz.sonAlis.tarih}), {fiyat(s.analiz.sonAlis.netBirimFiyat)} {s.analiz.doviz}/{s.analiz.birim}
          </> : "Geçmiş alış yok"}</p>
          <p>Son 90 gündeki tedarikçi alışları (en düşükten başlayarak):</p>
          <TableWrap><thead><tr><th>Tedarikçi</th><th>Son alış</th><th>Net birim fiyat</th><th>En ucuz tedarikçiye göre</th><th>Gelen fiyat farkı</th></tr></thead>
            <tbody>{s.analiz.tedarikciler.map((t) => <tr key={t.faturaId}>
              <td>{t.unvan}</td><td><a href={`/panel/fatura?faturaId=${t.faturaId}`}>{t.no ?? "Fatura"}</a> · {t.tarih}</td>
              <td>{fiyat(t.netBirimFiyat)} {s.analiz!.doviz}/{s.analiz!.birim}</td><td>{yuzde(t.enDusugeGoreFarkYuzde)}</td><td>{yuzde(t.farkYuzde)}</td>
            </tr>)}</tbody></TableWrap>
          {[{ ad: "Tüm tedarikçiler", veri: s.analiz.yillik }, { ad: "Aynı tedarikçi", veri: s.analiz.tedarikciYillik }].map(({ ad, veri }) => veri && <div key={ad}>
            <p>{ad} — yıllık ağırlıklı fiyat değişimi: {yuzde(veri.artisYuzde)}</p>
            {[veri.onceki, veri.son].map((d) => <p className="muted" key={d.baslangic}>
              {d.baslangic} ≤ tarih &lt; {d.bitisHaric}: {d.ortalama ? `${fiyat(d.ortalama)} ${s.analiz!.doviz}/${s.analiz!.birim}` : "Veri yok"} ({d.faturaSayisi} fatura)
            </p>)}
          </div>)}
          {s.analiz.uyarilar.map((u) => <p className="muted" key={u}>{u}</p>)}
        </>}
      </details>)}
    </>}
  </Card>;
}
