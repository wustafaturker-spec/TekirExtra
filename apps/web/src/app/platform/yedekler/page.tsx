"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { DatabaseBackup, RefreshCw } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, Modal, ModalEylem, PageHeader, Stat, StatGrid, TableWrap } from "@/components/ui";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

/** PLT-112/113/116: yedek ekranı. İndirme, silme ve canlıya geri yükleme bilerek yoktur. */
interface Satir {
  id: string; tur: "otomatik" | "elle"; durum: "bekliyor" | "calisiyor" | "basarili" | "hatali" | "silindi"; neden: string | null; baslatan: string | null;
  talepAt: string; baslangicAt: string | null; bitisAt: string | null; boyutBayt: number | null; hata: string | null; korunuyor: boolean; silinecek: boolean;
  denemeDurum: "bekliyor" | "calisiyor" | "basarili" | "hatali" | null; denemeAt: string | null; denemeDetay: string | null;
}
interface Yanit {
  ozet: { sonBasariliAt: string | null; sonBoyutBayt: number | null; sonrakiOtomatikAt: string; aktif: boolean; servis: { sonNabizAt: string; canli: boolean; surum: string | null; diskToplamBayt: number | null; diskBosBayt: number | null } | null };
  sayfa: number; sayfaBoyu: number; toplam: number; satirlar: Satir[];
}

