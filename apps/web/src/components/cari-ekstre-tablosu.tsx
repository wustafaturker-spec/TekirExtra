"use client";

/**
 * CARI-24/25/26: cari ekstresinin ekran görünümü. Standart ve ayrıntılı
 * ekstre TL bakiyeyle tek tablodur (ayrıntılıda fatura kalemleri satırın
 * altına açılır); döviz ekstresi ya her dövizi kendi bölümünde ya da tüm
 * hareketleri seçilen dövize çevrilmiş tek tabloda gösterir.
 */
import { Fragment } from "react";
import { bakiyeYonu, type EkstreTuru } from "@tekirextra/shared";
import { Badge, Button, TableWrap } from "@/components/ui";

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export interface EkstreKalemi { stokKod: string; stokAd: string; miktar: string; birim: string; birimFiyat: string; iskontoOrani: string; tutar: string }

export interface EkstreSatir {
  id: string;
  tarih: string;
  vadeTarihi: string | null;
  tip: "borc" | "alacak";
  hareketTuru: string;
  belgeNo: string | null;
  odemeSekli: string | null;
  aciklama: string | null;
  dovizCinsi: string;
  tutar: string;
  kur: string;
  tutarTry: string;
  yuruyenBakiye: string;
  kaynakTur: string;
  /** İptal edilmiş faturanın hareketi (CARI-22); yalnız iptaller gösterilince gelir. */
  iptal?: boolean;
  makbuzYolu: string | null;
  odemeYontemi: null | { tur: "kredi_karti"; kartAdi: string; bankaAdi: string; sonDortHane: string; taksitSayisi: number; komisyonTutari: string; karttanCekilenToplam: string; fatura: { id: string; no: string | null } | null };
  /** CARI-25: ayrıntılı ekstrede faturanın kalemleri. */
  fatura?: { dovizCinsi: string; kur: string; kalemler: EkstreKalemi[]; toplamMatrah: string; toplamKdv: string; genelToplam: string };
  /** CARI-26: döviz bölümünde o dövizdeki yürüyen bakiye. */
  yuruyenDovizBakiye?: string;
  /** CARI-26 çevirme modu. */
  hedefTutar?: string;
  cevrimKuru?: string | null;
}

interface DovizOzeti { dovizCinsi: string; devir: string; borc: string; alacak: string; bakiye: string }

export interface EkstreVeri {
  cari: { id: string; kod: string; unvan: string; eposta?: string | null };
  tur?: EkstreTuru;
  baslangic?: string | null;
  devirBakiyesi: string;
  donemBorc: string;
  donemAlacak: string;
  donemSonuBakiyesi: string;
  dovizOzet: DovizOzeti[];
  satirlar: EkstreSatir[];
  dovizBolumleri?: (DovizOzeti & { satirlar: EkstreSatir[] })[];
  cevrilmis?: DovizOzeti & { satirlar: EkstreSatir[] };
}

const sayi = (deger: string | number, ondalik = 2) => Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: ondalik, maximumFractionDigits: Math.max(ondalik, 4) });
const birimAdi = (doviz: string) => (doviz === "TRY" ? "TL" : doviz);
const tarihTR = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

function Bakiye({ deger, birim = "TL" }: { deger: string | number; birim?: string }) {
  const yon = bakiyeYonu(deger);
  return (
    <span className={`money ${yon === "B" ? "pos" : yon === "A" ? "neg" : ""}`}>
      {sayi(Math.abs(Number(deger)))} {birim}{yon && <b className={`cari-statement__yon cari-statement__yon--${yon}`}>{yon}</b>}
    </span>
  );
}

export function EkstreOzeti({ devir, borc, alacak, bakiye, birim = "TL" }: { devir: string; borc: string; alacak: string; bakiye: string; birim?: string }) {
  return (
    <div className="cari-statement__summary">
      <div><span>Devir bakiyesi</span><strong><Bakiye deger={devir} birim={birim} /></strong></div>
      <div><span>Dönem borç</span><strong>{sayi(borc)} {birim}</strong></div>
      <div><span>Dönem alacak</span><strong>{sayi(alacak)} {birim}</strong></div>
      <div className="cari-statement__summary-son"><span>Son bakiye</span><strong><Bakiye deger={bakiye} birim={birim} /></strong></div>
    </div>
  );
}

