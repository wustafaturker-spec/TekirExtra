"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  Stat,
  StatGrid,
  TableWrap,
} from "@/components/ui";

/* ─── Tipler ─────────────────────────────────────────────────────────────── */

interface GelenOzet {
  id: string;
  belgeNo: string;
  gonderenVkn: string;
  gonderenUnvan: string;
  tarih: string;
  profilId: string | null;
  durum: "beklemede" | "islendi" | "reddedildi";
  yanit: "kabul" | "ret" | null;
  faturaId: string | null;
  satirSayisi: number;
  genelToplam: string | null;
  dovizCinsi: string;
  okunabilir: boolean;
}

interface OnerilenStok {
  id: string;
  kod: string;
  ad: string;
  anaBirim: string;
  kdvOrani: string;
}

interface GelenSatir {
  siraNo: number;
  ad: string;
  saticiUrunKodu: string | null;
  aliciUrunKodu: string | null;
  ureticiUrunKodu: string | null;
  barkod: string | null;
  miktar: string;
  birim: string;
  birimFiyat: string;
  iskontoOrani: string;
  iskontoTutari: string;
  kdvOrani: string;
  kdvTutari: string;
  matrah: string;
  onerilenStokId: string | null;
  onerilenStok: OnerilenStok | null;
  eslesmeKaynagi:
    | "alici_urun_kodu"
    | "barkod"
    | "tedarikci_urun_kodu"
    | "uretici_urun_kodu"
    | "ad"
    | null;
}

interface GelenDetay {
  id: string;
  uuid: string;
  belgeNo: string;
  gonderenVkn: string;
  gonderenUnvan: string;
  tarih: string;
  profilId: string | null;
  durum: "beklemede" | "islendi" | "reddedildi";
  yanit: "kabul" | "ret" | null;
  yanitGerekce: string | null;
  faturaId: string | null;
  yanitGerekiyor: boolean;
  cari: { id: string; kod: string; unvan: string; karaListe: boolean } | null;
  dovizCinsi: string;
  belgeToplamlari: {
    satirToplami: string;
    iskontoToplami: string;
    matrah: string;
    kdv: string;
    genelToplam: string;
  };
  satirlar: GelenSatir[];
}

interface StokSecenek {
  id: string;
  kod: string;
  ad: string;
  anaBirim: string;
}

/* ─── Yardımcılar ────────────────────────────────────────────────────────── */

const para = (deger: string | number, dovizCinsi = "TRY"): string =>
  `${Number(deger).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${dovizCinsi === "TRY" ? "₺" : dovizCinsi}`;

const adet = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

const ESLESME_ETIKETI: Record<string, string> = {
  alici_urun_kodu: "ürün kodumuz",
  barkod: "barkod",
  tedarikci_urun_kodu: "tedarikçi kodu",
  uretici_urun_kodu: "üretici kodu",
  ad: "ad",
};

function durumRozet(durum: string) {
  if (durum === "islendi") return <Badge variant="success">FATURAYA İŞLENDİ</Badge>;
  if (durum === "reddedildi") return <Badge variant="danger">REDDEDİLDİ</Badge>;
  return <Badge variant="warning">ONAY BEKLİYOR</Badge>;
}

function profilRozet(profilId: string | null) {
  if (profilId === "TICARIFATURA") return <Badge variant="info">TİCARİ</Badge>;
  if (profilId === "TEMELFATURA") return <Badge variant="neutral">TEMEL</Badge>;
  return <Badge variant="neutral">{profilId ?? "—"}</Badge>;
}

/* ─── Sayfa ──────────────────────────────────────────────────────────────── */

