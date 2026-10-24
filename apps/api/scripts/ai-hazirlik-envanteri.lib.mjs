/** P0-01: yalnız seçilmiş tenant için toplulaştırılmış veri hazırlığı kontrolü. */
export const BILINCLI_RLS_ISTISNALARI = new Set(["auth_kimlikler", "oturumlar", "eposta_dogrulamalar", "parola_sifirlamalar", "mevzuat_talepleri"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function argumanlariCoz(args) {
  if (args.length === 1 && args[0] === "--help") return { mod: "yardim" };
  if (args.length === 1 && args[0] === "--metadata-only") return { mod: "metadata" };
  if (args.length === 2 && args[0] === "--tenant-id" && UUID.test(args[1])) return { mod: "tenant", tenantId: args[1].toLowerCase() };
  throw new Error("KAPSAM_GECERSIZ");
}

export function veritabaniAdresiniDogrula(adres) {
  const url = new URL(adres);
  if (!["postgresql:", "postgres:"].includes(url.protocol) || decodeURIComponent(url.pathname) !== "/tekirextra") throw new Error("VERITABANI_KAPSAMI_GECERSIZ");
  return adres;
}

/** Tanımlar programda sabittir; CLI tablo, alan, koşul veya SQL alamaz. */
export const PROFILLER = [
  { kod: "stok-kart", model: "StokKart", tarih: "createdAt", alanlar: ["anaBirim", "tedarikSuresiGun", "guvenlikStogu"], kritik: ["anaBirim"] },
  { kod: "stok-hareket", model: "StokHareket", tarih: "tarih", alanlar: ["stokId", "miktar", "girilenBirim"], kritik: ["stokId", "miktar"] },
  { kod: "stok-tedarikci", model: "StokTedarikci", tarih: null, alanlar: ["alisFiyati", "tedarikSuresiGun"], kritik: ["tedarikSuresiGun"] },
  { kod: "kesin-alis-fatura", model: "Fatura", tarih: "tarih", alanlar: ["cariId", "vadeTarihi", "kur"], kritik: ["cariId", "kur"], filtre: { tip: "alis", durum: "kesin" }, gruplar: ["dovizCinsi"] },
  { kod: "kesin-alis-satir", model: "FaturaSatir", tarih: "tarih", alanlar: ["stokId", "miktar", "birim", "varyantId"], kritik: ["stokId", "miktar", "birim"], ust: { model: "Fatura", bag: "faturaId", filtre: { tip: "alis", durum: "kesin" } } },
  { kod: "kesin-satis-fatura", model: "Fatura", tarih: "tarih", alanlar: ["cariId", "vadeTarihi"], kritik: ["cariId"], filtre: { tip: "satis", durum: "kesin" }, gruplar: ["dovizCinsi"] },
  { kod: "fatura-kapama", model: "FaturaKapama", tarih: "createdAt", alanlar: ["faturaId", "tutar"], kritik: ["faturaId", "tutar"] },
  { kod: "alis-siparis", model: "Belge", tarih: "tarih", alanlar: ["cariId", "teslimSuresi"], kritik: ["cariId"], filtre: { tur: "siparis", yon: "alis" }, gruplar: ["durum"] },
  { kod: "alis-irsaliye", model: "Belge", tarih: "tarih", alanlar: ["cariId", "kaynakBelgeId"], kritik: ["cariId"], filtre: { tur: "irsaliye", yon: "alis" }, gruplar: ["durum"] },
  { kod: "cek-senet", model: "CekSenet", tarih: "vadeTarihi", alanlar: ["cekNo", "banka", "hesapNo", "cariId"], kritik: [], gruplar: ["tur", "yon", "durum", "dovizCinsi"] },
  { kod: "butce", model: "Butce", tarih: "createdAt", alanlar: ["yil", "revizyon"], kritik: ["yil", "revizyon"], gruplar: ["durum"] },
  { kod: "satin-alma-talep", model: "SatinAlmaTalebi", tarih: "createdAt", alanlar: ["ihtiyacTarihi"], kritik: [], gruplar: ["durum"] },
  { kod: "satin-alma-teklif", model: "SatinAlmaTeklifi", tarih: "createdAt", alanlar: ["teslimSuresiGun", "gecerlilikTarihi"], kritik: ["gecerlilikTarihi"], gruplar: ["dovizCinsi"] },
  { kod: "banka-ekstre", model: "BankaEkstreSatir", tarih: "tarih", alanlar: ["cariId", "faturaId", "eslesmeTuru"], kritik: [], gruplar: ["durum"] },
  { kod: "uretim-emri", model: "UretimEmri", tarih: "tarih", alanlar: ["receteId", "planlananBitis", "tamamlanmaTarihi"], kritik: ["receteId"], gruplar: ["durum"] },
  { kod: "uretim-operasyon", model: "UretimEmriOperasyonu", tarih: "planlananBaslangic", alanlar: ["fiiliBaslangic", "fiiliBitis"], kritik: [], gruplar: ["durum"] },
  { kod: "uretim-bildirim", model: "UretimBildirimi", tarih: "bildirimTarihi", alanlar: ["uretimEmriId", "mamulBirimMaliyeti"], kritik: ["uretimEmriId"] },
  { kod: "uretim-sarf", model: "UretimBildirimiSarf", tarih: null, alanlar: ["miktar", "birimMaliyet"], kritik: ["miktar", "birimMaliyet"] },
  { kod: "crm-firsat", model: "CrmFirsat", tarih: "createdAt", alanlar: ["kapanisTarihi", "sorumluUserId"], kritik: [], gruplar: ["asama"] },
  { kod: "masraf", model: "Masraf", tarih: "tarih", alanlar: ["kategoriId", "belgeNo", "projeId"], kritik: ["kategoriId"], gruplar: ["durum"] },
  { kod: "proje", model: "Proje", tarih: "createdAt", alanlar: ["hedefGelir", "hedefGider"], kritik: [], gruplar: ["durum"] },
];

const q = (s) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error("TANIM_GECERSIZ");
  return `"${s}"`;
};

export function profilSorgusunuKur(profil, modeller) {
  const m = modeller.find((v) => v.name === profil.model);
  if (!m) throw new Error("MODEL_EKSIK");
  const f = (model, ad) => model.fields.find((v) => v.name === ad && v.kind !== "object");
  const col = (model, ad, alias) => { const alan = f(model, ad); if (!alan) throw new Error("ALAN_EKSIK"); return `${alias}.${q(alan.dbName ?? alan.name)}`; };
  const filtre = (model, kosul, alias) => Object.entries(kosul ?? {}).map(([ad, deger]) => {
    if (!/^[a-z_]+$/.test(deger)) throw new Error("FILTRE_GECERSIZ");
    return `${col(model, ad, alias)} = '${deger}'`;
  });
  let from = `public.${q(m.dbName ?? m.name)} t`;
  const kosullar = [`${col(m, "tenantId", "t")} = $1::uuid`, ...filtre(m, profil.filtre, "t")];
  let tarihModel = m, tarihAlias = "t";
  if (profil.ust) {
    const ust = modeller.find((v) => v.name === profil.ust.model);
    if (!ust) throw new Error("UST_MODEL_EKSIK");
    from += ` JOIN public.${q(ust.dbName ?? ust.name)} p ON ${col(ust, "id", "p")} = ${col(m, profil.ust.bag, "t")} AND ${col(ust, "tenantId", "p")} = ${col(m, "tenantId", "t")}`;
    kosullar.push(...filtre(ust, profil.ust.filtre, "p"));
    tarihModel = ust; tarihAlias = "p";
  }
  const tarih = profil.tarih ? col(tarihModel, profil.tarih, tarihAlias) : null;
  const alanlar = profil.alanlar.filter((a) => f(m, a));
  const eksikAlanlar = profil.alanlar.filter((a) => !f(m, a));
  const kolonlar = ["count(*)::text AS adet",
    tarih ? `min(${tarih})::date::text AS ilk_tarih, max(${tarih})::date::text AS son_tarih, count(DISTINCT date_trunc('month', ${tarih}))::text AS veri_olan_ay` : "NULL::text AS ilk_tarih, NULL::text AS son_tarih, NULL::text AS veri_olan_ay",
    ...alanlar.map((a) => `count(*) FILTER (WHERE ${col(m, a, "t")} IS NULL OR btrim(${col(m, a, "t")}::text) = '')::text AS ${q(`eksik_${a}`)}`),
  ];
  const where = kosullar.join(" AND ");
  const gruplar = (profil.gruplar ?? []).map((a) => col(m, a, "t"));
  return { sql: `SELECT ${kolonlar.join(", ")} FROM ${from} WHERE ${where}`,
    grupSql: gruplar.length ? `SELECT ${gruplar.map((c, i) => `${c}::text AS ${q(`grup_${i}`)}`).join(", ")}, count(*)::text AS adet FROM ${from} WHERE ${where} GROUP BY ${gruplar.join(", ")} ORDER BY ${gruplar.join(", ")}` : null,
    alanlar, eksikAlanlar };
}

export function profiliDegerlendir(profil, sonuc, eksikAlanlar) {
  if (eksikAlanlar.length) return "sema_eslemesi_incelenmeli";
  if (sonuc.adet === "0") return "veri_yok";
  if (profil.kritik.some((a) => BigInt(sonuc[`eksik_${a}`] ?? "0") > 0n)) return "veri_tamamlama_gerekli";
  return "kural_tabanli_pilot_adayi_uzman_kontrolu_gerekli";
}

/** READ ONLY zorlaması her sorgudan önce; yerel context kalıcı veri yazmaz. */
export async function saltOkunurIslem(db, tenantId, is) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10s'");
    if (tenantId) await tx.$queryRawUnsafe("SELECT set_config('app.tenant_id', $1, true)", tenantId);
    return is(tx);
  }, { isolationLevel: "RepeatableRead", timeout: 120000, maxWait: 5000 });
}

export function rlsEksikleriniBul(tablolar) {
  return tablolar.filter((t) => !BILINCLI_RLS_ISTISNALARI.has(t.tablo) && (!t.rls || !t.force || BigInt(t.politika) === 0n));
}

export function platformOzetiniCikar(env) {
  const bilinen = ["openai", "anthropic", "gemini", "ollama", "mock"];
  return { istenenSaglayici: !env.AI_PROVIDER ? null : bilinen.includes(env.AI_PROVIDER) ? env.AI_PROVIDER : "taninmayan_yapilandirma",
    openaiAnahtariVar: Boolean(env.OPENAI_API_KEY), anthropicAnahtariVar: Boolean(env.ANTHROPIC_API_KEY),
    geminiAnahtariVar: Boolean(env.GEMINI_API_KEY), ollamaAdresiVar: Boolean(env.OLLAMA_BASE_URL),
    canliCagri: "yapilmadi", not: "Anahtar/adres değerleri okunur rapora alınmaz; bu yerel CLI ortamı çalışan sunucunun veya tenant BYOK ayarının kanıtı değildir." };
}
