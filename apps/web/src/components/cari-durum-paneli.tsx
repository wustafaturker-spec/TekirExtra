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

/**
 * CARI-43…46: Cari Durum Paneli. Mevcut risk, yaşlandırma ve ödeme davranışı
 * hesaplarını tek yerde, önceliğe göre sıralı bulgularla gösterir. Kayıt
 * yazmaz; bulgunun bağlantısı kartın sekmesine ya da ilgili ekrana götürür.
 * Dil modeli kullanılmaz.
 */
const GUVEN_ADI: Record<NonNullable<CariDurumu["gostergeler"]>["guven"], string> = { dusuk: "düşük", orta: "orta", yuksek: "yüksek" };

export function CariDurumPaneli({ cariId, yenile, onSekme }: { cariId: string; yenile?: unknown; onSekme: (sekme: CariDurumSekmesi) => void }) {
  const [durum, setDurum] = useState<CariDurumu | null>(null);
  const [hata, setHata] = useState(false);

  useEffect(() => {
    let iptal = false;
    setHata(false);
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
  const hedef = (h: BulguHedefi, birincil?: boolean) =>
    "sekme" in h
      ? <Button size="sm" variant={birincil ? "primary" : "ghost"} type="button" onClick={() => onSekme(h.sekme)}>{h.etiket}</Button>
      : <a className={birincil ? "btn btn--primary btn--sm" : "btn-link"} href={h.adres}>{h.etiket}</a>;

  return (
    <Card
      className="cari-durum"
      title="Durum özeti"
      actions={<small className="muted" title="Panel her açılışta mevcut kayıtlardan yeniden hesaplanır">{new Date(durum.hesaplandiAt).toLocaleString("tr-TR")} itibarıyla</small>}
    >
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
