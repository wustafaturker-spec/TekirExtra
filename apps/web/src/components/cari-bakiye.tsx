"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Bakiye { dovizCinsi: string; bakiye: string }

/**
 * Tahsilat/tediye formlarında seçilen carinin güncel bakiyesi. Fazla ödemeyi
 * sunucu engellemediği için kullanıcı kararını burada görerek verir.
 */
export function CariBakiye({ cariId }: { cariId: string }) {
  const [bakiyeler, setBakiyeler] = useState<Bakiye[] | null>(null);
  const [hata, setHata] = useState(false);

  useEffect(() => {
    setBakiyeler(null);
    setHata(false);
    if (!cariId) return;
    let etkin = true;
    void api<{ bakiyeler: Bakiye[] }>(`/cari/${cariId}`)
      .then((cari) => { if (etkin) setBakiyeler(cari.bakiyeler); })
      .catch(() => { if (etkin) setHata(true); });
    return () => { etkin = false; };
  }, [cariId]);

  if (!cariId) return null;
  return <div className="cari-bakiye" role="status">
    <strong>Cari hesap bakiyesi</strong>
    {hata ? <span>Bakiye alınamadı; cari hesabı kontrol edin.</span> : !bakiyeler ? <span>Yükleniyor…</span> : bakiyeler.length === 0 ? <span>Hareket yok, bakiye 0.</span> : bakiyeler.map((b) => <span key={b.dovizCinsi}>
      <b>{Number(b.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {b.dovizCinsi}</b>
      <small>{Number(b.bakiye) > 0 ? "alacaklıyız" : Number(b.bakiye) < 0 ? "borçluyuz" : "denge"}</small>
    </span>)}
  </div>;
}
