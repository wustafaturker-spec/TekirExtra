# GİB vergi dairesi başlangıç listesi

`vergi-daireleri-gib-2026-06-18.csv` is the 860 coded rows from the Revenue Administration's **Defterdarlık ve Vergi Daireleri Listesi** PDF. The PDF metadata is dated 18 June 2026. Rows without a five-digit accounting-unit code (local branches) are omitted because they do not have a separate code to select or report against.

The CSV columns, separated by semicolons, are `province_code;province_name;district_name;tax_office_code;tax_office_name`. A matching Prisma migration seeds the same snapshot. Platform administrators can import later official revisions through **Platform → Vergi daireleri**; importing an existing code updates its name/location and reactivates it.

Source: https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2FDefterdarl%C4%B1kveVergiDaireleriListesi.pdf
