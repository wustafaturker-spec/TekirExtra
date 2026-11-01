"use client";

/**
 * Onaylanmış irsaliyenin taşıma bilgisi paneli (EBLG-49).
 *
 * Şoför, plaka ve fiili sevk zamanı çoğu zaman belge onaylandıktan sonra, mal
 * yüklenirken belli olur; sunucu bu alanları onaydan sonra da açık tutar
 * (EBLG-23, `PATCH /belgeler/:id/tasima-bilgisi`). Ekran tarafında bu kapı hiç
 * yoktu: taşıyan bilgisi girilmeden onaylanan irsaliye e-İrsaliye olarak
 * gönderilemiyor, bilgiyi ekleyecek bir yer de bulunmuyordu. Panel hem giden
 * e-İrsaliye ekranından hem belge detayından açılır, mevcut değerleri belgenin
 * kendisinden okur.
 */

import { useCallback, useEffect, useState } from "react";
import { api, tumSayfalariAl } from "@/lib/api";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { eksikTasiyanAlanlari, tasiyanBelli } from "@/lib/tasima-bilgisi";
import { idisBelgesiMi, PLAKA_HATA_MESAJI, plakaGecerliMi, plakaNormalize, plakaTuru, sevkiyatNoGecerliMi } from "@tekirextra/shared";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { BOS_TESLIMAT_ADRESI, TeslimatAdresiAlanlari, teslimatAdresiGovdesi, teslimatAdresiEksik, type TeslimatAdresi } from "@/components/teslimat-adresi-alanlari";
import { CariSecici } from "@/components/cari-secici";

interface Cari { id: string; unvan: string; vknTckn?: string | null }
interface AracKarti { id: string; plaka: string; dorsePlaka: string | null; aciklama: string | null }
interface SoforKarti { id: string; ad: string; soyad: string; tckn: string | null }

interface BelgeTasima {
  no: string | null;
  fiiliSevkZamani: string | null;
  tasiyiciCariId: string | null;
  plaka: string | null;
  dorsePlaka: string | null;
  soforAdi: string | null;
  soforSoyadi: string | null;
  soforTckn: string | null;
  /** EBLG-72: İDİS sevkiyat numarası; Darphane bildiriminden sonra girilir. */
  idisSevkiyatNo: string | null;
  cariId: string;
  /** EBLG-84: irsaliyeye özel teslimat adresi (ihracatta gümrük kapısı). */
  teslimatAdres: string | null;
  teslimatIl: string | null;
  teslimatIlce: string | null;
  teslimatPostaKodu: string | null;
}

/** ISO zaman damgasını `datetime-local` alanının beklediği yerel metne çevirir. */
function yerelZaman(iso: string | null): string {
  if (!iso) return "";
  const zaman = new Date(iso);
  if (Number.isNaN(zaman.getTime())) return "";
  const ikiHane = (sayi: number) => String(sayi).padStart(2, "0");
  return `${zaman.getFullYear()}-${ikiHane(zaman.getMonth() + 1)}-${ikiHane(zaman.getDate())}T${ikiHane(zaman.getHours())}:${ikiHane(zaman.getMinutes())}`;
}

