"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Tarih } from "@/components/ui";

const POLITIKA_SURUMU = "2026-10-v1";
interface Ayar { saglayici: string; modelAdi?: string | null; yurtDisiOnay: { tarih: string; onaylayan: string | null; saglayici: string | null; model: string | null; politikaSurumu: string | null } | null }

/**
 * AI-14: yurt dışındaki yapay zekâ sağlayıcısına veri aktarımı için yönetici
 * onayı. Onay yoksa Gemini/OpenAI/Anthropic'e hiç istek gitmez.
 */
export function YzVeriOnayiKart() {
  const [ayar, setAyar] = useState<Ayar | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  useEffect(() => {
    api<Ayar>("/ai/ayarlar").then(setAyar).catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi"));
  }, []);

  async function degistir(onay: boolean) {
    setIsleniyor(true);
    setHata(null);
    try {
      setAyar(await api<Ayar>("/ai/ayarlar/yurt-disi-onay", { method: "POST", body: JSON.stringify({ onay, politikaSurumu: POLITIKA_SURUMU }) }));
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Kaydedilemedi");
    } finally {
      setIsleniyor(false);
    }
  }

  const onay = ayar?.yurtDisiOnay;
  return (
    <Card title={<>Yurt dışı veri aktarımı onayı (KVKK) {ayar && (onay ? <Badge variant="success">Onaylı</Badge> : <Badge variant="warning">Onay yok</Badge>)}</>}>
      <div className="yz-onay">
        <p>
          Asistan, MCP, fiş/kartvizit tarama, yönetici özeti yorumu, ekstre önerisi ve hatırlatma metni kullanıldığında şu veriler
          seçili yapay zekâ sağlayıcısına (Google Gemini, OpenAI ya da Anthropic; sunucuları yurt dışında) gönderilir:
        </p>
        <p>Onay kapsamı: <strong>{ayar?.saglayici ?? "—"}</strong> / {ayar?.modelAdi || "varsayılan model"} · Metin sürümü {POLITIKA_SURUMU}. Sağlayıcı veya model değişirse yeniden onay gerekir.</p>
        <ul>
          <li>Cari unvanı, vergi kimlik numarası, iletişim bilgileri ve bakiyeler</li>
          <li>Stok, fiyat, teklif, fatura, masraf ve rapor rakamları</li>
          <li>Taranan fiş, fatura ve kartvizit görselleri; kullanıcıların asistana yazdığı metinler</li>
        </ul>
        <p className="muted">
          Onay verilmedikçe bu sağlayıcılara hiç istek gönderilmez. Platformun kendi sunucusundaki Ollama modeli onaysız çalışır.
          Bu kayıt teknik aktarım iznidir; KVKK md. 9 kapsamındaki hukuki dayanağın ve aktarım şartlarının değerlendirilmesinin yerini almaz.
        </p>
        {onay && <p>Onaylayan: <strong>{onay.onaylayan ?? "—"}</strong> · {onay.saglayici}/{onay.model || "varsayılan model"} · {onay.politikaSurumu} · <Tarih deger={onay.tarih} saatli /></p>}
        {hata && <Alert tone="error">{hata}</Alert>}
        <div className="row-tight">
          {onay
            ? <Button disabled={isleniyor} variant="danger" onClick={() => void degistir(false)}>Onayı geri al</Button>
            : <Button disabled={isleniyor || !ayar} variant="primary" onClick={() => void degistir(true)}>Okudum, aktarımı onaylıyorum</Button>}
        </div>
      </div>
    </Card>
  );
}
