"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { kuyruktanSil } from "@/lib/saha-depo";
import { useSaha } from "./saha-baglam";

const SAYIM_ROLLERI = ["yonetici", "muhasebe", "depo"];
const MAL_KABUL_ROLLERI = ["yonetici", "muhasebe", "satis", "depo"];
/** SAH-07: POS bağlantısı açabilen roller. */
const TAHSILAT_ROLLERI = ["yonetici", "muhasebe"];
const MASRAF_DISI = ["calisan", "b2b_bayi"];

/** SAH-01: rolün açabildiği saha işleri ve cihazdaki bekleyen kuyruk. */
export default function SahaAnaSayfa() {
  const { kullanici, cevrimici, kuyruk, gonder, kuyrukYenile, cikis } = useSaha();
  const [isleniyor, setIsleniyor] = useState(false);
  const rol = kullanici?.rol ?? "";
  const hatali = kuyruk.filter((k) => k.durum === "hata");

  async function hepsiniGonder(yalniz?: string) {
    setIsleniyor(true);
    try { await gonder(yalniz); } finally { setIsleniyor(false); }
  }

  return (
    <>
      <nav className="saha-kutular" aria-label="Saha işleri">
        {SAYIM_ROLLERI.includes(rol) && (
          <Link className="saha-kutu" href="/saha/sayim"><span aria-hidden>▦</span><strong>Barkodla sayım</strong><small>Depoda okut, taslak sayım gönder</small></Link>
        )}
        {MAL_KABUL_ROLLERI.includes(rol) && (
          <Link className="saha-kutu" href="/saha/mal-kabul"><span aria-hidden>⇩</span><strong>Mal kabul</strong><small>Sipariş ya da e-İrsaliyeyi okutarak teslim al</small></Link>
        )}
        {TAHSILAT_ROLLERI.includes(rol) && (
          <Link className="saha-kutu" href="/saha/tahsilat"><span aria-hidden>₺</span><strong>Tahsilat</strong><small>Bakiye gör, ödeme bağlantısı gönder</small></Link>
        )}
        {rol && !MASRAF_DISI.includes(rol) && (
          <Link className="saha-kutu" href="/saha/masraf"><span aria-hidden>🧾</span><strong>Masraf fişi</strong><small>Fotoğrafını çek, taslak açılsın</small></Link>
        )}
        {rol && !MASRAF_DISI.includes(rol) && (
          <Link className="saha-kutu" href="/mobil/asistan"><span aria-hidden>✦</span><strong>Asistan</strong><small>Soru sor, onay taleplerini gör</small></Link>
        )}
      </nav>
      {!kullanici && <p className="muted">Oturum bilgisi yükleniyor…</p>}

      {kuyruk.length > 0 && (
        <section className="saha-kart" aria-label="Gönderilmeyi bekleyenler">
          <header><strong>Gönderilmeyi bekleyen ({kuyruk.length})</strong>
            <Button size="sm" disabled={!cevrimici || isleniyor} onClick={() => void hepsiniGonder()}>{isleniyor ? "Gönderiliyor…" : "Şimdi gönder"}</Button>
          </header>
          {!cevrimici && <p className="muted">Bağlantı gelince kendiliğinden gönderilir. Kayıtlar bu cihazda en çok 7 gün tutulur.</p>}
          <ul className="saha-liste">
            {kuyruk.map((k) => (
              <li key={k.id}>
                <div><strong>{k.tur === "sayim" ? "Sayım" : "Masraf fişi"}</strong> · {k.baslik}<small>{new Date(k.olusturma).toLocaleString("tr-TR")}{k.durum === "hata" ? ` · ${k.hata}` : ""}</small></div>
                <div className="saha-liste__eylem">
                  {k.durum === "hata" && <Button size="sm" disabled={!cevrimici || isleniyor} onClick={() => void hepsiniGonder(k.id)}>Yeniden dene</Button>}
                  <Button size="sm" variant="danger" disabled={isleniyor} onClick={() => { if (window.confirm("Bu kayıt cihazdan silinsin mi? Sunucuya gönderilmeyecek.")) void kuyruktanSil(k.id).then(kuyrukYenile); }}>Sil</Button>
                </div>
              </li>
            ))}
          </ul>
          {hatali.length > 0 && <Alert tone="error">{hatali.length} kayıt sunucuda reddedildi; nedeni satırda yazıyor.</Alert>}
        </section>
      )}

      <div className="saha-alt">
        <Button variant="ghost" onClick={() => { if (!kuyruk.length || window.confirm(`Cihazda gönderilmemiş ${kuyruk.length} kayıt var; çıkışta silinir. Devam edilsin mi?`)) void cikis(); }}>Çıkış yap</Button>
      </div>
    </>
  );
}
