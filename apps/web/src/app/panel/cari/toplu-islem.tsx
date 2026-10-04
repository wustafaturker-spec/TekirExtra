"use client";

import { useEffect, useState } from "react";
import { api, apiDosyaIndir, ApiHata } from "@/lib/api";
import { Alert, Button, Field, Input, Select } from "@/components/ui";

/** Sunucudaki cari-toplu.ts ile aynı sınırlar ve işaret. */
const EPOSTA_EN_FAZLA = 100;
const ACIK_BAKIYE_ISARETI = "yine de pasife almak için onaylayın";

type Eylem = "etiket" | "grup" | "durum" | "kara_liste" | "temsilci" | "ekstre";
interface TopluSonuc { islenen: number; atlananlar: { cariId: string; kod: string; unvan: string; mesaj: string }[] }

const EYLEMLER: [Eylem, string][] = [
  ["etiket", "🏷️ Etiket"],
  ["grup", "🏢 Grup"],
  ["durum", "⏸️ Pasif / aktif"],
  ["kara_liste", "🚫 Kara liste"],
  ["temsilci", "👤 Temsilci"],
  ["ekstre", "✉️ Ekstre e-postası"],
];

/**
 * CARI-40 (P2-2): cari listesinde seçilenlere toplu işlem. Seçim sayfalar
 * arası korunur; "süzgece uyan tümü" sunucudan kimlikleri alır. İşlem bitince
 * sonuç (işlenen + atlananlar nedenleriyle) gösterilir ve liste tazelenir.
 */
