"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, BulkActionsBar, Modal, Table } from "@/components/ui";

/** EBLG-152: sunucudaki sınırla aynı. */
export const TOPLU_FATURA_SINIRI = 50;

type TopluIslem = "kesinlestir" | "kesinlestir_gonder" | "gonder" | "taslaga_geri_al";
interface TopluSonuc { faturaId: string; no: string | null; cari: string | null; sonuc: "tamam" | "kismi" | "atlandi"; kesinlesti: boolean; kuyrugaAlindi: boolean; taslagaAlindi: boolean; mesaj: string | null }
export interface TopluFatura { id: string; tip: string; durum: string; ebelge?: unknown | null }

/** Toplu işleme giren fatura: satış/satış iade, e-Belgesi yok, taslak ya da kesin. */
export function topluSecilebilir(f: TopluFatura): boolean {
  return ["satis", "satis_iade"].includes(f.tip) && !f.ebelge && (f.durum === "taslak" || f.durum === "kesin");
}

const ISLEM_ADI: Record<TopluIslem, string> = {
  kesinlestir: "Kesinleştir",
  kesinlestir_gonder: "Kesinleştir ve gönder",
  gonder: "Gönder",
  taslaga_geri_al: "Taslağa geri al",
};
const ONAY_METNI: Record<TopluIslem, (n: number) => string> = {
  kesinlestir: (n) => `${n} taslak fatura kesinleştirilecek. Kesinleşen fatura numara alır, stok ve cariyi etkiler. Devam edilsin mi?`,
  kesinlestir_gonder: (n) => `${n} taslak fatura kesinleştirilip e-Belge olarak entegratöre gönderilecek. Gönderilen belge GİB'e gider ve geri alınamaz. Devam edilsin mi?`,
  gonder: (n) => `${n} kesin fatura e-Belge olarak entegratöre gönderilecek. Gönderilen belge GİB'e gider ve geri alınamaz. Devam edilsin mi?`,
  taslaga_geri_al: (n) => `${n} gönderilmemiş fatura taslağa geri alınacak; stok ve cari hareketleri ters kayıtla düzelir, numara korunur. Devam edilsin mi?`,
};

/**
 * Fatura listesindeki seçim için toplu eylem çubuğu ve sonuç penceresi.
 * Her eylem seçimin uygun alt kümesine uygulanır (taslaklar / kesinler).
 */
