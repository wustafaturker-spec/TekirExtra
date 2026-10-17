export type SozDurumu = "aktif" | "kismen_gerceklesti" | "gerceklesti" | "gecikti" | "iptal" | "revize" | "kaynak_gecersiz";
export interface OdemeSozu {
  id: string; cariId: string; faturaId: string; faturaNo: string | null; dovizCinsi: string; tutar: string;
  sozTarihi: string; verildigiZaman: string; aciklama: string; kayitDurumu: "aktif" | "iptal" | "revize";
  sonlandirmaNedeni: string | null; surum: number; oncekiSozId: string | null;
  gerceklesme: { sozId: string; durum: SozDurumu; gerceklesen: string; kalan: string };
}
export interface OdemeSozuListesi {
  cari: { id: string; unvan: string }; kullanimModu: "salt_okunur" | "pilot" | "acik";
  alindigiZaman: string; zamanHassasiyeti: "gun"; uyari: string; sozler: OdemeSozu[];
}
export interface SozFaturasi { id: string; no: string | null; dovizCinsi: string; kalan: string; }
const nesne = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Ödeme sözü yanıtı doğrulanamadı.");
  return v as Record<string, any>;
};
function dogrula(v: unknown): asserts v { if (!v) throw new Error("Ödeme sözü yanıtının kapsamı veya tutarları doğrulanamadı. Yenileyin."); }
const uuid = (v: unknown) => typeof v === "string" && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const para = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d{0,12})\.\d{2}$/.test(v);
const kurus = (v: string) => BigInt(v.replace(".", ""));
export const turkiyeGunu = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
export function sozGunuGecerli(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
export function sozTutari(girdi: string, kalan?: string): string {
  const ham = girdi.trim();
  if (!/^\d{1,13}(?:[,.]\d{1,2})?$/.test(ham)) throw new Error("Tutarı binlik ayırıcı kullanmadan, en fazla iki ondalıkla yazın.");
  const [tam, kesir = ""] = ham.replace(",", ".").split(".");
  const sonuc = `${tam.replace(/^0+(?=\d)/, "")}.${kesir.padEnd(2, "0")}`;
  if (!para(sonuc) || kurus(sonuc) <= 0n) throw new Error("Söz tutarı pozitif olmalı.");
  if (kalan !== undefined && (!para(kalan) || kurus(sonuc) > kurus(kalan))) throw new Error("Söz tutarı faturanın görüntülenen kalanını aşamaz. Güncel kalan kayıtta yeniden kontrol edilir.");
  return sonuc;
}
export function sozParaBicimi(v: string, doviz: string) {
  if (!para(v)) throw new Error("Geçersiz tutar");
  const [tam, kesir] = v.split(".");
  return `${tam.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${kesir} ${doviz}`;
}
export function odemeSozuListesiniDogrula(v: unknown, cariId: string): OdemeSozuListesi {
  const r = nesne(v), c = nesne(r.cari);
  dogrula(c.id === cariId && typeof c.unvan === "string" && ["salt_okunur", "pilot", "acik"].includes(r.kullanimModu));
  dogrula(typeof r.alindigiZaman === "string" && Number.isFinite(Date.parse(r.alindigiZaman)) && r.zamanHassasiyeti === "gun" && typeof r.uyari === "string");
  dogrula(Array.isArray(r.sozler) && r.sozler.length <= 1000);
  const gorulen = new Set<string>(), aktifHedefler = new Set<string>();
  for (const ham of r.sozler) {
    const s = nesne(ham), g = nesne(s.gerceklesme);
    dogrula(uuid(s.id) && !gorulen.has(s.id) && s.cariId === cariId && uuid(s.faturaId) && /^[A-Z]{3}$/.test(s.dovizCinsi));
    dogrula((s.faturaNo === null || typeof s.faturaNo === "string") && para(s.tutar) && kurus(s.tutar) > 0n && sozGunuGecerli(s.sozTarihi));
    dogrula(Number.isInteger(s.surum) && s.surum > 0 && typeof s.aciklama === "string" && ["aktif", "iptal", "revize"].includes(s.kayitDurumu));
    dogrula(typeof s.verildigiZaman === "string" && Number.isFinite(Date.parse(s.verildigiZaman)) && (s.oncekiSozId === null || uuid(s.oncekiSozId)));
    dogrula(s.sonlandirmaNedeni === null || typeof s.sonlandirmaNedeni === "string");
    dogrula(g.sozId === s.id && para(g.gerceklesen) && para(g.kalan) && kurus(g.gerceklesen) + kurus(g.kalan) === kurus(s.tutar));
    dogrula(["aktif", "kismen_gerceklesti", "gerceklesti", "gecikti", "iptal", "revize", "kaynak_gecersiz"].includes(g.durum));
    if (s.kayitDurumu !== "aktif") dogrula(g.durum === s.kayitDurumu && g.gerceklesen === "0.00" && g.kalan === s.tutar);
    else {
      dogrula(!aktifHedefler.has(s.faturaId) && !["iptal", "revize"].includes(g.durum)); aktifHedefler.add(s.faturaId);
      if (g.durum === "gerceklesti") dogrula(g.kalan === "0.00");
      if (g.durum === "aktif" || g.durum === "kaynak_gecersiz") dogrula(g.gerceklesen === "0.00");
      if (g.durum === "kismen_gerceklesti") dogrula(kurus(g.gerceklesen) > 0n && kurus(g.kalan) > 0n);
      if (g.durum === "gecikti") dogrula(kurus(g.kalan) > 0n);
    }
    gorulen.add(s.id);
  }
  return r as unknown as OdemeSozuListesi;
}
export function sozFaturalariniDogrula(v: unknown, cariId: string): { faturalar: SozFaturasi[]; sonrakiImlec: string | null } {
  const r = nesne(v);
  dogrula(Array.isArray(r.kayitlar) && r.kayitlar.length <= 50 && (r.sonrakiImlec === null || uuid(r.sonrakiImlec)));
  const faturalar: SozFaturasi[] = [];
  for (const ham of r.kayitlar) {
    const f = nesne(ham), c = nesne(f.cari), o = nesne(f.odemeOzeti);
    dogrula(uuid(f.id) && c.id === cariId && f.tip === "satis" && f.durum === "kesin" && typeof f.dovizCinsi === "string" && /^[A-Z]{3}$/.test(f.dovizCinsi));
    dogrula(para(o.kalan) && (f.no === null || typeof f.no === "string"));
    if (kurus(o.kalan) > 0n) faturalar.push({ id: f.id, no: f.no, dovizCinsi: f.dovizCinsi, kalan: o.kalan });
  }
  return { faturalar, sonrakiImlec: r.sonrakiImlec };
}
