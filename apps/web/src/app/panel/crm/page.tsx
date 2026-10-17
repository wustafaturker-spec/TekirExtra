"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, PageHeader } from "@/components/ui";
import Link from "next/link";
import { AramaSecici } from "@/components/arama-secici";

interface Cari {
  id: string;
  kod: string;
  unvan: string;
}

interface Firsat {
  id: string;
  baslik: string;
  asama: "yeni_lead" | "iletisim_kuruldu" | "teklif_verildi" | "pazarlik" | "kazanildi" | "kaybedildi";
  tahminiTutar: number | string;
  cari: Cari;
  kapanisTarihi?: string | null;
  sorumlu?: { id: string; adSoyad: string } | null;
  notlar?: string;
}

/** Sütunun üst şeridi tasarım token'ından (uygulamada Tailwind yok; eski renk sınıfları boşa düşüyordu). */
const ASAMALAR: { kod: Firsat["asama"]; baslik: string; renk: string }[] = [
  { kod: "yeni_lead", baslik: "Yeni Lead", renk: "var(--border-strong)" },
  { kod: "iletisim_kuruldu", baslik: "İletişim Kuruldu", renk: "var(--info)" },
  { kod: "teklif_verildi", baslik: "Teklif Verildi", renk: "var(--accent)" },
  { kod: "pazarlik", baslik: "Pazarlık", renk: "var(--warning)" },
  { kod: "kazanildi", baslik: "Kazanıldı 🎉", renk: "var(--success)" },
  { kod: "kaybedildi", baslik: "Kaybedildi ❌", renk: "var(--danger)" },
];

