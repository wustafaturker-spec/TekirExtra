"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Table } from "@/components/ui";
import { maliyetOlcumDosyasiniOku, maliyetOlcumleriniKarsilastir, olcumSayiBicimi, OLCUM_DOSYA_SINIRI, type MaliyetOlcumu } from "@/lib/maliyet-olcum";

export function MaliyetOlcumKarsilastirma({ guncel }: { guncel: MaliyetOlcumu }) {
  const [baz, setBaz] = useState<MaliyetOlcumu | null>(null), [hata, setHata] = useState("");
  const [dosyaAdi, setDosyaAdi] = useState(""), [okunuyor, setOkunuyor] = useState(false);
  const sira = useRef(0), input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { sira.current++; }, []);
  async function dosyaSec(file?: File) {
    const istek = ++sira.current;
    setBaz(null); setHata(""); setDosyaAdi(file?.name ?? ""); setOkunuyor(Boolean(file));
    if (!file) return;
    try {
      if (file.size > OLCUM_DOSYA_SINIRI) throw new Error("Ölçüm dosyası en fazla 64 KB olabilir.");
      const onceki = maliyetOlcumDosyasiniOku(await file.text());
      maliyetOlcumleriniKarsilastir(onceki, guncel);
      if (istek === sira.current) setBaz(onceki);
    } catch (e) { if (istek === sira.current) setHata(e instanceof Error ? e.message : "Ölçüm dosyası okunamadı."); }
    finally { if (istek === sira.current) setOkunuyor(false); }
  }
  let sonuc: ReturnType<typeof maliyetOlcumleriniKarsilastir> | null = null, uyumsuzluk = "";
  if (baz) {
    try { sonuc = maliyetOlcumleriniKarsilastir(baz, guncel); }
    catch (e) { uyumsuzluk = e instanceof Error ? e.message : "Ölçümler karşılaştırılamadı."; }
  }
  return <section aria-label="Ölçüm karşılaştırması" className="stack">
    <h3>Önceki ölçümle karşılaştır</h3>
    <p className="muted">Aynı şirket, satış dönemi ve satış satırı kapsamıyla daha önce indirdiğiniz ölçümü seçin. Dosya tarayıcıda okunur; sunucuya yüklenmez. En fazla 64 KB JSON dosyası kabul edilir.</p>
    <div><label htmlFor="maliyet-baz-dosyasi">Önceki ölçüm dosyası</label><br />
      <input ref={input} id="maliyet-baz-dosyasi" type="file" accept=".json,application/json" onChange={(e) => void dosyaSec(e.target.files?.[0])} />
    </div>
    {dosyaAdi && <div><span>{dosyaAdi}</span> <Button onClick={() => { void dosyaSec(); if (input.current) input.current.value = ""; }}>Karşılaştırmayı temizle</Button></div>}
    {okunuyor && <p role="status">Önceki ölçüm okunuyor…</p>}
    <Alert tone="error">{hata || uyumsuzluk}</Alert>
    {sonuc && baz && <>
      <p>Önceki ölçüm: {new Date(baz.alindigiZaman).toLocaleString("tr-TR")} · Güncel ölçüm: {new Date(guncel.alindigiZaman).toLocaleString("tr-TR")}</p>
      {sonuc.modDegisti && <Alert tone="warning">Şirket modu değişmiş: {baz.kullanimModu} → {guncel.kullanimModu}.</Alert>}
      <Table><thead><tr><th>Ölçüm</th><th className="num">Önceki</th><th className="num">Güncel</th><th className="num">Fark (güncel − önceki)</th></tr></thead>
        <tbody>{sonuc.satirlar.map((s) => <tr key={s.ad}><td>{s.ad}</td><td className="num">{s.baz === null ? "Ölçüm yok" : olcumSayiBicimi(s.baz)}</td><td className="num">{s.guncel === null ? "Ölçüm yok" : olcumSayiBicimi(s.guncel)}</td><td className="num">{s.fark === null ? "Hesaplanamadı" : olcumSayiBicimi(s.fark)}</td></tr>)}</tbody>
      </Table>
      <p className="muted">Farklar dosyadaki değerlerle hesaplanır; dosya kaynağının doğruluğunu veya kâr etkisini kanıtlamaz. Yeni kapanış örnekleri medyanı değiştirebilir. Bu karşılaştırma mali kayıtları değiştirmez.</p>
    </>}
  </section>;
}
