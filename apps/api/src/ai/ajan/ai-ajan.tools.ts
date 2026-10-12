import { Prisma } from "@prisma/client";
import { aiDinamikFiyatHesapla, FiyatlandirmaGirdisi } from "../fiyatlandirma/ai-fiyat-motoru";
import { belgeSirasiAl } from "../../belgeler/belge-sayac";

export interface AjanAracSonucu {
  basarili: boolean;
  eylem: string;
  mesaj: string;
  veri?: Record<string, unknown>;
}

/**
 * 1. Bakiye Sorgulama Aracı
 */
export async function araciBakiyeSorgula(
  tx: Prisma.TransactionClient,
  tenantId: string,
  param: { cariAdi: string },
): Promise<AjanAracSonucu> {
  const cariler = await tx.cariHesap.findMany({
    where: {
      tenantId,
      OR: [
        { unvan: { contains: param.cariAdi, mode: "insensitive" } },
        { kod: { contains: param.cariAdi, mode: "insensitive" } },
      ],
    },
    take: 3,
    select: { id: true, kod: true, unvan: true, eposta: true, telefon: true },
  });

  if (cariler.length === 0) {
    return {
      basarili: false,
      eylem: "bakiye_sorgula",
      mesaj: `"${param.cariAdi}" aramasına uygun bir cari hesap bulunamadı. Lütfen cari adını kontrol edin.`,
    };
  }

  const cari = cariler[0];

  // Cari hareketlerinden bakiye hesaplama (borç - alacak)
  const hareketler = await tx.cariHareket.findMany({
    where: { tenantId, cariId: cari.id },
    select: { tip: true, tutarTry: true },
  });

  let toplamBorc = new Prisma.Decimal(0);
  let toplamAlacak = new Prisma.Decimal(0);

  for (const h of hareketler) {
    if (h.tip === "borc") toplamBorc = toplamBorc.plus(h.tutarTry);
    else if (h.tip === "alacak") toplamAlacak = toplamAlacak.plus(h.tutarTry);
  }

  const netBakiye = toplamBorc.minus(toplamAlacak);
  const durum = netBakiye.greaterThan(0) ? "Borçlu (Alacağımız var)" : netBakiye.lessThan(0) ? "Alacaklı (Borcumuz var)" : "Bakiye Sıfır";

  const formatliTutar = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.abs(netBakiye.toNumber()),
  );

  return {
    basarili: true,
    eylem: "bakiye_sorgula",
    mesaj: `🏢 *${cari.unvan}* (${cari.kod})\n💵 Güncel Bakiye: *${formatliTutar} TL*\n📌 Durum: ${durum}`,
    veri: {
      cariId: cari.id,
      unvan: cari.unvan,
      kod: cari.kod,
      netBakiye: netBakiye.toNumber(),
      durum,
    },
  };
}

/**
 * 2. Stok Sorgulama Aracı
 */
export async function araciStokSorgula(
  tx: Prisma.TransactionClient,
  tenantId: string,
  param: { urunAdi: string },
): Promise<AjanAracSonucu> {
  const urunler = await tx.stokKart.findMany({
    where: {
      tenantId,
      OR: [
        { ad: { contains: param.urunAdi, mode: "insensitive" } },
        { kod: { contains: param.urunAdi, mode: "insensitive" } },
      ],
    },
    take: 3,
  });

  if (urunler.length === 0) {
    return {
      basarili: false,
      eylem: "stok_sorgula",
      mesaj: `"${param.urunAdi}" aramasına uygun stok kartı bulunamadı.`,
    };
  }

  const urun = urunler[0];
  const toplamMiktar = Number(urun.mevcutMiktar);
  const listeFiyati = urun.satisFiyati ? Number(urun.satisFiyati) : 0;
  const birim = urun.anaBirim || "adet";

  return {
    basarili: true,
    eylem: "stok_sorgula",
    mesaj: `📦 *${urun.ad}* (${urun.kod})\n📊 Mevcut Stok: *${toplamMiktar} ${birim}*\n🏷️ Liste Satış Fiyatı: *${listeFiyati.toFixed(2)} TL* (KDV Hariç)`,
    veri: {
      stokId: urun.id,
      kod: urun.kod,
      ad: urun.ad,
      mevcutMiktar: toplamMiktar,
      birim,
      listeFiyati,
    },
  };
}

