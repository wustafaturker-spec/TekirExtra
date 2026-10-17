import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { adres, arac, BUGUN, cagir, kayitIcerigi, para, sayiMetni, sec, tarih, uuid, type AracBaglami } from "./arac";
import { UC } from "./uclar";

/*
 * AI-03/AI-04: onaya tabi araçlar. `ozetle` yalnız okur ve kullanıcının
 * onaylayacağı metni üretir; `calistir` kullanıcı onay düğmesine bastıktan
 * sonra, onun o anki rolüyle çalışır.
 */

const TUR_ADI: Record<string, string> = { teklif: "Teklif", siparis: "Sipariş", irsaliye: "İrsaliye", fatura: "Fatura" };
const FATURA_TIP_ADI: Record<string, string> = { satis: "Satış faturası", alis: "Alış faturası", satis_iade: "Satış iade faturası", alis_iade: "Alış iade faturası", proforma: "Proforma" };

async function belgeTanimi(b: AracBaglami, id: string): Promise<string> {
  const k = await cagir(b, UC.belgeGetir, [id]);
  return `${TUR_ADI[k.tur] ?? "Belge"} ${k.no ?? "(numarasız taslak)"} · ${k.cari?.unvan ?? ""} · ${para(k.genelToplam, k.dovizCinsi)} · durum: ${k.durum}`;
}

async function faturaTanimi(b: AracBaglami, id: string): Promise<string> {
  const k = await cagir(b, UC.faturaGetir, [id]);
  return `${FATURA_TIP_ADI[k.tip] ?? "Fatura"} ${k.no ?? "(numarasız taslak)"} · ${k.cari?.unvan ?? ""} · ${para(k.genelToplam, k.dovizCinsi)} · durum: ${k.durum}`;
}

// AI-27: onayın bağlandığı içerik; talep açılırken ve onayda karşılaştırılır.
const belgeIcerigi = async (b: AracBaglami, id: string) => kayitIcerigi(await cagir(b, UC.belgeGetir, [id]));
const faturaIcerigi = async (b: AracBaglami, id: string) => kayitIcerigi(await cagir(b, UC.faturaGetir, [id]));

/** Adres verilmezse gönderim cari kartındaki adrese gider; onay o adrese bağlanır. */
async function gonderimAdresi(b: AracBaglami, cariId: string | null | undefined, verilen?: string): Promise<string | null> {
  if (verilen) return verilen;
  if (!cariId) return null;
  const cari = await cagir<{ eposta?: string | null }>(b, UC.cariGetir, [cariId]);
  return cari.eposta ?? null;
}

async function belgeGonderimi(b: AracBaglami, id: string, verilen?: string) {
  const belge = await belgeIcerigi(b, id);
  return { belge, alici: await gonderimAdresi(b, belge.cariId as string | null, verilen) };
}

async function faturaGonderimi(b: AracBaglami, id: string, verilen?: string) {
  const fatura = await faturaIcerigi(b, id);
  return { fatura, alici: await gonderimAdresi(b, fatura.cariId as string | null, verilen) };
}

const aliciMetni = (verilen: string | undefined, alici: string | null) =>
  verilen ?? (alici ? `cari kartındaki adres (${alici})` : "cari kartındaki adres (kayıtlı adres yok)");

async function cariTanimi(b: AracBaglami, id: string): Promise<string> {
  const k = await cagir(b, UC.cariGetir, [id]);
  return `${k.unvan} (${k.kod})`;
}

const cariAlanlari = z.object({
  unvan: z.string().min(2).max(255).optional(),
  tip: z.enum(["musteri", "tedarikci", "her_ikisi", "personel", "ortak", "diger"]).optional(),
  kisiTipi: z.enum(["gercek", "tuzel"]).optional(),
  ad: z.string().max(100).optional().describe("Gerçek kişide ad"),
  soyad: z.string().max(100).optional().describe("Gerçek kişide soyad"),
  vknTckn: z.string().max(11).optional(),
  vergiDairesi: z.string().max(120).optional(),
  eposta: z.string().max(255).optional(),
  telefon: z.string().max(32).optional(),
  iban: z.string().max(34).optional(),
  varsayilanVadeGun: z.number().int().min(0).max(365).optional(),
  dovizCinsi: z.string().length(3).optional(),
});

