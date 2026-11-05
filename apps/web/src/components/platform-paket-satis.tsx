"use client";
import { useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Badge, Button, Card, Field, Select, TableWrap } from "@/components/ui";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { platformApi, PlatformApiHata } from "@/lib/platform-api";
import type { PaketSatisDurumu, PaketSurumu } from "@/lib/platform-paketler";
import { PlatformPaketFiyati } from "./platform-paket-fiyati";
import { PlatformPaketKapsami } from "./platform-paket-kapsami";

export function PlatformPaketSatis({ paketId, surumler }: { paketId: string; surumler: PaketSurumu[] }) {
  const alanId = useId(), kilit = useRef(false), p = useSearchParams();
  const n = Number(p.get("satisSayfa") ?? 1), sayfa = Number.isInteger(n) && n > 0 && n <= 100000 ? n : 1;
  const { veri, hata, yenile } = usePlatformVerisi<PaketSatisDurumu>(`/platform/paketler/${paketId}/satis?sayfa=${sayfa}`);
  const [secili, setSecili] = useState(""), [neden, setNeden] = useState(""), [onay, setOnay] = useState<{ acik: boolean; surum: PaketSurumu | null; kilitSurumu: number } | null>(null);
  const [mesgul, setMesgul] = useState(false), [islemHatasi, setIslemHatasi] = useState(""), [basari, setBasari] = useState("");
  function sayfala(n: number) {
    const q = new URLSearchParams(p.toString()); if (n === 1) q.delete("satisSayfa"); else q.set("satisSayfa", String(n));
    window.history.replaceState(null, "", `?${q}`);
  }
  async function uygula() {
    if (!onay || kilit.current) return;
    kilit.current = true; setMesgul(true); setIslemHatasi(""); setBasari("");
    try {
      await platformApi(`/platform/paketler/${paketId}/satis`, { method: "POST", body: JSON.stringify({ acik: onay.acik, surumId: onay.surum?.id ?? null, surumKilitSurumu: onay.surum?.kilitSurumu ?? null, kilitSurumu: onay.kilitSurumu, neden }) });
      setBasari(onay.acik ? "Katalog satış seçimi kaydedildi." : "Katalog satışı durduruldu."); setOnay(null); setNeden(""); sayfala(1); yenile();
    } catch (e) {
      setIslemHatasi(e instanceof Error ? e.message : "Satış durumu kaydedilemedi.");
      if (e instanceof PlatformApiHata && [403, 404, 409].includes(e.durum)) { setOnay(null); yenile(); }
    } finally { kilit.current = false; setMesgul(false); }
  }
  const hedef = surumler.find((s) => s.id === secili);
  return <Card title="Katalog satış durumu">
    <p>Satış seçimi yayın sürümünden ayrıdır. Yeni bir sürümü yayınlamak bu seçimi değiştirmez; mevcut abonelik ve tahsilatlar etkilenmez.</p>
    <Alert tone="warning">Bu seçim açık satış paketlerini ve yeni firma kaydındaki paket listesini belirler. Mevcut aboneler ve tahsilatlar etkilenmez.</Alert>
    <Alert tone="error">{hata || islemHatasi}</Alert><Alert tone="success">{basari}</Alert>
    {typeof veri?.acik === "boolean" && <>
      <p><Badge variant={veri.acik ? "success" : "neutral"}>{veri.acik ? "Satışa açık olarak seçili" : "Satışa kapalı"}</Badge> · {veri.surum ? `Seçili sürüm ${veri.surum.surumNo} · ${veri.surum.ad}` : "Satış sürümü seçilmedi"}</p>
      {onay ? <section aria-label="Satış değişikliği onayı" className="stack">
        <h3>{onay.acik ? "Satış sürümü seçimini onayla" : "Satışı durdurmayı onayla"}</h3>
        {onay.surum && <><p>Sürüm {onay.surum.surumNo} · {onay.surum.ad}</p><PlatformPaketFiyati fiyat={onay.surum.fiyatlandirma} /><PlatformPaketKapsami kapsam={onay.surum.kapsamSozlesmesi} /></>}
        <p>Gerekçe: {neden}</p><p>Onay anında yetki, satış revizyonu ve hedef sürüm yeniden doğrulanır.</p>
        <div className="platform-row-actions"><Button disabled={mesgul} onClick={() => void uygula()}>Satış değişikliğini onayla</Button><Button disabled={mesgul} onClick={() => setOnay(null)}>Satış onayından vazgeç</Button></div>
      </section> : <div className="stack">
        <Field label="Satışa seçilecek sürüm" htmlFor={`${alanId}-surum`}><Select id={`${alanId}-surum`} value={secili} disabled={mesgul} onChange={(e) => setSecili(e.target.value)}><option value="">Bu sayfadaki yayınlardan seçin</option>{surumler.filter((s) => s.durum === "yayinlandi").map((s) => <option key={s.id} value={s.id}>Sürüm {s.surumNo} · {s.ad}</option>)}</Select></Field>
        <p className="subtle">Fiyat ve modül/kota sözleşmesi gerekir; fiyat geçerlilik tarihi gelmiş olmalı. Diğer sürümler için sürüm geçmişinde sayfa değiştirin.</p>
        <Field label="Satış değişikliği gerekçesi" htmlFor={`${alanId}-neden`}><textarea id={`${alanId}-neden`} className="input" minLength={5} maxLength={1000} value={neden} disabled={mesgul} onChange={(e) => setNeden(e.target.value)} /></Field>
        <div className="platform-row-actions"><Button disabled={mesgul || !hedef || neden.trim().length < 5} onClick={() => { if (hedef) { setOnay({ acik: true, surum: hedef, kilitSurumu: veri.kilitSurumu }); setIslemHatasi(""); setBasari(""); } }}>Satış seçimini incele</Button><Button disabled={mesgul || !veri.acik || neden.trim().length < 5} onClick={() => { setOnay({ acik: false, surum: null, kilitSurumu: veri.kilitSurumu }); setIslemHatasi(""); setBasari(""); }}>Satışı durdurmayı incele</Button><Button disabled={mesgul} onClick={yenile}>Satış durumunu yenile</Button></div>
      </div>}
      <section aria-label="Satış değişikliği geçmişi"><h3>Satış değişikliği geçmişi</h3>
        <TableWrap><thead><tr><th>Revizyon / zaman</th><th>Yönetici</th><th>Değişiklik</th><th>Gerekçe</th></tr></thead><tbody>{veri.kayitlar.map((k) => <tr key={k.id}><td>{k.kilitSurumu} · {new Date(k.createdAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</td><td>{k.kullanici.adSoyad}</td><td>{k.onceki.acik ? "Açık" : "Kapalı"} → {k.yeni.acik ? "Açık" : "Kapalı"}{k.yeni.surumNo && ` · Sürüm ${k.yeni.surumNo} · ${k.yeni.ad}`}</td><td>{k.neden}</td></tr>)}</tbody></TableWrap>
        {!veri.kayitlar.length && <p>Bu sayfada satış değişikliği yok.</p>}
        <div className="platform-pagination"><span>{veri.toplam} satış değişikliği · Sayfa {sayfa} / {Math.max(1, Math.ceil(veri.toplam / 25))}</span><div className="platform-row-actions"><Button disabled={mesgul || !!onay || sayfa <= 1} onClick={() => sayfala(sayfa - 1)}>Önceki satış geçmişi</Button><Button disabled={mesgul || !!onay || sayfa * 25 >= veri.toplam} onClick={() => sayfala(sayfa + 1)}>Sonraki satış geçmişi</Button>{sayfa > 1 && !veri.kayitlar.length && <Button disabled={mesgul || !!onay} onClick={() => sayfala(1)}>Satış geçmişinin ilk sayfasına dön</Button>}</div></div>
      </section>
    </>}
  </Card>;
}
