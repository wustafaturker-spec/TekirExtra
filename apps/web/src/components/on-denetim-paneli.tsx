"use client";

import { useEffect, useState } from "react";
import type { OnDenetimBulgusu } from "@tekirextra/shared";
import { api } from "@/lib/api";

/**
 * EBLG-134: gönderim öncesi ön denetim bulguları. Engel değildir; sihirbazın
 * engelleri kendi yerlerinde kalır. Bağlantılar yeni sekmede açılır ki
 * sihirbazda girilen bilgiler kaybolmasın.
 */
function baglantiAdresi(b: NonNullable<OnDenetimBulgusu["baglanti"]>, faturaYonu: "satis" | "alis"): string {
  if (b.tur === "cari") return `/panel/cari/${b.id}`;
  if (b.tur === "stok") return `/panel/stok/${b.id}`;
  if (b.tur === "belge") return `/panel/belgeler?yon=alis&tur=siparis&odak=${b.id}`;
  if (b.tur === "gelen") return `/panel/fatura/gelen-kutusu?ac=${b.id}`;
  return `/panel/fatura?yon=${faturaYonu}&ac=${b.id}`;
}

const BAGLANTI_ADI = { cari: "Cari kartı", stok: "Ürün kartı", fatura: "Faturayı aç", belge: "Siparişi aç", gelen: "Gelen belgeyi aç" } as const;

/** Panelin hangi yönde kullanıldığına göre metinler (EBLG-144: gelen alış denetimi). */
export interface OnDenetimMetinleri {
  baslik: string;
  altMetin: string;
  temiz: string;
  /** "cari" / "tedarikçi": susturma düğmesi ve notu. */
  taraf: string;
  faturaYonu: "satis" | "alis";
}

const GIDEN_METINLERI: OnDenetimMetinleri = {
  baslik: "Ön denetim",
  altMetin: "Belgeyi durdurmaz; uyarılar gönderim adımında onayınızı ister.",
  temiz: "Ön denetim: fiyat, vergi, cari ve mükerrer kontrollerinde dikkat edilecek bir şey bulunmadı.",
  taraf: "cari",
  faturaYonu: "satis",
};

/** AI-71: sunucunun yapay zekâ kontrolü yanıtı; bulgular onay istemez. */
export interface AiDenetimSonucu {
  durum: "tamam" | "kapali" | "zaman_asimi" | "hata";
  mesaj?: string;
  bulgular: OnDenetimBulgusu[];
}

function BulguSatiri({ b, onSustur, onRetGerekcesine, metin = GIDEN_METINLERI }: {
  b: OnDenetimBulgusu;
  onSustur?: (kod: OnDenetimBulgusu["kod"]) => void;
  onRetGerekcesine?: (mesaj: string) => void;
  metin?: OnDenetimMetinleri;
}) {
  return (
    <li className={b.duzey === "bilgi" ? "on-denetim__bilgi" : undefined}>
      {b.duzey === "bilgi" && <span>Bilgi · </span>}
      {b.satir ? <span className="subtle">{b.satir}. satır · </span> : null}
      {b.mesaj}
      {b.baglanti && (
        <>
          {" "}
          <a className="btn-link" href={baglantiAdresi(b.baglanti, metin.faturaYonu)} target="_blank" rel="noreferrer">
            {b.baglanti.tur === "fatura" ? `${b.baglanti.etiket ?? ""} ${BAGLANTI_ADI.fatura}`.trim() : BAGLANTI_ADI[b.baglanti.tur]}
          </a>
        </>
      )}
      {onSustur && (
        <>
          {" · "}
          <button type="button" className="btn-link" onClick={() => onSustur(b.kod)} title={`Bu kural bu ${metin.taraf} için bir daha gösterilmez`}>
            Bu {metin.taraf} için gösterme
          </button>
        </>
      )}
      {onRetGerekcesine && b.duzey === "uyari" && (
        <>
          {" · "}
          <button type="button" className="btn-link" onClick={() => onRetGerekcesine(b.mesaj)} title="Bulgunun metni ticari fatura ret gerekçesine eklenir; ret kararı sizindir">
            Ret gerekçesine ekle
          </button>
        </>
      )}
    </li>
  );
}

