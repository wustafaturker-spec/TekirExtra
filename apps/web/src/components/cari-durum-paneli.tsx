"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Para, Stat, StatGrid } from "@/components/ui";

type BulguOnemi = "kritik" | "uyari" | "bilgi";
export type CariDurumSekmesi = "genel" | "ekstre" | "crm" | "tahsilat";
type BulguHedefi = { etiket: string; sekme: CariDurumSekmesi } | { etiket: string; adres: string };

interface CariDurumu {
  hesaplandiAt: string;
  gostergeler: {
    bakiyeTry: string;
    vadesiGecmisTry: string;
    enEskiGecikmeGun: number | null;
    mevcutRiskTry: string;
    kullanilabilirLimitTry: string | null;
    riskKullanimOrani: number | null;
    odemeDavranisi: "veri_yetersiz" | "zamaninda" | "kismen_gec" | "gecikmeli";
    tahminiGecikmeGun: number | null;
    guven: "dusuk" | "orta" | "yuksek";
    kurEksik: string[];
  } | null;
  bulgular: { kod: string; onem: BulguOnemi; mesaj: string; kanit: BulguHedefi; eylem?: BulguHedefi }[];
  toplamBulgu: number;
}

const ONEM: Record<BulguOnemi, { ad: string; tur: "danger" | "warning" | "info" }> = {
  kritik: { ad: "Kritik", tur: "danger" },
  uyari: { ad: "Uyarı", tur: "warning" },
  bilgi: { ad: "Bilgi", tur: "info" },
};

const DAVRANIS: Record<NonNullable<CariDurumu["gostergeler"]>["odemeDavranisi"], string> = {
  veri_yetersiz: "Veri yetersiz",
  zamaninda: "Zamanında öder",
  kismen_gec: "Kısmen geç öder",
  gecikmeli: "Gecikmeli öder",
};

const GUVEN_ADI: Record<NonNullable<CariDurumu["gostergeler"]>["guven"], string> = { dusuk: "düşük", orta: "orta", yuksek: "yüksek" };

/** CARI-47: modelin yalnız seçtiği, uygulamanın yazdığı tek paragraf. */
interface DurumOzeti {
  durum: "dogrulandi" | "guvenli_ozet";
  neden?: "model_yaniti_gecersiz" | "model_hatasi" | "olgu_yok";
  paragraf: string;
}

/**
 * CARI-43…46: Cari Durum Paneli. Mevcut risk, yaşlandırma ve ödeme davranışı
 * hesaplarını tek yerde, önceliğe göre sıralı bulgularla gösterir. Kayıt
 * yazmaz; bulgunun bağlantısı kartın sekmesine ya da ilgili ekrana götürür.
 * Panel dil modeli kullanmaz; "Özetle" (CARI-47) yalnız istenince ve AI
 * kullanılabilirken çalışır.
 */