const stokAlanlari = z.object({
  ad: z.string().min(2).max(255).optional(),
  tip: z.enum(["urun", "hizmet", "sarf"]).optional(),
  anaBirim: z.string().max(20).optional(),
  kdvOrani: sayiMetni("KDV oranı (Mevzuat listesinden)").optional(),
  satisFiyati: sayiMetni("KDV hariç satış fiyatı").optional(),
  satisFiyatiDoviz: z.string().length(3).optional(),
  alisFiyati: sayiMetni("KDV hariç alış fiyatı").optional(),
  alisFiyatiDoviz: z.string().length(3).optional(),
  barkod: z.string().max(120).optional(),
  kategoriId: uuid("Stok kategorisi").optional(),
});

const alanListesi = (o: Record<string, unknown>) =>
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join(", ");

const alanFarki = (once: Record<string, unknown>, sonra: Record<string, unknown>) =>
  Object.entries(sonra).filter(([, v]) => v !== undefined).map(([alan, deger]) => ({ alan, once: once[alan], sonra: deger }));

export const ONAYLI_ARACLAR = [
  arac({
    ad: "belge_onayla",
    aciklama: "Taslak teklif/sipariş/irsaliyeyi onaylar (numara verilir, stok rezervi işler). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ belgeId: uuid("Belge kimliği"), riskOnayGerekcesi: z.string().max(500).optional().describe("Risk limiti aşılıyorsa kullanıcının gerekçesi") }),
    uc: UC.belgeOnayla,
    ozetle: async (b, g) => `Onaylanacak: ${await belgeTanimi(b, g.belgeId)}`,
    hedefDurumu: (b, g) => belgeIcerigi(b, g.belgeId),
    async calistir(b, g) {
      const k = await cagir(b, UC.belgeOnayla, [g.belgeId, { riskOnayGerekcesi: g.riskOnayGerekcesi ?? null }], g.belgeId);
      return { ...sec(k, ["id", "no", "durum"]), adres: adres.belge(g.belgeId) };
    },
  }),
  arac({
    ad: "belge_iptal",
    aciklama: "Teklif/sipariş/irsaliyeyi iptal eder (kayıt silinmez, iptal durumuna geçer). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ belgeId: uuid("Belge kimliği") }),
    uc: UC.belgeIptal,
    ozetle: async (b, g) => `İptal edilecek: ${await belgeTanimi(b, g.belgeId)}`,
    hedefDurumu: (b, g) => belgeIcerigi(b, g.belgeId),
    async calistir(b, g) {
      const k = await cagir(b, UC.belgeIptal, [g.belgeId, { uyariOnaylandi: false }], g.belgeId);
      return { ...sec(k, ["id", "no", "durum"]), adres: adres.belge(g.belgeId) };
    },
  }),
  arac({
    ad: "belge_donustur",
    aciklama: "Onaylanmış teklifi siparişe/faturaya veya onaylanmış siparişi irsaliyeye/faturaya dönüştürür. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({
      belgeId: uuid("Dönüştürülecek kaynak belge kimliği"),
      hedef: z.enum(["siparis", "irsaliye", "fatura"]).describe("Dönüştürülecek hedef belge türü"),
    }),
    uc: UC.belgeDonustur,
    ozetle: async (b, g) => `${await belgeTanimi(b, g.belgeId)} belgesi ${TUR_ADI[g.hedef] ?? g.hedef} türüne dönüştürülecek`,
    hedefDurumu: (b, g) => belgeIcerigi(b, g.belgeId),
    async calistir(b, g) {
      const k = await cagir(b, UC.belgeDonustur, [g.belgeId, { hedef: g.hedef }], g.belgeId);
      const yeniId = (k as { belgeId?: string; faturaId?: string }).belgeId ?? (k as { faturaId?: string }).faturaId;
      const yeniAdres = (k as { donusenTur?: string }).donusenTur === "fatura" ? (yeniId ? adres.fatura(yeniId) : undefined) : (yeniId ? adres.belge(yeniId) : undefined);
      return { ...k, ...(yeniAdres ? { adres: yeniAdres } : {}) };
    },
  }),
  arac({
    ad: "fatura_kesinlestir",
    aciklama: "Taslak faturayı kesinleştirir (numara verilir, cari ve stok işler). e-Belge göndermez. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ faturaId: uuid("Fatura kimliği"), riskOnayGerekcesi: z.string().max(500).optional() }),
    uc: UC.faturaKesinlestir,
    ozetle: async (b, g) => `Kesinleştirilecek: ${await faturaTanimi(b, g.faturaId)}`,
    hedefDurumu: (b, g) => faturaIcerigi(b, g.faturaId),
    async calistir(b, g) {
      const k = await cagir(b, UC.faturaKesinlestir, [g.faturaId, { riskOnayGerekcesi: g.riskOnayGerekcesi ?? null }], g.faturaId);
      return { ...sec(k, ["id", "no", "durum", "genelToplam"]), adres: adres.fatura(g.faturaId) };
    },
  }),
  arac({
    ad: "fatura_iptal",
    aciklama: "Faturayı iptal eder (kayıt silinmez; ters kayıtlar oluşur). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ faturaId: uuid("Fatura kimliği") }),
    uc: UC.faturaIptal,
    ozetle: async (b, g) => `İptal edilecek: ${await faturaTanimi(b, g.faturaId)}`,
    hedefDurumu: (b, g) => faturaIcerigi(b, g.faturaId),
    async calistir(b, g) {
      const k = await cagir(b, UC.faturaIptal, [g.faturaId], g.faturaId);
      return { ...sec(k, ["id", "no", "durum"]), adres: adres.fatura(g.faturaId) };
    },
  }),
  arac({
    ad: "belge_eposta_gonder",
    aciklama: "Onaylı satış teklifi/siparişi/irsaliyesini PDF ekiyle e-postalar. Adres verilmezse cari kartındaki adres. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ belgeId: uuid("Belge kimliği"), eposta: z.string().max(255).optional() }),
    uc: UC.belgeEposta,
    async ozetle(b, g) {
      const { alici } = await belgeGonderimi(b, g.belgeId, g.eposta);
      return `E-postayla gönderilecek: ${await belgeTanimi(b, g.belgeId)} → ${aliciMetni(g.eposta, alici)}`;
    },
    hedefDurumu: (b, g) => belgeGonderimi(b, g.belgeId, g.eposta),
    async calistir(b, g) {
      return cagir(b, UC.belgeEposta, [g.belgeId, g.eposta ? { eposta: g.eposta } : {}], g.belgeId);
    },
  }),
  arac({
    ad: "fatura_eposta_gonder",
    aciklama: "Faturayı PDF ekiyle e-postalar. Adres verilmezse cari kartındaki adres. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ faturaId: uuid("Fatura kimliği"), eposta: z.string().max(255).optional() }),
    uc: UC.faturaEposta,
    async ozetle(b, g) {
      const { alici } = await faturaGonderimi(b, g.faturaId, g.eposta);
      return `E-postayla gönderilecek: ${await faturaTanimi(b, g.faturaId)} → ${aliciMetni(g.eposta, alici)}`;
    },
    hedefDurumu: (b, g) => faturaGonderimi(b, g.faturaId, g.eposta),
    async calistir(b, g) {
      return cagir(b, UC.faturaEposta, [g.faturaId, g.eposta ? { eposta: g.eposta } : {}], g.faturaId);
    },
  }),
  arac({
    ad: "ebelge_gonder",
    aciklama: "Kesin faturayı e-Fatura/e-Arşiv olarak entegratöre gönderim kuyruğuna alır (GİB'e gider). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ faturaId: uuid("Fatura kimliği") }),
    uc: UC.ebelgeGonder,
    ozetle: async (b, g) => `e-Belge olarak gönderilecek (GİB): ${await faturaTanimi(b, g.faturaId)}`,
    hedefDurumu: (b, g) => faturaIcerigi(b, g.faturaId),
    async calistir(b, g) {
      return cagir(b, UC.ebelgeGonder, [g.faturaId, {}], g.faturaId);
    },
  }),
  arac({
    ad: "cari_ekstre_eposta",
    aciklama: "Cari hesap ekstresini PDF olarak e-postalar. Alıcı verilmezse cari kartındaki adres. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({
      cariId: uuid("Cari kimliği"),
      baslangic: tarih("Başlangıç").optional(),
      bitis: tarih("Bitiş").optional(),
      alici: z.string().max(255).optional(),
      tur: z.enum(["standart", "ayrintili", "doviz"]).optional(),
    }),
    uc: UC.cariEkstreEposta,
    ozetle: async (b, g) =>
      `Ekstre e-postalanacak: ${await cariTanimi(b, g.cariId)} · ${g.baslangic ?? "başlangıç"} – ${g.bitis ?? "bugün"} → ${g.alici ?? "cari kartındaki adres"}`,
    async calistir(b, g) {
      const { cariId, ...govde } = g;
      return cagir(b, UC.cariEkstreEposta, [cariId, govde], cariId);
    },
  }),
  arac({
    ad: "kasa_banka_hareketi_kaydet",
    aciklama:
      "Tahsilat veya tediye kaydeder (kasa ya da banka hesabına; cari ve fatura bağlanabilir). Hesap kimliği için kasa_banka_hesaplari. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({
      tip: z.enum(["tahsilat", "tediye"]),
      hesapTuru: z.enum(["kasa", "banka"]),
      hesapId: uuid("Kasa ya da banka hesabı kimliği"),
      tutar: sayiMetni("Tutar (hesap dövizinde)"),
      dovizCinsi: z.string().length(3).optional().describe("Hesabın dövizi; varsayılan TRY"),
      tarih: tarih("İşlem tarihi; varsayılan bugün").optional(),
      cariId: uuid("Cari kimliği").optional(),
      faturaId: uuid("Kapatılacak fatura").optional(),
      aciklama: z.string().max(500).optional(),
    }),
    uc: UC.kasaBankaHareket,
    async ozetle(b, g) {
      const hesaplar = await cagir<any[]>(b, g.hesapTuru === "kasa" ? UC.kasaListe : UC.bankaListe, []);
      const hesap = hesaplar.find((h) => h.id === g.hesapId);
      const cari = g.cariId ? ` · cari: ${await cariTanimi(b, g.cariId)}` : "";
      const fatura = g.faturaId ? ` · fatura: ${await faturaTanimi(b, g.faturaId)}` : "";
      return `${g.tip === "tahsilat" ? "Tahsilat" : "Tediye"}: ${para(g.tutar, g.dovizCinsi ?? hesap?.dovizCinsi ?? "TRY")} · ${g.hesapTuru}: ${hesap?.ad ?? g.hesapId} · tarih ${g.tarih ?? BUGUN()}${cari}${fatura}`;
    },
    async calistir(b, g) {
      const k = await cagir(b, UC.kasaBankaHareket, [{
        kasaId: g.hesapTuru === "kasa" ? g.hesapId : null,
        bankaHesapId: g.hesapTuru === "banka" ? g.hesapId : null,
        tip: g.tip, tutar: g.tutar, dovizCinsi: (g.dovizCinsi ?? "TRY").toUpperCase(), tarih: g.tarih ?? BUGUN(),
        cariId: g.cariId ?? null, faturaId: g.faturaId ?? null, aciklama: g.aciklama ?? null,
      }]);
      return sec(k, ["id", "tip", "tutar", "dovizCinsi", "tarih"]);
    },
  }),
  arac({
    ad: "cari_olustur",
    aciklama: "Yeni cari kartı açar. Cari kodunu kullanıcıdan al ya da mevcut kod düzenine göre öner. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: cariAlanlari.extend({ kod: z.string().min(1).max(32), unvan: z.string().min(2).max(255), tip: z.enum(["musteri", "tedarikci", "her_ikisi", "personel", "ortak", "diger"]) }),
    uc: UC.cariOlustur,
    ozetle: async (_b, g) => `Yeni cari: ${alanListesi(g)}`,
    async calistir(b, g) {
      const k = await cagir(b, UC.cariOlustur, [g]);
      return { ...sec(k, ["id", "kod", "unvan"]), adres: adres.cari(k.id) };
    },
  }),
  arac({
    ad: "cari_guncelle",
    aciklama: "Cari kartının alanlarını günceller (yalnız verilen alanlar). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ cariId: uuid("Cari kimliği"), degisiklikler: cariAlanlari }),
    uc: UC.cariGuncelle,
    ozetle: async (b, g) => `Cari güncellenecek: ${await cariTanimi(b, g.cariId)} → ${alanListesi(g.degisiklikler)}`,
    async onizle(b, g) {
      const k = await cagir<Record<string, unknown>>(b, UC.cariGetir, [g.cariId]);
      return { eylem: "Cari kartını güncelle", hedef: `${k.unvan} (${k.kod})`, degisiklikler: alanFarki(k, g.degisiklikler) };
    },
    // Önizlemedeki "önceki" değerler; arada biri değişirse fark artık doğru değildir.
    async hedefDurumu(b, g) {
      const k = await cagir<Record<string, unknown>>(b, UC.cariGetir, [g.cariId]);
      return alanFarki(k, g.degisiklikler).map((f) => [f.alan, f.once ?? null]);
    },
    async calistir(b, g) {
      const k = await cagir(b, UC.cariGuncelle, [g.cariId, g.degisiklikler], g.cariId);
      return { ...sec(k, ["id", "kod", "unvan"]), adres: adres.cari(g.cariId) };
    },
  }),
  arac({
    ad: "stok_karti_olustur",
    aciklama: "Yeni stok/hizmet kartı açar. Stok kodunu kullanıcıdan al ya da mevcut kod düzenine göre öner. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: stokAlanlari.extend({ kod: z.string().min(1).max(32), ad: z.string().min(2).max(255) }),
    uc: UC.stokOlustur,
    ozetle: async (_b, g) => `Yeni stok kartı: ${alanListesi(g)}`,
    async calistir(b, g) {
      const k = await cagir(b, UC.stokOlustur, [g]);
      return { ...sec(k, ["id", "kod", "ad"]), adres: adres.stok(k.id) };
    },
  }),
  arac({
    ad: "stok_karti_guncelle",
    aciklama: "Stok kartının alanlarını (fiyat, KDV, birim, ad…) günceller. Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({ stokId: uuid("Stok kartı kimliği"), degisiklikler: stokAlanlari }),
    uc: UC.stokGuncelle,
    async ozetle(b, g) {
      const k = await cagir(b, UC.stokGetir, [g.stokId]);
      return `Stok kartı güncellenecek: ${k.ad} (${k.kod}) → ${alanListesi(g.degisiklikler)}`;
    },
    async onizle(b, g) {
      const k = await cagir<Record<string, unknown>>(b, UC.stokGetir, [g.stokId]);
      return { eylem: "Stok kartını güncelle", hedef: `${k.ad} (${k.kod})`, degisiklikler: alanFarki(k, g.degisiklikler) };
    },
    async hedefDurumu(b, g) {
      const k = await cagir<Record<string, unknown>>(b, UC.stokGetir, [g.stokId]);
      return alanFarki(k, g.degisiklikler).map((f) => [f.alan, f.once ?? null]);
    },
    async calistir(b, g) {
      const k = await cagir(b, UC.stokGuncelle, [g.stokId, g.degisiklikler], g.stokId);
      return { ...sec(k, ["id", "kod", "ad"]), adres: adres.stok(g.stokId) };
    },
  }),
  arac({
    ad: "odeme_hatirlatmasi_gonder",
    aciklama:
      "Vadesi geçmiş alacağı olan carilere hatırlatma ya da ihtar e-postası gönderir (vade hatırlatma şablonu, ekstre ekli; son 7 günde hatırlatma alan atlanır). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({
      cariIdler: z.array(uuid("Cari kimliği")).min(1).max(50),
      kademe: z.enum(["hatirlatma", "ihtar"]),
      not: z.string().max(1000).optional().describe("E-postaya eklenecek kısa not"),
    }),
    uc: UC.vadeHatirlatmaGonder,
    async ozetle(b, g) {
      const adlar = [];
      for (const id of g.cariIdler.slice(0, 10)) adlar.push(await cariTanimi(b, id));
      return `${g.kademe === "ihtar" ? "Ödeme ihtarı" : "Vade hatırlatması"} e-postası gönderilecek: ${adlar.join(", ")}${g.cariIdler.length > 10 ? ` ve ${g.cariIdler.length - 10} cari daha` : ""}${g.not ? ` · not: “${g.not}”` : ""}`;
    },
    async calistir(b, g) {
      const sonuc = await cagir<any[]>(b, UC.vadeHatirlatmaGonder, [{ cariIdler: g.cariIdler, kademe: g.kademe, not: g.not ?? null }]);
      return { sonuclar: sonuc.map((x) => sec(x, ["unvan", "durum", "mesaj"])) };
    },
  }),
  arac({
    ad: "gelen_epostadan_crm_gorevi_ac",
    aciklama:
      "Gelen bir e-postayı temel alarak ilgili cariye CRM fırsatı veya destek talebi/görevi açar. E-posta bir cariyle eşleşmemişse cariId zorunludur (cari_ara ile bul, emin değilsen kullanıcıya sor; tahminle cari seçme). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({
      epostaId: uuid("Gelen e-posta kimliği"),
      cariId: uuid("Fırsatın açılacağı cari; e-posta bir cariyle eşleşmediyse zorunlu").optional(),
    }),
    uc: UC.gelenEpostaCrmGorev,
    async ozetle(b, g) {
      const e = await cagir<any>(b, UC.gelenEpostaGetir, [g.epostaId]);
      const cariId = g.cariId ?? e.cariId;
      // Cari yoksa onay talebi açılmaz; asistan cariyi kullanıcıya sorar.
      if (!cariId) throw new BadRequestException("E-posta bir cariyle eşleşmedi; fırsatın açılacağı cariyi kullanıcıya sorup cariId ile tekrar deneyin.");
      const cari = await cagir<any>(b, UC.cariGetir, [cariId]);
      return `Gelen e-postadan CRM görevi açılacak: "${e.konu}" (Gönderen: ${e.gonderenAdi || e.gonderenEposta}) · Cari: ${cari.unvan}`;
    },
    async calistir(b, g) {
      const gorev = await cagir<any>(b, UC.gelenEpostaCrmGorev, [g.epostaId, g.cariId ? { cariId: g.cariId } : {}]);
      return {
        mesaj: "CRM görevi başarıyla oluşturuldu",
        gorev: sec(gorev, ["id", "baslik", "durum", "oncelik"]),
        adres: adres.eposta(),
      };
    },
  }),
  arac({
    ad: "gelen_eposta_durum_guncelle",
    aciklama:
      "Gelen bir e-postanın işlem durumunu günceller ('yeni', 'islendi', 'arsivlendi'). Kullanıcı onayı gerekir.",
    sinif: "onay",
    girdi: z.object({
      epostaId: uuid("Gelen e-posta kimliği"),
      durum: z.enum(["yeni", "islendi", "arsivlendi"]).describe("Yeni işlem durumu"),
    }),
    uc: UC.gelenEpostaDurum,
    async ozetle(b, g) {
      const e = await cagir<any>(b, UC.gelenEpostaGetir, [g.epostaId]);
      return `Gelen e-posta ("${e.konu}") durumu "${g.durum}" olarak güncellenecek.`;
    },
    async onizle(b, g) {
      const e = await cagir<any>(b, UC.gelenEpostaGetir, [g.epostaId]);
      return { eylem: "E-posta durumunu güncelle", hedef: e.konu, degisiklikler: [{ alan: "durum", once: e.durum, sonra: g.durum }] };
    },
    async calistir(b, g) {
      const sonuc = await cagir<any>(b, UC.gelenEpostaDurum, [g.epostaId, { durum: g.durum }]);
      return {
        id: g.epostaId,
        durum: sonuc.durum,
        mesaj: `E-posta durumu "${g.durum}" olarak güncellendi.`,
        adres: adres.eposta(),
      };
    },
  }),
];
