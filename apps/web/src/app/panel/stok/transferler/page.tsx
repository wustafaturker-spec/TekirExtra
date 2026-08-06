"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { useDepolar } from "@/lib/depolar";
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
  Select,
  TableWrap,
} from "@/components/ui";

interface DepoBilgi {
  id: string;
  kod: string;
  ad: string;
}

interface DepoBakiye {
  stokId: string;
  kod: string;
  ad: string;
  tip: string;
  anaBirim: string;
  mevcutMiktar: string;
  rezerveMiktar: string;
}

interface TransferOzet {
  id: string;
  no: string;
  tarih: string;
  durum: string;
  aciklama: string | null;
  onayZamani: string | null;
  kaynakDepo: DepoBilgi;
  hedefDepo: DepoBilgi;
  _count: { kalemler: number };
}

interface TransferKalem {
  id: string;
  stokId: string;
  miktar: string;
  girilenBirim: string;
  girilenMiktar: string;
  stok: { id: string; kod: string; ad: string; anaBirim: string };
}

interface TransferDetay extends Omit<TransferOzet, "_count"> {
  kalemler: TransferKalem[];
}

const adet = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

const bugun = () => new Date().toISOString().slice(0, 10);

/** Depolar arası transfer fişleri (STK-07). */
export default function TransferlerSayfasi() {
  const { depolar, cokluDepo } = useDepolar();
  const [transferler, setTransferler] = useState<TransferOzet[]>([]);
  const [detay, setDetay] = useState<TransferDetay | null>(null);
  const [formAcik, setFormAcik] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  // Form
  const [tarih, setTarih] = useState(bugun());
  const [kaynakDepoId, setKaynakDepoId] = useState("");
  const [hedefDepoId, setHedefDepoId] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [arama, setArama] = useState("");
  const [kaynakStoklar, setKaynakStoklar] = useState<DepoBakiye[]>([]);
  /** stokId → gönderilecek miktar (ana birim); boş bırakılanlar fişe girmez. */
  const [miktarlar, setMiktarlar] = useState<Record<string, string>>({});

  const yukle = useCallback(async () => {
    try {
      setTransferler(await api<TransferOzet[]>("/depo/transferler"));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Transferler yüklenemedi");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) void yukle();
  }, [yukle]);

  // Kaynak depo değişince o deponun stoğu yüklenir
  useEffect(() => {
    if (!kaynakDepoId) {
      setKaynakStoklar([]);
      return;
    }
    void api<DepoBakiye[]>(`/depo/${kaynakDepoId}/bakiyeler`)
      .then((b) => setKaynakStoklar(b.filter((s) => s.tip !== "hizmet")))
      .catch(() => setKaynakStoklar([]));
    setMiktarlar({});
  }, [kaynakDepoId]);

  const suzulmus = useMemo(() => {
    const a = arama.trim().toLocaleLowerCase("tr");
    if (!a) return kaynakStoklar;
    return kaynakStoklar.filter(
      (s) =>
        s.ad.toLocaleLowerCase("tr").includes(a) ||
        s.kod.toLocaleLowerCase("tr").includes(a),
    );
  }, [kaynakStoklar, arama]);

  const girilenler = useMemo(
    () => Object.entries(miktarlar).filter(([, d]) => d.trim() !== "" && Number(d) > 0),
    [miktarlar],
  );

  async function kaydet() {
    setHata("");
    setBasari("");
    try {
      const kalemler = girilenler.map(([stokId, deger]) => {
        const kart = kaynakStoklar.find((s) => s.stokId === stokId);
        return {
          stokId,
          girilenBirim: kart?.anaBirim ?? "adet",
          girilenMiktar: Number(deger).toFixed(3),
        };
      });
      await api("/depo/transferler", {
        method: "POST",
        body: JSON.stringify({
          tarih,
          kaynakDepoId,
          hedefDepoId,
          aciklama: aciklama.trim() === "" ? null : aciklama.trim(),
          kalemler,
        }),
      });
      setBasari(`${kalemler.length} kalemli transfer fişi taslak olarak kaydedildi.`);
      setFormAcik(false);
      setMiktarlar({});
      setAciklama("");
      setArama("");
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Transfer kaydedilemedi");
    }
  }

  async function detayAc(id: string) {
    setHata("");
    try {
      setDetay(await api<TransferDetay>(`/depo/transferler/${id}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Transfer detayı alınamadı");
    }
  }

  async function onayla(id: string) {
    setHata("");
    setBasari("");
    try {
      const sonuc = await api<{ uyarilar: string[] }>(`/depo/transferler/${id}/onayla`, {
        method: "POST",
      });
      setBasari(
        sonuc.uyarilar.length > 0
          ? `Transfer onaylandı. Uyarılar: ${sonuc.uyarilar.join("; ")}`
          : "Transfer onaylandı; mal hedef depoya geçti.",
      );
      await yukle();
      await detayAc(id);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Transfer onaylanamadı");
    }
  }

  async function sil(t: TransferOzet) {
    if (!window.confirm(`${t.no} nolu taslak fiş silinsin mi?`)) return;
    setHata("");
    setBasari("");
    try {
      await api(`/depo/transferler/${t.id}`, { method: "DELETE" });
      setBasari(`${t.no} silindi.`);
      if (detay?.id === t.id) setDetay(null);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Transfer silinemedi");
    }
  }

  if (!cokluDepo) {
    return (
      <div>
        <PageHeader
          title="Depolar Arası Transfer"
          subtitle="Mal, bir depodan diğerine transfer fişiyle taşınır (STK-07)."
        />
        <Card>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            Firmanızda tek depo tanımlı olduğu için transfer yapılamaz. İkinci bir depo
            eklerseniz bu ekran kullanılabilir hâle gelir.
          </p>
          <ButtonLabel as="a" href="/panel/ayarlar/depolar">
            🏬 Depo Ayarları
          </ButtonLabel>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Depolar Arası Transfer"
        subtitle="Fiş taslak olarak kaydedilir; onayladığınızda kaynak depodan çıkış, hedef depoya giriş hareketi yazılır. Ortalama maliyet değişmez."
        actions={
          <>
            <ButtonLabel as="a" href="/panel/stok">
              ← Stok Listesi
            </ButtonLabel>
            <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
              {formAcik ? "Vazgeç" : "➕ Yeni Transfer"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {formAcik && (
        <Card style={{ marginBottom: "1.5rem" }}>
          <div className="card__title">Yeni Transfer Fişi</div>
          <div className="row">
            <div style={{ flex: 1, minWidth: 170 }}>
              <Field label="Tarih *">
                <Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Field label="Kaynak Depo *">
                <Select
                  value={kaynakDepoId}
                  onChange={(e) => setKaynakDepoId(e.target.value)}
                >
                  <option value="">Seçiniz...</option>
                  {depolar.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.ad}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Field label="Hedef Depo *">
                <Select value={hedefDepoId} onChange={(e) => setHedefDepoId(e.target.value)}>
                  <option value="">Seçiniz...</option>
                  {depolar
                    .filter((d) => d.id !== kaynakDepoId)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.ad}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            <div style={{ flex: 2, minWidth: 220 }}>
              <Field label="Açıklama">
                <Input
                  value={aciklama}
                  onChange={(e) => setAciklama(e.target.value)}
                  placeholder="Örn. Şube stok takviyesi"
                />
              </Field>
            </div>
          </div>

          {kaynakDepoId ? (
            <>
              <SearchInput
                value={arama}
                onChange={(e) => setArama(e.target.value)}
                placeholder="Ürün adı veya kodu ile filtrele..."
              />
              <div style={{ maxHeight: 420, overflowY: "auto", marginTop: "0.75rem" }}>
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Kod</th>
                      <th>Ürün</th>
                      <th className="num">Kaynak Depoda</th>
                      <th className="num" style={{ width: 170 }}>
                        Gönderilecek
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {suzulmus.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="empty">
                          Bu depoda stok kaydı olan ürün yok.
                        </td>
                      </tr>
                    ) : (
                      suzulmus.map((s) => {
                        const kullanilabilir =
                          Number(s.mevcutMiktar) - Number(s.rezerveMiktar);
                        return (
                          <tr key={s.stokId}>
                            <td className="mono">{s.kod}</td>
                            <td>{s.ad}</td>
                            <td className="num">
                              {adet(kullanilabilir)} {s.anaBirim}
                            </td>
                            <td className="num">
                              <Input
                                type="number"
                                step="0.001"
                                min="0"
                                value={miktarlar[s.stokId] ?? ""}
                                onChange={(e) =>
                                  setMiktarlar((m) => ({ ...m, [s.stokId]: e.target.value }))
                                }
                                placeholder="—"
                                style={{ textAlign: "right" }}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </TableWrap>
              </div>
            </>
          ) : (
            <p className="muted">Ürünleri listelemek için önce kaynak depoyu seçin.</p>
          )}

          <div className="between" style={{ marginTop: "1rem" }}>
            <span className="muted" style={{ fontSize: "0.9rem" }}>
              {girilenler.length} kalem transfer edilecek
            </span>
            <Button
              variant="primary"
              onClick={kaydet}
              disabled={
                girilenler.length === 0 ||
                !kaynakDepoId ||
                !hedefDepoId ||
                kaynakDepoId === hedefDepoId
              }
            >
              Taslağı Kaydet
            </Button>
          </div>
        </Card>
      )}

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Fiş No</th>
              <th>Tarih</th>
              <th>Kaynak → Hedef</th>
              <th>Durum</th>
              <th className="num">Kalem</th>
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {transferler.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  Henüz transfer fişi yok.
                </td>
              </tr>
            ) : (
              transferler.map((t) => (
                <tr key={t.id}>
                  <td className="mono" style={{ fontWeight: 700 }}>
                    {t.no}
                  </td>
                  <td className="mono">{t.tarih.slice(0, 10)}</td>
                  <td>
                    {t.kaynakDepo.ad} → {t.hedefDepo.ad}
                  </td>
                  <td>
                    <Badge variant={t.durum === "onaylandi" ? "success" : "warning"}>
                      {t.durum === "onaylandi" ? "✅ Onaylandı" : "📝 Taslak"}
                    </Badge>
                  </td>
                  <td className="num">{t._count.kalemler}</td>
                  <td className="center">
                    <div className="row-tight" style={{ justifyContent: "center" }}>
                      <Button size="sm" onClick={() => detayAc(t.id)}>
                        🔍 Detay
                      </Button>
                      {t.durum === "taslak" && (
                        <>
                          <Button size="sm" variant="primary" onClick={() => onayla(t.id)}>
                            ✅ Onayla
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => void sil(t)}>
                            Sil
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>

      {detay && (
        <Card style={{ marginTop: "1.5rem", borderColor: "var(--accent)" }}>
          <div className="between" style={{ alignItems: "flex-start" }}>
            <div>
              <h3 style={{ fontSize: "1.15rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {detay.no}
                <Badge variant={detay.durum === "onaylandi" ? "success" : "warning"}>
                  {detay.durum === "onaylandi" ? "✅ Onaylandı" : "📝 Taslak"}
                </Badge>
              </h3>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
                {detay.kaynakDepo.ad} → {detay.hedefDepo.ad} · {detay.tarih.slice(0, 10)}
                {detay.aciklama ? ` · ${detay.aciklama}` : ""}
              </p>
            </div>
            <div className="row-tight">
              {detay.durum === "taslak" && (
                <Button size="sm" variant="primary" onClick={() => onayla(detay.id)}>
                  ✅ Onayla
                </Button>
              )}
              <Button size="sm" onClick={() => setDetay(null)}>
                ✖ Kapat
              </Button>
            </div>
          </div>

          <TableWrap>
            <thead>
              <tr>
                <th>Kod</th>
                <th>Ürün</th>
                <th className="num">Miktar</th>
              </tr>
            </thead>
            <tbody>
              {detay.kalemler.map((k) => (
                <tr key={k.id}>
                  <td className="mono">{k.stok.kod}</td>
                  <td>{k.stok.ad}</td>
                  <td className="num">
                    {adet(k.girilenMiktar)} {k.girilenBirim}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}
