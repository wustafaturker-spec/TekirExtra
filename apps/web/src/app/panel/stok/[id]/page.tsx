"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import { useDepolar } from "@/lib/depolar";
import { DepoSecici } from "@/components/depo-secici";
import { BirimSecimi } from "@/components/birim-secimi";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  EylemCubugu,
  EylemMenusu,
  Field,
  Input,
  PageHeader,
  Select,
  Stat,
  StatGrid,
  TabPanel,
  Tabs,
  TableWrap,
} from "@/components/ui";
import { BELGE_DILI_ADLARI, YABANCI_ACIKLAMA_UZUNLUGU, YABANCI_AD_UZUNLUGU, YABANCI_BELGE_DILLERI, yabanciAdlarNormalize, type YabanciAdlar, birimKisaAdi, bugunTR, olcuAilesi, olcuKatsayisi, SARJ_TURLERI, SARJ_TURU_ADLARI, varyantKombinasyonlari } from "@tekirextra/shared";
import { DovizSecenekleri } from "@/components/doviz-secenekleri";
import { KdvOraniSecimi, useKodTablosu } from "@/components/kdv-orani-secimi";

/* ─── Tipler ─────────────────────────────────────────────────────────────── */

interface Kategori {
  id: string;
  ad: string;
  ust: { id: string; ad: string } | null;
}

