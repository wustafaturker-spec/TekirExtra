import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * AI-13: her tarama `belge_ocr_kayitlari`na yazılır (kim, ne zaman, hangi sağlayıcı/model, çıkarılan
 * veri); taramadan masraf ya da cari oluşunca kayda bağlanır. Görselin kendisi burada saklanmaz
 * (masrafa/sohbete ek olarak gider); ham metin girişi saklanır.
 */
export type OcrBelgeTuru = "FIS_FATURA" | "KARTVIZIT" | "CEK";
export type OcrKanal = "WEB" | "TELEGRAM";

export interface OcrKaydiGirdisi {
  tenantId: string;
  kullaniciId: string | null;
  belgeTuru: OcrBelgeTuru;
  kanal: OcrKanal;
  saglayici: string | null;
  model: string | null;
  hamMetin?: string | null;
  cikarilanVeri: unknown;
}

const HAM_METIN_SINIRI = 20_000;

export async function ocrKaydiYaz(tx: Prisma.TransactionClient, g: OcrKaydiGirdisi): Promise<string> {
  const kayit = await tx.belgeOcrKaydi.create({
    data: {
      tenantId: g.tenantId, kullaniciId: g.kullaniciId, belgeTuru: g.belgeTuru, kanal: g.kanal,
      saglayici: g.saglayici, model: g.model, hamMetin: g.hamMetin ? g.hamMetin.slice(0, HAM_METIN_SINIRI) : null,
      cikarilanVeri: (g.cikarilanVeri ?? {}) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return kayit.id;
}

export const ocrSonucSemasi = z.object({
  masrafIdler: z.array(z.string().uuid()).max(10).optional(),
  cariId: z.string().uuid().optional(),
}).refine((g) => g.masrafIdler?.length || g.cariId, "Bağlanacak masraf ya da cari yok");
export type OcrSonucu = z.infer<typeof ocrSonucSemasi>;

/**
 * Taramadan oluşan kayıtları bağlar. Kayıtlar aynı firmada olmalı (RLS altında bulunur); önceki bağ
 * korunur, yenisi eklenir (aynı fişten ikinci taslak gibi).
 */
export async function ocrSonucuBagla(tx: Prisma.TransactionClient, id: string, sonuc: OcrSonucu): Promise<void> {
  const kayit = await tx.belgeOcrKaydi.findUnique({ where: { id }, select: { olusanKayitlar: true, belgeTuru: true } });
  if (!kayit) throw new NotFoundException("Tarama kaydı bulunamadı");
  if (sonuc.masrafIdler?.length) {
    const sayi = await tx.masraf.count({ where: { id: { in: sonuc.masrafIdler } } });
    if (sayi !== new Set(sonuc.masrafIdler).size) throw new BadRequestException("Bağlanacak masraf bulunamadı");
  }
  if (sonuc.cariId && !(await tx.cariHesap.findUnique({ where: { id: sonuc.cariId }, select: { id: true } }))) throw new BadRequestException("Bağlanacak cari bulunamadı");
  const onceki = (kayit.olusanKayitlar ?? {}) as { masrafIdler?: string[]; cariId?: string };
  const birlesik = {
    ...(onceki.masrafIdler?.length || sonuc.masrafIdler?.length ? { masrafIdler: [...new Set([...(onceki.masrafIdler ?? []), ...(sonuc.masrafIdler ?? [])])] } : {}),
    ...(sonuc.cariId ?? onceki.cariId ? { cariId: sonuc.cariId ?? onceki.cariId } : {}),
  };
  await tx.belgeOcrKaydi.update({ where: { id }, data: { olusanKayitlar: birlesik, durum: "ISLENDI", islendiAt: new Date() } });
}
