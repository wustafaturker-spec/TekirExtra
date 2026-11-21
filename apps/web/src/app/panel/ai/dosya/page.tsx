"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { apiDosyaIndir } from "@/lib/api";
import { Alert, Button, Card, PageHeader } from "@/components/ui";

/**
 * AI-118 (g): MCP istemcisinin verdiği indirme bağlantısı buraya açılır. Dosya kullanıcının
 * MCP sohbetinin ekidir; indirme ucu (`/ekler/:id/indir`) yalnız sohbetin sahibine izin verir,
 * bu yüzden bağlantı başka kullanıcıda ya da girişsiz çalışmaz.
 */
function DosyaIndir() {
  const p = useSearchParams();
  const ekId = p.get("ek") ?? "";
  const ad = (p.get("ad") ?? "dosya").slice(0, 200);
  const gecerli = /^[0-9a-f-]{36}$/i.test(ekId);
  const [durum, setDurum] = useState<{ tur: "hata" | "tamam"; metin: string } | null>(null);
  const [iniyor, setIniyor] = useState(false);

  async function indir() {
    setDurum(null); setIniyor(true);
    try { await apiDosyaIndir(`/ekler/${ekId}/indir`, ad); setDurum({ tur: "tamam", metin: "İndirme başladı." }); }
    catch (e) { setDurum({ tur: "hata", metin: e instanceof Error ? e.message : "Dosya indirilemedi." }); }
    finally { setIniyor(false); }
  }

  return (
    <>
      <PageHeader title="Asistan dosyası" subtitle="MCP üzerinden hazırlanan dosya" />
      <Card>
        {gecerli ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", alignItems: "flex-start" }}>
            <strong>{ad}</strong>
            <Button variant="primary" onClick={() => void indir()} disabled={iniyor}>
              <Download size={16} aria-hidden="true" /> {iniyor ? "İndiriliyor…" : "İndir"}
            </Button>
            <p className="muted" style={{ margin: 0 }}>Dosyayı yalnız onu isteyen kullanıcı indirebilir; sohbet saklama süresi dolunca silinir.</p>
          </div>
        ) : (
          <Alert tone="error">Bağlantı geçersiz.</Alert>
        )}
        {durum && <div style={{ marginTop: "0.75rem" }}><Alert tone={durum.tur === "hata" ? "error" : "success"}>{durum.metin}</Alert></div>}
      </Card>
    </>
  );
}

export default function AsistanDosyasiSayfasi() {
  return <Suspense fallback={<p className="muted">Yükleniyor…</p>}><DosyaIndir /></Suspense>;
}
