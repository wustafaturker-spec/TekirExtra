import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { onDenetimAnahtari, type OnDenetimBulgusu } from "@tekirextra/shared";
import { adres, arac, BUGUN, cagir, kisalt, para, sec, tarih, uuid, type AracBaglami } from "./arac";
import { UC } from "./uclar";
import { ublOzeti } from "../ubl-ozeti";

/** Sohbet ekindeki XML UBL e-Fatura değilse talep açılmaz. */
function ublOzetiOku(xml: string) {
  const u = ublOzeti(xml);
  if (!u) throw new BadRequestException("Ek geçerli bir UBL e-Fatura değil");
  return u;
}

/*
 * AI-73…AI-77 (Asistan Genişletme, A grubu): gelen e-Belge kutusu, satın
 * alma, çek/senet-kredi-kart-ödeme talimatı, bütçe/nakit, Düzeltme Merkezi,
 * bildirim ve dönem kontrolleri. Hepsi ekran uçlarını çağırır; rol yetkisi,
 * doğrulama ve iş kuralları ekranla aynıdır.
 */

/** Şekli araçta sabitlenmemiş çıktıyı küçültüp kesildiyse not düşer. */
function kucuk(deger: unknown, dizi = 20) {
  const { veri, kisaltildi } = kisalt(deger, dizi);
  return kisaltildi ? { veri, not: `Listeler ilk ${dizi} kayıtla sınırlandı; tamamı ekranda.` } : { veri };
}

// ─── AI-73: gelen e-Fatura / e-İrsaliye ──────────────────────────────────

const GELEN_ALANLARI = ["id", "belgeNo", "gonderenUnvan", "gonderenVkn", "tarih", "profilId", "durum", "yanit", "genelToplam", "dovizCinsi", "satirSayisi", "denetimUyari", "faturaId"];

type Eslesme = { siraNo: number; stokId: string; varyantId?: string | null };

/** İşleme hazırlığı: eşleşme verilmezse önerilen; eksik satır varsa sorulur; uyarılar o eşleşmeyle. */
async function gelenIslemeHazirla(b: AracBaglami, gelenId: string, verilen?: Eslesme[]) {
  const d = await cagir(b, UC.gelenEfaturaGetir, [gelenId]);
  if (d.durum !== "beklemede") throw new BadRequestException(`Belge işlenemez: durumu ${d.durum}`);
  const eslesmeler: Eslesme[] = verilen?.length
    ? verilen
    : (d.satirlar ?? []).filter((s: any) => s.onerilenStokId).map((s: any) => ({ siraNo: s.siraNo, stokId: s.onerilenStokId, varyantId: s.onerilenVaryantId ?? null }));
  const eksik = (d.satirlar ?? []).filter((s: any) => !eslesmeler.some((e) => e.siraNo === s.siraNo));
  if (eksik.length) {
    throw new BadRequestException(`Şu satırlar bir stok kartıyla eşleşmedi: ${eksik.map((s: any) => `${s.siraNo}. ${s.ad}`).join(", ")}. stok_ara ile kartı bulup satirEslesmeleri olarak verin.`);
  }
  const engel = [...(d.engeller ?? []), ...(d.tutarDenetimi?.gecerli === false ? ["belge toplamları sistemin hesabını tutmuyor"] : []), ...(d.cariUyarisi ? [d.cariUyarisi] : [])];
  if (engel.length) throw new BadRequestException(`Belge faturaya işlenemez: ${engel.join("; ")}`);
  const denetim = verilen?.length ? await cagir(b, UC.gelenEfaturaDenetim, [gelenId, { satirEslesmeleri: eslesmeler }]) : d.onDenetim;
  const uyarilar: OnDenetimBulgusu[] = (denetim?.bulgular ?? []).filter((x: OnDenetimBulgusu) => x.duzey === "uyari");
  return { d, eslesmeler, uyarilar };
}