export default function CrmKanbanSayfasi() {
  const [firsatlar, setFirsatlar] = useState<Firsat[]>([]);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");

  const [modalAcik, setModalAcik] = useState(false);
  const [duzenlenenId, setDuzenlenenId] = useState<string | null>(null);
  const [suruklenenId, setSuruklenenId] = useState<string | null>(null);
  const [form, setForm] = useState({
    baslik: "",
    cariId: "",
    tahminiTutar: 50000,
    asama: "yeni_lead",
    notlar: "",
    kapanisTarihi: "",
  });

  const fetchVeriler = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const [firsatData, cariData] = await Promise.all([
        api<Firsat[]>("/crm/firsatlar"),
        api<{ kayitlar: Cari[] }>("/cari?adet=50"),
      ]);

      if (firsatData) setFirsatlar(firsatData);
      if (cariData?.kayitlar) setCariler(cariData.kayitlar);
    } catch (e) {
      console.error(e);
      setHata("CRM fırsatları yüklenirken hata oluştu.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    void fetchVeriler();
  }, [fetchVeriler]);

  useEffect(() => {
    if (!modalAcik) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setModalAcik(false); setDuzenlenenId(null); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [modalAcik]);

  const asamaDegistir = async (id: string, yeniAsama: Firsat["asama"]) => {
    try {
      await api(`/crm/firsatlar/${id}/asama`, {
        method: "PATCH",
        body: JSON.stringify({ asama: yeniAsama }),
      });

      setFirsatlar((prev) =>
        prev.map((f) => (f.id === id ? { ...f, asama: yeniAsama } : f))
      );
    } catch (e) {
      console.error(e);
      setHata(e instanceof Error ? e.message : "Aşama değiştirilemedi.");
    }
  };

  const firsatiDuzenle = (firsat: Firsat) => {
    setDuzenlenenId(firsat.id);
    setForm({ baslik: firsat.baslik, cariId: firsat.cari?.id ?? "", tahminiTutar: Number(firsat.tahminiTutar), asama: firsat.asama, notlar: firsat.notlar ?? "", kapanisTarihi: firsat.kapanisTarihi?.slice(0, 10) ?? "" });
    setModalAcik(true);
  };

  const firsatEkle = async (e: React.FormEvent) => {
    e.preventDefault();
    setHata("");
    if (!form.cariId) { setHata("Lütfen bir müşteri / cari hesap seçin."); return; }
    try {
      await api(duzenlenenId ? `/crm/firsatlar/${duzenlenenId}` : "/crm/firsatlar", {
        method: duzenlenenId ? "PUT" : "POST",
        body: JSON.stringify(form),
      });

      setModalAcik(false);
      setDuzenlenenId(null);
      setForm({ baslik: "", cariId: "", tahminiTutar: 50000, asama: "yeni_lead", notlar: "", kapanisTarihi: "" });
      void fetchVeriler();
    } catch (e) {
      console.error(e);
      setHata(e instanceof Error ? e.message : "Fırsat eklenirken hata oluştu.");
    }
  };

  return (
    <div className="crm-page workspace-page">
      <PageHeader
        title="CRM & Satış Hunisi"
        subtitle="Müşteri fırsatlarınızı aşama aşama takip edin ve satış sürecini sürükleyici bir akışla yönetin."
        actions={
          <Button onClick={() => setModalAcik(true)} variant="primary">
            + Yeni Fırsat Ekle
          </Button>
        }
      />

      <Alert tone="error">{hata}</Alert>

      {/* Kanban Board */}
      {yukleniyor ? (
        <Card><p className="muted" style={{ margin: 0, textAlign: "center" }}>Yükleniyor...</p></Card>
      ) : (
        <div className="crm-board">
          {ASAMALAR.map((a) => {
            const sutunFirsatlari = firsatlar.filter((f) => f.asama === a.kod);
            const sutunToplam = sutunFirsatlari.reduce((toplam, f) => toplam + Number(f.tahminiTutar), 0);

            return (
              <div key={a.kod} className="crm-column" style={{ borderTopColor: a.renk }} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (suruklenenId) { void asamaDegistir(suruklenenId, a.kod); setSuruklenenId(null); } }}>
                <div>
                  <h3>{a.baslik}</h3>
                  <span className="crm-column__sayi">{sutunFirsatlari.length}</span>
                </div>

                <div className="crm-column__toplam">Toplam: {sutunToplam.toLocaleString("tr-TR")} ₺</div>

                {/* Kartlar */}
                <div className="crm-column__kartlar">
                  {sutunFirsatlari.map((f) => (
                    <article
                      key={f.id}
                      className="crm-card"
                      draggable
                      onDragStart={() => setSuruklenenId(f.id)}
                      onDragEnd={() => setSuruklenenId(null)}
                    >
                      <h4>{f.baslik}</h4>
                      <Link href={`/panel/crm/${f.id}`}>Teklifleri gör</Link>
                      <p>{f.cari?.unvan || "Cari Belirtilmemiş"}</p>
                      <div className="crm-card__tutar">{Number(f.tahminiTutar).toLocaleString("tr-TR")} ₺</div>
                      <button type="button" className="crm-card__edit" onClick={() => firsatiDuzenle(f)}>Düzenle</button>

                      {/* Aşama Değiştirici Hızlı Butonlar */}
                      <div className="crm-card__asamalar">
                        {ASAMALAR.filter((item) => item.kod !== f.asama).map((item) => (
                          <button
                            key={item.kod}
                            onClick={() => asamaDegistir(f.id, item.kod)}
                            title={`${item.baslik} aşamasına taşı`}
                          >
                            → {item.baslik.split(" ")[0]}
                          </button>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Yeni Fırsat Modal */}
      {modalAcik && (
        <div className="crm-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setModalAcik(false); }}>
          <div className="crm-modal" role="dialog" aria-modal="true" aria-labelledby="crm-modal-title">
            <div className="crm-modal__head"><h2 id="crm-modal-title">{duzenlenenId ? "Satış Fırsatını Düzenle" : "Yeni Satış Fırsatı Ekle"}</h2><button type="button" className="crm-modal__close" aria-label="CRM fırsat penceresini kapat" onClick={() => { setModalAcik(false); setDuzenlenenId(null); }}>×</button></div>
            <form onSubmit={firsatEkle}>
              <div>
                <label htmlFor="crm-baslik">Fırsat Başlığı</label>
                <input
                  id="crm-baslik" required
                  type="text"
                  placeholder="Örn: 50 Adet Yazılım Lisansı Satışı"
                  value={form.baslik}
                  onChange={(e) => setForm({ ...form, baslik: e.target.value })}
                />
              </div>

              <div>
                <label htmlFor="crm-cari">Müşteri / Cari Hesap</label>
                <AramaSecici
                  deger={form.cariId}
                  onChange={(cariId) => setForm({ ...form, cariId })}
                  ariaLabel="Müşteri / Cari Hesap ara"
                  placeholder="Cari adı veya kodu yazın"
                  bosMesaj="Eşleşen cari hesap bulunamadı."
                  kullanimAnahtari="crm_son_cariler"
                  secenekler={cariler.map((c) => ({ deger: c.id, baslik: c.unvan, aciklama: c.kod, aramaMetni: `${c.kod} ${c.unvan}` }))}
                />
              </div>

              <div>
                <label htmlFor="crm-tutar">Tahmini Tutar (₺)</label>
                <input
                  id="crm-tutar" required
                  type="number"
                  value={form.tahminiTutar}
                  onChange={(e) => setForm({ ...form, tahminiTutar: Number(e.target.value) })}
                />
              </div>

              <div>
                <label htmlFor="crm-asama">Başlangıç Aşaması</label>
                <select
                  id="crm-asama" value={form.asama}
                  onChange={(e) => setForm({ ...form, asama: e.target.value as any })}
                >
                  {ASAMALAR.map((a) => (
                    <option key={a.kod} value={a.kod}>
                      {a.baslik}
                    </option>
                  ))}
                </select>
              </div>

              <div className="crm-form-grid">
                <div><label htmlFor="crm-kapanis">Beklenen kapanış</label><input id="crm-kapanis" type="date" value={form.kapanisTarihi} onChange={(e) => setForm({ ...form, kapanisTarihi: e.target.value })} /></div>
                <div><label htmlFor="crm-notlar">Notlar</label><textarea id="crm-notlar" rows={3} value={form.notlar} onChange={(e) => setForm({ ...form, notlar: e.target.value })} placeholder="Fırsatla ilgili kısa notlar" /></div>
              </div>

              <div className="crm-modal__eylemler">
                <Button
                  type="button"
                  onClick={() => { setModalAcik(false); setDuzenlenenId(null); }}
                >
                  İptal
                </Button>
                <Button type="submit" variant="primary">
                  {duzenlenenId ? "Değişiklikleri Kaydet" : "Fırsatı Oluştur"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