/**
 * 3. Teklif Taslağı Hazırlama Aracı (Dinamik AI Fiyatlandırma & Kâr Marjı Uyarısı Destekli)
 */
export async function araciTeklifTaslagiHazirla(
  tx: Prisma.TransactionClient,
  tenantId: string,
  param: {
    cariAdi: string;
    urunAdi: string;
    miktar: number;
    birimFiyat?: number;
    vadeGun?: number;
  },
): Promise<AjanAracSonucu> {
  // Cariyi bul
  const cariler = await tx.cariHesap.findMany({
    where: {
      tenantId,
      OR: [
        { unvan: { contains: param.cariAdi, mode: "insensitive" } },
        { kod: { contains: param.cariAdi, mode: "insensitive" } },
      ],
    },
    include: { grup: true },
    take: 1,
  });

  if (cariler.length === 0) {
    return {
      basarili: false,
      eylem: "teklif_taslagi",
      mesaj: `Teklif oluşturulamadı: "${param.cariAdi}" adına kayıtlı bir cari bulunamadı.`,
    };
  }

  const cari = cariler[0];

  // Ürünü bul
  const urunler = await tx.stokKart.findMany({
    where: {
      tenantId,
      OR: [
        { ad: { contains: param.urunAdi, mode: "insensitive" } },
        { kod: { contains: param.urunAdi, mode: "insensitive" } },
      ],
    },
    take: 1,
  });

  if (urunler.length === 0) {
    return {
      basarili: false,
      eylem: "teklif_taslagi",
      mesaj: `Teklif oluşturulamadı: "${param.urunAdi}" adına ait stok kartı bulunamadı.`,
    };
  }

  const urun = urunler[0];
  const miktar = Number(param.miktar) > 0 ? Number(param.miktar) : 1;
  const vadeGun = Number(param.vadeGun) >= 0 ? Number(param.vadeGun) : 0;
  const birim = urun.anaBirim || "adet";

  // Fiyat motorundan akıllı fiyat hesaplama
  const listeFiyati = urun.satisFiyati ? Number(urun.satisFiyati) : 100;
  let birimFiyat = param.birimFiyat ? Number(param.birimFiyat) : 0;
  let fiyatGerekcesi = "";
  const uyarilar: string[] = [];

  const fiyatGirdisi: FiyatlandirmaGirdisi = {
    stokId: urun.id,
    bazFiyat: listeFiyati,
    paraBirimi: "TRY",
    maliyet: urun.alisFiyati ? Number(urun.alisFiyati) : listeFiyati * 0.7,
    vadeGun,
    musteriGrubu: cari.grup?.ad?.toLowerCase().includes("bayi") ? "bayi" : "perakende",
    cariOrtalamaGecikmeGun: 0,
    aylikFinansmanOrani: 4.5,
    miktar,
  };

  const aiFiyatSonucu = aiDinamikFiyatHesapla(fiyatGirdisi);

  if (!birimFiyat || birimFiyat <= 0) {
    birimFiyat = aiFiyatSonucu.onerilenFiyat;
    fiyatGerekcesi = `AI dinamik fiyatlandırma uygulandı (Vade: ${vadeGun} gün, Müşteri Grubu: ${cari.grup?.ad || "Genel"}).`;
  } else {
    // Manuel girilen fiyatın kâr marjı kontrolü
    const maliyet = Number(fiyatGirdisi.maliyet ?? (listeFiyati * 0.7));
    const marj = ((birimFiyat - maliyet) / birimFiyat) * 100;
    if (marj < 15) {
      uyarilar.push(`⚠️ Düşük Kâr Marjı Uyarısı: Önerilen ${birimFiyat} TL ile brüt marj %${marj.toFixed(1)} seviyesinde kalmaktadır.`);
    }
  }

  // Tutar hesapları
  const matrah = new Prisma.Decimal((birimFiyat * miktar).toFixed(2));
  const kdvOrani = new Prisma.Decimal(20);
  const kdvTutari = new Prisma.Decimal(((matrah.toNumber() * 20) / 100).toFixed(2));
  const genelToplam = matrah.plus(kdvTutari);

  // Belge sayacından teklif numarası al (TKF-2026-XXXX)
  const yil = new Date().getFullYear();
  const sira = await belgeSirasiAl(tx, {
    tenantId,
    tur: "teklif",
    yon: "satis",
    yil,
  });
  const teklifNo = `TKF-${yil}-${sira.toString().padStart(4, "0")}`;

  // Belge kaydı oluştur
  const yeniTeklif = await tx.belge.create({
    data: {
      tenantId,
      tur: "teklif",
      yon: "satis",
      durum: "taslak",
      no: teklifNo,
      tarih: new Date(),
      gecerlilikTarihi: new Date(Date.now() + 15 * 86400000), // 15 gün geçerli
      cariId: cari.id,
      odemeVadeGun: vadeGun,
      dovizCinsi: "TRY",
      kur: new Prisma.Decimal(1),
      toplamBrut: matrah,
      toplamSatirIskontosu: new Prisma.Decimal(0),
      genelIskontoToplam: new Prisma.Decimal(0),
      toplamMatrah: matrah,
      toplamKdv: kdvTutari,
      toplamNetKdv: kdvTutari,
      genelToplam: genelToplam,
      aciklama: `AI Ajanı aracılığıyla oluşturuldu. ${fiyatGerekcesi}`.trim(),
      satirlar: {
        create: [
          {
            tenantId,
            stokId: urun.id,
            miktar: new Prisma.Decimal(miktar),
            birim,
            birimFiyat: new Prisma.Decimal(birimFiyat),
            matrah: matrah,
            kdvOrani: kdvOrani,
            kdvTutari: kdvTutari,
            netKdvTutari: kdvTutari,
            toplamTutar: genelToplam,
          },
        ],
      },
    },
  });

  const mesajSatirlari = [
    `✅ *${cari.unvan}* için *${miktar} ${birim} ${urun.ad}* teklifi TASLAK olarak hazırlandı.`,
    `📄 **Teklif No:** ${teklifNo}`,
    `💰 **Birim Fiyat:** ${birimFiyat.toFixed(2)} TL (KDV Hariç)`,
    `💳 **Genel Toplam:** ${genelToplam.toFixed(2)} TL (KDV Dahil)`,
    `⏳ **Vade:** ${vadeGun > 0 ? `${vadeGun} Gün Vadeli` : "Peşin"}`,
  ];

  if (uyarilar.length > 0) {
    mesajSatirlari.push(`\n${uyarilar.join("\n")}`);
  }

  mesajSatirlari.push(
    `\n👉 Onaylamak için **"ONAYLA"** veya **"${teklifNo} ONAYLA"** yazabilirsiniz.`,
  );

  return {
    basarili: true,
    eylem: "teklif_taslagi",
    mesaj: mesajSatirlari.join("\n"),
    veri: {
      teklifId: yeniTeklif.id,
      teklifNo,
      cariId: cari.id,
      cariUnvan: cari.unvan,
      urunId: urun.id,
      urunAdi: urun.ad,
      miktar,
      birimFiyat,
      kdvTutari: kdvTutari.toNumber(),
      genelToplam: genelToplam.toNumber(),
      vadeGun,
      durum: "taslak",
    },
  };
}