const zaman = (s: string | null) => (s ? new Date(s).toLocaleString("tr-TR") : "—");
function boyut(b: number | null): string {
  if (b === null) return "—";
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} GB`;
  return `${(b / 1024 ** 2).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
}
function sure(a: string | null, b: string | null): string {
  if (!a || !b) return "—";
  const dk = (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
  return dk < 1 ? "1 dk'dan az" : `${Math.round(dk)} dk`;
}
const DURUM: Record<Satir["durum"], { ad: string; ton: "neutral" | "info" | "success" | "danger" }> = {
  bekliyor: { ad: "Sırada", ton: "neutral" }, calisiyor: { ad: "Alınıyor", ton: "info" }, basarili: { ad: "Başarılı", ton: "success" }, hatali: { ad: "Başarısız", ton: "danger" }, silindi: { ad: "Silindi", ton: "neutral" },
};
const DENEME: Record<NonNullable<Satir["denemeDurum"]>, { ad: string; ton: "neutral" | "info" | "success" | "danger" }> = {
  bekliyor: { ad: "Sırada", ton: "neutral" }, calisiyor: { ad: "Sürüyor", ton: "info" }, basarili: { ad: "Doğrulandı", ton: "success" }, hatali: { ad: "Başarısız", ton: "danger" },
};

export default function PlatformYedekler() {
  const [v, setV] = useState<Yanit | null>(null);
  const [sayfa, setSayfa] = useState(1);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [listeHatasi, setListeHatasi] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [neden, setNeden] = useState("");
  const [kod, setKod] = useState("");
  const kontrol = useRef<AbortController | null>(null);

  const yukle = useCallback(async () => {
    kontrol.current?.abort();
    const istek = new AbortController();
    kontrol.current = istek;
    setYukleniyor(true);
    try {
      const sonuc = await platformApi<Yanit>(`/platform/yedekler?sayfa=${sayfa}`, { signal: istek.signal });
      if (!istek.signal.aborted) { setV(sonuc); setListeHatasi(""); }
    } catch (e) {
      if (!istek.signal.aborted) setListeHatasi(e instanceof Error ? e.message : "Yedek bilgileri alınamadı.");
    } finally { if (!istek.signal.aborted) setYukleniyor(false); }
  }, [sayfa]);

  const aktif = v?.ozet.aktif ?? false;
  useEffect(() => {
    if (!platformTokenAl()) return;
    void yukle();
    const t = setInterval(() => void yukle(), aktif ? 15_000 : 60_000);
    return () => { clearInterval(t); kontrol.current?.abort(); };
  }, [yukle, aktif]);

  async function calistir(anahtar: string, yol: string, govde?: unknown) {
    if (islem) return;
    setIslem(anahtar); setHata(""); setBasari("");
    try {
      const r = await platformApi<{ mesaj: string }>(yol, { method: "POST", ...(govde === undefined ? {} : { body: JSON.stringify(govde) }) });
      setBasari(r.mesaj);
      await yukle();
      return true;
    } catch (e) {
      setHata(e instanceof Error ? e.message : "İşlem tamamlanamadı");
      return false;
    } finally { setIslem(""); }
  }

  async function yedekIste(e: FormEvent) {
    e.preventDefault();
    if (await calistir("yeni", "/platform/yedekler", { neden: neden.trim(), totpKodu: kod.trim() })) { setFormAcik(false); setNeden(""); setKod(""); }
  }

  const servis = v?.ozet.servis ?? null;
  const toplamSayfa = v ? Math.max(1, Math.ceil(v.toplam / v.sayfaBoyu)) : 1;
  const servisYok = v && (!servis || !servis.canli);

  return <>
    <PageHeader
      title="Yedekler"
      subtitle="Veritabanı ve dosyalar her gece 04:00'te yedeklenir. Yedekler sunucudadır; canlıya geri yükleme belgeli komutla yapılır, bu ekrandan yapılmaz."
      actions={<div className="row-tight">
        <Button disabled={yukleniyor} onClick={() => void yukle()}><RefreshCw size={15} aria-hidden="true" /> Yenile</Button>
        <Button variant="primary" disabled={aktif || !servis?.canli} onClick={() => { setHata(""); setBasari(""); setFormAcik(true); }}><DatabaseBackup size={15} aria-hidden="true" /> Şimdi yedekle</Button>
      </div>}
    />
    {listeHatasi && <Alert tone="error">{listeHatasi}</Alert>}
    <Alert tone="error">{hata}</Alert>
    {basari && <Alert tone="success">{basari}</Alert>}
    {servisYok && <Alert tone="warning">Yedek servisi yanıt vermiyor. Yedek alınamaz; sunucudaki `yedekleme` servisini kontrol edin.</Alert>}

    {v && <div className="stack">
      <StatGrid>
        <Stat label="Son başarılı yedek" value={zaman(v.ozet.sonBasariliAt)} hint={boyut(v.ozet.sonBoyutBayt)} tone={v.ozet.sonBasariliAt ? undefined : "danger"} />
        <Stat label="Sonraki otomatik yedek" value={zaman(v.ozet.sonrakiOtomatikAt)} />
        <Stat label="Boş disk" value={boyut(servis?.diskBosBayt ?? null)} hint={servis ? `Toplam ${boyut(servis.diskToplamBayt)}` : undefined} />
        <Stat label="Yedek servisi" value={servis?.canli ? "Çalışıyor" : "Yanıt yok"} hint={servis ? `Son nabız: ${zaman(servis.sonNabizAt)}` : undefined} tone={servis?.canli ? "success" : "danger"} />
      </StatGrid>

      <Card pad={false} title="Yedek geçmişi">
        <TableWrap>
          <thead><tr><th>Talep</th><th>Tür</th><th>Durum</th><th>Süre</th><th className="num">Boyut</th><th>Geri yükleme denemesi</th><th>İşlem</th></tr></thead>
          <tbody>
            {v.satirlar.map((y) => (
              <tr key={y.id}>
                <td>{zaman(y.talepAt)}</td>
                <td>
                  {y.tur === "elle" ? "Elle" : "Otomatik"}
                  {y.neden && <div className="cell-entity__meta">{y.neden}{y.baslatan ? ` · ${y.baslatan}` : ""}</div>}
                </td>
                <td>
                  <Badge variant={DURUM[y.durum].ton}>{DURUM[y.durum].ad}</Badge>
                  {y.korunuyor && <> <Badge variant="accent">Korunuyor</Badge></>}
                  {y.silinecek && y.durum === "basarili" && <> <Badge variant="neutral">Silinecek</Badge></>}
                  {y.hata && <div className="cell-entity__meta">{y.hata}</div>}
                </td>
                <td>{sure(y.baslangicAt, y.bitisAt)}</td>
                <td className="num">{boyut(y.boyutBayt)}</td>
                <td>
                  {y.denemeDurum ? <Badge variant={DENEME[y.denemeDurum].ton}>{DENEME[y.denemeDurum].ad}</Badge> : "—"}
                  {y.denemeDetay && <div className="cell-entity__meta">{zaman(y.denemeAt)} · {y.denemeDetay}</div>}
                </td>
                <td>
                  {y.durum === "basarili" && <div className="row-tight">
                    <Button size="sm" disabled={Boolean(islem)} onClick={() => void calistir(`k${y.id}`, `/platform/yedekler/${y.id}/koru`, { korunuyor: !y.korunuyor })}>{y.korunuyor ? "Korumayı kaldır" : "Koru"}</Button>
                    <Button size="sm" disabled={Boolean(islem) || y.denemeDurum === "bekliyor" || y.denemeDurum === "calisiyor" || y.silinecek} onClick={() => void calistir(`d${y.id}`, `/platform/yedekler/${y.id}/geri-yukleme-denemesi`)}>Dene</Button>
                  </div>}
                </td>
              </tr>
            ))}
            {!v.satirlar.length && <tr><td colSpan={7} className="muted">Henüz yedek yok.</td></tr>}
          </tbody>
        </TableWrap>
      </Card>
      {toplamSayfa > 1 && <div className="row-tight" style={{ justifyContent: "flex-end", alignItems: "center" }}>
        <Button size="sm" disabled={sayfa <= 1} onClick={() => setSayfa((s) => s - 1)}>Önceki</Button>
        <span className="muted">{sayfa} / {toplamSayfa}</span>
        <Button size="sm" disabled={sayfa >= toplamSayfa} onClick={() => setSayfa((s) => s + 1)}>Sonraki</Button>
      </div>}
    </div>}

    {formAcik && (
      <Modal baslik="Şimdi yedekle" aciklama="Veritabanı ve dosyalar yedeklenir; sunucu bu sırada yavaşlayabilir. İşlem denetim kaydına yazılır." onKapat={() => setFormAcik(false)}>
        <form className="stack" onSubmit={(e) => void yedekIste(e)}>
          <Alert tone="error">{hata}</Alert>
          <Field label="Neden" htmlFor="yedek-neden">
            <Input id="yedek-neden" required minLength={5} maxLength={500} placeholder="Örn. yayın öncesi yedek" value={neden} onChange={(e) => setNeden(e.target.value)} />
          </Field>
          <Field label="İki adımlı doğrulama kodu" htmlFor="yedek-kod">
            <Input id="yedek-kod" required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={kod} onChange={(e) => setKod(e.target.value)} />
          </Field>
          <ModalEylem onVazgec={() => setFormAcik(false)} isleniyor={islem === "yeni"} metin="Yedeklemeyi başlat" />
        </form>
      </Modal>
    )}
  </>;
}
