"use client";

/**
 * NAK-15: anlık nakit pozisyonu — hazır değerler, kısa vadeli finansal
 * borçlar ve net; döviz bazında ve TL karşılığıyla. Altında 7/30 gün
 * içindeki vadeler (nakit akışı tahmininden).
 */
import { useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Badge, ButtonLabel, Card, PageHeader, Para, Segmented, TableWrap, Tarih } from "@/components/ui";

interface Kalem { tur: string; id: string; ad: string; dovizCinsi: string; tutar: string; tl: string | null; baglanti: string }
interface Vade { giris: number; cikis: number; net: number; kaynaklar: Array<{ ad: string; giris: number; cikis: number }>; kalemler: Array<{ tarih: string; vade: string; gecikmis: boolean; yon: string; tutar: number; aciklama: string; kaynak: string }> }
interface Pozisyon {
  kurTarihi: string | null;
  kurEksik: string[];
  varliklar: Kalem[];
  borclar: Kalem[];
  dovizler: Array<{ dovizCinsi: string; varlik: string; borc: string; net: string; kur: number | null }>;
  toplamTl: { varlik: string; borc: string; net: string };
  vadeler: Record<"7" | "30", Vade> | null;
}

const TUR: Record<string, string> = { kasa: "Kasa", banka: "Banka", pos: "POS", alinan_cek: "Çek/senet", kart: "Kredi kartı", kredi: "Kredi", verilen_cek: "Verilen çek" };

function KalemTablosu({ kalemler, bos }: { kalemler: Kalem[]; bos: string }) {
  return (
    <TableWrap>
      <thead><tr><th>Tür</th><th>Hesap</th><th className="num">Tutar</th><th className="num">TL karşılığı</th></tr></thead>
      <tbody>
        {kalemler.map((k) => (
          <tr key={`${k.tur}:${k.id}`} className={Number(k.tutar) < 0 ? "is-negative" : ""}>
            <td><Badge variant="neutral">{TUR[k.tur] ?? k.tur}</Badge></td>
            <td><a href={k.baglanti}>{k.ad}</a></td>
            <td className="num"><Para deger={k.tutar} dovizCinsi={k.dovizCinsi} /></td>
            <td className="num">{k.dovizCinsi === "TRY" ? "" : k.tl === null ? <span className="muted">kur yok</span> : <Para deger={k.tl} dovizCinsi="TRY" />}</td>
          </tr>
        ))}
        {!kalemler.length && <tr><td colSpan={4} className="kredi-bos">{bos}</td></tr>}
      </tbody>
    </TableWrap>
  );
}

