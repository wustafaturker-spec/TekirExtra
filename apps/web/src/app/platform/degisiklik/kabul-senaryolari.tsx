"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input } from "@/components/ui";
import { platformApi } from "@/lib/platform-api";

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

export function KabulSenaryolari({ degisiklikId, senaryolar, duzenle, yayinlandi, kalemlerKaydedilmedi, onDegisti }: {
  degisiklikId: string;
  senaryolar: KabulSenaryosu[];
  duzenle: boolean;
  yayinlandi: boolean;
  kalemlerKaydedilmedi: boolean;
  onDegisti: (d: never) => void;
}) {
  const [taslaklar, setTaslaklar] = useState<Taslak[]>([]);
  const [degisti, setDegisti] = useState(false);
  const [hata, setHata] = useState(""); const [islem, setIslem] = useState(false);
  useEffect(() => { setTaslaklar(senaryolar.map(taslagaCevir)); setDegisti(false); }, [senaryolar]);

  const guncelle = (i: number, ek: Partial<Taslak>) => { setTaslaklar((e) => e.map((t, j) => (j === i ? { ...t, ...ek } : t))); setDegisti(true); };
  async function gonder(yol: string, govde?: unknown) {
    setIslem(true); setHata("");
    try { onDegisti(await platformApi<never>(`/platform/mevzuat/degisiklikler/${degisiklikId}/${yol}`, { method: govde ? "PUT" : "POST", body: govde ? JSON.stringify(govde) : undefined })); }
    catch (e) { setHata(e instanceof Error ? e.message : "İşlem başarısız"); } finally { setIslem(false); }
  }

  const sonuclu = senaryolar.length > 0 && senaryolar.every((s) => s.basarili !== null);
  return (
    <Card
      title="Kabul senaryoları"
      pad={false}
      actions={!yayinlandi ? <div className="row-tight">
        {duzenle && <Button size="sm" onClick={() => { setTaslaklar((e) => [...e, YENI]); setDegisti(true); }}>+ Senaryo</Button>}
        {duzenle && <Button size="sm" variant="primary" disabled={islem || !degisti} onClick={() => void gonder("kabul-senaryolari", { senaryolar: taslaklar.map(govdeye) })}>Senaryoları kaydet</Button>}
        <Button size="sm" disabled={islem || degisti || kalemlerKaydedilmedi || !senaryolar.length} onClick={() => void gonder("kabul-senaryolari/calistir")}>Çalıştır</Button>
      </div> : undefined}
    >
      <p className="muted" style={{ padding: "0.8rem 1.25rem 0", margin: 0 }}>
        Bordro parametresi değişikliği en az bir senaryo olmadan onaya gönderilemez. Beklenen değerleri resmî kaynaktan girin (ör. asgari ücretin açıklanan neti); senaryolar onaya gönderirken ve yayında bu değişikliğin değeriyle yeniden çalıştırılır, biri tutmazsa yayın yapılmaz. Boş bırakılan beklenen alan denetlenmez.
      </p>
      <div style={{ padding: "0 1.25rem" }}><Alert tone="error">{hata}</Alert></div>
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
                {duzenle && <Button size="sm" variant="danger" onClick={() => { setTaslaklar((e) => e.filter((_, j) => j !== i)); setDegisti(true); }}>Sil</Button>}
              </div>
            </div>
            <div className="form-grid">
              {GIRDILER.map(([k, ad]) => <Field key={k} label={ad}><Input value={t.girdi[k] ?? ""} disabled={!duzenle} inputMode="decimal" onChange={(e) => guncelle(i, { girdi: { ...t.girdi, [k]: e.target.value } })} /></Field>)}
            </div>
            <div className="form-grid">
              {BEKLENEN.map(([k, ad]) => <Field key={k} label={`Beklenen ${ad.toLocaleLowerCase("tr-TR")}`}><Input value={t.beklenen[k] ?? ""} disabled={!duzenle} inputMode="decimal" onChange={(e) => guncelle(i, { beklenen: { ...t.beklenen, [k]: e.target.value } })} /></Field>)}
              <Field label="Tolerans (TL)"><Input value={t.tolerans} disabled={!duzenle} inputMode="decimal" onChange={(e) => guncelle(i, { tolerans: e.target.value })} /></Field>
            </div>
            {kayit?.sonSonuc && (
              <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                {kayit.sonSonuc.hata ? `Hesaplanamadı: ${kayit.sonSonuc.hata}` : Object.entries(kayit.sonSonuc.alanlar).map(([k, a]) => `${ETIKET[k] ?? k}: beklenen ${para(a.beklenen)}, hesaplanan ${para(a.hesaplanan)}${a.fark > 0 ? ` (fark ${para(a.fark)})` : ""}`).join(" · ")}
                {kayit.sonCalismaZamani ? ` — ${new Date(kayit.sonCalismaZamani).toLocaleString("tr-TR")}` : ""}
              </p>
            )}
          </div>
        );
      })}
      {!taslaklar.length && <p className="muted" style={{ padding: "0.8rem 1.25rem", margin: 0 }}>Henüz senaryo yok.</p>}
      {degisti && <p className="muted" style={{ padding: "0.8rem 1.25rem", margin: 0 }}>Kaydedilmemiş senaryo değişikliği var.</p>}
    </Card>
  );
}