export function CariDurumPaneli({ cariId, yenile, onSekme }: { cariId: string; yenile?: unknown; onSekme: (sekme: CariDurumSekmesi) => void }) {
  const [durum, setDurum] = useState<CariDurumu | null>(null);
  const [hata, setHata] = useState(false);
  const [ozetlenebilir, setOzetlenebilir] = useState(false);
  const [ozet, setOzet] = useState<DurumOzeti | null>(null);
  const [ozetleniyor, setOzetleniyor] = useState(false);
  const [ozetHatasi, setOzetHatasi] = useState("");

  useEffect(() => {
    api<{ kullanilabilir: boolean }>("/ai/cari-durum/kullanilabilir")
      .then((d) => setOzetlenebilir(d.kullanilabilir))
      .catch(() => setOzetlenebilir(false));
  }, []);

  useEffect(() => {
    let iptal = false;
    setHata(false);
    setOzet(null);
    setOzetHatasi("");
    api<CariDurumu>(`/cari/${cariId}/durum`)
      .then((d) => { if (!iptal) setDurum(d); })
      .catch(() => { if (!iptal) { setDurum(null); setHata(true); } });
    return () => { iptal = true; };
  }, [cariId, yenile]);

  if (hata) return <Card className="cari-durum"><p className="muted">Durum özeti hesaplanamadı.</p></Card>;
  if (!durum) return <Card className="cari-durum"><p className="muted">Durum özeti hesaplanıyor…</p></Card>;
  // Rol hiçbir bölümü göremiyorsa (ör. depo) panel yalnız bulgu varsa görünür.
  if (!durum.gostergeler && durum.bulgular.length === 0) return null;

  const g = durum.gostergeler;
  async function ozetle() {
    setOzetleniyor(true);
    setOzetHatasi("");
    try { setOzet(await api<DurumOzeti>(`/ai/cari-durum/${cariId}/ozet`, { method: "POST" })); }
    catch (e) { setOzetHatasi(e instanceof Error ? e.message : "Özet alınamadı"); }
    finally { setOzetleniyor(false); }
  }
  const hedef = (h: BulguHedefi, birincil?: boolean) =>
    "sekme" in h
      ? <Button size="sm" variant={birincil ? "primary" : "ghost"} type="button" onClick={() => onSekme(h.sekme)}>{h.etiket}</Button>
      : <a className={birincil ? "btn btn--primary btn--sm" : "btn-link"} href={h.adres}>{h.etiket}</a>;

  return (
    <Card
      className="cari-durum"
      title="Durum özeti"
      actions={
        <div className="cari-durum__ust">
          <small className="muted" title="Panel her açılışta mevcut kayıtlardan yeniden hesaplanır">{new Date(durum.hesaplandiAt).toLocaleString("tr-TR")} itibarıyla</small>
          {ozetlenebilir && (
            <Button size="sm" variant="ghost" type="button" onClick={ozetle} disabled={ozetleniyor}>{ozetleniyor ? "Özetleniyor…" : ozet ? "Yeniden özetle" : "Özetle"}</Button>
          )}
        </div>
      }
    >
      {ozet && (
        <div className="cari-durum__ozet" aria-live="polite">
          <p>{ozet.paragraf}</p>
          <small className="subtle">
            {ozet.durum === "dogrulandi"
              ? "Yapay zekâ yalnız panelin bulgularından seçim yaptı; tutar ve tarihler uygulamadan."
              : ozet.neden === "olgu_yok" ? "Özetlenecek bulgu yok." : "Yapay zekâ yanıtı kullanılamadı; panelin kendi önem sırası gösteriliyor."}
          </small>
        </div>
      )}
      {ozetHatasi && <p className="cari-durum__not" role="alert">{ozetHatasi}</p>}

      {g && (
        <StatGrid>
          <Stat label="Bakiye" value={<Para deger={g.bakiyeTry} />} hint={Number(g.bakiyeTry) < 0 ? "Cari alacaklı" : "Güncel kurla"} />
          <Stat
            label="Vadesi geçmiş"
            value={<Para deger={g.vadesiGecmisTry} />}
            tone={Number(g.vadesiGecmisTry) > 0 ? "danger" : "default"}
            hint={g.enEskiGecikmeGun ? `En eskisi ${g.enEskiGecikmeGun} gün` : "Gecikmiş alacak yok"}
          />
          <Stat
            label="Risk kullanımı"
            value={g.riskKullanimOrani === null ? "—" : `%${g.riskKullanimOrani}`}
            tone={g.riskKullanimOrani !== null && g.riskKullanimOrani >= 100 ? "danger" : "default"}
            hint={g.kullanilabilirLimitTry === null ? "Risk limiti tanımsız" : <>Limit <Para deger={g.kullanilabilirLimitTry} /></>}
          />
          <Stat
            label="Ödeme davranışı"
            value={DAVRANIS[g.odemeDavranisi]}
            tone={g.odemeDavranisi === "gecikmeli" ? "danger" : g.odemeDavranisi === "zamaninda" ? "success" : "default"}
            hint={g.tahminiGecikmeGun === null ? `Güven: ${GUVEN_ADI[g.guven]}` : `Ortalama ${g.tahminiGecikmeGun} gün gecikme · güven: ${GUVEN_ADI[g.guven]}`}
          />
        </StatGrid>
      )}
      {g && g.kurEksik.length > 0 && <p className="subtle cari-durum__not">{g.kurEksik.join(", ")} için güncel kur yok; tarihî kurla hesaplandı.</p>}

      {durum.bulgular.length === 0 ? (
        <p className="muted cari-durum__bos">Dikkat gerektiren bir durum yok.</p>
      ) : (
        <ul className="cari-durum__bulgular">
          {durum.bulgular.map((b) => (
            <li key={b.kod} className={`cari-durum__bulgu is-${b.onem}`}>
              <div className="cari-durum__metin">
                <Badge variant={ONEM[b.onem].tur}>{ONEM[b.onem].ad}</Badge>
                <span>{b.mesaj}</span>
              </div>
              <div className="cari-durum__eylemler">
                {hedef(b.kanit)}
                {b.eylem && hedef(b.eylem, true)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {durum.toplamBulgu > durum.bulgular.length && (
        <p className="subtle cari-durum__not">Önem sırasına göre ilk {durum.bulgular.length} bulgu gösteriliyor; toplam {durum.toplamBulgu}.</p>
      )}
    </Card>
  );
}
