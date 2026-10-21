"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Button, Card, PageHeader, TableWrap } from "@/components/ui";

/**
 * EBLG-141: ön denetimde cari başına susturulan kurallar. Susturulan kural o
 * caride ne gösterilir ne de gönderimde onay ister; kaldırınca yeniden çalışır.
 */
interface Susturma {
  id: string;
  cariId: string;
  cari: string | null;
  kod: string;
  kural: string;
  kullanici: string | null;
  zaman: string;
}

/** EBLG-143: ön denetimin etkisi. */
interface Olcum {
  ozellikBaslangici: string;
  aylar: { ay: string; gonderilen: number; sorunlu: number; uyariIleGonderilen: number; sorunluOrani: number | null }[];
  once: { gonderilen: number; sorunlu: number; oran: number | null };
  sonra: { gonderilen: number; sorunlu: number; oran: number | null };
  kurallar: { kod: string; kural: string; gecilen: number; sonradanSorunlu: number }[];
  /** EBLG-150: gelen alış denetimi. */
  gelen?: { denetlenen: number; uyarili: number; uyariylaIslenen: number; kurallar: { kod: string; kural: string; gecilen: number }[] };
}

const oranMetni = (oran: number | null) => (oran === null ? "—" : `%${oran.toLocaleString("tr-TR")}`);
const ayAdi = (ay: string) => new Date(`${ay}-15T00:00:00Z`).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });

export default function OnDenetimSayfasi() {
  const [kayitlar, setKayitlar] = useState<Susturma[]>([]);
  const [olcum, setOlcum] = useState<Olcum | null>(null);
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islem, setIslem] = useState<string | null>(null);

  const yukle = useCallback(async () => setKayitlar(await api<Susturma[]>("/ebelge/on-denetim/susturmalar")), []);
  useEffect(() => { if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Susturmalar yüklenemedi")); }, [yukle]);
  useEffect(() => {
    if (tokenAl()) void api<Olcum>("/ebelge/on-denetim/olcum?ay=6").then(setOlcum).catch((e) => setHata(e instanceof Error ? e.message : "Ölçüm yüklenemedi"));
  }, []);

  async function kaldir(s: Susturma) {
    setIslem(s.id); setHata(""); setBasari("");
    try {
      await api(`/ebelge/on-denetim/susturmalar/${s.id}`, { method: "DELETE" });
      await yukle();
      setBasari(`"${s.kural}" kuralı ${s.cari ?? "cari"} için yeniden gösterilecek.`);
    } catch (e) { setHata(e instanceof Error ? e.message : "Kaldırılamadı"); } finally { setIslem(null); }
  }

  return <div className="production-page">
    <PageHeader
      title="e-Belge Ön Denetimi"
      subtitle="Gönderim sihirbazı belgeyi göndermeden önce, gelen kutusu alış faturasını işlemeden önce fiyat, vergi, cari ve mükerrer kontrolleri yapar. Burada cari başına susturduğunuz kurallar listelenir."
    />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    {olcum && <Card title="Etkisi: son 6 ay" pad={false}>
      <p className="muted" style={{ padding: "0.8rem 1.25rem 0", margin: 0 }}>
        Sorunlu: GİB ya da alıcı reddi veya iptal. Ön denetim {new Date(`${olcum.ozellikBaslangici}T12:00:00Z`).toLocaleDateString("tr-TR")} tarihinde açıldı;
        öncesinde gönderilen {olcum.once.gonderilen} belgenin sorunlu oranı <strong>{oranMetni(olcum.once.oran)}</strong>,
        sonrasında gönderilen {olcum.sonra.gonderilen} belgenin <strong>{oranMetni(olcum.sonra.oran)}</strong>.
      </p>
      <TableWrap>
        <thead><tr><th>Ay</th><th>Gönderilen</th><th>Uyarı onaylanarak</th><th>Sorunlu</th><th>Oran</th></tr></thead>
        <tbody>
          {olcum.aylar.map((a) => <tr key={a.ay}>
            <td>{ayAdi(a.ay)}</td><td>{a.gonderilen}</td><td>{a.uyariIleGonderilen}</td><td>{a.sorunlu}</td><td>{oranMetni(a.sorunluOrani)}</td>
          </tr>)}
        </tbody>
      </TableWrap>
      <TableWrap>
        <thead><tr><th>Kural</th><th>Onaylanarak geçilen</th><th>Bunlardan sonradan sorunlu</th></tr></thead>
        <tbody>
          {olcum.kurallar.map((k) => <tr key={k.kod}><td>{k.kural}</td><td>{k.gecilen}</td><td>{k.sonradanSorunlu}</td></tr>)}
          {!olcum.kurallar.length && <tr><td colSpan={3}>Bu dönemde uyarı onaylanarak gönderilmiş belge yok.</td></tr>}
        </tbody>
      </TableWrap>
      <p className="muted" style={{ padding: "0.8rem 1.25rem", margin: 0 }}>
        Sihirbazda gösterilip gönderimden önce düzeltilen bulgular kaydedilmez; burada yalnız onaylanarak geçilen uyarılar sayılır.
      </p>
    </Card>}
    {olcum?.gelen && <Card title="Gelen alış denetimi: son 6 ay" pad={false}>
      <p className="muted" style={{ padding: "0.8rem 1.25rem 0", margin: 0 }}>
        Denetlenen {olcum.gelen.denetlenen} gelen e-Faturanın {olcum.gelen.uyarili} tanesinde uyarı çıktı; {olcum.gelen.uyariylaIslenen} belge uyarı onaylanarak faturaya işlendi.
      </p>
      <TableWrap>
        <thead><tr><th>Kural</th><th>Onaylanarak geçilen</th></tr></thead>
        <tbody>
          {olcum.gelen.kurallar.map((k) => <tr key={k.kod}><td>{k.kural}</td><td>{k.gecilen}</td></tr>)}
          {!olcum.gelen.kurallar.length && <tr><td colSpan={2}>Bu dönemde uyarı onaylanarak işlenmiş gelen belge yok.</td></tr>}
        </tbody>
      </TableWrap>
    </Card>}
    <Card title={`Susturulan kurallar (${kayitlar.length})`} pad={false}>
      <TableWrap>
        <thead><tr><th>Cari</th><th>Kural</th><th>Susturan</th><th>Tarih</th><th /></tr></thead>
        <tbody>
          {kayitlar.map((s) => <tr key={s.id}>
            <td><Link href={`/panel/cari/${s.cariId}`}>{s.cari ?? "Silinmiş cari"}</Link></td>
            <td>{s.kural}</td>
            <td>{s.kullanici ?? "—"}</td>
            <td>{new Date(s.zaman).toLocaleDateString("tr-TR")}</td>
            <td><Button size="sm" disabled={islem === s.id} onClick={() => void kaldir(s)}>Yeniden göster</Button></td>
          </tr>)}
          {!kayitlar.length && <tr><td colSpan={5}>Susturulan kural yok. Sihirbazdaki bir bulguda &quot;Bu cari için gösterme&quot;, gelen kutusunda &quot;Bu tedarikçi için gösterme&quot; ile eklenir.</td></tr>}
        </tbody>
      </TableWrap>
    </Card>
    <p className="muted">
      Fiyat sapması (varsayılan %25, gelen alış için ayrı), kur sapması (varsayılan %3) eşikleri <Link href="/panel/ayarlar/moduller">Modül Ayarları › e-Belge</Link> bölümünden değiştirilir.
    </p>
  </div>;
}
