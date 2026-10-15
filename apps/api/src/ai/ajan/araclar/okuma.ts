import { z } from "zod";
import { adres, arac, BUGUN, cagir, sec, tarih, uuid } from "./arac";
import { UC } from "./uclar";

const CARI_ALANLARI = ["id", "kod", "unvan", "tip", "vknTckn", "eposta", "telefon", "aktif", "bakiyeler"];
const STOK_ALANLARI = ["id", "kod", "ad", "tip", "anaBirim", "kdvOrani", "satisFiyati", "satisFiyatiDoviz", "mevcutMiktar", "aktif"];
const BELGE_ALANLARI = ["id", "no", "tur", "yon", "durum", "tarih", "gecerlilikTarihi", "dovizCinsi", "genelToplam", "odemeVadeGun"];
const FATURA_ALANLARI = ["id", "no", "tip", "durum", "tarih", "vadeTarihi", "dovizCinsi", "genelToplam", "senaryo", "odemeOzeti"];

/**
 * Çok kelimeli arama sonuç vermezse ilk kelimeyle yeniden arar (kayıttaki
 * yazım farkı: canlıda "KARSEL OTOMOTİV" araması "KARSEL OTOTMOTİV" kaydını
 * bulamadı). Adaylar "tam eşleşme yok" notuyla döner; model kullanıcıya sorar.
 */
async function genisleterekAra(arama: string | undefined, ara: (metin: string | undefined) => Promise<any[]>) {
  const kayitlar = await ara(arama || undefined);
  const ilkKelime = arama?.trim().split(/\s+/)[0];
  if (kayitlar.length || !arama || !ilkKelime || ilkKelime === arama.trim()) return { kayitlar };
  return { kayitlar: await ara(ilkKelime), not: `"${arama}" tam eşleşmedi; "${ilkKelime}" ile bulunan adaylar. Doğru kaydı kullanıcıya sor.` };
}

const varyantlar = (v: any[] | undefined) => (v ?? []).map((x) => sec(x, ["id", "kod", "ad", "mevcutMiktar", "aktif"]));
const cariKisa = (c: any) => (c ? sec(c, ["id", "kod", "unvan"]) : null);
const satirlar = (s: any[] | undefined) =>
  (s ?? []).slice(0, 50).map((x) => ({
    ...sec(x, ["id", "miktar", "birim", "birimFiyat", "iskontoOrani", "kdvOrani", "matrah", "toplamTutar"]),
    stok: x.stok ? sec(x.stok, ["id", "kod", "ad"]) : undefined,
  }));

