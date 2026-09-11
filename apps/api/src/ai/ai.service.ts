import { Injectable, NotImplementedException } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { ocrTaramaSemasi } from "./ai.semalar";
import { z } from "zod";

/**
 * Nakit akışı tahmini bu servisten `nakit-akisi` modülüne taşındı (NAK-14):
 * eski hesap başlangıç bakiyesini kasa/banka kaydında olmayan bir alandan
 * okuduğu için NaN üretiyordu.
 */
@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fiş / Fatura Görselinden KDV, Tutar, Tarih ve VKN Okuma (Simüle OCR Motoru)
   */
  async fisFaturaOcrTara(tenantId: string, girdi: z.infer<typeof ocrTaramaSemasi>) {
    ocrTaramaSemasi.parse(girdi);
    throw new NotImplementedException("OCR özelliği doğrulanmış bir sağlayıcı bağlanana kadar kullanıma kapalıdır");
  }
}
