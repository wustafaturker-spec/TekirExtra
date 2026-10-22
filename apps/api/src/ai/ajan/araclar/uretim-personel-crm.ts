import { randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { adres, arac, BUGUN, cagir, kisalt, para, sayiMetni, sec, tarih, uuid, type AracBaglami } from "./arac";
import { dovizGirdisi, kurBul, satirGirdisi, satirHazirla } from "./taslak";
import { UC } from "./uclar";

/*
 * AI-85…AI-91: üretim, personel ve CRM fırsat araçları. Hepsi ekran uçlarını
 * çağırır; rol, doğrulama ve iş kuralları ekranla aynıdır. Personel
 * araçlarında modele giden alanlar beyaz listededir (AI-87): kimlik, iletişim,
 * banka ve sağlık verisi ile kişi bazında ücret gitmez.
 */

function kucuk(deger: unknown, dizi = 20) {
  const { veri, kisaltildi } = kisalt(deger, dizi);
  return kisaltildi ? { veri, not: `Listeler ilk ${dizi} kayıtla sınırlandı; tamamı ekranda.` } : { veri };
}

const gun = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null);

// ─── AI-89…91: CRM fırsatları ─────────────────────────────────────────────

const ACIK_ASAMALAR = ["yeni_lead", "iletisim_kuruldu", "teklif_verildi", "pazarlik"] as const;
const ASAMALAR = [...ACIK_ASAMALAR, "kazanildi", "kaybedildi"] as const;
const ASAMA_ADI: Record<string, string> = {
  yeni_lead: "Yeni aday", iletisim_kuruldu: "İletişim kuruldu", teklif_verildi: "Teklif verildi", pazarlik: "Pazarlık", kazanildi: "Kazanıldı", kaybedildi: "Kaybedildi",
};

function firsatOzeti(f: any) {
  return {
    ...sec(f, ["id", "baslik", "asama", "tahminiTutar", "notlar"]),
    asamaAdi: ASAMA_ADI[f.asama] ?? f.asama,
    kapanisTarihi: gun(f.kapanisTarihi),
    cari: f.cari ? sec(f.cari, ["id", "kod", "unvan"]) : null,
    sorumlu: f.sorumlu?.adSoyad ?? null,
    adres: adres.crmFirsat(f.id),
  };
}

async function firsatTanimi(b: AracBaglami, id: string): Promise<string> {
  const f = await cagir(b, UC.crmFirsatGetir, [id]);
  return `"${f.baslik}" · ${f.cari?.unvan ?? "cari yok"} · ${para(f.tahminiTutar)} · ${ASAMA_ADI[f.asama] ?? f.asama}`;
}

const firsatIcerigi = async (b: AracBaglami, id: string) =>
  sec(JSON.parse(JSON.stringify(await cagir(b, UC.crmFirsatGetir, [id]))), ["baslik", "cariId", "tahminiTutar", "asama", "kapanisTarihi", "sorumluUserId", "notlar", "updatedAt"]);

const firsatAlanlari = z.object({
  baslik: z.string().min(2).max(100).optional(),
  tahminiTutar: z.number().positive().optional().describe("Tahmini tutar (TL)"),
  kapanisTarihi: tarih("Beklenen kapanış tarihi").optional(),
  sorumluUserId: uuid("Sorumlu kullanıcı").optional(),
  notlar: z.string().max(500).optional(),
});