/** AI-71: yapay zekâ kontrolü kendi bölümünde; yüklenirken sihirbaz beklemez. */
function AiBolumu({ ai, onSustur }: { ai: AiDenetimSonucu | "yukleniyor"; onSustur?: (kod: OnDenetimBulgusu["kod"]) => void }) {
  if (ai === "yukleniyor") return <p className="subtle" style={{ margin: "0.5rem 0 0" }}>Yapay zekâ kontrolü sürüyor… Beklemeden devam edebilirsiniz.</p>;
  const durumNotu = ai.durum === "tamam" ? null : ai.mesaj;
  if (!ai.bulgular.length) {
    return <p className="subtle" style={{ margin: "0.5rem 0 0" }}>{durumNotu ?? "Yapay zekâ kontrolü: dikkat edilecek bir şey bulunmadı."}</p>;
  }
  return (
    <div style={{ marginTop: "0.6rem" }}>
      <strong className="on-denetim__baslik">Yapay zekâ kontrolü</strong>
      <span className="subtle"> · öneri niteliğindedir, onay istemez{durumNotu ? ` · ${durumNotu}` : ""}</span>
      <ul className="stack" style={{ margin: 0, paddingLeft: "1.1rem" }}>
        {ai.bulgular.map((b, i) => <BulguSatiri key={`ai-${b.kod}-${b.satir ?? 0}-${i}`} b={b} onSustur={onSustur} />)}
      </ul>
    </div>
  );
}

export function OnDenetimPaneli({
  bulgular,
  susturulan = 0,
  onSustur,
  onRetGerekcesine,
  ai,
  metin = GIDEN_METINLERI,
}: {
  bulgular: OnDenetimBulgusu[] | undefined;
  susturulan?: number;
  ai?: AiDenetimSonucu | "yukleniyor";
  /** EBLG-141: kuralı bu cari için bir daha gösterme. */
  onSustur?: (kod: OnDenetimBulgusu["kod"]) => void;
  /** EBLG-150: ticari faturada bulgu metnini ret gerekçesine ekle. */
  onRetGerekcesine?: (mesaj: string) => void;
  metin?: OnDenetimMetinleri;
}) {
  if (!bulgular) return null;
  const uyarilar = bulgular.filter((b) => b.duzey === "uyari");
  const bilgiler = bulgular.filter((b) => b.duzey === "bilgi");
  const susturmaNotu = susturulan > 0 && (
    <span className="subtle">
      {" "}Bu {metin.taraf} için susturulmuş {susturulan} bulgu gösterilmiyor (<a className="btn-link" href="/panel/ayarlar/on-denetim" target="_blank" rel="noreferrer">susturmalar</a>).
    </span>
  );
  const aiUyarisi = ai && ai !== "yukleniyor" && ai.bulgular.some((b) => b.duzey === "uyari");
  if (!bulgular.length) {
    return (
      <section aria-label={metin.baslik} className={`on-denetim${aiUyarisi ? "" : " is-bilgi"}`}>
        <span>{metin.temiz}{susturmaNotu}</span>
        {ai && <AiBolumu ai={ai} onSustur={onSustur} />}
      </section>
    );
  }
  return (
    <section aria-label={metin.baslik} className={`on-denetim${uyarilar.length || aiUyarisi ? "" : " is-bilgi"}`}>
      <strong className="on-denetim__baslik">
        {metin.baslik}: {uyarilar.length ? `${uyarilar.length} uyarı` : ""}{uyarilar.length && bilgiler.length ? ", " : ""}{bilgiler.length ? `${bilgiler.length} bilgi` : ""}
      </strong>
      <p className="subtle">{metin.altMetin}{susturmaNotu}</p>
      <ul className="stack" style={{ margin: 0, paddingLeft: "1.1rem" }}>
        {[...uyarilar, ...bilgiler].map((b, i) => <BulguSatiri key={`${b.kod}-${b.satir ?? 0}-${i}`} b={b} onSustur={onSustur} onRetGerekcesine={onRetGerekcesine} metin={metin} />)}
      </ul>
      {ai && <AiBolumu ai={ai} onSustur={onSustur} />}
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
