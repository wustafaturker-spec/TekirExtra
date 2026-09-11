import { describe, expect, it } from "vitest";
import { gunEkle, nakitTahmini, senaryoTarihi, type NakitKalemi } from "./nakit-akisi.hesap";

const BUGUN = "2026-09-11";

function kalem(parca: Partial<NakitKalemi> & Pick<NakitKalemi, "yon" | "vade" | "kurus">): NakitKalemi {
  return {
    kaynak: "fatura",
    kaynakId: `k-${parca.vade}-${parca.kurus}`,
    dovizCinsi: "TRY",
    dovizTutar: parca.kurus / 100,
    aciklama: "deneme",
    cariId: null,
    cariUnvan: null,
    tahmin: false,
    tahsilat: false,
    baglanti: null,
    ...parca,
  };
}

describe("senaryoTarihi (NAK-09)", () => {
  const tahsilat = { vade: "2026-09-20", tahsilat: true };

  it("iyimser senaryoda tahsilatı vadesinde sayar", () => {
    expect(senaryoTarihi(tahsilat, "iyimser", { gecikmeGun: 12, karaListe: false }, BUGUN)).toEqual({ tarih: "2026-09-20", neden: null });
  });

  it("baz senaryoda carinin ortalama gecikmesi kadar, kötümserde iki katı kadar kaydırır", () => {
    const profil = { gecikmeGun: 10, karaListe: false };
    expect(senaryoTarihi(tahsilat, "baz", profil, BUGUN).tarih).toBe("2026-09-30");
    expect(senaryoTarihi(tahsilat, "kotumser", profil, BUGUN).tarih).toBe("2026-10-10");
  });

  it("gecikme geçmişi yoksa vadesinde sayar ve bunu söyler", () => {
    expect(senaryoTarihi(tahsilat, "baz", { gecikmeGun: null, karaListe: false }, BUGUN)).toEqual({
      tarih: "2026-09-20",
      neden: "Tahsilat geçmişi yetersiz; vadesinde sayıldı",
    });
  });

  it("kötümser senaryoda kara listedeki cariyi ve vadesi 90 günü aşmış alacağı ufuk dışı sayar", () => {
    expect(senaryoTarihi(tahsilat, "kotumser", { gecikmeGun: 0, karaListe: true }, BUGUN).tarih).toBeNull();
    expect(senaryoTarihi({ vade: "2026-06-01", tahsilat: true }, "kotumser", { gecikmeGun: 0, karaListe: false }, BUGUN).tarih).toBeNull();
    // Aynı alacak baz senaryoda bugüne düşer.
    expect(senaryoTarihi({ vade: "2026-06-01", tahsilat: true }, "baz", { gecikmeGun: 0, karaListe: false }, BUGUN).tarih).toBe(BUGUN);
  });

  it("borcu ve vadesi geçmiş kalemi her senaryoda en erken bugüne alır", () => {
    expect(senaryoTarihi({ vade: "2026-09-01", tahsilat: false }, "kotumser", { gecikmeGun: 30, karaListe: true }, BUGUN)).toEqual({
      tarih: BUGUN,
      neden: "Vadesi geçmiş; bugüne alındı",
    });
  });
});

describe("nakitTahmini (NAK-02, NAK-12)", () => {
  it("bakiyeyi günlük yürütür ve ilk eksiye düştüğü günü bulur", () => {
    const sonuc = nakitTahmini({
      bugun: BUGUN,
      ufukGun: 7,
      baslangicKurus: 100_000,
      kalemler: [
        kalem({ yon: "giris", vade: gunEkle(BUGUN, 1), kurus: 50_000 }),
        kalem({ yon: "cikis", vade: gunEkle(BUGUN, 4), kurus: 200_000 }),
      ],
      profiller: new Map(),
    });
    const baz = sonuc.senaryolar.baz;

    expect(sonuc.donemTipi).toBe("gun");
    expect(baz.donemler).toHaveLength(7);
    expect(baz.toplamGiris).toBe(500);
    expect(baz.toplamCikis).toBe(2000);
    expect(baz.sonBakiye).toBe(-500);
    expect(baz.ilkEksi).toEqual({ tarih: gunEkle(BUGUN, 4), bakiye: -500 });
    expect(baz.enDusuk).toEqual({ tarih: gunEkle(BUGUN, 4), bakiye: -500 });
  });

  it("90 günlük ufku 13 haftaya böler ve ufuk dışındaki kalemi saymaz", () => {
    const sonuc = nakitTahmini({
      bugun: BUGUN,
      ufukGun: 90,
      baslangicKurus: 0,
      kalemler: [
        kalem({ yon: "giris", vade: gunEkle(BUGUN, 89), kurus: 1_000 }),
        kalem({ yon: "giris", vade: gunEkle(BUGUN, 90), kurus: 9_999_900 }),
      ],
      profiller: new Map(),
    });

    expect(sonuc.donemTipi).toBe("hafta");
    expect(sonuc.senaryolar.baz.donemler).toHaveLength(13);
    expect(sonuc.senaryolar.baz.donemler[12]).toMatchObject({ baslangic: gunEkle(BUGUN, 84), bitis: gunEkle(BUGUN, 89), giris: 10 });
    expect(sonuc.senaryolar.baz.sonBakiye).toBe(10);
  });

  it("kötümser senaryonun ufuk dışına ittiği tahsilatı ayrıca bildirir", () => {
    const sonuc = nakitTahmini({
      bugun: BUGUN,
      ufukGun: 30,
      baslangicKurus: 0,
      kalemler: [kalem({ yon: "giris", vade: gunEkle(BUGUN, 5), kurus: 300_000, tahsilat: true, cariId: "c1" })],
      profiller: new Map([["c1", { gecikmeGun: 20, karaListe: false }]]),
    });

    // Baz: 5 + 20 = 25. gün, ufuk içinde. Kötümser: 5 + 40 = 45. gün, ufuk dışında.
    expect(sonuc.senaryolar.baz.toplamGiris).toBe(3000);
    expect(sonuc.senaryolar.kotumser.toplamGiris).toBe(0);
    expect(sonuc.senaryolar.kotumser.kaydirilanTahsilat).toEqual({ adet: 1, tutar: 3000 });
    expect(sonuc.senaryolar.iyimser.kaydirilanTahsilat).toEqual({ adet: 0, tutar: 0 });
  });

  it("kuruşları kaydırmadan toplar", () => {
    const sonuc = nakitTahmini({
      bugun: BUGUN,
      ufukGun: 7,
      baslangicKurus: 0,
      kalemler: Array.from({ length: 300 }, () => kalem({ yon: "giris", vade: BUGUN, kurus: 10 })),
      profiller: new Map(),
    });
    expect(sonuc.senaryolar.baz.toplamGiris).toBe(30);
  });

  it("başlangıç bakiyesi eksiyse ilk eksi gün bugündür", () => {
    const sonuc = nakitTahmini({ bugun: BUGUN, ufukGun: 7, baslangicKurus: -100, kalemler: [], profiller: new Map() });
    expect(sonuc.senaryolar.baz.ilkEksi).toEqual({ tarih: BUGUN, bakiye: -1 });
  });
});
