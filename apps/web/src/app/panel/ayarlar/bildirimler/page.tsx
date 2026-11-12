"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, PageHeader, TableWrap } from "@/components/ui";
import { TelegramKarti } from "@/components/telegram-kart";

const TURLER = [
  { deger: "duzeltme", ad: "Düzeltme kayıtları", aciklama: "Kritik düzeltme ve SLA aşımı" },
  { deger: "ebelge", ad: "e-Belge", aciklama: "Hatalı veya reddedilmiş belgeler" },
  { deger: "vade", ad: "Vade", aciklama: "Vadesi geçen fatura özeti" },
  { deger: "cek_senet", ad: "Çek & senet", aciklama: "Vadesi yaklaşan evrak" },
  { deger: "stok", ad: "Stok", aciklama: "Kritik seviye ve onaysız sayım" },
  { deger: "donem", ad: "Dönem", aciklama: "Kapanmaya hazır olmayan mali dönem" },
  { deger: "entegrasyon", ad: "Entegrasyon", aciklama: "Banka, POS ve kart mutabakat istisnaları" },
  { deger: "onay", ad: "Onay talepleri", aciklama: "Onayınızı bekleyen işlemler ve taleplerinizin sonucu" },
] as const;

interface Tercih {
  tur: string;
  uygulamaIci: boolean;
  eposta: boolean;
  sms?: boolean;
}

export default function BildirimTercihleriSayfasi() {
  const [tercihler, setTercihler] = useState<Record<string, Tercih>>({});
  const [sessizBaslangic, setSessizBaslangic] = useState("");
  const [sessizBitis, setSessizBitis] = useState("");
  const [hata, setHata] = useState("");
  const [bilgi, setBilgi] = useState("");

  const yukle = useCallback(async () => {
    try {
      const veri = await api<{ tercihler: Tercih[]; sessizBaslangic: string | null; sessizBitis: string | null }>("/bildirimler/tercihler");
      setTercihler(Object.fromEntries(veri.tercihler.map((tercih) => [tercih.tur, tercih])));
      setSessizBaslangic(veri.sessizBaslangic ?? "");
      setSessizBitis(veri.sessizBitis ?? "");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Tercihler yüklenemedi");
    }
  }, []);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  // Kayıt yoksa iki kanal da açıktır; ekran bu varsayılanı gösterir.
  const secim = (tur: string): Tercih => tercihler[tur] ?? { tur, uygulamaIci: true, eposta: true };

  async function kanalDegistir(tur: string, alan: "uygulamaIci" | "eposta" | "sms", deger: boolean) {
    const yeni = { ...secim(tur), [alan]: deger };
    setTercihler((mevcut) => ({ ...mevcut, [tur]: yeni }));
    setHata("");
    setBilgi("");
    try {
      await api("/bildirimler/tercihler", { method: "PUT", body: JSON.stringify({ tur, uygulamaIci: yeni.uygulamaIci, eposta: yeni.eposta, sms: Boolean(yeni.sms) }) });
      setBilgi("Tercih kaydedildi.");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Tercih kaydedilemedi");
      await yukle();
    }
  }

  async function sessizSaatKaydet(temizle = false) {
    setHata("");
    setBilgi("");
    try {
      const govde = temizle ? { baslangic: null, bitis: null } : { baslangic: sessizBaslangic || null, bitis: sessizBitis || null };
      await api("/bildirimler/sessiz-saat", { method: "PUT", body: JSON.stringify(govde) });
      if (temizle) {
        setSessizBaslangic("");
        setSessizBitis("");
      }
      setBilgi("Sessiz saat kaydedildi.");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sessiz saat kaydedilemedi");
    }
  }

  return (
    <div>
      <PageHeader title="Bildirim Tercihleri" subtitle="Hangi olayın hangi kanaldan ulaşacağını siz seçersiniz." />
      {hata && <Alert tone="error">{hata}</Alert>}
      {bilgi && <Alert tone="success">{bilgi}</Alert>}

      <Card pad={false} title={<div><span>KANALLAR</span><h2>Olay türüne göre</h2></div>}>
        <TableWrap>
          <thead>
            <tr>
              <th>Olay</th>
              <th>Uygulama içi</th>
              <th>E-posta</th><th>SMS</th>
            </tr>
          </thead>
          <tbody>
            {TURLER.map((tur) => (
              <tr key={tur.deger}>
                <td>
                  <strong>{tur.ad}</strong>
                  <small style={{ display: "block", color: "var(--text-muted)" }}>{tur.aciklama}</small>
                </td>
                <td>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                    <input
                      type="checkbox"
                      aria-label={`${tur.ad} — uygulama içi bildirim`}
                      checked={secim(tur.deger).uygulamaIci}
                      onChange={(e) => void kanalDegistir(tur.deger, "uygulamaIci", e.target.checked)}
                    />
                    <span>Açık</span>
                  </label>
                </td>
                <td>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                    <input
                      type="checkbox"
                      aria-label={`${tur.ad} — e-posta bildirimi`}
                      checked={secim(tur.deger).eposta}
                      onChange={(e) => void kanalDegistir(tur.deger, "eposta", e.target.checked)}
                    />
                    <span>Açık</span>
                  </label>
                </td>
                <td>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                    <input
                      type="checkbox"
                      aria-label={`${tur.ad} — kritik bildirim SMS'i`}
                      checked={Boolean(secim(tur.deger).sms)}
                      onChange={(e) => void kanalDegistir(tur.deger, "sms", e.target.checked)}
                    />
                    <span>Kritikse</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card
        className="mt-1"
        title={<div><span>SESSİZ SAAT</span><h2>Mesai dışı e-posta</h2></div>}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Bu aralıkta bildirim kaydedilir ama e-postası gönderilmez; aralık bittiğinde birikenler gönderilir.
          Gece yarısını aşan aralık (22:00–07:00) desteklenir.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <Field label="Başlangıç">
            <Input type="time" value={sessizBaslangic} onChange={(e) => setSessizBaslangic(e.target.value)} />
          </Field>
          <Field label="Bitiş">
            <Input type="time" value={sessizBitis} onChange={(e) => setSessizBitis(e.target.value)} />
          </Field>
          <Button variant="primary" onClick={() => void sessizSaatKaydet()} type="button" disabled={!sessizBaslangic || !sessizBitis}>
            Kaydet
          </Button>
          <Button onClick={() => void sessizSaatKaydet(true)} type="button">Sessiz saati kaldır</Button>
        </div>
      </Card>

      <TelegramKarti />
    </div>
  );
}
