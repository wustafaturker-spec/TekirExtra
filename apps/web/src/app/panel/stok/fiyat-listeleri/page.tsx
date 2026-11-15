"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  TableWrap,
} from "@/components/ui";
import { DovizSecenekleri } from "@/components/doviz-secenekleri";
import { EndeksFiyatOnerisi, type EndeksSecenegi } from "@/components/endeks-fiyat-onerisi";

interface FiyatListesi {
  id: string;
  ad: string;
  dovizCinsi: string;
  aktif: boolean;
  kalemSayisi: number;
  cariSayisi: number;
}

interface Kalem {
  id: string;
  stokId: string;
  kod: string;
  ad: string;
  anaBirim: string;
  fiyat: string;
}

interface ListeDetay {
  id: string;
  ad: string;
  dovizCinsi: string;
  aktif: boolean;
  cariSayisi: number;
  kalemler: Kalem[];
}

interface Stok {
  id: string;
  kod: string;
  ad: string;
}

const tutar = (deger: string | number, doviz: string): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " " + doviz;

export default function FiyatListeleriSayfasi() {
  const [listeler, setListeler] = useState<FiyatListesi[]>([]);
  const [detay, setDetay] = useState<ListeDetay | null>(null);
  const [stoklar, setStoklar] = useState<Stok[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);

  // Yeni liste formu
  const [yeniAd, setYeniAd] = useState("");
  const [yeniDoviz, setYeniDoviz] = useState("TRY");

  // Kalem formu
  const [kalemStokId, setKalemStokId] = useState("");
  const [kalemFiyat, setKalemFiyat] = useState("");
  const [kalemArama, setKalemArama] = useState("");
  // END-16: plan özelliği ve satış tarafı erişimi açıksa öneri paneli görünür; 403 paneli gizler.
  const [endeksler, setEndeksler] = useState<EndeksSecenegi[] | null>(null);

  const stoklariYukle = useCallback(async () => {
    setStoklar(await tumSayfalariAl<Stok>("/stok"));
  }, []);

  const yukle = useCallback(async () => {
    try {
      setListeler(await api<FiyatListesi[]>("/fiyat-listeleri"));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Fiyat listeleri yüklenemedi");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) {
      void yukle();
      void stoklariYukle().catch(() => undefined);
      api<{ erisim: { satis: boolean }; endeksler: EndeksSecenegi[] }>("/fiyat-endeks/secenekler")
        .then((r) => setEndeksler(r.erisim.satis && r.endeksler.length ? r.endeksler : null))
        .catch(() => setEndeksler(null));
    }
  }, [stoklariYukle, yukle]);

  async function detayAc(id: string) {
    setHata("");
    try {
      setDetay(await api<ListeDetay>(`/fiyat-listeleri/${id}`));
      setKalemStokId("");
      setKalemFiyat("");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Liste detayı yüklenemedi");
    }
  }

  async function listeOlustur(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    try {
      const yeni = await api<FiyatListesi>("/fiyat-listeleri", {
        method: "POST",
        body: JSON.stringify({ ad: yeniAd, dovizCinsi: yeniDoviz }),
      });
      setBasari(`'${yeni.ad}' fiyat listesi oluşturuldu.`);
      setYeniAd("");
      setFormAcik(false);
      await yukle();
      void detayAc(yeni.id);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Liste oluşturulamadı");
    }
  }

  async function listeSil(id: string, ad: string) {
    if (!confirm(`'${ad}' fiyat listesini silmek istediğinize emin misiniz?`)) return;
    setHata("");
    setBasari("");
    try {
      await api(`/fiyat-listeleri/${id}`, { method: "DELETE" });
      setBasari(`'${ad}' silindi.`);
      if (detay?.id === id) setDetay(null);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Liste silinemedi");
    }
  }

  async function kalemKaydet(e: React.FormEvent) {
    e.preventDefault();
    if (!detay || !kalemStokId || !kalemFiyat) return;
    setHata("");
    try {
      await api(`/fiyat-listeleri/${detay.id}/kalemler`, {
        method: "POST",
        body: JSON.stringify({ stokId: kalemStokId, fiyat: kalemFiyat }),
      });
      setKalemStokId("");
      setKalemFiyat("");
      setKalemArama("");
      await Promise.all([detayAc(detay.id), yukle()]);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kalem eklenemedi");
    }
  }

  async function kalemSil(kalemId: string) {
    if (!detay) return;
    try {
      await api(`/fiyat-listeleri/${detay.id}/kalemler/${kalemId}`, { method: "DELETE" });
      await Promise.all([detayAc(detay.id), yukle()]);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kalem silinemedi");
    }
  }

  // Kalem eklerken zaten listede olmayan ve aramaya uyan stoklar
  const eklenebilirStoklar = stoklar.filter((s) => {
    if (detay?.kalemler.some((k) => k.stokId === s.id)) return false;
    if (!kalemArama) return true;
    const q = kalemArama.toLocaleLowerCase("tr");
    return s.ad.toLocaleLowerCase("tr").includes(q) || s.kod.toLocaleLowerCase("tr").includes(q);
  });

  return (
    <div>
      <PageHeader
        title="Fiyat Listeleri"
        subtitle="Perakende, bayi, ihracat gibi çoklu fiyat listeleri tanımlayın; cariye atanınca fatura kesiminde otomatik uygulanır (STK-11)."
        actions={
          <>
            <ButtonLabel as="a" href="/panel/stok">← Stok Kartları</ButtonLabel>
            <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
              {formAcik ? "Vazgeç" : "➕ Yeni Liste"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {formAcik && (
        <Card className="stack" style={{ marginBottom: "1.5rem", maxWidth: 520 }}>
          <h3 style={{ fontSize: "1.05rem" }}>Yeni Fiyat Listesi</h3>
          <form onSubmit={listeOlustur} className="stack">
            <div className="row">
              <div style={{ flex: 2, minWidth: 200 }}><Field label="Liste Adı *"><Input value={yeniAd} onChange={(e) => setYeniAd(e.target.value)} required placeholder="Örn. Bayi Fiyatları" /></Field></div>
              <div style={{ flex: 1, minWidth: 120 }}><Field label="Döviz"><Select value={yeniDoviz} onChange={(e) => setYeniDoviz(e.target.value)}><DovizSecenekleri /></Select></Field></div>
            </div>
            <div><Button variant="primary" type="submit">Liste Oluştur</Button></div>
          </form>
        </Card>
      )}

      {/* Liste detayı — kalem yönetimi */}
      {detay && (
        <Card className="stack" style={{ marginBottom: "1.5rem", borderColor: "var(--accent)" }}>
          <div className="between">
            <div>
              <h3 style={{ fontSize: "1.15rem", margin: 0 }}>
                {detay.ad} <Badge variant="neutral">{detay.dovizCinsi}</Badge>
              </h3>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
                {detay.kalemler.length} kalem · {detay.cariSayisi} cariye atanmış
              </p>
            </div>
            <Button size="sm" onClick={() => setDetay(null)}>✖ Kapat</Button>
          </div>

          <form onSubmit={kalemKaydet} className="row-tight" style={{ flexWrap: "nowrap", alignItems: "flex-end" }}>
            <div className="grow" style={{ minWidth: 220 }}>
              <Field label="Ürün ekle / güncelle">
                <Select aria-label="Ürün ekle / güncelle" value={kalemStokId} onChange={(e) => setKalemStokId(e.target.value)} required>
                  <option value="">-- Ürün seçin --</option>
                  {eklenebilirStoklar.map((s) => (<option key={s.id} value={s.id}>{s.ad} ({s.kod})</option>))}
                </Select>
              </Field>
            </div>
            <div style={{ width: 160 }}>
              <Field label={`Fiyat (${detay.dovizCinsi})`}>
                <Input type="number" step="0.0001" min="0" value={kalemFiyat} onChange={(e) => setKalemFiyat(e.target.value)} required placeholder="0.0000" />
              </Field>
            </div>
            <Button variant="primary" type="submit">➕ Ekle</Button>
          </form>

          <TableWrap>
            <thead>
              <tr><th>Kod</th><th>Ürün</th><th className="num">Liste Fiyatı</th><th className="center">İşlem</th></tr>
            </thead>
            <tbody>
              {detay.kalemler.length === 0 ? (
                <tr><td colSpan={4} className="empty">Bu listede henüz ürün yok. Yukarıdan ekleyin.</td></tr>
              ) : (
                detay.kalemler.map((k) => (
                  <tr key={k.id}>
                    <td className="mono">{k.kod}</td>
                    <td>{k.ad}</td>
                    <td className="num money">{tutar(k.fiyat, detay.dovizCinsi)}</td>
                    <td className="center"><button className="btn-link" style={{ color: "var(--danger)" }} onClick={() => kalemSil(k.id)}>Sil</button></td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
          {endeksler && detay.dovizCinsi === "TRY" && detay.kalemler.length > 0 && (
            <EndeksFiyatOnerisi key={detay.id} listeId={detay.id} listeAdi={detay.ad} endeksler={endeksler} onUygulandi={async () => { await Promise.all([detayAc(detay.id), yukle()]); }} />
          )}
        </Card>
      )}

      {/* Liste tablosu */}
      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr><th>Liste Adı</th><th>Döviz</th><th className="num">Ürün Sayısı</th><th className="num">Atanmış Cari</th><th className="center">İşlem</th></tr>
          </thead>
          <tbody>
            {listeler.length === 0 ? (
              <tr><td colSpan={5} className="empty">Henüz fiyat listesi tanımlanmamış. &quot;➕ Yeni Liste&quot; ile başlayın.</td></tr>
            ) : (
              listeler.map((l) => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 600 }}>{l.ad}{!l.aktif && <span className="subtle"> (pasif)</span>}</td>
                  <td><Badge variant="neutral">{l.dovizCinsi}</Badge></td>
                  <td className="num">{l.kalemSayisi}</td>
                  <td className="num">{l.cariSayisi}</td>
                  <td className="center">
                    <div className="row-tight" style={{ flexWrap: "nowrap", justifyContent: "center" }}>
                      <Button size="sm" onClick={() => detayAc(l.id)}>🏷️ Kalemler</Button>
                      <Button variant="danger" size="sm" onClick={() => listeSil(l.id, l.ad)}>Sil</Button>
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
