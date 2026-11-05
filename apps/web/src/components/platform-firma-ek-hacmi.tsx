"use client";
import { Alert, Button, Card, TableWrap } from "@/components/ui";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";

interface EkHacmi { tenantId: string; olcumAt: string; dosyaAdedi: string; bayt: string; bekleyenDosyaAdedi?: string; bekleyenBayt?: string; sinirBayt?: string | null; uyariYuzdesi?: number; durum?: string; kotaUygulaniyor: boolean; dagilim: { sahipTur: string; dosyaAdedi: string; bayt: string }[] }
const SAHIP: Record<string, string> = { firma: "Firma görselleri", firma_kase: "Firma kaşesi", cari: "Cari", stok: "Stok", fatura: "Fatura", belge: "Satış belgeleri", kasa_banka: "Kasa ve banka", cek_senet: "Çek ve senet", masraf: "Masraf", kira_sozlesme: "Kira sözleşmesi", satin_alma_teklif: "Satın alma teklifleri", demirbas: "Demirbaş", personel: "Personel", ai_sohbet: "Yapay zekâ sohbeti" };
function mib(v: string) {
  const yuzde = BigInt(v) * BigInt(100) / BigInt(1048576);
  return `${yuzde / BigInt(100)},${String(yuzde % BigInt(100)).padStart(2, "0")} MiB`;
}

export function FirmaEkHacmi({ tenantId }: { tenantId: string }) {
  const r = usePlatformVerisi<EkHacmi>(`/platform/firmalar/${tenantId}/ek-hacmi`);
  return <Card id="firma-ek-hacmi" title="Kayıtlı ek dosyalarının hacmi" actions={<Button onClick={r.yenile} disabled={r.yukleniyor}>Ölçümü yenile</Button>}>
    <p>Yalnız uygulamada kayıtlı eklerin dosya boyutları sayılır. Yedekler, günlükler, harici dosyalar ve kayıtsız nesneler bu ölçüme dahil değildir. Sınır tanımlı paketlerde dosyalar ve açık rezervasyonlar birlikte denetlenir; ek ücret oluşturulmaz.</p>
    {r.hata && <Alert tone="error">{r.hata} <Button onClick={r.yenile}>Tekrar dene</Button></Alert>}
    {r.yukleniyor && <p role="status">Dosya hacmi ölçülüyor…</p>}
    {r.veri && <><p>{r.veri.dosyaAdedi} dosya · {mib(r.veri.bayt)} · {r.veri.bayt} bayt</p><p>Ölçüm: {new Date(r.veri.olcumAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</p>
      <p>Devam eden yüklemeler için ayrılan: {r.veri.bekleyenDosyaAdedi ?? "0"} dosya · {r.veri.bekleyenBayt ?? "0"} bayt. Tamamlanan dosya toplamına dahil değildir; kullanılmayan rezervasyon 15 dakika sonra ölçümden düşer.</p>
      <p>Depolama sınırı: {r.veri.sinirBayt == null ? "Sınırsız / tanımlı sayısal sınır yok" : `${r.veri.sinirBayt} bayt`}. Uyarı eşiği: %{r.veri.uyariYuzdesi ?? 80}.</p>
      {["uyari", "dolu", "asim"].includes(r.veri.durum ?? "") && <Alert tone="warning">{r.veri.durum === "uyari" ? "Depolama uyarı eşiğine ulaşıldı." : "Depolama sınırı dolu veya aşılmış. Yeni yükleme için dosya silin veya sınırı artırın."}</Alert>}
      <TableWrap><thead><tr><th>Dosyanın bağlı olduğu kayıt</th><th>Dosya sayısı</th><th>Hacim</th><th>Bayt</th></tr></thead><tbody>{r.veri.dagilim.map((g) => <tr key={g.sahipTur}><td>{SAHIP[g.sahipTur] ?? g.sahipTur}</td><td>{g.dosyaAdedi}</td><td>{mib(g.bayt)}</td><td>{g.bayt}</td></tr>)}{!r.veri.dagilim.length && <tr><td colSpan={4}>Kayıtlı ek dosyası yok.</td></tr>}</tbody></TableWrap>
    </>}
  </Card>;
}
