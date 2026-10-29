"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

interface Alan { anahtar: string; etiket: string; gizli: boolean; dolu: boolean; deger?: string }
interface Saglayici { saglayici: "iyzico" | "paytr"; ad: string; bagli: boolean; ortam: "test" | "canli"; etkin: boolean; guncellendi: string | null; alanlar: Alan[] }

/**
 * PLT-11: abonelik bedelini tahsil eden ödeme sağlayıcısı. Gizli alanlar bir
 * kez girilir, sonra gösterilmez; boş bırakılırsa kayıtlı değer korunur.
 * Etkin sağlayıcı yoksa firmalar ödemeyi elle (PLT-09) yapar.
 */
export default function PlatformOdeme() {
  const [liste, setListe] = useState<Saglayici[] | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => setListe(await platformApi<Saglayici[]>("/platform/odeme-saglayicilari")), []);
  useEffect(() => { if (platformTokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi")); }, [yukle]);

  const etkin = liste?.find((s) => s.etkin);
  return <>
    <PageHeader title="Abonelik ödemesi" subtitle="Firmaların abonelik bedelini kartla ödediği sağlayıcı. Aynı anda tek sağlayıcı etkin olur; elle tahsilat (Firmalar ekranı) her zaman açıktır." />
    <Alert tone="error">{hata}</Alert>
    {basari && <Alert tone="success">{basari}</Alert>}
    {liste && !etkin && <Alert tone="warning">Etkin sağlayıcı yok: firmalar panelde çevrim içi ödeme göremez, hatırlatma e-postası ödeme bağlantısı taşımaz.</Alert>}
    <div className="stack">
      {liste?.map((s) => <SaglayiciKarti key={s.saglayici} s={s} onTamam={async (m) => { setBasari(m); setHata(""); await yukle(); }} onHata={(m) => { setHata(m); setBasari(""); }} />)}
    </div>
  </>;
}

function SaglayiciKarti({ s, onTamam, onHata }: { s: Saglayici; onTamam: (m: string) => Promise<void>; onHata: (m: string) => void }) {
  const [ortam, setOrtam] = useState(s.ortam);
  const [alanlar, setAlanlar] = useState<Record<string, string>>(() => Object.fromEntries(s.alanlar.map((a) => [a.anahtar, a.gizli ? "" : a.deger ?? ""])));
  const [islem, setIslem] = useState(false);

  async function kaydet(etkin: boolean) {
    if (etkin && ortam === "canli" && !confirm(`${s.ad} canlı ortamda etkinleştirilsin mi? Firmaların kartından gerçek çekim yapılır.`)) return;
    setIslem(true);
    try {
      const r = await platformApi<{ mesaj: string }>(`/platform/odeme-saglayicilari/${s.saglayici}`, { method: "PUT", body: JSON.stringify({ ortam, etkin, alanlar }) });
      await onTamam(r.mesaj);
    } catch (e) {
      onHata(e instanceof Error ? e.message : "Kaydedilemedi");
    } finally {
      setIslem(false);
    }
  }

  return (
    <Card title={s.ad}>
      <div className="stack">
        <div className="row-tight">
          {s.etkin ? <Badge variant="success">Etkin · {s.ortam === "canli" ? "canlı" : "test"}</Badge> : <Badge variant="neutral">Kapalı</Badge>}
          {!s.bagli && <Badge variant="warning">Abonelik tahsilatı henüz bağlı değil</Badge>}
          {s.guncellendi && <span className="subtle">Son değişiklik {new Date(s.guncellendi).toLocaleString("tr-TR")}</span>}
        </div>
        <div className="form-grid">
          <Field label="Ortam"><Select value={ortam} onChange={(e) => setOrtam(e.target.value as "test" | "canli")}><option value="test">Test (sandbox)</option><option value="canli">Canlı</option></Select></Field>
          {s.alanlar.map((a) => (
            <Field key={a.anahtar} label={a.etiket}>
              <Input
                type={a.gizli ? "password" : "text"}
                autoComplete="off"
                value={alanlar[a.anahtar] ?? ""}
                placeholder={a.gizli && a.dolu ? "Kayıtlı — değiştirmek için yazın" : ""}
                onChange={(e) => setAlanlar((x) => ({ ...x, [a.anahtar]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        <div className="row-tight">
          <Button disabled={islem} onClick={() => void kaydet(s.etkin)}>Kaydet</Button>
          {s.etkin
            ? <Button variant="danger" disabled={islem} onClick={() => void kaydet(false)}>Kapat</Button>
            : <Button variant="primary" disabled={islem || !s.bagli} onClick={() => void kaydet(true)}>Kaydet ve etkinleştir</Button>}
        </div>
      </div>
    </Card>
  );
}
