import { odemeSozuListesiniDogrula } from "./odeme-sozu";

const kurus = (tutar: string) => BigInt(tutar.replace(".", ""));
const para = (tutar: bigint) => `${tutar / 100n}.${(tutar % 100n).toString().padStart(2, "0")}`;

/** Yalnız aynı cari/snapshot'taki geçerli aktif sözler tutar üretir.
 * İptal/revizyon geçmişi kaybolmaz; dövizler birbirine çevrilmez. */
export function odemeSozuOzetiniHesapla(yanit: unknown, cariId: string) {
  const veri = odemeSozuListesiniDogrula(yanit, cariId);
  const bugun = new Date(veri.alindigiZaman).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
  const sayilar = { toplam: veri.sozler.length, aktif: 0, iptal: 0, revize: 0, kaynakGecersiz: 0, tamamenGerceklesen: 0, kismenGerceklesen: 0, geciken: 0 };
  const dovizler = new Map<string, { aktifSoz: number; sozTutari: bigint; gerceklesen: bigint; kalan: bigint; gecikenKalan: bigint }>();
  for (const soz of veri.sozler) {
    sayilar[soz.kayitDurumu]++;
    if (soz.kayitDurumu !== "aktif") continue;
    if (soz.gerceklesme.durum === "kaynak_gecersiz") { sayilar.kaynakGecersiz++; continue; }
    const gerceklesen = kurus(soz.gerceklesme.gerceklesen), kalan = kurus(soz.gerceklesme.kalan);
    const gecikti = soz.sozTarihi < bugun && kalan > 0n;
    if (kalan === 0n) sayilar.tamamenGerceklesen++;
    else if (gerceklesen > 0n) sayilar.kismenGerceklesen++;
    if (gecikti) sayilar.geciken++;
    const grup = dovizler.get(soz.dovizCinsi) ?? { aktifSoz: 0, sozTutari: 0n, gerceklesen: 0n, kalan: 0n, gecikenKalan: 0n };
    grup.aktifSoz++; grup.sozTutari += kurus(soz.tutar); grup.gerceklesen += gerceklesen; grup.kalan += kalan;
    if (gecikti) grup.gecikenKalan += kalan;
    dovizler.set(soz.dovizCinsi, grup);
  }
  return { cariId, alindigiZaman: veri.alindigiZaman, bugun, ...sayilar,
    dovizler: [...dovizler].sort(([a], [b]) => a.localeCompare(b)).map(([dovizCinsi, grup]) => ({
      dovizCinsi, aktifSoz: grup.aktifSoz, sozTutari: para(grup.sozTutari), gerceklesen: para(grup.gerceklesen), kalan: para(grup.kalan), gecikenKalan: para(grup.gecikenKalan),
      gerceklesmeOrani: yuzde(grup.gerceklesen, grup.sozTutari),
    })),
  };
}

/** Tutar oranını kuruş tam sayı hesabıyla, yüzde için 2 ondalıkta yarım yukarı yuvarlar. */
function yuzde(gerceklesen: bigint, sozTutari: bigint) {
  const yuzdeYuzde = (gerceklesen * 10_000n + sozTutari / 2n) / sozTutari;
  return `${yuzdeYuzde / 100n}.${(yuzdeYuzde % 100n).toString().padStart(2, "0")}`;
}

/** 1.000 kaydın toplamı tek söz tutar sınırından büyük olabilir. */
export function sozOzetTutariBicimi(tutar: string, doviz: string) {
  if (!/^(0|[1-9]\d{0,15})\.\d{2}$/.test(tutar) || !/^[A-Z]{3}$/.test(doviz)) throw new Error("Geçersiz söz toplamı");
  const [tam, kesir] = tutar.split(".");
  return `${tam.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${kesir} ${doviz}`;
}
