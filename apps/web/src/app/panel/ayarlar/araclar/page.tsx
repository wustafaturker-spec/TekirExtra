"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, TableWrap } from "@/components/ui";

type Arac = { id: string; plaka: string; dorsePlaka: string | null; aciklama: string | null; aktif: boolean };
type Sofor = { id: string; ad: string; soyad: string; tckn: string | null; aktif: boolean };

/**
 * Araç ve şoför kartları (EBLG-25). İrsaliyede seçilince değerler belgeye
 * kopyalanır; kart sonradan değişse de gönderilmiş e-İrsaliye olduğu gibi
 * kalır.
 */
export default function AraclarSayfasi() {
  const [araclar, setAraclar] = useState<Arac[]>([]);
  const [soforler, setSoforler] = useState<Sofor[]>([]);
  const [plaka, setPlaka] = useState("");
  const [dorsePlaka, setDorsePlaka] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [ad, setAd] = useState("");
  const [soyad, setSoyad] = useState("");
  const [tckn, setTckn] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        api<Arac[]>("/sevkiyat/araclar?tumu=1"),
        api<Sofor[]>("/sevkiyat/soforler?tumu=1"),
      ]);
      setAraclar(a);
      setSoforler(s);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kartlar yüklenemedi");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) void yukle();
  }, [yukle]);

  async function calistir(is: () => Promise<void>, basariMesaji: string, hataMesaji: string) {
    setHata("");
    setBasari("");
    try {
      await is();
      setBasari(basariMesaji);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : hataMesaji);
    }
  }

  const aracEkle = () =>
    calistir(
      async () => {
        await api("/sevkiyat/araclar", {
          method: "POST",
          body: JSON.stringify({
            plaka: plaka.trim().toUpperCase(),
            dorsePlaka: dorsePlaka.trim().toUpperCase() || null,
            aciklama: aciklama.trim() || null,
          }),
        });
        setPlaka("");
        setDorsePlaka("");
        setAciklama("");
      },
      "Araç eklendi.",
      "Araç eklenemedi",
    );

  const soforEkle = () =>
    calistir(
      async () => {
        await api("/sevkiyat/soforler", {
          method: "POST",
          body: JSON.stringify({ ad: ad.trim(), soyad: soyad.trim(), tckn: tckn.trim() || null }),
        });
        setAd("");
        setSoyad("");
        setTckn("");
      },
      "Şoför eklendi.",
      "Şoför eklenemedi",
    );

  return (
    <div>
      <PageHeader
        title="Araçlar ve Şoförler"
        subtitle="e-İrsaliye taşıyan bilgisi için kayıtlı kartlar. İrsaliyede seçildiklerinde plaka ve şoför bilgisi belgeye kopyalanır; kart sonradan değişse ya da silinse gönderilmiş belge etkilenmez."
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <Card style={{ marginBottom: "1.5rem" }}>
        <div className="card__title">Yeni Araç</div>
        <div className="row">
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Plaka *">
              <Input value={plaka} onChange={(e) => setPlaka(e.target.value.toUpperCase())} placeholder="34 ABC 123" />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Dorse Plakası">
              <Input value={dorsePlaka} onChange={(e) => setDorsePlaka(e.target.value.toUpperCase())} />
            </Field>
          </div>
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label="Açıklama">
              <Input value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Kamyon" />
            </Field>
          </div>
          <div style={{ alignSelf: "flex-end" }}>
            <Button variant="primary" disabled={plaka.trim().length < 2} onClick={() => void aracEkle()}>
              Ekle
            </Button>
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: "1.5rem" }} pad={false} title="Araçlar">
        <TableWrap>
          <thead>
            <tr>
              <th>Plaka</th>
              <th>Dorse</th>
              <th>Açıklama</th>
              <th>Durum</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {araclar.map((a) => (
              <tr key={a.id}>
                <td><strong>{a.plaka}</strong></td>
                <td>{a.dorsePlaka ?? "—"}</td>
                <td>{a.aciklama ?? "—"}</td>
                <td><Badge variant={a.aktif ? "success" : "neutral"}>{a.aktif ? "Aktif" : "Pasif"}</Badge></td>
                <td>
                  <div className="row-tight">
                    <Button size="sm" onClick={() => void calistir(async () => { await api(`/sevkiyat/araclar/${a.id}`, { method: "PATCH", body: JSON.stringify({ aktif: !a.aktif }) }); }, a.aktif ? "Araç pasife alındı." : "Araç aktifleştirildi.", "Araç güncellenemedi")}>
                      {a.aktif ? "Pasife al" : "Aktifleştir"}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => { if (window.confirm(`${a.plaka} plakalı araç silinsin mi?`)) void calistir(async () => { await api(`/sevkiyat/araclar/${a.id}`, { method: "DELETE" }); }, "Araç silindi.", "Araç silinemedi"); }}>
                      Sil
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!araclar.length && <tr><td colSpan={5}><span className="muted">Kayıtlı araç yok.</span></td></tr>}
          </tbody>
        </TableWrap>
      </Card>

      <Card style={{ marginBottom: "1.5rem" }}>
        <div className="card__title">Yeni Şoför</div>
        <div className="row">
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Ad *"><Input value={ad} onChange={(e) => setAd(e.target.value)} /></Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Soyad *"><Input value={soyad} onChange={(e) => setSoyad(e.target.value)} /></Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="TCKN">
              <Input value={tckn} onChange={(e) => setTckn(e.target.value)} maxLength={11} />
              <small className="muted">Zorunlu değil; kişisel veridir.</small>
            </Field>
          </div>
          <div style={{ alignSelf: "flex-end" }}>
            <Button variant="primary" disabled={ad.trim().length < 2 || soyad.trim().length < 2} onClick={() => void soforEkle()}>
              Ekle
            </Button>
          </div>
        </div>
      </Card>

      <Card pad={false} title="Şoförler">
        <TableWrap>
          <thead>
            <tr>
              <th>Ad Soyad</th>
              <th>TCKN</th>
              <th>Durum</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {soforler.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.ad} {s.soyad}</strong></td>
                <td>{s.tckn ?? "—"}</td>
                <td><Badge variant={s.aktif ? "success" : "neutral"}>{s.aktif ? "Aktif" : "Pasif"}</Badge></td>
                <td>
                  <div className="row-tight">
                    <Button size="sm" onClick={() => void calistir(async () => { await api(`/sevkiyat/soforler/${s.id}`, { method: "PATCH", body: JSON.stringify({ aktif: !s.aktif }) }); }, s.aktif ? "Şoför pasife alındı." : "Şoför aktifleştirildi.", "Şoför güncellenemedi")}>
                      {s.aktif ? "Pasife al" : "Aktifleştir"}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => { if (window.confirm(`${s.ad} ${s.soyad} silinsin mi?`)) void calistir(async () => { await api(`/sevkiyat/soforler/${s.id}`, { method: "DELETE" }); }, "Şoför silindi.", "Şoför silinemedi"); }}>
                      Sil
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!soforler.length && <tr><td colSpan={4}><span className="muted">Kayıtlı şoför yok.</span></td></tr>}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
