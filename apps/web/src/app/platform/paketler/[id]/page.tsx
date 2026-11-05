"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Alert, Badge, Button, Card, PageHeader, TableWrap } from "@/components/ui";
import { PlatformPaketFormu } from "@/components/platform-paket-formu";
import { PlatformPaketKapsami } from "@/components/platform-paket-kapsami";
import { PlatformPaketFiyati } from "@/components/platform-paket-fiyati";
import { PlatformPaketSatis } from "@/components/platform-paket-satis";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { platformApi } from "@/lib/platform-api";
import { KATALOG_KAPSAMI, PAKET_DURUMU, type PaketDetayi, type PaketIcerigi, type PaketSurumu } from "@/lib/platform-paketler";

function Paket() {
  const { id } = useParams<{ id: string }>(), p = useSearchParams();
  const n = Number(p.get("sayfa") ?? 1), sayfa = Number.isInteger(n) && n > 0 && n <= 100000 ? n : 1;
  const hamDonus = p.get("donus") ?? "", donus = hamDonus === "/platform/paketler" || hamDonus.startsWith("/platform/paketler?") ? hamDonus : "/platform/paketler";
  const { veri, hata, yukleniyor, yenile } = usePlatformVerisi<PaketDetayi>(`/platform/paketler/${id}?sayfa=${sayfa}`);
  const [edit, setEdit] = useState<PaketSurumu | null>(null), [onay, setOnay] = useState<{ surum: PaketSurumu; tur: "yayinla" | "arsivle" } | null>(null);
  const [mesgul, setMesgul] = useState(false), [islemHatasi, setIslemHatasi] = useState(""), [basari, setBasari] = useState("");
  function sayfala(n: number) {
    const q = new URLSearchParams(p.toString()); if (n === 1) q.delete("sayfa"); else q.set("sayfa", String(n));
    window.history.replaceState(null, "", `/platform/paketler/${id}${q.size ? `?${q}` : ""}`);
  }
  async function uygula(yol: string, govde: unknown, method = "POST") {
    if (mesgul) return;
    setMesgul(true); setIslemHatasi(""); setBasari("");
    try {
      await platformApi(yol, { method, body: JSON.stringify(govde) });
      setEdit(null); setOnay(null); setBasari("Paket kataloğu kaydedildi."); sayfala(1); yenile();
    } catch (e) { setIslemHatasi(e instanceof Error ? e.message : "İşlem tamamlanamadı."); }
    finally { setMesgul(false); }
  }
  async function kaydet(g: PaketIcerigi) {
    if (!edit) return;
    await uygula(`/platform/paketler/${id}/surumler/${edit.id}`, { ad: g.ad, aciklama: g.aciklama, ozellikler: g.ozellikler, siralama: g.siralama, fiyatlandirma: g.fiyatlandirma, kapsamSozlesmesi: g.kapsamSozlesmesi, denemeGunSayisi: g.denemeGunSayisi, kilitSurumu: edit.kilitSurumu }, "PATCH");
  }
  const limitAdi: Record<string, string> = { kullanici: "Kullanıcı", cari: "Cari", stok: "Stok", aylikFatura: "Aylık fatura" };
  return <div className="stack">
    <PageHeader title={veri ? `${veri.paket.kod} · Paket sürümleri` : "Paket sürümleri"} subtitle="Yayınlanmış içerik değiştirilemez; yeni içerik için bu sürümden taslak açın." actions={<Button disabled={mesgul} onClick={yenile}>Kaydı yenile</Button>} />
    <Link href={donus}>Paket listesine dön</Link><p className="subtle">{KATALOG_KAPSAMI}</p>
    <Alert tone="error">{hata || islemHatasi}</Alert><Alert tone="success">{basari}</Alert>
    {yukleniyor && <p role="status">Paket yükleniyor…</p>}
    {hata && <Button onClick={yenile}>Tekrar dene</Button>}
    {edit && <Card title={`Sürüm ${edit.surumNo} taslağını düzenle`}><p className="subtle">Kaydetme başarısız olursa alanlarınız korunur. Çakışmada Kaydı yenile ile güncel sürümü inceleyin. Güncel sürümle yeniden başlamak için düzenlemeyi kapatıp taslağı tekrar açın.</p><PlatformPaketFormu key={`${edit.id}:${edit.kilitSurumu}`} ilk={edit} mesgul={mesgul} onKaydet={kaydet} onVazgec={() => { setEdit(null); setIslemHatasi(""); }} /></Card>}
    {veri && <>
      <PlatformPaketSatis paketId={id} surumler={veri.surumler} />
      <Card title="Eski plan referans koşulları">{veri.mevcutKosullar ? <><p>Eski sistemdeki {veri.mevcutKosullar.planKodu} paketinin referans koşulları. Firmaya atanan fiyatlar fiyat etkisi raporunda görülür. Bu referans bölümü salt okunurdur. Eski v1 kayıtları Profesyonel paketine karşılık gelir.</p><p>Aylık KDV hariç fiyat: {veri.mevcutKosullar.aylikFiyat === null ? "Teklif ile" : `${veri.mevcutKosullar.aylikFiyat.toLocaleString("tr-TR")} TRY`} · KDV %{veri.mevcutKosullar.kdvOrani}</p><TableWrap><thead><tr><th>Limit</th><th>Değer</th></tr></thead><tbody>{Object.entries(veri.mevcutKosullar.limitler).map(([k, v]) => <tr key={k}><td>{limitAdi[k] ?? k}</td><td>{v === null ? "Sınırsız" : v.toLocaleString("tr-TR")}</td></tr>)}</tbody></TableWrap></> : <p>Bu yeni katalog paketinin kota, satış ve abonelik bağlantıları henüz tamamlanmadı. Sürüm fiyatı tanımlanabilir; müşteri aboneliğine atanamaz.</p>}</Card>

      {onay && <Card title={onay.tur === "yayinla" ? "Katalog yayınını onayla" : "Sürümü arşivlemeyi onayla"}><p>Sürüm {onay.surum.surumNo}: <strong>{onay.surum.ad}</strong></p><p>{onay.surum.aciklama}</p><ul>{onay.surum.ozellikler.map((o, i) => <li key={i}>{o}</li>)}</ul><PlatformPaketFiyati fiyat={onay.surum.fiyatlandirma} /><PlatformPaketKapsami kapsam={onay.surum.kapsamSozlesmesi} /><p>Yeni firma deneme süresi: {onay.surum.denemeGunSayisi ?? 0} gün</p><p>Katalog sırası: {onay.surum.siralama}. {onay.tur === "yayinla" ? "Bu içerik yayınlandıktan sonra yerinde değiştirilemez." : "Arşivde içerik ve geçmiş korunur."} Mevcut abonelikler ve tahsilatlar etkilenmez.</p><div className="platform-row-actions"><Button disabled={mesgul} onClick={() => void uygula(`/platform/paketler/${id}/surumler/${onay.surum.id}/${onay.tur}`, { kilitSurumu: onay.surum.kilitSurumu })}>{onay.tur === "yayinla" ? "Yayını onayla" : "Arşivlemeyi onayla"}</Button><Button disabled={mesgul} onClick={() => { setOnay(null); setIslemHatasi(""); }}>Vazgeç</Button></div></Card>}
      {veri.surumler.some((s) => s.durum === "yayinlandi" && s.fiyatlandirma) && <Card title="Mevcut abonelere fiyat etkisi"><p>Yayınlanmış sürümü mevcut kayıtlı koşullarla karşılaştırın.</p><ul>{veri.surumler.filter((s) => s.durum === "yayinlandi" && s.fiyatlandirma).map((s) => <li key={s.id}><Link href={`/platform/paketler/fiyat-etkisi?surumId=${s.id}`}>Sürüm {s.surumNo} · Fiyat etkisini incele</Link></li>)}</ul></Card>}
      {veri.taslakVar && !veri.surumler.some((s) => s.durum === "taslak") && <p>Açık taslak ilk sayfadadır. <Button disabled={!!edit || !!onay || mesgul} onClick={() => sayfala(1)}>İlk sayfaya dön</Button></p>}
      <section aria-label="Paket sürüm geçmişi" className="stack"><h2>Sürüm geçmişi</h2>{veri.surumler.map((s) => <Card key={s.id} title={<span>Sürüm {s.surumNo} · {s.ad} <Badge variant={s.durum === "yayinlandi" ? "success" : "neutral"}>{PAKET_DURUMU[s.durum]}</Badge></span>}><p>{s.aciklama || "Açıklama girilmedi."}</p><ul>{s.ozellikler.map((o, i) => <li key={i}>{o}</li>)}</ul><PlatformPaketFiyati fiyat={s.fiyatlandirma} /><PlatformPaketKapsami kapsam={s.kapsamSozlesmesi} /><p>Yeni firma deneme süresi: {s.denemeGunSayisi ?? 0} gün</p><p className="subtle">Katalog sırası: {s.siralama} · Kayıt: {new Date(s.createdAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}{s.yayinlandiAt && ` · Yayın: ${new Date(s.yayinlandiAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`}{s.arsivlendiAt && ` · Arşiv: ${new Date(s.arsivlendiAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`}</p><div className="platform-row-actions">{s.durum === "taslak" ? <><Button disabled={mesgul || !!edit || !!onay} onClick={() => { setEdit(s); setIslemHatasi(""); setBasari(""); }}>Taslağı düzenle</Button><Button disabled={mesgul || !!edit || !!onay} onClick={() => { setOnay({ surum: s, tur: "yayinla" }); setIslemHatasi(""); setBasari(""); }}>Katalogda yayınla</Button></> : <><Button disabled={mesgul || veri.taslakVar || !!edit || !!onay} onClick={() => void uygula(`/platform/paketler/${id}/taslak`, { kaynakSurumId: s.id })}>Bu sürümden taslak aç</Button>{s.durum === "yayinlandi" && <Button disabled={mesgul || !!edit || !!onay} onClick={() => { setOnay({ surum: s, tur: "arsivle" }); setIslemHatasi(""); setBasari(""); }}>Sürümü arşivle</Button>}</>}</div></Card>)}</section>
      {!veri.surumler.length && <p>Bu sayfada sürüm yok.</p>}
      <div className="platform-pagination"><span>{veri.toplam} sürüm · Sayfa {sayfa} / {Math.max(1, Math.ceil(veri.toplam / 25))}</span><div className="platform-row-actions"><Button disabled={mesgul || !!edit || !!onay || sayfa <= 1} onClick={() => sayfala(sayfa - 1)}>Önceki</Button><Button disabled={mesgul || !!edit || !!onay || sayfa * 25 >= veri.toplam} onClick={() => sayfala(sayfa + 1)}>Sonraki</Button>{sayfa > 1 && !veri.surumler.length && <Button disabled={mesgul || !!edit || !!onay} onClick={() => sayfala(1)}>İlk sayfaya dön</Button>}</div></div>
    </>}
  </div>;
}
export default function PaketDetaySayfasi() { return <Suspense fallback={<p role="status">Paket yükleniyor…</p>}><Paket /></Suspense>; }
