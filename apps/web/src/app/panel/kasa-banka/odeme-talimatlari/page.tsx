"use client";

/**
 * Ödeme talimatları (ENT-07): oluştur → ikinci kullanıcı TOTP ile onaylar →
 * ödeme paketi → toplu ödeme dosyası bankaya yüklenir → banka ekstresinde
 * eşleşince ya da "gerçekleşti" ile tediye fişi yazılır.
 */
import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, PageHeader, Tabs } from "@/components/ui";
import { DosyaProfili } from "./dosya-profili";
import { Paketler } from "./paketler";
import { TalimatListesi } from "./talimat-listesi";
import { TopluTalimat } from "./toplu-talimat";
import { YeniTalimat } from "./yeni-talimat";
import type { Banka } from "./tipler";

type Sekme = "talimatlar" | "yeni" | "toplu" | "paketler" | "profil";

export default function OdemeTalimatlari() {
  const [sekme, setSekme] = useState<Sekme>("talimatlar");
  const [bankalar, setBankalar] = useState<Banka[]>([]);
  const [userId, setUserId] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [yenile, setYenile] = useState(0);

  useEffect(() => {
    if (!tokenAl()) return;
    void Promise.all([api<Banka[]>("/kasa-banka/bankalar"), api<{ userId: string }>("/auth/ben")])
      .then(([b, ben]) => { setBankalar(b.filter((x) => x.aktif)); setUserId(ben.userId); })
      .catch((e) => setHata(e instanceof Error ? e.message : "Hesaplar yüklenemedi"));
  }, []);

  const mesaj = useCallback((m: string, hataMi = false) => {
    if (hataMi) { setHata(m); setBasari(""); return; }
    setHata(""); setBasari(m); setYenile((x) => x + 1);
  }, []);
  const kaydedildi = useCallback((m: string) => { mesaj(m); setSekme("talimatlar"); }, [mesaj]);

  return (
    <div className="ot-page">
      <PageHeader
        title="Ödeme Talimatları"
        subtitle="EFT/havale talimatlarını cari ve faturalarla oluşturun, ikinci kullanıcı ve doğrulama koduyla onaylayın, bankanızın toplu ödeme dosyasıyla gönderin. Kayıt, ödeme bankada gerçekleşince yazılır."
      />
      <ol className="ot-steps" aria-label="Akış">
        <li>Oluştur</li><li>İkinci kullanıcı onaylar</li><li>Ödeme paketi + dosya</li><li>Bankaya yükle</li><li>Ekstrede eşleş / gerçekleşti</li>
      </ol>
      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}
      <Tabs<Sekme>
        ariaLabel="Ödeme talimatı bölümleri"
        value={sekme}
        onChange={setSekme}
        items={[
          { deger: "talimatlar", baslik: "Talimatlar" },
          { deger: "yeni", baslik: "Yeni talimat" },
          { deger: "toplu", baslik: "Vadesi gelen borçlar" },
          { deger: "paketler", baslik: "Ödeme paketleri" },
          { deger: "profil", baslik: "Dosya profilleri" },
        ]}
      />
      {sekme === "talimatlar" && <TalimatListesi userId={userId} yenile={yenile} onMesaj={mesaj} onPaketlendi={() => setSekme("paketler")} />}
      {sekme === "yeni" && bankalar.length > 0 && <YeniTalimat bankalar={bankalar} onKaydedildi={kaydedildi} />}
      {sekme === "toplu" && bankalar.length > 0 && <TopluTalimat bankalar={bankalar} onKaydedildi={kaydedildi} />}
      {sekme === "paketler" && <Paketler yenile={yenile} onMesaj={mesaj} />}
      {sekme === "profil" && bankalar.length > 0 && <DosyaProfili bankalar={bankalar} onMesaj={mesaj} />}
    </div>
  );
}
