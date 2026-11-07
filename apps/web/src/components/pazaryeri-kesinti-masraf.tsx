"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Select, TableWrap } from "@/components/ui";
import { CariSecici, type CariSecenegi } from "@/components/cari-secici";

/**
 * PZR-10: faturasız pazaryeri kesintilerini (ceza, diğer) masraf kaydına
 * dönüştürme. Masraf KDV'siz, onaylı ve pazaryeri carisine borçtur; ödemesi
 * hakedişten mahsup edilir. Masraf, masraflar ekranından iptal edilirse
 * kesinti yeniden faturasız olur.
 */
export interface FaturasizKesinti {
  id: string; tarih: string; tur: string; siparisNo: string | null; aciklama: string | null; tutar: string; dovizCinsi: string;
  sinif: string; baglanti: { id: string; saglayici: string };
}
interface Kategori { id: string; ad: string; ust: { ad: string } | null; _count: { altlar: number } }
interface EslestirmeBaglantisi { baglantiId: string; faturaKesenVkn: string | null }

const para = (v: string | number, d = "TRY") => Number(v).toLocaleString("tr-TR", { style: "currency", currency: d });

export function PazaryeriKesintiMasraf({ kesintiler, onBitti }: { kesintiler: FaturasizKesinti[]; onBitti: () => void | Promise<void> }) {
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [cariler, setCariler] = useState<CariSecenegi[]>([]);
  const [vknler, setVknler] = useState<EslestirmeBaglantisi[]>([]);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [kategoriId, setKategoriId] = useState("");
  const [cariId, setCariId] = useState("");
  const [islem, setIslem] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  useEffect(() => {
    if (!kesintiler.length) return;
    void (async () => {
      const [k, c, e] = await Promise.all([
        api<Kategori[]>("/masraflar/kategoriler"),
        api<{ kayitlar: CariSecenegi[] }>("/cari?adet=200"),
        api<EslestirmeBaglantisi[]>("/pazaryeri/kesintiler/eslestirme"),
      ]);
      // Liste en çok 200 cari döner; pazaryeri VKN'sine sahip cari ayrıca aranıp eklenir.
      const vknCarileri = await Promise.all(e.filter((b) => b.faturaKesenVkn).map((b) => api<{ kayitlar: CariSecenegi[] }>(`/cari?adet=5&arama=${encodeURIComponent(b.faturaKesenVkn!)}`).then((r) => r.kayitlar).catch(() => [])));
      const birlesik = new Map([...c.kayitlar, ...vknCarileri.flat()].map((x) => [x.id, x]));
      setKategoriler(k); setCariler([...birlesik.values()]); setVknler(e);
    })().catch((e) => setHata(e instanceof Error ? e.message : "Seçenekler yüklenemedi"));
  }, [kesintiler.length]);

  // Seçilen kesintilerin bağlantısının fatura kesen VKN'sine sahip cari önerilir (komisyon faturalarıyla aynı cari).
  const seciliKayitlar = kesintiler.filter((k) => secili.has(k.id));
  const oneriCari = useMemo(() => {
    const baglantilar = new Set(seciliKayitlar.map((k) => k.baglanti.id));
    if (baglantilar.size !== 1) return null;
    const vkn = vknler.find((v) => v.baglantiId === [...baglantilar][0])?.faturaKesenVkn;
    return vkn ? cariler.find((c) => c.vknTckn === vkn) ?? null : null;
  }, [seciliKayitlar, vknler, cariler]);
  useEffect(() => { if (oneriCari && !cariId) setCariId(oneriCari.id); }, [oneriCari, cariId]);

  if (!kesintiler.length) return null;
  const secilebilirKategori = kategoriler.filter((k) => !k._count.altlar);
  const toplamlar = seciliKayitlar.reduce<Record<string, number>>((t, k) => ({ ...t, [k.dovizCinsi]: (t[k.dovizCinsi] ?? 0) + Number(k.tutar) }), {});

  async function donustur() {
    if (!seciliKayitlar.length) return setHata("Dönüştürülecek kesinti seçin.");
    if (!kategoriId) return setHata("Masraf kategorisi seçin.");
    if (!cariId) return setHata("Pazaryeri carisini seçin.");
    const ozet = Object.entries(toplamlar).map(([d, v]) => para(v, d)).join(" · ");
    if (!confirm(`${seciliKayitlar.length} faturasız kesinti (${ozet}) KDV'siz, onaylı masraf kaydına dönüştürülecek ve pazaryeri carisine borç yazılacak. Ödemesi hakedişten mahsup edilir; kasa/banka hareketi açılmaz. Devam edilsin mi?`)) return;
    setIslem(true); setHata(""); setBasari("");
    try {
      const r = await api<{ masrafaDonusen: number }>("/pazaryeri/kesintiler/masrafa-donustur", { method: "POST", body: JSON.stringify({ kesintiIds: seciliKayitlar.map((k) => k.id), kategoriId, cariId }) });
      setBasari(`${r.masrafaDonusen} kesinti masraf kaydına dönüştürüldü. Masraf iptal edilirse kesinti yeniden faturasız olur.`);
      setSecili(new Set());
      await onBitti();
    } catch (e) { setHata(e instanceof Error ? e.message : "Masrafa dönüştürme başarısız"); }
    finally { setIslem(false); }
  }

  return (
    <Card title="Faturasız kesintiler (ceza ve diğer)" pad={false}>
      <div style={{ display: "grid", gap: "0.6rem", padding: "0.75rem 1rem" }}>
        <small className="subtle">Pazaryerinin fatura kesmediği kesintiler masraf kaydına dönüştürülür: KDV'siz, onaylı, pazaryeri carisine borç. Ödemesi hakedişten mahsup edildiği için kasa/banka hareketi açılmaz.</small>
        {hata && <Alert tone="error">{hata}</Alert>}
        {basari && <Alert tone="success">{basari}</Alert>}
      </div>
      <TableWrap>
        <thead><tr><th>Seç</th><th>Tarih</th><th>Tür</th><th>Sipariş / açıklama</th><th className="num">Tutar</th></tr></thead>
        <tbody>{kesintiler.map((k) => <tr key={k.id}>
          <td><input type="checkbox" aria-label={`${k.tur} kesintisini masrafa dönüştürmek için seç`} checked={secili.has(k.id)} onChange={(e) => setSecili((x) => { const s = new Set(x); if (e.target.checked) s.add(k.id); else s.delete(k.id); return s; })} /></td>
          <td>{new Date(k.tarih).toLocaleDateString("tr-TR")}</td>
          <td>{k.tur}<small> · {k.sinif === "ceza" ? "Ceza" : "Faturasız"}</small></td>
          <td>{k.siparisNo ?? "—"}{k.aciklama ? <small> · {k.aciklama}</small> : null}</td>
          <td className="num">{para(k.tutar, k.dovizCinsi)}</td>
        </tr>)}</tbody>
      </TableWrap>
      <div style={{ display: "grid", gap: "0.6rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "end", padding: "0.75rem 1rem" }}>
        <Field label="Masraf kategorisi">
          <Select value={kategoriId} onChange={(e) => setKategoriId(e.target.value)}>
            <option value="">Kategori seçin…</option>
            {secilebilirKategori.map((k) => <option key={k.id} value={k.id}>{k.ust ? `${k.ust.ad} › ` : ""}{k.ad}</option>)}
          </Select>
        </Field>
        <Field label={oneriCari ? `Pazaryeri carisi (önerilen: ${oneriCari.unvan})` : "Pazaryeri carisi"}>
          <CariSecici cariler={cariler} deger={cariId} onChange={setCariId} ariaLabel="Pazaryeri carisi" />
        </Field>
        <Button variant="primary" disabled={islem || !seciliKayitlar.length} onClick={() => void donustur()}>{islem ? "Dönüştürülüyor…" : `Masrafa dönüştür (${seciliKayitlar.length})`}</Button>
      </div>
    </Card>
  );
}
