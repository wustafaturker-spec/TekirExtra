"use client";

/**
 * Kredi kartı işlem formları (KSB-10): kartla cari ödemesi, kart gideri /
 * iade, ekstre ödemesi ve kart ayarları. Gönderim üst bileşenin `gonder`
 * işleviyle yapılır; limit aşımı onayı orada sorulur.
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { bugunTR } from "@tekirextra/shared";
import { api, tumSayfalariAl } from "@/lib/api";
import { Button, Field, Input, Para, Select, Tarih } from "@/components/ui";
import type { Banka, Kart } from "./tipler";

export type Gonder = (yol: string, govde: Record<string, unknown>, mesaj: string, method?: "POST" | "PATCH") => Promise<boolean>;

interface Cari { id: string; kod: string; unvan: string; dovizCinsi: string }
interface Fatura { id: string; no: string | null; genelToplam: string; dovizCinsi: string; odemeOzeti?: { durum: string; kalan: string } }
interface Kategori { id: string; ad: string; varsayilanKdvOrani: string | null; aktif: boolean }

const bos = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : String(v));

export function CariOdemeFormu({ kart, gonder }: { kart: Kart; gonder: Gonder }) {
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [cariId, setCariId] = useState("");
  const [faturalar, setFaturalar] = useState<Fatura[]>([]);

  useEffect(() => {
    void tumSayfalariAl<Cari>("/cari").then((liste) => setCariler(liste.filter((c) => c.dovizCinsi === kart.dovizCinsi))).catch(() => setCariler([]));
  }, [kart.dovizCinsi]);
  useEffect(() => {
    if (!cariId) { setFaturalar([]); return; }
    void api<{ kayitlar: Fatura[] }>(`/fatura?cariId=${cariId}&yon=alis&durum=kesin&adet=100`)
      .then((x) => setFaturalar(x.kayitlar.filter((f) => f.odemeOzeti?.durum !== "odendi")))
      .catch(() => setFaturalar([]));
  }, [cariId]);

  async function gonderForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const tamam = await gonder("/kasa-banka/kredi-kartlari/cari-odemeler", {
      krediKartiId: kart.id, cariId, faturaId: bos(f.get("faturaId")), tarih: f.get("tarih"), cariOdemeTutari: f.get("cariOdemeTutari"),
      komisyonTutari: f.get("komisyonTutari") || "0", taksitSayisi: Number(f.get("taksitSayisi") || 1), ilkTaksitTarihi: f.get("ilkTaksitTarihi"),
      aciklama: f.get("aciklama"), belgeNo: bos(f.get("belgeNo")),
    }, "Cari borç kredi kartına aktarıldı ve taksit planı oluşturuldu. Komisyon/vade farkı varsa finansman gideri olarak masrafa yazıldı.");
    if (tamam) setCariId("");
  }

  return (
    <form className="cc-transaction" onSubmit={gonderForm}>
      <Field label="Cari">
        <Select required value={cariId} onChange={(e) => setCariId(e.target.value)}>
          <option value="">Cari seçin</option>
          {cariler.map((c) => <option key={c.id} value={c.id}>{c.kod} · {c.unvan}</option>)}
        </Select>
      </Field>
      <Field label="Açık alış faturası">
        <Select name="faturaId">
          <option value="">Yalnız cari bakiyesine işle</option>
          {faturalar.map((f) => <option key={f.id} value={f.id}>{f.no ?? "Numarasız"} · kalan {Number(f.odemeOzeti?.kalan ?? f.genelToplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {f.dovizCinsi}</option>)}
        </Select>
      </Field>
      <Field label="Cari ödeme tutarı"><Input name="cariOdemeTutari" type="number" min="0.01" step="0.01" required /></Field>
      <Field label="Komisyon / vade farkı"><Input name="komisyonTutari" type="number" min="0" step="0.01" defaultValue="0" /></Field>
      <Field label="Taksit sayısı"><Input name="taksitSayisi" type="number" min="1" max="36" defaultValue="1" required /></Field>
      <Field label="İlk taksit tarihi"><Input name="ilkTaksitTarihi" type="date" defaultValue={bugunTR()} required /></Field>
      <Field label="İşlem tarihi"><Input name="tarih" type="date" defaultValue={bugunTR()} required /></Field>
      <Field label="Açıklama"><Input name="aciklama" required placeholder="Cari kredi kartı ödemesi" /></Field>
      <Field label="Belge no"><Input name="belgeNo" /></Field>
      <Button type="submit" variant="primary">Cari borcu kartla öde</Button>
    </form>
  );
}

export function HareketFormu({ kart, gonder }: { kart: Kart; gonder: Gonder }) {
  const [tip, setTip] = useState<"harcama" | "iade" | "faiz" | "aidat">("harcama");
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [kategoriId, setKategoriId] = useState("");
  const [kdvOrani, setKdvOrani] = useState("20");

  useEffect(() => {
    void api<Kategori[]>("/masraflar/kategoriler").then((k) => setKategoriler(k.filter((x) => x.aktif))).catch(() => setKategoriler([]));
  }, []);

  async function gonderForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const govde: Record<string, unknown> = {
      krediKartiId: kart.id, tip, tarih: f.get("tarih"), aciklama: f.get("aciklama"), tutar: f.get("tutar"),
      taksitSayisi: tip === "harcama" ? Number(f.get("taksitSayisi") || 1) : 1, belgeNo: bos(f.get("belgeNo")),
    };
    if (tip === "harcama") Object.assign(govde, { kategoriId, saticiUnvan: bos(f.get("saticiUnvan")), kdvOrani: Number(kdvOrani) });
    const mesaj = tip === "iade"
      ? "İade kart borcundan düşüldü."
      : `${tip === "harcama" ? "Harcama" : tip === "faiz" ? "Faiz" : "Aidat"} kaydedildi ve ödenmiş masraf olarak gider yazıldı.`;
    if (await gonder("/kasa-banka/kredi-kartlari/hareketler", govde, mesaj)) form.reset();
  }

  return (
    <form className="cc-transaction" onSubmit={gonderForm}>
      <Field label="İşlem türü">
        <Select value={tip} onChange={(e) => setTip(e.target.value as typeof tip)}>
          <option value="harcama">Doğrudan harcama</option>
          <option value="faiz">Faiz</option>
          <option value="aidat">Kart aidatı / ücret</option>
          <option value="iade">İade</option>
        </Select>
      </Field>
      <Field label="Tarih"><Input name="tarih" type="date" required defaultValue={bugunTR()} /></Field>
      <Field label={tip === "harcama" ? "Tutar (KDV dahil)" : "Tutar"}><Input name="tutar" type="number" min="0.01" step="0.01" required /></Field>
      {tip === "harcama" && (
        <>
          <Field label="Masraf kategorisi">
            <Select required value={kategoriId} onChange={(e) => {
              setKategoriId(e.target.value);
              const k = kategoriler.find((x) => x.id === e.target.value);
              if (k?.varsayilanKdvOrani != null) setKdvOrani(String(Number(k.varsayilanKdvOrani)));
            }}>
              <option value="">Kategori seçin</option>
              {kategoriler.map((k) => <option key={k.id} value={k.id}>{k.ad}</option>)}
            </Select>
          </Field>
          <Field label="Satıcı"><Input name="saticiUnvan" placeholder="Fişteki satıcı" /></Field>
          <Field label="KDV oranı">
            <Select value={kdvOrani} onChange={(e) => setKdvOrani(e.target.value)}>
              {["0", "1", "10", "20"].map((o) => <option key={o} value={o}>%{o}</option>)}
            </Select>
          </Field>
          <Field label="Taksit"><Input name="taksitSayisi" type="number" min="1" max="36" defaultValue="1" /></Field>
        </>
      )}
      <Field label="Açıklama"><Input name="aciklama" required minLength={2} /></Field>
      <Field label={tip === "harcama" ? "Fiş / belge no" : "Belge no"}><Input name="belgeNo" /></Field>
      <p className="cc-note">
        {tip === "harcama" && "Harcama, seçilen kategoride ödenmiş masraf olarak gider yazılır; KDV dahil tutardan matrah ayrılır."}
        {tip === "faiz" && "Faiz, “Finansman Giderleri” kategorisinde gider yazılır."}
        {tip === "aidat" && "Aidat, “Banka ve POS Komisyonları” kategorisinde gider yazılır."}
        {tip === "iade" && "İade kart borcunu azaltır ve içinde bulunduğu ekstreye alacak olarak girer; masraf üretmez."}
      </p>
      <Button type="submit" variant="primary">Kaydet</Button>
    </form>
  );
}

type OdemeSecenegi = "donem" | "asgari" | "tum" | "diger";

export function EkstreOdemeFormu({ kart, bankalar, gonder }: { kart: Kart; bankalar: Banka[]; gonder: Gonder }) {
  const ekstre = kart.sonEkstre;
  const secenekler = useMemo(() => {
    const liste: Array<{ deger: OdemeSecenegi; baslik: string; tutar: string | null; aciklama: string }> = [];
    if (ekstre && Number(ekstre.kalan) > 0) {
      liste.push({ deger: "donem", baslik: "Dönem borcu", tutar: ekstre.kalan, aciklama: `${new Date(`${ekstre.kesimTarihi}T00:00:00Z`).toLocaleDateString("tr-TR", { timeZone: "UTC" })} ekstresinin kalanı` });
      if (Number(ekstre.asgariKalan) > 0) liste.push({ deger: "asgari", baslik: "Asgari ödeme", tutar: ekstre.asgariKalan, aciklama: "Kalan dönem borcuna faiz işler" });
    }
    liste.push({ deger: "tum", baslik: "Tüm borç", tutar: kart.borc, aciklama: "İleri taksitler dahil" });
    liste.push({ deger: "diger", baslik: "Diğer tutar", tutar: null, aciklama: "Tutarı siz girin" });
    return liste;
  }, [ekstre, kart.borc]);
  const [secim, setSecim] = useState<OdemeSecenegi>(secenekler[0].deger);
  const [tutar, setTutar] = useState(secenekler[0].tutar ?? "");

  async function gonderForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await gonder("/kasa-banka/kredi-kartlari/ekstre-odemeler", {
      krediKartiId: kart.id, bankaHesapId: f.get("bankaHesapId"), tarih: f.get("tarih"), tutar, aciklama: f.get("aciklama"), belgeNo: bos(f.get("belgeNo")),
    }, "Kart ekstresi banka hesabından ödendi.");
  }

  return (
    <form className="cc-transaction cc-pay" onSubmit={gonderForm}>
      <div className="cc-pay__options" role="radiogroup" aria-label="Ödeme tutarı">
        {secenekler.map((s) => (
          <label key={s.deger} className={secim === s.deger ? "is-selected" : undefined}>
            <input type="radio" name="secim" checked={secim === s.deger} onChange={() => { setSecim(s.deger); setTutar(s.tutar ?? ""); }} />
            <span>{s.baslik}<small>{s.aciklama}</small></span>
            {s.tutar && <b><Para deger={s.tutar} dovizCinsi={kart.dovizCinsi} /></b>}
          </label>
        ))}
      </div>
      <Field label="Ödeme tutarı"><Input type="number" min="0.01" max={kart.borc} step="0.01" required value={tutar} onChange={(e) => { setTutar(e.target.value); setSecim("diger"); }} /></Field>
      <Field label="Banka hesabı">
        <Select name="bankaHesapId" required defaultValue={kart.bagliBankaHesap?.id ?? ""}>
          <option value="">Hesap seçin</option>
          {bankalar.filter((b) => b.dovizCinsi === kart.dovizCinsi).map((b) => <option key={b.id} value={b.id}>{b.ad}</option>)}
        </Select>
      </Field>
      <Field label="Ödeme tarihi"><Input name="tarih" type="date" defaultValue={bugunTR()} required /></Field>
      <Field label="Açıklama"><Input name="aciklama" defaultValue={`${kart.ad} ekstre ödemesi`} required /></Field>
      <Field label="Dekont no"><Input name="belgeNo" /></Field>
      {ekstre && Number(ekstre.kalan) > 0 && <p className="cc-note">Son ödeme günü <strong><Tarih deger={ekstre.sonOdemeTarihi} /></strong>. Ödeme önce en eski ekstreyi kapatır.</p>}
      <Button type="submit" variant="primary">Bankadan öde</Button>
    </form>
  );
}

export function KartAyarFormu({ kart, bankalar, gonder, onKapat }: { kart: Kart; bankalar: Banka[]; gonder: Gonder; onKapat: () => void }) {
  async function gonderForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const oran = bos(f.get("asgariOdemeOrani"));
    const tamam = await gonder(`/kasa-banka/kredi-kartlari/${kart.id}`, {
      limit: f.get("limit"), hesapKesimGunu: Number(f.get("hesapKesimGunu")), sonOdemeGunu: Number(f.get("sonOdemeGunu")),
      asgariOdemeOrani: oran === null ? null : Number(oran), bagliBankaHesapId: bos(f.get("bagliBankaHesapId")), aktif: f.get("aktif") === "on",
    }, "Kart ayarları kaydedildi.", "PATCH");
    if (tamam) onKapat();
  }
  return (
    <form className="cc-transaction" onSubmit={gonderForm}>
      <Field label="Kart limiti"><Input name="limit" type="number" min="0.01" step="0.01" required defaultValue={kart.limit} /></Field>
      <Field label="Hesap kesim günü"><Input name="hesapKesimGunu" type="number" min="1" max="31" required defaultValue={kart.hesapKesimGunu} /></Field>
      <Field label="Son ödeme günü"><Input name="sonOdemeGunu" type="number" min="1" max="31" required defaultValue={kart.sonOdemeGunu} /></Field>
      <Field label="Asgari ödeme oranı (%)"><Input name="asgariOdemeOrani" type="number" min="1" max="100" step="any" defaultValue={kart.asgariOdemeOrani ?? ""} placeholder={Number(kart.limit) <= 50000 ? "Otomatik: %20" : "Otomatik: %40"} /></Field>
      <Field label="Ödeme banka hesabı">
        <Select name="bagliBankaHesapId" defaultValue={kart.bagliBankaHesap?.id ?? ""}>
          <option value="">Bağlı hesap yok</option>
          {bankalar.map((b) => <option key={b.id} value={b.id}>{b.ad} · {b.dovizCinsi}</option>)}
        </Select>
      </Field>
      <label className="cc-check"><input type="checkbox" name="aktif" defaultChecked={kart.aktif} /> Kart aktif</label>
      <p className="cc-note">Kesim günü değişikliği kesinleşmiş ekstreleri değiştirmez; sonraki dönemler yeni güne göre hesaplanır. Asgari oran boşsa limite göre %20 (50.000&apos;e kadar) ya da %40 uygulanır.</p>
      <div className="row-tight"><Button type="button" onClick={onKapat}>Vazgeç</Button><Button type="submit" variant="primary">Kaydet</Button></div>
    </form>
  );
}