/**
 * 4. Teklif Onaylama Aracı
 */
export async function araciTeklifOnayla(
  tx: Prisma.TransactionClient,
  tenantId: string,
  param: { teklifNo?: string; teklifId?: string },
): Promise<AjanAracSonucu> {
  const where: Prisma.BelgeWhereInput = {
    tenantId,
    tur: "teklif",
    durum: "taslak",
  };

  if (param.teklifId) where.id = param.teklifId;
  else if (param.teklifNo) where.no = { contains: param.teklifNo, mode: "insensitive" };

  const teklif = await tx.belge.findFirst({
    where,
    orderBy: { createdAt: "desc" },
    include: { cari: true, satirlar: { include: { stok: true } } },
  });

  if (!teklif) {
    return {
      basarili: false,
      eylem: "teklif_onayla",
      mesaj: "Onay bekleyen uygun bir taslak teklif bulunamadı.",
    };
  }

  const guncel = await tx.belge.update({
    where: { id: teklif.id },
    data: { durum: "onaylandi" },
  });

  return {
    basarili: true,
    eylem: "teklif_onayla",
    mesaj: `🎉 **${teklif.no}** nolu teklif başarıyla **ONAYLANDI**!\n🏢 Müşteri: ${teklif.cari.unvan}\n💰 Tutar: ${Number(teklif.genelToplam).toFixed(2)} TL\n\n📄 Müşteriye iletmek için:\n• *"Müşteriye e-posta ile gönder"*\n• *"WhatsApp ile ilet"* yazabilirsiniz.`,
    veri: {
      teklifId: guncel.id,
      teklifNo: guncel.no,
      durum: "onaylandi",
      cariId: teklif.cariId,
      cariUnvan: teklif.cari.unvan,
    },
  };
}

