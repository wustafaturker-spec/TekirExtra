"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import { useDepolar } from "@/lib/depolar";
import { DepoSecici } from "@/components/depo-secici";
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
  Stat,
  StatGrid,
  TableWrap,
} from "@/components/ui";
import { bugunTR } from "@tekirextra/shared";

interface StokSatiri {
  id: string;
  kod: string;
  ad: string;
  tip: string;
  anaBirim: string;
  mevcutMiktar: string;
}

interface DepoBilgi {
  id: string;
  kod: string;
  ad: string;
}

interface DepoBakiye {
  stokId: string;
  mevcutMiktar: string;
}

interface SayimOzet {
  id: string;
  tarih: string;
  aciklama: string | null;
  durum: string;
  onayZamani: string | null;
  depo: DepoBilgi | null;
  _count: { kalemler: number };
}

interface SayimKalem {
  id: string;
  stokId: string;
  sistemMiktar: string;
  fiiliMiktar: string;
  stok: { id: string; kod: string; ad: string; anaBirim: string } | null;
}

interface SayimDetay extends Omit<SayimOzet, "_count"> {
  kalemler: SayimKalem[];
}

const adet = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

const bugun = () => bugunTR();

export default function SayimSayfasi() {
  const [sayimlar, setSayimlar] = useState<SayimOzet[]>([]);
  const [detay, setDetay] = useState<SayimDetay | null>(null);
  const [stoklar, setStoklar] = useState<StokSatiri[]>([]);
  const [formAcik, setFormAcik] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  // Taslak formu
  const [tarih, setTarih] = useState(bugun());
  const [depoId, setDepoId] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [arama, setArama] = useState("");
  /** stokId → kullanıcının girdiği fiili miktar; boş bırakılanlar sayıma girmez. */
  const [fiili, setFiili] = useState<Record<string, string>>({});

  const { cokluDepo } = useDepolar();
  /** Seçili deponun ürün bazlı miktarları; tek depoda kart toplamı kullanılır. */
  const [depoBakiyeleri, setDepoBakiyeleri] = useState<Record<string, string> | null>(null);

  const stoklariYukle = useCallback(async () => {
    const tumStoklar = await tumSayfalariAl<StokSatiri>("/stok");
    setStoklar(tumStoklar.filter((stok) => stok.tip !== "hizmet"));
  }, []);

  const yukle = useCallback(async () => {
    try {
      setSayimlar(await api<SayimOzet[]>("/stok/sayimlar"));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sayımlar yüklenemedi");
    }
  }, []);

  useEffect(() => {
    if (!tokenAl()) return;
    void yukle();
    void stoklariYukle().catch(() => {});
  }, [stoklariYukle, yukle]);

  // Depo seçilince sistem miktarı o deponun bakiyesinden okunur (STK-07)
  useEffect(() => {
    if (!depoId) {
      setDepoBakiyeleri(null);
      return;
    }
    void api<DepoBakiye[]>(`/depo/${depoId}/bakiyeler`)
      .then((satirlar) =>
        setDepoBakiyeleri(
          Object.fromEntries(satirlar.map((b) => [b.stokId, b.mevcutMiktar])),
        ),
      )
      .catch(() => setDepoBakiyeleri(null));
  }, [depoId]);

  /** Ürünün sayım ekranında gösterilecek sistem miktarı. */
  const sistemMiktar = useCallback(
    (s: StokSatiri) => (depoBakiyeleri ? (depoBakiyeleri[s.id] ?? "0") : s.mevcutMiktar),
    [depoBakiyeleri],
  );

  const suzulmus = useMemo(() => {
    const a = arama.trim().toLocaleLowerCase("tr");
    if (!a) return stoklar;
    return stoklar.filter(
      (s) => s.ad.toLocaleLowerCase("tr").includes(a) || s.kod.toLocaleLowerCase("tr").includes(a),
    );
  }, [stoklar, arama]);

  const girilenler = useMemo(
    () => Object.entries(fiili).filter(([, d]) => d.trim() !== ""),
    [fiili],
  );

  async function taslakKaydet() {
    setHata("");
    setBasari("");
    try {
      const kalemler = girilenler.map(([stokId, deger]) => ({
        stokId,
        fiiliMiktar: Number(deger).toFixed(3),
      }));
      await api("/stok/sayimlar", {
        method: "POST",
        body: JSON.stringify({
          tarih,
          depoId: depoId || null,
          aciklama: aciklama.trim() === "" ? null : aciklama.trim(),
          kalemler,
        }),
      });
      setBasari(`${kalemler.length} kalemli sayım taslağı oluşturuldu.`);
      setFormAcik(false);
      setFiili({});
      setAciklama("");
      setArama("");
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sayım kaydedilemedi");
    }
  }

  async function detayAc(id: string) {
    setHata("");
    try {
      setDetay(await api<SayimDetay>(`/stok/sayimlar/${id}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sayım detayı alınamadı");
    }
  }

  async function onayla(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/stok/sayimlar/${id}/onayla`, { method: "POST" });
      setBasari("Sayım onaylandı; farklar sayım düzeltme hareketi olarak stoğa işlendi.");
      await yukle();
      await detayAc(id);
      // Miktarlar değişti; sonraki taslakta güncel sistem miktarı görünsün
      void stoklariYukle().catch(() => {});
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sayım onaylanamadı");
    }
  }

  return (
    <div>
      <PageHeader
        title="Stok Sayımı"
        subtitle="Fiili sayım sonuçlarını taslak olarak kaydedin; onayladığınızda farklar stoğa işlenir."
        actions={
          <>
            <ButtonLabel as="a" href="/panel/stok">
              ← Stok Listesi
            </ButtonLabel>
            <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
              {formAcik ? "Vazgeç" : "➕ Yeni Sayım"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {formAcik && (
        <Card style={{ marginBottom: "1.5rem" }}>
          <div className="card__title">Yeni Sayım Taslağı</div>
          <div className="row">
            <div style={{ flex: 1, minWidth: 170 }}>
              <Field label="Sayım Tarihi *">
                <Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <DepoSecici deger={depoId} onChange={setDepoId} label="Depo *" />
            </div>
            <div style={{ flex: 3, minWidth: 240 }}>
              <Field label="Açıklama">
                <Input
                  value={aciklama}
                  onChange={(e) => setAciklama(e.target.value)}
                  placeholder="Örn. Yıl sonu deposu sayımı"
                />
              </Field>
            </div>
          </div>

          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Yalnız <strong>fiili miktar girdiğiniz</strong> ürünler sayıma dahil edilir; boş bıraktıklarınız
            etkilenmez. Farklar onay anındaki güncel stok miktarına göre yeniden hesaplanır.
            {cokluDepo && " Bir sayım tek depoyu kapsar; sistem miktarı seçtiğiniz deponun bakiyesidir."}
          </p>

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
                  <th className="num">Sistem</th>
                  <th className="num" style={{ width: 160 }}>
                    Fiili
                  </th>
                  <th className="num">Fark</th>
                </tr>
              </thead>
              <tbody>
                {suzulmus.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      Filtreye uyan ürün yok.
                    </td>
                  </tr>
                ) : (
                  suzulmus.map((s) => {
                    const girilen = fiili[s.id] ?? "";
                    const sistem = sistemMiktar(s);
                    const fark = girilen.trim() === "" ? null : Number(girilen) - Number(sistem);
                    return (
                      <tr key={s.id}>
                        <td className="mono">{s.kod}</td>
                        <td>{s.ad}</td>
                        <td className="num">
                          {adet(sistem)} {s.anaBirim}
                        </td>
                        <td className="num">
                          <Input
                            type="number"
                            step="0.001"
                            min="0"
                            value={girilen}
                            onChange={(e) => setFiili((f) => ({ ...f, [s.id]: e.target.value }))}
                            placeholder="—"
                            style={{ textAlign: "right" }}
                          />
                        </td>
                        <td
                          className="num"
                          style={{
                            fontWeight: 700,
                            color:
                              fark === null || fark === 0
                                ? "var(--text-subtle)"
                                : fark > 0
                                  ? "var(--success)"
                                  : "var(--danger)",
                          }}
                        >
                          {fark === null ? "—" : `${fark > 0 ? "+" : ""}${adet(fark)}`}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </TableWrap>
          </div>

          <div className="between" style={{ marginTop: "1rem" }}>
            <span className="muted" style={{ fontSize: "0.9rem" }}>
              {girilenler.length} ürün sayıma dahil edilecek
            </span>
            <Button variant="primary" onClick={taslakKaydet} disabled={girilenler.length === 0}>
              Taslağı Kaydet
            </Button>
          </div>
        </Card>
      )}

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Tarih</th>
              {cokluDepo && <th>Depo</th>}
              <th>Açıklama</th>
              <th>Durum</th>
              <th className="num">Kalem</th>
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {sayimlar.length === 0 ? (
              <tr>
                <td colSpan={cokluDepo ? 6 : 5} className="empty">
                  Henüz sayım kaydı yok.
                </td>
              </tr>
            ) : (
              sayimlar.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.tarih.slice(0, 10)}</td>
                  {cokluDepo && <td>{s.depo?.ad ?? "—"}</td>}
                  <td>{s.aciklama ?? "—"}</td>
                  <td>
                    <Badge variant={s.durum === "onaylandi" ? "success" : "warning"}>
                      {s.durum === "onaylandi" ? "✅ Onaylandı" : "📝 Taslak"}
                    </Badge>
                  </td>
                  <td className="num">{s._count.kalemler}</td>
                  <td className="center">
                    <div className="row-tight" style={{ justifyContent: "center" }}>
                      <Button size="sm" onClick={() => detayAc(s.id)}>
                        🔍 Detay
                      </Button>
                      {s.durum === "taslak" && (
                        <Button size="sm" variant="primary" onClick={() => onayla(s.id)}>
                          ✅ Onayla
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

      {detay && <SayimDetayKarti detay={detay} onKapat={() => setDetay(null)} onOnayla={() => onayla(detay.id)} />}
    </div>
  );
}

/* ─── Sayım detayı ───────────────────────────────────────────────────────── */

function SayimDetayKarti({
  detay,
  onKapat,
  onOnayla,
}: {
  detay: SayimDetay;
  onKapat: () => void;
  onOnayla: () => void;
}) {
  const taslak = detay.durum === "taslak";
  const farklar = detay.kalemler.map((k) => Number(k.fiiliMiktar) - Number(k.sistemMiktar));
  const fazla = farklar.filter((f) => f > 0).length;
  const eksik = farklar.filter((f) => f < 0).length;

  return (
    <Card style={{ marginTop: "1.5rem", borderColor: "var(--accent)" }}>
      <div className="between" style={{ alignItems: "flex-start" }}>
        <div>
          <h3 style={{ fontSize: "1.15rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {detay.tarih.slice(0, 10)} tarihli sayım
            {detay.depo && <Badge variant="info">{detay.depo.ad}</Badge>}
            <Badge variant={taslak ? "warning" : "success"}>{taslak ? "📝 Taslak" : "✅ Onaylandı"}</Badge>
          </h3>
          <p className="muted" style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
            {detay.aciklama ?? "Açıklama yok"}
            {detay.onayZamani ? ` · Onay: ${new Date(detay.onayZamani).toLocaleString("tr-TR")}` : ""}
          </p>
        </div>
        <div className="row-tight">
          {taslak && (
            <Button size="sm" variant="primary" onClick={onOnayla}>
              ✅ Onayla
            </Button>
          )}
          <Button size="sm" onClick={onKapat}>
            ✖ Kapat
          </Button>
        </div>
      </div>

      <StatGrid>
        <Stat label="Kalem" value={detay.kalemler.length} hint="Sayılan ürün" />
        <Stat label="Fazla Çıkan" value={fazla} tone={fazla > 0 ? "success" : "default"} hint="Fiili > sistem" />
        <Stat label="Eksik Çıkan" value={eksik} tone={eksik > 0 ? "danger" : "default"} hint="Fiili < sistem" />
      </StatGrid>

      {taslak && (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Aşağıdaki farklar taslak anındaki stok miktarına göredir. Onayda farklar güncel miktara göre yeniden
          hesaplanıp <strong>sayım düzeltme</strong> hareketi olarak işlenir.
        </p>
      )}

      <TableWrap>
        <thead>
          <tr>
            <th>Kod</th>
            <th>Ürün</th>
            <th className="num">Sistem</th>
            <th className="num">Fiili</th>
            <th className="num">Fark</th>
          </tr>
        </thead>
        <tbody>
          {detay.kalemler.map((k) => {
            const fark = Number(k.fiiliMiktar) - Number(k.sistemMiktar);
            return (
              <tr key={k.id}>
                <td className="mono">{k.stok?.kod ?? "—"}</td>
                <td>{k.stok?.ad ?? "(silinmiş ürün)"}</td>
                <td className="num">{adet(k.sistemMiktar)}</td>
                <td className="num">{adet(k.fiiliMiktar)}</td>
                <td
                  className="num"
                  style={{
                    fontWeight: 700,
                    color: fark === 0 ? "var(--text-subtle)" : fark > 0 ? "var(--success)" : "var(--danger)",
                  }}
                >
                  {fark > 0 ? "+" : ""}
                  {adet(fark)} {k.stok?.anaBirim ?? ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    </Card>
  );
}