/** CARI-28: elle girilen (açılış bakiyesi / düzeltme) satır silinebilir. */
export const elleHareketMi = (s: { kaynakTur: string }) => s.kaynakTur === "manuel" || s.kaynakTur === "acilis";
type SilEylemi = ((s: EkstreSatir) => void) | undefined;

function Aciklama({ s, onSil }: { s: EkstreSatir; onSil?: SilEylemi }) {
  const ekler = [
    s.fatura && s.fatura.dovizCinsi !== "TRY" ? `1 ${s.fatura.dovizCinsi} = ${sayi(s.fatura.kur, 4)} TL` : null,
    !s.fatura && s.dovizCinsi !== "TRY" ? `${sayi(s.tutar)} ${s.dovizCinsi} × ${sayi(s.kur, 4)}` : null,
    s.odemeYontemi?.tur === "kredi_karti" && Number(s.odemeYontemi.komisyonTutari) > 0 ? `Komisyon/vade farkı ${sayi(s.odemeYontemi.komisyonTutari)} TL` : null,
  ].filter((e): e is string => Boolean(e));
  // Açıklaması boş satırda yalnız ek bilgi görünür; hiçbiri yoksa tire.
  return (
    <div className="stack" style={{ gap: ".2rem" }}>
      {(s.aciklama || s.iptal || ekler.length === 0) && <span>{s.aciklama || (ekler.length ? "" : "—")}{s.iptal && <> <Badge variant="neutral">İptal</Badge></>}</span>}
      {ekler.map((e) => <small key={e} className="muted">{e}</small>)}
      {onSil && elleHareketMi(s) && <span><Button size="sm" variant="ghost" onClick={() => onSil(s)}>Elle girilen kaydı sil</Button></span>}
    </div>
  );
}

function Makbuz({ s }: { s: EkstreSatir }) {
  return s.makbuzYolu ? <a className="btn btn--ghost btn--sm" href={`${apiBase()}${s.makbuzYolu}`} target="_blank" rel="noreferrer">Makbuz</a> : null;
}

