"use client";

/**
 * Katlanır form grubu. Seyrek kullanılan alanları kalabalıktan ayırır:
 * varsayılan kapalıdır, içinde dolu alan varsa açık gelir ve başlığında
 * "N dolu" işareti görünür. Kullanıcı elle açıp kapattıktan sonra dolu
 * sayısı değişse de seçimine dokunulmaz. Salt okunur görünümde boş grup
 * gizlenebilir.
 */
import { useEffect, useId, useState, type ReactNode } from "react";

export function FormGrubu({ baslik, aciklama, doluSayisi = 0, gizli = false, children }: {
  baslik: string;
  aciklama?: string;
  doluSayisi?: number;
  gizli?: boolean;
  children: ReactNode;
}) {
  const [acik, setAcik] = useState(doluSayisi > 0);
  const [elleDegisti, setElleDegisti] = useState(false);
  const govdeId = useId();
  // Kayıtlı belge yüklenince alanlar sonradan dolar; kullanıcı dokunmadıysa grup açılır.
  useEffect(() => {
    if (!elleDegisti && doluSayisi > 0) setAcik(true);
  }, [doluSayisi, elleDegisti]);
  if (gizli) return null;
  return (
    <section className={`form-grubu${acik ? " is-open" : ""}`}>
      <button type="button" className="form-grubu__bas" aria-expanded={acik} aria-controls={govdeId} onClick={() => { setAcik(!acik); setElleDegisti(true); }}>
        <span className="form-grubu__ok" aria-hidden="true">▸</span>
        <span className="form-grubu__baslik"><strong>{baslik}</strong>{aciklama && <small>{aciklama}</small>}</span>
        {doluSayisi > 0 && <span className="badge badge--info">{doluSayisi} dolu</span>}
      </button>
      {acik && <div className="form-grubu__govde" id={govdeId}>{children}</div>}
    </section>
  );
}