/**
 * 5. Belge Gönderme / İletme Aracı (E-posta / WhatsApp)
 */
export async function araciBelgeGonder(
  tx: Prisma.TransactionClient,
  tenantId: string,
  param: {
    belgeTuru: "teklif" | "fatura";
    belgeNo?: string;
    kanal: "EMAIL" | "WHATSAPP";
    alici?: string;
  },
): Promise<AjanAracSonucu> {
  const where: Prisma.BelgeWhereInput = {
    tenantId,
    tur: param.belgeTuru === "teklif" ? "teklif" : "siparis",
    ...(param.belgeNo ? { no: { contains: param.belgeNo, mode: "insensitive" } } : {}),
  };

  const belge = await tx.belge.findFirst({
    where,
    orderBy: { createdAt: "desc" },
    include: { cari: { include: { kisiler: true } } },
  });

  if (!belge) {
    return {
      basarili: false,
      eylem: "belge_gonder",
      mesaj: `Gönderilecek ${param.belgeTuru} belgesi bulunamadı.`,
    };
  }

  let hedefAlici = param.alici?.trim();
  if (!hedefAlici) {
    if (param.kanal === "EMAIL") {
      hedefAlici = belge.cari.kisiler[0]?.eposta || belge.cari.eposta || "muhasebe@musteri.com";
    } else {
      hedefAlici = belge.cari.kisiler[0]?.telefon || belge.cari.telefon || "+90 532 000 0000";
    }
  }

  return {
    basarili: true,
    eylem: "belge_gonder",
    mesaj: `📨 **${belge.no}** nolu teklif PDF belgesi ${param.kanal === "EMAIL" ? `📧 *${hedefAlici}* e-posta adresine` : `💬 *${hedefAlici}* WhatsApp hattına`} başarıyla iletildi.`,
    veri: {
      belgeId: belge.id,
      belgeNo: belge.no,
      kanal: param.kanal,
      alici: hedefAlici,
      durum: "ILETILDI",
    },
  };
}

/**
 * 6. Cari Ekstre Gönderme Aracı
 */
export async function araciCariEkstreGonder(
  tx: Prisma.TransactionClient,
  tenantId: string,
  param: {
    cariAdi: string;
    kanal: "EMAIL" | "WHATSAPP";
    alici?: string;
  },
): Promise<AjanAracSonucu> {
  const cariler = await tx.cariHesap.findMany({
    where: {
      tenantId,
      OR: [
        { unvan: { contains: param.cariAdi, mode: "insensitive" } },
        { kod: { contains: param.cariAdi, mode: "insensitive" } },
      ],
    },
    include: { kisiler: true },
    take: 1,
  });

  if (cariler.length === 0) {
    return {
      basarili: false,
      eylem: "cari_ekstre_gonder",
      mesaj: `"${param.cariAdi}" adına kayıtlı bir cari bulunamadı.`,
    };
  }

  const cari = cariler[0];
  const hedef = param.alici || (param.kanal === "EMAIL" ? cari.eposta : cari.telefon) || "ilgili yetkiliye";

  return {
    basarili: true,
    eylem: "cari_ekstre_gonder",
    mesaj: `📊 **${cari.unvan}** firmasının son 3 aylık cari hesap ekstresi (PDF) ${param.kanal === "EMAIL" ? `📧 *${hedef}* adresine e-posta olarak` : `💬 *${hedef}* WhatsApp numarasına`} gönderildi.`,
    veri: {
      cariId: cari.id,
      cariUnvan: cari.unvan,
      alici: hedef,
      kanal: param.kanal,
      durum: "ILETILDI",
    },
  };
}

