"use client";

import { useCallback, useEffect, useState } from "react";
import { ROLLER, type Rol } from "@tekirextra/shared";
import { api, tokenAl } from "@/lib/api";
import { ROL_ADI } from "@/lib/rol-adlari";
import { Alert, Badge, Button, Card, Field, PageHeader, Select, TableWrap } from "@/components/ui";

interface Politika {
  ikiAdimZorunluRoller: Rol[];
  oturumSuresiGun: number;
  hareketsizlikDk: number | null;
  /** Rol → 2FA'sı kurulmamış aktif kullanıcı sayısı. */
  ikiAdimsizKullanicilar: Partial<Record<Rol, number>>;
}

const HAREKETSIZLIK = [
  { deger: "", ad: "Kapalı" },
  { deger: "15", ad: "15 dakika" },
  { deger: "30", ad: "30 dakika" },
  { deger: "60", ad: "1 saat" },
  { deger: "240", ad: "4 saat" },
];
const OTURUM_GUNLERI = [1, 3, 7, 14, 30];

/** KLN-24: TekirExtra ekibine süreli, salt okunur destek erişimi. */
interface DestekDurumu {
  izin: { sureSaat: number; baslangic: string; bitis: string; veren: string } | null;
  oturumlar: { id: string; platformKullaniciAdi: string; acilis: string; bitis: string; kapanis: string | null; kapanisNedeni: string | null; acik: boolean }[];
}
const DESTEK_SURELERI = [{ saat: 1, ad: "1 saat" }, { saat: 24, ad: "24 saat" }, { saat: 168, ad: "7 gün" }];
const zaman = (s: string) => new Date(s).toLocaleString("tr-TR");
const KAPANIS_NEDENI: Record<string, string> = { izin_geri_alindi: "izin geri alındı", platform_kapatti: "destek ekibi kapattı" };

