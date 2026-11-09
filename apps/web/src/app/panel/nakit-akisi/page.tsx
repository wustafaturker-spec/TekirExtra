"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Card, PageHeader, Para, Segmented, Select, Stat, StatGrid, TableWrap, Tarih } from "@/components/ui";
import { YzIcgoruKartlari } from "@/components/yz-icgoru-kartlari";

type Senaryo = "iyimser" | "baz" | "kotumser";
type Ufuk = 7 | 30 | 90;
interface SenaryoTarihi { tarih: string | null; neden: string | null }
interface Kalem {
  kaynak: string;
  kaynakId: string;
  yon: "giris" | "cikis";
  vade: string;
  odemeSozu?: { id: string; tarih: string; faturaVadesi: string };
  tutar: number;
  dovizCinsi: string;
  dovizTutar: number;
  aciklama: string;
  cariUnvan: string | null;
  tahmin: boolean;
  baglanti: string | null;
  tarihler: Record<Senaryo, SenaryoTarihi>;
}
interface Donem { baslangic: string; bitis: string; giris: number; cikis: number; net: number; bakiye: number }
interface SenaryoSonucu {
  donemler: Donem[];
  toplamGiris: number;
  toplamCikis: number;
  sonBakiye: number;
  ilkEksi: { tarih: string; bakiye: number } | null;
  enDusuk: { tarih: string; bakiye: number };
  kaydirilanTahsilat: { adet: number; tutar: number };
}
interface Tahmin {
  bugun: string;
  ufukGun: Ufuk;
  ufukSonu: string;
  donemTipi: "gun" | "hafta";
  baslangicBakiye: number;
  hesapSayisi: number;
  kur: { tarih: string; kurlar: Record<string, number> } | null;
  senaryolar: Record<Senaryo, SenaryoSonucu>;
  kalemler: Kalem[];
  kapsamDisi: string[];
  kapsamNotlari?: string[];
  uyarilar: string[];
}

const SENARYOLAR: Senaryo[] = ["iyimser", "baz", "kotumser"];
const SENARYO_ADLARI: Record<Senaryo, string> = { iyimser: "İyimser", baz: "Baz", kotumser: "Kötümser" };
const SENARYO_ACIKLAMALARI: Record<Senaryo, string> = {
  iyimser: "Alacaklar vadesinde tahsil edilir.",
  baz: "Alacaklar carinin geçmiş ortalama tahsilat gecikmesi kadar geç gelir.",
  kotumser: "Gecikme iki katıdır; kara listedeki cariler ve vadesi 90 günü aşmış alacaklar tahsil edilmez.",
};
const KAYNAK_ADLARI: Record<string, string> = {
  fatura: "Fatura",
  cek_senet: "Çek/senet",
  masraf: "Masraf",
  kira: "Kira",
  kart_ekstre: "Kart ekstresi",
  kredi_taksit: "Kredi taksiti",
  bordro: "Bordro",
  bordro_yasal: "SGK / muhtasar",
  vergi_takvimi: "Vergi ve SGK",
  tekrarlayan_fatura: "Tekrarlayan fatura",
  odeme_talimati: "Ödeme talimatı",
};

