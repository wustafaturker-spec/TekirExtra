"use client";

/**
 * KSB-33: kesin eşleşmelerin toplu onayı. Yalnız belirsizliği olmayan öneriler
 * listelenir (numarası açıklamada geçen tek ödeme talimatı, hedefi tanımlı
 * kural, kesin kaynaklı cari + tutarı tutan tek açık fatura). Sunucu onayda
 * öneriyi yeniden hesaplar; arada değişen satır atlanır.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Modal, Para, TableWrap, Tarih } from "@/components/ui";

interface KesinOneri {
  satirId: string;
  tarih: string;
  tutar: string;
  dovizCinsi: string;
  bankaHesap: string;
  aciklama: string;
  tur: string;
  ozet: string;
}

interface TopluSonuc {
  eslesen: number;
  atlanan: number;
  hatali: number;
  sonuclar: { satirId: string; durum: "eslesti" | "atlandi" | "hata"; mesaj: string }[];
}

const TUR_ADI: Record<string, string> = { odeme_talimati: "Ödeme talimatı", masraf: "Masraf", gelir: "Gelir", virman: "Virman", cari: "Cari ve fatura" };

export function TopluOnay({ bankaHesapId, onKapat, onTamamlandi }: { bankaHesapId: string; onKapat: () => void; onTamamlandi: (mesaj: string) => void }) {
  const [oneriler, setOneriler] = useState<KesinOneri[] | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [hata, setHata] = useState("");
  const [islemde, setIslemde] = useState(false);
  const [sonuc, setSonuc] = useState<TopluSonuc | null>(null);

  useEffect(() => {
    let iptal = false;
    void api<KesinOneri[]>(`/kasa-banka/ekstre/kesin-oneriler${bankaHesapId ? `?bankaHesapId=${bankaHesapId}` : ""}`)
      .then((liste) => { if (!iptal) { setOneriler(liste); setSecili(new Set(liste.map((o) => o.satirId))); } })
      .catch((e) => { if (!iptal) setHata(e instanceof Error ? e.message : "Öneriler alınamadı"); });
    return () => { iptal = true; };
  }, [bankaHesapId]);

  function degistir(id: string) {
    setSecili((s) => { const yeni = new Set(s); if (yeni.has(id)) yeni.delete(id); else yeni.add(id); return yeni; });
  }

  async function onayla() {
    setIslemde(true);
    setHata("");
    try {
      const s = await api<TopluSonuc>("/kasa-banka/ekstre/toplu-eslestir", { method: "POST", body: JSON.stringify({ satirIdleri: [...secili] }) });
      setSonuc(s);
      if (!s.atlanan && !s.hatali) onTamamlandi(`${s.eslesen} satır kesin eşleşmesiyle eşleştirildi.`);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Toplu eşleştirme yapılamadı");
    } finally {
      setIslemde(false);
    }
  }

  const ad = (id: string) => oneriler?.find((o) => o.satirId === id);

  return (
    <Modal
      genis
      baslik="Kesin eşleşmeleri onayla"
      aciklama="Yalnız belirsizliği olmayan öneriler listelenir. Diğer satırlar tek tek eşleştirilir."
      onKapat={() => (sonuc ? onTamamlandi(`${sonuc.eslesen} satır eşleştirildi${sonuc.atlanan ? `, ${sonuc.atlanan} atlandı` : ""}${sonuc.hatali ? `, ${sonuc.hatali} hata verdi` : ""}.`) : !islemde && onKapat())}
    >
      <div className="stack">
        <Alert tone="error">{hata}</Alert>
        {sonuc ? (
          <>
            <div className="row-tight">
              <Badge variant="success">{sonuc.eslesen} eşleşti</Badge>
              {sonuc.atlanan > 0 && <Badge variant="warning">{sonuc.atlanan} atlandı</Badge>}
              {sonuc.hatali > 0 && <Badge variant="danger">{sonuc.hatali} hata</Badge>}
            </div>
            {sonuc.sonuclar.filter((s) => s.durum !== "eslesti").map((s) => (
              <Alert key={s.satirId} tone={s.durum === "hata" ? "error" : "warning"}>
                {ad(s.satirId)?.aciklama ?? "Satır"}: {s.mesaj}
              </Alert>
            ))}
            <div className="row-tight" style={{ justifyContent: "flex-end" }}>
              <Button variant="primary" onClick={() => onTamamlandi(`${sonuc.eslesen} satır eşleştirildi${sonuc.atlanan ? `, ${sonuc.atlanan} atlandı` : ""}${sonuc.hatali ? `, ${sonuc.hatali} hata verdi` : ""}.`)}>Kapat</Button>
            </div>
          </>
        ) : oneriler === null ? (
          !hata && <p className="muted">Öneriler hesaplanıyor…</p>
        ) : oneriler.length === 0 ? (
          <p className="muted">Kesin eşleşmesi olan bekleyen satır yok. Satırları listeden tek tek eşleştirin; sık tekrarlananlar için kural kaydedin.</p>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Tümünü seç" checked={secili.size === oneriler.length} onChange={(e) => setSecili(e.target.checked ? new Set(oneriler.map((o) => o.satirId)) : new Set())} /></th>
                  <th>Tarih</th><th>Açıklama</th><th className="num">Tutar</th><th>Eşleşme</th>
                </tr>
              </thead>
              <tbody>
                {oneriler.map((o) => (
                  <tr key={o.satirId}>
                    <td><input type="checkbox" aria-label={`${o.aciklama} satırını seç`} checked={secili.has(o.satirId)} onChange={() => degistir(o.satirId)} /></td>
                    <td><Tarih deger={o.tarih} /></td>
                    <td>{o.aciklama}{!bankaHesapId && <><br /><small className="muted">{o.bankaHesap}</small></>}</td>
                    <td className="num"><Para deger={o.tutar} dovizCinsi={o.dovizCinsi} isaretle /></td>
                    <td><Badge variant="info">{TUR_ADI[o.tur] ?? o.tur}</Badge><br /><small>{o.ozet}</small></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <div className="row-tight" style={{ justifyContent: "flex-end" }}>
              <Button onClick={onKapat} disabled={islemde}>Vazgeç</Button>
              <Button variant="primary" onClick={() => void onayla()} disabled={islemde || secili.size === 0}>
                {islemde ? "Eşleştiriliyor…" : `Seçilen ${secili.size} satırı eşleştir`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