/** KLN-21/22: firma genelinde 2FA zorunluluğu ve oturum süresi. */
export default function GuvenlikPolitikasiSayfasi() {
  const [politika, setPolitika] = useState<Politika | null>(null);
  const [roller, setRoller] = useState<Set<Rol>>(new Set());
  const [gun, setGun] = useState(30);
  const [hareketsizlik, setHareketsizlik] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [destek, setDestek] = useState<DestekDurumu | null>(null);
  const [destekSure, setDestekSure] = useState(24);
  const [destekMesaji, setDestekMesaji] = useState<{ ton: "success" | "error"; metin: string } | null>(null);

  const yukle = useCallback(async () => {
    const p = await api<Politika>("/guvenlik-politikasi");
    setPolitika(p);
    setRoller(new Set(p.ikiAdimZorunluRoller));
    setGun(p.oturumSuresiGun);
    setHareketsizlik(p.hareketsizlikDk ? String(p.hareketsizlikDk) : "");
  }, []);
  useEffect(() => { if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Politika yüklenemedi (yalnız yönetici görebilir)")); }, [yukle]);
  const destekYukle = useCallback(async () => setDestek(await api<DestekDurumu>("/destek-izni")), []);
  useEffect(() => { if (tokenAl()) void destekYukle().catch(() => undefined); }, [destekYukle]);

  async function destekIslem(yol: string, govde?: unknown) {
    setDestekMesaji(null);
    try {
      const s = await api<{ mesaj: string }>(yol, { method: "POST", ...(govde ? { body: JSON.stringify(govde) } : {}) });
      setDestekMesaji({ ton: "success", metin: s.mesaj });
      await destekYukle();
    } catch (h) {
      setDestekMesaji({ ton: "error", metin: h instanceof Error ? h.message : "İşlem başarısız" });
    }
  }

  function rolDegistir(rol: Rol, secili: boolean) {
    setRoller((onceki) => {
      const yeni = new Set(onceki);
      if (secili) yeni.add(rol);
      else yeni.delete(rol);
      return yeni;
    });
  }

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setKaydediliyor(true);
    setHata("");
    setBasari("");
    try {
      await api("/guvenlik-politikasi", {
        method: "PUT",
        body: JSON.stringify({ ikiAdimZorunluRoller: [...roller], oturumSuresiGun: gun, hareketsizlikDk: hareketsizlik ? Number(hareketsizlik) : null }),
      });
      await yukle();
      setBasari("Politika kaydedildi. 2FA zorunluluğu kullanıcıların bir sonraki isteğinde, oturum süreleri bir sonraki oturum yenilemesinde uygulanır.");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Politika kaydedilemedi");
    } finally {
      setKaydediliyor(false);
    }
  }

  // Yalnız yeni eklenen roller: kayıtlı rollerdekiler zaten kurulum ekranına yönleniyor.
  const etkilenecek = [...roller]
    .filter((r) => !politika?.ikiAdimZorunluRoller.includes(r))
    .reduce((t, r) => t + (politika?.ikiAdimsizKullanicilar[r] ?? 0), 0);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <PageHeader title="Güvenlik Politikası" subtitle="İki adımlı doğrulamanın zorunlu olduğu roller, oturumların açık kalma süresi ve TekirExtra destek erişimi — KLN-21, KLN-22, KLN-24." />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      {politika && (
        <form onSubmit={kaydet} className="stack">
          <Card className="stack">
            <div>
              <h3 className="card__title" style={{ fontSize: "1.05rem" }}>İki adımlı doğrulama zorunluluğu</h3>
              <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
                Seçilen rollerdeki kullanıcılar giriş yapabilir, ama 2FA kurulumunu bitirene kadar yalnız Hesap Güvenliği ekranını
                kullanabilir; MCP anahtarları da çalışmaz. Bu rollerde 2FA kapatılamaz.
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.5rem" }}>
              {ROLLER.map((rol) => {
                const eksik = politika.ikiAdimsizKullanicilar[rol] ?? 0;
                return (
                  <label key={rol} className="check-row">
                    <input type="checkbox" checked={roller.has(rol)} onChange={(e) => rolDegistir(rol, e.target.checked)} />{" "}
                    {ROL_ADI[rol]} {eksik > 0 && <Badge variant="neutral">{eksik} kişide 2FA yok</Badge>}
                  </label>
                );
              })}
            </div>
            {etkilenecek > 0 && (
              <Alert tone="warning">
                Kaydedince 2FA'sı olmayan {etkilenecek} kullanıcı bir sonraki işleminde kurulum ekranına yönlenecek.
                {roller.has("yonetici") && " Yönetici rolü de seçili: 2FA'nız yoksa siz de yönlendirilirsiniz."}
              </Alert>
            )}
          </Card>

          <Card className="stack">
            <div>
              <h3 className="card__title" style={{ fontSize: "1.05rem" }}>Oturum süresi</h3>
              <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
                Açık kalma süresi girişten itibaren sayılır; dolunca yeniden giriş istenir. Hareketsizlik süresinde ekranda işlem
                yapılmazsa oturum kapanır; iki dakika önce uyarı çıkar. Değişiklik mevcut oturumlara bir sonraki yenilemede uygulanır.
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
              <Field label="Açık kalma süresi">
                <Select value={String(gun)} onChange={(e) => setGun(Number(e.target.value))}>
                  {[...new Set([...OTURUM_GUNLERI, gun])].sort((a, b) => a - b).map((g) => <option key={g} value={g}>{g} gün</option>)}
                </Select>
              </Field>
              <Field label="Hareketsizlik süresi">
                <Select value={hareketsizlik} onChange={(e) => setHareketsizlik(e.target.value)}>
                  {HAREKETSIZLIK.map((h) => <option key={h.deger} value={h.deger}>{h.ad}</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          <div><Button variant="primary" type="submit" disabled={kaydediliyor}>{kaydediliyor ? "Kaydediliyor…" : "Politikayı kaydet"}</Button></div>
        </form>
      )}

      {destek && (
        <Card className="stack" style={{ marginTop: "1rem" }}>
          <div>
            <h3 className="card__title" style={{ fontSize: "1.05rem" }}>TekirExtra destek erişimi</h3>
            <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
              İzin verdiğiniz süre boyunca TekirExtra destek ekibi panelinizi <strong>salt okunur</strong> görebilir; hiçbir kaydı
              değiştiremez. Destek bağlıyken bütün kullanıcılar panelde işaret görür, her istek Denetim İzi&apos;ne destek kişisinin adıyla yazılır.
              İzni istediğiniz an geri alabilirsiniz; açık oturum en geç 10 saniyede kapanır.
            </p>
          </div>
          {destekMesaji && <Alert tone={destekMesaji.ton}>{destekMesaji.metin}</Alert>}
          {destek.izin
            ? <p style={{ margin: 0 }}><Badge variant="warning">İzin açık</Badge> {zaman(destek.izin.bitis)} saatine kadar ({destek.izin.veren} verdi).</p>
            : <p className="muted" style={{ margin: 0 }}>Şu an destek izni yok.</p>}
          <div className="row-tight" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label="İzin süresi">
              <Select value={String(destekSure)} onChange={(e) => setDestekSure(Number(e.target.value))}>
                {DESTEK_SURELERI.map((d) => <option key={d.saat} value={d.saat}>{d.ad}</option>)}
              </Select>
            </Field>
            <Button variant="primary" onClick={() => void destekIslem("/destek-izni", { sureSaat: destekSure })}>{destek.izin ? "Süreyi yeniden başlat" : "İzin ver"}</Button>
            {destek.izin && <Button variant="danger" onClick={() => void destekIslem("/destek-izni/geri-al")}>İzni geri al</Button>}
          </div>
          {destek.oturumlar.length > 0 && (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Destek kişisi</th><th>Açılış</th><th>Durum</th></tr></thead>
                <tbody>
                  {destek.oturumlar.map((o) => (
                    <tr key={o.id}>
                      <td>{o.platformKullaniciAdi}</td>
                      <td>{zaman(o.acilis)}</td>
                      <td>{o.acik ? <Badge variant="warning">Bağlı</Badge> : o.kapanis ? `Kapandı ${zaman(o.kapanis)}${o.kapanisNedeni ? ` (${KAPANIS_NEDENI[o.kapanisNedeni] ?? o.kapanisNedeni})` : ""}` : `Süresi doldu ${zaman(o.bitis)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}
    </div>
  );
}