export default function NakitAkisiSayfasi() {
  const [ufuk, setUfuk] = useState<Ufuk>(30);
  const [senaryo, setSenaryo] = useState<Senaryo>("baz");
  const [kaynak, setKaynak] = useState("");
  const [tahmin, setTahmin] = useState<Tahmin | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");

  const yukle = useCallback(async (gun: Ufuk) => {
    setYukleniyor(true);
    setHata("");
    try {
      setTahmin(await api<Tahmin>(`/nakit-akisi?ufuk=${gun}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Nakit akışı hesaplanamadı");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    void yukle(ufuk);
  }, [ufuk, yukle]);

  const sonuc = tahmin?.senaryolar[senaryo];
  // Günlük dökümde hareketsiz günler gizlenir; son gün bakiye için hep kalır.
  const donemler = !tahmin || !sonuc
    ? []
    : tahmin.donemTipi === "gun"
      ? sonuc.donemler.filter((d, i, tum) => d.giris || d.cikis || i === tum.length - 1)
      : sonuc.donemler;
  const kalemler = useMemo(() => {
    if (!tahmin) return [];
    return tahmin.kalemler
      .filter((k) => !kaynak || k.kaynak === kaynak)
      .filter((k) => {
        const tarih = k.tarihler[senaryo].tarih;
        return tarih !== null && tarih <= tahmin.ufukSonu;
      })
      .sort((a, b) => (a.tarihler[senaryo].tarih ?? "").localeCompare(b.tarihler[senaryo].tarih ?? ""));
  }, [tahmin, kaynak, senaryo]);

  return (
    <div className="stack">
      <PageHeader
        title="Nakit Akışı"
        subtitle="Bugünkü kasa ve banka bakiyesinden başlayıp kayıtlı vade, ödeme ve planlardan hesaplanan tahmin."
        actions={
          <div className="row-tight">
            <Segmented
              ariaLabel="Tahmin ufku"
              items={[{ deger: "7", baslik: "7 gün" }, { deger: "30", baslik: "30 gün" }, { deger: "90", baslik: "90 gün" }]}
              value={String(ufuk)}
              onChange={(v) => setUfuk(Number(v) as Ufuk)}
            />
            <Segmented
              ariaLabel="Senaryo"
              items={SENARYOLAR.map((s) => ({ deger: s, baslik: SENARYO_ADLARI[s] }))}
              value={senaryo}
              onChange={setSenaryo}
            />
          </div>
        }
      />

      <YzIcgoruKartlari />

      {hata && <Alert tone="error">{hata}</Alert>}
      {tahmin?.uyarilar.map((u) => <div key={u} className="approval-impact is-warning">{u}</div>)}

      {yukleniyor && !tahmin ? (
        <Card><p className="muted">Tahmin hesaplanıyor…</p></Card>
      ) : tahmin && sonuc ? (
        <>
          <p className="muted" style={{ margin: 0 }}>{SENARYO_ACIKLAMALARI[senaryo]} Borçlar her senaryoda vadesinde ödenir.</p>

          <StatGrid>
            <Stat label="Başlangıç bakiyesi" value={<Para deger={tahmin.baslangicBakiye} isaretle />} hint={`${tahmin.hesapSayisi} kasa/banka hesabı, bugün itibarıyla`} />
            <Stat label="Beklenen giriş" tone="success" value={<Para deger={sonuc.toplamGiris} />} hint={`${tahmin.ufukGun} gün`} />
            <Stat label="Beklenen çıkış" tone="danger" value={<Para deger={sonuc.toplamCikis} />} hint={`${tahmin.ufukGun} gün`} />
            <Stat
              label="Dönem sonu bakiye"
              tone={sonuc.sonBakiye < 0 ? "danger" : "default"}
              value={<Para deger={sonuc.sonBakiye} isaretle />}
              hint={<>En düşük <Para deger={sonuc.enDusuk.bakiye} /> · <Tarih deger={sonuc.enDusuk.tarih} /></>}
            />
          </StatGrid>

          {sonuc.ilkEksi ? (
            <div className="approval-impact is-warning">
              Bu senaryoda bakiye <strong><Tarih deger={sonuc.ilkEksi.tarih} /></strong> tarihinde eksiye düşüyor (<Para deger={sonuc.ilkEksi.bakiye} />).
              En düşük nokta <Tarih deger={sonuc.enDusuk.tarih} />: <Para deger={sonuc.enDusuk.bakiye} />.
            </div>
          ) : (
            <div className="approval-impact">Bu senaryoda bakiye {tahmin.ufukGun} gün boyunca eksiye düşmüyor.</div>
          )}

          <Card title="Senaryo karşılaştırması" pad={false}>
            <TableWrap>
              <thead>
                <tr>
                  <th>Senaryo</th>
                  <th className="num">Giriş</th>
                  <th className="num">Çıkış</th>
                  <th className="num">Dönem sonu</th>
                  <th>İlk eksi gün</th>
                  <th>Ufuk dışına kayan tahsilat</th>
                </tr>
              </thead>
              <tbody>
                {SENARYOLAR.map((s) => {
                  const r = tahmin.senaryolar[s];
                  return (
                    <tr key={s}>
                      <td>{s === senaryo ? <strong>{SENARYO_ADLARI[s]}</strong> : SENARYO_ADLARI[s]}</td>
                      <td className="num"><Para deger={r.toplamGiris} /></td>
                      <td className="num"><Para deger={r.toplamCikis} /></td>
                      <td className="num"><Para deger={r.sonBakiye} isaretle /></td>
                      <td>{r.ilkEksi ? <Tarih deger={r.ilkEksi.tarih} /> : <span className="muted">Düşmüyor</span>}</td>
                      <td>{r.kaydirilanTahsilat.adet ? <>{r.kaydirilanTahsilat.adet} kalem · <Para deger={r.kaydirilanTahsilat.tutar} /></> : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Card>

          <Card title={tahmin.donemTipi === "hafta" ? "Haftalık döküm" : "Günlük döküm (hareketli günler)"} pad={false}>
            <TableWrap>
              <thead>
                <tr>
                  <th>Dönem</th>
                  <th className="num">Giriş</th>
                  <th className="num">Çıkış</th>
                  <th className="num">Net</th>
                  <th className="num">Dönem sonu bakiye</th>
                </tr>
              </thead>
              <tbody>
                {donemler.map((d) => (
                  <tr key={d.baslangic}>
                    <td>{d.baslangic === d.bitis ? <Tarih deger={d.baslangic} /> : <><Tarih deger={d.baslangic} /> – <Tarih deger={d.bitis} /></>}</td>
                    <td className="num">{d.giris ? <Para deger={d.giris} /> : <span className="muted">—</span>}</td>
                    <td className="num">{d.cikis ? <Para deger={d.cikis} /> : <span className="muted">—</span>}</td>
                    <td className="num"><Para deger={d.net} isaretle /></td>
                    <td className="num"><Para deger={d.bakiye} isaretle /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>

          <Card
            title={`Kalemler (${kalemler.length})`}
            pad={false}
            actions={
              <Select aria-label="Kaynak" value={kaynak} onChange={(e) => setKaynak(e.target.value)} style={{ width: "auto", minWidth: "12rem" }}>
                <option value="">Tüm kaynaklar</option>
                {Object.entries(KAYNAK_ADLARI).map(([deger, ad]) => <option key={deger} value={deger}>{ad}</option>)}
              </Select>
            }
          >
            <TableWrap>
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Kaynak</th>
                  <th>Açıklama</th>
                  <th>Cari</th>
                  <th className="num">Giriş</th>
                  <th className="num">Çıkış</th>
                  <th>Not</th>
                </tr>
              </thead>
              <tbody>
                {kalemler.map((k) => {
                  const t = k.tarihler[senaryo];
                  return (
                    <tr key={`${k.kaynak}-${k.kaynakId}-${k.vade}-${k.odemeSozu?.id ?? "kalan"}`}>
                      <td><Tarih deger={t.tarih} />{t.tarih !== k.vade && <small className="muted" style={{ display: "block" }}>Vade <Tarih deger={k.vade} /></small>}</td>
                      <td><Badge variant={k.yon === "giris" ? "success" : "neutral"}>{KAYNAK_ADLARI[k.kaynak] ?? k.kaynak}</Badge></td>
                      <td>{k.baglanti ? <Link href={k.baglanti}>{k.aciklama}</Link> : k.aciklama}</td>
                      <td>{k.cariUnvan ?? <span className="muted">—</span>}</td>
                      <td className="num">{k.yon === "giris" ? <Para deger={k.tutar} /> : ""}</td>
                      <td className="num">{k.yon === "cikis" ? <Para deger={k.tutar} /> : ""}</td>
                      <td>
                        {k.odemeSozu && <small style={{ display: "block" }}><Badge variant="warning">Ödeme sözü payı</Badge> Söz <Tarih deger={k.odemeSozu.tarih} /> · Fatura vadesi <Tarih deger={k.odemeSozu.faturaVadesi} /></small>}
                        {k.tahmin && <Badge variant="warning">Tahmin</Badge>}{" "}
                        {k.dovizCinsi !== "TRY" && <small className="muted"><Para deger={k.dovizTutar} dovizCinsi={k.dovizCinsi} /> </small>}
                        {t.neden && <small className="muted">{t.neden}</small>}
                      </td>
                    </tr>
                  );
                })}
                {!kalemler.length && <tr><td colSpan={7} className="muted">Bu ufukta ve senaryoda kalem yok.</td></tr>}
              </tbody>
            </TableWrap>
          </Card>

          <details className="muted">
            <summary>Hesap kapsamı ve varsayımlar</summary>
            {(tahmin.kapsamNotlari ?? []).map((not) => <p key={not}>{not}</p>)}
          </details>
          <p className="muted" style={{ margin: 0 }}>
            {tahmin.kapsamDisi.join(" ")}
            {tahmin.kur && <> Dövizli kalemler <Tarih deger={tahmin.kur.tarih} /> TCMB kuruyla çevrildi ({Object.entries(tahmin.kur.kurlar).map(([d, k]) => `${d} ${k.toLocaleString("tr-TR")}`).join(", ")}).</>}
          </p>
        </>
      ) : null}
    </div>
  );
}
