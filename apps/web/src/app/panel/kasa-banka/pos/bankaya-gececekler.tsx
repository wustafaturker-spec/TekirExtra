"use client";

/**
 * Bankaya geçecek POS tutarları (P1-6).
 *
 * POS bakiyesi en yeni ödemeden geriye tahsilatlara dağıtılır ve valör
 * tarihine göre gruplanır; her grupta hesabın komisyon oranıyla komisyon
 * önerilir. "Aktar" aktarım formunu grubun tutarlarıyla doldurur, kullanıcı
 * bankanın yatırdığı net tutara göre düzeltir.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Para, Tarih } from "@/components/ui";

export interface AktarimGrubu {
  valorTarihi: string;
  vadesiGeldi: boolean;
  adet: number;
  brut: string;
  onerilenKomisyon: string;
  net: string;
}

export interface GececekHesap {
  posHesap: { id: string; ad: string; saglayici: string; dovizCinsi: string; valorGun: number; komisyonOrani: string; varsayilanBankaHesap: { id: string; ad: string } | null };
  bakiye: string;
  gruplar: AktarimGrubu[];
  dagitilamayan: string;
}

export function BankayaGececekler({ yenile, onAktar }: { yenile: number; onAktar: (hesapId: string, grup: AktarimGrubu) => void }) {
  const [hesaplar, setHesaplar] = useState<GececekHesap[] | null>(null);
  const [hata, setHata] = useState("");

  useEffect(() => {
    let iptal = false;
    api<GececekHesap[]>("/pos/bankaya-gececekler")
      .then((v) => { if (!iptal) { setHesaplar(v); setHata(""); } })
      .catch((e) => { if (!iptal) setHata(e instanceof Error ? e.message : "Bankaya geçecekler yüklenemedi"); });
    return () => { iptal = true; };
  }, [yenile]);

  const dolu = (hesaplar ?? []).filter((h) => h.gruplar.length > 0 || Number(h.dagitilamayan) !== 0);

  return (
    <section className="pos-settlement" aria-label="Bankaya geçecekler">
      <div className="pos-section-head">
        <div><span>VALÖR TAKVİMİ</span><h2>Bankaya geçecekler</h2></div>
        <small>POS bakiyesi, en yeni tahsilattan geriye doğru valör tarihine göre dağıtılır.</small>
      </div>
      {hata && <p className="pos-error">{hata}</p>}
      {hesaplar && dolu.length === 0 && <div className="pos-empty"><strong>Bankaya geçecek tutar yok</strong><span>POS hesaplarındaki tahsilatlar bankaya aktarılmış.</span></div>}
      {dolu.map((h) => (
        <article key={h.posHesap.id} className="pos-settlement__account">
          <header>
            <div>
              <strong>{h.posHesap.ad}</strong>
              <small>
                {h.posHesap.saglayici === "banka" ? "Banka POS'u" : h.posHesap.saglayici} · valör {h.posHesap.valorGun === 0 ? "aynı gün" : `${h.posHesap.valorGun} gün`} · komisyon %{Number(h.posHesap.komisyonOrani).toLocaleString("tr-TR")}
                {h.posHesap.varsayilanBankaHesap && <> · → {h.posHesap.varsayilanBankaHesap.ad}</>}
              </small>
            </div>
            <div className="pos-settlement__total"><small>POS bakiyesi</small><strong><Para deger={h.bakiye} dovizCinsi={h.posHesap.dovizCinsi} /></strong></div>
          </header>
          <div className="table-wrap">
            <table className="table table--compact">
              <thead><tr><th>Valör</th><th className="num">Tahsilat</th><th className="num">Brüt</th><th className="num">Önerilen komisyon</th><th className="num">Net</th><th /></tr></thead>
              <tbody>
                {h.gruplar.map((g) => (
                  <tr key={g.valorTarihi} className={g.vadesiGeldi ? "is-due" : undefined}>
                    <td><Tarih deger={g.valorTarihi} /> {g.vadesiGeldi ? <Badge variant="warning">Vadesi geldi</Badge> : <Badge variant="neutral">Bekliyor</Badge>}</td>
                    <td className="num">{g.adet}</td>
                    <td className="num"><Para deger={g.brut} dovizCinsi={h.posHesap.dovizCinsi} /></td>
                    <td className="num"><Para deger={g.onerilenKomisyon} dovizCinsi={h.posHesap.dovizCinsi} /></td>
                    <td className="num"><strong><Para deger={g.net} dovizCinsi={h.posHesap.dovizCinsi} /></strong></td>
                    <td className="num"><Button size="sm" variant={g.vadesiGeldi ? "primary" : "ghost"} onClick={() => onAktar(h.posHesap.id, g)}>Aktar</Button></td>
                  </tr>
                ))}
                {Number(h.dagitilamayan) !== 0 && (
                  <tr>
                    <td colSpan={2}><small className="muted">Tahsilata bağlanamayan bakiye (elle girilmiş POS fişi vb.)</small></td>
                    <td className="num"><Para deger={h.dagitilamayan} dovizCinsi={h.posHesap.dovizCinsi} /></td>
                    <td colSpan={3} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </section>
  );
}