export default function GelenKutusuSayfasi() {
  const [liste, setListe] = useState<GelenOzet[]>([]);
  const [suzgec, setSuzgec] = useState<"beklemede" | "islendi" | "reddedildi" | "hepsi">(
    "beklemede",
  );
  const [detay, setDetay] = useState<GelenDetay | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islemde, setIslemde] = useState<string | null>(null);

  /** siraNo → seçili stok kartı; tümü dolmadan "Faturaya İşle" açılmaz (S-01). */
  const [eslesme, setEslesme] = useState<Record<number, StokSecenek | null>>({});

  // Stok seçici
  const [seciciSira, setSeciciSira] = useState<number | null>(null);
  const [seciciArama, setSeciciArama] = useState("");
  const [seciciSonuc, setSeciciSonuc] = useState<StokSecenek[]>([]);

  // Yeni kart formu
  const [yeniKartSira, setYeniKartSira] = useState<number | null>(null);
  const [yeniKod, setYeniKod] = useState("");
  const [yeniAd, setYeniAd] = useState("");
  const [yeniBirim, setYeniBirim] = useState("adet");
  const [yeniKdv, setYeniKdv] = useState("20");

  // Ret gerekçesi
  const [retAcik, setRetAcik] = useState(false);
  const [retGerekce, setRetGerekce] = useState("");

  const listeYukle = useCallback(async () => {
    try {
      const yol = suzgec === "hepsi" ? "/ebelge/gelen" : `/ebelge/gelen?durum=${suzgec}`;
      setListe(await api<GelenOzet[]>(yol));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Gelen kutusu yüklenemedi");
    }
  }, [suzgec]);

  useEffect(() => {
    if (!tokenAl()) return;
    void listeYukle();
  }, [listeYukle]);

  const detayAc = useCallback(async (id: string) => {
    setHata("");
    setBasari("");
    setRetAcik(false);
    setRetGerekce("");
    setSeciciSira(null);
    setYeniKartSira(null);
    try {
      const d = await api<GelenDetay>(`/ebelge/gelen/${id}`);
      setDetay(d);
      // Otomatik eşleşenler baştan seçili gelir; kullanıcı değiştirebilir.
      const baslangic: Record<number, StokSecenek | null> = {};
      for (const s of d.satirlar) {
        baslangic[s.siraNo] = s.onerilenStok
          ? {
              id: s.onerilenStok.id,
              kod: s.onerilenStok.kod,
              ad: s.onerilenStok.ad,
              anaBirim: s.onerilenStok.anaBirim,
            }
          : null;
      }
      setEslesme(baslangic);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belge detayı alınamadı");
    }
  }, []);

  // Stok seçici araması (açıkken ve arama değiştikçe)
  useEffect(() => {
    if (seciciSira === null) return;
    let iptal = false;
    const zamanlayici = setTimeout(() => {
      void api<{ kayitlar: StokSecenek[] }>(
        `/stok?adet=25${seciciArama.trim() ? `&arama=${encodeURIComponent(seciciArama.trim())}` : ""}`,
      )
        .then((v) => {
          if (!iptal) setSeciciSonuc(v.kayitlar);
        })
        .catch(() => {
          if (!iptal) setSeciciSonuc([]);
        });
    }, 250);
    return () => {
      iptal = true;
      clearTimeout(zamanlayici);
    };
  }, [seciciSira, seciciArama]);

  const eksikSatirlar = useMemo(
    () => (detay ? detay.satirlar.filter((s) => !eslesme[s.siraNo]) : []),
    [detay, eslesme],
  );

  /* ─── Eylemler ─────────────────────────────────────────────────────────── */

  async function entegratordenCek() {
    setHata("");
    setBasari("");
    setIslemde("cek");
    try {
      const s = await api<{ toplamCekilen: number; yeniBelgeSayisi: number }>(
        "/ebelge/gelenleri-cek",
        { method: "POST" },
      );
      setBasari(
        `${s.toplamCekilen} belge sorgulandı; ${s.yeniBelgeSayisi} yeni belge gelen kutusuna eklendi.`,
      );
      await listeYukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belgeler çekilemedi");
    } finally {
      setIslemde(null);
    }
  }

  function seciciAc(sira: number, satir: GelenSatir) {
    setSeciciSira(sira);
    // Aramayı belgedeki adla başlatmak eşleştirmeyi hızlandırır.
    setSeciciArama(satir.ad);
    setSeciciSonuc([]);
    setYeniKartSira(null);
  }

  function yeniKartAc(satir: GelenSatir) {
    setYeniKartSira(satir.siraNo);
    setSeciciSira(null);
    setYeniKod(satir.barkod ?? satir.saticiUrunKodu ?? "");
    setYeniAd(satir.ad);
    setYeniBirim(satir.birim);
    setYeniKdv(satir.kdvOrani);
  }

  async function yeniKartKaydet(satir: GelenSatir) {
    setHata("");
    setIslemde("yeni-kart");
    try {
      const kart = await api<{ id: string; kod: string; ad: string; anaBirim: string }>(
        "/stok",
        {
          method: "POST",
          body: JSON.stringify({
            kod: yeniKod.trim(),
            ad: yeniAd.trim(),
            anaBirim: yeniBirim.trim() || "adet",
            kdvOrani: Number(yeniKdv || "20").toFixed(2),
            alisFiyati: Number(satir.birimFiyat).toFixed(4),
            barkod: satir.barkod ?? null,
          }),
        },
      );

      // Bir dahaki gelen faturada otomatik eşleşsin diye tedarikçi ürün kodunu
      // karta bağla (STK-18). Cari henüz açılmamışsa atlanır.
      if (detay?.cari && satir.saticiUrunKodu) {
        await api(`/stok/${kart.id}/tedarikciler`, {
          method: "POST",
          body: JSON.stringify({
            cariId: detay.cari.id,
            tedarikciUrunKodu: satir.saticiUrunKodu,
            alisFiyati: Number(satir.birimFiyat).toFixed(4),
          }),
        }).catch(() => undefined);
      }

      setEslesme((e) => ({
        ...e,
        [satir.siraNo]: {
          id: kart.id,
          kod: kart.kod,
          ad: kart.ad,
          anaBirim: kart.anaBirim,
        },
      }));
      setYeniKartSira(null);
      setBasari(`'${kart.ad}' stok kartı açıldı ve ${satir.siraNo}. satıra bağlandı.`);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Stok kartı açılamadı");
    } finally {
      setIslemde(null);
    }
  }

  async function faturayaIsle() {
    if (!detay) return;
    setHata("");
    setBasari("");
    setIslemde("onayla");
    try {
      const s = await api<{ faturaId: string; toplamFarki: string | null }>(
        `/ebelge/gelen/${detay.id}/onayla`,
        {
          method: "POST",
          body: JSON.stringify({
            satirEslesmeleri: detay.satirlar.map((sa) => ({
              siraNo: sa.siraNo,
              stokId: eslesme[sa.siraNo]?.id,
            })),
          }),
        },
      );
      setBasari(
        `Taslak alış faturası oluşturuldu.${
          s.toplamFarki
            ? ` ⚠️ Hesaplanan toplam belge toplamından ${s.toplamFarki} ₺ farklı — faturayı kesinleştirmeden önce kontrol edin.`
            : ""
        }`,
      );
      await detayAc(detay.id);
      await listeYukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belge faturaya işlenemedi");
    } finally {
      setIslemde(null);
    }
  }

  async function yanitGonder(yanit: "kabul" | "ret") {
    if (!detay) return;
    setHata("");
    setBasari("");
    setIslemde(`yanit-${yanit}`);
    try {
      await api(`/ebelge/gelen/${detay.id}/yanit`, {
        method: "POST",
        body: JSON.stringify({
          yanit,
          gerekce: yanit === "ret" ? retGerekce.trim() : null,
        }),
      });
      setBasari(
        yanit === "kabul"
          ? "Kabul yanıtı entegratöre gönderildi."
          : "Ret yanıtı entegratöre gönderildi; belge reddedildi olarak işaretlendi.",
      );
      setRetAcik(false);
      setRetGerekce("");
      await detayAc(detay.id);
      await listeYukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Yanıt gönderilemedi");
    } finally {
      setIslemde(null);
    }
  }

  /* ─── Görünüm: liste ───────────────────────────────────────────────────── */

  if (!detay) {
    return (
      <div>
        <PageHeader
          title="Gelen e-Belgeler"
          subtitle="Entegratörden gelen e-Faturalar burada onay bekler; faturaya yalnızca siz onayladığınızda dönüşür."
          actions={
            <>
              <ButtonLabel as="a" href="/panel/fatura">
                ← Faturalar
              </ButtonLabel>
              <Button
                variant="primary"
                onClick={() => void entegratordenCek()}
                disabled={islemde !== null}
              >
                {islemde === "cek" ? "Çekiliyor..." : "⬇️ Entegratörden Çek"}
              </Button>
            </>
          }
        />

        <Alert tone="error">{hata}</Alert>
        <Alert tone="success">{basari}</Alert>

        <div style={{ marginBottom: "1rem" }}>
          <Segmented
            value={suzgec}
            onChange={setSuzgec}
            items={[
              { deger: "beklemede", baslik: "Onay Bekleyen" },
              { deger: "islendi", baslik: "İşlenmiş" },
              { deger: "reddedildi", baslik: "Reddedilen" },
              { deger: "hepsi", baslik: "Tümü" },
            ]}
          />
        </div>

        <Card pad={false}>
          <TableWrap>
            <thead>
              <tr>
                <th>Belge No</th>
                <th>Gönderen</th>
                <th>Tarih</th>
                <th>Profil</th>
                <th className="num">Kalem</th>
                <th className="num">Tutar</th>
                <th>Durum</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {liste.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">
                    Bu görünümde belge yok. Entegratörden çekmeyi deneyin.
                  </td>
                </tr>
              ) : (
                liste.map((g) => (
                  <tr key={g.id}>
                    <td className="mono">{g.belgeNo}</td>
                    <td>
                      <div>{g.gonderenUnvan}</div>
                      <div className="muted mono" style={{ fontSize: "0.8rem" }}>
                        {g.gonderenVkn}
                      </div>
                    </td>
                    <td>{g.tarih}</td>
                    <td>{profilRozet(g.profilId)}</td>
                    <td className="num">{g.satirSayisi}</td>
                    <td className="num">
                      {g.genelToplam ? para(g.genelToplam, g.dovizCinsi) : "—"}
                    </td>
                    <td>
                      <div className="row-tight">
                        {durumRozet(g.durum)}
                        {g.yanit && (
                          <Badge variant={g.yanit === "kabul" ? "success" : "danger"}>
                            {g.yanit === "kabul" ? "KABUL" : "RET"}
                          </Badge>
                        )}
                        {!g.okunabilir && <Badge variant="danger">XML OKUNAMADI</Badge>}
                      </div>
                    </td>
                    <td className="num">
                      <Button size="sm" onClick={() => void detayAc(g.id)}>
                        İncele
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
        </Card>
      </div>
    );
  }

  /* ─── Görünüm: onay & eşleştirme ───────────────────────────────────────── */

  const islenebilir = detay.durum === "beklemede";

  return (
    <div>
      <PageHeader
        title={`Gelen e-Fatura ${detay.belgeNo}`}
        subtitle={`${detay.gonderenUnvan} · VKN ${detay.gonderenVkn} · ${detay.tarih}`}
        actions={
          <>
            <Button
              onClick={() => {
                setDetay(null);
                setHata("");
                setBasari("");
              }}
            >
              ← Gelen Kutusu
            </Button>
            {detay.faturaId && (
              <ButtonLabel as="a" href="/panel/fatura">
                Taslak Faturaya Git
              </ButtonLabel>
            )}
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <div className="row-tight" style={{ marginBottom: "1rem" }}>
        {durumRozet(detay.durum)}
        {profilRozet(detay.profilId)}
        {detay.yanit && (
          <Badge variant={detay.yanit === "kabul" ? "success" : "danger"}>
            YANIT: {detay.yanit === "kabul" ? "KABUL" : "RET"}
          </Badge>
        )}
      </div>

      <StatGrid>
        <Stat label="Matrah" value={para(detay.belgeToplamlari.matrah, detay.dovizCinsi)} />
        <Stat label="KDV" value={para(detay.belgeToplamlari.kdv, detay.dovizCinsi)} />
        <Stat
          label="İskonto"
          value={para(detay.belgeToplamlari.iskontoToplami, detay.dovizCinsi)}
        />
        <Stat
          label="Genel Toplam"
          value={para(detay.belgeToplamlari.genelToplam, detay.dovizCinsi)}
          tone="accent"
        />
      </StatGrid>

      <Card style={{ marginTop: "1.25rem" }}>
        <div className="card__title">Cari Hesap</div>
        {detay.cari ? (
          <p style={{ margin: 0 }}>
            <code className="mono">{detay.cari.kod}</code> — {detay.cari.unvan}
            {detay.cari.karaListe && (
              <>
                {" "}
                <Badge variant="danger">KARA LİSTE</Badge>
              </>
            )}
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Bu VKN ile kayıtlı cari yok. Faturaya işlerken{" "}
            <strong>{detay.gonderenUnvan}</strong> adında yeni bir tedarikçi carisi
            açılacak.
          </p>
        )}
      </Card>

      {detay.yanitGerekiyor && !detay.yanit && (
        <Card style={{ marginTop: "1.25rem" }}>
          <div className="card__title">Ticari Fatura Yanıtı (EBLG-06)</div>
          <p className="muted" style={{ fontSize: "0.875rem", marginTop: 0 }}>
            Bu bir <strong>ticari fatura</strong>; 8 gün içinde kabul veya ret yanıtı
            gönderilmelidir. Ret, belgeyi faturaya işlenemez hale getirir.
          </p>
          <div className="row-tight">
            <Button
              variant="primary"
              onClick={() => void yanitGonder("kabul")}
              disabled={islemde !== null}
            >
              {islemde === "yanit-kabul" ? "Gönderiliyor..." : "✔ Kabul Et"}
            </Button>
            <Button variant="danger" onClick={() => setRetAcik(!retAcik)} disabled={islemde !== null}>
              ✖ Reddet
            </Button>
          </div>
          {retAcik && (
            <div style={{ marginTop: "1rem" }}>
              <Field label="Ret Gerekçesi *">
                <Input
                  value={retGerekce}
                  onChange={(e) => setRetGerekce(e.target.value)}
                  placeholder="Örn. Sipariş edilmeyen ürün faturalanmış"
                />
              </Field>
              <Button
                variant="danger"
                onClick={() => void yanitGonder("ret")}
                disabled={islemde !== null || retGerekce.trim() === ""}
              >
                {islemde === "yanit-ret" ? "Gönderiliyor..." : "Ret Yanıtını Gönder"}
              </Button>
            </div>
          )}
        </Card>
      )}

      {detay.yanit === "ret" && detay.yanitGerekce && (
        <Card style={{ marginTop: "1.25rem" }}>
          <div className="card__title">Ret Gerekçesi</div>
          <p style={{ margin: 0 }}>{detay.yanitGerekce}</p>
        </Card>
      )}

      <Card style={{ marginTop: "1.25rem" }} pad={false}>
        <div style={{ padding: "1.25rem 1.25rem 0" }}>
          <div className="card__title">Satır Eşleştirme</div>
          <p className="muted" style={{ fontSize: "0.875rem" }}>
            Her belge kalemi bir stok kartına bağlanmalıdır — fatura
            kesinleştirilirken satır başına stok hareketi yazılır. Sistem barkod,
            tedarikçi ürün kodu ve ada göre otomatik eşleştirme dener; kalanları siz
            seçin ya da yeni kart açın.
          </p>
        </div>

        <TableWrap>
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th>Belge Kalemi</th>
              <th className="num">Miktar</th>
              <th className="num">Birim Fiyat</th>
              <th className="num">İsk.</th>
              <th className="num">KDV</th>
              <th className="num">Matrah</th>
              <th style={{ minWidth: 260 }}>Stok Kartı</th>
            </tr>
          </thead>
          <tbody>
            {detay.satirlar.map((s) => {
              const secili = eslesme[s.siraNo] ?? null;
              return (
                <tr key={s.siraNo}>
                  <td className="mono">{s.siraNo}</td>
                  <td>
                    <div>{s.ad}</div>
                    <div className="muted mono" style={{ fontSize: "0.78rem" }}>
                      {[
                        s.saticiUrunKodu && `satıcı: ${s.saticiUrunKodu}`,
                        s.barkod && `barkod: ${s.barkod}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="num">
                    {adet(s.miktar)} {s.birim}
                  </td>
                  <td className="num">{para(s.birimFiyat, detay.dovizCinsi)}</td>
                  <td className="num">
                    {Number(s.iskontoOrani) > 0 ? `%${s.iskontoOrani}` : "—"}
                  </td>
                  <td className="num">%{s.kdvOrani}</td>
                  <td className="num">{para(s.matrah, detay.dovizCinsi)}</td>
                  <td>
                    {secili ? (
                      <div className="row-tight" style={{ flexWrap: "wrap" }}>
                        <span>
                          <code className="mono">{secili.kod}</code> {secili.ad}
                        </span>
                        {s.eslesmeKaynagi && secili.id === s.onerilenStokId && (
                          <Badge variant="info">
                            oto: {ESLESME_ETIKETI[s.eslesmeKaynagi]}
                          </Badge>
                        )}
                        {secili.anaBirim !== s.birim && (
                          <Badge variant="warning">birim: {secili.anaBirim}</Badge>
                        )}
                        {islenebilir && (
                          <Button size="sm" onClick={() => seciciAc(s.siraNo, s)}>
                            Değiştir
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="row-tight">
                        <Badge variant="danger">EŞLEŞMEDİ</Badge>
                        {islenebilir && (
                          <>
                            <Button size="sm" onClick={() => seciciAc(s.siraNo, s)}>
                              Seç
                            </Button>
                            <Button size="sm" onClick={() => yeniKartAc(s)}>
                              ➕ Yeni Kart
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    {seciciSira === s.siraNo && (
                      <div
                        style={{
                          marginTop: "0.75rem",
                          padding: "0.75rem",
                          border: "1px dashed var(--border-strong)",
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        <SearchInput
                          value={seciciArama}
                          onChange={(e) => setSeciciArama(e.target.value)}
                          placeholder="Ad, kod veya barkod ile ara..."
                          autoFocus
                        />
                        <div style={{ maxHeight: 200, overflowY: "auto", marginTop: "0.5rem" }}>
                          {seciciSonuc.length === 0 ? (
                            <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                              Sonuç yok.
                            </p>
                          ) : (
                            seciciSonuc.map((k) => (
                              <button
                                key={k.id}
                                type="button"
                                className="btn btn--ghost btn--block btn--sm"
                                style={{ justifyContent: "flex-start", marginBottom: "0.25rem" }}
                                onClick={() => {
                                  setEslesme((e) => ({ ...e, [s.siraNo]: k }));
                                  setSeciciSira(null);
                                }}
                              >
                                <code className="mono">{k.kod}</code>&nbsp;{k.ad}
                              </button>
                            ))
                          )}
                        </div>
                        <Button size="sm" onClick={() => setSeciciSira(null)}>
                          Kapat
                        </Button>
                      </div>
                    )}

                    {yeniKartSira === s.siraNo && (
                      <div
                        style={{
                          marginTop: "0.75rem",
                          padding: "0.75rem",
                          border: "1px dashed var(--border-strong)",
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        <div className="row">
                          <div style={{ flex: 1, minWidth: 130 }}>
                            <Field label="Kod *">
                              <Input value={yeniKod} onChange={(e) => setYeniKod(e.target.value)} />
                            </Field>
                          </div>
                          <div style={{ flex: 2, minWidth: 180 }}>
                            <Field label="Ad *">
                              <Input value={yeniAd} onChange={(e) => setYeniAd(e.target.value)} />
                            </Field>
                          </div>
                          <div style={{ flex: 1, minWidth: 110 }}>
                            <Field label="Ana Birim">
                              <Input
                                value={yeniBirim}
                                onChange={(e) => setYeniBirim(e.target.value)}
                              />
                            </Field>
                          </div>
                          <div style={{ flex: 1, minWidth: 100 }}>
                            <Field label="KDV %">
                              <Select value={yeniKdv} onChange={(e) => setYeniKdv(e.target.value)}>
                                <option value="0">0</option>
                                <option value="1">1</option>
                                <option value="10">10</option>
                                <option value="20">20</option>
                              </Select>
                            </Field>
                          </div>
                        </div>
                        <p className="muted" style={{ fontSize: "0.8rem" }}>
                          Alış fiyatı belgeden ({para(s.birimFiyat, detay.dovizCinsi)}) alınır
                          {detay.cari && s.saticiUrunKodu
                            ? "; tedarikçi ürün kodu karta bağlanır ki bir dahaki fatura otomatik eşleşsin."
                            : "."}
                        </p>
                        <div className="row-tight">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => void yeniKartKaydet(s)}
                            disabled={
                              islemde !== null || yeniKod.trim() === "" || yeniAd.trim().length < 2
                            }
                          >
                            {islemde === "yeni-kart" ? "Açılıyor..." : "Kartı Aç ve Bağla"}
                          </Button>
                          <Button size="sm" onClick={() => setYeniKartSira(null)}>
                            Vazgeç
                          </Button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>

        <div className="between" style={{ padding: "1rem 1.25rem" }}>
          <span className="muted" style={{ fontSize: "0.9rem" }}>
            {detay.durum === "islendi"
              ? "Bu belge taslak alış faturasına işlendi."
              : detay.durum === "reddedildi"
                ? "Reddedilen belge faturaya işlenemez."
                : eksikSatirlar.length === 0
                  ? `${detay.satirlar.length} satırın tamamı eşleşti.`
                  : `${eksikSatirlar.length} satır hâlâ eşleşmedi.`}
          </span>
          <Button
            variant="primary"
            onClick={() => void faturayaIsle()}
            disabled={!islenebilir || eksikSatirlar.length > 0 || islemde !== null}
          >
            {islemde === "onayla" ? "İşleniyor..." : "Faturaya İşle"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
