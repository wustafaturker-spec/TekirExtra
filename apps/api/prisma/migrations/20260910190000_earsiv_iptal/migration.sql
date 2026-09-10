-- e-Arşiv faturası GİB raporuna girmediği sürece iptal edilebilir (EBLG-22).
-- İptal edilmiş belge "iletildi" görünmesin diye durum kümesine iptal eklenir.
ALTER TYPE "BelgeDurum" ADD VALUE IF NOT EXISTS 'iptal';
