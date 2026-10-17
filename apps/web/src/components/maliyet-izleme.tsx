"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Stat, StatGrid } from "@/components/ui";
import { maliyetOlcumunuDogrula, olcumSayiBicimi, type MaliyetOlcumu } from "@/lib/maliyet-olcum";
import { MaliyetOlcumKarsilastirma } from "@/components/maliyet-olcum-karsilastirma";

export function MaliyetIzleme({ baslangic, bitis }: { baslangic: string; bitis: string }) {
  const [veri, setVeri] = useState<MaliyetOlcumu | null>(null), [hata, setHata] = useState("");
  useEffect(() => {
    let etkin = true;
    void api<unknown>(`/rapor/maliyet-eksikleri/izleme?${new URLSearchParams({ baslangic, bitis })}`)
      .then((r) => {
        const olcum = maliyetOlcumunuDogrula(r);
        if (olcum.baslangic !== baslangic || olcum.bitis !== bitis) throw new Error("Ölçüm yanıtının satış dönemi istenen dönemle uyuşmuyor. Yenileyin.");
        return olcum;
      })
      .then((r) => { if (etkin) setVeri(r); })
      .catch((e) => { if (etkin) setHata(e instanceof Error ? e.message : "Dönem inceleme özeti alınamadı."); });
    return () => { etkin = false; };
  }, [baslangic, bitis]);
  function indir() {
    if (!veri) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(veri, null, 2)], { type: "application/json;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url;
    a.download = `maliyet-olcumu_${veri.baslangic}_${veri.bitis}_${veri.alindigiZaman.replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Card><section aria-label="Dönem inceleme özeti" className="stack">
    <h2>Dönem inceleme özeti</h2>
    <p className="muted">Satış belgesi dönemi: {baslangic} – {bitis}. Ürün, bulgu ve sayfa filtreleri bu özete uygulanmaz. İncelemeler açılış veya kapanış tarihine göre ayrıca süzülmez.</p>
    <Alert tone="error">{hata}</Alert>
    {!veri && !hata && <p role="status">İnceleme ölçümü yükleniyor…</p>}
    {veri && <>
      <p>{veri.firma.unvan} · Ölçüm zamanı: {new Date(veri.alindigiZaman).toLocaleString("tr-TR")} · Mod: {veri.kullanimModu}</p>
      <StatGrid>
        <Stat label="Uyarı verilen satış satırı" value={veri.uyari.satir} hint={<>İlgili ciro {olcumSayiBicimi(veri.uyari.ciro)} TRY</>} />
        <Stat label="Aktif takibi olmayan uyarı" value={veri.uyari.aktifTakipsizSatir} hint={`${veri.uyari.aktifTakipliSatir} uyarının aktif takibi var`} />
        <Stat label="Doğrulanmış kapanış kaydı" value={veri.incelemeler.dogrulanmisKapanis} />
        <Stat label="Medyan inceleme süresi" value={veri.incelemeler.medyanSureSaniye === null ? "Henüz ölçüm yok" : `${olcumSayiBicimi(veri.incelemeler.medyanSureSaniye.replace(/0+$/, "").replace(/\.$/, ""))} saniye`} hint={`${veri.incelemeler.sureOrnekSayisi} doğrulanmış kapanıştan`} />
      </StatGrid>
      <p>Kapsam: {veri.kapsam.malSatisSatiri} kesin mal satış satırı; {veri.kapsam.takipliKaynakSatiri} satırda inceleme geçmişi. İnceleme kayıtları: {veri.incelemeler.acik} açık, {veri.incelemeler.incelemede} incelemede, {veri.incelemeler.beklemede} beklemede, {veri.incelemeler.digerKapanis} doğrulama olayı olmayan kapalı, {veri.incelemeler.yoksayildi} yoksayılmış.</p>
      {veri.incelemeler.sureDisiKayit > 0 && <Alert tone="warning">{veri.incelemeler.sureDisiKayit} kapanışın tarih sırası uygun olmadığı için süresi ölçüme katılmadı.</Alert>}
      <p className="muted">Süre, inceleme kaydının açılışından ilk kayıtlı maliyet doğrulama olayına kadar geçen takvim süresidir. Yeniden açılan incelemeler ayrı kayıt sayılır. Uyarı azalması maliyet doğruluğunu veya kâr artışını tek başına kanıtlamaz.</p>
      <p className="muted">Bu anlık ölçüm dosyası baz/sonuç karşılaştırması için saklanabilir. Karşılaştırırken şirket ve satış dönemini aynı tutun; arada değişen veya taslağa alınan faturalar kapsamı değiştirebilir. Dosya kişisel notları içermez.</p>
      <div><Button onClick={indir}>Ölçüm dosyasını indir (JSON)</Button></div>
      <MaliyetOlcumKarsilastirma guncel={veri} />
    </>}
  </section></Card>;
}
