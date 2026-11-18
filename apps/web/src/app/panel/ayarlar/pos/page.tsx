"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, Modal, ModalEylem, PageHeader, Select } from "@/components/ui";

const SAGLAYICILAR = [
  { kod: "iyzico", ad: "iyzico", simge: "İZ" },
  { kod: "paytr", ad: "PayTR", simge: "PT" },
] as const;
type Saglayici = (typeof SAGLAYICILAR)[number];
interface Baglanti {
  id: string;
  aile: string;
  saglayici: string;
  durum: string;
  kullaniciAdiMaskeli: string;
  ayarlar?: Partial<Record<string, string>>;
}

export default function PosAyarlari() {
  const [kayitlar, setKayitlar] = useState<Baglanti[] | null>(null);
  const [listeHatasi, setListeHatasi] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<Saglayici | null>(null);
  const kayit = kayitlar?.find((b) => b.saglayici === duzenlenen?.kod);

  const yukle = useCallback(async (signal?: AbortSignal) => {
    setYukleniyor(true);
    setListeHatasi("");
    try {
      const yanit = await api<Baglanti[]>("/baglantilar", { signal });
      if (!signal?.aborted) setKayitlar(yanit.filter((b) => b.aile === "pos"));
    } catch (e) {
      if (!signal?.aborted) setListeHatasi(e instanceof Error ? e.message : "Bağlantılar yüklenemedi.");
    } finally {
      if (!signal?.aborted) setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    const kontrol = new AbortController();
    void yukle(kontrol.signal);
    return () => kontrol.abort();
  }, [yukle]);

  async function calistir(is: () => Promise<string>) {
    setIslem(true);
    setHata("");
    setBasari("");
    try {
      setBasari(await is());
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Bağlantı işlemi tamamlanamadı.");
    } finally {
      setIslem(false);
    }
  }

  function kaydet(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!duzenlenen) return;
    const { kod, ad } = duzenlenen;
    const f = new FormData(e.currentTarget);
    const config = kod === "iyzico"
      ? { kullaniciAdi: f.get("apiKey"), parola: f.get("secretKey"), servisAdresi: f.get("ortam") }
      : { magazaId: f.get("merchantId"), kullaniciAdi: f.get("merchantKey"), parola: f.get("merchantSalt") };
    void calistir(async () => {
      await api(kayit ? `/baglantilar/${kayit.id}` : "/baglantilar", {
        method: kayit ? "PATCH" : "POST",
        body: JSON.stringify(kayit ? { config } : { aile: "pos", saglayici: kod, config }),
      });
      setDuzenlenen(null);
      return `${ad} bağlantı bilgileri kaydedildi. Tahsilat için bağlantıyı doğrulayın ve etkinleştirin.`;
    });
  }

  function testEt(id: string) {
    void calistir(async () => {
      const sonuc = await api<{ basarili: boolean; mesaj?: string }>(`/baglantilar/${id}/test`, { method: "POST" });
      if (!sonuc.basarili) throw new Error(sonuc.mesaj ?? "Doğrulama başarısız.");
      await api(`/baglantilar/${id}/aktif-et`, { method: "POST" });
      return "Bağlantı doğrulandı ve etkinleştirildi.";
    });
  }

  function formuKapat() {
    if (islem) return;
    setDuzenlenen(null);
    setHata("");
  }

  return <div className="pos-page">
    <PageHeader title="Sanal POS ayarları" subtitle="Ödeme sağlayıcısı bağlantılarını kurun ve doğrulayın."
      actions={<Button disabled={yukleniyor || islem} onClick={() => void yukle()}>Bağlantıları yenile</Button>} />
    {!duzenlenen && <Alert tone="error">{hata}</Alert>}
    <Alert tone="success">{basari}</Alert>
    <Card title="Ödeme sağlayıcıları">
      {listeHatasi && <Alert tone="error">{listeHatasi} <Button size="sm" onClick={() => void yukle()}>Tekrar dene</Button></Alert>}
      {yukleniyor && <p className="muted" role="status">Bağlantılar yükleniyor…</p>}
      {!listeHatasi && kayitlar && <div className="pos-provider-list">
        {SAGLAYICILAR.map((saglayici) => {
          const baglanti = kayitlar.find((b) => b.saglayici === saglayici.kod);
          const aktif = baglanti?.durum === "aktif";
          return <article className="pos-provider-row" aria-label={saglayici.ad} key={saglayici.kod}>
            <span className="pos-provider" aria-hidden="true">{saglayici.simge}</span>
            <div className="pos-provider-description">
              <strong>{saglayici.ad}</strong>
              {baglanti && <small className="muted">{baglanti.kullaniciAdiMaskeli}</small>}
            </div>
            <div className="pos-actions">
              <Badge variant={aktif ? "success" : baglanti?.durum === "hata" ? "danger" : "neutral"}>
                {aktif ? "Aktif" : baglanti?.durum === "hata" ? "Bağlantı hatası" : baglanti ? "Etkin değil" : "Kurulum bekliyor"}
              </Badge>
              {baglanti && !aktif && <Button disabled={islem || yukleniyor} size="sm" onClick={() => testEt(baglanti.id)}>Doğrula ve etkinleştir</Button>}
              <Button size="sm" variant={baglanti ? "ghost" : "primary"} disabled={islem || yukleniyor}
                onClick={() => { setHata(""); setBasari(""); setDuzenlenen(saglayici); }}>{baglanti ? "Düzenle" : "Bağla"}</Button>
            </div>
          </article>;
        })}
      </div>}
    </Card>
    {duzenlenen && <Modal genis baslik={`${duzenlenen.ad} bağlantısı`} onKapat={formuKapat}>
      <form className="stack" onSubmit={kaydet}>
        <Alert tone="error">{hata}</Alert>
        {kayit && <p className="muted">Kayıtlı gizli bilgiler gösterilmez. Kaydetmek için anahtarları yeniden girin.</p>}
        {duzenlenen.kod === "paytr" && <p className="muted">PayTR panelinde Link API mağazanız için etkin olmalıdır.</p>}
        <div className="form-grid pos-provider-fields">
          {duzenlenen.kod === "iyzico" ? <>
            <Field label="API Key"><Input name="apiKey" required /></Field>
            <Field label="Secret Key"><Input name="secretKey" type="password" required /></Field>
            <Field label="Ortam"><Select name="ortam" defaultValue={kayit?.ayarlar?.servisAdresi ?? "https://sandbox-api.iyzipay.com"}>
              <option value="https://sandbox-api.iyzipay.com">Sandbox</option>
              <option value="https://api.iyzipay.com">Canlı</option>
            </Select></Field>
          </> : <>
            <Field label="Mağaza No"><Input name="merchantId" required /></Field>
            <Field label="Merchant Key"><Input name="merchantKey" type="password" required /></Field>
            <Field label="Merchant Salt"><Input name="merchantSalt" type="password" required /></Field>
          </>}
        </div>
        <ModalEylem onVazgec={formuKapat} isleniyor={islem} metin="Kaydet" />
      </form>
    </Modal>}
  </div>;
}