export function TasimaBilgisiPaneli({ belgeId, belgeNo, onKapat, onKaydedildi }: {
  belgeId: string;
  belgeNo?: string | null;
  onKapat: () => void;
  /** Kaydetme başarılıysa çağrılır; çağıran listesini/detayını tazeler. */
  onKaydedildi: (mesaj: string) => void;
}) {
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [kaydedildiUyarisi, setKaydedildiUyarisi] = useState("");
  const [hata, setHata] = useState("");
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [araclar, setAraclar] = useState<AracKarti[]>([]);
  const [soforKartlari, setSoforKartlari] = useState<SoforKarti[]>([]);
  const [no, setNo] = useState<string | null>(belgeNo ?? null);
  const [fiiliSevkZamani, setFiiliSevkZamani] = useState("");
  /**
   * Belgedeki özgün zaman damgası. `datetime-local` dakika hassasiyetinde
   * olduğu için alana dokunulmadığında bile saniyeler kırpılırdı; kullanıcı
   * alanı değiştirmediyse gelen değer olduğu gibi geri yazılır.
   */
  const [ozgunSevkZamani, setOzgunSevkZamani] = useState<string | null>(null);
  const [tasiyiciCariId, setTasiyiciCariId] = useState("");
  const [plaka, setPlaka] = useState("");
  const [dorsePlaka, setDorsePlaka] = useState("");
  const [soforAdi, setSoforAdi] = useState("");
  const [soforSoyadi, setSoforSoyadi] = useState("");
  const [soforTckn, setSoforTckn] = useState("");
  const [idisSevkiyatNo, setIdisSevkiyatNo] = useState("");
  const [cariId, setCariId] = useState<string | null>(null);
  // EBLG-84: panel bütün alanları yazar; adres de yüklenip geri gönderilmeli.
  const [teslimat, setTeslimat] = useState<TeslimatAdresi>(BOS_TESLIMAT_ADRESI);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const belge = await api<BelgeTasima>(`/belgeler/${belgeId}`);
      setNo(belge.no);
      setFiiliSevkZamani(yerelZaman(belge.fiiliSevkZamani));
      setOzgunSevkZamani(belge.fiiliSevkZamani);
      setTasiyiciCariId(belge.tasiyiciCariId ?? "");
      setPlaka(belge.plaka ?? "");
      setDorsePlaka(belge.dorsePlaka ?? "");
      setSoforAdi(belge.soforAdi ?? "");
      setSoforSoyadi(belge.soforSoyadi ?? "");
      setSoforTckn(belge.soforTckn ?? "");
      setIdisSevkiyatNo(belge.idisSevkiyatNo ?? "");
      setCariId(belge.cariId);
      setTeslimat({ teslimatAdres: belge.teslimatAdres ?? "", teslimatIl: belge.teslimatIl ?? "", teslimatIlce: belge.teslimatIlce ?? "", teslimatPostaKodu: belge.teslimatPostaKodu ?? "" });
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belgenin taşıma bilgisi okunamadı");
    } finally {
      setYukleniyor(false);
    }
  }, [belgeId]);

  useEffect(() => { void yukle(); }, [yukle]);
  // "Eksik kaydedildi" uyarısı kaydedilen hale aittir; alan değişince düşer.
  useEffect(() => { setKaydedildiUyarisi(""); }, [soforAdi, soforSoyadi, plaka, tasiyiciCariId]);
  useEffect(() => {
    // Kartlar olmasa da alanlar elle doldurulabilir; listeler gelmezse panel çalışmaya devam eder.
    void tumSayfalariAl<Cari>("/cari").then(setCariler).catch(() => undefined);
    void api<AracKarti[]>("/sevkiyat/araclar").then(setAraclar).catch(() => undefined);
    void api<SoforKarti[]>("/sevkiyat/soforler").then(setSoforKartlari).catch(() => undefined);
  }, []);

  // Şematron 14.09.2026 §3: plaka biçimi GİB tarafından denetleniyor.
  const plakaBozuk = Boolean(plaka.trim()) && !plakaGecerliMi(plaka);
  const dorseBozuk = Boolean(dorsePlaka.trim()) && !plakaGecerliMi(dorsePlaka);
  const plakaYabanci = plakaTuru(plaka) === "yabanci";
  const secilenTasiyici = cariler.find((c) => c.id === tasiyiciCariId);
  const suanki = { tasiyiciCariId: tasiyiciCariId || null, soforAdi, soforSoyadi, plaka };
  const eksikler = eksikTasiyanAlanlari(suanki);
  // EBLG-72: numara girildiyse biçimi tutmalı; boş bırakmak belgeyi İDİS dışı yapar.
  const sevkiyatNoBozuk = idisBelgesiMi(idisSevkiyatNo) && !sevkiyatNoGecerliMi(idisSevkiyatNo);
  const gonderilebilir =
    !sevkiyatNoBozuk
    && !teslimatAdresiEksik(teslimat)
    && tasiyanBelli(suanki)
    && !plakaBozuk
    && !dorseBozuk
    && !(tasiyiciCariId && secilenTasiyici && !secilenTasiyici.vknTckn);

  async function kaydet() {
    if (soforTckn.trim() && !/^\d{11}$/.test(soforTckn.trim())) {
      setHata("Şoför TCKN 11 haneli olmalıdır.");
      return;
    }
    if (plakaBozuk || dorseBozuk) {
      setHata(PLAKA_HATA_MESAJI);
      return;
    }
    setKaydediliyor(true);
    setHata("");
    setKaydedildiUyarisi("");
    try {
      await api(`/belgeler/${belgeId}/tasima-bilgisi`, {
        method: "PATCH",
        body: JSON.stringify({
          fiiliSevkZamani: fiiliSevkZamani === yerelZaman(ozgunSevkZamani)
            ? ozgunSevkZamani
            : fiiliSevkZamani ? new Date(fiiliSevkZamani).toISOString() : null,
          tasiyiciCariId: tasiyiciCariId || null,
          plaka: plaka.trim() || null,
          dorsePlaka: dorsePlaka.trim() || null,
          soforAdi: soforAdi.trim() || null,
          soforSoyadi: soforSoyadi.trim() || null,
          soforTckn: soforTckn.trim() || null,
          idisSevkiyatNo: idisSevkiyatNo.trim() || null,
          ...teslimatAdresiGovdesi(teslimat),
        }),
      });
      if (!gonderilebilir) {
        // Eksik bilgi kaydedilebilir ama panel kapanmaz: sessizce kapansaydı
        // kullanıcı "girdim" sanıp aynı gönderim hatasına geri düşerdi.
        setKaydedildiUyarisi(
          eksikler.length > 0
            ? `Kaydedildi. e-İrsaliye için hâlâ ${eksikler.join(", ")} gerekiyor — şoför TCKN'si bunların yerine geçmez.`
            : teslimatAdresiEksik(teslimat)
              ? "Kaydedildi. Teslimat adresinin adres, il, ilçe ve posta kodu birlikte girilmeden e-İrsaliye gönderilemez."
              : "Kaydedildi. Seçilen taşıyıcı carinin VKN/TCKN bilgisi girilmeden e-İrsaliye gönderilemez.",
        );
        return;
      }
      onKaydedildi(`${no ?? "Belge"} taşıma bilgisi kaydedildi; e-İrsaliye gönderilebilir.`);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Taşıma bilgisi kaydedilemedi");
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <HizliKayitPaneli baslik={`Taşıma bilgisi · ${no ?? "İrsaliye"}`} onKapat={onKapat}>
      {hata && <Alert tone="error">{hata}</Alert>}
      {yukleniyor ? (
        <p className="muted">Taşıma bilgisi yükleniyor…</p>
      ) : (
        <>
          {kaydedildiUyarisi ? (
            <Alert tone="warning">{kaydedildiUyarisi}</Alert>
          ) : eksikler.length > 0 ? (
            <Alert tone="warning">
              e-İrsaliye taşıyan bilgisi ister: taşıyıcı firmayı seçin ya da {eksikler.join(", ")} girin.
            </Alert>
          ) : null}
          {(plakaBozuk || dorseBozuk) && <Alert tone="warning">{PLAKA_HATA_MESAJI}</Alert>}
          {sevkiyatNoBozuk && <Alert tone="warning">Sevkiyat numarası SE-0000000 ya da ES-0000000 biçiminde olmalıdır.</Alert>}
          {tasiyiciCariId && secilenTasiyici && !secilenTasiyici.vknTckn && (
            <Alert tone="warning">Seçilen taşıyıcı carinin VKN/TCKN bilgisi yok; e-İrsaliye bu haliyle gönderilemez.</Alert>
          )}
          <div className="tasima-fields">
            <Field label="Fiili Sevk Tarihi ve Saati">
              <Input aria-label="Fiili sevk tarihi ve saati" type="datetime-local" value={fiiliSevkZamani} onChange={(e) => setFiiliSevkZamani(e.target.value)} />
              <small className="muted">Boş bırakılırsa onay anı yazılır.</small>
            </Field>
            {/* EBLG-72: numara Darphane bildiriminden döner, çoğu zaman onaydan sonra. */}
            <Field label="İDİS Sevkiyat Numarası">
              <Input aria-label="İDİS sevkiyat numarası" value={idisSevkiyatNo} maxLength={20} placeholder="Örn. SE-0152457" onChange={(e) => setIdisSevkiyatNo(e.target.value)} />
              <small className="muted">İnşaat demiri teslimlerinde girilir; belge IDISIRSALIYE profiliyle gider ve satırlar etiket numarası ister.</small>
            </Field>
            <TeslimatAdresiAlanlari deger={teslimat} onChange={setTeslimat} cariId={cariId} />
            <Field label="Taşıyan">
              <CariSecici ariaLabel="Taşıyan" cariler={cariler} deger={tasiyiciCariId} onChange={setTasiyiciCariId} ek={(c) => (c.vknTckn ? null : "VKN yok")} placeholder="Taşıyan cari ara… (boşsa kendi aracımızla)" />
              <small className="muted">Nakliyeci ya da kargo firmasını cari kartından seçin.</small>
            </Field>
            {araclar.length > 0 && (
              <Field label="Kayıtlı Araç">
                <Select value="" onChange={(e) => { const a = araclar.find((x) => x.id === e.target.value); if (a) { setPlaka(a.plaka); setDorsePlaka(a.dorsePlaka ?? ""); } }}>
                  <option value="">Seçin — alanlara yazılır</option>
                  {araclar.map((a) => <option key={a.id} value={a.id}>{a.plaka}{a.aciklama ? ` — ${a.aciklama}` : ""}</option>)}
                </Select>
              </Field>
            )}
            {soforKartlari.length > 0 && (
              <Field label="Kayıtlı Şoför">
                <Select value="" onChange={(e) => { const k = soforKartlari.find((x) => x.id === e.target.value); if (k) { setSoforAdi(k.ad); setSoforSoyadi(k.soyad); setSoforTckn(k.tckn ?? ""); } }}>
                  <option value="">Seçin — alanlara yazılır</option>
                  {soforKartlari.map((k) => <option key={k.id} value={k.id}>{k.ad} {k.soyad}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Plaka">
              <Input
                aria-invalid={eksikler.includes("plaka") || plakaBozuk}
                onBlur={() => setPlaka((p) => plakaNormalize(p))}
                onChange={(e) => setPlaka(e.target.value)}
                placeholder="34ABC123"
                value={plaka}
              />
              <small className="muted">{plakaYabanci ? "Yabancı plaka olarak bildirilecek" : "Türkiye plakası: il kodu + harf + rakam"}</small>
            </Field>
            <Field label="Dorse Plakası">
              <Input
                aria-invalid={dorseBozuk}
                onBlur={() => setDorsePlaka((p) => plakaNormalize(p))}
                onChange={(e) => setDorsePlaka(e.target.value)}
                value={dorsePlaka}
              />
            </Field>
            <Field label="Şoför Adı"><Input aria-invalid={eksikler.includes("şoför adı")} value={soforAdi} onChange={(e) => setSoforAdi(e.target.value)} /></Field>
            <Field label="Şoför Soyadı"><Input aria-invalid={eksikler.includes("şoför soyadı")} value={soforSoyadi} onChange={(e) => setSoforSoyadi(e.target.value)} /></Field>
            <Field label="Şoför TCKN"><Input value={soforTckn} onChange={(e) => setSoforTckn(e.target.value)} maxLength={11} /></Field>
          </div>
          <div className="quick-panel__actions">
            <Button type="button" onClick={onKapat}>Vazgeç</Button>
            <Button type="button" variant="primary" disabled={kaydediliyor} onClick={() => void kaydet()}>
              {kaydediliyor ? "Kaydediliyor…" : gonderilebilir ? "Taşıma bilgisini kaydet" : "Eksik haliyle kaydet"}
            </Button>
          </div>
        </>
      )}
    </HizliKayitPaneli>
  );
}
