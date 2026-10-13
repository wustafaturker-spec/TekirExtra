"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, ButtonLabel, Card, Para, Stat, StatGrid } from "@/components/ui";

interface YoneticiOzeti {
  tarih: string;
  donem: { baslangic: string; bitis: string };
  metrikler: {
    netSatis: number; brutKar: number; netKar: number;
    nakitVarliklar: number; toplamAlacaklar: number; toplamBorclar: number; netVarlik: number;
    vadesiGecenAlacak: number; vadesiGecenAlacakSayisi: number; vadesiGecenBorc: number;
  };
  uyarilar: string[];
  yorum: string | null;
}

const gun = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * AI-08: rakamlar rapor modülünden (finansal özet, gelir-gider, vadesi
 * geçenler); yapay zekâ yalnız yorum satırını yazar. Soru sormak için asistan.
 */
export function YoneticiOzetiKart() {
  const [ozet, setOzet] = useState<YoneticiOzeti | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    api<YoneticiOzeti>("/ai/rapor/yonetici-ozeti").then(setOzet).catch((e) => setHata(e instanceof Error ? e.message : "Özet yüklenemedi"));
  }, []);

  if (hata) return <Alert tone="error">{hata}</Alert>;
  if (!ozet) return <Card title="Yönetici özeti"><p className="muted">Yükleniyor…</p></Card>;
  const m = ozet.metrikler;
  return (
    <Card
      title={<>Yönetici özeti <small className="muted">· kâr {gun(ozet.donem.baslangic)} – {gun(ozet.donem.bitis)}, bakiyeler bugün</small></>}
      actions={<ButtonLabel as="a" href="/panel/ai" size="sm">Asistana sor</ButtonLabel>}
    >
      <StatGrid>
        <Stat label="Net satış (dönem)" value={<Para deger={m.netSatis} />} />
        <Stat label="Net kâr (dönem)" value={<Para deger={m.netKar} isaretle />} hint={<>Brüt kâr <Para deger={m.brutKar} /></>} />
        <Stat label="Nakit varlıklar" value={<Para deger={m.nakitVarliklar} />} />
        <Stat label="Vadesi geçen alacak" value={<Para deger={m.vadesiGecenAlacak} />} hint={`${m.vadesiGecenAlacakSayisi} fatura`} tone={m.vadesiGecenAlacak > 0 ? "danger" : "default"} />
        <Stat label="Net varlık" value={<Para deger={m.netVarlik} isaretle />} hint={<>Alacak <Para deger={m.toplamAlacaklar} /> · Borç <Para deger={m.toplamBorclar} /></>} />
      </StatGrid>
      {ozet.uyarilar.length > 0 && (
        <ul className="yonetici-ozeti__uyarilar">{ozet.uyarilar.map((u) => <li key={u}>{u}</li>)}</ul>
      )}
      {ozet.yorum && (
        <p className="yonetici-ozeti__yorum"><strong>Yapay zekâ yorumu:</strong> {ozet.yorum}</p>
      )}
    </Card>
  );
}
