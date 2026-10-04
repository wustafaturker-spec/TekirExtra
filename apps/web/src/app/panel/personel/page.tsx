"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, ApiHata } from "@/lib/api";
import Link from "next/link";
import { bugunTR } from "@tekirextra/shared";

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

export default function PersonelSayfasi() {
  const [personeller, setPersoneller] = useState<Personel[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [arama, setArama] = useState("");
  /** PRS-14: durum/departman süzgeci ve 50'şer sayfalama (sunucuda, aksansız arama). */
  const [durumSuzgeci, setDurumSuzgeci] = useState("");
  const [departmanSuzgeci, setDepartmanSuzgeci] = useState("");
  const [departmanlar, setDepartmanlar] = useState<{ id: string; ad: string }[]>([]);
  const [sonrakiImlec, setSonrakiImlec] = useState<string | null>(null);
  const [toplam, setToplam] = useState(0);
  const router = useRouter();
  const [hata, setHata] = useState<string | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const [modalAcik, setModalAcik] = useState(false);
  const [form, setForm] = useState({
    ad: "",
    soyad: "",
    departman: "",
    unvan: "",
    netMaas: 30000,
    brutMaas: 0,
    engellilikDerecesi: "",
    sgkTesvikOrani: 0,
    calismaTipi: "tam_zamanli",
    girisTarihi: bugunTR(),
    cariOlustur: true,
  });

  const [tahakkukModalAcik, setTahakkukModalAcik] = useState(false);
  /** PRS-20: tahakkuk sonucu ya da arka plan işinin ilerlemesi. */
  const [tahakkukDurum, setTahakkukDurum] = useState<string | null>(null);
  const [donem, setDonem] = useState({
    donemYil: new Date().getFullYear(),
    donemAy: new Date().getMonth() + 1,
  });

  const durumEtiketi: Record<Personel["durum"], string> = {
    taslak: "Taslak",
    aktif: "Aktif",
    askida: "Askıda",
    uzun_sureli_izin: "Uzun süreli izin",
    isten_ayrildi: "İşten ayrıldı",
  };

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
      setKaydediliyor(true);
      setHata(null);
      await api<Personel>("/personel", {
        method: "POST",
        body: JSON.stringify({ ...form, brutMaas: form.brutMaas > 0 ? form.brutMaas : undefined, engellilikDerecesi: form.engellilikDerecesi ? Number(form.engellilikDerecesi) : undefined }),
      });
      setModalAcik(false);
      setForm({
        ad: "", soyad: "", departman: "", unvan: "", netMaas: 30000, brutMaas: 0, engellilikDerecesi: "", sgkTesvikOrani: 0,
        calismaTipi: "tam_zamanli", girisTarihi: bugunTR(), cariOlustur: true,
      });
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
      setKaydediliyor(true);
      setHata(null);
      setTahakkukDurum(null);
      const ilk = await api<TahakkukSonucu | { arkaPlan: true; isId: string; toplamAktifPersonel: number }>("/personel/bordrolar/tahakkuk", {
        method: "POST",
        body: JSON.stringify(donem),
      });
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
      setHata(e instanceof ApiHata ? e.message : "Bordro tahakkuku oluşturulamadı");
    } finally {
      setKaydediliyor(false);
    }
  };

  const aktifSayisi = personeller.filter((p) => p.durum === "aktif").length;
  const brutUcretliSayisi = personeller.filter((p) => Number(p.brutMaas ?? 0) > 0).length;
  const toplamNet = personeller.reduce((toplam, p) => toplam + Number(p.netMaas), 0);

  return (
    <div className="hr-page hr-subpage">
      <header className="hr-hero">
        <div className="hr-hero__copy">
          <span>İNSAN KAYNAKLARI</span>
          <h1>Ekibin, bordron ve iş gücü görünümün</h1>
          <p>Personel yaşam döngüsünü, dönem çalışmalarını ve bordro operasyonlarını tek çalışma alanından yönet.</p>
        </div>
        <div className="hr-hero__actions">
          <button onClick={() => setTahakkukModalAcik(true)} className="hr-button hr-button--glass">Aylık tahakkuk</button>
          <button onClick={() => setModalAcik(true)} className="hr-button hr-button--light">+ Yeni personel</button>
        </div>
      </header>

      <section className="hr-kpis" aria-label="Personel özeti">
        <article><span>Toplam personel</span><strong>{personeller.length}</strong><small>Kayıtlı özlük kartı</small></article>
        <article><span>Aktif çalışan</span><strong>{aktifSayisi}</strong><small>Güncel kadro</small></article>
        <article><span>Brüt bordro kapsamı</span><strong>{brutUcretliSayisi}</strong><small>Mevzuat motoruyla hesaplanan</small></article>
        <article><span>Aylık net ücret yükü</span><strong>{toplamNet.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} ₺</strong><small>Listelenen personel toplamı</small></article>
      </section>

      <nav className="hr-shortcuts" aria-label="İK çalışma alanları">
        <Link href="/panel/personel/bordrolar"><b>BR</b><span><strong>Bordrolar</strong><small>Tahakkuk, onay ve ödeme</small></span></Link>
        <Link href="/panel/personel/bordrolar/calisma-gunleri"><b>PG</b><span><strong>Puantaj</strong><small>Gün ve değişken kazançlar</small></span></Link>
        <Link href="/panel/personel/izinler"><b>İZ</b><span><strong>İzinler</strong><small>Talep ve bakiyeler</small></span></Link>
        <Link href="/panel/personel/organizasyon"><b>OR</b><span><strong>Organizasyon</strong><small>İşyeri ve ekip yapısı</small></span></Link>
        <Link href="/panel/personel/mevzuat"><b>MV</b><span><strong>Mevzuat</strong><small>Sürümler ve kabul testleri</small></span></Link>
        <Link href="/panel/personel/raporlar"><b>RP</b><span><strong>Raporlar</strong><small>Maliyet ve iş gücü analizi</small></span></Link>
      </nav>

      <section className="hr-register">
        <div className="hr-register__toolbar">
          <div><span>PERSONEL SİCİLİ</span><h2>Çalışanlar</h2></div>
        <input
          type="text"
          placeholder="Personel adı, soyadı veya departman ara..."
          value={arama}
          onChange={(e) => setArama(e.target.value)}
          className="hr-search"
        />
        <select aria-label="Durum" value={durumSuzgeci} onChange={(e) => setDurumSuzgeci(e.target.value)} className="hr-search hr-search--secim">
          <option value="">Tüm durumlar</option><option value="calisan">Çalışanlar</option><option value="aktif">Aktif</option><option value="askida">Askıda</option><option value="uzun_sureli_izin">Uzun süreli izin</option><option value="isten_ayrildi">İşten ayrılanlar</option>
        </select>
        {departmanlar.length > 0 && <select aria-label="Departman" value={departmanSuzgeci} onChange={(e) => setDepartmanSuzgeci(e.target.value)} className="hr-search hr-search--secim">
          <option value="">Tüm departmanlar</option>{departmanlar.map((d) => <option key={d.id} value={d.id}>{d.ad}</option>)}
        </select>}
        </div>

      {hata && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {hata}
        </div>
      )}

      {/* Personel Tablosu */}
      <div className="hr-table-wrap">
        {yukleniyor ? (
          <div className="p-8 text-center text-slate-500">Yükleniyor...</div>
        ) : personeller.length === 0 ? (
          <div className="p-8 text-center text-slate-500">{arama || durumSuzgeci || departmanSuzgeci ? "Süzgece uyan personel yok." : "Henüz personel kaydı bulunmuyor."}</div>
        ) : (
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 border-b font-semibold text-slate-600">
              <tr>
                <th className="p-4">Ad Soyad</th>
                <th className="p-4">Personel No</th>
                <th className="p-4">Departman / Unvan</th>
                <th className="p-4">Çalışma Tipi</th>
                <th className="p-4">Ücret</th>
                <th className="p-4">Cari Hesap</th>
                <th className="p-4 text-right">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {personeller.map((p) => (
                <tr key={p.id} className="hr-satir-link hover:bg-slate-50 transition" tabIndex={0} onClick={() => router.push(`/panel/personel/${p.id}`)} onKeyDown={(e) => { if (e.key === "Enter") router.push(`/panel/personel/${p.id}`); }}>
                  <td className="p-4 font-medium text-slate-900">
                    <Link href={`/panel/personel/${p.id}`} className="hover:text-orange-700 hover:underline">
                      {p.ad} {p.soyad}
                    </Link>
                  </td>
                  <td className="p-4 font-mono text-xs text-slate-500">{p.personelNo}</td>
                  <td className="p-4">{p.departman || "-"} / {p.unvan || "-"}</td>
                  <td className="p-4">
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                      {p.calismaTipi === "tam_zamanli" ? "Tam Zamanlı" : p.calismaTipi === "yari_zamanli" ? "Yarı Zamanlı" : "Sözleşmeli"}
                    </span>
                  </td>
                  <td className="p-4 font-semibold text-slate-900">{Number(p.brutMaas ?? p.netMaas).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺ <small className="font-normal text-slate-500">{p.brutMaas ? "brüt" : "net"}</small></td>
                  <td className="p-4 text-xs font-mono text-slate-500">{p.cari ? p.cari.kod : "-"}</td>
                  <td className="p-4 text-right">
                    <span className={`px-2 py-0.5 rounded text-xs ${p.aktif ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>
                      {durumEtiketi[p.durum] ?? (p.aktif ? "Aktif" : "Pasif")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!yukleniyor && personeller.length > 0 && <div className="hr-liste-alt"><span>{personeller.length} / {toplam} personel</span>{sonrakiImlec && <button type="button" onClick={() => void fetchPersonel(sonrakiImlec)} className="hr-button">Daha fazla yükle</button>}</div>}
      </div>
      </section>

      {/* Personel Ekleme Modal */}
      {modalAcik && (
        <div className="hr-person-modal__backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setModalAcik(false); }}>
          <section className="hr-person-modal" role="dialog" aria-modal="true" aria-labelledby="yeni-personel-baslik">
            <header className="hr-person-modal__header">
              <div className="hr-person-modal__mark">YP</div>
              <div>
                <span>ÖZLÜK KARTI</span>
                <h2 id="yeni-personel-baslik">Yeni personel ekle</h2>
                <p>Temel kimlik, çalışma ve ücret bilgilerini tanımlayın.</p>
              </div>
              <button type="button" onClick={() => setModalAcik(false)} aria-label="Pencereyi kapat">×</button>
            </header>
            <form onSubmit={personelEkle} className="hr-person-form">
              <fieldset>
                <legend><b>01</b><span><strong>Kimlik bilgileri</strong><small>Personelin görünen temel bilgileri</small></span></legend>
                <div className="hr-person-form__grid">
                <div className="field">
                  <label>Ad <em>*</em></label>
                  <input
                    required
                    type="text"
                    autoFocus
                    autoComplete="given-name"
                    placeholder="Örn. Ayşe"
                    value={form.ad}
                    onChange={(e) => setForm({ ...form, ad: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Soyad <em>*</em></label>
                  <input
                    required
                    type="text"
                    autoComplete="family-name"
                    placeholder="Örn. Yılmaz"
                    value={form.soyad}
                    onChange={(e) => setForm({ ...form, soyad: e.target.value })}
                  />
                </div>
              </div>
              </fieldset>

              <fieldset>
                <legend><b>02</b><span><strong>Çalışma bilgileri</strong><small>Organizasyon ve işe giriş tanımı</small></span></legend>
                <div className="hr-person-form__grid">
                <div className="field">
                  <label>Departman</label>
                  <input
                    type="text"
                    placeholder="Örn. Satış"
                    value={form.departman}
                    onChange={(e) => setForm({ ...form, departman: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Unvan</label>
                  <input
                    type="text"
                    placeholder="Örn. Satış Uzmanı"
                    value={form.unvan}
                    onChange={(e) => setForm({ ...form, unvan: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Çalışma tipi</label>
                  <select value={form.calismaTipi} onChange={(e) => setForm({ ...form, calismaTipi: e.target.value })}>
                    <option value="tam_zamanli">Tam zamanlı</option>
                    <option value="yari_zamanli">Yarı zamanlı</option>
                    <option value="sozlesmeli">Sözleşmeli</option>
                  </select>
                </div>
                <div className="field">
                  <label>İşe giriş tarihi <em>*</em></label>
                  <input required type="date" value={form.girisTarihi} onChange={(e) => setForm({ ...form, girisTarihi: e.target.value })} />
                </div>
              </div>
              </fieldset>

              <fieldset>
                <legend><b>03</b><span><strong>Ücret ve mevzuat</strong><small>Bordro hesaplamasında kullanılacak değerler</small></span></legend>
                <div className="hr-person-form__grid">
              <div className="field">
                <label>Net maaş <em>*</em></label>
                <div className="hr-money-field">
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.netMaas}
                  onChange={(e) => setForm({ ...form, netMaas: Number(e.target.value) })}
                />
                <span>₺</span>
                </div>
              </div>
              <div className="field">
                <label>Brüt maaş</label>
                <div className="hr-money-field">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.brutMaas}
                  onChange={(e) => setForm({ ...form, brutMaas: Number(e.target.value) })}
                />
                <span>₺</span>
                </div>
                <small>0 bırakılırsa net ücret modeli kullanılır.</small>
              </div>
              <div className="field">
                <label>Engellilik indirimi</label>
                <select value={form.engellilikDerecesi} onChange={(e) => setForm({ ...form, engellilikDerecesi: e.target.value })}>
                  <option value="">Uygulanmayacak</option><option value="1">1. derece</option><option value="2">2. derece</option><option value="3">3. derece</option>
                </select>
                <small>Doğrulanmış vergi indirimi yazısına göre seçin.</small>
              </div>
              <div className="field">
                <label>SGK teşvik oranı</label>
                <div className="hr-money-field">
                <input type="number" min="0" max="100" step="0.001" value={form.sgkTesvikOrani} onChange={(e) => setForm({ ...form, sgkTesvikOrani: Number(e.target.value) })} />
                <span>%</span>
                </div>
                <small>Mevzuat setindeki azami oran uygulanır.</small>
              </div>
              </div>
              </fieldset>

              <label className="hr-person-form__toggle">
                <input
                  type="checkbox"
                  checked={form.cariOlustur}
                  onChange={(e) => setForm({ ...form, cariOlustur: e.target.checked })}
                />
                <span><strong>Otomatik cari hesap kartı oluştur</strong><small>Maaş ödemelerinin takibi için önerilir.</small></span>
              </label>

              <footer>
                <p><b>*</b> Zorunlu alanlar</p>
                <div>
                <button
                  type="button"
                  onClick={() => setModalAcik(false)}
                  className="hr-person-form__cancel"
                >
                  İptal
                </button>
                <button disabled={kaydediliyor} type="submit" className="hr-person-form__submit">
                  {kaydediliyor ? "Kaydediliyor…" : "Personeli kaydet →"}
                </button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      )}

      {/* Bordro Tahakkuk Modal */}
      {tahakkukModalAcik && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl space-y-4">
            <h2 className="text-xl font-bold text-slate-800">Aylık Bordro Tahakkuku Oluştur</h2>
            <p className="text-xs text-slate-500">Tüm aktif personel için belirtilen döneme ait maaş bordrosu kaydı üretilecektir.</p>
            {tahakkukDurum && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{tahakkukDurum}</div>}
            <form onSubmit={topluBordroOlustur} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Yıl</label>
                  <input
                    type="number"
                    value={donem.donemYil}
                    onChange={(e) => setDonem({ ...donem, donemYil: Number(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ay</label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={donem.donemAy}
                    onChange={(e) => setDonem({ ...donem, donemAy: Number(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setTahakkukModalAcik(false); setTahakkukDurum(null); }}
                  className="px-4 py-2 text-slate-600 border rounded-lg text-sm hover:bg-slate-50"
                >
                  Kapat
                </button>
                <button disabled={kaydediliyor} type="submit" className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {kaydediliyor ? "Oluşturuluyor…" : "Tahakkuk Ettir"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
