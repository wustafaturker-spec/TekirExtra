"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Alert } from "@/components/ui";

/**
 * ETC-12: İdeaSoft yetki dönüşü. İdeaSoft kullanıcıyı `?code=…&state=…` (ya da `?error=…`) ile buraya
 * gönderir; kod 30 sn geçerli olduğu için sayfa açılır açılmaz sunucuya iletilir (bir kez).
 */
export default function IdeasoftDonus() {
  const [durum, setDurum] = useState<{ tur: "bekliyor" | "basarili" | "hata"; mesaj: string }>({ tur: "bekliyor", mesaj: "İdeaSoft yetkisi tamamlanıyor…" });
  const gonderildi = useRef(false);

  useEffect(() => {
    if (gonderildi.current) return;
    gonderildi.current = true;
    const q = new URLSearchParams(window.location.search);
    // Kod ve state adres çubuğunda/geçmişte kalmasın.
    window.history.replaceState(null, "", window.location.pathname);
    const hata = q.get("error");
    if (hata) { setDurum({ tur: "hata", mesaj: hata === "access_denied" ? "İdeaSoft'ta yetki verilmedi." : `İdeaSoft yetkisi alınamadı: ${q.get("error_description") ?? hata}` }); return; }
    const code = q.get("code"); const state = q.get("state");
    if (!code || !state) { setDurum({ tur: "hata", mesaj: "İdeaSoft yanıtında yetki kodu yok. Bağlantı penceresinden yeniden başlatın." }); return; }
    api<{ basarili: boolean; mesaj: string }>("/pazaryeri/ideasoft/yetki-tamamla", { method: "POST", body: JSON.stringify({ code, state }) })
      .then((r) => setDurum(r.basarili ? { tur: "basarili", mesaj: `Yetki alındı. ${r.mesaj}` } : { tur: "hata", mesaj: `Yetki alındı ancak sınama başarısız: ${r.mesaj}` }))
      .catch((x) => setDurum({ tur: "hata", mesaj: x instanceof Error ? x.message : "İdeaSoft yetkisi tamamlanamadı" }));
  }, []);

  return <div className="market-page">
    <header className="market-hero"><div><span>ENTEGRASYON MERKEZİ</span><h1>İdeaSoft bağlantısı</h1></div></header>
    {durum.tur === "bekliyor" ? <p className="muted" role="status">{durum.mesaj}</p> : <Alert tone={durum.tur === "basarili" ? "success" : "error"}>{durum.mesaj}</Alert>}
    <p><Link className="btn btn--primary" href="/panel/ayarlar/pazaryerleri">Entegrasyonlara dön</Link></p>
  </div>;
}
