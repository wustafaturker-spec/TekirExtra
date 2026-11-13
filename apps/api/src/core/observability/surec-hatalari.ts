import { baglamAl } from "../istek-baglami";
import { structuredLogger } from "./structured-logger";
import type { HataGirdisi, HataKaynagi } from "./hata-kayit";

/**
 * PLT-123/124: HTTP isteği dışındaki hatalar (zamanlayıcı ve kuyruk işleri, Telegram, ödeme sözü
 * süreci, yakalanmamış söz reddi ve istisna) da PLT-118 gruplamasına düşer. Her süreç açılışta
 * kaydediciyi kurar. Kayıt hiçbir işi durdurmaz; bir süreç dakikada en çok 60 kayıt gönderir
 * (sıcak döngüdeki hata veritabanını boğmasın).
 */
export interface SurecHataAyari {
  kaynak: HataKaynagi;
  /** API: HTTP hataları filtrede kaydedilir; günlük hatalarından yalnız arka plan işlerindekiler alınır. */
  yalnizArkaPlan: boolean;
  kaydet: (g: HataGirdisi) => Promise<void>;
}

let ayar: SurecHataAyari | null = null;

const DAKIKA_SINIRI = 60;
let pencere = { baslangic: 0, sayi: 0 };
let kayitta = false;

/** Kaydedici kurulunca dakika sayacı da sıfırlanır. */
export function surecHataKaydediciAyarla(a: SurecHataAyari | null) { ayar = a; pencere = { baslangic: 0, sayi: 0 }; }

function sinirIcinde(simdi = Date.now()): boolean {
  if (simdi - pencere.baslangic >= 60_000) pencere = { baslangic: simdi, sayi: 0 };
  return ++pencere.sayi <= DAKIKA_SINIRI;
}

const YIGIN = /\n\s+at /;

/**
 * Nest günlük satırından kayıt girdisi: `error(mesaj, yığın?, bağlam?)`. Bağlam (sınıf adı) son
 * metin bağımsız değişkendir; yığın, "at" satırı içeren ilk metin ya da Error nesnesidir.
 */
export function gunlukGirdisi(kaynak: HataKaynagi, mesaj: unknown, ek: unknown[], isAdi: string | null): HataGirdisi {
  const hataNesnesi = mesaj instanceof Error ? mesaj : ek.find((x): x is Error => x instanceof Error) ?? null;
  const metinler = ek.filter((x): x is string => typeof x === "string");
  const yigin = hataNesnesi?.stack ?? metinler.find((m) => YIGIN.test(m)) ?? null;
  const baglam = metinler.filter((m) => !YIGIN.test(m)).at(-1) ?? null;
  const metin = mesaj instanceof Error ? mesaj.message : typeof mesaj === "string" ? mesaj : (() => { try { return JSON.stringify(mesaj); } catch { return String(mesaj); } })();
  const ad = hataNesnesi?.name ?? (yigin ? /^(\w+(?:Error|Exception))\b/.exec(yigin)?.[1] : undefined) ?? baglam ?? "Hata";
  return {
    kaynak, ad, mesaj: metin, yigin,
    konum: isAdi ? `is:${isAdi}` : baglam ? `log:${baglam}` : "log",
    tenantId: baglamAl()?.tenantId ?? null,
  };
}

/** Günlüğe hata olarak yazılan satır (NabizLogger çağırır). */
export function gunlukHatasiniKaydet(mesaj: unknown, ek: unknown[], isAdi: string | null): void {
  const a = ayar;
  if (!a || kayitta || (a.yalnizArkaPlan && !isAdi)) return;
  if (!sinirIcinde()) return;
  kayitta = true;
  try {
    void a.kaydet(gunlukGirdisi(a.kaynak, mesaj, ek, isAdi)).catch(() => undefined);
  } finally {
    kayitta = false;
  }
}

/** İşin kendisinin fırlattığı hata (nabız çalışması günlüğe yazmadan yakalar). */
export function isHatasiniKaydet(hata: unknown, isAdi: string): void {
  gunlukHatasiniKaydet(hata, [], isAdi);
}

/**
 * PLT-124: yakalanmamış söz reddi kaydedilir, süreç sürer; yakalanmamış istisna kaydedilir ve süreç
 * kapanır (durumu belirsiz süreç çalışmaya devam etmez; Docker yeniden başlatır).
 */
export function yakalanmamisHatalariDinle(cikis: (kod: number) => void = (k) => process.exit(k)): void {
  process.on("unhandledRejection", (neden) => {
    structuredLogger.error("unhandled_rejection", neden);
    const a = ayar;
    if (!a || !sinirIcinde()) return;
    const hata = neden instanceof Error ? neden : new Error(String(neden));
    void a.kaydet({ ...gunlukGirdisi(a.kaynak, hata, [], null), ad: `UnhandledRejection:${hata.name}`, konum: "surec:unhandledRejection" }).catch(() => undefined);
  });
  process.on("uncaughtException", (hata) => {
    structuredLogger.error("uncaught_exception", hata);
    const a = ayar;
    const bekle = a ? a.kaydet({ ...gunlukGirdisi(a.kaynak, hata, [], null), ad: `UncaughtException:${hata.name}`, konum: "surec:uncaughtException" }).catch(() => undefined) : Promise.resolve();
    // Kayıt en çok 2 sn beklenir; süreç her durumda kapanır.
    void Promise.race([bekle, new Promise((coz) => setTimeout(coz, 2000))]).finally(() => cikis(1));
  });
}