function ReceteSekmesi({ stokId, anaBirim, recete, stoklar, isMerkezleri, varyantlar, kapsam, ozelVaryantlar, onKapsamDegis, onKaydedildi, onSilindi, onHata }: { stokId: string; anaBirim: string; recete: Recete | null; stoklar: StokOzet[]; isMerkezleri: IsMerkezi[]; varyantlar: Varyant[]; kapsam: string; ozelVaryantlar: OzelReceteliVaryant[]; onKapsamDegis: (varyantId: string) => void; onKaydedildi: () => Promise<void>; onSilindi: () => Promise<void>; onHata: (mesaj: string) => void }) {
  const [ciktiMiktari, setCiktiMiktari] = useState("1");
  const [aciklama, setAciklama] = useState("");
  const [degisiklikNedeni, setDegisiklikNedeni] = useState("");
  const [yururlukBaslangic, setYururlukBaslangic] = useState("");
  const [kaliteKontrolGerekli, setKaliteKontrolGerekli] = useState(false);
  const [kalemler, setKalemler] = useState<{ malzemeStokId: string; malzemeVaryantId?: string; miktar: string; birim?: string; fireOrani: string }[]>([{ malzemeStokId: "", miktar: "1", fireOrani: "0" }]);
  const [operasyonlar, setOperasyonlar] = useState<{ isMerkeziId: string; operasyonKodu: string; operasyonAdi: string; hazirlikDakika: string; cevrimDakika: string }[]>([]);
  const [yanUrunYontemi, setYanUrunYontemi] = useState<YanUrunYontemi>("sifir");
  const [giderler, setGiderler] = useState<{ ad: string; yontem: GiderYontemi; deger: string }[]>([]);
  const [ciktilar, setCiktilar] = useState<{ stokId: string; varyantId?: string; tip: "yan_urun" | "ortak_urun"; miktar: string; birimMaliyet: string }[]>([]);
  /** Varyantlı malzeme/yan ürün satırında hangi renk/beden kullanıldığı seçilir (sarf ve giriş o varyantta olur). */
  const varyantlariAl = (id: string) => (stoklar.find((s) => s.id === id)?.varyantlar ?? []).filter((v) => v.aktif !== false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  /** Formu bir reçeteyle doldurur (kapsamın kendi reçetesi ya da kopyalanan genel reçete). */
  const formuDoldur = (recete: Recete | null) => {
    setCiktiMiktari(recete?.ciktiMiktari ?? "1"); setAciklama(recete?.aciklama ?? "");
    setKalemler(recete?.kalemler?.length ? recete.kalemler.map((k) => ({ malzemeStokId: k.malzemeStokId, malzemeVaryantId: k.malzemeVaryantId ?? undefined, miktar: k.girilenMiktar ?? k.miktar, birim: k.birim ?? undefined, fireOrani: k.fireOrani })) : [{ malzemeStokId: "", miktar: "1", fireOrani: "0" }]);
    setOperasyonlar(recete?.operasyonlar?.map((o) => ({ isMerkeziId: o.isMerkeziId, operasyonKodu: o.operasyonKodu, operasyonAdi: o.operasyonAdi, hazirlikDakika: o.hazirlikDakika, cevrimDakika: o.cevrimDakika })) ?? []);
    setGiderler(recete?.giderler?.map((g) => ({ ad: g.ad, yontem: g.yontem, deger: String(Number(g.deger)) })) ?? []);
    setKaliteKontrolGerekli(recete?.kaliteKontrolGerekli ?? false);
    setYanUrunYontemi(recete?.yanUrunMaliyetYontemi ?? "sifir");
    setCiktilar(recete?.ciktilar?.map((c) => ({ stokId: c.stokId, varyantId: c.varyantId ?? undefined, tip: c.tip, miktar: c.miktar, birimMaliyet: c.birimMaliyet ?? "0" })) ?? []);
  };
  useEffect(() => { formuDoldur(recete); }, [recete]);
  const kapsamVaryanti = varyantlar.find((v) => v.id === kapsam) ?? null;
  const kapsamSorgusu = kapsam ? `?varyantId=${kapsam}` : "";
  /** Varyanta özel reçeteye genel reçeteden başlanır; kaydedilince bu varyantın taslağı olur. */
  async function geneldenKopyala() {
    onHata("");
    try {
      const genel = await api<Recete | null>(`/uretim/receteler/${stokId}`);
      if (!genel?.id) { onHata("Kopyalanacak genel reçete yok"); return; }
      formuDoldur(genel);
    } catch (h) { onHata(h instanceof Error ? h.message : "Genel reçete okunamadı"); }
  }
  async function kaydet(event: React.FormEvent) {
    event.preventDefault(); onHata(""); setKaydediliyor(true);
    try {
      await api(`/uretim/receteler/${stokId}`, { method: "POST", body: JSON.stringify({ varyantId: kapsam || null, ciktiMiktari, aciklama: aciklama || null, degisiklikNedeni: degisiklikNedeni || null, yururlukBaslangic: yururlukBaslangic || null, kaliteKontrolGerekli, yanUrunMaliyetYontemi: yanUrunYontemi, giderler, kalemler: kalemler.map((k) => ({ ...k, malzemeVaryantId: k.malzemeVaryantId || null, birim: k.birim || null })), ciktilar: ciktilar.map((c) => ({ ...c, varyantId: c.varyantId || null, birimMaliyet: yanUrunYontemi === "sabit_deger" ? c.birimMaliyet : null })), operasyonlar }) });
      setDegisiklikNedeni("");
      await onKaydedildi();
    } catch (h) { onHata(h instanceof Error ? h.message : "Reçete kaydedilemedi"); }
    finally { setKaydediliyor(false); }
  }
  async function sil() {
    if (!window.confirm(kapsamVaryanti ? `${kapsamVaryanti.ad} varyantının özel reçetesi arşivlenecek; varyant bundan sonra genel reçeteyle üretilir. Devam edilsin mi?` : "Bu ürün reçetesi kaldırılacak. Devam edilsin mi?")) return;
    try { await api(`/uretim/receteler/${stokId}${kapsamSorgusu}`, { method: "DELETE" }); await onSilindi(); }
    catch (h) { onHata(h instanceof Error ? h.message : "Reçete kaldırılamadı"); }
  }
  async function onayla() {
    if (!recete || !window.confirm(`Reçete v${recete.surum} üretimde kullanılmak üzere etkinleştirilsin mi?`)) return;
    setKaydediliyor(true); onHata("");
    try { await api(`/uretim/receteler/${stokId}/surumler/${recete.id}/onayla`, { method: "POST" }); await onKaydedildi(); }
    catch (h) { onHata(h instanceof Error ? h.message : "Reçete onaylanamadı"); }
    finally { setKaydediliyor(false); }
  }
  /** Satırın seçebileceği birimler: ana birim, aynı ölçü ailesi (kg → g, mg) ve kartın ek birimleri. */
  const receteBirimleri = (malzeme: StokOzet | undefined) => malzeme ? [...new Set([...olcuAilesi(malzeme.anaBirim), ...(malzeme.birimler ?? []).map((b) => b.ad)])] : [];
  const anaBirimKatsayisi = (malzeme: StokOzet | undefined, birim: string | undefined) => {
    if (!malzeme || !birim || birim === malzeme.anaBirim) return 1;
    return Number(olcuKatsayisi(malzeme.anaBirim, birim) ?? malzeme.birimler?.find((b) => b.ad === birim)?.katsayi ?? 1);
  };
  const satirHesapla = (kalem: typeof kalemler[number]) => {
    const malzeme = stoklar.find((s) => s.id === kalem.malzemeStokId);
    // Maliyet ve fire ana birimde: 6,98 mg × 0,000001 = 0,00000698 kg.
    const net = (Number(kalem.miktar) || 0) * anaBirimKatsayisi(malzeme, kalem.birim);
    const brut = net * (1 + (Number(kalem.fireOrani) || 0) / 100);
    const birimMaliyet = Number(malzeme?.ortalamaMaliyet ?? 0);
    return { malzeme, brut, birimMaliyet, toplam: brut * birimMaliyet };
  };
  const toplamMaliyet = kalemler.reduce((toplam, kalem) => toplam + satirHesapla(kalem).toplam, 0);
  // Operasyon payı: (hazırlık + çevrim × çıktı) dk × saatlik (işçilik + makine + genel gider).
  const operasyonDakikasi = (o: typeof operasyonlar[number]) => (Number(o.hazirlikDakika) || 0) + (Number(o.cevrimDakika) || 0) * (Number(ciktiMiktari) || 0);
  const operasyonPayi = (alan: "saatlikMaliyet" | "iscilikSaatlik" | "makineSaatlik" | "genelGiderSaatlik") => operasyonlar.reduce((toplam, o) => toplam + operasyonDakikasi(o) * Number(isMerkezleri.find((m) => m.id === o.isMerkeziId)?.[alan] ?? 0) / 60, 0);
  const operasyonMaliyeti = operasyonPayi("saatlikMaliyet");
  // Ek giderler reçetenin bir çevrimi (çıktı miktarı) için: emirde emir başı gider bir kez sayılır.
  const giderTutari = (g: typeof giderler[number]) => { const d = Number(g.deger) || 0; return g.yontem === "malzeme_yuzdesi" ? toplamMaliyet * d / 100 : g.yontem === "birim_basi" ? d * (Number(ciktiMiktari) || 0) : d; };
  const ekGiderToplami = giderler.reduce((t, g) => t + giderTutari(g), 0);
  const birimMamulMaliyeti = (toplamMaliyet + operasyonMaliyeti + ekGiderToplami) / Math.max(Number(ciktiMiktari) || 1, 0.001);
  return <div className="recipe-workspace">
    <section className="recipe-hero">
      <div><span className="recipe-eyebrow">ÜRETİM TANIMI</span><h2>Ürün reçetesi</h2><p>Bir üretim çevriminde tüketilecek malzemeleri, fire paylarını ve tahmini maliyeti yönetin.</p></div>
      <div className="recipe-health"><span className={recete?.durum === "aktif" ? "is-ready" : ""} />{kapsamVaryanti ? `${kapsamVaryanti.ad} · ` : ""}{recete ? `v${recete.surum} · ${recete.durum === "aktif" ? "Aktif" : recete.durum === "taslak" ? "Taslak" : "Onay bekliyor"}` : "Henüz kaydedilmedi"}</div>
    </section>
    {varyantlar.length > 0 && <section className="recipe-setup">
      <div><h3>Reçete kapsamı</h3><p>Varyantlar farklı malzeme, miktar ya da operasyonla üretiliyorsa varyanta özel reçete tanımlayın. Özel reçetesi olmayan varyant genel reçeteyle üretilir.</p></div>
      <div className="recipe-setup__fields">
        <Field label="Kapsam"><Select value={kapsam} onChange={(e) => onKapsamDegis(e.target.value)}><option value="">Genel — tüm varyantlar</option>{varyantlar.filter((v) => v.aktif).map((v) => { const ozel = ozelVaryantlar.find((o) => o.varyantId === v.id); return <option key={v.id} value={v.id}>{v.ad} · {v.kod} — {ozel ? `özel reçete (v${ozel.surum}, ${({ aktif: "aktif", taslak: "taslak", onay_bekliyor: "onay bekliyor" } as Record<string, string>)[ozel.durum] ?? ozel.durum})` : "genel reçeteyle"}</option>; })}</Select></Field>
        {kapsam && !recete && <div className="row-tight"><span className="muted">Bu varyantın kendi reçetesi yok; şu an genel reçeteyle üretilir.</span><Button type="button" onClick={() => void geneldenKopyala()}>Genel reçeteden kopyala</Button></div>}
      </div>
    </section>}
    <form className="recipe-form" onSubmit={kaydet}>
      <section className="recipe-setup">
        <div><h3>Reçete bilgileri</h3><p>Hesaplamaların baz aldığı standart üretim çıktısı.</p></div>
        <div className="recipe-setup__fields"><Field label={`Çıktı miktarı (${anaBirim})`}><Input required type="number" min="0.001" step="0.001" value={ciktiMiktari} onChange={(e) => setCiktiMiktari(e.target.value)} /></Field><Field label="Üretim notu"><Input maxLength={500} value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Örn. standart üretim partisi" /></Field><Field label="Değişiklik nedeni"><Input maxLength={500} value={degisiklikNedeni} onChange={(e) => setDegisiklikNedeni(e.target.value)} placeholder="Yeni sürümün amacı" /></Field><Field label="Yürürlük başlangıcı"><Input type="date" value={yururlukBaslangic} onChange={(e) => setYururlukBaslangic(e.target.value)} /></Field><label className="check"><input type="checkbox" checked={kaliteKontrolGerekli} onChange={(e) => setKaliteKontrolGerekli(e.target.checked)} /><span>Üretim sonrası kalite kontrolü zorunlu</span></label></div>
      </section>
      <section className="recipe-materials"><div className="recipe-section-head"><div><h3>Operasyon rotası</h3><p>Hazırlık ve birim çevrim süreleri üretim emrinin kapasite planına kopyalanır.</p></div><Button type="button" disabled={!isMerkezleri.length} onClick={() => setOperasyonlar((eski) => [...eski, { isMerkeziId: isMerkezleri[0]?.id ?? "", operasyonKodu: `OP-${String(eski.length + 1).padStart(2, "0")}`, operasyonAdi: "", hazirlikDakika: "0", cevrimDakika: "0" }])}>+ Operasyon ekle</Button></div>
        <TableWrap><thead><tr><th>Sıra</th><th>İş merkezi</th><th>Kod</th><th>Operasyon</th><th className="num">Hazırlık dk</th><th className="num">Çevrim dk/birim</th><th /></tr></thead><tbody>{operasyonlar.map((o, index) => <tr key={index}><td>{index + 1}</td><td><Select required value={o.isMerkeziId} onChange={(e) => setOperasyonlar((eski) => eski.map((x, i) => i === index ? { ...x, isMerkeziId: e.target.value } : x))}>{isMerkezleri.map((m) => <option key={m.id} value={m.id}>{m.kod} — {m.ad}</option>)}</Select></td><td><Input required maxLength={30} value={o.operasyonKodu} onChange={(e) => setOperasyonlar((eski) => eski.map((x, i) => i === index ? { ...x, operasyonKodu: e.target.value } : x))} /></td><td><Input required maxLength={120} value={o.operasyonAdi} onChange={(e) => setOperasyonlar((eski) => eski.map((x, i) => i === index ? { ...x, operasyonAdi: e.target.value } : x))} /></td><td><Input required type="number" min="0" step="0.01" value={o.hazirlikDakika} onChange={(e) => setOperasyonlar((eski) => eski.map((x, i) => i === index ? { ...x, hazirlikDakika: e.target.value } : x))} /></td><td><Input required type="number" min="0" step="0.0001" value={o.cevrimDakika} onChange={(e) => setOperasyonlar((eski) => eski.map((x, i) => i === index ? { ...x, cevrimDakika: e.target.value } : x))} /></td><td><Button type="button" size="sm" variant="danger" onClick={() => setOperasyonlar((eski) => eski.filter((_, i) => i !== index))}>Sil</Button></td></tr>)}{!operasyonlar.length && <tr><td colSpan={7}>Operasyon rotası isteğe bağlıdır. Önce Üretim Planlama ekranından iş merkezi tanımlayın.</td></tr>}</tbody></TableWrap>
      </section>
      <section className="recipe-materials">
        <div className="recipe-section-head"><div><h3>Malzeme listesi</h3><p>Maliyetler stok kartlarındaki güncel ortalama maliyetten hesaplanır.</p></div><Button type="button" onClick={() => setKalemler((eski) => [...eski, { malzemeStokId: "", miktar: "1", fireOrani: "0" }])}>+ Malzeme ekle</Button></div>
        <TableWrap><thead><tr><th>Malzeme</th><th className="num">Net miktar</th><th>Birim</th><th className="num">Fire</th><th className="num">Birim maliyet</th><th className="num">Satır maliyeti</th><th /></tr></thead><tbody>{kalemler.map((kalem, index) => { const hesap = satirHesapla(kalem); return <tr key={index}><td><Select required value={kalem.malzemeStokId} onChange={(e) => setKalemler((eski) => eski.map((k, i) => i === index ? { ...k, malzemeStokId: e.target.value, malzemeVaryantId: undefined, birim: undefined } : k))}><option value="">Malzeme seçin</option>{stoklar.map((s) => <option key={s.id} value={s.id}>{s.kod} — {s.ad}</option>)}</Select>{varyantlariAl(kalem.malzemeStokId).length > 0 && <Select aria-label="Malzeme varyantı" required value={kalem.malzemeVaryantId ?? ""} onChange={(e) => setKalemler((eski) => eski.map((k, i) => i === index ? { ...k, malzemeVaryantId: e.target.value || undefined } : k))}><option value="">Varyant seçin</option>{varyantlariAl(kalem.malzemeStokId).map((v) => <option key={v.id} value={v.id}>{v.ad} · {v.kod} · Stok {adet(v.mevcutMiktar)}</option>)}</Select>}{hesap.malzeme && <small className="recipe-stock">Kullanılabilir stok: {adet(hesap.malzeme.mevcutMiktar)} {hesap.malzeme.anaBirim}</small>}</td><td><Input aria-label="Reçete miktarı" required type="number" min="0.00000001" step="any" value={kalem.miktar} onChange={(e) => setKalemler((eski) => eski.map((k, i) => i === index ? { ...k, miktar: e.target.value } : k))} /></td><td>{receteBirimleri(hesap.malzeme).length > 1 ? <Select aria-label="Reçete birimi" value={kalem.birim || hesap.malzeme?.anaBirim} onChange={(e) => setKalemler((eski) => eski.map((k, i) => i === index ? { ...k, birim: e.target.value === hesap.malzeme?.anaBirim ? undefined : e.target.value } : k))}>{receteBirimleri(hesap.malzeme).map((b) => <option key={b} value={b}>{birimKisaAdi(b)}</option>)}</Select> : <span className="recipe-unit">{hesap.malzeme ? birimKisaAdi(hesap.malzeme.anaBirim) : "—"}</span>}</td><td><div className="recipe-percent"><Input aria-label="Fire oranı" required type="number" min="0" max="100" step="0.000001" value={kalem.fireOrani} onChange={(e) => setKalemler((eski) => eski.map((k, i) => i === index ? { ...k, fireOrani: e.target.value } : k))} /><span>%</span></div></td><td className="num recipe-money">{tl(hesap.birimMaliyet)}</td><td className="num"><strong>{tl(hesap.toplam)}</strong>{(Number(kalem.fireOrani) > 0 || (kalem.birim && kalem.birim !== hesap.malzeme?.anaBirim)) && <small className="recipe-stock">{Number(kalem.fireOrani) > 0 ? "Fire dahil " : ""}{inceMiktar(hesap.brut)} {birimKisaAdi(hesap.malzeme?.anaBirim)}</small>}</td><td><Button type="button" size="sm" variant="danger" disabled={kalemler.length === 1} onClick={() => setKalemler((eski) => eski.filter((_, i) => i !== index))}>Sil</Button></td></tr>; })}</tbody></TableWrap>
      </section>
      <section className="recipe-materials">
        <div className="recipe-section-head"><div><h3>Yan / ortak ürünler</h3><p>Üretimde ana ürünle birlikte çıkan ürünler; maliyetten alacakları pay aşağıda seçilir.</p></div><Button type="button" onClick={() => setCiktilar((eski) => [...eski, { stokId: "", tip: "yan_urun", miktar: "1", birimMaliyet: "0" }])}>+ Yan ürün ekle</Button></div>
        {!!ciktilar.length && <div className="form-grid"><Field label="Maliyet payı"><Select value={yanUrunYontemi} onChange={(e) => setYanUrunYontemi(e.target.value as YanUrunYontemi)}><option value="sifir">Pay almaz (sıfır maliyet)</option><option value="sabit_deger">Sabit birim değer — ana üründen düşülür</option><option value="satis_degeri">Satış değerine göre paylaştırılır</option></Select></Field></div>}
        <TableWrap><thead><tr><th>Ürün</th><th>Tür</th><th className="num">Miktar / çevrim</th>{yanUrunYontemi === "sabit_deger" && <th className="num">Birim değer (TL)</th>}<th /></tr></thead><tbody>{ciktilar.map((c, index) => <tr key={index}><td><Select required value={c.stokId} onChange={(e) => setCiktilar((eski) => eski.map((x, i) => i === index ? { ...x, stokId: e.target.value, varyantId: undefined } : x))}><option value="">Ürün seçin</option>{stoklar.filter((st) => st.id !== stokId).map((st) => <option key={st.id} value={st.id}>{st.kod} — {st.ad}</option>)}</Select>{varyantlariAl(c.stokId).length > 0 && <Select aria-label="Yan ürün varyantı" required value={c.varyantId ?? ""} onChange={(e) => setCiktilar((eski) => eski.map((x, i) => i === index ? { ...x, varyantId: e.target.value || undefined } : x))}><option value="">Varyant seçin</option>{varyantlariAl(c.stokId).map((v) => <option key={v.id} value={v.id}>{v.ad} · {v.kod}</option>)}</Select>}</td><td><Select value={c.tip} onChange={(e) => setCiktilar((eski) => eski.map((x, i) => i === index ? { ...x, tip: e.target.value as "yan_urun" | "ortak_urun" } : x))}><option value="yan_urun">Yan ürün</option><option value="ortak_urun">Ortak ürün</option></Select></td><td><Input required type="number" min="0.001" step="0.001" value={c.miktar} onChange={(e) => setCiktilar((eski) => eski.map((x, i) => i === index ? { ...x, miktar: e.target.value } : x))} /></td>{yanUrunYontemi === "sabit_deger" && <td><Input required type="number" min="0" step="0.0001" value={c.birimMaliyet} onChange={(e) => setCiktilar((eski) => eski.map((x, i) => i === index ? { ...x, birimMaliyet: e.target.value } : x))} /></td>}<td><Button type="button" size="sm" variant="danger" onClick={() => setCiktilar((eski) => eski.filter((_, i) => i !== index))}>Sil</Button></td></tr>)}{!ciktilar.length && <tr><td colSpan={5}>Yan ürün yok; üretim maliyetinin tamamı ana ürüne yazılır.</td></tr>}</tbody></TableWrap>
        {yanUrunYontemi === "satis_degeri" && !!ciktilar.length && <small className="muted">Ana ürünün ve yan ürünlerin stok kartında TL satış fiyatı tanımlı olmalı.</small>}
      </section>
      <section className="recipe-materials recipe-costs">
        <div className="recipe-section-head"><div><h3>Ek giderler</h3><p>Süreye bağlı olmayan giderler: enerji, ambalaj, kalıp, genel gider payı. Emirde planlanan maliyete, üretim bildiriminde mamul maliyetine eklenir.</p></div><Button type="button" onClick={() => setGiderler((eski) => [...eski, { ad: "", yontem: "malzeme_yuzdesi", deger: "0" }])}>+ Gider ekle</Button></div>
        {giderler.length > 0 ? <TableWrap><thead><tr><th>Gider</th><th>Hesap biçimi</th><th className="num">Değer</th><th className="num">Bu reçete için</th><th /></tr></thead><tbody>{giderler.map((g, index) => <tr key={index}><td><Input aria-label="Gider adı" required maxLength={120} value={g.ad} placeholder="Enerji, ambalaj…" onChange={(e) => setGiderler((eski) => eski.map((x, i) => i === index ? { ...x, ad: e.target.value } : x))} /></td><td><Select aria-label="Hesap biçimi" value={g.yontem} onChange={(e) => setGiderler((eski) => eski.map((x, i) => i === index ? { ...x, yontem: e.target.value as GiderYontemi } : x))}>{Object.entries(GIDER_YONTEMLERI).map(([deger, ad]) => <option key={deger} value={deger}>{ad}</option>)}</Select></td><td><div className="recipe-percent"><Input aria-label="Gider değeri" required type="number" min="0" step="0.0001" value={g.deger} onChange={(e) => setGiderler((eski) => eski.map((x, i) => i === index ? { ...x, deger: e.target.value } : x))} /><span>{g.yontem === "malzeme_yuzdesi" ? "%" : "TL"}</span></div></td><td className="num"><strong>{tl(giderTutari(g))}</strong></td><td><Button type="button" size="sm" variant="danger" onClick={() => setGiderler((eski) => eski.filter((_, i) => i !== index))}>Sil</Button></td></tr>)}</tbody></TableWrap> : <p className="muted">Ek gider yok. İşçilik, makine ve saatlik genel gider operasyon rotasındaki iş merkezinden gelir.</p>}
      </section>
      <section className="recipe-summary"><div><span>Malzeme çeşidi</span><strong>{kalemler.filter((k) => k.malzemeStokId).length}</strong></div><div><span>Reçete toplam maliyeti</span><strong>{tl(toplamMaliyet)}</strong></div><div><span>Operasyon</span><strong>{tl(operasyonMaliyeti)}</strong><small>İşçilik {tl(operasyonPayi("iscilikSaatlik"))} · Makine {tl(operasyonPayi("makineSaatlik"))} · Genel gider {tl(operasyonPayi("genelGiderSaatlik"))}</small></div><div><span>Ek giderler</span><strong>{tl(ekGiderToplami)}</strong></div><div className="recipe-summary__lead"><span>1 {anaBirim} tahmini maliyet</span><strong>{tl(birimMamulMaliyeti)}</strong><small>{ciktilar.length && yanUrunYontemi !== "sifir" ? "Yan ürün payı düşülmeden" : "Malzeme, operasyon ve ek giderler dahil"}</small></div></section>
      <div className="recipe-actions"><div>{recete && <Button type="button" variant="danger" onClick={() => void sil()}>Reçeteyi arşivle</Button>}</div><div className="row-tight"><span className="muted">Kaydetme yeni taslak sürüm oluşturur.</span>{recete && ["taslak", "onay_bekliyor"].includes(recete.durum) && (recete.onaylayabilir === false ? <span className="muted">Bu sürümü siz hazırladınız; başka bir yetkili onaylamalı.</span> : <Button type="button" onClick={() => void onayla()} disabled={kaydediliyor}>Sürümü onayla</Button>)}<Button type="submit" variant="primary" disabled={kaydediliyor}>{kaydediliyor ? "Kaydediliyor…" : "Yeni sürüm kaydet"}</Button></div></div>
    </form>
  </div>;
}

interface Birim {
  id: string;
  ad: string;
  katsayi: string;
}

interface Barkod {
  id: string;
  barkod: string;
  birim: string | null;
  satisFiyati: string | null;
}

interface Tedarikci {
  id: string;
  cariId: string;
  tedarikciUrunKodu: string | null;
  alisFiyati: string | null;
  dovizCinsi: string;
  tedarikSuresiGun: number | null;
  varsayilan: boolean;
  cari: { id: string; kod: string; unvan: string };
  /** STK-23: tedarikçinin varyant başına kodu. */
  varyantKodlari?: { id: string; varyantId: string; tedarikciUrunKodu: string }[];
}
interface Varyant { id: string; kod: string; ad: string; nitelikler: Record<string, string>; barkod: string | null; alisFiyati: string | null; satisFiyati: string | null; mevcutMiktar: string; aktif: boolean }
interface StokFiyat { id: string; varyantId: string | null; tip: "alis" | "satis"; dovizCinsi: string; tutar: string; aktif: boolean }
type YanUrunYontemi = "sifir" | "sabit_deger" | "satis_degeri";
interface Recete { giderler?: { ad: string; yontem: GiderYontemi; deger: string }[]; id: string; surum: number; durum: "taslak" | "onay_bekliyor" | "aktif" | "pasif" | "arsiv"; ciktiMiktari: string; aciklama: string | null; kaliteKontrolGerekli: boolean; onaylayabilir?: boolean; yanUrunMaliyetYontemi?: YanUrunYontemi; ciktilar?: { id: string; stokId: string; varyantId: string | null; tip: "yan_urun" | "ortak_urun"; miktar: string; birimMaliyet: string | null }[]; operasyonlar?: { id: string; isMerkeziId: string; operasyonKodu: string; operasyonAdi: string; hazirlikDakika: string; cevrimDakika: string }[]; kalemler?: { id: string; malzemeStokId: string; malzemeVaryantId: string | null; miktar: string; birim: string | null; girilenMiktar: string | null; fireOrani: string; malzeme: { id: string; kod: string; ad: string; anaBirim: string; mevcutMiktar: string; ortalamaMaliyet: string } }[] }
interface IsMerkezi { id: string; kod: string; ad: string; aktif: boolean; saatlikMaliyet?: string; iscilikSaatlik?: string; makineSaatlik?: string; genelGiderSaatlik?: string }
type GiderYontemi = "malzeme_yuzdesi" | "birim_basi" | "emir_basi";
const GIDER_YONTEMLERI: Record<GiderYontemi, string> = { malzeme_yuzdesi: "Malzeme maliyetinin %'si", birim_basi: "Üretilen birim başına TL", emir_basi: "Emir başına sabit TL" };
interface OzelReceteliVaryant { varyantId: string; durum: string; surum: number }
interface StokOzet { id: string; kod: string; ad: string; tip: string; anaBirim: string; mevcutMiktar: string; ortalamaMaliyet?: string; birimler?: { ad: string; katsayi: string }[]; varyantlar?: { id: string; kod: string; ad: string; mevcutMiktar: string; aktif?: boolean }[] }

interface Hareket {
  id: string;
  tip: string;
  miktar: string;
  girilenBirim: string;
  girilenMiktar: string;
  maliyet: string;
  tarih: string;
  aciklama: string | null;
  kaynakTur: string;
  kaynakRef: string | null;
  /** İptal edilmiş faturanın hareketi (STK-22); yalnız iptaller gösterilince gelir. */
  iptal?: boolean;
  depo?: { id: string; kod: string; ad: string } | null;
  varyant?: { id: string; kod: string; ad: string } | null;
}

/** STK-36: ilk sayfada gelen devir ve dönem özeti (ana birim). */
interface HareketOzeti {
  devir: string;
  giris: string;
  cikis: string;
  sonBakiye: string;
  kayitSayisi: number;
}

interface HareketSayfasi {
  kayitlar: Hareket[];
  sonrakiImlec: string | null;
  ozet?: HareketOzeti;
}

/** Hareket listesi süzgeci; tarihler YYYY-AA-GG, boşsa sınırsız. */
interface HareketSuzgeci {
  baslangic: string;
  bitis: string;
  depoId: string;
  iptaller: boolean;
}

interface StokDetay {
  id: string;
  kod: string;
  ad: string;
  kisaAd: string | null;
  aciklama: string | null;
  tip: string;
  marka: string | null;
  model: string | null;
  mensei: string | null;
  gtipKodu: string | null;
  sarjTuru: string | null;
  ureticiUrunKodu: string | null;
  /** STK-41: dil başına ad ve açıklama. */
  yabanciAdlar?: YabanciAdlar | null;
  barkod: string | null;
  kategoriId: string | null;
  anaBirim: string;
  /** Hareket görmüş kartın ana birimi değişmez (STK-01). */
  anaBirimKilitli: boolean;
  kdvOrani: string;
  alisFiyati: string | null;
  satisFiyati: string | null;
  alisFiyatiDoviz: string;
  satisFiyatiDoviz: string;
  kritikSeviye: string | null;
  minStok: string | null;
  maksStok: string | null;
  guvenlikStogu: string | null;
  tedarikSuresiGun: number | null;
  gorselUrl: string | null;
  mevcutMiktar: string;
  rezerveMiktar: string;
  yoldakiMiktar: string;
  kullanilabilirMiktar: string;
  ortalamaMaliyet: string;
  aktif: boolean;
  takipTipi?: "yok" | "lot" | "seri";
  kategori: Kategori | null;
  birimler: Birim[];
  barkodlar: Barkod[];
  tedarikciler: Tedarikci[];
  varyantlar?: Varyant[];
  /** EBLG-125: KDV dışı vergiler (ÖTV, ÖİV…); faturada satıra buradan gelir. */
  ekVergiler?: { kod: string; hesap: "oran" | "birim"; deger: string }[];
  izinliEylemler: string[];
}

interface CariOzet {
  id: string;
  kod: string;
  unvan: string;
}

type Sekme = "genel" | "recete" | "fiyatlar" | "hareketler" | "depolar" | "varyantlar" | "partiler" | "birimler" | "barkodlar" | "tedarikciler" | "vergiler";

interface Parti { id: string; lotNo: string; seriNo: string | null; sonKullanmaTarihi: string | null; uretimTarihi: string | null; ilkMiktar: string; kalanMiktar: string; depo: { ad: string }; varyant: { kod: string; ad: string } | null }

/** Stok kartının depo bazlı kırılımı (STK-07). */
interface DepoBakiyeSatiri {
  depoId: string;
  depoKod: string;
  depoAd: string;
  depoAktif: boolean;
  mevcutMiktar: string;
  rezerveMiktar: string;
  yoldakiMiktar: string;
  kullanilabilirMiktar: string;
}

/* ─── Sabitler ───────────────────────────────────────────────────────────── */

/** STK-19: giriş gibi işlenenler acilis/giris; kalanlar çıkış tarafı. */
const HAREKET_TIPLERI: { deger: string; baslik: string; yon: "giris" | "cikis" | "duzeltme" }[] = [
  { deger: "giris", baslik: "Giriş", yon: "giris" },
  { deger: "cikis", baslik: "Çıkış", yon: "cikis" },
  { deger: "acilis", baslik: "Açılış", yon: "giris" },
  { deger: "fire", baslik: "Fire", yon: "cikis" },
  { deger: "zayi", baslik: "Zayi", yon: "cikis" },
  { deger: "numune", baslik: "Numune", yon: "cikis" },
  { deger: "promosyon", baslik: "Promosyon", yon: "cikis" },
];

/**
 * Elle girilemeyen, yalnız listede görünen türler: depolar arası transferin
 * iki ayağı transfer fişinden (STK-07), sayım düzeltmesi sayım onayından
 * (STK-34) üretilir.
 */
const TUREYEN_HAREKET_TIPLERI: { deger: string; baslik: string; yon: "giris" | "cikis" | "duzeltme" }[] = [
  { deger: "sayim_duzeltme", baslik: "Sayım Düzeltme", yon: "duzeltme" },
  { deger: "transfer_giris", baslik: "Transfer Girişi", yon: "giris" },
  { deger: "transfer_cikis", baslik: "Transfer Çıkışı", yon: "cikis" },
];

const TUM_HAREKET_TIPLERI = [...HAREKET_TIPLERI, ...TUREYEN_HAREKET_TIPLERI];

const TIP_ETIKETLERI: Record<string, string> = {
  urun: "📦 Ürün",
  hizmet: "🛠️ Hizmet",
  sarf: "🧰 Sarf",
};

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

const adet = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

/** Reçetedeki küçük ana birim miktarı (ör. 0,00000698 kg); 3 basamakta 0 görünmesin. */
const inceMiktar = (deger: number): string =>
  deger.toLocaleString("tr-TR", { maximumFractionDigits: 12 });

const bugun = () => bugunTR();

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

/* ─── Sayfa ──────────────────────────────────────────────────────────────── */

export default function StokDetaySayfasi() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [detay, setDetay] = useState<StokDetay | null>(null);
  const [hareketler, setHareketler] = useState<Hareket[]>([]);
  const [hareketOzeti, setHareketOzeti] = useState<HareketOzeti | null>(null);
  const [hareketImleci, setHareketImleci] = useState<string | null>(null);
  const [hareketSuzgeci, setHareketSuzgeci] = useState<HareketSuzgeci>({ baslangic: "", bitis: "", depoId: "", iptaller: false });
  const [depoBakiyeleri, setDepoBakiyeleri] = useState<DepoBakiyeSatiri[]>([]);
  const [partiler, setPartiler] = useState<Parti[]>([]);
  const [fiyatlar, setFiyatlar] = useState<StokFiyat[]>([]);
  const [recete, setRecete] = useState<Recete | null>(null);
  /** Reçete sekmesinde düzenlenen kapsam: boş = genel reçete, dolu = o varyantın özel reçetesi. */
  const [receteKapsami, setReceteKapsami] = useState("");
  const [ozelReceteliVaryantlar, setOzelReceteliVaryantlar] = useState<OzelReceteliVaryant[]>([]);
  const [isMerkezleri, setIsMerkezleri] = useState<IsMerkezi[]>([]);
  const [tumStoklar, setTumStoklar] = useState<StokOzet[]>([]);
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [cariler, setCariler] = useState<CariOzet[]>([]);
  const [aktifSekme, setAktifSekme] = useState<Sekme>("genel");
  const { cokluDepo } = useDepolar();
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [uyari, setUyari] = useState("");
  const [fiyatTipi, setFiyatTipi] = useState<"alis" | "satis">("satis");
  const [fiyatDovizi, setFiyatDovizi] = useState("TRY");
  const [fiyatTutar, setFiyatTutar] = useState("");
  const [fiyatVaryantId, setFiyatVaryantId] = useState("");

  const yukle = useCallback(async () => {
    try {
      const veri = await api<StokDetay>(`/stok/${id}`);
      setDetay(veri);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Stok kartı yüklenemedi");
    }
  }, [id]);

  /** STK-36: imleçsiz çağrı ilk sayfayı ve özeti yükler; imleçle sonraki sayfa eklenir. */
  const hareketleriYukle = useCallback(async (imlec?: string) => {
    const p = new URLSearchParams();
    if (hareketSuzgeci.baslangic) p.set("baslangic", hareketSuzgeci.baslangic);
    if (hareketSuzgeci.bitis) p.set("bitis", hareketSuzgeci.bitis);
    if (hareketSuzgeci.depoId) p.set("depoId", hareketSuzgeci.depoId);
    if (hareketSuzgeci.iptaller) p.set("iptaller", "1");
    if (imlec) p.set("imlec", imlec);
    try {
      const sayfa = await api<HareketSayfasi>(`/stok/${id}/hareketler?${p}`);
      setHareketler((onceki) => (imlec ? [...onceki, ...sayfa.kayitlar] : sayfa.kayitlar));
      if (sayfa.ozet) setHareketOzeti(sayfa.ozet);
      setHareketImleci(sayfa.sonrakiImlec);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Hareketler yüklenemedi");
    }
  }, [id, hareketSuzgeci]);

  const depoBakiyeleriYukle = useCallback(async () => {
    try {
      setDepoBakiyeleri(await api<DepoBakiyeSatiri[]>(`/stok/${id}/depo-bakiyeleri`));
    } catch {
      setDepoBakiyeleri([]);
    }
  }, [id]);
  const partileriYukle = useCallback(async () => { try { const veri = await api<Parti[]>(`/stok/${id}/partiler`); setPartiler(Array.isArray(veri) ? veri : []); } catch { setPartiler([]); } }, [id]);
  const fiyatlariYukle = useCallback(async () => { try { setFiyatlar(await api<StokFiyat[]>(`/stok/${id}/fiyatlar`)); } catch { setFiyatlar([]); } }, [id]);
  const receteyiYukle = useCallback(async () => {
    try {
      const [veri, ozel] = await Promise.all([
        api<Recete | null>(`/uretim/receteler/${id}${receteKapsami ? `?varyantId=${receteKapsami}` : ""}`),
        api<OzelReceteliVaryant[]>(`/uretim/receteler/${id}/ozel-varyantlar`).catch(() => []),
      ]);
      setRecete(veri?.id ? { ...veri, kalemler: Array.isArray(veri.kalemler) ? veri.kalemler : [] } : null);
      setOzelReceteliVaryantlar(ozel);
    } catch { setRecete(null); }
  }, [id, receteKapsami]);

  useEffect(() => {
    if (!tokenAl()) return;
    void yukle();
    void hareketleriYukle();
    void depoBakiyeleriYukle();
    void partileriYukle();
    void fiyatlariYukle();
    void api<IsMerkezi[]>("/uretim/is-merkezleri").then((v) => setIsMerkezleri(v.filter((m) => m.aktif))).catch(() => setIsMerkezleri([]));
    void tumSayfalariAl<StokOzet>("/stok").then(setTumStoklar).catch(() => {});
    void api<Kategori[]>("/stok/kategoriler").then(setKategoriler).catch(() => {});
    void tumSayfalariAl<CariOzet>("/cari").then(setCariler).catch(() => {});
  }, [yukle, hareketleriYukle, depoBakiyeleriYukle, partileriYukle, fiyatlariYukle]);
  // Reçete kapsamı (genel/varyant) değişince yalnız reçete yeniden okunur.
  useEffect(() => { if (tokenAl()) void receteyiYukle(); }, [receteyiYukle]);

  /** Alt kayıt ekleme/silme sonrası ortak akış. */
  async function islem(calistir: () => Promise<unknown>, basariMesaji: string) {
    setHata("");
    setBasari("");
    setUyari("");
    try {
      await calistir();
      setBasari(basariMesaji);
      await yukle();
      return true;
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem başarısız");
      return false;
    }
  }

  async function fiyatEkle(e: React.FormEvent) {
    e.preventDefault();
    if (!fiyatTutar) return;
    const ok = await islem(() => api(`/stok/${id}/fiyatlar`, { method: "POST", body: JSON.stringify({ tip: fiyatTipi, dovizCinsi: fiyatDovizi, tutar: fiyatTutar, varyantId: fiyatVaryantId || null }) }), "Dövizli fiyat kaydedildi.");
    if (ok) { setFiyatTutar(""); setFiyatlar(await api<StokFiyat[]>(`/stok/${id}/fiyatlar`)); }
  }

  async function fiyatSil(fiyatId: string) {
    const ok = await islem(() => api(`/stok/${id}/fiyatlar/${fiyatId}`, { method: "DELETE" }), "Dövizli fiyat silindi.");
    if (ok) setFiyatlar(await api<StokFiyat[]>(`/stok/${id}/fiyatlar`));
  }

  async function kopyala() {
    setHata(""); setBasari(""); setUyari("");
    try {
      const kopya = await api<StokDetay>(`/stok/${id}/kopyala`, { method: "POST" });
      router.push(`/panel/stok/${kopya.id}`);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kopyalama hatası");
    }
  }

  async function sil() {
    if (!detay || !window.confirm(`“${detay.ad}” stok kartı silinsin mi?`)) return;
    const ok = await islem(() => api(`/stok/${id}`, { method: "DELETE" }), "Stok kartı silindi.");
    if (ok) router.push("/panel/stok");
  }

  if (!detay) {
    return (
      <div>
        <PageHeader title="Stok Kartı" />
        <Alert tone="error">{hata}</Alert>
        {!hata && <Card>Yükleniyor…</Card>}
      </div>
    );
  }

  const miktar = Number(detay.mevcutMiktar);
  const kritik = detay.kritikSeviye ? Number(detay.kritikSeviye) : null;
  const kritikAlti = kritik !== null && miktar <= kritik;

  return (
    <div className="stock-detail-page">
      <header className="stock-profile">
        <div className="stock-profile__top"><ButtonLabel as="a" href="/panel/stok">← Stok listesi</ButtonLabel><span className="stock-profile__code">STOK KARTI / {detay.kod}</span></div>
        <div className="stock-profile__body">
          <div className="stock-profile__avatar">{detay.ad.trim().slice(0, 2).toLocaleUpperCase("tr-TR")}</div>
          <div className="stock-profile__identity"><div className="stock-profile__badges"><Badge variant={detay.aktif ? "success" : "neutral"}>{detay.aktif ? "Aktif" : "Pasif"}</Badge>{kritikAlti && <Badge variant="warning">Kritik stok</Badge>}<Badge variant="neutral">{TIP_ETIKETLERI[detay.tip] ?? detay.tip}</Badge></div><h1>{detay.ad}</h1><p>{detay.kategori?.ad ?? "Kategorisiz"} · Ana birim {detay.anaBirim}{detay.marka ? ` · ${detay.marka}` : ""}{detay.model ? ` ${detay.model}` : ""}</p></div>
          <div className="stock-profile__commercial"><span>Satış fiyatı</span><strong>{detay.satisFiyati ? `${Number(detay.satisFiyati).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${detay.satisFiyatiDoviz}` : "Tanımsız"}</strong><small>{detay.alisFiyati ? `Alış ${Number(detay.alisFiyati).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${detay.alisFiyatiDoviz}` : "Alış fiyatı tanımsız"}</small></div>
        </div>
      </header>

      {(detay.izinliEylemler.includes("kopyala") || detay.izinliEylemler.includes("sil")) && (
        <EylemCubugu etiket="Stok kartı eylemleri">
          {detay.izinliEylemler.includes("kopyala") && <Button size="sm" type="button" onClick={() => void kopyala()}>⧉ Kopyala</Button>}
          {detay.izinliEylemler.includes("sil") && (
            <EylemMenusu>
              <Button size="sm" type="button" variant="danger" onClick={() => void sil()}>🗑️ Sil</Button>
            </EylemMenusu>
          )}
        </EylemCubugu>
      )}

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      {uyari && <Alert tone="error">⚠️ {uyari}</Alert>}

      <section className="stock-kpis">
        <div className={`stock-kpi stock-kpi--lead${kritikAlti ? " is-danger" : ""}`}><span>Mevcut stok</span><strong>{adet(detay.mevcutMiktar)} <small>{detay.anaBirim}</small></strong><p>{kritik !== null ? `Kritik eşik ${adet(kritik)} ${detay.anaBirim}` : "Kritik eşik tanımlanmamış"}</p></div>
        <div className="stock-kpi"><span>Kullanılabilir</span><strong>{adet(detay.kullanilabilirMiktar)} <small>{detay.anaBirim}</small></strong><p>{adet(detay.rezerveMiktar)} {detay.anaBirim} rezerve</p></div>
        <div className="stock-kpi"><span>Tedarik görünümü</span><strong>{adet(detay.yoldakiMiktar)} <small>{detay.anaBirim}</small></strong><p>{detay.tedarikSuresiGun != null ? `${detay.tedarikSuresiGun} gün tedarik süresi` : "Tedarik süresi tanımsız"}</p></div>
        <div className="stock-kpi stock-kpi--value"><span>Stok değeri</span><strong>{tl(Number(detay.ortalamaMaliyet) * miktar)}</strong><p>Ort. maliyet {tl(detay.ortalamaMaliyet)}</p></div>
      </section>

      <div className="stock-tabs">
        <Tabs<Sekme>
          ariaLabel="Stok kartı bölümleri"
          idPrefix="stok-detay"
          value={aktifSekme}
          onChange={setAktifSekme}
          items={[
            { deger: "genel", baslik: "Genel" },
            { deger: "recete", baslik: recete ? `Ürün reçetesi (${recete.kalemler?.length ?? 0})` : "Ürün reçetesi" },
            { deger: "fiyatlar", baslik: `Dövizli fiyatlar (${fiyatlar.length})` },
            { deger: "vergiler", baslik: `KDV dışı vergiler (${detay.ekVergiler?.length ?? 0})` },
            { deger: "hareketler", baslik: `Hareketler (${hareketOzeti?.kayitSayisi ?? hareketler.length})` },
            ...(cokluDepo
              ? [{ deger: "depolar" as Sekme, baslik: `Depolar (${depoBakiyeleri.length})` }]
              : []),
            { deger: "birimler", baslik: `Birimler (${detay.birimler.length})` },
            { deger: "varyantlar", baslik: `Varyantlar (${detay.varyantlar?.length ?? 0})` },
            ...((detay.takipTipi ?? "yok") !== "yok" ? [{ deger: "partiler" as Sekme, baslik: `Seri / Lot (${partiler.length})` }] : []),
            { deger: "barkodlar", baslik: `Barkodlar (${detay.barkodlar.length})` },
            { deger: "tedarikciler", baslik: `Tedarikçiler (${detay.tedarikciler.length})` },
          ]}
        />
      </div>

      {aktifSekme === "genel" && (
        <TabPanel idPrefix="stok-detay" value="genel">
          <GenelSekmesi
            detay={detay}
            kategoriler={kategoriler}
            onVergiler={() => setAktifSekme("vergiler")}
            onKaydet={(govde) =>
              islem(
                () => api(`/stok/${id}`, { method: "PATCH", body: JSON.stringify(govde) }),
                "Stok kartı güncellendi.",
              )
            }
          />
        </TabPanel>
      )}

      {aktifSekme === "recete" && <TabPanel idPrefix="stok-detay" value="recete"><ReceteSekmesi stokId={id} anaBirim={detay.anaBirim} recete={recete} stoklar={tumStoklar.filter((s) => s.id !== id && s.tip !== "hizmet")} isMerkezleri={isMerkezleri} varyantlar={detay.varyantlar ?? []} kapsam={receteKapsami} ozelVaryantlar={ozelReceteliVaryantlar} onKapsamDegis={setReceteKapsami} onKaydedildi={async () => { await receteyiYukle(); setBasari("Yeni reçete sürümü taslak olarak kaydedildi."); }} onSilindi={async () => { await receteyiYukle(); setBasari("Ürün reçetesi arşivlendi."); }} onHata={setHata} /></TabPanel>}
      {aktifSekme === "fiyatlar" && <TabPanel idPrefix="stok-detay" value="fiyatlar"><Card title="Dövizli ürün fiyatları"><form className="form-grid" onSubmit={fiyatEkle}><Field label="Tip"><Select value={fiyatTipi} onChange={(e) => setFiyatTipi(e.target.value as "alis" | "satis")}><option value="satis">Satış</option><option value="alis">Alış</option></Select></Field><Field label="Varyant"><Select value={fiyatVaryantId} onChange={(e) => setFiyatVaryantId(e.target.value)}><option value="">Kart fiyatı</option>{(detay.varyantlar ?? []).map((v) => <option key={v.id} value={v.id}>{v.kod} — {v.ad}</option>)}</Select></Field><Field label="Döviz"><Select value={fiyatDovizi} onChange={(e) => setFiyatDovizi(e.target.value)}><DovizSecenekleri /></Select></Field><Field label="Tutar"><Input type="number" min="0" step="0.0001" value={fiyatTutar} onChange={(e) => setFiyatTutar(e.target.value)} required /></Field><div><Button type="submit" variant="primary">Fiyat kaydet</Button></div></form><TableWrap><thead><tr><th>Tip</th><th>Varyant</th><th>Döviz</th><th className="num">Tutar</th><th>Durum</th><th /></tr></thead><tbody>{fiyatlar.map((f) => <tr key={f.id}><td>{f.tip === "alis" ? "Alış" : "Satış"}</td><td>{f.varyantId ? detay.varyantlar?.find((v) => v.id === f.varyantId)?.kod ?? f.varyantId : "Kart"}</td><td>{f.dovizCinsi}</td><td className="num">{Number(f.tutar).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {f.dovizCinsi}</td><td>{f.aktif ? "Aktif" : "Pasif"}</td><td><Button size="sm" variant="danger" type="button" onClick={() => void fiyatSil(f.id)}>Sil</Button></td></tr>)}{!fiyatlar.length && <tr><td colSpan={6}>Henüz dövizli fiyat tanımlanmamış.</td></tr>}</tbody></TableWrap></Card></TabPanel>}

      {aktifSekme === "hareketler" && (
        <TabPanel idPrefix="stok-detay" value="hareketler"><HareketlerSekmesi
          detay={detay}
          hareketler={hareketler}
          ozet={hareketOzeti}
          suzgec={hareketSuzgeci}
          onSuzgec={setHareketSuzgeci}
          dahaVar={hareketImleci !== null}
          onDahaFazla={() => hareketImleci && hareketleriYukle(hareketImleci)}
          onEkle={async (govde) => {
            setHata("");
            setBasari("");
            setUyari("");
            try {
              const yanit = await api<{ eksiStokUyarisi: string | null }>(`/stok/${id}/hareketler`, {
                method: "POST",
                body: JSON.stringify(govde),
              });
              setBasari("Stok hareketi işlendi.");
              if (yanit.eksiStokUyarisi) setUyari(yanit.eksiStokUyarisi);
              await yukle();
              await hareketleriYukle();
              await depoBakiyeleriYukle();
              await partileriYukle();
              return true;
            } catch (h) {
              setHata(h instanceof Error ? h.message : "Hareket işlenemedi");
              return false;
            }
          }}
        /></TabPanel>
      )}

      {aktifSekme === "depolar" && (
        <TabPanel idPrefix="stok-detay" value="depolar"><DepolarSekmesi detay={detay} satirlar={depoBakiyeleri} /></TabPanel>
      )}

      {aktifSekme === "birimler" && (
        <TabPanel idPrefix="stok-detay" value="birimler"><BirimlerSekmesi
          detay={detay}
          onEkle={(govde) =>
            islem(
              () => api(`/stok/${id}/birimler`, { method: "POST", body: JSON.stringify(govde) }),
              "Birim eklendi.",
            )
          }
          onSil={(birimId) =>
            islem(() => api(`/stok/${id}/birimler/${birimId}`, { method: "DELETE" }), "Birim silindi.")
          }
        /></TabPanel>
      )}

      {aktifSekme === "varyantlar" && (
        <TabPanel idPrefix="stok-detay" value="varyantlar"><VaryantlarSekmesi detay={detay} onIslem={islem} /></TabPanel>
      )}
      {aktifSekme === "partiler" && <TabPanel idPrefix="stok-detay" value="partiler"><PartilerSekmesi detay={detay} partiler={partiler} /></TabPanel>}

      {aktifSekme === "vergiler" && (
        <TabPanel idPrefix="stok-detay" value="vergiler"><VergilerSekmesi
          detay={detay}
          onKaydet={(vergiler) => islem(() => api(`/stok/${id}/ek-vergiler`, { method: "PUT", body: JSON.stringify({ vergiler }) }), "Vergiler kaydedildi.")}
        /></TabPanel>
      )}

      {aktifSekme === "barkodlar" && (
        <TabPanel idPrefix="stok-detay" value="barkodlar"><BarkodlarSekmesi
          detay={detay}
          onEkle={(govde) =>
            islem(
              () => api(`/stok/${id}/barkodlar`, { method: "POST", body: JSON.stringify(govde) }),
              "Barkod eklendi.",
            )
          }
          onSil={(barkodId) =>
            islem(() => api(`/stok/${id}/barkodlar/${barkodId}`, { method: "DELETE" }), "Barkod silindi.")
          }
          onHata={setHata}
        /></TabPanel>
      )}

      {aktifSekme === "tedarikciler" && (
        <TabPanel idPrefix="stok-detay" value="tedarikciler"><TedarikcilerSekmesi
          detay={detay}
          cariler={cariler}
          onEkle={(govde, mesaj) =>
            islem(
              () => api(`/stok/${id}/tedarikciler`, { method: "POST", body: JSON.stringify(govde) }),
              mesaj ?? "Tedarikçi eklendi.",
            )
          }
          onSil={(tedarikciId) =>
            islem(
              () => api(`/stok/${id}/tedarikciler/${tedarikciId}`, { method: "DELETE" }),
              "Tedarikçi bağlantısı silindi.",
            )
          }
        /></TabPanel>
      )}
    </div>
  );
}

/* ─── Genel sekmesi ──────────────────────────────────────────────────────── */

function GenelSekmesi({
  detay,
  kategoriler,
  onVergiler,
  onKaydet,
}: {
  detay: StokDetay;
  kategoriler: Kategori[];
  onVergiler: () => void;
  onKaydet: (govde: Record<string, unknown>) => Promise<boolean>;
}) {
  const duzenlenebilir = detay.izinliEylemler.includes("duzenle");
  const [form, setForm] = useState({
    ad: detay.ad,
    kisaAd: detay.kisaAd ?? "",
    aciklama: detay.aciklama ?? "",
    kategoriId: detay.kategoriId ?? "",
    marka: detay.marka ?? "",
    model: detay.model ?? "",
    mensei: detay.mensei ?? "",
    gtipKodu: detay.gtipKodu ?? "",
    sarjTuru: detay.sarjTuru ?? "",
    ureticiUrunKodu: detay.ureticiUrunKodu ?? "",
    anaBirim: detay.anaBirim,
    kdvOrani: detay.kdvOrani,
    alisFiyati: detay.alisFiyati ?? "",
    satisFiyati: detay.satisFiyati ?? "",
    alisFiyatiDoviz: detay.alisFiyatiDoviz ?? "TRY",
    satisFiyatiDoviz: detay.satisFiyatiDoviz ?? "TRY",
    kritikSeviye: detay.kritikSeviye ?? "",
    minStok: detay.minStok ?? "",
    maksStok: detay.maksStok ?? "",
    guvenlikStogu: detay.guvenlikStogu ?? "",
    tedarikSuresiGun: detay.tedarikSuresiGun?.toString() ?? "",
    aktif: detay.aktif,
    takipTipi: detay.takipTipi ?? "yok",
  });
  /** STK-41: belge o dilde basılırken kullanılan adlar; boş ad kaydedilmez. */
  const [yabanciAdlar, setYabanciAdlar] = useState<Record<string, { ad: string; aciklama: string }>>(() =>
    Object.fromEntries(YABANCI_BELGE_DILLERI.map((d) => [d, { ad: detay.yabanciAdlar?.[d]?.ad ?? "", aciklama: detay.yabanciAdlar?.[d]?.aciklama ?? "" }])));
  const yabanciAdDegis = (dil: string, alanAdi: "ad" | "aciklama", deger: string) =>
    setYabanciAdlar((m) => ({ ...m, [dil]: { ...m[dil], [alanAdi]: deger } }));

  // MVZ-11: kartın KDV oranı bugün yürürlükteki merkezi listeden.
  const kodTablosu = useKodTablosu(null);
  const alan = (k: keyof typeof form) => ({
    value: form[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value })),
  });

  /** Boş metin alanları null, sayısal alanlar API'nin beklediği string olarak gider. */
  function kaydet() {
    const bosNull = (d: string) => (d.trim() === "" ? null : d.trim());
    void onKaydet({
      ad: form.ad,
      kisaAd: bosNull(form.kisaAd),
      aciklama: bosNull(form.aciklama),
      kategoriId: bosNull(form.kategoriId),
      marka: bosNull(form.marka),
      model: bosNull(form.model),
      mensei: bosNull(form.mensei),
      gtipKodu: bosNull(form.gtipKodu),
      sarjTuru: bosNull(form.sarjTuru),
      ureticiUrunKodu: bosNull(form.ureticiUrunKodu),
      yabanciAdlar: yabanciAdlarNormalize(yabanciAdlar),
      // Kilitli kartta birim hiç gönderilmez; sunucu da reddeder.
      ...(detay.anaBirimKilitli ? {} : { anaBirim: form.anaBirim }),
      kdvOrani: form.kdvOrani || "20",
      alisFiyati: bosNull(form.alisFiyati),
      satisFiyati: bosNull(form.satisFiyati),
      alisFiyatiDoviz: form.alisFiyatiDoviz,
      satisFiyatiDoviz: form.satisFiyatiDoviz,
      kritikSeviye: bosNull(form.kritikSeviye),
      minStok: bosNull(form.minStok),
      maksStok: bosNull(form.maksStok),
      guvenlikStogu: bosNull(form.guvenlikStogu),
      tedarikSuresiGun: form.tedarikSuresiGun.trim() === "" ? null : Number(form.tedarikSuresiGun),
      aktif: form.aktif,
      takipTipi: form.takipTipi,
    });
  }

  return (
    <Card className="stack stock-editor">
      <div className="between">
        <div className="card__title" style={{ margin: 0 }}>
          Kart bilgileri
        </div>
        {duzenlenebilir && (
          <Button size="sm" onClick={() => setForm((f) => ({ ...f, aktif: !f.aktif }))}>
            {form.aktif ? "Pasife Al" : "Aktife Al"}
          </Button>
        )}
      </div>

      <div className="stock-editor__section"><span>01</span><div><strong>Temel bilgiler</strong><small>Ürünün katalogda görünen kimliği ve sınıflandırması</small></div></div>
      <div className="stock-editor__grid stock-editor__grid--basic">
        <div className="stock-field stock-field--wide">
          <Field label="Ürün/Hizmet Adı *">
            <Input {...alan("ad")} required />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Kısa Ad">
            <Input {...alan("kisaAd")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Kategori">
            <Select {...alan("kategoriId")}>
              <option value="">— Kategorisiz —</option>
              {kategoriler.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.ust ? `${k.ust.ad} › ${k.ad}` : k.ad}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Birim *">
            <BirimSecimi value={form.anaBirim} onChange={(birim) => setForm((f) => ({ ...f, anaBirim: birim }))} disabled={detay.anaBirimKilitli} haric={detay.birimler.map((b) => b.ad)} required />
          </Field>
          {detay.anaBirimKilitli && <small className="muted">Stok hareketi olduğu için değiştirilemez.</small>}
        </div>
        <div className="stock-field stock-field--full"><Field label="Açıklama"><Input {...alan("aciklama")} placeholder="Ürünle ilgili kısa açıklama veya kullanım notu" /></Field></div>
      </div>

      <div className="stock-editor__section"><span>02</span><div><strong>İzlenebilirlik ve tanımlayıcılar</strong><small>Üretici, menşei ve seri/lot izleme tercihleri</small></div></div>
      <div className="stock-editor__grid stock-editor__grid--identity">
        <div className="stock-field stock-field--tracking"><Field label="Seri / lot takibi"><Select {...alan("takipTipi")}><option value="yok">Takip yok</option><option value="lot">Lot / parti ve son kullanma tarihi</option><option value="seri">Tekil seri numarası</option></Select></Field></div>
        <div className="stock-field">
          <Field label="Marka">
            <Input {...alan("marka")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Model">
            <Input {...alan("model")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Menşei">
            <Input {...alan("mensei")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="GTİP Kodu">
            <Input {...alan("gtipKodu")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Üretici Ürün Kodu">
            <Input {...alan("ureticiUrunKodu")} />
          </Field>
        </div>
        <div className="stock-field">
          {/* EBLG-71: işaretli kart satıra düşünce fatura SARJ/SARJANLIK tipiyle gider. */}
          <Field label="Elektrikli araç şarjı">
            <Select {...alan("sarjTuru")}>
              <option value="">Şarj faturası değil</option>
              {SARJ_TURLERI.map((tur) => <option key={tur} value={tur}>{SARJ_TURU_ADLARI[tur]}</option>)}
            </Select>
          </Field>
        </div>
      </div>

      {/* STK-41: yabancı dilde basılan teklif/proforma/faturada ürünün adı. */}
      <details className="stock-editor__yabanci" open={YABANCI_BELGE_DILLERI.some((d) => yabanciAdlar[d].ad.trim())}>
        <summary>Yabancı dilde ürün adı <small className="muted">— belge o dilde basılırken kullanılır; boşsa Türkçe ad basılır</small></summary>
        <div className="stock-editor__grid">
          {YABANCI_BELGE_DILLERI.map((d) => (
            <div key={d} className="stock-field stock-field--full">
              <Field label={`${BELGE_DILI_ADLARI[d]} ad`}>
                <Input aria-label={`${BELGE_DILI_ADLARI[d]} ürün adı`} dir={d === "ar" ? "rtl" : undefined} value={yabanciAdlar[d].ad} maxLength={YABANCI_AD_UZUNLUGU} onChange={(e) => yabanciAdDegis(d, "ad", e.target.value)} />
              </Field>
              <Field label={`${BELGE_DILI_ADLARI[d]} açıklama (isteğe bağlı)`}>
                <Input aria-label={`${BELGE_DILI_ADLARI[d]} açıklama`} dir={d === "ar" ? "rtl" : undefined} value={yabanciAdlar[d].aciklama} maxLength={YABANCI_ACIKLAMA_UZUNLUGU} onChange={(e) => yabanciAdDegis(d, "aciklama", e.target.value)} disabled={!yabanciAdlar[d].ad.trim()} />
              </Field>
            </div>
          ))}
        </div>
      </details>

      <div className="stock-editor__section"><span>03</span><div><strong>Fiyatlandırma</strong><small>Vergi oranı ve kartın varsayılan alış/satış fiyatları</small></div></div>
      <div className="stock-editor__grid stock-editor__grid--pricing">
        <div className="stock-field">
          <Field label="KDV Oranı (%)">
            <KdvOraniSecimi tablo={kodTablosu} value={form.kdvOrani as string} onDegis={(o) => setForm((f) => ({ ...f, kdvOrani: o }))} />
          </Field>
          {/* EBLG-125: KDV dışı vergiler ayrı sekmede düzenlenir; burada yalnız özet ve bağlantı. */}
          <small className="muted">
            {detay.ekVergiler?.length
              ? `KDV dışı: ${detay.ekVergiler.map((v) => `${kodTablosu.vergiTurleri.find((t) => t.kod === v.kod)?.ad ?? v.kod} ${v.hesap === "oran" ? `%${Number(v.deger)}` : `${Number(v.deger)} TL/${detay.anaBirim}`}`).join(", ")} · `
              : "ÖTV, ÖİV gibi KDV dışı vergi yok · "}
            <button type="button" className="link-button" onClick={onVergiler}>{detay.ekVergiler?.length ? "Düzenle" : "Ekle"}</button>
          </small>
        </div>
        <div className="stock-field">
          <Field label="Alış Fiyatı">
            <div className="stock-price-input"><Input type="number" step="0.0001" {...alan("alisFiyati")} placeholder="0.0000" /><Select aria-label="Alış fiyatı dövizi" {...alan("alisFiyatiDoviz")}><DovizSecenekleri /></Select></div>
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Satış Fiyatı">
            <div className="stock-price-input"><Input type="number" step="0.0001" {...alan("satisFiyati")} placeholder="0.0000" /><Select aria-label="Satış fiyatı dövizi" {...alan("satisFiyatiDoviz")}><DovizSecenekleri /></Select></div>
          </Field>
        </div>
      </div>

      <div className="stock-editor__section"><span>04</span><div><strong>Stok planlama</strong><small>Kritik eşikler, güvenlik stoğu ve tedarik parametreleri</small></div></div>
      <div className="stock-editor__grid stock-editor__grid--planning">
        <div className="stock-field">
          <Field label="Kritik Seviye">
            <Input type="number" step="0.001" {...alan("kritikSeviye")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Min. Stok">
            <Input type="number" step="0.001" {...alan("minStok")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Maks. Stok">
            <Input type="number" step="0.001" {...alan("maksStok")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Güvenlik Stoğu">
            <Input type="number" step="0.001" {...alan("guvenlikStogu")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Tedarik Süresi (gün)">
            <Input type="number" min="0" max="365" {...alan("tedarikSuresiGun")} />
          </Field>
        </div>
      </div>

      <div className="stock-editor__actions">
        <Button variant="primary" onClick={kaydet} disabled={!duzenlenebilir}>
          Değişiklikleri Kaydet
        </Button>
        {!duzenlenebilir && (
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
            Bu kartı düzenleme yetkiniz yok.
          </p>
        )}
      </div>
    </Card>
  );
}

/* ─── Hareketler sekmesi (STK-02) ────────────────────────────────────────── */

/* ─── Depolar sekmesi (STK-07) ───────────────────────────────────────────── */

function DepolarSekmesi({
  detay,
  satirlar,
}: {
  detay: StokDetay;
  satirlar: DepoBakiyeSatiri[];
}) {
  return (
    <Card pad={false}>
      <TableWrap>
        <thead>
          <tr>
            <th>Depo</th>
            <th className="num">Mevcut</th>
            <th className="num">Rezerve</th>
            <th className="num">Kullanılabilir</th>
            <th className="num">Yoldaki</th>
          </tr>
        </thead>
        <tbody>
          {satirlar.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty">
                Bu ürünün henüz hiçbir depoda bakiyesi yok.
              </td>
            </tr>
          ) : (
            <>
              {satirlar.map((s) => (
                <tr key={s.depoId}>
                  <td>
                    <span className="mono">{s.depoKod}</span> · {s.depoAd}
                    {!s.depoAktif && " (pasif)"}
                  </td>
                  <td className="num">
                    {adet(s.mevcutMiktar)} {detay.anaBirim}
                  </td>
                  <td className="num">{adet(s.rezerveMiktar)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {adet(s.kullanilabilirMiktar)}
                  </td>
                  <td className="num">{adet(s.yoldakiMiktar)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 700 }}>Toplam</td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {adet(detay.mevcutMiktar)} {detay.anaBirim}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {adet(detay.rezerveMiktar)}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {adet(detay.kullanilabilirMiktar)}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {adet(detay.yoldakiMiktar)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </TableWrap>
    </Card>
  );
}

function PartilerSekmesi({ detay, partiler }: { detay: StokDetay; partiler: Parti[] }) {
  return <Card title="Seri / Lot izlenebilirliği"><p className="muted">Çıkışlar son kullanma tarihi en yakın partiden (FEFO) otomatik karşılanır.</p><TableWrap><thead><tr><th>Lot / Seri</th><th>Varyant</th><th>Depo</th><th>Üretim</th><th>Son kullanma</th><th>Giren</th><th>Kalan</th></tr></thead><tbody>{partiler.map((p) => <tr key={p.id}><td><strong>{p.lotNo}</strong>{p.seriNo && <><br /><small>{p.seriNo}</small></>}</td><td>{p.varyant ? `${p.varyant.kod} — ${p.varyant.ad}` : "—"}</td><td>{p.depo.ad}</td><td>{p.uretimTarihi?.slice(0, 10) ?? "—"}</td><td>{p.sonKullanmaTarihi?.slice(0, 10) ?? "—"}</td><td>{adet(p.ilkMiktar)} {detay.anaBirim}</td><td><strong>{adet(p.kalanMiktar)} {detay.anaBirim}</strong></td></tr>)}{!partiler.length && <tr><td colSpan={7}>Henüz seri/lot girişi yok.</td></tr>}</tbody></TableWrap></Card>;
}

interface VaryantTaslagi { secili: boolean; kod: string; ad: string; nitelikler: Record<string, string>; barkod: string; satisFiyati: string; mevcut: boolean }

/**
 * Varyantlar: nitelik ve değerlerden tüm kombinasyonlar hazırlanır (Renk ×
 * Beden), kod/ad önerilir ve düzeltilebilir, seçilenler tek işlemde açılır.
 * Mevcut varyantların barkod ve fiyatı satırda düzenlenir.
 */
function VaryantlarSekmesi({ detay, onIslem }: { detay: StokDetay; onIslem: (islem: () => Promise<unknown>, mesaj: string) => Promise<boolean> }) {
  const mevcutlar = detay.varyantlar ?? [];
  // Önceki varyantların nitelik adları hazır gelir; aynı düzende devam edilir.
  const oncekiAdlar = [...new Set(mevcutlar.flatMap((v) => Object.keys(v.nitelikler ?? {})))];
  const [nitelikler, setNitelikler] = useState<{ ad: string; degerler: string }[]>(oncekiAdlar.length ? oncekiAdlar.map((ad) => ({ ad, degerler: "" })) : [{ ad: "Renk", degerler: "" }, { ad: "Beden", degerler: "" }]);
  const [taslaklar, setTaslaklar] = useState<VaryantTaslagi[]>([]);
  const [duzenlenen, setDuzenlenen] = useState<{ id: string; barkod: string; alisFiyati: string; satisFiyati: string } | null>(null);
  const ayniNitelik = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, d]) => b[k]?.toLocaleLowerCase("tr-TR") === d.toLocaleLowerCase("tr-TR"));

  function hazirla() {
    const oneriler = varyantKombinasyonlari(detay.kod, nitelikler.map((n) => ({ ad: n.ad, degerler: n.degerler.split(",") })));
    setTaslaklar(oneriler.map((o) => {
      const mevcut = mevcutlar.some((v) => v.kod === o.kod || ayniNitelik(v.nitelikler ?? {}, o.nitelikler));
      return { ...o, secili: !mevcut, barkod: "", satisFiyati: "", mevcut };
    }));
  }
  const taslakDegistir = (i: number, alan: Partial<VaryantTaslagi>) => setTaslaklar((eski) => eski.map((t, x) => x === i ? { ...t, ...alan } : t));
  const secilenler = taslaklar.filter((t) => t.secili && !t.mevcut);
  async function olustur() {
    const tamam = await onIslem(() => api(`/stok/${detay.id}/varyantlar/toplu`, { method: "POST", body: JSON.stringify({ varyantlar: secilenler.map((t) => ({ kod: t.kod.trim(), ad: t.ad.trim(), nitelikler: t.nitelikler, barkod: t.barkod.trim() || null, satisFiyati: t.satisFiyati || null })) }) }), `${secilenler.length} varyant oluşturuldu.`);
    if (tamam) setTaslaklar([]);
  }
  async function kaydet() {
    if (!duzenlenen) return;
    const tamam = await onIslem(() => api(`/stok/${detay.id}/varyantlar/${duzenlenen.id}`, { method: "PATCH", body: JSON.stringify({ barkod: duzenlenen.barkod.trim() || null, alisFiyati: duzenlenen.alisFiyati || null, satisFiyati: duzenlenen.satisFiyati || null }) }), "Varyant güncellendi.");
    if (tamam) setDuzenlenen(null);
  }

  return <div className="stack">
    <Card title="Varyant üret" actions={<Button size="sm" onClick={() => setNitelikler((eski) => [...eski, { ad: "", degerler: "" }])}>+ Nitelik</Button>}>
      <p className="muted">Her niteliğin değerlerini virgülle yazın; tüm kombinasyonlar hazırlanır. Örn. Renk: Siyah, Beyaz · Beden: S, M, L → 6 varyant.</p>
      <div className="form-grid">
        {nitelikler.map((n, i) => <div key={i} className="row-tight">
          <Field label="Nitelik"><Input value={n.ad} maxLength={40} onChange={(e) => setNitelikler((eski) => eski.map((x, k) => k === i ? { ...x, ad: e.target.value } : x))} placeholder="Renk" /></Field>
          <Field label="Değerler (virgülle)"><Input value={n.degerler} onChange={(e) => setNitelikler((eski) => eski.map((x, k) => k === i ? { ...x, degerler: e.target.value } : x))} placeholder="Siyah, Beyaz, Kırmızı" /></Field>
          {nitelikler.length > 1 && <Button size="sm" variant="danger" onClick={() => setNitelikler((eski) => eski.filter((_, k) => k !== i))}>Sil</Button>}
        </div>)}
        <div><Button variant="primary" onClick={hazirla}>Kombinasyonları hazırla</Button></div>
      </div>
    </Card>
    {!!taslaklar.length && <Card title={`Önizleme — ${secilenler.length} / ${taslaklar.length} seçili`} actions={<Button variant="primary" disabled={!secilenler.length} onClick={() => void olustur()}>Seçilenleri oluştur ({secilenler.length})</Button>} pad={false}>
      <TableWrap><thead><tr><th /><th>Kod</th><th>Ad</th><th>Barkod</th><th className="num">Satış fiyatı</th></tr></thead><tbody>
        {taslaklar.map((t, i) => <tr key={i}>
          <td><input type="checkbox" aria-label={`${t.ad} seç`} disabled={t.mevcut} checked={t.secili && !t.mevcut} onChange={(e) => taslakDegistir(i, { secili: e.target.checked })} /></td>
          <td>{t.mevcut ? <><strong>{t.kod}</strong><br /><Badge variant="neutral">Zaten var</Badge></> : <Input value={t.kod} maxLength={64} onChange={(e) => taslakDegistir(i, { kod: e.target.value })} />}</td>
          <td>{t.mevcut ? t.ad : <Input value={t.ad} maxLength={160} onChange={(e) => taslakDegistir(i, { ad: e.target.value })} />}</td>
          <td>{!t.mevcut && <Input value={t.barkod} maxLength={120} onChange={(e) => taslakDegistir(i, { barkod: e.target.value })} placeholder="İsteğe bağlı" />}</td>
          <td>{!t.mevcut && <Input type="number" min="0" step="0.0001" value={t.satisFiyati} onChange={(e) => taslakDegistir(i, { satisFiyati: e.target.value })} placeholder="Kart fiyatı" />}</td>
        </tr>)}
      </tbody></TableWrap>
    </Card>}
    <Card title={`Varyantlar (${mevcutlar.length})`} pad={false}><TableWrap><thead><tr><th>Kod</th><th>Ad / Nitelikler</th><th>Barkod</th><th>Stok</th><th className="num">Alış</th><th className="num">Satış</th><th>Durum</th><th /></tr></thead><tbody>
      {mevcutlar.map((v) => duzenlenen?.id === v.id
        ? <tr key={v.id}><td>{v.kod}</td><td><strong>{v.ad}</strong></td>
            <td><Input value={duzenlenen.barkod} maxLength={120} onChange={(e) => setDuzenlenen({ ...duzenlenen, barkod: e.target.value })} /></td><td>{adet(v.mevcutMiktar)} {detay.anaBirim}</td>
            <td><Input type="number" min="0" step="0.0001" value={duzenlenen.alisFiyati} onChange={(e) => setDuzenlenen({ ...duzenlenen, alisFiyati: e.target.value })} placeholder="Kart fiyatı" /></td>
            <td><Input type="number" min="0" step="0.0001" value={duzenlenen.satisFiyati} onChange={(e) => setDuzenlenen({ ...duzenlenen, satisFiyati: e.target.value })} placeholder="Kart fiyatı" /></td>
            <td /><td><div className="row-tight"><Button size="sm" variant="primary" onClick={() => void kaydet()}>Kaydet</Button><Button size="sm" onClick={() => setDuzenlenen(null)}>Vazgeç</Button></div></td></tr>
        : <tr key={v.id}><td>{v.kod}</td><td><strong>{v.ad}</strong><br /><small>{Object.entries(v.nitelikler ?? {}).map(([k, d]) => `${k}: ${d}`).join(" · ")}</small></td><td>{v.barkod ?? "—"}</td><td>{adet(v.mevcutMiktar)} {detay.anaBirim}</td>
            <td className="num">{v.alisFiyati ? tl(v.alisFiyati) : "Kart fiyatı"}</td><td className="num">{v.satisFiyati ? tl(v.satisFiyati) : "Kart fiyatı"}</td>
            <td><Button variant="ghost" size="sm" onClick={() => void onIslem(() => api(`/stok/${detay.id}/varyantlar/${v.id}`, { method: "PATCH", body: JSON.stringify({ aktif: !v.aktif }) }), v.aktif ? "Varyant pasifleştirildi." : "Varyant etkinleştirildi.")}>{v.aktif ? "Aktif" : "Pasif"}</Button></td>
            <td><Button size="sm" onClick={() => setDuzenlenen({ id: v.id, barkod: v.barkod ?? "", alisFiyati: v.alisFiyati ?? "", satisFiyati: v.satisFiyati ?? "" })}>Düzenle</Button></td></tr>)}
      {!mevcutlar.length && <tr><td colSpan={8}>Henüz varyant yok. Yukarıdan nitelik ve değerleri girip kombinasyonları hazırlayın.</td></tr>}
    </tbody></TableWrap></Card>
  </div>;
}

function HareketlerSekmesi({
  detay,
  hareketler,
  ozet,
  suzgec,
  onSuzgec,
  dahaVar,
  onDahaFazla,
  onEkle,
}: {
  detay: StokDetay;
  hareketler: Hareket[];
  ozet: HareketOzeti | null;
  suzgec: HareketSuzgeci;
  onSuzgec: (suzgec: HareketSuzgeci) => void;
  dahaVar: boolean;
  onDahaFazla: () => void;
  onEkle: (govde: Record<string, unknown>) => Promise<boolean>;
}) {
  const { cokluDepo } = useDepolar();
  const [formAcik, setFormAcik] = useState(false);
  const [tip, setTip] = useState("giris");
  const [girilenMiktar, setGirilenMiktar] = useState("");
  const [girilenBirim, setGirilenBirim] = useState(detay.anaBirim);
  const [maliyet, setMaliyet] = useState("0");
  const [tarih, setTarih] = useState(bugun());
  const [aciklama, setAciklama] = useState("");
  const [depoId, setDepoId] = useState("");
  const [varyantId, setVaryantId] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [seriNolar, setSeriNolar] = useState("");
  const [sonKullanmaTarihi, setSonKullanmaTarihi] = useState("");
  const [uretimTarihi, setUretimTarihi] = useState("");

  /** Seçili birimin ana birim karşılığı; ana birim için katsayı 1. */
  const katsayi =
    girilenBirim === detay.anaBirim
      ? 1
      : Number(detay.birimler.find((b) => b.ad === girilenBirim)?.katsayi ?? 1);
  const anaBirimMiktar = girilenMiktar ? Number(girilenMiktar) * katsayi : 0;

  async function kaydet() {
    const girisMi = HAREKET_TIPLERI.find((h) => h.deger === tip)?.yon === "giris";
    const seriler = seriNolar.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean);
    const partiler = !girisMi || (detay.takipTipi ?? "yok") === "yok" ? [] : detay.takipTipi === "seri"
      ? seriler.map((seriNo) => ({ lotNo: lotNo || seriNo, seriNo, sonKullanmaTarihi: sonKullanmaTarihi || null, uretimTarihi: uretimTarihi || null, miktar: "1" }))
      : [{ lotNo, seriNo: null, sonKullanmaTarihi: sonKullanmaTarihi || null, uretimTarihi: uretimTarihi || null, miktar: anaBirimMiktar.toFixed(3) }];
    const eklendi = await onEkle({
      stokId: detay.id,
      varyantId: varyantId || null,
      depoId: depoId || null,
      tip,
      // Ana birim cinsinden miktar; API girilen değeri kendi çevirmez.
      miktar: anaBirimMiktar.toFixed(3),
      girilenBirim,
      girilenMiktar: Number(girilenMiktar).toFixed(3),
      maliyet: (maliyet || "0").toString(),
      tarih,
      aciklama: aciklama.trim() === "" ? null : aciklama.trim(),
      partiler,
    });
    if (eklendi) {
      setGirilenMiktar("");
      setAciklama("");
      setFormAcik(false);
    }
  }

  const yon = (t: string) => TUM_HAREKET_TIPLERI.find((h) => h.deger === t)?.yon ?? "duzeltme";
  // STK-36: liste yeniden eskiye; her satırın bakiyesi son bakiyeden üstteki
  // satırların miktarı düşülerek bulunur (sayfalar eklendikçe de geçerli).
  const bakiyeler: number[] = [];
  if (ozet) {
    let kalan = Number(ozet.sonBakiye);
    for (const h of hareketler) { bakiyeler.push(kalan); kalan -= Number(h.miktar); }
  }
  const baslik = (t: string) => TUM_HAREKET_TIPLERI.find((h) => h.deger === t)?.baslik ?? t;

  return (
    <div className="stack">
      <Card>
        <div className="between">
          <div className="card__title" style={{ margin: 0 }}>
            Stok Hareketleri
          </div>
          <Button variant={formAcik ? "ghost" : "primary"} size="sm" onClick={() => setFormAcik(!formAcik)}>
            {formAcik ? "Vazgeç" : "➕ Hareket Ekle"}
          </Button>
        </div>

        {formAcik && (
          <div className="stack" style={{ marginTop: "1rem" }}>
            {(detay.takipTipi ?? "yok") !== "yok" && HAREKET_TIPLERI.find((h) => h.deger === tip)?.yon === "giris" && <div className="row"><div style={{ flex: 1, minWidth: 160 }}><Field label="Lot / Parti No"><Input required value={lotNo} onChange={(e) => setLotNo(e.target.value)} /></Field></div>{detay.takipTipi === "seri" && <div style={{ flex: 2, minWidth: 240 }}><Field label="Seri numaraları (virgülle)"><Input required value={seriNolar} onChange={(e) => setSeriNolar(e.target.value)} placeholder="SN001, SN002" /></Field></div>}<div style={{ flex: 1, minWidth: 160 }}><Field label="Üretim tarihi"><Input type="date" value={uretimTarihi} onChange={(e) => setUretimTarihi(e.target.value)} /></Field></div><div style={{ flex: 1, minWidth: 160 }}><Field label="Son kullanma"><Input type="date" value={sonKullanmaTarihi} onChange={(e) => setSonKullanmaTarihi(e.target.value)} /></Field></div></div>}
            <div className="row">
              {(detay.varyantlar?.length ?? 0) > 0 && <div style={{ flex: 1, minWidth: 170 }}><Field label="Varyant"><Select required value={varyantId} onChange={(e) => setVaryantId(e.target.value)}><option value="">Seçin</option>{(detay.varyantlar ?? []).filter((v) => v.aktif).map((v) => <option key={v.id} value={v.id}>{v.kod} — {v.ad}</option>)}</Select></Field></div>}
              <div style={{ flex: 1, minWidth: 170 }}>
                <Field label="Hareket Tipi">
                  <Select value={tip} onChange={(e) => setTip(e.target.value)}>
                    {HAREKET_TIPLERI.map((h) => (
                      <option key={h.deger} value={h.deger}>
                        {h.baslik}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <Field label="Miktar *">
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    value={girilenMiktar}
                    onChange={(e) => setGirilenMiktar(e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <Field label="Birim">
                  <Select value={girilenBirim} onChange={(e) => setGirilenBirim(e.target.value)}>
                    <option value={detay.anaBirim}>{detay.anaBirim} (ana birim)</option>
                    {detay.birimler.map((b) => (
                      <option key={b.id} value={b.ad}>
                        {b.ad} (×{adet(b.katsayi)})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <Field label={HAREKET_TIPLERI.find((h) => h.deger === tip)?.yon === "giris" ? "Birim Maliyet (TRY) *" : "Birim Maliyet (TRY)"}>
                  {/* STK-34: elle girişte maliyet zorunlu; çıkışta ortalama maliyet kullanılır. */}
                  <Input
                    type="number"
                    step="0.0001"
                    min={HAREKET_TIPLERI.find((h) => h.deger === tip)?.yon === "giris" ? "0.0001" : "0"}
                    required={HAREKET_TIPLERI.find((h) => h.deger === tip)?.yon === "giris"}
                    disabled={HAREKET_TIPLERI.find((h) => h.deger === tip)?.yon !== "giris"}
                    value={maliyet}
                    onChange={(e) => setMaliyet(e.target.value)}
                  />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <Field label="Tarih *">
                  <Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <DepoSecici deger={depoId} onChange={setDepoId} />
              </div>
            </div>

            <Field label="Açıklama">
              <Input value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Örn. Fatura dışı giriş" />
            </Field>

            {girilenBirim !== detay.anaBirim && girilenMiktar && (
              <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                {adet(girilenMiktar)} {girilenBirim} × {adet(katsayi)} ={" "}
                <strong>
                  {adet(anaBirimMiktar)} {detay.anaBirim}
                </strong>{" "}
                stoğa işlenecek.
              </p>
            )}

            <div>
              <Button variant="primary" onClick={kaydet} disabled={!girilenMiktar || Number(girilenMiktar) <= 0}>
                Hareketi Kaydet
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="row" style={{ alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Başlangıç"><Input type="date" value={suzgec.baslangic} onChange={(e) => onSuzgec({ ...suzgec, baslangic: e.target.value })} /></Field>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Bitiş"><Input type="date" value={suzgec.bitis} onChange={(e) => onSuzgec({ ...suzgec, bitis: e.target.value })} /></Field>
        </div>
        {cokluDepo && <div style={{ flex: 1, minWidth: 180 }}><DepoSecici deger={suzgec.depoId} onChange={(depoId) => onSuzgec({ ...suzgec, depoId })} /></div>}
        <label className="check-row" style={{ flex: 1, minWidth: 170 }}>
          <input type="checkbox" checked={suzgec.iptaller} onChange={(e) => onSuzgec({ ...suzgec, iptaller: e.target.checked })} />
          İptalleri de göster
        </label>
      </div>
      {ozet && (
        <StatGrid>
          {suzgec.baslangic && <Stat label="Devir" value={`${adet(ozet.devir)} ${detay.anaBirim}`} hint={`${suzgec.baslangic} öncesi`} />}
          <Stat label="Giriş" value={`${adet(ozet.giris)} ${detay.anaBirim}`} />
          <Stat label="Çıkış" value={`${adet(ozet.cikis)} ${detay.anaBirim}`} />
          <Stat label={suzgec.bitis ? "Dönem sonu bakiye" : "Bakiye"} value={`${adet(ozet.sonBakiye)} ${detay.anaBirim}`} hint={`${ozet.kayitSayisi} hareket`} />
        </StatGrid>
      )}
      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Tarih</th>
              {cokluDepo && <th>Depo</th>}
              <th>Tip</th>
              <th className="num">Girilen</th>
              <th className="num">Ana Birim</th>
              <th className="num">Bakiye</th>
              <th className="num">Birim Maliyet</th>
              <th>Kaynak</th>
              <th>Açıklama</th>
            </tr>
          </thead>
          <tbody>
            {hareketler.length === 0 ? (
              <tr>
                <td colSpan={cokluDepo ? 9 : 8} className="empty">
                  {suzgec.baslangic || suzgec.bitis ? "Seçilen aralıkta stok hareketi yok." : "Bu ürün için henüz stok hareketi yok."}
                </td>
              </tr>
            ) : (
              hareketler.map((h, i) => {
                const y = yon(h.tip);
                // miktar API'de işaretli saklanır (çıkışlarda eksi); işareti biz eklemiyoruz.
                const degisim = Number(h.miktar);
                return (
                  <tr key={h.id} style={h.iptal ? { opacity: 0.6 } : undefined}>
                    <td className="mono">{h.tarih.slice(0, 10)}</td>
                    {cokluDepo && <td>{h.depo?.ad ?? "—"}</td>}
                    <td>
                      <Badge variant={y === "giris" ? "success" : y === "cikis" ? "danger" : "info"}>
                        {baslik(h.tip)}
                      </Badge>
                      {h.iptal && <> <Badge variant="neutral">İptal</Badge></>}
                    </td>
                    <td className="num">
                      {adet(h.girilenMiktar)} {h.girilenBirim}
                      {h.varyant && <><br /><small>{h.varyant.kod} — {h.varyant.ad}</small></>}
                    </td>
                    <td
                      className="num"
                      style={{ fontWeight: 700, color: degisim < 0 ? "var(--danger)" : "var(--success)" }}
                    >
                      {degisim > 0 ? "+" : ""}
                      {adet(degisim)} {detay.anaBirim}
                    </td>
                    <td className="num">{bakiyeler[i] !== undefined ? adet(bakiyeler[i]) : "—"}</td>
                    <td className="num">{Number(h.maliyet) > 0 ? tl(h.maliyet) : "—"}</td>
                    <td>
                      <span className="muted" style={{ fontSize: "0.85rem" }}>
                        {h.kaynakTur === "manuel" ? "Manuel" : h.kaynakTur}
                      </span>
                    </td>
                    <td>{h.aciklama ?? "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>
      {dahaVar && (
        <div>
          <Button variant="ghost" onClick={onDahaFazla}>Daha fazla yükle</Button>
        </div>
      )}
    </div>
  );
}

/* ─── Birimler sekmesi (STK-10) ──────────────────────────────────────────── */

function BirimlerSekmesi({
  detay,
  onEkle,
  onSil,
}: {
  detay: StokDetay;
  onEkle: (govde: Record<string, unknown>) => Promise<boolean>;
  onSil: (birimId: string) => void;
}) {
  const [ad, setAd] = useState("");
  const [katsayi, setKatsayi] = useState("");

  async function ekle() {
    const eklendi = await onEkle({ ad: ad.trim(), katsayi: Number(katsayi).toFixed(6) });
    if (eklendi) {
      setAd("");
      setKatsayi("");
    }
  }

  return (
    <div className="stack">
      <Card>
        <div className="card__title">Ek Birim Ekle</div>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
          Katsayı, bir ek birimin kaç <strong>{detay.anaBirim}</strong> ettiğidir. Örnek: 1 koli = 12 adet ise katsayı 12.
        </p>
        <div className="row">
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Birim Adı *">
              <BirimSecimi value={ad} onChange={setAd} haric={[detay.anaBirim, ...detay.birimler.map((b) => b.ad)]} />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label={`Katsayı (1 birim = ? ${detay.anaBirim}) *`}>
              <Input
                type="number"
                step="0.000001"
                min="0"
                value={katsayi}
                onChange={(e) => setKatsayi(e.target.value)}
                placeholder="12"
              />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button variant="primary" onClick={ekle} disabled={!ad.trim() || !katsayi || Number(katsayi) <= 0}>
              ➕ Ekle
            </Button>
          </div>
        </div>
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Birim</th>
              <th className="num">Katsayı</th>
              <th>Karşılığı</th>
              <th className="center">Eylem</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>{detay.anaBirim}</strong>
              </td>
              <td className="num">1</td>
              <td>
                <Badge variant="accent">Ana birim</Badge>
              </td>
              <td className="center">—</td>
            </tr>
            {detay.birimler.map((b) => (
              <tr key={b.id}>
                <td>{b.ad}</td>
                <td className="num">{adet(b.katsayi)}</td>
                <td>
                  1 {b.ad} = {adet(b.katsayi)} {detay.anaBirim}
                </td>
                <td className="center">
                  <Button size="sm" variant="danger" onClick={() => onSil(b.id)}>
                    Sil
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

/* ─── Barkodlar sekmesi (STK-15) ─────────────────────────────────────────── */

function BarkodlarSekmesi({
  detay,
  onEkle,
  onSil,
  onHata,
}: {
  detay: StokDetay;
  onEkle: (govde: Record<string, unknown>) => Promise<boolean>;
  onSil: (barkodId: string) => void;
  onHata: (mesaj: string) => void;
}) {
  const [barkod, setBarkod] = useState("");
  const [birim, setBirim] = useState("");
  const [satisFiyati, setSatisFiyati] = useState("");
  const [etiketAdet, setEtiketAdet] = useState("1");
  const [etiketBarkod, setEtiketBarkod] = useState("");

  async function ekle() {
    const eklendi = await onEkle({
      barkod: barkod.trim(),
      birim: birim === "" ? null : birim,
      satisFiyati: satisFiyati.trim() === "" ? null : satisFiyati,
    });
    if (eklendi) {
      setBarkod("");
      setBirim("");
      setSatisFiyati("");
    }
  }

  /** Etiket PDF'i JSON değil blob döner; api() kullanılamaz. */
  async function etiketBas() {
    try {
      const res = await fetch(`${apiBase()}/stok/etiketler`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAl()}` },
        body: JSON.stringify({
          kalemler: [
            {
              stokId: detay.id,
              adet: Number(etiketAdet) || 1,
              ...(etiketBarkod ? { barkod: etiketBarkod } : {}),
            },
          ],
        }),
      });
      if (!res.ok) {
        const govde = await res.json().catch(() => ({}));
        throw new Error(govde.message || "Etiket PDF'i alınamadı");
      }
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (h) {
      onHata(h instanceof Error ? h.message : "Etiket basılamadı");
    }
  }

  return (
    <div className="stack">
      <Card>
        <div className="card__title">Barkod Ekle</div>
        <div className="row">
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label="Barkod *">
              <Input value={barkod} onChange={(e) => setBarkod(e.target.value)} placeholder="8690000000000" />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Birim">
              <Select value={birim} onChange={(e) => setBirim(e.target.value)}>
                <option value="">{detay.anaBirim} (ana birim)</option>
                {detay.birimler.map((b) => (
                  <option key={b.id} value={b.ad}>
                    {b.ad}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Satış Fiyatı (TRY)">
              <Input
                type="number"
                step="0.0001"
                value={satisFiyati}
                onChange={(e) => setSatisFiyati(e.target.value)}
                placeholder="Kart fiyatı kullanılır"
              />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button variant="primary" onClick={ekle} disabled={barkod.trim().length < 3}>
              ➕ Ekle
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="card__title">🏷️ Etiket Bas</div>
        <div className="row">
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label="Barkod">
              <Select value={etiketBarkod} onChange={(e) => setEtiketBarkod(e.target.value)}>
                <option value="">— İlk barkod —</option>
                {detay.barkodlar.map((b) => (
                  <option key={b.id} value={b.barkod}>
                    {b.barkod}
                    {b.birim ? ` (${b.birim})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <Field label="Adet">
              <Input
                type="number"
                min="1"
                max="500"
                value={etiketAdet}
                onChange={(e) => setEtiketAdet(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button onClick={etiketBas} disabled={detay.barkodlar.length === 0}>
              🖨️ Etiket PDF&apos;i Aç
            </Button>
          </div>
        </div>
        {detay.barkodlar.length === 0 && (
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
            Etiket basmak için önce en az bir barkod eklemelisiniz.
          </p>
        )}
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Barkod</th>
              <th>Birim</th>
              <th className="num">Satış Fiyatı</th>
              <th className="center">Eylem</th>
            </tr>
          </thead>
          <tbody>
            {detay.barkodlar.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">
                  Bu ürüne tanımlı barkod yok.
                </td>
              </tr>
            ) : (
              detay.barkodlar.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.barkod}</td>
                  <td>{b.birim ?? detay.anaBirim}</td>
                  <td className="num">{b.satisFiyati ? tl(b.satisFiyati) : "—"}</td>
                  <td className="center">
                    <Button size="sm" variant="danger" onClick={() => onSil(b.id)}>
                      Sil
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

/* ─── Tedarikçiler sekmesi (STK-18) ──────────────────────────────────────── */

function TedarikcilerSekmesi({
  detay,
  cariler,
  onEkle,
  onSil,
}: {
  detay: StokDetay;
  cariler: CariOzet[];
  onEkle: (govde: Record<string, unknown>, mesaj?: string) => Promise<boolean>;
  onSil: (tedarikciId: string) => void;
}) {
  // STK-23: varyantlı kartta tedarikçinin varyant başına kodu.
  const varyantlar = (detay.varyantlar ?? []).filter((v) => v.aktif);
  const [kodDuzenlenen, setKodDuzenlenen] = useState<string | null>(null);
  const [varyantKodlari, setVaryantKodlari] = useState<Record<string, string>>({});

  function kodlariAc(t: Tedarikci) {
    setKodDuzenlenen(t.id);
    setVaryantKodlari(Object.fromEntries((t.varyantKodlari ?? []).map((k) => [k.varyantId, k.tedarikciUrunKodu])));
  }

  async function kodlariKaydet(t: Tedarikci) {
    const kaydedildi = await onEkle({
      cariId: t.cariId,
      tedarikciUrunKodu: t.tedarikciUrunKodu,
      alisFiyati: t.alisFiyati,
      dovizCinsi: t.dovizCinsi,
      tedarikSuresiGun: t.tedarikSuresiGun,
      varsayilan: t.varsayilan,
      varyantKodlari: Object.entries(varyantKodlari)
        .map(([varyantId, kod]) => ({ varyantId, tedarikciUrunKodu: kod.trim() }))
        .filter((k) => k.tedarikciUrunKodu !== ""),
    }, "Varyant kodları kaydedildi.");
    if (kaydedildi) setKodDuzenlenen(null);
  }

  const [cariId, setCariId] = useState("");
  const [urunKodu, setUrunKodu] = useState("");
  const [alisFiyati, setAlisFiyati] = useState("");
  const [dovizCinsi, setDovizCinsi] = useState("TRY");
  const [tedarikSuresiGun, setTedarikSuresiGun] = useState("");
  const [varsayilan, setVarsayilan] = useState(false);

  async function ekle() {
    const eklendi = await onEkle({
      cariId,
      tedarikciUrunKodu: urunKodu.trim() === "" ? null : urunKodu.trim(),
      alisFiyati: alisFiyati.trim() === "" ? null : alisFiyati,
      dovizCinsi,
      tedarikSuresiGun: tedarikSuresiGun.trim() === "" ? null : Number(tedarikSuresiGun),
      varsayilan,
    });
    if (eklendi) {
      setCariId("");
      setUrunKodu("");
      setAlisFiyati("");
      setTedarikSuresiGun("");
      setVarsayilan(false);
    }
  }

  const bagliCariIdler = new Set(detay.tedarikciler.map((t) => t.cariId));

  return (
    <div className="stack">
      <Card>
        <div className="card__title">Tedarikçi Ekle</div>
        <div className="row">
          <div style={{ flex: 2, minWidth: 220 }}>
            <Field label="Cari *">
              <Select aria-label="Cari" value={cariId} onChange={(e) => setCariId(e.target.value)}>
                <option value="">— Cari seçin —</option>
                {cariler
                  .filter((c) => !bagliCariIdler.has(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.kod} · {c.unvan}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Tedarikçi Ürün Kodu">
              <Input value={urunKodu} onChange={(e) => setUrunKodu(e.target.value)} />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <Field label="Alış Fiyatı">
              <Input
                type="number"
                step="0.0001"
                value={alisFiyati}
                onChange={(e) => setAlisFiyati(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <Field label="Döviz">
              <Select value={dovizCinsi} onChange={(e) => setDovizCinsi(e.target.value)}>
                <DovizSecenekleri />
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <Field label="Tedarik Süresi (gün)">
              <Input
                type="number"
                min="0"
                max="365"
                value={tedarikSuresiGun}
                onChange={(e) => setTedarikSuresiGun(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <div className="between" style={{ marginTop: "0.75rem" }}>
          <label className="row-tight" style={{ alignItems: "center", cursor: "pointer", fontSize: "0.9rem" }}>
            <input type="checkbox" checked={varsayilan} onChange={(e) => setVarsayilan(e.target.checked)} />
            Varsayılan tedarikçi olarak işaretle
          </label>
          <Button variant="primary" onClick={ekle} disabled={!cariId}>
            ➕ Ekle
          </Button>
        </div>
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Cari</th>
              <th>Tedarikçi Ürün Kodu</th>
              {varyantlar.length > 0 && <th>Varyant Kodları</th>}
              <th className="num">Alış Fiyatı</th>
              <th className="num">Tedarik Süresi</th>
              <th className="center">Eylem</th>
            </tr>
          </thead>
          <tbody>
            {detay.tedarikciler.length === 0 ? (
              <tr>
                <td colSpan={varyantlar.length > 0 ? 6 : 5} className="empty">
                  Bu ürüne bağlı tedarikçi yok.
                </td>
              </tr>
            ) : (
              detay.tedarikciler.map((t) => (
                <Fragment key={t.id}>
                <tr>
                  <td>
                    <div className="cell-entity__name">
                      {t.cari.unvan} {t.varsayilan && <Badge variant="accent">Varsayılan</Badge>}
                    </div>
                    <div className="cell-entity__meta">{t.cari.kod}</div>
                  </td>
                  <td className="mono">{t.tedarikciUrunKodu ?? "—"}</td>
                  {varyantlar.length > 0 && (
                    <td>
                      {(t.varyantKodlari ?? []).length > 0 ? (
                        <div className="cell-entity__meta">
                          {(t.varyantKodlari ?? []).map((k) => `${varyantlar.find((v) => v.id === k.varyantId)?.ad ?? "?"}: ${k.tedarikciUrunKodu}`).join(" · ")}
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => (kodDuzenlenen === t.id ? setKodDuzenlenen(null) : kodlariAc(t))}>
                        {kodDuzenlenen === t.id ? "Kapat" : "Düzenle"}
                      </Button>
                    </td>
                  )}
                  <td className="num">
                    {t.alisFiyati
                      ? `${Number(t.alisFiyati).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${t.dovizCinsi}`
                      : "—"}
                  </td>
                  <td className="num">{t.tedarikSuresiGun !== null ? `${t.tedarikSuresiGun} gün` : "—"}</td>
                  <td className="center">
                    <Button size="sm" variant="danger" onClick={() => onSil(t.id)}>
                      Sil
                    </Button>
                  </td>
                </tr>
                {kodDuzenlenen === t.id && (
                  <tr>
                    <td colSpan={6} style={{ whiteSpace: "normal" }}>
                      <p className="muted" style={{ margin: "0 0 0.6rem" }}>
                        {t.cari.unvan} bu varyantları kendi koduyla faturalıyorsa yazın; gelen e-Fatura ve e-İrsaliye satırı doğrudan o varyanta düşer. Boş bırakılan varyantta kart düzeyindeki kod geçerlidir.
                      </p>
                      <div className="form-grid">
                        {varyantlar.map((v) => (
                          <Field key={v.id} label={`${v.kod} — ${v.ad}`}>
                            <Input
                              value={varyantKodlari[v.id] ?? ""}
                              maxLength={64}
                              onChange={(e) => setVaryantKodlari((eski) => ({ ...eski, [v.id]: e.target.value }))}
                            />
                          </Field>
                        ))}
                        <div className="row-tight">
                          <Button variant="primary" size="sm" onClick={() => void kodlariKaydet(t)}>Kaydet</Button>
                          <Button size="sm" onClick={() => setKodDuzenlenen(null)}>Vazgeç</Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

/* ─── Vergiler sekmesi (EBLG-125) ────────────────────────────────────────── */

type VergiSatiri = { kod: string; hesap: "oran" | "birim"; deger: string };

/**
 * Ürünün KDV dışı vergileri (ÖTV, ÖİV, konaklama…). Ürün satış ya da alış
 * faturasına eklenince bu vergiler satıra gelir; stopaj ve KDV matrahı kuralı
 * vergi türünün Mevzuat Merkezi'ndeki kaydından gelir.
 */
function VergilerSekmesi({ detay, onKaydet }: { detay: StokDetay; onKaydet: (vergiler: VergiSatiri[]) => Promise<boolean> }) {
  const tablo = useKodTablosu(null);
  const [satirlar, setSatirlar] = useState<VergiSatiri[]>(detay.ekVergiler ?? []);
  const [degisti, setDegisti] = useState(false);
  useEffect(() => { setSatirlar(detay.ekVergiler ?? []); setDegisti(false); }, [detay.ekVergiler]);
  const guncelle = (i: number, ek: Partial<VergiSatiri>) => { setSatirlar((e) => e.map((v, j) => (j === i ? { ...v, ...ek } : v))); setDegisti(true); };
  const tur = (kod: string) => tablo.vergiTurleri.find((t) => t.kod === kod);
  const secili = new Set(satirlar.map((v) => v.kod));
  return (
    <Card
      title="KDV dışı vergiler"
      actions={<div className="row-tight">
        <Button size="sm" onClick={() => { setSatirlar((e) => [...e, { kod: "", hesap: "oran", deger: "" }]); setDegisti(true); }}>+ Vergi ekle</Button>
        <Button size="sm" variant="primary" disabled={!degisti || satirlar.some((v) => !v.kod || !(Number(v.deger) > 0))} onClick={() => void onKaydet(satirlar.map((v) => ({ ...v, deger: String(Number(v.deger)) }))).then((ok) => ok && setDegisti(false))}>Kaydet</Button>
      </div>}
    >
      <p className="muted" style={{ marginTop: 0 }}>Ürün satış ya da alış faturasına eklenince bu vergiler satıra gelir. Oran satır matrahına, birim başı tutar satır miktarına uygulanır (ör. litre başına ÖTV). Stopaj ödenecek tutardan düşer; KDV matrahına dahil vergiler KDV'yi de artırır.</p>
      <TableWrap>
        <thead><tr><th>Vergi türü</th><th>Hesap</th><th className="num">Değer</th><th>Kural</th><th /></tr></thead>
        <tbody>
          {satirlar.map((v, i) => {
            const t = tur(v.kod);
            return (
              <tr key={i}>
                <td>
                  <Select aria-label="Vergi türü" value={v.kod} onChange={(e) => guncelle(i, { kod: e.target.value })}>
                    <option value="">Seçin</option>
                    {tablo.vergiTurleri.filter((x) => x.kod === v.kod || !secili.has(x.kod)).map((x) => <option key={x.kod} value={x.kod}>{x.kod} — {x.ad}</option>)}
                  </Select>
                </td>
                <td>
                  <Select aria-label="Hesap" value={v.hesap} onChange={(e) => guncelle(i, { hesap: e.target.value as VergiSatiri["hesap"] })}>
                    <option value="oran">Oran (%)</option>
                    <option value="birim">Birim başı tutar (TL / {detay.anaBirim})</option>
                  </Select>
                </td>
                <td className="num"><Input aria-label="Değer" type="number" min="0" step="0.0001" max={v.hesap === "oran" ? 100 : undefined} value={v.deger} onChange={(e) => guncelle(i, { deger: e.target.value })} style={{ maxWidth: "9rem" }} /></td>
                <td className="muted">{t ? [t.stopaj ? "Stopaj — ödenecekten düşer" : "Bedele eklenir", t.kdvMatrahinaDahil ? "KDV matrahına dahil" : "KDV matrahına dahil değil"].join(" · ") : "—"}</td>
                <td><Button size="sm" variant="danger" onClick={() => { setSatirlar((e) => e.filter((_, j) => j !== i)); setDegisti(true); }}>Sil</Button></td>
              </tr>
            );
          })}
          {!satirlar.length && <tr><td colSpan={5} className="muted">Bu ürüne KDV dışı vergi tanımlanmamış.</td></tr>}
        </tbody>
      </TableWrap>
    </Card>
  );
}
