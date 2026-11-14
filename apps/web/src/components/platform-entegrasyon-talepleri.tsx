"use client";
import { Alert, Card, TableWrap, Tarih } from "@/components/ui";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";

interface TalepSayisi { saglayici: string; ad: string; firmaSayisi: number; sonTalep: string }

/**
 * ETC-02: "Yakında" kartlarına gelen "İlgileniyorum" talepleri. Hangi entegrasyonun önce yazılacağına
 * karar vermek için platform başına talep eden firma sayısı; firmaların kimliği gösterilmez.
 */
export function PlatformEntegrasyonTalepleri() {
  const { veri, yukleniyor, hata } = usePlatformVerisi<TalepSayisi[]>("/platform/entegrasyon-talepleri");
  const sirali = [...(veri ?? [])].sort((a, b) => b.firmaSayisi - a.firmaSayisi || Date.parse(b.sonTalep) - Date.parse(a.sonTalep));
  return <Card title="Entegrasyon talepleri">
    <p className="subtle">Firmaların "Yakında" kartlarında "İlgileniyorum" dediği platformlar. Firma başına platform başına bir talep sayılır; hangi firmanın istediği gösterilmez.</p>
    {hata && <Alert tone="error">{hata}</Alert>}
    {!hata && <TableWrap><thead><tr><th>Platform</th><th>Talep eden firma</th><th>Son talep</th></tr></thead><tbody>
      {sirali.map((t) => <tr key={t.saglayici}><td>{t.ad}</td><td>{t.firmaSayisi.toLocaleString("tr-TR")}</td><td><Tarih deger={t.sonTalep} saatli /></td></tr>)}
      {!sirali.length && <tr><td colSpan={3}>{yukleniyor ? "Yükleniyor…" : "Henüz entegrasyon talebi yok."}</td></tr>}
    </tbody></TableWrap>}
  </Card>;
}
