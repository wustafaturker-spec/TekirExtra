"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiHata } from "@/lib/api";
import { bugunTR } from "@tekirextra/shared";
import { Alert, Badge, Button, Card, Field, Input, Modal, ModalEylem, PageHeader, Para, SearchInput, Select, Stat, StatGrid, Table } from "@/components/ui";

interface Personel {
  id: string;
  personelNo: string;
  ad: string;
  soyad: string;
  departman?: string;
  unvan?: string;
  netMaas: string;
  brutMaas?: string | null;
  engellilikDerecesi?: number | null;
  sgkTesvikOrani?: string;
  calismaTipi: string;
  aktif: boolean;
  durum: "taslak" | "aktif" | "askida" | "uzun_sureli_izin" | "isten_ayrildi";
  cari?: {
    id: string;
    kod: string;
  };
}

type TahakkukSonucu = { arkaPlan?: false; olusturulanSayi: number; toplamAktifPersonel: number; mevcutSayi: number; hatalar: { personel: string; mesaj: string }[] };

const DURUM: Record<Personel["durum"], [string, "neutral" | "success" | "warning" | "info"]> = {
  taslak: ["Taslak", "neutral"],
  aktif: ["Aktif", "success"],
  askida: ["Askıda", "warning"],
  uzun_sureli_izin: ["Uzun süreli izin", "info"],
  isten_ayrildi: ["İşten ayrıldı", "neutral"],
};
const CALISMA_TIPI: Record<string, string> = { tam_zamanli: "Tam zamanlı", yari_zamanli: "Yarı zamanlı", sozlesmeli: "Sözleşmeli" };
const KISAYOLLAR = [
  ["/panel/personel/bordrolar", "BR", "Bordrolar", "Tahakkuk, onay ve ödeme"],
  ["/panel/personel/bordrolar/calisma-gunleri", "PG", "Puantaj", "Gün ve değişken kazançlar"],
  ["/panel/personel/izinler", "İZ", "İzinler", "Talep ve bakiyeler"],
  ["/panel/personel/avanslar", "AV", "Avanslar", "Talep, ödeme ve mahsup"],
  ["/panel/personel/bilgi-talepleri", "BT", "Bilgi talepleri", "Self-servis güncellemeleri"],
  ["/panel/personel/organizasyon", "OR", "Organizasyon", "İşyeri ve ekip yapısı"],
  ["/panel/personel/mevzuat", "MV", "Mevzuat", "Sürümler ve kabul testleri"],
  ["/panel/personel/raporlar", "RP", "Raporlar", "Maliyet ve iş gücü analizi"],
] as const;
const BOS_FORM = { ad: "", soyad: "", departman: "", unvan: "", netMaas: 30000, brutMaas: 0, engellilikDerecesi: "", sgkTesvikOrani: 0, calismaTipi: "tam_zamanli", girisTarihi: bugunTR(), cariOlustur: true };

