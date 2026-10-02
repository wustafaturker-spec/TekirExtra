"use client";

/**
 * Toplu ödeme dosyası profili (ENT-07): her kaynak banka hesabı için bankanın
 * şablonuna uygun Excel/CSV sütunları ya da ISO 20022 pain.001 XML.
 * Önizleme örnek iki talimatla canlı gösterilir.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button, Field, Input, Select } from "@/components/ui";
import type { Banka } from "./tipler";

const ALANLAR = {
  sira: "Sıra", aliciUnvan: "Alıcı adı", aliciIban: "IBAN", tutar: "Tutar", doviz: "Döviz", aciklama: "Açıklama",
  referans: "Referans", odemeTarihi: "Ödeme tarihi", aliciVkn: "Alıcı VKN/TCKN", aliciBanka: "Alıcı banka",
} as const;
type Alan = keyof typeof ALANLAR;
interface Profil {
  bicim: "xlsx" | "csv" | "pain001";
  sutunlar: Array<{ alan: Alan; baslik: string }>;
  baslikSatiri: boolean;
  ayrac: ";" | "," | "\t" | "|";
  ondalik: "," | ".";
  tarihBicimi: "GG.AA.YYYY" | "YYYY-AA-GG" | "GGAAYYYY" | "YYYYAAGG";
  aciklamaUzunlugu: number;
  bic?: string | null;
}
const ORNEK = [
  { no: "OT2026-000012", aliciUnvan: "Ege Ambalaj Ltd. Şti.", aliciIban: "TR330006100519786457841326", tutar: "12500.50", doviz: "TRY", aciklama: "ALS-12 ödemesi", odemeTarihi: "2026-10-05", aliciVkn: "1234567890", aliciBanka: "İş Bankası" },
  { no: "OT2026-000013", aliciUnvan: "Marmara Endüstriyel", aliciIban: "TR120001000000000000000001", tutar: "980", doviz: "TRY", aciklama: "ALS-15, ALS-16 ödemesi", odemeTarihi: "2026-10-05", aliciVkn: "9876543210", aliciBanka: "Ziraat" },
];

function hucre(o: (typeof ORNEK)[number], i: number, alan: Alan, p: Profil): string {
  const [y, a, g] = o.odemeTarihi.split("-");
  switch (alan) {
    case "sira": return String(i + 1);
    case "tutar": { const [t, k] = Number(o.tutar).toFixed(2).split("."); return `${t}${p.ondalik}${k}`; }
    case "doviz": return o.doviz === "TRY" ? "TL" : o.doviz;
    case "aciklama": return `${o.no} ${o.aciklama}`.slice(0, p.aciklamaUzunlugu);
    case "referans": return o.no;
    case "odemeTarihi": return { "GG.AA.YYYY": `${g}.${a}.${y}`, "YYYY-AA-GG": o.odemeTarihi, GGAAYYYY: `${g}${a}${y}`, YYYYAAGG: `${y}${a}${g}` }[p.tarihBicimi];
    default: return o[alan];
  }
}

export function DosyaProfili({ bankalar, onMesaj }: { bankalar: Banka[]; onMesaj: (m: string, hata?: boolean) => void }) {
  const [bankaHesapId, setBankaHesapId] = useState(bankalar[0]?.id ?? "");
  const [profil, setProfil] = useState<Profil | null>(null);
  const [tanimli, setTanimli] = useState(false);
  const [yeniAlan, setYeniAlan] = useState<Alan>("aliciVkn");

  useEffect(() => {
    if (!bankaHesapId) return;
    void api<{ profil: Profil; tanimli: boolean }>(`/kasa-banka/bankalar/${bankaHesapId}/odeme-dosya-profili`).then((r) => { setProfil(r.profil); setTanimli(r.tanimli); }).catch((e) => onMesaj(e instanceof Error ? e.message : "Profil yüklenemedi", true));
  }, [bankaHesapId, onMesaj]);

  const onizleme = useMemo(() => {
    if (!profil || profil.bicim === "pain001") return null;
    const satirlar = ORNEK.map((o, i) => profil.sutunlar.map((s) => hucre(o, i, s.alan, profil)));
    return profil.baslikSatiri ? [profil.sutunlar.map((s) => s.baslik || ALANLAR[s.alan]), ...satirlar] : satirlar;
  }, [profil]);

  if (!profil) return <p className="ot-note">Yükleniyor…</p>;
  const degistir = (p: Partial<Profil>) => setProfil({ ...profil, ...p });
  const sutunDegistir = (i: number, s: Partial<Profil["sutunlar"][number]>) => degistir({ sutunlar: profil.sutunlar.map((x, j) => (j === i ? { ...x, ...s } : x)) });
  const tasi = (i: number, yon: -1 | 1) => { const l = [...profil.sutunlar]; [l[i], l[i + yon]] = [l[i + yon], l[i]]; degistir({ sutunlar: l }); };
  const hesap = bankalar.find((b) => b.id === bankaHesapId);

  async function kaydet() {
    try {
      await api(`/kasa-banka/bankalar/${bankaHesapId}/odeme-dosya-profili`, { method: "PUT", body: JSON.stringify(profil) });
      setTanimli(true);
      onMesaj(`${hesap?.ad ?? "Hesap"} için toplu ödeme dosyası profili kaydedildi.`);
    } catch (e) {
      onMesaj(e instanceof Error ? e.message : "Profil kaydedilemedi", true);
    }
  }

  return (
    <section className="ot-form">
      <div className="ot-form__grid">
        <Field label="Banka hesabı">
          <Select value={bankaHesapId} onChange={(e) => setBankaHesapId(e.target.value)}>
            {bankalar.map((b) => <option key={b.id} value={b.id}>{b.bankaAdi} · {b.ad}</option>)}
          </Select>
        </Field>
        <Field label="Dosya biçimi">
          <Select value={profil.bicim} onChange={(e) => degistir({ bicim: e.target.value as Profil["bicim"] })}>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV / metin</option>
            <option value="pain001">ISO 20022 pain.001 XML</option>
          </Select>
        </Field>
        {profil.bicim !== "pain001" && (
          <>
            <Field label="Ondalık ayracı"><Select value={profil.ondalik} onChange={(e) => degistir({ ondalik: e.target.value as Profil["ondalik"] })}><option value=",">Virgül (1250,50)</option><option value=".">Nokta (1250.50)</option></Select></Field>
            <Field label="Tarih biçimi"><Select value={profil.tarihBicimi} onChange={(e) => degistir({ tarihBicimi: e.target.value as Profil["tarihBicimi"] })}>{["GG.AA.YYYY", "YYYY-AA-GG", "GGAAYYYY", "YYYYAAGG"].map((b) => <option key={b}>{b}</option>)}</Select></Field>
            {profil.bicim === "csv" && <Field label="Sütun ayracı"><Select value={profil.ayrac} onChange={(e) => degistir({ ayrac: e.target.value as Profil["ayrac"] })}><option value=";">Noktalı virgül (;)</option><option value=",">Virgül (,)</option><option value={"\t"}>Sekme</option><option value="|">Dikey çizgi (|)</option></Select></Field>}
            <Field label="Açıklama en çok"><Input type="number" min="10" max="140" value={profil.aciklamaUzunlugu} onChange={(e) => degistir({ aciklamaUzunlugu: Number(e.target.value) || 140 })} /></Field>
            <label className="ot-check"><input type="checkbox" checked={profil.baslikSatiri} onChange={(e) => degistir({ baslikSatiri: e.target.checked })} /> İlk satır başlık</label>
          </>
        )}
        {profil.bicim === "pain001" && <Field label="Bankanın BIC kodu"><Input value={profil.bic ?? ""} maxLength={11} onChange={(e) => degistir({ bic: e.target.value.toUpperCase() })} placeholder="ör. TCZBTR2A (boş bırakılabilir)" /></Field>}
      </div>

      {profil.bicim === "pain001" ? (
        <p className="ot-note">
          pain.001.001.03 standart dosyasıdır: talimatlar ödeme tarihine göre gruplanır, her ödemenin EndToEndId'si talimat numarasıdır ve ekstrede geri gelir.
          Kaynak hesabın IBAN'ı{hesap?.iban ? ` (${hesap.iban})` : " tanımlı olmalıdır"}; firma VKN'si başlatan kimliği olarak yazılır. Bankanızın kurumsal internet şubesi bu biçimi kabul ediyorsa en az hatalı yoldur.
        </p>
      ) : (
        <>
          <div className="ot-columns">
            <header><strong>Sütunlar</strong><small>Bankanızın toplu ödeme şablonundaki sırayla dizin; başlık metnini şablondaki gibi yazın.</small></header>
            {profil.sutunlar.map((s, i) => (
              <div key={`${s.alan}-${i}`} className="ot-column">
                <span className="ot-column__no">{i + 1}</span>
                <Select aria-label="Alan" value={s.alan} onChange={(e) => sutunDegistir(i, { alan: e.target.value as Alan })}>{(Object.keys(ALANLAR) as Alan[]).map((a) => <option key={a} value={a}>{ALANLAR[a]}</option>)}</Select>
                <Input aria-label="Başlık" value={s.baslik} placeholder={ALANLAR[s.alan]} onChange={(e) => sutunDegistir(i, { baslik: e.target.value })} />
                <button type="button" disabled={i === 0} onClick={() => tasi(i, -1)} aria-label="Yukarı">↑</button>
                <button type="button" disabled={i === profil.sutunlar.length - 1} onClick={() => tasi(i, 1)} aria-label="Aşağı">↓</button>
                <button type="button" onClick={() => degistir({ sutunlar: profil.sutunlar.filter((_, j) => j !== i) })} aria-label="Kaldır">×</button>
              </div>
            ))}
            <div className="ot-column ot-column--add">
              <Select aria-label="Eklenecek alan" value={yeniAlan} onChange={(e) => setYeniAlan(e.target.value as Alan)}>{(Object.keys(ALANLAR) as Alan[]).map((a) => <option key={a} value={a}>{ALANLAR[a]}</option>)}</Select>
              <Button size="sm" onClick={() => degistir({ sutunlar: [...profil.sutunlar, { alan: yeniAlan, baslik: ALANLAR[yeniAlan] }] })}>+ Sütun ekle</Button>
            </div>
          </div>
          {onizleme && (
            <div className="ot-preview">
              <strong>Önizleme</strong>
              <table><tbody>{onizleme.map((satir, i) => <tr key={i} className={i === 0 && profil.baslikSatiri ? "is-head" : undefined}>{satir.map((h, j) => <td key={j}>{h}</td>)}</tr>)}</tbody></table>
            </div>
          )}
        </>
      )}
      <footer className="ot-form__foot">
        <span className="ot-note">{tanimli ? "Bu hesap için kayıtlı profil kullanılıyor." : "Henüz kayıtlı profil yok; varsayılan “Genel Excel” kullanılır."}</span>
        <Button variant="primary" disabled={profil.bicim !== "pain001" && !profil.sutunlar.length} onClick={() => void kaydet()}>Profili kaydet</Button>
      </footer>
    </section>
  );
}