export const CRM_ARACLARI = [
  arac({
    ad: "crm_firsat_ara",
    aciklama: "CRM satış fırsatlarını listeler: aşama (yeni_lead, iletisim_kuruldu, teklif_verildi, pazarlik, kazanildi, kaybedildi), cari ya da başlıkta arama. Tahmini tutar, kapanış tarihi ve sorumlu döner.",
    sinif: "okuma",
    girdi: z.object({ asama: z.enum(ASAMALAR).optional(), cariId: uuid("Yalnız bu carinin fırsatları").optional(), arama: z.string().max(100).optional() }),
    uc: UC.crmFirsatListe,
    async calistir(b, g) {
      const liste: any[] = await cagir(b, UC.crmFirsatListe, [g.asama]);
      const aranan = g.arama?.toLocaleLowerCase("tr");
      const suzulmus = liste.filter((f) => (!g.cariId || f.cariId === g.cariId) && (!aranan || `${f.baslik} ${f.cari?.unvan ?? ""}`.toLocaleLowerCase("tr").includes(aranan)));
      return { toplam: suzulmus.length, ...kucuk(suzulmus.map(firsatOzeti)) };
    },
  }),
  arac({
    ad: "crm_firsat_getir",
    aciklama: "Bir CRM fırsatının ayrıntısı ve bağlı belgeleri (fırsattan açılan ya da bağlanan teklifler ve sonraki belgeler).",
    sinif: "okuma",
    girdi: z.object({ firsatId: uuid("Fırsat kimliği") }),
    uc: UC.crmFirsatGetir,
    async calistir(b, g) {
      const f = await cagir(b, UC.crmFirsatGetir, [g.firsatId]);
      // Belge bağları modülü kapalıysa fırsat yine okunur.
      const belgeler = await cagir(b, UC.crmFirsatBelgeler, [g.firsatId]).catch(() => null);
      return { ...firsatOzeti(f), guncellenme: f.updatedAt, ...(belgeler ? { belgeler: kucuk(belgeler, 10).veri } : {}) };
    },
  }),
  arac({
    ad: "crm_firsat_olustur",
    aciklama: "Yeni CRM satış fırsatı açar (açık aşamalardan biriyle; varsayılan yeni_lead). Cari cari_ara ile bulunur.",
    sinif: "taslak",
    girdi: z.object({
      cariId: uuid("Cari kimliği"),
      baslik: z.string().min(2).max(100),
      tahminiTutar: z.number().positive().describe("Tahmini tutar (TL)"),
      asama: z.enum(ACIK_ASAMALAR).optional(),
      kapanisTarihi: tarih("Beklenen kapanış tarihi").optional(),
      notlar: z.string().max(500).optional(),
    }),
    uc: UC.crmFirsatOlustur,
    async calistir(b, g) {
      const f = await cagir(b, UC.crmFirsatOlustur, [{ ...g, asama: g.asama ?? "yeni_lead" }]);
      return firsatOzeti(f);
    },
  }),
  arac({
    ad: "crm_firsattan_teklif",
    aciklama: "Fırsatın carisine taslak satış teklifi açar ve fırsata bağlar (onaylamaz). Fiyat verilmezse fiyat listesi/kart fiyatı kullanılır. CRM belge bağları modülü kapalıysa hata döner.",
    sinif: "taslak",
    girdi: z.object({
      firsatId: uuid("Fırsat kimliği"),
      tarih: tarih("Teklif tarihi; varsayılan bugün").optional(),
      gecerlilikTarihi: tarih("Teklifin geçerlilik tarihi").optional(),
      odemeVadeGun: z.number().int().min(0).max(365).optional(),
      dovizCinsi: dovizGirdisi,
      aciklama: z.string().max(500).optional(),
      gerekce: z.string().min(2).max(500).optional().describe("Bağ gerekçesi; varsayılan 'Asistan ile fırsattan teklif'"),
      satirlar: z.array(satirGirdisi).min(1),
    }),
    uc: UC.crmFirsattanTeklif,
    async calistir(b, g) {
      const f = await cagir(b, UC.crmFirsatGetir, [g.firsatId]);
      const tarihGun = g.tarih ?? BUGUN();
      const doviz = (g.dovizCinsi ?? "TRY").toUpperCase();
      const kur = await kurBul(b, doviz, tarihGun, "satis");
      const satirlar = [];
      for (const s of g.satirlar) satirlar.push(await satirHazirla(b, s, { cariId: f.cariId, yon: "satis", doviz, kur, gun: tarihGun, faturaTipi: "satis" }));
      const sonuc = await cagir(b, UC.crmFirsattanTeklif, [g.firsatId, {
        istekAnahtari: randomUUID(),
        gerekce: g.gerekce ?? "Asistan ile fırsattan teklif",
        beklenenFirsatZamani: new Date(f.updatedAt).toISOString(),
        belge: {
          tur: "teklif", yon: "satis", tarih: tarihGun, gecerlilikTarihi: g.gecerlilikTarihi ?? null, odemeVadeGun: g.odemeVadeGun ?? null,
          cariId: f.cariId, dovizCinsi: doviz, kur, aciklama: g.aciklama ?? null, satirlar,
        },
      }], g.firsatId);
      return { belgeId: sonuc.id, bagId: sonuc.bagId, adres: adres.belge(sonuc.id), not: "Taslak teklif açıldı ve fırsata bağlandı; onaylamak için belge_onayla." };
    },
  }),
  arac({
    ad: "crm_firsat_guncelle",
    aciklama: "CRM fırsatının başlık, tahmini tutar, kapanış tarihi, sorumlu ya da notlarını günceller (yalnız verilen alanlar; aşama için crm_firsat_asama_degistir). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ firsatId: uuid("Fırsat kimliği"), degisiklikler: firsatAlanlari }),
    uc: UC.crmFirsatGuncelle,
    ozetle: async (b, g) => `Fırsat güncellenecek: ${await firsatTanimi(b, g.firsatId)} → ${Object.entries(g.degisiklikler).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
    async onizle(b, g) {
      const f = await firsatIcerigi(b, g.firsatId);
      return {
        eylem: "CRM fırsatını güncelle", hedef: String(f.baslik),
        degisiklikler: Object.entries(g.degisiklikler).filter(([, v]) => v !== undefined).map(([alan, sonra]) => ({ alan, once: alan === "kapanisTarihi" ? gun(f[alan]) : f[alan], sonra })),
      };
    },
    hedefDurumu: (b, g) => firsatIcerigi(b, g.firsatId),
    async calistir(b, g) {
      return firsatOzeti(await cagir(b, UC.crmFirsatGuncelle, [g.firsatId, g.degisiklikler], g.firsatId));
    },
  }),
  arac({
    ad: "crm_firsat_asama_degistir",
    aciklama: "CRM fırsatının aşamasını değiştirir (kazanildi/kaybedildi dahil; satış hunisi raporlarını etkiler). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ firsatId: uuid("Fırsat kimliği"), asama: z.enum(ASAMALAR) }),
    uc: UC.crmFirsatAsama,
    async ozetle(b, g) {
      return `Fırsat aşaması değişecek: ${await firsatTanimi(b, g.firsatId)} → ${ASAMA_ADI[g.asama]}`;
    },
    async onizle(b, g) {
      const f = await firsatIcerigi(b, g.firsatId);
      return { eylem: "CRM fırsat aşamasını değiştir", hedef: String(f.baslik), degisiklikler: [{ alan: "asama", once: ASAMA_ADI[f.asama as string] ?? f.asama, sonra: ASAMA_ADI[g.asama] }] };
    },
    hedefDurumu: (b, g) => firsatIcerigi(b, g.firsatId),
    async calistir(b, g) {
      return firsatOzeti(await cagir(b, UC.crmFirsatAsama, [g.firsatId, { asama: g.asama }], g.firsatId));
    },
  }),
];

// ─── AI-85/86: üretim ────────────────────────────────────────────────────

const EMIR_DURUMLARI = ["taslak", "planlandi", "malzeme_bekliyor", "hazir", "uretimde", "kismen_tamamlandi", "kalite_bekliyor", "beklemede", "durduruldu", "tamamlandi", "iptal_talebi", "iptal"] as const;

function emirOzeti(e: any) {
  return {
    ...sec(e, ["id", "no", "durum", "planlananMiktar", "uretilenMiktar", "hurdaMiktari", "planlananMaliyet", "toplamMaliyet", "aciklama", "kapanisNedeni"]),
    tarih: gun(e.tarih), planlananBitis: gun(e.planlananBitis),
    urun: e.stok ? sec(e.stok, ["id", "kod", "ad", "anaBirim"]) : undefined,
    varyant: e.varyant ? sec(e.varyant, ["kod", "ad"]) : undefined,
    hedefDepo: e.hedefDepo?.ad,
    adres: e.id ? adres.uretimEmri(e.id) : undefined,
  };
}

async function emirTanimi(b: AracBaglami, id: string): Promise<string> {
  const e = await cagir(b, UC.uretimEmirGetir, [id]);
  return `Üretim emri ${e.no ?? "(numarasız)"} · ${e.stok?.ad ?? ""} · ${e.planlananMiktar} ${e.stok?.anaBirim ?? ""} · durum: ${e.durum}`;
}

async function emirIcerigi(b: AracBaglami, id: string) {
  const e = JSON.parse(JSON.stringify(await cagir(b, UC.uretimEmirGetir, [id])));
  return sec(e, ["durum", "planlananMiktar", "uretilenMiktar", "hedefDepoId", "tarih", "planlananBitis", "updatedAt"]);
}

export const URETIM_ARACLARI = [
  arac({
    ad: "uretim_ozeti",
    aciklama: "Üretim panosunun özeti: durumlara göre emir sayıları, geciken emirler, kalite bekleyenler.",
    sinif: "okuma",
    girdi: z.object({}),
    uc: UC.uretimOzet,
    async calistir(b) {
      return kucuk(await cagir(b, UC.uretimOzet, []));
    },
  }),
  arac({
    ad: "uretim_emri_ara",
    aciklama: "Üretim emirlerini listeler: durum, ürün adı/kodu ya da emir numarasıyla arama, yalnız gecikenler.",
    sinif: "okuma",
    girdi: z.object({ durum: z.enum(EMIR_DURUMLARI).optional(), arama: z.string().max(100).optional(), geciken: z.boolean().optional() }),
    uc: UC.uretimEmirListe,
    async calistir(b, g) {
      const liste = await cagir(b, UC.uretimEmirListe, [{ durum: g.durum, arama: g.arama, geciken: g.geciken === undefined ? undefined : String(g.geciken) }]);
      const kayitlar: any[] = Array.isArray(liste) ? liste : liste?.kayitlar ?? [];
      return { toplam: kayitlar.length, ...kucuk(kayitlar.map(emirOzeti)) };
    },
  }),
  arac({
    ad: "uretim_emri_getir",
    aciklama: "Bir üretim emrinin ayrıntısı: operasyonlar, malzeme uygunluğu (eksik malzemeler) ve maliyet.",
    sinif: "okuma",
    girdi: z.object({ emirId: uuid("Üretim emri kimliği") }),
    uc: UC.uretimEmirGetir,
    async calistir(b, g) {
      const e = await cagir(b, UC.uretimEmirGetir, [g.emirId]);
      const [malzeme, maliyet] = await Promise.all([
        cagir(b, UC.uretimMalzemeUygunlugu, [g.emirId]).catch((h: Error) => ({ hata: h.message })),
        cagir(b, UC.uretimEmirMaliyet, [g.emirId]).catch((h: Error) => ({ hata: h.message })),
      ]);
      return {
        ...emirOzeti(e),
        operasyonlar: kisalt((e.operasyonlar ?? []).map((o: any) => ({ ...sec(o, ["sira", "operasyonAdi", "durum"]), isMerkezi: o.isMerkezi?.ad, operator: o.operator?.adSoyad })), 20).veri,
        malzemeUygunlugu: kucuk(malzeme, 30).veri,
        maliyet: kucuk(maliyet, 30).veri,
      };
    },
  }),
  arac({
    ad: "uretim_kapasite",
    aciklama: "İş merkezlerinin tarih aralığındaki kapasite ve yükü (çalışma takvimine göre).",
    sinif: "okuma",
    girdi: z.object({ baslangic: tarih("Başlangıç").optional(), bitis: tarih("Bitiş").optional() }),
    uc: UC.uretimKapasite,
    async calistir(b, g) {
      return kucuk(await cagir(b, UC.uretimKapasite, [g.baslangic, g.bitis]), 30);
    },
  }),
  arac({
    ad: "recete_getir",
    aciklama: "Bir mamulün aktif ürün reçetesi: malzemeler, operasyonlar, yan ürünler ve ek giderler (varyanta özel reçete için varyantId).",
    sinif: "okuma",
    girdi: z.object({ stokId: uuid("Mamul stok kartı"), varyantId: uuid("Varyant").optional() }),
    uc: UC.uretimRecete,
    async calistir(b, g) {
      return kucuk(await cagir(b, UC.uretimRecete, [g.stokId, g.varyantId ? { varyantId: g.varyantId } : {}]), 50);
    },
  }),
  arac({
    ad: "kalite_kontrolleri",
    aciklama: "Üretim kalite kontrol kayıtları (durum: bekliyor, kabul, ret, yeniden_isleme…).",
    sinif: "okuma",
    girdi: z.object({ durum: z.string().max(40).optional() }),
    uc: UC.uretimKalite,
    async calistir(b, g) {
      return kucuk(await cagir(b, UC.uretimKalite, [g.durum]));
    },
  }),
  arac({
    ad: "uretim_maliyet_raporu",
    aciklama: "Tarih aralığında tamamlanan üretimlerin planlanan/gerçekleşen maliyet raporu.",
    sinif: "okuma",
    girdi: z.object({ baslangic: tarih("Başlangıç").optional(), bitis: tarih("Bitiş").optional() }),
    uc: UC.uretimMaliyetRaporu,
    async calistir(b, g) {
      return kucuk(await cagir(b, UC.uretimMaliyetRaporu, [g.baslangic, g.bitis]), 30);
    },
  }),
  arac({
    ad: "uretim_emri_taslagi_olustur",
    aciklama: "Taslak üretim emri açar (planlamaz, malzeme ayırmaz). Mamul stok_ara ile bulunur; aktif reçetesi olmalı. Depo verilmezse varsayılan depo.",
    sinif: "taslak",
    girdi: z.object({
      stokId: uuid("Mamul stok kartı"),
      varyantId: uuid("Varyantlı mamulde varyant (zorunlu)").optional(),
      planlananMiktar: sayiMetni("Üretilecek miktar (ana birim)"),
      tarih: tarih("Emir tarihi; varsayılan bugün").optional(),
      planlananBitis: tarih("Planlanan bitiş").optional(),
      hedefDepoId: uuid("Mamulün gireceği depo").optional(),
      satisSiparisSatirId: uuid("Emri doğuran satış siparişi satırı").optional(),
      aciklama: z.string().max(500).optional(),
    }),
    uc: UC.uretimEmirOlustur,
    async calistir(b, g) {
      let depoId = g.hedefDepoId;
      if (!depoId) {
        const depolar: any[] = await cagir(b, UC.depoListe, ["true"]);
        const depo = depolar.find((d) => d.varsayilan) ?? (depolar.length === 1 ? depolar[0] : null);
        if (!depo) throw new BadRequestException(`Hedef depo seçilmeli: ${depolar.map((d) => `${d.ad} (${d.id})`).join(", ")}`);
        depoId = depo.id as string;
      }
      const e = await cagir(b, UC.uretimEmirOlustur, [{
        stokId: g.stokId, varyantId: g.varyantId ?? null, satisSiparisSatirId: g.satisSiparisSatirId ?? null, hedefDepoId: depoId,
        planlananMiktar: g.planlananMiktar, tarih: g.tarih ?? BUGUN(), planlananBitis: g.planlananBitis ?? null, aciklama: g.aciklama ?? null,
      }]);
      return { ...emirOzeti(e), not: "Taslak emir açıldı; planlamak için uretim_emrini_planla." };
    },
  }),
  ...([
    ["uretim_emrini_planla", "Taslak üretim emrini planlar (operasyonlar takvime yerleşir).", UC.uretimPlanla, "Planlanacak"],
    ["uretim_malzemesini_rezerve_et", "Planlanan üretim emrinin malzemelerini depoda ayırır.", UC.uretimRezerve, "Malzemesi ayrılacak"],
    ["uretim_emrini_iptal_et", "Üretim emrini iptal eder (başlamışsa iptal talebine döner).", UC.uretimIptal, "İptal edilecek"],
  ] as const).map(([ad, aciklama, uc, fiil]) =>
    arac({
      ad,
      aciklama: `${aciklama} Kullanıcı onayı gerekir.`,
      sinif: "onay",
      girdi: z.object({ emirId: uuid("Üretim emri kimliği") }),
      uc,
      ozetle: async (b: AracBaglami, g: { emirId: string }) => `${fiil}: ${await emirTanimi(b, g.emirId)}`,
      hedefDurumu: (b: AracBaglami, g: { emirId: string }) => emirIcerigi(b, g.emirId),
      async calistir(b: AracBaglami, g: { emirId: string }) {
        return emirOzeti(await cagir(b, uc, [g.emirId], g.emirId));
      },
    }),
  ),
  arac({
    ad: "uretim_emrini_kapat",
    aciklama: "Üretim emrini nedeniyle kapatır (kalan miktar üretilmeden). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ emirId: uuid("Üretim emri kimliği"), neden: z.string().min(3).max(250) }),
    uc: UC.uretimKapat,
    ozetle: async (b, g) => `Kapatılacak: ${await emirTanimi(b, g.emirId)} · neden: ${g.neden}`,
    hedefDurumu: (b, g) => emirIcerigi(b, g.emirId),
    async calistir(b, g) {
      return emirOzeti(await cagir(b, UC.uretimKapat, [g.emirId, { neden: g.neden }], g.emirId));
    },
  }),
];

// ─── AI-87/88: personel ──────────────────────────────────────────────────

/** Modele giden personel alanları (AI-87 beyaz listesi). */
const PERSONEL_ALANLARI = ["id", "personelNo", "ad", "soyad", "departman", "unvan", "calismaTipi", "durum", "aktif"];
/** Toplu tutar bu sayıdan az kişiyi kapsıyorsa kişi ücretini ele verir; verilmez. */
const EN_AZ_KISI = 3;

function personelOzeti(p: any) {
  return {
    ...sec(p, PERSONEL_ALANLARI),
    girisTarihi: gun(p.girisTarihi), cikisTarihi: gun(p.cikisTarihi),
    ...(p.departmanKaydi?.ad ? { departman: p.departmanKaydi.ad } : {}),
    ...(p.pozisyon?.ad ? { pozisyon: p.pozisyon.ad } : {}),
    ...(p.isyeri?.ad ? { isyeri: p.isyeri.ad } : {}),
    ...(p.yonetici ? { yonetici: `${p.yonetici.ad} ${p.yonetici.soyad}` } : {}),
    ...(p.id ? { adres: adres.personel(p.id) } : {}),
  };
}

const kisi = (p: any) => (p ? `${p.ad} ${p.soyad}${p.personelNo ? ` (${p.personelNo})` : ""}` : null);

function izinOzeti(t: any) {
  // Açıklama ve karar nedeni sağlık bilgisi içerebilir; modele gitmez.
  return { id: t.id as string, durum: t.durum as string, gunSayisi: String(t.gunSayisi), personel: kisi(t.personel), personelId: t.personelId, izinTuru: t.izinTuru?.ad, baslangic: gun(t.baslangicTarihi), bitis: gun(t.bitisTarihi) };
}

/** AI-87: kişi satırlarından departman toplamı; küçük departmanlar birleştirilir. */
export function maliyetToplamlari(satirlar: Array<{ departman: string; brutUcret: number; netUcret: number; isverenMaliyeti: number }>) {
  if (satirlar.length < EN_AZ_KISI) return { kisiSayisi: satirlar.length, not: `Bordrolu kişi sayısı ${EN_AZ_KISI}'ten az; kişi ücretini ele vermemek için tutar verilmez.` };
  const gruplar = new Map<string, { kisi: number; brut: number; net: number; maliyet: number }>();
  for (const s of satirlar) {
    const g = gruplar.get(s.departman) ?? { kisi: 0, brut: 0, net: 0, maliyet: 0 };
    gruplar.set(s.departman, { kisi: g.kisi + 1, brut: g.brut + s.brutUcret, net: g.net + s.netUcret, maliyet: g.maliyet + s.isverenMaliyeti });
  }
  const kucukler = [...gruplar.entries()].filter(([, g]) => g.kisi < EN_AZ_KISI);
  const diger = kucukler.reduce((t, [, g]) => ({ kisi: t.kisi + g.kisi, brut: t.brut + g.brut, net: t.net + g.net, maliyet: t.maliyet + g.maliyet }), { kisi: 0, brut: 0, net: 0, maliyet: 0 });
  const satir = (ad: string, g: { kisi: number; brut: number; net: number; maliyet: number }) => ({
    departman: ad, kisiSayisi: g.kisi, toplamBrut: g.brut.toFixed(2), toplamNet: g.net.toFixed(2), isverenMaliyeti: g.maliyet.toFixed(2), kisiBasiOrtalamaMaliyet: (g.maliyet / g.kisi).toFixed(2),
  });
  const toplam = satirlar.reduce((t, s) => ({ kisi: t.kisi + 1, brut: t.brut + s.brutUcret, net: t.net + s.netUcret, maliyet: t.maliyet + s.isverenMaliyeti }), { kisi: 0, brut: 0, net: 0, maliyet: 0 });
  // Küçük departmanlar toplamdan çıkarılarak bulunabilir (canlıda model bu çıkarmayı yaptı);
  // birlikte de üç kişiden azsalar kırılım hiç verilmez.
  if (kucukler.length && diger.kisi < EN_AZ_KISI) {
    return { toplam: satir("Toplam", toplam), departmanlar: [], not: "Departman kırılımı verilmedi: küçük departmanların tutarı toplamdan çıkarılarak kişi ücretini ele verirdi." };
  }
  const departmanlar = [...gruplar.entries()].filter(([, g]) => g.kisi >= EN_AZ_KISI).map(([ad, g]) => satir(ad, g));
  return { toplam: satir("Toplam", toplam), departmanlar: [...departmanlar, ...(kucukler.length ? [satir("Diğer (küçük departmanlar)", diger)] : [])] };
}

const izinTanimi = async (b: AracBaglami, id: string) => {
  const t = (await cagir<any[]>(b, UC.izinListe, [undefined])).find((x) => x.id === id);
  if (!t) throw new BadRequestException("İzin talebi bulunamadı");
  return t;
};

const bilgiTalebi = async (b: AracBaglami, id: string) => {
  const t = (await cagir<any[]>(b, UC.bilgiTalepleri, ["hepsi"])).find((x) => x.id === id);
  if (!t) throw new BadRequestException("Bilgi talebi bulunamadı");
  return t;
};

export const PERSONEL_ARACLARI = [
  arac({
    ad: "personel_ara",
    aciklama: "Personel listesi: ad, sicil no, departman ya da unvanla arama; durum (aktif, askida, ayrildi…). Kimlik, iletişim, banka ve ücret bilgisi dönmez.",
    sinif: "okuma",
    girdi: z.object({ arama: z.string().max(100).optional(), durum: z.string().max(30).optional() }),
    uc: UC.personelListe,
    async calistir(b, g) {
      const s = await cagir(b, UC.personelListe, [g.arama, g.durum, undefined, "20", undefined]);
      return { toplam: s.toplam, kayitlar: (s.kayitlar ?? []).map(personelOzeti), ...(s.sonrakiImlec ? { not: "İlk 20 kayıt; aramayı daraltın." } : {}) };
    },
  }),
  arac({
    ad: "personel_getir",
    aciklama: "Bir personelin kadro bilgisi: departman, pozisyon, işyeri, yönetici, giriş/çıkış tarihi, durum. Kimlik, iletişim, banka ve ücret bilgisi dönmez.",
    sinif: "okuma",
    girdi: z.object({ personelId: uuid("Personel kimliği") }),
    uc: UC.personelGetir,
    async calistir(b, g) {
      return personelOzeti(await cagir(b, UC.personelGetir, [g.personelId]));
    },
  }),
  arac({
    ad: "personel_ozeti",
    aciklama: "Personel panosu: kişi sayıları, departman başına kişi, açık bordro/avans toplamları, bekleyen izinler, süresi dolan belgeler. Tutarlar yalnız toplu.",
    sinif: "okuma",
    girdi: z.object({}),
    uc: UC.personelOzet,
    async calistir(b) {
      const o = await cagir(b, UC.personelOzet, []);
      const tutarVer = (o.aktifPersonel ?? 0) >= EN_AZ_KISI;
      // Küçük departmanların kişi toplamı da üçten azsa tutarları toplamdan çıkarılarak bulunur; o zaman hiçbir departmana tutar yazılmaz.
      const kucukKisi = (o.departmanlar ?? []).filter((d: any) => d.adet < EN_AZ_KISI).reduce((t: number, d: any) => t + d.adet, 0);
      const departmanTutari = tutarVer && (kucukKisi === 0 || kucukKisi >= EN_AZ_KISI);
      return {
        donem: o.donem, toplamPersonel: o.toplamPersonel, aktifPersonel: o.aktifPersonel, durumlar: o.durumlar,
        // Küçük departmanın ücret toplamı kişi ücretidir; yalnız kişi sayısı verilir.
        departmanlar: (o.departmanlar ?? []).map((d: any) => (departmanTutari && d.adet >= EN_AZ_KISI ? sec(d, ["ad", "adet", "isverenMaliyeti"]) : sec(d, ["ad", "adet"]))),
        ...(tutarVer ? { bordro: sec(o.bordro, ["acikAdet", "acikTutar", "donemIsverenMaliyeti", "donemTesvikTasarrufu", "trend"]), avans: o.avans } : { not: `Aktif personel ${EN_AZ_KISI}'ten az; tutarlar verilmez.` }),
        izin: o.izin,
        belgeler: { suresiDolmus: Array.isArray(o.belgeler?.suresiDolmus) ? o.belgeler.suresiDolmus.length : o.belgeler?.suresiDolmus, yaklasan: Array.isArray(o.belgeler?.yaklasan) ? o.belgeler.yaklasan.length : o.belgeler?.yaklasan },
      };
    },
  }),
  arac({
    ad: "personel_maliyet_raporu",
    aciklama: "Ayın bordro maliyeti departman toplamlarıyla: kişi sayısı, toplam brüt/net, işveren maliyeti, kişi başı ortalama. Kişi bazında ücret verilmez.",
    sinif: "okuma",
    girdi: z.object({ yil: z.number().int().min(2000).max(2100), ay: z.number().int().min(1).max(12) }),
    uc: UC.personelMaliyet,
    async calistir(b, g) {
      const r = await cagir(b, UC.personelMaliyet, [String(g.yil), String(g.ay)]);
      return { donem: r.donem, ...maliyetToplamlari(r.satirlar ?? []) };
    },
  }),
  arac({
    ad: "izin_talepleri",
    aciklama: "Personel izin talepleri: kişi, izin türü, tarih aralığı, gün sayısı, durum (talep = onay bekliyor). Açıklamalar dönmez.",
    sinif: "okuma",
    girdi: z.object({ personelId: uuid("Yalnız bu personel").optional(), durum: z.enum(["talep", "onaylandi", "reddedildi", "iptal"]).optional() }),
    uc: UC.izinListe,
    async calistir(b, g) {
      const liste: any[] = await cagir(b, UC.izinListe, [g.personelId]);
      const suzulmus = liste.filter((t) => !g.durum || t.durum === g.durum);
      return { toplam: suzulmus.length, ...kucuk(suzulmus.map(izinOzeti)), adres: adres.izinler() };
    },
  }),
  arac({
    ad: "izin_bakiyesi",
    aciklama: "Bir personelin izin türlerine göre kalan izin bakiyesi (gün).",
    sinif: "okuma",
    girdi: z.object({ personelId: uuid("Personel kimliği") }),
    uc: UC.izinBakiyeleri,
    async calistir(b, g) {
      const liste: any[] = await cagir(b, UC.izinBakiyeleri, [g.personelId]);
      return liste.map((x) => ({ izinTuru: x.izinTuru?.ad, bakiyeTakibi: x.izinTuru?.bakiyeTakibi, bakiyeGun: x.bakiye }));
    },
  }),
  arac({
    ad: "avans_ozeti",
    aciklama: "Personel avanslarının toplu durumu: açık avans sayısı, toplam kalan tutar, avansı olan kişiler (kişi başı tutar verilmez).",
    sinif: "okuma",
    girdi: z.object({}),
    uc: UC.personelAvanslar,
    async calistir(b) {
      const liste: any[] = await cagir(b, UC.personelAvanslar, [undefined]);
      const acik = liste.filter((a) => Number(a.kalanTutar ?? 0) > 0 && !["reddedildi", "iptal"].includes(a.durum));
      const kisiler = [...new Set(acik.map((a) => kisi(a.personel)).filter(Boolean))];
      return {
        acikAvansSayisi: acik.length,
        ...(kisiler.length >= EN_AZ_KISI ? { toplamKalan: acik.reduce((t, a) => t + Number(a.kalanTutar ?? 0), 0).toFixed(2) } : { not: `Avansı olan kişi ${EN_AZ_KISI}'ten az; tutar verilmez.` }),
        onayBekleyen: liste.filter((a) => a.durum === "talep").length,
        kisiler,
      };
    },
  }),
  arac({
    ad: "bilgi_talepleri",
    aciklama: "Çalışanların self-servisten gönderdiği bilgi güncelleme talepleri: kişi, değişmesi istenen alanların adları, durum. Yeni değerler (adres, telefon, IBAN) dönmez; ekranda görülür.",
    sinif: "okuma",
    girdi: z.object({ durum: z.enum(["bekliyor", "onaylandi", "reddedildi", "iptal", "hepsi"]).optional() }),
    uc: UC.bilgiTalepleri,
    async calistir(b, g) {
      const liste: any[] = await cagir(b, UC.bilgiTalepleri, [g.durum ?? "bekliyor", undefined]);
      return {
        toplam: liste.length,
        ...kucuk(liste.map((t) => ({ id: t.id, durum: t.durum, personel: kisi(t.personel), personelId: t.personel?.id, istenenAlanlar: Object.keys(t.istenen ?? {}), tarih: gun(t.createdAt) }))),
        adres: adres.bilgiTalepleri(),
      };
    },
  }),
  arac({
    ad: "izin_talebini_onayla",
    aciklama: "Onay bekleyen izin talebini onaylar (bakiyeden düşer). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ izinId: uuid("İzin talebi kimliği") }),
    uc: UC.izinOnayla,
    async ozetle(b, g) {
      const t = izinOzeti(await izinTanimi(b, g.izinId));
      return `İzin onaylanacak: ${t.personel} · ${t.izinTuru} · ${t.baslangic} – ${t.bitis} · ${t.gunSayisi} gün`;
    },
    hedefDurumu: async (b, g) => izinOzeti(await izinTanimi(b, g.izinId)),
    async calistir(b, g) {
      return { ...sec(await cagir(b, UC.izinOnayla, [g.izinId], g.izinId), ["id", "durum"]), adres: adres.izinler() };
    },
  }),
  arac({
    ad: "izin_talebini_reddet",
    aciklama: "Onay bekleyen izin talebini gerekçeyle reddeder. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ izinId: uuid("İzin talebi kimliği"), neden: z.string().min(3).max(500) }),
    uc: UC.izinReddet,
    async ozetle(b, g) {
      const t = izinOzeti(await izinTanimi(b, g.izinId));
      return `İzin reddedilecek: ${t.personel} · ${t.izinTuru} · ${t.baslangic} – ${t.bitis} · gerekçe: ${g.neden}`;
    },
    hedefDurumu: async (b, g) => izinOzeti(await izinTanimi(b, g.izinId)),
    async calistir(b, g) {
      return { ...sec(await cagir(b, UC.izinReddet, [g.izinId, { neden: g.neden }], g.izinId), ["id", "durum"]), adres: adres.izinler() };
    },
  }),
  arac({
    ad: "bilgi_talebini_onayla",
    aciklama: "Çalışanın bilgi güncelleme talebini onaylar; istenen alanlar personel kartına yazılır. Kullanıcı onayı gerekir; yeni değerleri ekranda kontrol etmesini söyle.",
    sinif: "onay",
    girdi: z.object({ talepId: uuid("Bilgi talebi kimliği") }),
    uc: UC.bilgiOnayla,
    async ozetle(b, g) {
      const t = await bilgiTalebi(b, g.talepId);
      return `Bilgi talebi onaylanacak: ${kisi(t.personel)} · değişecek alanlar: ${Object.keys(t.istenen ?? {}).join(", ")} (yeni değerler ekranda)`;
    },
    hedefDurumu: async (b, g) => { const t = await bilgiTalebi(b, g.talepId); return { durum: t.durum, istenen: t.istenen }; },
    async calistir(b, g) {
      await cagir(b, UC.bilgiOnayla, [g.talepId], g.talepId);
      return { durum: "onaylandi", adres: adres.bilgiTalepleri() };
    },
  }),
  arac({
    ad: "bilgi_talebini_reddet",
    aciklama: "Çalışanın bilgi güncelleme talebini gerekçeyle reddeder. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ talepId: uuid("Bilgi talebi kimliği"), neden: z.string().min(3).max(500) }),
    uc: UC.bilgiReddet,
    async ozetle(b, g) {
      const t = await bilgiTalebi(b, g.talepId);
      return `Bilgi talebi reddedilecek: ${kisi(t.personel)} · alanlar: ${Object.keys(t.istenen ?? {}).join(", ")} · gerekçe: ${g.neden}`;
    },
    hedefDurumu: async (b, g) => { const t = await bilgiTalebi(b, g.talepId); return { durum: t.durum, istenen: t.istenen }; },
    async calistir(b, g) {
      await cagir(b, UC.bilgiReddet, [g.talepId, { neden: g.neden }], g.talepId);
      return { durum: "reddedildi", adres: adres.bilgiTalepleri() };
    },
  }),
];