/** Standart ve ayrıntılı ekstre: TL yürüyen bakiyeli tek tablo. */
function TlTablosu({ v, onSil }: { v: EkstreVeri; onSil?: SilEylemi }) {
  const ayrintili = v.tur === "ayrintili";
  const kolon = ayrintili ? 11 : 9;
  return (
    <TableWrap className="cari-statement__table">
      <thead>
        <tr>
          <th>Tarih</th><th>Vade</th><th>Hareket</th><th>Belge No</th><th className="cari-statement__aciklama">Açıklama</th><th className="cari-statement__odeme">Ödeme</th>
          {ayrintili && <><th className="num">Miktar</th><th className="num">Fiyat</th></>}
          <th className="num">Borç (TL)</th><th className="num">Alacak (TL)</th><th className="num">Bakiye (TL)</th>
        </tr>
      </thead>
      <tbody>
        {v.baslangic && (
          <tr className="cari-statement__devir">
            <td>{tarihTR(v.baslangic)}</td><td /><td>Devir</td><td /><td>Devir bakiyesi</td><td />
            {ayrintili && <><td /><td /></>}
            <td className="num">{Number(v.devirBakiyesi) > 0 ? sayi(v.devirBakiyesi) : ""}</td>
            <td className="num">{Number(v.devirBakiyesi) < 0 ? sayi(-Number(v.devirBakiyesi)) : ""}</td>
            <td className="num"><Bakiye deger={v.devirBakiyesi} /></td>
          </tr>
        )}
        {v.satirlar.map((s) => {
          const kalemler = ayrintili && s.fatura && s.fatura.kalemler.length > 0 ? s.fatura : null;
          const birim = kalemler && kalemler.dovizCinsi !== "TRY" ? ` ${kalemler.dovizCinsi}` : "";
          return (
            <Fragment key={s.id}>
              <tr className={`${kalemler ? "cari-statement__ana" : ""}${s.iptal ? " cari-statement__iptal" : ""}`}>
                <td>{tarihTR(s.tarih)}</td>
                <td>{s.vadeTarihi ? tarihTR(s.vadeTarihi) : "—"}</td>
                <td>{s.hareketTuru}</td>
                <td>{s.belgeNo ?? "—"}</td>
                <td><Aciklama s={s} onSil={onSil} /></td>
                <td>{s.odemeSekli ?? ""} <Makbuz s={s} /></td>
                {ayrintili && <><td /><td /></>}
                <td className="num" style={{ color: s.tip === "borc" ? "var(--danger)" : undefined }}>{s.tip === "borc" ? sayi(s.tutarTry) : ""}</td>
                <td className="num" style={{ color: s.tip === "alacak" ? "var(--success)" : undefined }}>{s.tip === "alacak" ? sayi(s.tutarTry) : ""}</td>
                <td className="num"><Bakiye deger={s.yuruyenBakiye} /></td>
              </tr>
              {kalemler && kalemler.kalemler.map((k, i) => (
                <tr key={`${s.id}-${i}`} className="cari-statement__kalem">
                  <td colSpan={4} />
                  <td>{k.stokKod} · {k.stokAd}{Number(k.iskontoOrani) > 0 && <small className="muted"> (isk. %{sayi(k.iskontoOrani, 0)})</small>}</td>
                  <td />
                  <td className="num">{sayi(k.miktar, 0)} {k.birim}</td>
                  <td className="num">{sayi(k.birimFiyat)}{birim}</td>
                  <td className="num">{sayi(k.tutar)}{birim}</td>
                  <td colSpan={2} />
                </tr>
              ))}
              {kalemler && (
                <tr className="cari-statement__kalem cari-statement__kalem-son">
                  <td colSpan={4} />
                  <td colSpan={kolon - 4}>Matrah {sayi(kalemler.toplamMatrah)}{birim} · KDV {sayi(kalemler.toplamKdv)}{birim} · Fatura toplamı {sayi(kalemler.genelToplam)}{birim}</td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={kolon - 3}>Dönem toplamı</td>
          <td className="num">{sayi(v.donemBorc)}</td><td className="num">{sayi(v.donemAlacak)}</td><td className="num"><Bakiye deger={v.donemSonuBakiyesi} /></td>
        </tr>
      </tfoot>
    </TableWrap>
  );
}

/** Döviz bölümü ya da çevrilmiş liste: bakiye o dövizde yürür. */
function DovizTablosu({ satirlar, ozet, baslangic, cevrilmis }: { satirlar: EkstreSatir[]; ozet: DovizOzeti; baslangic?: string | null; cevrilmis: boolean }) {
  const birim = birimAdi(ozet.dovizCinsi);
  return (
    <TableWrap className="cari-statement__table">
      <thead>
        <tr>
          <th>Tarih</th><th>Vade</th><th>Hareket</th><th>Belge No</th><th className="cari-statement__aciklama">Açıklama</th>
          {cevrilmis ? <><th className="num">Hareket tutarı</th><th className="num">Çevrim kuru</th></> : <><th className="num">Kur</th><th className="num">TL karşılığı</th></>}
          <th className="num">Borç ({birim})</th><th className="num">Alacak ({birim})</th><th className="num">Bakiye ({birim})</th>
        </tr>
      </thead>
      <tbody>
        {baslangic && (
          <tr className="cari-statement__devir"><td>{tarihTR(baslangic)}</td><td /><td>Devir</td><td /><td>Devir bakiyesi</td><td /><td /><td /><td /><td className="num"><Bakiye deger={ozet.devir} birim={birim} /></td></tr>
        )}
        {satirlar.map((s) => {
          const tutar = cevrilmis ? s.hedefTutar ?? "0" : s.tutar;
          return (
            <tr key={s.id} className={s.iptal ? "cari-statement__iptal" : undefined}>
              <td>{tarihTR(s.tarih)}</td>
              <td>{s.vadeTarihi ? tarihTR(s.vadeTarihi) : "—"}</td>
              <td>{s.hareketTuru}</td>
              <td>{s.belgeNo ?? "—"}</td>
              <td><div className="stack" style={{ gap: ".2rem" }}><span>{s.aciklama || "—"}</span>{s.odemeSekli && <small className="muted">{s.odemeSekli}</small>}</div></td>
              {cevrilmis
                ? <><td className="num">{sayi(s.tutar)} {birimAdi(s.dovizCinsi)}</td><td className="num">{s.cevrimKuru ? sayi(s.cevrimKuru, 4) : "—"}</td></>
                : <><td className="num">{s.dovizCinsi === "TRY" ? "—" : sayi(s.kur, 4)}</td><td className="num">{sayi(s.tutarTry)} TL</td></>}
              <td className="num" style={{ color: s.tip === "borc" ? "var(--danger)" : undefined }}>{s.tip === "borc" ? sayi(tutar) : ""}</td>
              <td className="num" style={{ color: s.tip === "alacak" ? "var(--success)" : undefined }}>{s.tip === "alacak" ? sayi(tutar) : ""}</td>
              <td className="num"><Bakiye deger={s.yuruyenDovizBakiye ?? "0"} birim={birim} /></td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr><td colSpan={7}>{birim} dönem toplamı</td><td className="num">{sayi(ozet.borc)}</td><td className="num">{sayi(ozet.alacak)}</td><td className="num"><Bakiye deger={ozet.bakiye} birim={birim} /></td></tr>
      </tfoot>
    </TableWrap>
  );
}

export { Bakiye };

export function CariEkstreTablosu({ v, onSil }: { v: EkstreVeri; onSil?: SilEylemi }) {
  if (v.tur === "doviz" && v.cevrilmis) {
    const c = v.cevrilmis;
    return (
      <>
        <EkstreOzeti devir={c.devir} borc={c.borc} alacak={c.alacak} bakiye={c.bakiye} birim={c.dovizCinsi} />
        {c.satirlar.length === 0 && !v.baslangic ? <p className="empty">Seçilen tarih aralığında hareket bulunmuyor.</p> : <DovizTablosu satirlar={c.satirlar} ozet={c} baslangic={v.baslangic} cevrilmis />}
        <p className="muted" style={{ fontSize: ".75rem", marginTop: ".5rem" }}>{c.dovizCinsi} dışındaki hareketler, TL karşılıkları hareket gününün {c.dovizCinsi} döviz satış kuruna bölünerek çevrildi; {c.dovizCinsi} hareketleri kendi tutarıyla yer alır.</p>
      </>
    );
  }
  if (v.tur === "doviz") {
    const bolumler = v.dovizBolumleri ?? [];
    if (bolumler.length === 0) return <p className="empty">Seçilen tarih aralığında hareket bulunmuyor.</p>;
    return (
      <>
        {bolumler.map((b) => (
          <section key={b.dovizCinsi} className="cari-statement__bolum">
            <h4>{birimAdi(b.dovizCinsi)} hesabı</h4>
            <EkstreOzeti devir={b.devir} borc={b.borc} alacak={b.alacak} bakiye={b.bakiye} birim={birimAdi(b.dovizCinsi)} />
            <DovizTablosu satirlar={b.satirlar} ozet={b} baslangic={v.baslangic} cevrilmis={false} />
          </section>
        ))}
      </>
    );
  }
  return (
    <>
      <EkstreOzeti devir={v.devirBakiyesi} borc={v.donemBorc} alacak={v.donemAlacak} bakiye={v.donemSonuBakiyesi} />
      {v.satirlar.length === 0 && !v.baslangic ? <p className="empty">Seçilen tarih aralığında hareket bulunmuyor.</p> : <TlTablosu v={v} onSil={onSil} />}
    </>
  );
}
