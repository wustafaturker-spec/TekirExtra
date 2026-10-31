"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, TableWrap } from "@/components/ui";
import { PlatformApiHata, platformApi } from "@/lib/platform-api";

/** MVZ-14: bordro parametresi değişikliğinin kabul senaryosu (sunucudaki kayıt). */
export interface KabulSenaryosu {
  id: string;
  ad: string;
  girdiler: Record<string, unknown>;
  beklenen: Record<string, number>;
  tolerans: string | number;
  basarili: boolean | null;
  sonSonuc: { basarili: boolean; hata?: string; alanlar: Record<string, { beklenen: number; hesaplanan: number; fark: number }> } | null;
  sonCalismaZamani: string | null;
}

const GIRDILER = [
  ["brutUcret", "Brüt ücret"],
  ["primGunu", "Prim günü"],
  ["sgkTesvikOrani", "Teşvik puanı"],
  ["nakitYemekYardimi", "Nakit yemek yardımı"],
  ["fiiliCalismaGunu", "Fiilî çalışma günü"],
  ["engellilikDerecesi", "Engellilik derecesi (1–3)"],
  ["oncekiKumulatifMatrah", "Önceki kümülatif GV matrahı"],
  ["oncekiAsgariKumulatifMatrah", "Önceki asgari kümülatif matrah"],
] as const;
const BEKLENEN = [
  ["netUcret", "Net ücret"],
  ["sgkIsci", "SGK işçi"],
  ["issizlikIsci", "İşsizlik işçi"],
  ["gelirVergisi", "Gelir vergisi"],
  ["damgaVergisi", "Damga vergisi"],
  ["isverenMaliyeti", "İşveren maliyeti"],
] as const;
const ETIKET: Record<string, string> = Object.fromEntries([...GIRDILER, ...BEKLENEN]);

/** Düzenleyicide alanlar metin tutulur; bilinmeyen alanlar (API'den gelen) korunur. */
interface Taslak { ad: string; girdi: Record<string, string>; beklenen: Record<string, string>; tolerans: string; ekGirdi: Record<string, unknown>; ekBeklenen: Record<string, number> }

