"use client";

import type { OnDenetimBulgusu } from "@tekirextra/shared";

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

export function OnDenetimPaneli({ bulgular }: { bulgular: OnDenetimBulgusu[] | undefined }) {
  if (!bulgular) return null;
  const uyarilar = bulgular.filter((b) => b.duzey === "uyari");
  const bilgiler = bulgular.filter((b) => b.duzey === "bilgi");
  if (!bulgular.length) {
    return <p className="subtle">Ön denetim: fiyat, vergi, cari ve mükerrer kontrollerinde dikkat edilecek bir şey bulunmadı.</p>;
  }
  return (
    <section aria-label="Ön denetim" className={`approval-impact${uyarilar.length ? " is-warning" : ""}`}>
      <strong>
        Ön denetim: {uyarilar.length ? `${uyarilar.length} uyarı` : ""}{uyarilar.length && bilgiler.length ? ", " : ""}{bilgiler.length ? `${bilgiler.length} bilgi` : ""}
      </strong>
      <p className="subtle">Belgeyi durdurmaz; gönderilmeden önce kontrol edin.</p>
      <ul className="stack" style={{ margin: 0, paddingLeft: "1.1rem" }}>
        {[...uyarilar, ...bilgiler].map((b, i) => (
          <li key={`${b.kod}-${b.satir ?? 0}-${i}`}>
            {b.duzey === "bilgi" && <span className="subtle">Bilgi · </span>}
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
          </li>
        ))}
      </ul>
    </section>
  );
}
