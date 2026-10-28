"use client";

import { useEffect, useState } from "react";
import { hareketsizlikAyarla, hareketsizlikleCik, oturumuTazele, sonEtkinlikAl, sonEtkinlikKaydet } from "@/lib/api";
import { Button, Modal } from "@/components/ui";

const ETKINLIK_OLAYLARI = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
const UYARI_MS = 2 * 60_000;
const DENETIM_MS = 5_000;

/**
 * KLN-22: firma hareketsizlik süresi seçtiyse etkin kullanıcının oturumu
 * tazelenir; süre dolmadan iki dakika önce uyarı çıkar, dolunca oturum kapanır.
 * Sunucu da son yenilemesi süreden eski oturumu yenilemez.
 */
export function HareketsizlikIzleyici({ dakika }: { dakika: number | null }) {
  const [kalanSn, setKalanSn] = useState<number | null>(null);

  useEffect(() => {
    hareketsizlikAyarla(dakika);
    if (!dakika) {
      setKalanSn(null);
      return;
    }
    const sureMs = dakika * 60_000;
    // Etkin kullanıcıda sunucudaki "son yenileme" süreye hiç yaklaşmasın.
    const tazelemeMs = Math.min(5 * 60_000, sureMs / 3);
    let sonKayit = 0;
    const etkinlik = () => {
      const simdi = Date.now();
      if (simdi - sonKayit < DENETIM_MS) return;
      sonKayit = simdi;
      sonEtkinlikKaydet(simdi);
      void oturumuTazele(tazelemeMs);
    };
    sonEtkinlikKaydet();
    for (const olay of ETKINLIK_OLAYLARI) window.addEventListener(olay, etkinlik, { passive: true });
    const denetle = () => {
      const kalan = sureMs - (Date.now() - sonEtkinlikAl());
      if (kalan <= 0) {
        void hareketsizlikleCik();
        return;
      }
      setKalanSn(kalan <= UYARI_MS ? Math.ceil(kalan / 1000) : null);
    };
    const zamanlayici = window.setInterval(denetle, 1_000);
    return () => {
      window.clearInterval(zamanlayici);
      for (const olay of ETKINLIK_OLAYLARI) window.removeEventListener(olay, etkinlik);
    };
  }, [dakika]);

  if (kalanSn === null) return null;
  const surdur = () => {
    sonEtkinlikKaydet();
    setKalanSn(null);
    void oturumuTazele(0);
  };
  const dk = Math.floor(kalanSn / 60);
  const sn = String(kalanSn % 60).padStart(2, "0");
  return (
    <Modal baslik="Oturumunuz kapanmak üzere" onKapat={surdur} altBilgi={<div className="row-tight" style={{ justifyContent: "flex-end" }}><Button variant="primary" onClick={surdur}>Oturumu sürdür</Button></div>}>
      <p>
        Bir süredir işlem yapılmadığı için oturumunuz <strong>{dk}:{sn}</strong> sonra güvenlik amacıyla kapanacak.
        Çalışmaya devam ediyorsanız oturumu sürdürün.
      </p>
    </Modal>
  );
}
