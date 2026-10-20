"use client";

import { useEffect, useState } from "react";
import type { OnDenetimBulgusu } from "@tekirextra/shared";
import { api } from "@/lib/api";

/**
 * EBLG-134: gönderim öncesi ön denetim bulguları. Engel değildir; sihirbazın
 * engelleri kendi yerlerinde kalır. Bağlantılar yeni sekmede açılır ki
 * sihirbazda girilen bilgiler kaybolmasın.
 */
function baglantiAdresi(b: NonNullable<OnDenetimBulgusu["baglanti"]>): string {
  if (b.tur === "cari") return `/panel/cari/${b.id}`;
  if (b.tur === "stok") return `/panel/stok/${b.id}`;
  return `/panel/fatura?yon=satis&ac=${b.id}`;
}

const BAGLANTI_ADI = { cari: "Cari kartı", stok: "Ürün kartı", fatura: "Faturayı aç" } as const;

export function OnDenetimPaneli({
  bulgular,
  susturulan = 0,
  onSustur,
}: {
  bulgular: OnDenetimBulgusu[] | undefined;
  susturulan?: number;
  /** EBLG-141: kuralı bu cari için bir daha gösterme. */
  onSustur?: (kod: OnDenetimBulgusu["kod"]) => void;
}) {
  if (!bulgular) return null;
  const uyarilar = bulgular.filter((b) => b.duzey === "uyari");
  const bilgiler = bulgular.filter((b) => b.duzey === "bilgi");
  const susturmaNotu = susturulan > 0 && (
    <span className="subtle">
      {" "}Bu cari için susturulmuş {susturulan} bulgu gösterilmiyor (<a className="btn-link" href="/panel/ayarlar/on-denetim" target="_blank" rel="noreferrer">susturmalar</a>).
    </span>
  );
  if (!bulgular.length) {
    return <p className="subtle">Ön denetim: fiyat, vergi, cari ve mükerrer kontrollerinde dikkat edilecek bir şey bulunmadı.{susturmaNotu}</p>;
  }
  return (
    <section aria-label="Ön denetim" className={`on-denetim${uyarilar.length ? "" : " is-bilgi"}`}>
      <strong className="on-denetim__baslik">
        Ön denetim: {uyarilar.length ? `${uyarilar.length} uyarı` : ""}{uyarilar.length && bilgiler.length ? ", " : ""}{bilgiler.length ? `${bilgiler.length} bilgi` : ""}
      </strong>
      <p className="subtle">Belgeyi durdurmaz; uyarılar gönderim adımında onayınızı ister.{susturmaNotu}</p>
      <ul className="stack" style={{ margin: 0, paddingLeft: "1.1rem" }}>
        {[...uyarilar, ...bilgiler].map((b, i) => (
          <li key={`${b.kod}-${b.satir ?? 0}-${i}`} className={b.duzey === "bilgi" ? "on-denetim__bilgi" : undefined}>
            {b.duzey === "bilgi" && <span>Bilgi · </span>}
            {b.satir ? <span className="subtle">{b.satir}. satır · </span> : null}
            {b.mesaj}
            {b.baglanti && (
              <>
                {" "}
                <a className="btn-link" href={baglantiAdresi(b.baglanti)} target="_blank" rel="noreferrer">
                  {b.baglanti.tur === "fatura" ? `${b.baglanti.etiket ?? ""} ${BAGLANTI_ADI.fatura}`.trim() : BAGLANTI_ADI[b.baglanti.tur]}
                </a>
              </>
            )}
            {onSustur && (
              <>
                {" · "}
                <button type="button" className="btn-link" onClick={() => onSustur(b.kod)} title="Bu kural bu cari için ön denetimde bir daha gösterilmez">
                  Bu cari için gösterme
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface OnDenetimKarari {
  id: string;
  zaman: string;
  kullanici: string | null;
  gerekce: string | null;
  bulgular: { kod: string; satir: number | null; mesaj: string }[];
}

/** EBLG-141: fatura detayında geçilen ön denetim uyarıları (kim, ne zaman, hangileri). */
export function OnDenetimKararlari({ faturaId }: { faturaId: string }) {
  const [kararlar, setKararlar] = useState<OnDenetimKarari[]>([]);
  useEffect(() => {
    let iptal = false;
    api<OnDenetimKarari[]>(`/ebelge/on-denetim/kararlar/${faturaId}`)
      .then((veri) => { if (!iptal) setKararlar(veri); })
      .catch(() => undefined);
    return () => { iptal = true; };
  }, [faturaId]);
  if (!kararlar.length) return null;
  return (
    <section aria-label="Geçilen ön denetim uyarıları" className="approval-impact">
      <strong>Ön denetim uyarıları onaylanarak gönderildi</strong>
      {kararlar.map((k) => (
        <div key={k.id}>
          <small className="subtle">
            {new Date(k.zaman).toLocaleString("tr-TR")} · {k.kullanici ?? "Bilinmeyen kullanıcı"}{k.gerekce ? ` · Gerekçe: ${k.gerekce}` : ""}
          </small>
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {k.bulgular.map((b, i) => <li key={`${b.kod}-${i}`}>{b.satir ? `${b.satir}. satır · ` : ""}{b.mesaj}</li>)}
          </ul>
        </div>
      ))}
    </section>
  );
}
