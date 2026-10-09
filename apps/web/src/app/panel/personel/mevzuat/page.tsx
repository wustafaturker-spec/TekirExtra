"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MEVZUAT_TUR_TANIMLARI, bugunTR, mevzuatDegerOzeti } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { tarihTR } from "@/lib/mevzuat-gorunum";
import { Alert, Badge, Card, PageHeader, Table } from "@/components/ui";

interface Kayit {
  id: string;
  deger: Record<string, unknown>;
  yururlukBaslangic: string;
  yururlukBitis: string | null;
  degisiklik: { no: number; baslik: string; dayanak: string } | null;
}

const tanim = MEVZUAT_TUR_TANIMLARI.bordro_parametreleri;
const deger = (v: unknown) => {
  if (Array.isArray(v)) return mevzuatDegerOzeti("bordro_parametreleri", { gelirVergisiDilimleri: v }).replace(/^[^:]+: /, "");
  return typeof v === "number" ? v.toLocaleString("tr-TR") : "—";
};

/**
 * MVZ-14: bordro SGK ve vergi hesabının parametreleri Mevzuat Merkezi'nden
 * gelir; firma değiştiremez. Platform ekibi yayından önce kabul senaryolarını
 * çalıştırır. Eksik ya da hatalı değer Ayarlar > Mevzuat'tan bildirilir.
 */
export default function BordroMevzuatiSayfasi() {
  const [kayitlar, setKayitlar] = useState<Kayit[] | null>(null);
  const [hata, setHata] = useState("");

  useEffect(() => {
    api<Kayit[]>("/personel/mevzuat").then(setKayitlar).catch((e) => setHata(e instanceof Error ? e.message : "Bordro mevzuatı alınamadı"));
  }, []);

  const bugun = bugunTR();
  const guncel = kayitlar?.find((k) => k.yururlukBaslangic <= bugun && (!k.yururlukBitis || bugun <= k.yururlukBitis));
  const yilKaydiYok = kayitlar && !kayitlar.some((k) => k.yururlukBaslangic.slice(0, 4) === bugun.slice(0, 4) && k.yururlukBaslangic <= bugun);

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel/bordrolar">← Bordro çalışma alanına dön</Link>
      <PageHeader
        title="Bordro mevzuatı"
        subtitle="Asgari ücret, SGK oranları ve tavanı, gelir ve damga vergisi Mevzuat Merkezi'nden gelir ve bütün firmalar için aynıdır. Bordro, döneminin ilk gününde yürürlükteki değerlerle hesaplanır."
        actions={<div className="row-tight"><Link className="btn btn--ghost" href="/panel/personel/mevzuat/hesaplama">Brüt–net simülasyonu</Link><Link className="btn btn--ghost" href="/panel/ayarlar/mevzuat">Eksik / hatalı bildir</Link></div>}
      />
      <Alert tone="error">{hata}</Alert>
      {yilKaydiYok && <Alert tone="warning">{bugun.slice(0, 4)} yılı için bordro parametreleri henüz yayınlanmadı. Gelir vergisi tarifesi yıllık olduğundan önceki yılın değerleri kullanılmaz; brüt ücretli personelin bordrosu yayına kadar hesaplanamaz.</Alert>}

      {guncel && (
        <Card title="Bugün yürürlükte" actions={<Badge variant="success">{tarihTR(guncel.yururlukBaslangic)} – {guncel.yururlukBitis ? tarihTR(guncel.yururlukBitis) : "…"}</Badge>} pad={false}>
          <Table density="compact" className="table--fit">
            <tbody>
              {tanim.alanlar.map((a) => <tr key={a.ad}><td>{a.etiket}</td><td className="num"><strong>{deger(guncel.deger[a.ad])}</strong></td></tr>)}
            </tbody>
          </Table>
          <p className="muted" style={{ padding: "0.8rem 1.25rem", margin: 0, fontSize: "0.8rem" }}>
            Dayanak: {guncel.degisiklik ? `#${guncel.degisiklik.no} ${guncel.degisiklik.baslik} — ${guncel.degisiklik.dayanak}` : "İlk dolum (2026 resmî parametreleri)"}
          </p>
        </Card>
      )}

      <Card title="Geçmiş" pad={false}>
        <Table>
          <thead><tr><th>Yürürlük</th><th className="num">Asgari ücret</th><th className="num">SGK tavanı</th><th className="num">Yemek SGK istisnası</th><th>Dayanak</th></tr></thead>
          <tbody>
            {kayitlar?.map((k) => (
              <tr key={k.id}>
                <td>{tarihTR(k.yururlukBaslangic)} – {k.yururlukBitis ? tarihTR(k.yururlukBitis) : "…"}</td>
                <td className="num">{deger(k.deger.asgariUcretBrut)}</td>
                <td className="num">{deger(k.deger.sgkTavan)}</td>
                <td className="num">{deger(k.deger.yemekSgkGunlukIstisna)}</td>
                <td className="muted">{k.degisiklik ? `#${k.degisiklik.no} ${k.degisiklik.baslik}` : "İlk dolum"}</td>
              </tr>
            ))}
            {kayitlar && !kayitlar.length && <tr><td colSpan={5}>Mevzuat Merkezi'nde bordro parametresi yok.</td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