export const MODUL_ARACLARI = [
  arac({
    ad: "gelen_efatura_ara",
    aciklama: "Gelen e-Faturaları (alış ve iade) listeler: durum (beklemede, islendi, reddedildi), gönderen ya da numara araması, tarih aralığı, yalnız denetim uyarısı olanlar. En yeni 20 kayıt.",
    sinif: "okuma",
    girdi: z.object({
      durum: z.enum(["beklemede", "islendi", "reddedildi"]).optional(),
      arama: z.string().optional().describe("Gönderen unvanı, VKN ya da belge numarası"),
      baslangic: tarih("Belge tarihi başlangıç").optional(),
      bitis: tarih("Belge tarihi bitiş").optional(),
      yalnizUyarili: z.boolean().optional().describe("Yalnız gelen alış denetiminde uyarı çıkanlar"),
    }),
    uc: UC.gelenEfaturaListe,
    async calistir(b, g) {
      const liste: any[] = await cagir(b, UC.gelenEfaturaListe, [g.durum]);
      const sorgu = g.arama?.toLocaleLowerCase("tr-TR").trim();
      const uygun = liste.filter((k) =>
        (!sorgu || `${k.belgeNo} ${k.gonderenUnvan} ${k.gonderenVkn}`.toLocaleLowerCase("tr-TR").includes(sorgu)) &&
        (!g.baslangic || k.tarih >= g.baslangic) && (!g.bitis || k.tarih <= g.bitis) &&
        (!g.yalnizUyarili || (k.denetimUyari ?? 0) > 0));
      return {
        toplam: uygun.length,
        kayitlar: uygun.slice(0, 20).map((k) => ({ ...sec(k, GELEN_ALANLARI), adres: adres.gelenEfatura(k.id) })),
        ...(uygun.length > 20 ? { not: "İlk 20 kayıt; süzgeci daraltın." } : {}),
      };
    },
  }),
  arac({
    ad: "gelen_efatura_getir",
    aciklama: "Bir gelen e-Faturanın ayrıntısı: satırlar ve önerilen stok eşleşmesi, tutar kapısı (engeller, farklar), gelen alış denetimi bulguları (fiyat sapması, mükerrer, IBAN, KDV/tevkifat, vade), cari ve irsaliye eşleşmesi.",
    sinif: "okuma",
    girdi: z.object({ gelenId: uuid("Gelen e-Fatura kimliği") }),
    uc: UC.gelenEfaturaGetir,
    async calistir(b, g) {
      const d = await cagir(b, UC.gelenEfaturaGetir, [g.gelenId]);
      return {
        ...sec(d, ["id", "belgeNo", "gonderenUnvan", "gonderenVkn", "tarih", "profilId", "durum", "yanit", "yanitGerekce", "faturaTipi", "dovizCinsi", "belgeToplamlari", "engeller", "cariUyarisi", "yanitGerekiyor", "irsaliyeEslesmesi"]),
        cari: d.cari ? sec(d.cari, ["id", "kod", "unvan"]) : null,
        tutarDenetimi: d.tutarDenetimi ? sec(d.tutarDenetimi, ["gecerli", "asanlar", "aciklamalar"]) : null,
        denetim: d.onDenetim ? { bulgular: d.onDenetim.bulgular, susturulan: d.onDenetim.susturulan } : null,
        satirlar: (d.satirlar ?? []).slice(0, 50).map((s: any) => ({
          ...sec(s, ["siraNo", "ad", "miktar", "birim", "birimFiyat", "kdvOrani", "matrah"]),
          onerilenStok: s.onerilenStok ? sec(s.onerilenStok, ["id", "kod", "ad"]) : null,
          onerilenVaryantId: s.onerilenVaryantId ?? null,
        })),
        adres: adres.gelenEfatura(d.id),
      };
    },
  }),
  arac({
    ad: "gelen_efatura_isle",
    aciklama:
      "Beklemedeki gelen e-Faturayı taslak alış (ya da iade) faturasına işler. satirEslesmeleri verilmezse sistemin önerdiği stok eşleşmesi kullanılır; eşleşmeyen satır varsa önce stok_ara ile kart bulun. Gelen alış denetimi uyarıları onay ekranında listelenir; kullanıcının onayı uyarıları gördüğü anlamına gelir. Gönderen cari değilse yeni tedarikçi kartı açılır. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({
      gelenId: uuid("Gelen e-Fatura kimliği"),
      satirEslesmeleri: z.array(z.object({ siraNo: z.number().int().min(1), stokId: uuid("Stok kartı"), varyantId: uuid("Varyant").optional() })).max(200).optional(),
    }),
    uc: UC.gelenEfaturaIsle,
    async ozetle(b, g) {
      const { d, eslesmeler, uyarilar } = await gelenIslemeHazirla(b, g.gelenId, g.satirEslesmeleri);
      const satirlar = (d.satirlar ?? []).map((s: any) => {
        const e = eslesmeler.find((x) => x.siraNo === s.siraNo);
        const kart = s.onerilenStokId === e?.stokId && s.onerilenStok ? `${s.onerilenStok.kod} ${s.onerilenStok.ad}` : e?.stokId;
        return `${s.siraNo}. ${s.ad} → ${kart}`;
      });
      return [
        `Faturaya işlenecek: ${d.belgeNo} · ${d.gonderenUnvan} · ${para(d.belgeToplamlari?.genelToplam, d.dovizCinsi)}${d.cari ? "" : " · gönderen için yeni tedarikçi cari kartı açılacak"}`,
        `Satır eşleşmeleri: ${satirlar.join("; ")}`,
        uyarilar.length ? `Gelen alış denetimi uyarıları (onayınız bunları gördüğünüz anlamına gelir): ${uyarilar.map((u) => u.mesaj).join(" | ")}` : "Gelen alış denetiminde uyarı yok.",
      ].join("\n");
    },
    async hedefDurumu(b, g) {
      const { d, eslesmeler, uyarilar } = await gelenIslemeHazirla(b, g.gelenId, g.satirEslesmeleri);
      return { durum: d.durum, toplam: d.belgeToplamlari?.genelToplam, eslesmeler, uyarilar: uyarilar.map(onDenetimAnahtari).sort() };
    },
    async calistir(b, g) {
      const { d, eslesmeler, uyarilar } = await gelenIslemeHazirla(b, g.gelenId, g.satirEslesmeleri);
      const s = await cagir(b, UC.gelenEfaturaIsle, [g.gelenId, {
        satirEslesmeleri: eslesmeler,
        yeniCariOnay: !d.cari,
        ...(uyarilar.length ? { onDenetimOnayi: { anahtarlar: uyarilar.map(onDenetimAnahtari), gerekce: "Asistan onay talebiyle" } } : {}),
      }], g.gelenId);
      return { faturaId: s.faturaId, faturaTipi: s.faturaTipi, irsaliyeBagi: s.irsaliyeBagi ? kisalt(s.irsaliyeBagi, 10).veri : null, adres: adres.fatura(s.faturaId) };
    },
  }),
  arac({
    ad: "gelen_efatura_yanit",
    aciklama: "Ticari faturaya (TICARIFATURA) kabul ya da ret yanıtı gönderir; ret için gerekçe zorunlu. Süre ve profil kuralları ekrandakiyle aynı. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ gelenId: uuid("Gelen e-Fatura kimliği"), yanit: z.enum(["kabul", "ret"]), gerekce: z.string().max(500).optional() }),
    uc: UC.gelenEfaturaYanit,
    async ozetle(b, g) {
      const d = await cagir(b, UC.gelenEfaturaGetir, [g.gelenId]);
      return `${g.yanit === "kabul" ? "Kabul" : "Ret"} yanıtı gönderilecek: ${d.belgeNo} · ${d.gonderenUnvan} · ${para(d.belgeToplamlari?.genelToplam, d.dovizCinsi)}${g.gerekce ? ` · gerekçe: ${g.gerekce}` : ""}`;
    },
    hedefDurumu: async (b, g) => sec(await cagir(b, UC.gelenEfaturaGetir, [g.gelenId]), ["durum", "yanit", "belgeNo"]),
    async calistir(b, g) {
      if (g.yanit === "ret" && !g.gerekce?.trim()) throw new BadRequestException("Ret yanıtı için gerekçe zorunludur");
      return kisalt(await cagir(b, UC.gelenEfaturaYanit, [g.gelenId, { yanit: g.yanit, gerekce: g.gerekce ?? null }], g.gelenId), 5).veri;
    },
  }),
  arac({
    ad: "gelen_efatura_xml_yukle",
    aciklama: "Kullanıcının sohbete eklediği UBL XML e-Faturayı gelen kutusuna ekler (alıcı VKN firmanınki olmalı; faturaya işlemez). ekId SOHBET EKLERİ listesinden. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ ekId: uuid("Sohbet eki kimliği") }),
    uc: UC.gelenXmlYukle,
    async ozetle(b, g) {
      const { dosyaAdi, xml } = await cagir(b, UC.sohbetEkiXml, [g.ekId]);
      const u = ublOzetiOku(xml);
      return `Gelen kutusuna eklenecek: ${dosyaAdi} · e-Fatura ${u.belgeNo} · ${u.gonderen} (VKN ${u.gonderenVkn}) · ${para(u.genelToplam, u.doviz)} · alıcı VKN ${u.aliciVkn}`;
    },
    async hedefDurumu(b, g) {
      const { xml } = await cagir(b, UC.sohbetEkiXml, [g.ekId]);
      return ublOzetiOku(xml);
    },
    async calistir(b, g) {
      const { xml } = await cagir(b, UC.sohbetEkiXml, [g.ekId]);
      const k = await cagir(b, UC.gelenXmlYukle, [{ xml }]);
      return { ...sec(k, ["id", "belgeNo", "gonderenUnvan", "tarih", "durum"]), adres: adres.gelenEfatura(k.id), not: "Gelen kutusuna eklendi; faturaya işlemek için gelen_efatura_getir ile kontrol edin." };
    },
  }),
  arac({
    ad: "gelen_eirsaliye_ara",
    aciklama: "Gelen e-İrsaliyeleri listeler: durum (yeni = yanıt bekliyor, kabul, ret), gönderen ya da numara araması. En yeni 20 kayıt.",
    sinif: "okuma",
    girdi: z.object({ durum: z.enum(["yeni", "kabul", "ret"]).optional(), arama: z.string().optional() }),
    uc: UC.gelenEirsaliyeListe,
    async calistir(b, g) {
      const liste: any[] = await cagir(b, UC.gelenEirsaliyeListe, [g.durum]);
      const sorgu = g.arama?.toLocaleLowerCase("tr-TR").trim();
      const uygun = liste.filter((k) => !sorgu || `${k.belgeNo} ${k.gonderenUnvan} ${k.gonderenVkn}`.toLocaleLowerCase("tr-TR").includes(sorgu));
      return {
        toplam: uygun.length,
        kayitlar: uygun.slice(0, 20).map((k) => ({ ...sec(k, ["id", "belgeNo", "gonderenUnvan", "gonderenVkn", "tarih", "sevkTarihi", "durum", "kendiSevkimiz", "yanitGerekcesi"]), alisIrsaliyesi: k.alisIrsaliyesi ?? null })),
        adres: adres.gelenEirsaliye(),
      };
    },
  }),
  arac({
    ad: "gelen_eirsaliye_getir",
    aciklama: "Bir gelen e-İrsaliyenin ayrıntısı: sevk tarihi, satırlar, teslimat adresi, notlar, yanıt süresi.",
    sinif: "okuma",
    girdi: z.object({ irsaliyeId: uuid("Gelen e-İrsaliye kimliği") }),
    uc: UC.gelenEirsaliyeGetir,
    async calistir(b, g) {
      return { ...kucuk(await cagir(b, UC.gelenEirsaliyeGetir, [g.irsaliyeId]), 50), adres: adres.gelenEirsaliye() };
    },
  }),
  arac({
    ad: "gelen_eirsaliye_yanit",
    aciklama: "Gelen e-İrsaliyeye kabul ya da ret yanıtı gönderir (yanıt süresi fiilî sevkten itibaren sınırlıdır; ret için gerekçe zorunlu). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ irsaliyeId: uuid("Gelen e-İrsaliye kimliği"), yanit: z.enum(["kabul", "ret"]), gerekce: z.string().max(500).optional() }),
    uc: UC.gelenEirsaliyeYanit,
    async ozetle(b, g) {
      const d = await cagir(b, UC.gelenEirsaliyeGetir, [g.irsaliyeId]);
      return `${g.yanit === "kabul" ? "Kabul" : "Ret"} yanıtı gönderilecek: e-İrsaliye ${d.belgeNo} · ${d.gonderenUnvan}${g.gerekce ? ` · gerekçe: ${g.gerekce}` : ""}`;
    },
    hedefDurumu: async (b, g) => sec(await cagir(b, UC.gelenEirsaliyeGetir, [g.irsaliyeId]), ["durum", "belgeNo"]),
    async calistir(b, g) {
      if (g.yanit === "ret" && !g.gerekce?.trim()) throw new BadRequestException("Ret yanıtı için gerekçe zorunludur");
      return kisalt(await cagir(b, UC.gelenEirsaliyeYanit, [g.irsaliyeId, { yanit: g.yanit, gerekce: g.gerekce }], g.irsaliyeId), 5).veri;
    },
  }),

  // ─── AI-74: satın alma ──────────────────────────────────────────────────
  arac({
    ad: "satin_alma_secenekleri",
    aciklama: "Satın alma talebi açmak için gerekli seçenekler: departmanlar ve bütçe kalemleri (butceAnahtari), onay eşiği.",
    sinif: "okuma",
    girdi: z.object({}),
    uc: UC.satinAlmaSecenekler,
    async calistir(b) {
      return kucuk(await cagir(b, UC.satinAlmaSecenekler, []), 60);
    },
  }),
  arac({
    ad: "satin_alma_talep_ara",
    aciklama: "Satın alma taleplerini listeler. kapsam: benim (açtıklarım), onay (onayımı bekleyenler), tum (yetkim yetiyorsa hepsi).",
    sinif: "okuma",
    girdi: z.object({ kapsam: z.enum(["benim", "onay", "tum"]).optional() }),
    uc: UC.satinAlmaListe,
    async calistir(b, g) {
      return kucuk(await cagir(b, UC.satinAlmaListe, [g.kapsam ?? "benim"]));
    },
  }),
  arac({
    ad: "satin_alma_talep_getir",
    aciklama: "Bir satın alma talebinin ayrıntısı: kalemler, bütçe durumu, onay geçmişi, tedarikçi teklifleri ve karşılaştırma, oluşan sipariş.",
    sinif: "okuma",
    girdi: z.object({ talepId: uuid("Satın alma talebi kimliği") }),
    uc: UC.satinAlmaGetir,
    async calistir(b, g) {
      return { ...kucuk(await cagir(b, UC.satinAlmaGetir, [g.talepId]), 50), adres: adres.satinAlma(g.talepId) };
    },
  }),
  arac({
    ad: "satin_alma_talebi_olustur",
    aciklama: "Satın alma talebi taslağı açar (onaya göndermez). butceAnahtari satin_alma_secenekleri'nden; stok kartları stok_ara ile bulunur.",
    sinif: "taslak",
    girdi: z.object({
      ihtiyacTarihi: tarih("İhtiyaç tarihi"),
      gerekce: z.string().min(3).max(1000),
      butceAnahtari: z.string().min(1).max(120).describe("satin_alma_secenekleri'ndeki bütçe kalemi anahtarı"),
      departmanId: uuid("Departman").optional(),
      kalemler: z.array(z.object({ stokId: uuid("Stok/hizmet kartı"), miktar: z.string().describe("Miktar, ör. 10"), tahminiBirimFiyat: z.string().describe("KDV hariç tahmini birim fiyat, ör. 125.50") })).min(1).max(200),
    }),
    uc: UC.satinAlmaOlustur,
    async calistir(b, g) {
      const t = await cagir(b, UC.satinAlmaOlustur, [{ ...g, departmanId: g.departmanId ?? null }]);
      return { ...sec(t, ["id", "no", "durum", "tahminiToplam"]), adres: adres.satinAlma(t.id), not: "Taslak açıldı; onaya göndermek için satin_alma_talebini_onaya_sun." };
    },
  }),
  arac({
    ad: "satin_alma_teklif_ekle",
    aciklama: "Satın alma talebine tedarikçi teklifi ekler (kalem başına birim fiyat ve KDV; talepKalemiId'ler satin_alma_talep_getir'den). Teklif seçilmez.",
    sinif: "taslak",
    girdi: z.object({
      talepId: uuid("Satın alma talebi"),
      tedarikciCariId: uuid("Tedarikçi cari"),
      dovizCinsi: z.string().length(3).optional(),
      kur: z.string().optional().describe("Dövizli teklifte kur"),
      teslimSuresiGun: z.number().int().min(0).max(365).optional(),
      gecerlilikTarihi: tarih("Teklif geçerlilik tarihi").optional(),
      aciklama: z.string().max(1000).optional(),
      kalemler: z.array(z.object({ talepKalemiId: uuid("Talep kalemi"), birimFiyat: z.string(), kdvOrani: z.string() })).min(1).max(200),
    }),
    uc: UC.satinAlmaTeklifEkle,
    async calistir(b, g) {
      const { talepId, ...teklif } = g;
      return kucuk(await cagir(b, UC.satinAlmaTeklifEkle, [talepId, { dovizCinsi: "TRY", kur: "1", ...teklif }]), 10);
    },
  }),
  ...([
    ["satin_alma_talebini_onaya_sun", "Taslak satın alma talebini onaya gönderir.", UC.satinAlmaOnayaSun, "Onaya gönderilecek"],
  ] as const).map(([ad, aciklama, uc, fiil]) =>
    arac({
      ad,
      aciklama: `${aciklama} Kullanıcı onayı gerekir.`,
      sinif: "onay",
      girdi: z.object({ talepId: uuid("Satın alma talebi") }),
      uc,
      ozetle: async (b: AracBaglami, g: { talepId: string }) => `${fiil}: ${await talepTanimi(b, g.talepId)}`,
      hedefDurumu: (b: AracBaglami, g: { talepId: string }) => talepIcerigi(b, g.talepId),
      async calistir(b: AracBaglami, g: { talepId: string }) {
        return { ...sec(await cagir(b, uc, [g.talepId], g.talepId), ["id", "no", "durum"]), adres: adres.satinAlma(g.talepId) };
      },
    }),
  ),
  arac({
    ad: "satin_alma_talebini_onayla",
    aciklama: "Onay bekleyen satın alma talebini onaylar (onay eşiği ve rol kuralı ekrandakiyle aynı; bütçe aşılıyorsa gerekçe gerekir). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ talepId: uuid("Satın alma talebi"), butceAsimGerekcesi: z.string().max(500).optional() }),
    uc: UC.satinAlmaOnayla,
    ozetle: async (b, g) => `Onaylanacak: ${await talepTanimi(b, g.talepId)}${g.butceAsimGerekcesi ? ` · bütçe aşım gerekçesi: ${g.butceAsimGerekcesi}` : ""}`,
    hedefDurumu: (b, g) => talepIcerigi(b, g.talepId),
    async calistir(b, g) {
      return { ...sec(await cagir(b, UC.satinAlmaOnayla, [g.talepId, { butceAsimGerekcesi: g.butceAsimGerekcesi }], g.talepId), ["id", "no", "durum"]), adres: adres.satinAlma(g.talepId) };
    },
  }),
  arac({
    ad: "satin_alma_talebini_reddet",
    aciklama: "Onay bekleyen satın alma talebini gerekçeyle reddeder. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ talepId: uuid("Satın alma talebi"), gerekce: z.string().min(5).max(500) }),
    uc: UC.satinAlmaReddet,
    ozetle: async (b, g) => `Reddedilecek: ${await talepTanimi(b, g.talepId)} · gerekçe: ${g.gerekce}`,
    hedefDurumu: (b, g) => talepIcerigi(b, g.talepId),
    async calistir(b, g) {
      return { ...sec(await cagir(b, UC.satinAlmaReddet, [g.talepId, { gerekce: g.gerekce }], g.talepId), ["id", "no", "durum"]), adres: adres.satinAlma(g.talepId) };
    },
  }),
  arac({
    ad: "satin_alma_teklif_sec",
    aciklama: "Onaylı talepteki bir tedarikçi teklifini seçer (en ucuz değilse gerekçe istenebilir). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ talepId: uuid("Satın alma talebi"), teklifId: uuid("Seçilecek teklif"), gerekce: z.string().max(500).optional() }),
    uc: UC.satinAlmaTeklifSec,
    async ozetle(b, g) {
      const t = await cagir(b, UC.satinAlmaGetir, [g.talepId]);
      const teklif = (t.teklifler ?? []).find((x: any) => x.id === g.teklifId);
      if (!teklif) throw new BadRequestException("Teklif bu talepte yok");
      return `Seçilecek teklif: ${teklif.tedarikci?.unvan ?? teklif.tedarikciCariId} · ${para(teklif.toplam ?? teklif.genelToplam, teklif.dovizCinsi)} · talep ${t.no ?? t.id}${g.gerekce ? ` · gerekçe: ${g.gerekce}` : ""}`;
    },
    hedefDurumu: (b, g) => talepIcerigi(b, g.talepId),
    async calistir(b, g) {
      return kucuk(await cagir(b, UC.satinAlmaTeklifSec, [g.teklifId, { gerekce: g.gerekce }], g.talepId), 10);
    },
  }),
  arac({
    ad: "satin_alma_siparise_donustur",
    aciklama: "Onaylı ve teklifi seçilmiş satın alma talebinden tedarikçi siparişi oluşturur (depo isteğe bağlı). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ talepId: uuid("Satın alma talebi"), depoId: uuid("Teslim deposu").optional() }),
    uc: UC.satinAlmaSiparis,
    ozetle: async (b, g) => `Siparişe dönüştürülecek: ${await talepTanimi(b, g.talepId)}`,
    hedefDurumu: (b, g) => talepIcerigi(b, g.talepId),
    async calistir(b, g) {
      const s = await cagir(b, UC.satinAlmaSiparis, [g.talepId, { depoId: g.depoId ?? null }], g.talepId);
      const siparisId = s?.siparisId ?? s?.id;
      return { ...kisalt(s, 10).veri as object, ...(siparisId ? { adres: adres.belge(siparisId) } : {}) };
    },
  }),

  // ─── AI-75: çek/senet, kredi, kredi kartı, ödeme talimatı ───────────────
  arac({
    ad: "cek_senet_ara",
    aciklama: "Çek ve senetleri listeler: tür, yön (alinan/verilen), durum, arama (no, cari, banka), vade aralığı, yalnız açık evrak.",
    sinif: "okuma",
    girdi: z.object({
      tur: z.enum(["cek", "senet"]).optional(),
      yon: z.string().optional().describe("alinan ya da verilen"),
      durum: z.string().optional(),
      arama: z.string().optional(),
      baslangic: tarih("Vade başlangıç").optional(),
      bitis: tarih("Vade bitiş").optional(),
      yalnizAcik: z.boolean().optional(),
    }),
    uc: UC.cekSenetListe,
    async calistir(b, g) {
      return kucuk(await cagir(b, UC.cekSenetListe, [g.tur, g.durum, g.yon, g.arama, g.baslangic, g.bitis, g.yalnizAcik ? "1" : undefined]));
    },
  }),
  arac({
    ad: "cek_senet_ozet",
    aciklama: "Çek/senet portföy özeti ve vade analizi (vadesi gelen, geçen, önümüzdeki dönemler; alınan/verilen).",
    sinif: "okuma",
    girdi: z.object({ yon: z.string().optional().describe("alinan ya da verilen") }),
    uc: UC.cekSenetOzet,
    async calistir(b, g) {
      const [ozet, vade] = await Promise.all([
        cagir(b, UC.cekSenetOzet, [g.yon]),
        cagir(b, UC.cekSenetVade, []).catch(() => null),
      ]);
      return kucuk({ ozet, vadeAnalizi: vade });
    },
  }),
  arac({
    ad: "krediler",
    aciklama: "Banka kredileri: tür, kalan anapara, sıradaki taksit. krediId verilirse o kredinin ayrıntısı ve taksit planı.",
    sinif: "okuma",
    girdi: z.object({ krediId: uuid("Kredi kimliği").optional() }),
    uc: UC.krediListe,
    async calistir(b, g) {
      return g.krediId ? kucuk(await cagir(b, UC.krediGetir, [g.krediId]), 60) : kucuk(await cagir(b, UC.krediListe, []));
    },
  }),
  arac({
    ad: "kredi_kartlari",
    aciklama: "Şirket kredi kartları ve limitleri; kartId verilirse o kartın ekstreleri (kesim, son ödeme günü, tutar).",
    sinif: "okuma",
    girdi: z.object({ kartId: uuid("Kredi kartı kimliği").optional() }),
    uc: UC.krediKartiListe,
    async calistir(b, g) {
      return g.kartId ? kucuk(await cagir(b, UC.krediKartiEkstreler, [g.kartId]), 12) : kucuk(await cagir(b, UC.krediKartiListe, []));
    },
  }),
  arac({
    ad: "odeme_talimatlari",
    aciklama: "Banka ödeme talimatları: onay bekleyen, onaylanan, gönderilen, gerçekleşen, başarısız.",
    sinif: "okuma",
    girdi: z.object({ durum: z.enum(["onay_bekliyor", "onaylandi", "gonderildi", "gerceklesti", "basarisiz", "iptal"]).optional() }),
    uc: UC.odemeTalimatlari,
    async calistir(b, g) {
      return kucuk(await cagir(b, UC.odemeTalimatlari, [{ ...(g.durum ? { durum: g.durum } : {}) }]));
    },
  }),

  // ─── AI-76: bütçe ve nakit ──────────────────────────────────────────────
  arac({
    ad: "butce_karsilastirma",
    aciklama: "Yıl bütçesi ile gerçekleşenin kalem ve ay bazında karşılaştırması (bütçe, gerçekleşen, sapma tutar/yüzde). Rakamlar bütçe ekranıyla aynıdır; yorumu kaynak rakamlara dayandır.",
    sinif: "okuma",
    girdi: z.object({ yil: z.number().int().min(2020).max(2100).optional().describe("Varsayılan bu yıl") }),
    uc: UC.butceKarsilastirma,
    async calistir(b, g) {
      const yil = g.yil ?? Number(BUGUN().slice(0, 4));
      return { ...kucuk(await cagir(b, UC.butceKarsilastirma, [String(yil)]), 40), adres: `/panel/butce?yil=${yil}` };
    },
  }),
  arac({
    ad: "nakit_pozisyonu",
    aciklama: "Bugünkü nakit pozisyonu: kasa ve banka bakiyeleri, kısa vadeli alacak/borç ve beklenen giriş/çıkışlar (nakit akışı ekranının özeti).",
    sinif: "okuma",
    girdi: z.object({}),
    uc: UC.nakitPozisyon,
    async calistir(b) {
      return { ...kucuk(await cagir(b, UC.nakitPozisyon, []), 30), adres: "/panel/nakit-akisi" };
    },
  }),

  // ─── AI-77: Düzeltme Merkezi, bildirimler, dönem kontrolleri ────────────
  arac({
    ad: "duzeltme_kayitlari",
    aciklama: "Düzeltme Merkezi: açık düzeltme kayıtları (banka, kart, masraf, POS, e-Belge, stok, çek/senet, fatura-cari, satın alma) ve özet sayılar. Süzgeç: tür, önem, durum.",
    sinif: "okuma",
    girdi: z.object({
      tur: z.enum(["banka_ekstre", "kredi_karti", "masraf", "pos", "ebelge", "stok", "cek_senet", "fatura_cari", "satin_alma"]).optional(),
      onem: z.enum(["bilgi", "uyari", "kritik"]).optional(),
      durum: z.enum(["acik", "incelemede", "beklemede", "cozuldu", "yoksayildi"]).optional(),
    }),
    uc: UC.duzeltmeListe,
    async calistir(b, g) {
      const [liste, ozet] = await Promise.all([
        cagir(b, UC.duzeltmeListe, [{ ...g, durum: g.durum ?? "acik" }]),
        cagir(b, UC.duzeltmeOzet, []),
      ]);
      return { ...kucuk({ ozet, liste }), adres: adres.duzeltme() };
    },
  }),
  arac({
    ad: "duzeltme_ata",
    aciklama: "Düzeltme kaydını bir kullanıcıya atar (userId null ise atamayı kaldırır). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ duzeltmeId: uuid("Düzeltme kaydı"), userId: uuid("Atanacak kullanıcı").nullable() }),
    uc: UC.duzeltmeAta,
    ozetle: async (b, g) => `Atanacak: ${await duzeltmeTanimi(b, g.duzeltmeId)} → ${g.userId ?? "atama kaldırılacak"}`,
    hedefDurumu: async (b, g) => sec(await cagir(b, UC.duzeltmeGetir, [g.duzeltmeId]), ["id", "durum", "atananUserId", "aciklama"]),
    async calistir(b, g) {
      return kisalt(await cagir(b, UC.duzeltmeAta, [g.duzeltmeId, { userId: g.userId }], g.duzeltmeId), 5).veri;
    },
  }),
  arac({
    ad: "duzeltme_durum_degistir",
    aciklama: "Düzeltme kaydının durumunu değiştirir: incelemede, beklemede ya da yoksayildi (yoksaymada açıklama yazın). Çözüldü durumu taramayla kendiliğinden gelir. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ duzeltmeId: uuid("Düzeltme kaydı"), durum: z.enum(["incelemede", "beklemede", "yoksayildi"]), aciklama: z.string().min(2).max(2000).optional() }),
    uc: UC.duzeltmeDurum,
    ozetle: async (b, g) => `Durumu "${g.durum}" yapılacak: ${await duzeltmeTanimi(b, g.duzeltmeId)}${g.aciklama ? ` · açıklama: ${g.aciklama}` : ""}`,
    hedefDurumu: async (b, g) => sec(await cagir(b, UC.duzeltmeGetir, [g.duzeltmeId]), ["id", "durum", "atananUserId", "aciklama"]),
    async calistir(b, g) {
      return kisalt(await cagir(b, UC.duzeltmeDurum, [g.duzeltmeId, { durum: g.durum, aciklama: g.aciklama }], g.duzeltmeId), 5).veri;
    },
  }),
  arac({
    ad: "bildirimler",
    aciklama: "Kullanıcının açık bildirimleri ve özet sayıları (tür, önem). Süzgeç: önem, durum.",
    sinif: "okuma",
    girdi: z.object({ onem: z.enum(["bilgi", "uyari", "kritik"]).optional(), durum: z.enum(["yeni", "okundu", "ustlenildi", "aksiyon_alindi", "yoksayildi"]).optional() }),
    uc: UC.bildirimListe,
    async calistir(b, g) {
      const [ozet, liste] = await Promise.all([cagir(b, UC.bildirimOzet, []), cagir(b, UC.bildirimListe, [{ ...g }])]);
      return { ...kucuk({ ozet, liste }), adres: "/panel/bildirimler" };
    },
  }),
  arac({
    ad: "donem_kapatma_kontrolleri",
    aciklama: "Bir ayın dönem kapatma kontrollerini çalıştırır ve sonucu döner (taslak belge, eşleşmemiş hareket, eksik kur vb.). Dönemi kapatmaz; kapatma yalnız panelden yöneticiyle yapılır.",
    sinif: "okuma",
    girdi: z.object({ yil: z.number().int().min(2020).max(2100), ay: z.number().int().min(1).max(12) }),
    uc: UC.donemKontrol,
    async calistir(b, g) {
      return { ...kucuk(await cagir(b, UC.donemKontrol, [{ yil: g.yil, ay: g.ay }]), 40), adres: "/panel/donem-kapatma" };
    },
  }),
];

async function talepTanimi(b: AracBaglami, id: string): Promise<string> {
  const t = await cagir(b, UC.satinAlmaGetir, [id]);
  return `Satın alma talebi ${t.no ?? "(numarasız)"} · ${t.kalemler?.length ?? 0} kalem · tahmini ${para(t.tahminiToplam ?? t.toplam, "TRY")} · durum: ${t.durum}`;
}

async function talepIcerigi(b: AracBaglami, id: string) {
  const t = await cagir(b, UC.satinAlmaGetir, [id]);
  return { durum: t.durum, kalemler: (t.kalemler ?? []).map((k: any) => sec(k, ["id", "stokId", "miktar", "tahminiBirimFiyat"])), teklifler: (t.teklifler ?? []).map((x: any) => sec(x, ["id", "secildi", "tedarikciCariId"])) };
}

async function duzeltmeTanimi(b: AracBaglami, id: string): Promise<string> {
  const d = await cagir(b, UC.duzeltmeGetir, [id]);
  return `Düzeltme kaydı (${d.tur ?? ""}, ${d.onem ?? ""}) · ${String(d.aciklama ?? "").slice(0, 160)}`;
}