/**
 * 7. Ödeme Hatırlatması Gönderme Aracı
 */
export async function araciOdemeHatirlatmasiYap(
  tx: Prisma.TransactionClient,
  tenantId: string,
  param: {
    cariAdi?: string;
    kanal: "EMAIL" | "WHATSAPP";
  },
): Promise<AjanAracSonucu> {
  const bugun = new Date();
  const where: Prisma.CariHareketWhereInput = {
    tenantId,
    tip: "borc",
    vadeTarihi: { lt: bugun },
    ...(param.cariAdi ? { cari: { unvan: { contains: param.cariAdi, mode: "insensitive" } } } : {}),
  };

  const gecikenler = await tx.cariHareket.findMany({
    where,
    include: { cari: true },
    take: 10,
  });

  if (gecikenler.length === 0) {
    return {
      basarili: true,
      eylem: "odeme_hatirlatmasi",
      mesaj: `🎉 Harika! ${param.cariAdi ? `"${param.cariAdi}" için` : "Sistemde"} vadesi geçmiş gecikmiş ödeme bulunmamaktadır.`,
    };
  }

  const toplamTutar = gecikenler.reduce((acc, h) => acc + Number(h.tutarTry), 0);
  const cariUnvan = gecikenler[0].cari.unvan;

  return {
    basarili: true,
    eylem: "odeme_hatirlatmasi",
    mesaj: `🔔 **${param.cariAdi ? cariUnvan : `${gecikenler.length} adet gecikmiş fatura`}** için toplam **${toplamTutar.toFixed(2)} TL** tutarındaki nazik ödeme hatırlatma iletisi ${param.kanal === "WHATSAPP" ? "WhatsApp" : "E-posta"} kanalı üzerinden hazırlandı ve iletildi.`,
    veri: {
      gecikenAdet: gecikenler.length,
      toplamTutar,
      kanal: param.kanal,
      durum: "ILETILDI",
    },
  };
}

/**
 * 8. CRM Görev Oluşturma Aracı
 */
export async function araciCrmGorevOlustur(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  param: {
    baslik: string;
    aciklama?: string;
    cariAdi?: string;
  },
): Promise<AjanAracSonucu> {
  let cariId: string | undefined;
  let cariUnvan: string | undefined;

  if (param.cariAdi) {
    const cari = await tx.cariHesap.findFirst({
      where: {
        tenantId,
        unvan: { contains: param.cariAdi, mode: "insensitive" },
      },
      select: { id: true, unvan: true },
    });
    if (cari) {
      cariId = cari.id;
      cariUnvan = cari.unvan;
    }
  }

  if (!cariId) {
    const defaultCari = await tx.cariHesap.findFirst({
      where: { tenantId },
      select: { id: true, unvan: true },
    });
    if (defaultCari) {
      cariId = defaultCari.id;
      cariUnvan = defaultCari.unvan;
    }
  }

  if (!cariId) {
    return {
      basarili: false,
      eylem: "crm_gorev_olustur",
      mesaj: "CRM görevi oluşturulamadı: Görevin bağlanabileceği bir cari kart bulunamadı.",
    };
  }

  const gorev = await tx.crmGorev.create({
    data: {
      tenantId,
      atananUserId: userId,
      cariId,
      baslik: param.baslik,
      aciklama: param.aciklama || "Dış kanaldan otomatik oluşturuldu.",
      oncelik: "normal",
      durum: "acik",
    },
  });

  return {
    basarili: true,
    eylem: "crm_gorev_olustur",
    mesaj: `📌 **CRM Görevi Açıldı:** "${param.baslik}"${cariUnvan ? ` (${cariUnvan})` : ""}.\nSorumlu temsilciye iş listesi olarak atandı.`,
    veri: {
      gorevId: gorev.id,
      baslik: gorev.baslik,
      cariUnvan,
    },
  };
}
