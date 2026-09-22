import { SetMetadata } from "@nestjs/common";
import type { EbelgeUygulamaKodu } from "@tekirextra/shared";

export const EBELGE_UYGULAMASI_ANAHTAR = "ebelgeUygulamasi";

/**
 * EBLG-77: ucu, firmanın o e-belge uygulamasına kayıtlı olmasına bağlar.
 * Birden çok kod verilirse **biri** açıksa yeterlidir (ör. gönderim ucu
 * e-Fatura ya da e-Arşiv ile çalışır). Dekoratör yoksa uç kısıtsızdır.
 */
export const EbelgeUygulamasi = (...kodlar: EbelgeUygulamaKodu[]) =>
  SetMetadata(EBELGE_UYGULAMASI_ANAHTAR, kodlar);