export function TopluFaturaIslemleri({ secili, faturalar, onTemizle, onBitti }: {
  secili: ReadonlySet<string>;
  faturalar: readonly (TopluFatura & { no: string | null })[];
  onTemizle: () => void;
  onBitti: () => void | Promise<void>;
}) {
  const [islemde, setIslemde] = useState<TopluIslem | null>(null);
  const [hata, setHata] = useState("");
  const [sonuc, setSonuc] = useState<{ islem: TopluIslem; sonuclar: TopluSonuc[] } | null>(null);
  const seciliKayitlar = faturalar.filter((f) => secili.has(f.id) && topluSecilebilir(f));
  const taslaklar = seciliKayitlar.filter((f) => f.durum === "taslak").map((f) => f.id);
  const kesinler = seciliKayitlar.filter((f) => f.durum === "kesin").map((f) => f.id);

  async function calistir(islem: TopluIslem, idler: string[]) {
    if (!idler.length || idler.length > TOPLU_FATURA_SINIRI) return;
    if (!window.confirm(ONAY_METNI[islem](idler.length))) return;
    setIslemde(islem); setHata("");
    try {
      const yanit = await api<{ islem: TopluIslem; sonuclar: TopluSonuc[] }>("/fatura/toplu", { method: "POST", body: JSON.stringify({ islem, faturaIdler: idler }) });
      setSonuc(yanit); onTemizle(); await onBitti();
    } catch (e) { setHata(e instanceof Error ? e.message : "Toplu işlem yapılamadı"); }
    finally { setIslemde(null); }
  }

  // Kesinleşmiş ama kuyruğa alınmamış faturalar taslağa geri alınabilir (FTR-29 kuralı sunucuda).
  const geriAlinabilir = sonuc && sonuc.islem !== "taslaga_geri_al" && sonuc.islem !== "kesinlestir"
    ? sonuc.sonuclar.filter((s) => !s.kuyrugaAlindi && (s.kesinlesti || (sonuc.islem === "gonder" && faturalar.some((f) => f.id === s.faturaId && f.durum === "kesin" && !f.ebelge)))).map((s) => s.faturaId)
    : [];
  const sayac = (n: number) => (n > TOPLU_FATURA_SINIRI ? `${n} — en çok ${TOPLU_FATURA_SINIRI}` : String(n));
  const ozet = sonuc ? { tamam: sonuc.sonuclar.filter((s) => s.sonuc === "tamam").length, kismi: sonuc.sonuclar.filter((s) => s.sonuc === "kismi").length, atlandi: sonuc.sonuclar.filter((s) => s.sonuc === "atlandi").length } : null;

  return <>
    {hata && <Alert tone="error">{hata}</Alert>}
    <BulkActionsBar selectedCount={secili.size} onClear={onTemizle}>
      {taslaklar.length > 0 && <>
        <Button size="sm" disabled={!!islemde || taslaklar.length > TOPLU_FATURA_SINIRI} onClick={() => void calistir("kesinlestir", taslaklar)}>{islemde === "kesinlestir" ? "Kesinleştiriliyor…" : `Kesinleştir (${sayac(taslaklar.length)})`}</Button>
        <Button size="sm" variant="primary" disabled={!!islemde || taslaklar.length > TOPLU_FATURA_SINIRI} onClick={() => void calistir("kesinlestir_gonder", taslaklar)}>{islemde === "kesinlestir_gonder" ? "İşleniyor…" : `Kesinleştir ve gönder (${sayac(taslaklar.length)})`}</Button>
      </>}
      {kesinler.length > 0 && <Button size="sm" variant="primary" disabled={!!islemde || kesinler.length > TOPLU_FATURA_SINIRI} onClick={() => void calistir("gonder", kesinler)}>{islemde === "gonder" ? "Gönderiliyor…" : `Gönder (${sayac(kesinler.length)})`}</Button>}
    </BulkActionsBar>
    {sonuc && ozet && <Modal genis baslik={`${ISLEM_ADI[sonuc.islem]} · sonuç`} aciklama={`${ozet.tamam} tamam${ozet.kismi ? ` · ${ozet.kismi} kesinleşti ama gönderilmedi` : ""}${ozet.atlandi ? ` · ${ozet.atlandi} atlandı` : ""}. Kuyruğa alınan belgelerin entegratör durumu listede e-Belge sütunundan izlenir.`} onKapat={() => setSonuc(null)}
      altBilgi={<><Button onClick={() => setSonuc(null)}>Kapat</Button>{geriAlinabilir.length > 0 && <Button variant="danger" disabled={!!islemde} onClick={() => void calistir("taslaga_geri_al", geriAlinabilir)}>{islemde === "taslaga_geri_al" ? "Geri alınıyor…" : `Gönderilemeyenleri taslağa geri al (${geriAlinabilir.length})`}</Button>}</>}>
      <Table>
        <thead><tr><th>Fatura</th><th>Cari</th><th>Sonuç</th><th>Açıklama</th></tr></thead>
        <tbody>{sonuc.sonuclar.map((s) => <tr key={s.faturaId}>
          <td className="mono">{s.no || "(Taslak)"}</td>
          <td>{s.cari ?? "—"}</td>
          <td>{s.sonuc === "tamam" ? <Badge variant="success">{s.taslagaAlindi ? "Taslağa alındı" : s.kuyrugaAlindi ? (s.kesinlesti ? "Kesinleşti · kuyrukta" : "Kuyrukta") : "Kesinleşti"}</Badge> : s.sonuc === "kismi" ? <Badge variant="warning">Kesinleşti · gönderilmedi</Badge> : <Badge variant="neutral">Atlandı</Badge>}</td>
          <td>{s.mesaj ?? ""}</td>
        </tr>)}</tbody>
      </Table>
    </Modal>}
  </>;
}
