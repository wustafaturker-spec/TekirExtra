"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Button, Card, PageHeader, TableWrap } from "@/components/ui";

/**
 * EBLG-141: ön denetimde cari başına susturulan kurallar. Susturulan kural o
 * caride ne gösterilir ne de gönderimde onay ister; kaldırınca yeniden çalışır.
 */
interface Susturma {
  id: string;
  cariId: string;
  cari: string | null;
  kod: string;
  kural: string;
  kullanici: string | null;
  zaman: string;
}

export default function OnDenetimSayfasi() {
  const [kayitlar, setKayitlar] = useState<Susturma[]>([]);
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islem, setIslem] = useState<string | null>(null);

  const yukle = useCallback(async () => setKayitlar(await api<Susturma[]>("/ebelge/on-denetim/susturmalar")), []);
  useEffect(() => { if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Susturmalar yüklenemedi")); }, [yukle]);

  async function kaldir(s: Susturma) {
    setIslem(s.id); setHata(""); setBasari("");
    try {
      await api(`/ebelge/on-denetim/susturmalar/${s.id}`, { method: "DELETE" });
      await yukle();
      setBasari(`"${s.kural}" kuralı ${s.cari ?? "cari"} için yeniden gösterilecek.`);
    } catch (e) { setHata(e instanceof Error ? e.message : "Kaldırılamadı"); } finally { setIslem(null); }
  }

  return <div className="production-page">
    <PageHeader
      title="e-Belge Ön Denetimi"
      subtitle="Gönderim sihirbazı belgeyi göndermeden önce fiyat, vergi, cari ve mükerrer kontrolleri yapar. Burada cari başına susturduğunuz kurallar listelenir."
    />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    <Card title={`Susturulan kurallar (${kayitlar.length})`} pad={false}>
      <TableWrap>
        <thead><tr><th>Cari</th><th>Kural</th><th>Susturan</th><th>Tarih</th><th /></tr></thead>
        <tbody>
          {kayitlar.map((s) => <tr key={s.id}>
            <td><Link href={`/panel/cari/${s.cariId}`}>{s.cari ?? "Silinmiş cari"}</Link></td>
            <td>{s.kural}</td>
            <td>{s.kullanici ?? "—"}</td>
            <td>{new Date(s.zaman).toLocaleDateString("tr-TR")}</td>
            <td><Button size="sm" disabled={islem === s.id} onClick={() => void kaldir(s)}>Yeniden göster</Button></td>
          </tr>)}
          {!kayitlar.length && <tr><td colSpan={5}>Susturulan kural yok. Sihirbazdaki bir bulguda &quot;Bu cari için gösterme&quot; ile eklenir.</td></tr>}
        </tbody>
      </TableWrap>
    </Card>
    <p className="muted">
      Fiyat sapması (varsayılan %25) ve kur sapması (varsayılan %3) eşikleri <Link href="/panel/ayarlar/moduller">Modül Ayarları › e-Belge</Link> bölümünden değiştirilir.
    </p>
  </div>;
}
