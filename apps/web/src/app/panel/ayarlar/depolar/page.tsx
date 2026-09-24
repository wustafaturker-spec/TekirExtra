"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import type { DepoOzet } from "@/lib/depolar";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  TableWrap,
} from "@/components/ui";

/** Depo yönetimi (STK-07). Kiracıda her zaman bir varsayılan depo bulunur. */
export default function DepolarSayfasi() {
  const [depolar, setDepolar] = useState<DepoOzet[]>([]);
  const [kod, setKod] = useState("");
  const [ad, setAd] = useState("");
  const [adres, setAdres] = useState("");
  const [il, setIl] = useState("");
  const [ilce, setIlce] = useState("");
  const [postaKodu, setPostaKodu] = useState("");
  const [sorumlu, setSorumlu] = useState("");
  /** EBLG-87: mevcut deponun adresini düzenleme; null = düzenlenmiyor. */
  const [adresDuzenleme, setAdresDuzenleme] = useState<{ id: string; adres: string; il: string; ilce: string; postaKodu: string } | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    try {
      setDepolar(await api<DepoOzet[]>("/depo"));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Depolar yüklenemedi");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) void yukle();
  }, [yukle]);

  async function ekle() {
    setHata("");
    setBasari("");
    try {
      await api("/depo", {
        method: "POST",
        body: JSON.stringify({
          kod: kod.trim().toUpperCase(),
          ad: ad.trim(),
          adres: adres.trim() || null,
          il: il.trim() || null,
          ilce: ilce.trim() || null,
          postaKodu: postaKodu.trim() || null,
          sorumlu: sorumlu.trim() || null,
        }),
      });
      setBasari(`'${ad.trim()}' deposu eklendi.`);
      setKod("");
      setAd("");
      setAdres("");
      setIl("");
      setIlce("");
      setPostaKodu("");
      setSorumlu("");
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Depo eklenemedi");
    }
  }

  async function adresKaydet() {
    if (!adresDuzenleme) return;
    setHata("");
    setBasari("");
    try {
      const { id, ...alanlar } = adresDuzenleme;
      await api(`/depo/${id}`, {
        method: "PATCH",
        body: JSON.stringify(Object.fromEntries(Object.entries(alanlar).map(([k, v]) => [k, v.trim() || null]))),
      });
      setBasari("Depo adresi güncellendi.");
      setAdresDuzenleme(null);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Depo adresi kaydedilemedi");
    }
  }

  async function varsayilanYap(d: DepoOzet) {
    setHata("");
    setBasari("");
    try {
      await api(`/depo/${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({ varsayilan: true }),
      });
      setBasari(`Varsayılan depo '${d.ad}' olarak ayarlandı.`);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Varsayılan depo değiştirilemedi");
    }
  }

  async function aktiflikDegistir(d: DepoOzet) {
    setHata("");
    setBasari("");
    try {
      await api(`/depo/${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({ aktif: !d.aktif }),
      });
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Depo durumu değiştirilemedi");
    }
  }

  async function sil(d: DepoOzet) {
    if (!window.confirm(`'${d.ad}' deposu silinsin mi?`)) return;
    setHata("");
    setBasari("");
    try {
      await api(`/depo/${d.id}`, { method: "DELETE" });
      setBasari(`'${d.ad}' deposu silindi.`);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Depo silinemedi");
    }
  }

  const kodGecerli = kod.trim().length > 0;
  const adGecerli = ad.trim().length >= 2;

  return (
    <div>
      <PageHeader
        title="Depolar"
        subtitle="Stok miktarları depo bazında izlenir (STK-07). Firmada tek depo varsa fatura, sayım ve stok hareketi ekranlarında depo seçimi görünmez; işlemler doğrudan varsayılan depoya yazılır."
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <Card style={{ marginBottom: "1.5rem" }}>
        <div className="card__title">Yeni Depo</div>
        <div className="row">
          <div style={{ flex: 1, minWidth: 140 }}>
            <Field label="Kod *">
              <Input
                value={kod}
                onChange={(e) => setKod(e.target.value.toUpperCase())}
                placeholder="SUBE1"
              />
            </Field>
          </div>
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label="Ad *">
              <Input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Şube Deposu" />
            </Field>
          </div>
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label="Adres">
              <Input value={adres} onChange={(e) => setAdres(e.target.value)} />
            </Field>
          </div>
          {/* EBLG-87: gümrükten depoya sevk irsaliyesinde boşaltma adresi olur. */}
          <div style={{ flex: 1, minWidth: 120 }}>
            <Field label="İl"><Input value={il} onChange={(e) => setIl(e.target.value)} /></Field>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <Field label="İlçe"><Input value={ilce} onChange={(e) => setIlce(e.target.value)} /></Field>
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <Field label="Posta Kodu"><Input value={postaKodu} onChange={(e) => setPostaKodu(e.target.value)} maxLength={10} /></Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Sorumlu">
              <Input value={sorumlu} onChange={(e) => setSorumlu(e.target.value)} />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button variant="primary" onClick={ekle} disabled={!kodGecerli || !adGecerli}>
              ➕ Ekle
            </Button>
          </div>
        </div>
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Kod</th>
              <th>Ad</th>
              <th>Adres</th>
              <th>Sorumlu</th>
              <th className="num">Hareket</th>
              <th>Durum</th>
              <th style={{ width: 260 }}>İşlemler</th>
            </tr>
          </thead>
          <tbody>
            {depolar.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  Depo bulunamadı.
                </td>
              </tr>
            ) : (
              depolar.map((d) => (
                <tr key={d.id}>
                  <td className="mono" style={{ fontWeight: 700 }}>
                    {d.kod}
                  </td>
                  <td>
                    {d.ad}{" "}
                    {d.varsayilan && <Badge variant="accent">Varsayılan</Badge>}
                  </td>
                  <td className="muted">
                    {adresDuzenleme?.id === d.id ? (
                      <div className="stack" style={{ gap: "0.3rem" }}>
                        <Input aria-label="Adres" value={adresDuzenleme.adres} onChange={(e) => setAdresDuzenleme({ ...adresDuzenleme, adres: e.target.value })} />
                        <div className="row-tight">
                          <Input aria-label="İl" placeholder="İl" value={adresDuzenleme.il} onChange={(e) => setAdresDuzenleme({ ...adresDuzenleme, il: e.target.value })} />
                          <Input aria-label="İlçe" placeholder="İlçe" value={adresDuzenleme.ilce} onChange={(e) => setAdresDuzenleme({ ...adresDuzenleme, ilce: e.target.value })} />
                          <Input aria-label="Posta kodu" placeholder="Posta kodu" maxLength={10} value={adresDuzenleme.postaKodu} onChange={(e) => setAdresDuzenleme({ ...adresDuzenleme, postaKodu: e.target.value })} />
                        </div>
                        <div className="row-tight">
                          <Button size="sm" variant="primary" onClick={() => void adresKaydet()}>Kaydet</Button>
                          <Button size="sm" onClick={() => setAdresDuzenleme(null)}>Vazgeç</Button>
                        </div>
                      </div>
                    ) : (
                      [d.adres, d.ilce, d.il, d.postaKodu].filter(Boolean).join(", ") || "—"
                    )}
                  </td>
                  <td className="muted">{d.sorumlu ?? "—"}</td>
                  <td className="num">{d.hareketSayisi}</td>
                  <td>
                    <Badge variant={d.aktif ? "success" : "neutral"}>
                      {d.aktif ? "Aktif" : "Pasif"}
                    </Badge>
                  </td>
                  <td>
                    <div className="row-tight">
                      <Button size="sm" onClick={() => setAdresDuzenleme({ id: d.id, adres: d.adres ?? "", il: d.il ?? "", ilce: d.ilce ?? "", postaKodu: d.postaKodu ?? "" })}>
                        Adres
                      </Button>
                      {!d.varsayilan && (
                        <Button size="sm" onClick={() => void varsayilanYap(d)}>
                          Varsayılan yap
                        </Button>
                      )}
                      {!d.varsayilan && (
                        <Button size="sm" onClick={() => void aktiflikDegistir(d)}>
                          {d.aktif ? "Pasife al" : "Aktifleştir"}
                        </Button>
                      )}
                      {d.silinebilir && (
                        <Button size="sm" variant="danger" onClick={() => void sil(d)}>
                          Sil
                        </Button>
                      )}
                    </div>
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
