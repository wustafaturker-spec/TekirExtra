"use client";

import { useCallback, useEffect, useState } from "react";
import { bugunTR } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { Button, Field, Input, Select } from "@/components/ui";
import { MutabakatTablosu, type Mutabakat } from "./mutabakat-tablosu";

/** Mutabakat genelde ay sonu itibarıyla yapılır: varsayılan geçen ayın son günü. */
export function gecenAySonu(): string {
  const [y, a] = bugunTR().split("-").map(Number);
  return new Date(Date.UTC(y, a - 1, 0)).toISOString().slice(0, 10);
}

/**
 * CARI-42: cari kartının Ekstre sekmesinde mutabakat talebi ve geçmişi. Karşı
 * taraf e-postadaki bağlantıdan girişsiz yanıtlar; bakiye talep anında dondurulur.
 */
export function MutabakatPaneli({ cariId, varsayilanEposta, onMesaj }: {
  cariId: string;
  varsayilanEposta: string;
  onMesaj: (m: { hata?: string; basari?: string }) => void;
}) {
  const [kayitlar, setKayitlar] = useState<Mutabakat[]>([]);
  const [formAcik, setFormAcik] = useState(false);
  const [tarih, setTarih] = useState(gecenAySonu);
  const [sonYanit, setSonYanit] = useState("");
  const [alici, setAlici] = useState(varsayilanEposta);
  const [tur, setTur] = useState<"standart" | "ayrintili">("standart");
  const [islemde, setIslemde] = useState(false);

  const yukle = useCallback(async () => {
    try { setKayitlar((await api<{ kayitlar: Mutabakat[] }>(`/cari/mutabakatlar?cariId=${cariId}`)).kayitlar); }
    catch (h) { onMesaj({ hata: h instanceof Error ? h.message : "Mutabakatlar yüklenemedi" }); }
  }, [cariId, onMesaj]);

  useEffect(() => { void yukle(); }, [yukle]);

  async function gonder(e: React.FormEvent) {
    e.preventDefault();
    const bekleyen = kayitlar.some((k) => k.durum === "gonderildi" || k.durum === "goruldu");
    if (bekleyen && !window.confirm("Yanıt bekleyen bir talep var; yenisi gönderilince eskisi iptal olur. Devam edilsin mi?")) return;
    setIslemde(true);
    try {
      const sonuc = await api<{ mesaj: string }>("/cari/mutabakatlar", { method: "POST", body: JSON.stringify({ cariId, mutabakatTarihi: tarih, sonYanitTarihi: sonYanit || null, alici: alici.trim() || null, tur }) });
      onMesaj({ basari: sonuc.mesaj });
      setFormAcik(false);
      await yukle();
    } catch (h) {
      onMesaj({ hata: h instanceof Error ? h.message : "Mutabakat gönderilemedi" });
    } finally {
      setIslemde(false);
    }
  }

  return (
    <div className="mutabakat-paneli">
      <div className="mutabakat-paneli__bas">
        <div>
          <strong>Bakiye mutabakatı</strong>
          <div className="subtle">Karşı taraf e-postadaki bağlantıdan giriş yapmadan onaylar ya da kendi bakiyesiyle itiraz eder.</div>
        </div>
        <Button size="sm" variant={formAcik ? "ghost" : "primary"} onClick={() => setFormAcik(!formAcik)}>{formAcik ? "Vazgeç" : "✉️ Mutabakat iste"}</Button>
      </div>
      {formAcik && (
        <form className="cari-toplu__form" onSubmit={gonder}>
          <Field label="Mutabakat tarihi"><Input type="date" required max={bugunTR()} value={tarih} onChange={(e) => setTarih(e.target.value)} /></Field>
          <Field label="Son yanıt tarihi (boşsa 15 gün)"><Input type="date" min={bugunTR()} value={sonYanit} onChange={(e) => setSonYanit(e.target.value)} /></Field>
          <Field label="Alıcı e-posta"><Input type="email" required value={alici} onChange={(e) => setAlici(e.target.value)} placeholder="muhasebe@firma.com" /></Field>
          <Field label="Ekstre"><Select value={tur} onChange={(e) => setTur(e.target.value as "standart" | "ayrintili")}><option value="standart">Standart</option><option value="ayrintili">Ayrıntılı</option></Select></Field>
          <Button type="submit" size="sm" variant="primary" disabled={islemde}>{islemde ? "Gönderiliyor…" : "Gönder"}</Button>
        </form>
      )}
      <MutabakatTablosu kayitlar={kayitlar} onDegisti={() => void yukle()} onMesaj={onMesaj} />
    </div>
  );
}