export const OKUMA_ARACLARI = [
  arac({
    ad: "cari_ara",
    aciklama: "Cari hesapları (müşteri/tedarikçi) unvan, kod, VKN/TCKN veya telefonla arar ya da tipe göre listeler; bakiyeleri döviz bazında döner. Birden çok sonuç çıkarsa kullanıcıya hangisi olduğunu sor.",
    sinif: "okuma",
    girdi: z.object({
      arama: z.string().optional().describe("Arama metni; boşsa süzgece uyan ilk kayıtlar"),
      tip: z.enum(["musteri", "tedarikci", "her_ikisi", "personel", "ortak", "diger"]).optional().describe("Cari tipi süzgeci"),
      adet: z.number().int().min(1).max(20).optional().describe("En çok kaç kayıt (varsayılan 10)"),
    }),
    uc: UC.cariListe,
    async calistir(b, g) {
      const { kayitlar, not } = await genisleterekAra(g.arama, async (m) => (await cagir(b, UC.cariListe, [m, undefined, String(g.adet ?? 10), g.tip])).kayitlar ?? []);
      return { ...(not ? { not } : {}), kayitlar: kayitlar.map((k: any) => ({ ...sec(k, CARI_ALANLARI), adres: adres.cari(k.id) })) };
    },
  }),
  arac({
    ad: "cari_getir",
    aciklama: "Bir cari kartının ayrıntısı: iletişim, kişiler, bakiyeler, risk durumu, grup ve fiyat listesi.",
    sinif: "okuma",
    girdi: z.object({ cariId: uuid("Cari kimliği (cari_ara sonucundaki id)") }),
    uc: UC.cariGetir,
    async calistir(b, g) {
      const k = await cagir(b, UC.cariGetir, [g.cariId]);
      return {
        ...sec(k, [...CARI_ALANLARI, "vergiDairesi", "varsayilanVadeGun", "dovizCinsi", "risk", "karaListe"]),
        grup: k.grup ? sec(k.grup, ["ad", "riskLimiti"]) : null,
        fiyatListesi: k.fiyatListesi ?? null,
        kisiler: (k.kisiler ?? []).map((x: any) => sec(x, ["adSoyad", "gorev", "eposta", "telefon"])),
        adres: adres.cari(k.id),
      };
    },
  }),
  arac({
    ad: "stok_ara",
    aciklama: "Stok/hizmet kartlarını ad, kod veya barkodla arar; mevcut miktar, birim, KDV ve satış fiyatı döner. Varyantlı üründe varyantları da listeler.",
    sinif: "okuma",
    girdi: z.object({ arama: z.string().optional().describe("Arama metni; boşsa ilk kayıtlar") }),
    uc: UC.stokListe,
    async calistir(b, g) {
      const { kayitlar, not } = await genisleterekAra(g.arama, async (m) => (await cagir(b, UC.stokListe, [m, undefined, undefined, "10"])).kayitlar ?? []);
      return {
        ...(not ? { not } : {}),
        kayitlar: kayitlar.map((k: any) => ({ ...sec(k, STOK_ALANLARI), varyantlar: varyantlar(k.varyantlar), adres: adres.stok(k.id) })),
      };
    },
  }),
  arac({
    ad: "stok_getir",
    aciklama: "Bir stok kartının ayrıntısı: depo bazında bakiyeler, varyantlar, birimler, fiyatlar.",
    sinif: "okuma",
    girdi: z.object({ stokId: uuid("Stok kartı kimliği") }),
    uc: UC.stokGetir,
    async calistir(b, g) {
      const k = await cagir(b, UC.stokGetir, [g.stokId]);
      return {
        ...sec(k, [...STOK_ALANLARI, "alisFiyati", "alisFiyatiDoviz", "kritikSeviye"]),
        birimler: (k.birimler ?? []).map((x: any) => sec(x, ["ad", "katsayi"])),
        varyantlar: (k.varyantlar ?? []).map((v: any) => ({
          ...sec(v, ["id", "kod", "ad", "mevcutMiktar", "aktif"]),
          depolar: (v.depoBakiyeleri ?? []).map((d: any) => ({ depo: d.depo?.ad, miktar: d.miktar })),
        })),
        depolar: (k.depoBakiyeleri ?? []).map((d: any) => ({ depo: d.depo?.ad, miktar: d.miktar })),
        adres: adres.stok(k.id),
      };
    },
  }),
  arac({
    ad: "fiyat_onerisi",
    aciklama: "Bir ürünün bu cariye göre önerilen birim fiyatı (fiyat listesi, kart fiyatı, döviz çevrimi).",
    sinif: "okuma",
    girdi: z.object({
      stokId: uuid("Stok kartı kimliği"),
      cariId: uuid("Cari kimliği").optional(),
      yon: z.enum(["satis", "alis"]).optional().describe("Varsayılan satış"),
      dovizCinsi: z.string().length(3).optional().describe("Belge dövizi, varsayılan TRY"),
      varyantId: uuid("Varyant kimliği").optional(),
    }),
    uc: UC.stokTavsiyeFiyat,
    async calistir(b, g) {
      const f = await cagir(b, UC.stokTavsiyeFiyat, [g.stokId, g.cariId, g.yon ?? "satis", g.dovizCinsi ?? "TRY", undefined, "1", undefined, g.varyantId]);
      return sec(f, ["birimFiyat", "kaynakFiyat", "dovizCinsi", "cevrilebilir", "fiyatKaynagi", "iskontoOrani"]);
    },
  }),
  arac({
    ad: "belge_ara",
    aciklama: "Teklif, sipariş ve irsaliyeleri arar (numara, cari unvanı). Tür, yön, durum ve tarih aralığıyla süzülebilir.",
    sinif: "okuma",
    girdi: z.object({
      tur: z.enum(["teklif", "siparis", "irsaliye"]).optional(),
      yon: z.enum(["satis", "alis"]).optional(),
      durum: z.string().optional().describe("taslak, onaylandi, kismen_kapandi, kapandi, iptal"),
      arama: z.string().optional(),
      baslangic: tarih("Başlangıç tarihi").optional(),
      bitis: tarih("Bitiş tarihi").optional(),
    }),
    uc: UC.belgeListe,
    async calistir(b, g) {
      const s = await cagir(b, UC.belgeListe, [g.tur, g.yon, g.durum, g.arama, g.baslangic, g.bitis]);
      return { kayitlar: (s.kayitlar ?? []).slice(0, 20).map((k: any) => ({ ...sec(k, BELGE_ALANLARI), cari: cariKisa(k.cari), adres: adres.belge(k.id) })) };
    },
  }),
  arac({
    ad: "belge_getir",
    aciklama: "Bir teklif/sipariş/irsaliyenin ayrıntısı ve satırları.",
    sinif: "okuma",
    girdi: z.object({ belgeId: uuid("Belge kimliği") }),
    uc: UC.belgeGetir,
    async calistir(b, g) {
      const k = await cagir(b, UC.belgeGetir, [g.belgeId]);
      return { ...sec(k, [...BELGE_ALANLARI, "toplamMatrah", "toplamKdv", "aciklama"]), cari: cariKisa(k.cari), satirlar: satirlar(k.satirlar), adres: adres.belge(k.id) };
    },
  }),
  arac({
    ad: "fatura_ara",
    aciklama: "Faturaları arar (numara, cari unvanı). Tip, durum, cari ve tarih aralığıyla süzülebilir.",
    sinif: "okuma",
    girdi: z.object({
      arama: z.string().optional(),
      tip: z.enum(["satis", "alis", "satis_iade", "alis_iade", "proforma"]).optional(),
      durum: z.enum(["taslak", "kesin", "iptal"]).optional(),
      cariId: uuid("Cari kimliği").optional(),
      baslangic: tarih("Başlangıç tarihi").optional(),
      bitis: tarih("Bitiş tarihi").optional(),
    }),
    uc: UC.faturaListe,
    async calistir(b, g) {
      const s = await cagir(b, UC.faturaListe, [g.arama, g.tip, g.durum, undefined, "20", undefined, undefined, g.cariId, g.baslangic, g.bitis]);
      return { kayitlar: (s.kayitlar ?? []).map((k: any) => ({ ...sec(k, FATURA_ALANLARI), cari: cariKisa(k.cari), adres: adres.fatura(k.id) })) };
    },
  }),
  arac({
    ad: "fatura_getir",
    aciklama: "Bir faturanın ayrıntısı, satırları ve ödeme durumu.",
    sinif: "okuma",
    girdi: z.object({ faturaId: uuid("Fatura kimliği") }),
    uc: UC.faturaGetir,
    async calistir(b, g) {
      const k = await cagir(b, UC.faturaGetir, [g.faturaId]);
      return { ...sec(k, [...FATURA_ALANLARI, "toplamMatrah", "toplamKdv", "aciklama"]), cari: cariKisa(k.cari), satirlar: satirlar(k.satirlar), adres: adres.fatura(k.id) };
    },
  }),
  arac({
    ad: "vadesi_gecen_alacaklar",
    aciklama: "Vadesi geçmiş, kalan tutarı olan kesin faturalar (alacak ve borç); rapor ekranıyla aynı hesap.",
    sinif: "okuma",
    girdi: z.object({}),
    uc: UC.vadesiGecenler,
    async calistir(b) {
      const r = await cagir(b, UC.vadesiGecenler, []);
      return {
        toplamAlacakTry: r.toplamAlacak,
        alacakSayisi: r.alacakSayisi,
        toplamBorcTry: r.toplamBorc,
        borcSayisi: r.borcSayisi,
        enEskiAlacaklar: (r.alacaklar ?? []).slice(0, 20),
        enEskiBorclar: (r.borclar ?? []).slice(0, 10),
      };
    },
  }),
  arac({
    ad: "kasa_banka_hesaplari",
    aciklama: "Aktif kasa ve banka hesapları (tahsilat/tediye kaydında hangi hesabın kullanılacağını seçmek için).",
    sinif: "okuma",
    girdi: z.object({}),
    uc: UC.kasaListe,
    async calistir(b) {
      const [kasalar, bankalar] = await Promise.all([cagir<any[]>(b, UC.kasaListe, []), cagir<any[]>(b, UC.bankaListe, [])]);
      return {
        kasalar: (kasalar ?? []).map((k) => sec(k, ["id", "kod", "ad", "dovizCinsi", "bakiye", "aktif"])),
        bankalar: (bankalar ?? []).map((k) => sec(k, ["id", "ad", "bankaAdi", "dovizCinsi", "bakiye", "aktif"])),
      };
    },
  }),
  arac({
    ad: "masraf_kategorileri",
    aciklama: "Masraf kategorileri (masraf taslağı açarken kategori seçmek için).",
    sinif: "okuma",
    girdi: z.object({}),
    uc: UC.masrafKategoriler,
    async calistir(b) {
      const k = await cagir<any[]>(b, UC.masrafKategoriler, []);
      return { kategoriler: (k ?? []).map((x) => ({ ...sec(x, ["id", "ad", "varsayilanKdvOrani"]), ust: x.ust?.ad })) };
    },
  }),
  arac({
    ad: "rapor_katalogu",
    aciklama:
      "Kullanıcının görebildiği hazır raporlar (kod, ad, süzgeçler). Satış, alış, cari, stok, kasa-banka, vergi sorularında önce uygun raporu buradan bul, sonra rapor_calistir ile çalıştır.",
    sinif: "okuma",
    girdi: z.object({ modul: z.string().optional().describe("fatura, cari, stok, kasa_banka, vergi, genel…") }),
    uc: UC.raporKatalogu,
    async calistir(b, g) {
      const liste = await cagir<any[]>(b, UC.raporKatalogu, [g.modul]);
      return {
        raporlar: liste.map((r) => ({
          kod: r.kod, modul: r.modul, ad: r.ad, aciklama: r.aciklama ?? undefined,
          suzgecler: (r.filtreler ?? []).map((f: any) => ({ ...sec(f, ["alan", "ad", "tip", "zorunlu"]), secenekler: f.secenekler?.slice(0, 20).map((x: any) => x.deger) })),
          gruplamalar: (r.gruplamalar ?? []).map((x: any) => x.deger),
        })),
      };
    },
  }),
  arac({
    ad: "rapor_calistir",
    aciklama:
      "Rapor kataloğundaki bir raporu süzgeçlerle çalıştırır; rakamlar rapor ekranıyla aynıdır. Tarih süzgeçleri YYYY-AA-GG. Sonuçta ilk 30 satır, toplam satır sayısı ve toplamlar döner; ekran bağlantısını da ver.",
    sinif: "okuma",
    girdi: z.object({
      kod: z.string().min(1).describe("rapor_katalogu'ndaki rapor kodu"),
      suzgecler: z
        .array(z.object({ alan: z.string().describe("katalogdaki suzgecler[].alan (ör. baslangic, bitis)"), deger: z.string() }))
        .optional()
        .describe("Süzgeç değerleri"),
      gruplama: z.string().optional(),
    }),
    uc: UC.raporCalistir,
    async calistir(b, g) {
      const filtreler = Object.fromEntries((g.suzgecler ?? []).map((x) => [x.alan, x.deger === "true" ? true : x.deger === "false" ? false : x.deger]));
      const r = await cagir(b, UC.raporCalistir, [g.kod, { filtreler, ...(g.gruplama ? { gruplama: g.gruplama } : {}) }]);
      // Rapor ekranının paylaşılabilir adresi: ?rapor=kod&f.<süzgeç>=değer&g=gruplama (RPR-10).
      const sorgu = new URLSearchParams({ rapor: g.kod, ...Object.fromEntries(Object.entries(filtreler).map(([k, v]) => [`f.${k}`, String(v)])) });
      if (g.gruplama) sorgu.set("g", g.gruplama);
      return {
        ad: r.ad,
        kolonlar: (r.kolonlar ?? []).map((k: any) => sec(k, ["alan", "baslik", "tip", "dovizAlani"])),
        satirlar: (r.satirlar ?? []).slice(0, 30),
        satirSayisi: r.satirSayisi,
        toplamlar: r.toplamlar,
        adres: `/panel/raporlar?${sorgu.toString()}`,
      };
    },
  }),
  arac({
    ad: "finansal_ozet",
    aciklama: "Bugün itibarıyla nakit varlıklar, stok değeri, alacaklar, borçlar ve net varlık (panel özetiyle aynı hesap).",
    sinif: "okuma",
    girdi: z.object({}),
    uc: UC.finansalOzet,
    calistir: (b) => cagir(b, UC.finansalOzet, []),
  }),
  arac({
    ad: "gelir_gider",
    aciklama: "Dönemin gelir-gider ve kâr/zarar özeti (satış hasılatı, satılan malın maliyeti, brüt ve net kâr, gider kırılımı). Kâr sorularında bunu kullan.",
    sinif: "okuma",
    girdi: z.object({
      baslangic: tarih("Dönem başı"),
      bitis: tarih("Dönem sonu"),
      ileriTarihDahil: z.boolean().optional().describe("Kullanıcı bugünden sonraki tarihleri açıkça istediyse true"),
    }),
    uc: UC.gelirGider,
    async calistir(b, g) {
      // "Bu ay" sorusunda ay sonuna kadar alınırsa ileri tarihli tahakkuklar (kira, maaş) kârı değiştirir;
      // canlıda aynı gün iki farklı net kâr verildi. Kullanıcı istemedikçe bitiş bugüne çekilir.
      const bugun = BUGUN();
      const bitis = !g.ileriTarihDahil && g.bitis > bugun ? bugun : g.bitis;
      const r = await cagir(b, UC.gelirGider, [g.baslangic, bitis]);
      return {
        donem: { baslangic: r.baslangicTarihi, bitis: r.bitisTarihi },
        ozet: r.ozet,
        karZarar: r.karZarar,
        giderKategorileri: (r.giderKategorileri ?? []).slice(0, 15),
        uyarilar: [...(bitis !== g.bitis ? [`Bitiş tarihi bugüne (${bugun}) çekildi; ileri tarihli tahakkuklar dahil değil.`] : []), ...(r.uyarilar ?? [])],
        adres: `/panel/raporlar/gelir-gider?baslangic=${g.baslangic}&bitis=${bitis}`,
      };
    },
  }),
  arac({
    ad: "tahsilat_oncelikleri",
    aciklama:
      "Bugün kimi aramalı: vadesi geçmiş ya da 7 gün içinde dolacak alacakları cari başına öncelik puanıyla sıralar (kalan tutar × risk katsayısı × (1 + gecikme/30); risk cari kartındaki ödeme davranışı analizinden). Puanın bileşenlerini de açıkla.",
    sinif: "okuma",
    girdi: z.object({ adet: z.number().int().min(1).max(50).optional().describe("Varsayılan 10") }),
    uc: UC.tahsilatOncelikleri,
    async calistir(b, g) {
      const liste = await cagir<any[]>(b, UC.tahsilatOncelikleri, [String(g.adet ?? 10)]);
      return { oncelikler: liste.map((x) => ({ ...x, adres: adres.cari(x.cariId) })), ekran: "/panel/cari/vade-hatirlatma" };
    },
  }),
  arac({
    ad: "tahsilat_riski",
    aciklama:
      "Bir carinin açık faturaları ve beklenen ödeme tarihleri; risk seviyesi ve tahmini gecikme cari kartındaki ödeme davranışı analizinden gelir. Beklenen tarihler tahmindir; öyle sun.",
    sinif: "okuma",
    girdi: z.object({ cariId: uuid("Cari kimliği") }),
    uc: UC.tahsilatRiski,
    async calistir(b, g) {
      const r = await cagir(b, UC.tahsilatRiski, [g.cariId]);
      return { ...r, acikFaturalar: (r.acikFaturalar ?? []).slice(0, 30), adres: adres.cari(g.cariId) };
    },
  }),
  arac({
    ad: "gelen_eposta_ara",
    aciklama:
      "Gelen kurumsal e-postaları (mailleri) listeler, arar veya kontrol eder. Kullanıcı 'gelen mailleri kontrol et', 'mailleri listele/özetle', 'yeni e-posta var mı', 'teklif/sipariş maillerine bak' dediğinde çağrılır. Her iletinin konusunu, gönderenini, metin özetini (ilk birkaç cümlesini), eklerini ve cari eşleşmesini döner.",
    sinif: "okuma",
    girdi: z.object({
      arama: z.string().optional().describe("Konu veya gönderen adresi içinde arama metni"),
      okunmamis: z.boolean().optional().describe("Yalnızca okunmamış e-postaları getir"),
      durum: z.enum(["yeni", "islendi", "arsivlendi"]).optional().describe("İleti işlem durumu"),
      cariId: uuid("Belirli bir cariye ait e-postaları filtrelemek için cari kimliği").optional(),
      adet: z.number().int().min(1).max(25).optional().describe("En çok kaç ileti (varsayılan 10)"),
    }),
    uc: UC.gelenEpostaListe,
    async calistir(b, g) {
      const r = await cagir<any>(b, UC.gelenEpostaListe, [
        "1",
        String(g.adet ?? 10),
        g.okunmamis !== undefined ? String(g.okunmamis) : undefined,
        g.durum,
        g.cariId,
        g.arama,
      ]);
      const iletiler = (r.satirlar ?? r.epostalar ?? []).map((e: any) => ({
        id: e.id,
        konu: e.konu,
        gonderen: e.gonderenAdi ? `${e.gonderenAdi} <${e.gonderenEposta}>` : e.gonderenEposta,
        tarih: e.tarih,
        okundu: e.okundu,
        durum: e.durum,
        ozet: (e.icerikMetin || "").replace(/\s+/g, " ").trim().slice(0, 350) || "(Metin içeriği yok veya ek içeriyor)",
        ekler: (e.ekler ?? []).map((ek: any) => ({
          id: ek.id,
          dosyaAdi: ek.dosyaAdi,
          mimeTuru: ek.mimeTuru ?? ek.mimeType,
          boyut: ek.boyut,
          ocrVarMi: Boolean(ek.cikarilanVeri),
        })),
        cari: e.cari ? sec(e.cari, ["id", "kod", "unvan"]) : null,
      }));
      return {
        toplam: r.toplam ?? iletiler.length,
        iletiler,
        ekran: adres.eposta(),
      };
    },
  }),
  arac({
    ad: "gelen_eposta_getir",
    aciklama:
      "Bir gelen e-postanın (mailin) tam içeriğini (metin gövdesi), gönderen/alıcı bilgilerini, iliştirilmiş eklerini ve eklerden çıkarılan OCR verilerini getirir. Kullanıcı belirli bir mailin içeriğini veya detayını okumak, teklif veya sipariş talebini tam metin incelemek istediğinde kullanılır.",
    sinif: "okuma",
    girdi: z.object({ epostaId: uuid("Gelen e-posta kimliği (gelen_eposta_ara sonucundaki id)") }),
    uc: UC.gelenEpostaGetir,
    async calistir(b, g) {
      const e = await cagir<any>(b, UC.gelenEpostaGetir, [g.epostaId]);
      return {
        id: e.id,
        konu: e.konu,
        gonderenAdi: e.gonderenAdi,
        gonderenEposta: e.gonderenEposta,
        aliciEposta: e.aliciEposta,
        tarih: e.tarih,
        okundu: e.okundu,
        durum: e.durum,
        icerikMetin: e.icerikMetin || "(Yalnızca HTML veya ek içeriyor)",
        cari: e.cari ? sec(e.cari, ["id", "kod", "unvan"]) : null,
        ekler: (e.ekler ?? []).map((ek: any) => ({
          id: ek.id,
          dosyaAdi: ek.dosyaAdi,
          boyut: ek.boyut,
          mimeType: ek.mimeTuru ?? ek.mimeType,
          ocrVerisi: ek.cikarilanVeri ?? null,
        })),
        ekran: adres.eposta(),
      };
    },
  }),
  arac({
    ad: "gelen_eposta_ek_ocr",
    aciklama:
      "Gelen e-postanın ekindeki fatura, fiş, sipariş veya dekont belgesini yapay zekâ OCR ile tarar. Belge numarası, tarih, toplam tutar, KDV ve satır kalemlerini çıkarır. Kullanıcı e-postadaki faturayı/belgeyi okumak istediğinde kullanılır.",
    sinif: "okuma",
    girdi: z.object({
      epostaId: uuid("Gelen e-posta kimliği"),
      ekId: uuid("Taranacak ek dosya kimliği"),
    }),
    uc: UC.gelenEpostaEkOcr,
    async calistir(b, g) {
      const ocr = await cagir<any>(b, UC.gelenEpostaEkOcr, [g.epostaId, g.ekId]);
      return {
        epostaId: g.epostaId,
        ekId: g.ekId,
        ocr,
        ekran: adres.eposta(),
      };
    },
  }),
  arac({
    ad: "gelen_eposta_senkronize_et",
    aciklama:
      "IMAP e-posta sunucusuna bağlanarak yeni gelen iletileri denetler ve TekirExtra'ya senkronize eder (çeker). Kullanıcı 'yeni mailleri çek', 'mailleri senkronize et', 'sunucudan yeni mailleri kontrol et' dediğinde kullanılır.",
    sinif: "okuma",
    girdi: z.object({}),
    uc: UC.gelenEpostaSenkronize,
    async calistir(b) {
      const r = await cagir<any>(b, UC.gelenEpostaSenkronize, []);
      return {
        senkronizeEdildi: r.senkronizeEdildi ?? 0,
        toplam: r.toplam ?? 0,
        mesaj: r.mesaj ?? (r.senkronizeEdildi > 0 ? `${r.senkronizeEdildi} yeni e-posta aktarıldı.` : "Yeni e-posta bulunamadı, posta kutusu güncel."),
        ekran: adres.eposta(),
      };
    },
  }),
];