/** Personel sicili ve İK çalışma alanlarına giriş. */
export default function PersonelSayfasi() {
  const router = useRouter();
  const [personeller, setPersoneller] = useState<Personel[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [arama, setArama] = useState("");
  /** PRS-14: durum/departman süzgeci ve 50'şer sayfalama (sunucuda, aksansız arama). */
  const [durumSuzgeci, setDurumSuzgeci] = useState("");
  const [departmanSuzgeci, setDepartmanSuzgeci] = useState("");
  const [departmanlar, setDepartmanlar] = useState<{ id: string; ad: string }[]>([]);
  const [sonrakiImlec, setSonrakiImlec] = useState<string | null>(null);
  const [toplam, setToplam] = useState(0);
  const [hata, setHata] = useState<string | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [modalAcik, setModalAcik] = useState(false);
  const [form, setForm] = useState(BOS_FORM);
  const [tahakkukModalAcik, setTahakkukModalAcik] = useState(false);
  /** PRS-20: tahakkuk sonucu ya da arka plan işinin ilerlemesi. */
  const [tahakkukDurum, setTahakkukDurum] = useState<string | null>(null);
  const [donem, setDonem] = useState({ donemYil: new Date().getFullYear(), donemAy: new Date().getMonth() + 1 });

  const fetchPersonel = useCallback(async (imlec?: string) => {
    try {
      setHata(null);
      const q = new URLSearchParams({ adet: "50", ...(arama ? { arama } : {}), ...(durumSuzgeci ? { durum: durumSuzgeci } : {}), ...(departmanSuzgeci ? { departmanId: departmanSuzgeci } : {}), ...(imlec ? { imlec } : {}) });
      const data = await api<{ kayitlar: Personel[]; sonrakiImlec: string | null; toplam: number }>(`/personel?${q.toString()}`);
      setPersoneller((eski) => (imlec ? [...eski, ...data.kayitlar] : data.kayitlar));
      setSonrakiImlec(data.sonrakiImlec); setToplam(data.toplam);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Personel listesi alınamadı");
    } finally {
      setYukleniyor(false);
    }
  }, [arama, durumSuzgeci, departmanSuzgeci]);

  useEffect(() => {
    const zamanlayici = window.setTimeout(() => { void fetchPersonel(); }, 350);
    return () => window.clearTimeout(zamanlayici);
  }, [fetchPersonel]);

  useEffect(() => {
    api<{ departmanlar: { id: string; ad: string }[] }[]>("/personel/organizasyon").then((agac) => setDepartmanlar(agac.flatMap((i) => i.departmanlar))).catch(() => undefined);
  }, []);

  const personelEkle = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setKaydediliyor(true); setHata(null);
      await api<Personel>("/personel", {
        method: "POST",
        body: JSON.stringify({ ...form, brutMaas: form.brutMaas > 0 ? form.brutMaas : undefined, engellilikDerecesi: form.engellilikDerecesi ? Number(form.engellilikDerecesi) : undefined }),
      });
      setModalAcik(false);
      setForm({ ...BOS_FORM, girisTarihi: bugunTR() });
      await fetchPersonel();
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "Personel kaydedilemedi");
    } finally {
      setKaydediliyor(false);
    }
  };

  const topluBordroOlustur = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setKaydediliyor(true); setHata(null); setTahakkukDurum(null);
      const ilk = await api<TahakkukSonucu | { arkaPlan: true; isId: string; toplamAktifPersonel: number }>("/personel/bordrolar/tahakkuk", { method: "POST", body: JSON.stringify(donem) });
      let sonuc: TahakkukSonucu;
      if (ilk.arkaPlan) {
        // Büyük kadro: worker'da çalışır, ilerleme izlenir.
        setTahakkukDurum(`${ilk.toplamAktifPersonel} kişilik tahakkuk arka planda başladı…`);
        for (;;) {
          await new Promise((r) => setTimeout(r, 2000));
          const d = await api<{ durum: string; ilerleme: { yapilan: number; toplam: number } | null; sonuc: TahakkukSonucu | null; hata: string | null }>(`/personel/bordrolar/tahakkuk-isleri/${encodeURIComponent(ilk.isId)}`);
          if (d.durum === "failed") throw new Error(d.hata ?? "Tahakkuk işi başarısız oldu");
          if (d.durum === "completed" && d.sonuc) { sonuc = d.sonuc; break; }
          setTahakkukDurum(d.ilerleme ? `Tahakkuk sürüyor: ${d.ilerleme.yapilan} / ${d.ilerleme.toplam} personel` : "Tahakkuk sırada bekliyor…");
        }
      } else sonuc = ilk;
      setTahakkukDurum(`${sonuc.olusturulanSayi} bordro oluşturuldu${sonuc.mevcutSayi ? `, ${sonuc.mevcutSayi} kişinin bordrosu zaten vardı` : ""}.${sonuc.hatalar.length ? ` Oluşturulamayan ${sonuc.hatalar.length}: ${sonuc.hatalar.map((h) => `${h.personel} (${h.mesaj})`).join("; ")}` : ""}`);
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : e instanceof Error ? e.message : "Bordro tahakkuku oluşturulamadı");
    } finally {
      setKaydediliyor(false);
    }
  };

  const aktifSayisi = personeller.filter((p) => p.durum === "aktif").length;
  const brutUcretliSayisi = personeller.filter((p) => Number(p.brutMaas ?? 0) > 0).length;
  const toplamNet = personeller.reduce((t, p) => t + Number(p.netMaas), 0);
  const ac = (id: string) => router.push(`/panel/personel/${id}`);

  return (
    <div className="stack">
      <PageHeader
        title="Personel ve İK"
        subtitle="Personel yaşam döngüsünü, dönem çalışmalarını ve bordro operasyonlarını tek çalışma alanından yönetin."
        actions={<>
          <Button onClick={() => setTahakkukModalAcik(true)}>Aylık tahakkuk</Button>
          <Button variant="primary" onClick={() => setModalAcik(true)}>+ Yeni personel</Button>
        </>}
      />
      <Alert tone="error">{hata}</Alert>

      <StatGrid>
        <Stat label="Toplam personel" value={toplam || personeller.length} hint="Kayıtlı özlük kartı" />
        <Stat label="Aktif çalışan" value={aktifSayisi} hint="Listelenen güncel kadro" tone="accent" />
        <Stat label="Brüt bordro kapsamı" value={brutUcretliSayisi} hint="Mevzuat motoruyla hesaplanan" />
        <Stat label="Aylık net ücret yükü" value={<Para deger={toplamNet} basamak={0} />} hint="Listelenen personel toplamı" />
      </StatGrid>

      <nav aria-label="İK çalışma alanları" className="action-grid action-grid--wrap">
        {KISAYOLLAR.map(([href, ikon, baslik, aciklama]) => (
          <Link key={href} className="action-tile" href={href}>
            <span aria-hidden="true" className="action-tile__icon">{ikon}</span>
            <span className="action-tile__body"><strong>{baslik}</strong><small>{aciklama}</small></span>
          </Link>
        ))}
      </nav>

      <Card pad={false}>
        <div className="toolbar" style={{ padding: "1rem 1.1rem", display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
          <div className="card__title" style={{ margin: 0, marginRight: "auto" }}>Çalışanlar</div>
          <SearchInput aria-label="Personel ara" placeholder="Ad, soyad veya departman ara…" value={arama} onChange={(e) => setArama(e.target.value)} style={{ minWidth: "16rem" }} />
          <Select aria-label="Durum" value={durumSuzgeci} onChange={(e) => setDurumSuzgeci(e.target.value)} style={{ width: "auto" }}>
            <option value="">Tüm durumlar</option><option value="calisan">Çalışanlar</option><option value="aktif">Aktif</option><option value="askida">Askıda</option><option value="uzun_sureli_izin">Uzun süreli izin</option><option value="isten_ayrildi">İşten ayrılanlar</option>
          </Select>
          {departmanlar.length > 0 && (
            <Select aria-label="Departman" value={departmanSuzgeci} onChange={(e) => setDepartmanSuzgeci(e.target.value)} style={{ width: "auto" }}>
              <option value="">Tüm departmanlar</option>{departmanlar.map((d) => <option key={d.id} value={d.id}>{d.ad}</option>)}
            </Select>
          )}
        </div>
        <Table>
          <thead><tr><th>Ad soyad</th><th>Personel no</th><th>Departman / unvan</th><th>Çalışma tipi</th><th className="num">Ücret</th><th>Cari hesap</th><th>Durum</th></tr></thead>
          <tbody>
            {personeller.map((p) => (
              <tr key={p.id} className="row-link" tabIndex={0} onClick={() => ac(p.id)} onKeyDown={(e) => { if (e.key === "Enter") ac(p.id); }}>
                <td><Link href={`/panel/personel/${p.id}`} onClick={(e) => e.stopPropagation()}><strong>{p.ad} {p.soyad}</strong></Link></td>
                <td className="mono subtle">{p.personelNo}</td>
                <td>{p.departman || "—"} / {p.unvan || "—"}</td>
                <td><Badge variant="info">{CALISMA_TIPI[p.calismaTipi] ?? p.calismaTipi}</Badge></td>
                <td className="num"><strong><Para deger={p.brutMaas ?? p.netMaas} /></strong> <small className="muted">{p.brutMaas ? "brüt" : "net"}</small></td>
                <td className="mono subtle">{p.cari ? p.cari.kod : "—"}</td>
                <td>{DURUM[p.durum] ? <Badge variant={DURUM[p.durum][1]}>{DURUM[p.durum][0]}</Badge> : <Badge>{p.aktif ? "Aktif" : "Pasif"}</Badge>}</td>
              </tr>
            ))}
            {!personeller.length && <tr><td className="muted" colSpan={7}>{yukleniyor ? "Yükleniyor…" : arama || durumSuzgeci || departmanSuzgeci ? "Süzgece uyan personel yok." : "Henüz personel kaydı bulunmuyor."}</td></tr>}
          </tbody>
        </Table>
        {!yukleniyor && personeller.length > 0 && (
          <div className="between" style={{ padding: "0.75rem 1.1rem" }}>
            <small className="muted">{personeller.length} / {toplam} personel</small>
            {sonrakiImlec && <Button size="sm" onClick={() => void fetchPersonel(sonrakiImlec)}>Daha fazla yükle</Button>}
          </div>
        )}
      </Card>

      {modalAcik && (
        <Modal genis baslik="Yeni personel ekle" aciklama="Temel kimlik, çalışma ve ücret bilgilerini tanımlayın." onKapat={() => setModalAcik(false)}>
          <form className="stack" onSubmit={personelEkle}>
            <fieldset className="form-section">
              <legend>Kimlik bilgileri</legend>
              <div className="form-grid form-grid--2">
                <Field label="Ad *"><Input required autoFocus autoComplete="given-name" placeholder="Örn. Ayşe" value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} /></Field>
                <Field label="Soyad *"><Input required autoComplete="family-name" placeholder="Örn. Yılmaz" value={form.soyad} onChange={(e) => setForm({ ...form, soyad: e.target.value })} /></Field>
              </div>
            </fieldset>
            <fieldset className="form-section">
              <legend>Çalışma bilgileri</legend>
              <div className="form-grid form-grid--2">
                <Field label="Departman"><Input placeholder="Örn. Satış" value={form.departman} onChange={(e) => setForm({ ...form, departman: e.target.value })} /></Field>
                <Field label="Unvan"><Input placeholder="Örn. Satış Uzmanı" value={form.unvan} onChange={(e) => setForm({ ...form, unvan: e.target.value })} /></Field>
                <Field label="Çalışma tipi"><Select value={form.calismaTipi} onChange={(e) => setForm({ ...form, calismaTipi: e.target.value })}><option value="tam_zamanli">Tam zamanlı</option><option value="yari_zamanli">Yarı zamanlı</option><option value="sozlesmeli">Sözleşmeli</option></Select></Field>
                <Field label="İşe giriş tarihi *"><Input required type="date" value={form.girisTarihi} onChange={(e) => setForm({ ...form, girisTarihi: e.target.value })} /></Field>
              </div>
            </fieldset>
            <fieldset className="form-section">
              <legend>Ücret ve mevzuat</legend>
              <div className="form-grid form-grid--2">
                <Field label="Net maaş (₺) *"><Input required type="number" min="0" step="0.01" value={form.netMaas} onChange={(e) => setForm({ ...form, netMaas: Number(e.target.value) })} /></Field>
                <Field label="Brüt maaş (₺)"><Input type="number" min="0" step="0.01" value={form.brutMaas} onChange={(e) => setForm({ ...form, brutMaas: Number(e.target.value) })} /><small className="muted">0 bırakılırsa net ücret modeli kullanılır.</small></Field>
                <Field label="Engellilik indirimi"><Select value={form.engellilikDerecesi} onChange={(e) => setForm({ ...form, engellilikDerecesi: e.target.value })}><option value="">Uygulanmayacak</option><option value="1">1. derece</option><option value="2">2. derece</option><option value="3">3. derece</option></Select><small className="muted">Doğrulanmış vergi indirimi yazısına göre seçin.</small></Field>
                <Field label="SGK teşvik oranı (%)"><Input type="number" min="0" max="100" step="0.001" value={form.sgkTesvikOrani} onChange={(e) => setForm({ ...form, sgkTesvikOrani: Number(e.target.value) })} /><small className="muted">Mevzuat setindeki azami oran uygulanır.</small></Field>
              </div>
            </fieldset>
            <label className="check"><input type="checkbox" checked={form.cariOlustur} onChange={(e) => setForm({ ...form, cariOlustur: e.target.checked })} /><span>Otomatik cari hesap kartı oluştur <small className="muted">(maaş ödemelerinin takibi için önerilir)</small></span></label>
            <div className="between">
              <small className="muted">* Zorunlu alanlar</small>
              <ModalEylem onVazgec={() => setModalAcik(false)} isleniyor={kaydediliyor} metin="Personeli kaydet" />
            </div>
          </form>
        </Modal>
      )}

      {tahakkukModalAcik && (
        <Modal baslik="Aylık bordro tahakkuku" aciklama="Dönemde çalışan tüm personel için o aya ait bordro kaydı üretilir." onKapat={() => { setTahakkukModalAcik(false); setTahakkukDurum(null); }}>
          <form className="stack" onSubmit={topluBordroOlustur}>
            <Alert tone="warning">{tahakkukDurum}</Alert>
            <div className="form-grid form-grid--2">
              <Field label="Yıl"><Input type="number" value={donem.donemYil} onChange={(e) => setDonem({ ...donem, donemYil: Number(e.target.value) })} /></Field>
              <Field label="Ay"><Input type="number" min="1" max="12" value={donem.donemAy} onChange={(e) => setDonem({ ...donem, donemAy: Number(e.target.value) })} /></Field>
            </div>
            <div className="row-tight" style={{ justifyContent: "flex-end" }}>
              <Button type="button" onClick={() => { setTahakkukModalAcik(false); setTahakkukDurum(null); }}>Kapat</Button>
              <Button type="submit" variant="primary" disabled={kaydediliyor}>{kaydediliyor ? "Oluşturuluyor…" : "Tahakkuk et"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