export default function NakitPozisyonuSayfasi() {
  const [p, setP] = useState<Pozisyon | null>(null);
  const [hata, setHata] = useState("");
  const [ufuk, setUfuk] = useState<"7" | "30">("7");
  useEffect(() => {
    if (tokenAl()) void api<Pozisyon>("/nakit-akisi/pozisyon").then(setP).catch((e) => setHata(e instanceof Error ? e.message : "Nakit pozisyonu hesaplanamadı"));
  }, []);
  const vade = p?.vadeler?.[ufuk];

  return (
    <div className="kredi-page">
      <PageHeader
        title="Nakit pozisyonu"
        subtitle="Hazır değerler ile kısa vadeli finansal borçların anlık durumu, döviz bazında ve TL karşılığıyla; altında önümüzdeki günlerin vadeleri."
        actions={<><ButtonLabel as="a" href="/panel/kasa-banka">← Kasa & Banka</ButtonLabel><ButtonLabel as="a" href="/panel/nakit-akisi">Nakit akışı →</ButtonLabel></>}
      />
      {hata && <Alert tone="error">{hata}</Alert>}
      {p && (
        <>
          {p.kurEksik.length > 0 && <Alert tone="warning">{p.kurEksik.join(", ")} için güncel TCMB kuru bulunamadı; bu dövizler TL toplamına girmedi.</Alert>}
          <section className="muh-ozet">
            <div className="is-ok"><span>Hazır değerler</span><strong><Para deger={p.toplamTl.varlik} dovizCinsi="TRY" /></strong><small>kasa, banka, POS, portföy çekleri</small></div>
            <div><span>Finansal borçlar</span><strong><Para deger={p.toplamTl.borc} dovizCinsi="TRY" /></strong><small>kart, kredi, verilen çekler</small></div>
            <div className={Number(p.toplamTl.net) < 0 ? "is-warning" : "is-ok"}><span>Net pozisyon</span><strong><Para deger={p.toplamTl.net} dovizCinsi="TRY" /></strong><small>{p.kurTarihi ? <>TCMB alış kuru · <Tarih deger={p.kurTarihi} /></> : "TL"}</small></div>
            {vade && <div className={vade.net < 0 ? "is-warning" : ""}><span>{ufuk} gün içindeki vadeler</span><strong><Para deger={vade.net} dovizCinsi="TRY" /></strong><small>+<Para deger={vade.giris} dovizCinsi="TRY" /> / −<Para deger={vade.cikis} dovizCinsi="TRY" /></small></div>}
          </section>

          <Card pad={false} title={<div><span className="kredi-ust">DÖVİZ BAZINDA</span><h2>Pozisyon</h2></div>}>
            <TableWrap>
              <thead><tr><th>Döviz</th><th className="num">Hazır değer</th><th className="num">Finansal borç</th><th className="num">Net</th><th className="num">Kur</th></tr></thead>
              <tbody>
                {p.dovizler.map((d) => (
                  <tr key={d.dovizCinsi}>
                    <td><strong>{d.dovizCinsi}</strong></td>
                    <td className="num"><Para deger={d.varlik} dovizCinsi={d.dovizCinsi} /></td>
                    <td className="num"><Para deger={d.borc} dovizCinsi={d.dovizCinsi} /></td>
                    <td className="num"><strong className={Number(d.net) < 0 ? "treasury-out" : "treasury-in"}><Para deger={d.net} dovizCinsi={d.dovizCinsi} /></strong></td>
                    <td className="num">{d.dovizCinsi === "TRY" ? "" : d.kur ? d.kur.toLocaleString("tr-TR", { maximumFractionDigits: 4 }) : <span className="muted">yok</span>}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>

          <div className="nakit-iki">
            <Card pad={false} title={<div><span className="kredi-ust">VARLIK</span><h2>Hazır değerler</h2></div>}><KalemTablosu kalemler={p.varliklar} bos="Aktif kasa ya da banka hesabı yok." /></Card>
            <Card pad={false} title={<div><span className="kredi-ust">BORÇ</span><h2>Kısa vadeli finansal borçlar</h2></div>}><KalemTablosu kalemler={p.borclar} bos="Kart, kredi ya da verilen çek borcu yok." /></Card>
          </div>

          {p.vadeler && vade && (
            <Card
              pad={false}
              title={<div><span className="kredi-ust">YAKIN VADELER</span><h2>Önümüzdeki {ufuk} gün</h2><small>Nakit akışı tahmininden; vadesi geçmiş kalemler bugüne alınır.</small></div>}
              actions={<Segmented ariaLabel="Vade ufku" items={[{ deger: "7" as const, baslik: "7 gün" }, { deger: "30" as const, baslik: "30 gün" }]} value={ufuk} onChange={setUfuk} />}
            >
              <div className="nakit-kaynak">
                {vade.kaynaklar.map((k) => (
                  <span key={k.ad}>{k.ad}{k.giris > 0 && <strong className="treasury-in"> +<Para deger={k.giris} dovizCinsi="TRY" /></strong>}{k.cikis > 0 && <strong className="treasury-out"> −<Para deger={k.cikis} dovizCinsi="TRY" /></strong>}</span>
                ))}
                {!vade.kaynaklar.length && <span className="muted">Bu sürede vadesi gelen kalem yok.</span>}
              </div>
              <TableWrap>
                <thead><tr><th>Beklenen tarih</th><th>Kaynak</th><th>Açıklama</th><th className="num">Tutar (TL)</th></tr></thead>
                <tbody>
                  {vade.kalemler.map((k, i) => (
                    <tr key={i}>
                      <td><Tarih deger={k.tarih} />{k.gecikmis && <small className="kredi-alt"> · vadesi <Tarih deger={k.vade} /> geçti</small>}</td>
                      <td>{k.kaynak}</td>
                      <td>{k.aciklama}</td>
                      <td className="num"><span className={k.yon === "giris" ? "treasury-in" : "treasury-out"}>{k.yon === "giris" ? "+" : "−"}<Para deger={k.tutar} dovizCinsi="TRY" /></span></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