const metin = (v: unknown) => (v === undefined || v === null ? "" : String(v));
function taslagaCevir(s: KabulSenaryosu): Taslak {
  const bilinenG = new Set<string>(GIRDILER.map(([k]) => k)), bilinenB = new Set<string>(BEKLENEN.map(([k]) => k));
  return {
    ad: s.ad,
    girdi: Object.fromEntries(GIRDILER.map(([k]) => [k, metin(s.girdiler[k])])),
    beklenen: Object.fromEntries(BEKLENEN.map(([k]) => [k, metin(s.beklenen[k])])),
    tolerans: metin(s.tolerans),
    ekGirdi: Object.fromEntries(Object.entries(s.girdiler).filter(([k]) => !bilinenG.has(k))),
    ekBeklenen: Object.fromEntries(Object.entries(s.beklenen).filter(([k]) => !bilinenB.has(k))),
  };
}
/** "28.075,50" (Türkçe) ya da "28075.5" kabul edilir. */
const sayi = (v: string) => Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v);
function govdeye(t: Taslak) {
  const dolu = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, sayi(v)]));
  return { ad: t.ad.trim(), girdiler: { ...t.ekGirdi, ...dolu(t.girdi) }, beklenen: { ...t.ekBeklenen, ...dolu(t.beklenen) }, tolerans: t.tolerans ? sayi(t.tolerans) : 0.01 };
}
const YENI: Taslak = {
  ad: "Asgari ücret: resmî net",
  girdi: { brutUcret: "", primGunu: "30", sgkTesvikOrani: "", nakitYemekYardimi: "", fiiliCalismaGunu: "", engellilikDerecesi: "", oncekiKumulatifMatrah: "0", oncekiAsgariKumulatifMatrah: "0" },
  beklenen: Object.fromEntries(BEKLENEN.map(([k]) => [k, ""])),
  tolerans: "0.01", ekGirdi: {}, ekBeklenen: {},
};
const para = (v: number) => v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function KabulSenaryolari<T>({ degisiklikId, surum, senaryolar, duzenle, yayinlandi, kalemlerKaydedilmedi, onDegisti, onKayitDurumu, onIslemDurumu, onCakisma }: {
  degisiklikId: string;
  /** PLT-28: okunan değişiklik sürümü; senaryo kaydı bununla gider, eskiyse 409. */
  surum: number;
  senaryolar: KabulSenaryosu[];
  duzenle: boolean;
  yayinlandi: boolean;
  kalemlerKaydedilmedi: boolean;
  onDegisti: (d: T) => void;
  onKayitDurumu: (degisti: boolean) => void;
  onIslemDurumu: (islem: boolean) => void;
  /** PLT-28: kayıt 409 alınca sayfa güncel kaydı çekip karşılaştırma gösterir; senaryo taslağı korunur. */
  onCakisma?: () => void;
}) {
  const [taslaklar, setTaslaklar] = useState<Taslak[]>(() => senaryolar.map(taslagaCevir));
  const degistiRef = useRef(false);
  const [basari, setBasari] = useState("");
  const [degisti, setDegisti] = useState(false);
  const [hata, setHata] = useState(""); const [islem, setIslem] = useState(false);
  useEffect(() => { if (!degistiRef.current) setTaslaklar(senaryolar.map(taslagaCevir)); }, [senaryolar]);
  const kirlet = () => { degistiRef.current = true; setDegisti(true); onKayitDurumu(true); setBasari(""); };

  const guncelle = (i: number, ek: Partial<Taslak>) => { setTaslaklar((e) => e.map((t, j) => (j === i ? { ...t, ...ek } : t))); kirlet(); };
  async function gonder(yol: string, govde?: unknown) {
    if (islem) return;
    if (govde && taslaklar.some((t) => Object.values({ ...t.girdi, ...t.beklenen }).some((v) => v.trim() !== "" && !Number.isFinite(sayi(v))) || !Number.isFinite(t.tolerans ? sayi(t.tolerans) : 0.01) || (t.tolerans ? sayi(t.tolerans) : 0.01) < 0)) { setHata("Senaryo alanlarına geçerli sayılar ve sıfırdan küçük olmayan bir tolerans girin."); return; }
    setIslem(true); onIslemDurumu(true); setHata(""); setBasari("");
    try {
      const sonuc = await platformApi<T>(`/platform/mevzuat/degisiklikler/${degisiklikId}/${yol}`, { method: govde ? "PUT" : "POST", body: govde ? JSON.stringify({ ...govde, surum }) : undefined });
      degistiRef.current = false; setDegisti(false); onKayitDurumu(false); onDegisti(sonuc);
      setBasari(govde ? "Senaryolar kaydedildi." : "Senaryolar çalıştırıldı.");
    } catch (e) {
      setHata(e instanceof Error ? e.message : "İşlem başarısız.");
      if (e instanceof PlatformApiHata && e.durum === 409) onCakisma?.();
    }
    finally { setIslem(false); onIslemDurumu(false); }
  }

  const sonuclu = senaryolar.length > 0 && senaryolar.every((s) => s.basarili !== null);
  return (
    <Card
      id="kabul-senaryolari"
      className="platform-acceptance"
      title="Kabul senaryoları"
      pad={false}
      actions={!yayinlandi ? <div className="row-tight">
        {duzenle && <Button size="sm" disabled={islem} onClick={() => { setTaslaklar((e) => [...e, YENI]); kirlet(); }}>Senaryo ekle</Button>}
        {duzenle && <Button size="sm" variant="primary" disabled={islem || !degisti} onClick={() => void gonder("kabul-senaryolari", { senaryolar: taslaklar.map(govdeye) })}>Senaryoları kaydet</Button>}
        <Button size="sm" disabled={islem || degisti || kalemlerKaydedilmedi || !senaryolar.length} onClick={() => void gonder("kabul-senaryolari/calistir")}>Çalıştır</Button>
      </div> : undefined}
    >
      <p className="muted" style={{ padding: "0.8rem 1.25rem 0", margin: 0 }}>
        Bordro parametresi değişikliği en az bir senaryo olmadan onaya gönderilemez. Beklenen değerleri resmî kaynaktan girin (ör. asgari ücretin açıklanan neti); senaryolar onaya gönderirken ve yayında bu değişikliğin değeriyle yeniden çalıştırılır, biri tutmazsa yayın yapılmaz. Boş bırakılan beklenen alan denetlenmez.
      </p>
      <div className="platform-scenario-feedback"><Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert></div>
      {sonuclu && !degisti && <div style={{ padding: "0.5rem 1.25rem 0" }}><Alert tone={senaryolar.every((s) => s.basarili) ? "success" : "warning"}>{senaryolar.every((s) => s.basarili) ? "Bütün senaryolar tutuyor." : "Tutmayan senaryo var; değeri ya da beklentiyi kontrol edin."}</Alert></div>}
      {taslaklar.map((t, i) => {
        const kayit = !degisti ? senaryolar[i] : undefined;
        return (
          <div key={i} className="kabul-senaryo">
            <div className="between">
              {duzenle ? <Input aria-label="Senaryo adı" value={t.ad} onChange={(e) => guncelle(i, { ad: e.target.value })} style={{ maxWidth: "28rem" }} /> : <strong>{t.ad}</strong>}
              <div className="row-tight">
                {kayit?.basarili === true && <Badge variant="success">Tuttu</Badge>}
                {kayit?.basarili === false && <Badge variant="danger">Tutmadı</Badge>}
                {duzenle && <Button size="sm" variant="danger" onClick={() => { setTaslaklar((e) => e.filter((_, j) => j !== i)); kirlet(); }}>Sil</Button>}
              </div>
            </div>
            <details open className="platform-scenario-section"><summary>Girdi değerleri</summary><div className="form-grid">
              {GIRDILER.map(([k, ad]) => <Field key={k} label={ad}><Input value={t.girdi[k] ?? ""} disabled={!duzenle} inputMode="decimal" onChange={(e) => guncelle(i, { girdi: { ...t.girdi, [k]: e.target.value } })} /></Field>)}
            </div></details>
            <details open className="platform-scenario-section"><summary>Beklenen sonuçlar</summary><div className="form-grid">
              {BEKLENEN.map(([k, ad]) => <Field key={k} label={`Beklenen ${ad.toLocaleLowerCase("tr-TR")}`}><Input value={t.beklenen[k] ?? ""} disabled={!duzenle} inputMode="decimal" onChange={(e) => guncelle(i, { beklenen: { ...t.beklenen, [k]: e.target.value } })} /></Field>)}
              <Field label="Tolerans (TL)"><Input value={t.tolerans} disabled={!duzenle} inputMode="decimal" onChange={(e) => guncelle(i, { tolerans: e.target.value })} /></Field>
            </div></details>
            {kayit?.sonSonuc && <div className="platform-scenario-results">
              {kayit.sonSonuc.hata ? <Alert tone="error">Hesaplanamadı: {kayit.sonSonuc.hata}</Alert> : <TableWrap className="platform-responsive-table"><thead><tr><th>Alan</th><th>Beklenen</th><th>Hesaplanan</th><th>Fark</th></tr></thead><tbody>{Object.entries(kayit.sonSonuc.alanlar).map(([k, a]) => <tr key={k}><td data-label="Alan" className="platform-cell-title">{ETIKET[k] ?? k}</td><td data-label="Beklenen">{para(a.beklenen)}</td><td data-label="Hesaplanan">{para(a.hesaplanan)}</td><td data-label="Fark">{para(a.fark)}</td></tr>)}</tbody></TableWrap>}
              {kayit.sonCalismaZamani && <p className="platform-field-help">Son çalışma: {new Date(kayit.sonCalismaZamani).toLocaleString("tr-TR")}</p>}
            </div>}
          </div>
        );
      })}
      {!taslaklar.length && <p className="muted" style={{ padding: "0.8rem 1.25rem", margin: 0 }}>Henüz senaryo yok. Resmî bir beklenen sonuçla ilk senaryonuzu ekleyin.</p>}
      {degisti && <p className="muted" style={{ padding: "0.8rem 1.25rem", margin: 0 }}>Kaydedilmemiş senaryo değişikliği var.</p>}
    </Card>
  );
}