export function CariTopluIslem({
  secili,
  setSecili,
  gorunenIdler,
  listeParametreleri,
  dahaFazlaVar,
  etiketler,
  gruplar,
  onTamam,
}: {
  secili: Set<string>;
  setSecili: (s: Set<string>) => void;
  gorunenIdler: string[];
  /** Listenin süzgeç sorgusu (imleçsiz). */
  listeParametreleri: string;
  /** Listede yüklenmemiş sayfa var mı ("süzgecin tümü" bağlantısı yalnız o zaman anlamlı). */
  dahaFazlaVar: boolean;
  etiketler: { id: string; ad: string }[];
  /** CARI-41 */
  gruplar: { id: string; ad: string }[];
  onTamam: () => void;
}) {
  const [eylem, setEylem] = useState<Eylem | null>(null);
  const [islemde, setIslemde] = useState(false);
  const [hata, setHata] = useState("");
  const [sonuc, setSonuc] = useState<{ baslik: string; veri: TopluSonuc } | null>(null);
  const [etiketId, setEtiketId] = useState("");
  const [grupId, setGrupId] = useState("");
  const [karaListeNotu, setKaraListeNotu] = useState("");
  const [temsilciler, setTemsilciler] = useState<{ id: string; adSoyad: string }[] | null>(null);
  const [temsilciId, setTemsilciId] = useState("");
  const [baslangic, setBaslangic] = useState("");
  const [bitis, setBitis] = useState("");
  const [ekstreTuru, setEkstreTuru] = useState<"standart" | "ayrintili">("standart");
  const [mutabakat, setMutabakat] = useState(false);

  useEffect(() => {
    if (eylem !== "temsilci" || temsilciler) return;
    api<{ id: string; adSoyad: string }[]>("/cari/toplu/temsilciler").then(setTemsilciler).catch((h) => setHata(h instanceof Error ? h.message : "Kullanıcılar yüklenemedi"));
  }, [eylem, temsilciler]);

  const adet = secili.size;
  const sayfadakilerSecili = gorunenIdler.length > 0 && gorunenIdler.every((id) => secili.has(id));

  async function suzgecinTumu() {
    setHata("");
    try {
      const veri = await api<{ kimlikler: string[]; kesildi: boolean }>(`/cari/toplu/kimlikler${listeParametreleri ? `?${listeParametreleri}` : ""}`);
      setSecili(new Set(veri.kimlikler));
      if (veri.kesildi) setHata(`Süzgece uyan cari sayısı sınırı aşıyor; ilk ${veri.kimlikler.length} cari seçildi.`);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Cariler seçilemedi");
    }
  }

  async function calistir(baslik: string, yol: string, govde: Record<string, unknown>) {
    setIslemde(true); setHata(""); setSonuc(null);
    const istek = (ek: Record<string, unknown> = {}) => api<TopluSonuc>(yol, { method: "POST", body: JSON.stringify({ cariIdler: [...secili], ...govde, ...ek }) });
    try {
      let veri: TopluSonuc;
      try {
        veri = await istek();
      } catch (h) {
        // Açık bakiyeli cari pasife alınırken sunucu onay ister.
        if (!(h instanceof ApiHata) || h.durum !== 409 || !h.message.includes(ACIK_BAKIYE_ISARETI)) throw h;
        if (!window.confirm(`${h.message.replace(`; ${ACIK_BAKIYE_ISARETI}`, "")}.\n\nPasif cari yeni belgede kullanılamaz; açık bakiye ekstrede kalır. Yine de pasife alınsın mı?`)) return;
        veri = await istek({ acikBakiyeOnayi: true });
      }
      setSonuc({ baslik, veri });
      setEylem(null);
      setSecili(new Set(veri.atlananlar.map((a) => a.cariId).filter((id) => secili.has(id))));
      onTamam();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem yapılamadı");
    } finally {
      setIslemde(false);
    }
  }

  async function excel() {
    setIslemde(true); setHata("");
    try {
      await apiDosyaIndir("/cari/toplu/excel", `cariler-${new Date().toISOString().slice(0, 10)}.xlsx`, { method: "POST", body: JSON.stringify({ cariIdler: [...secili] }) });
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Excel indirilemedi");
    } finally {
      setIslemde(false);
    }
  }

  const onayla = (metin: string) => window.confirm(`${adet} cari için ${metin}. Devam edilsin mi?`);

  return (
    <div className="cari-toplu" role="region" aria-label="Toplu işlemler">
      <div className="cari-toplu__bas">
        <label className="check-row">
          <input
            type="checkbox"
            aria-label="Sayfadakilerin tümünü seç"
            checked={sayfadakilerSecili}
            disabled={gorunenIdler.length === 0}
            onChange={(e) => {
              const yeni = new Set(secili);
              for (const id of gorunenIdler) { if (e.target.checked) yeni.add(id); else yeni.delete(id); }
              setSecili(yeni);
            }}
          />
          {adet ? <strong>{adet} cari seçili</strong> : <span className="subtle">Toplu işlem için cari seçin</span>}
        </label>
        {dahaFazlaVar && sayfadakilerSecili && <button type="button" className="btn-link" onClick={() => void suzgecinTumu()}>Süzgece uyan tüm carileri seç</button>}
        {adet > 0 && <button type="button" className="btn-link" onClick={() => { setSecili(new Set()); setEylem(null); }}>Seçimi temizle</button>}
        {adet > 0 && (
          <div className="cari-toplu__eylemler">
            {EYLEMLER.map(([deger, ad]) => (
              <Button key={deger} size="sm" variant={eylem === deger ? "primary" : "ghost"} aria-pressed={eylem === deger} onClick={() => setEylem(eylem === deger ? null : deger)}>{ad}</Button>
            ))}
            <Button size="sm" disabled={islemde} onClick={() => void excel()}>📊 Excel</Button>
          </div>
        )}
      </div>

      <Alert tone="error">{hata}</Alert>
      {sonuc && (
        <Alert tone={sonuc.veri.atlananlar.length ? "warning" : "success"}>
          {sonuc.baslik}: {sonuc.veri.islenen} cari işlendi{sonuc.veri.atlananlar.length ? `, ${sonuc.veri.atlananlar.length} cari atlandı (seçili bırakıldı)` : ""}.
          {sonuc.veri.atlananlar.map((a) => <div key={a.cariId}>• {a.kod} {a.unvan}: {a.mesaj}</div>)}
        </Alert>
      )}

      {adet > 0 && eylem === "etiket" && (
        <div className="cari-toplu__form">
          <Field label="Etiket">
            <Select value={etiketId} onChange={(e) => setEtiketId(e.target.value)}>
              <option value="">Seçin</option>
              {etiketler.map((e) => <option key={e.id} value={e.id}>{e.ad}</option>)}
            </Select>
          </Field>
          {etiketler.length === 0 && <span className="subtle">Önce bir cari kartından etiket oluşturun.</span>}
          <Button size="sm" variant="primary" disabled={!etiketId || islemde} onClick={() => void calistir("Etiket eklendi", "/cari/toplu/etiket", { etiketId, islem: "ekle" })}>Ekle</Button>
          <Button size="sm" disabled={!etiketId || islemde} onClick={() => { if (onayla("etiket kaldırılacak")) void calistir("Etiket kaldırıldı", "/cari/toplu/etiket", { etiketId, islem: "kaldir" }); }}>Kaldır</Button>
        </div>
      )}

      {adet > 0 && eylem === "grup" && (
        <div className="cari-toplu__form">
          <Field label="Cari grubu">
            <Select value={grupId} onChange={(e) => setGrupId(e.target.value)}>
              <option value="">Gruptan çıkar</option>
              {gruplar.map((g) => <option key={g.id} value={g.id}>{g.ad}</option>)}
            </Select>
          </Field>
          {gruplar.length === 0 && <span className="subtle">Grup tanımı <a className="btn-link" href="/panel/cari/gruplar">Cari Grupları</a> sayfasında.</span>}
          <Button size="sm" variant="primary" disabled={islemde} onClick={() => { if (onayla(grupId ? "grup atanacak (önceki grupları değişir)" : "grup bağı kaldırılacak")) void calistir(grupId ? "Gruba atandı" : "Gruptan çıkarıldı", "/cari/toplu/grup", { grupId: grupId || null }); }}>Uygula</Button>
        </div>
      )}

      {adet > 0 && eylem === "durum" && (
        <div className="cari-toplu__form">
          <span className="subtle">Pasif cari yeni belgede kullanılamaz; mevcut belgeler ve bakiye etkilenmez.</span>
          <Button size="sm" variant="primary" disabled={islemde} onClick={() => { if (onayla("pasife alma yapılacak")) void calistir("Pasife alındı", "/cari/toplu/durum", { aktif: false }); }}>Pasife al</Button>
          <Button size="sm" disabled={islemde} onClick={() => void calistir("Aktif edildi", "/cari/toplu/durum", { aktif: true })}>Aktif et</Button>
        </div>
      )}

      {adet > 0 && eylem === "kara_liste" && (
        <div className="cari-toplu__form">
          <Field label="Kara liste notu (isteğe bağlı; boşsa kartlardaki not korunur)">
            <Input value={karaListeNotu} maxLength={500} onChange={(e) => setKaraListeNotu(e.target.value)} placeholder="Örn. Karşılıksız çek — tahsilat bekleniyor" />
          </Field>
          <Button size="sm" variant="primary" disabled={islemde} onClick={() => { if (onayla("kara liste işareti konacak; bu carilere hiçbir belge kesilemez")) void calistir("Kara listeye alındı", "/cari/toplu/kara-liste", { karaListe: true, not: karaListeNotu || null }); }}>Kara listeye al</Button>
          <Button size="sm" disabled={islemde} onClick={() => { if (onayla("kara liste işareti ve notu kaldırılacak")) void calistir("Kara listeden çıkarıldı", "/cari/toplu/kara-liste", { karaListe: false }); }}>Kara listeden çıkar</Button>
        </div>
      )}

      {adet > 0 && eylem === "temsilci" && (
        <div className="cari-toplu__form">
          <Field label="Müşteri temsilcisi">
            <Select value={temsilciId} onChange={(e) => setTemsilciId(e.target.value)}>
              <option value="">Temsilciyi kaldır</option>
              {temsilciler?.map((k) => <option key={k.id} value={k.id}>{k.adSoyad}</option>)}
            </Select>
          </Field>
          <Button size="sm" variant="primary" disabled={islemde || !temsilciler} onClick={() => { if (onayla(temsilciId ? "temsilci atanacak" : "temsilci kaldırılacak")) void calistir(temsilciId ? "Temsilci atandı" : "Temsilci kaldırıldı", "/cari/toplu/temsilci", { temsilciUserId: temsilciId || null }); }}>Uygula</Button>
        </div>
      )}

      {adet > 0 && eylem === "ekstre" && (
        <div className="cari-toplu__form">
          <Field label="Başlangıç"><Input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} /></Field>
          <Field label="Bitiş"><Input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} /></Field>
          <Field label="Ekstre türü">
            <Select value={ekstreTuru} onChange={(e) => setEkstreTuru(e.target.value as "standart" | "ayrintili")}>
              <option value="standart">Standart</option>
              <option value="ayrintili">Ayrıntılı (fatura kalemleriyle)</option>
            </Select>
          </Field>
          <label className="check-row"><input type="checkbox" checked={mutabakat} onChange={(e) => setMutabakat(e.target.checked)} /> PDF&apos;e mutabakat metni ekle</label>
          <span className="subtle">Her cariye kendi ekstresi (PDF + Excel) kart e-postasına gider; e-postası olmayan ve kara listedeki cari atlanır.{adet > EPOSTA_EN_FAZLA ? ` Tek seferde en çok ${EPOSTA_EN_FAZLA} cariye gönderilir.` : ""}</span>
          <Button
            size="sm"
            variant="primary"
            disabled={islemde || adet > EPOSTA_EN_FAZLA}
            onClick={() => { if (onayla("ekstre e-postası gönderilecek")) void calistir("Ekstre gönderildi", "/cari/toplu/ekstre-eposta", { baslangic: baslangic || undefined, bitis: bitis || undefined, tur: ekstreTuru, mutabakat }); }}
          >
            {islemde ? "Gönderiliyor…" : "Gönder"}
          </Button>
        </div>
      )}
    </div>
  );
}
