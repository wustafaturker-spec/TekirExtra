"use client";

/**
 * İrsaliyeyi sonradan faturaya bağlama paneli (FTR-26).
 *
 * İki yerden açılır: irsaliye detayında bir fatura seçilir, fatura detayında
 * bir ya da birden çok irsaliye seçilir. Seçim değiştikçe sunucu irsaliye ve
 * fatura kalemlerini karşılaştırır (madde 8); farklar yalnız uyarıdır,
 * bağlamayı engellemez. Uygunluk kuralları sunucudadır — liste zaten yalnız
 * bağlanabilir kayıtları getirir, bağlama anında da yeniden denetlenir.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { Alert, Button, Field, Select } from "@/components/ui";

interface FaturaAdayi { id: string; no: string | null; tarih: string; durum: string; genelToplam: string; dovizCinsi: string }
interface IrsaliyeAdayi { id: string; no: string | null; tarih: string; bagli: boolean; eirsaliyeDurumu: string | null }
interface Fark { tur: string; mesaj: string }

const EIRSALIYE_GITTI = ["iletildi", "kabul", "kismi_kabul"];
const EIRSALIYE_DURUM_ADI: Record<string, string> = { kuyrukta: "kuyrukta", iletildi: "iletildi", kabul: "kabul edildi", kismi_kabul: "kısmi kabul", ret: "reddedildi", hata: "hata" };

const tarihTR = (tarih: string) => new Date(tarih).toLocaleDateString("tr-TR");

type Kaynak = { irsaliyeId: string; faturaId?: never } | { faturaId: string; irsaliyeId?: never };

export function IrsaliyeBaglaPaneli({ kaynak, onKapat, onBaglandi }: {
  kaynak: Kaynak;
  onKapat: () => void;
  /** Bağlama ya da bağ kaldırma başarılıysa çağrılır; çağıran detayını tazeler. */
  onBaglandi: (mesaj: string) => void;
}) {
  const irsaliyeden = Boolean(kaynak.irsaliyeId);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [hata, setHata] = useState("");
  const [faturalar, setFaturalar] = useState<FaturaAdayi[]>([]);
  const [irsaliyeler, setIrsaliyeler] = useState<IrsaliyeAdayi[]>([]);
  const [faturaId, setFaturaId] = useState(kaynak.faturaId ?? "");
  const [secili, setSecili] = useState<string[]>(kaynak.irsaliyeId ? [kaynak.irsaliyeId] : []);
  const [farklar, setFarklar] = useState<Fark[] | null>(null);
  /** EBLG-82: fatura tarihi irsaliyenin faturalama süresinden sonraysa. */
  const [gecikmeler, setGecikmeler] = useState<string[]>([]);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      if (kaynak.irsaliyeId) {
        setFaturalar(await api<FaturaAdayi[]>(`/belgeler/${kaynak.irsaliyeId}/baglanabilir-faturalar`));
      } else if (kaynak.faturaId) {
        setIrsaliyeler(await api<IrsaliyeAdayi[]>(`/belgeler/baglanabilir-irsaliyeler/${kaynak.faturaId}`));
      }
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Liste yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [kaynak.irsaliyeId, kaynak.faturaId]);

  useEffect(() => { void yukle(); }, [yukle]);

  useEffect(() => {
    if (!faturaId || secili.length === 0) { setFarklar(null); setGecikmeler([]); return; }
    let aktif = true;
    setFarklar(null);
    setGecikmeler([]);
    api<{ farklar: Fark[]; gecikmeler?: string[] }>("/belgeler/irsaliye-bagla/karsilastir", { method: "POST", body: JSON.stringify({ faturaId, irsaliyeIds: secili }) })
      .then((sonuc) => { if (aktif) { setFarklar(sonuc.farklar); setGecikmeler(sonuc.gecikmeler ?? []); } })
      .catch(() => { if (aktif) setFarklar(null); });
    return () => { aktif = false; };
  }, [faturaId, secili]);

  async function bagla() {
    setKaydediliyor(true);
    setHata("");
    try {
      const sonuc = await api<{ baglanan: number }>("/belgeler/irsaliye-bagla", { method: "POST", body: JSON.stringify({ faturaId, irsaliyeIds: secili }) });
      onBaglandi(sonuc.baglanan === 1 ? "İrsaliye faturaya bağlandı." : `${sonuc.baglanan} irsaliye faturaya bağlandı.`);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Bağlanamadı");
    } finally {
      setKaydediliyor(false);
    }
  }

  async function bagiKaldir(irsaliye: IrsaliyeAdayi) {
    if (!confirm(`${irsaliye.no ?? "İrsaliye"} faturadan ayrılsın mı? İrsaliye yeniden faturalanabilir hâle gelir; aynı malı ikinci kez faturalamamaya dikkat edin.`)) return;
    setKaydediliyor(true);
    setHata("");
    try {
      await api(`/belgeler/${irsaliye.id}/fatura-bagini-kaldir`, { method: "POST" });
      onBaglandi("İrsaliyenin fatura bağı kaldırıldı.");
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Bağ kaldırılamadı");
    } finally {
      setKaydediliyor(false);
    }
  }

  const bagliIrsaliyeler = irsaliyeler.filter((i) => i.bagli);
  const acikIrsaliyeler = irsaliyeler.filter((i) => !i.bagli);

  return (
    <HizliKayitPaneli baslik={irsaliyeden ? "Faturaya bağla" : "İrsaliye bağla"} onKapat={onKapat}>
      {hata && <Alert tone="error">{hata}</Alert>}
      {yukleniyor ? <p className="muted">Yükleniyor…</p> : irsaliyeden ? (
        faturalar.length === 0 ? (
          <p className="muted">Bu carinin bağlanabilecek faturası yok. Aynı carinin, e-Belge olarak gönderilmemiş taslak ya da kesin satış/alış faturası gerekir.</p>
        ) : (
          <Field label="Fatura" htmlFor="bagla-fatura">
            <Select id="bagla-fatura" value={faturaId} onChange={(e) => setFaturaId(e.target.value)}>
              <option value="">Seçin…</option>
              {faturalar.map((f) => (
                <option key={f.id} value={f.id}>{f.no ?? (f.durum === "taslak" ? "Taslak" : "Numara bekliyor")} · {tarihTR(f.tarih)} · {Number(f.genelToplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {f.dovizCinsi}{f.no && f.durum === "taslak" ? " · taslak" : ""}</option>
              ))}
            </Select>
          </Field>
        )
      ) : (
        <>
          {bagliIrsaliyeler.length > 0 && (
            <section style={{ marginBottom: "1rem" }}>
              <h4 style={{ margin: "0 0 0.4rem" }}>Bağlı irsaliyeler</h4>
              {bagliIrsaliyeler.map((i) => (
                <div key={i.id} className="between" style={{ padding: "0.25rem 0" }}>
                  <span>{i.no} · {tarihTR(i.tarih)}{i.eirsaliyeDurumu ? " · e-İrsaliye" : ""}</span>
                  <Button size="sm" variant="danger" type="button" disabled={kaydediliyor} onClick={() => void bagiKaldir(i)}>Bağı kaldır</Button>
                </div>
              ))}
            </section>
          )}
          {acikIrsaliyeler.length === 0 ? (
            <p className="muted">Bu carinin faturalanmamış onaylı irsaliyesi yok.</p>
          ) : (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600, marginBottom: "0.4rem" }}>Bağlanacak irsaliyeler</legend>
              {acikIrsaliyeler.map((i) => {
                // Sunucu da reddeder: gitmemiş e-İrsaliyenin GİB'de karşılığı yok.
                const gitmedi = i.eirsaliyeDurumu !== null && !EIRSALIYE_GITTI.includes(i.eirsaliyeDurumu);
                return (
                  <label key={i.id} className="check-row" style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.2rem 0" }}>
                    <input
                      type="checkbox"
                      disabled={gitmedi}
                      checked={secili.includes(i.id)}
                      onChange={(e) => setSecili((eski) => e.target.checked ? [...eski, i.id] : eski.filter((id) => id !== i.id))}
                    />
                    <span>
                      {i.no} · {tarihTR(i.tarih)}{i.eirsaliyeDurumu ? ` · e-İrsaliye ${EIRSALIYE_DURUM_ADI[i.eirsaliyeDurumu] ?? i.eirsaliyeDurumu}` : ""}
                      {gitmedi && <small className="muted"> — önce e-İrsaliye gönderimini tamamlayın</small>}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
        </>
      )}

      {gecikmeler.length > 0 && (
        <Alert tone="warning">
          <strong>Faturalama süresi</strong> — bağlamanıza engel değil:
          <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>
            {gecikmeler.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </Alert>
      )}
      {farklar && farklar.length > 0 && (
        <Alert tone="warning">
          <strong>İrsaliye ile fatura kalemleri tutmuyor</strong> — bağlamanıza engel değil, kontrol edin:
          <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>
            {farklar.map((f, i) => <li key={i}>{f.mesaj}</li>)}
          </ul>
        </Alert>
      )}
      {farklar && farklar.length === 0 && <p className="muted">Kalemler ve miktarlar tutuyor.</p>}

      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
        <Button type="button" onClick={onKapat}>Vazgeç</Button>
        <Button variant="primary" type="button" disabled={kaydediliyor || !faturaId || secili.length === 0} onClick={() => void bagla()}>
          {kaydediliyor ? "Bağlanıyor…" : "Bağla"}
        </Button>
      </div>
    </HizliKayitPaneli>
  );
}
