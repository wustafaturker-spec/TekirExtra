-- MVZ aşama 3 (2026-10-09): KDV oranları ve KDV kodları Mevzuat Merkezi'ne taşınır.

-- ─── İlk dolum (MVZ-11) ──────────────────────────────────────────────────
-- KDV oranları tarihçeli (kullanıcı onayı 2026-10-09): %8 ve %18 09.07.2023'e
-- kadar, %10 ve %20 10.07.2023'ten itibaren — Cumhurbaşkanı Kararı 7346
-- (RG 07.07.2023). %1 ve %0 (istisna kodu gerekir) 2000'den beri.
-- İstisna, özel matrah ve ihraç kayıtlı kodları bugünkü GİB listesiyle
-- (UBL-TR Kod Listeleri v1.43), geçmiş dönem ayrımı yapılmadan 2000'den beri.
INSERT INTO "mevzuat_kayitlari" ("id", "tur", "anahtar", "deger", "yururluk_baslangic", "yururluk_bitis") VALUES
  (gen_random_uuid(), 'kdv_orani', '0', '{"aciklama":"KDV''siz — istisna kodu gerekir"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_orani', '1', '{"aciklama":"İndirimli oran"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_orani', '8', '{"aciklama":"İndirimli oran"}'::jsonb, DATE '2000-01-01', DATE '2023-07-09'),
  (gen_random_uuid(), 'kdv_orani', '18', '{"aciklama":"Genel oran"}'::jsonb, DATE '2000-01-01', DATE '2023-07-09'),
  (gen_random_uuid(), 'kdv_orani', '10', '{"aciklama":"İndirimli oran"}'::jsonb, DATE '2023-07-10', NULL),
  (gen_random_uuid(), 'kdv_orani', '20', '{"aciklama":"Genel oran"}'::jsonb, DATE '2023-07-10', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '201', '{"ad":"17/1 Kültür ve Eğitim Amacı Taşıyan İşlemler","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '202', '{"ad":"17/2-a Sağlık, Çevre Ve Sosyal Yardım Amaçlı İşlemler","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '204', '{"ad":"17/2-c Yabancı Diplomatik Organ Ve Hayır Kurumlarının Yapacakları Bağışlarla İlgili Mal Ve Hizmet Alışları","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '205', '{"ad":"17/2-d Taşınmaz Kültür Varlıklarına İlişkin Teslimler ve Mimarlık Hizmetleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '206', '{"ad":"17/2-e Mesleki Kuruluşların İşlemleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '207', '{"ad":"17/3 Askeri Fabrika, Tersane ve Atölyelerin İşlemleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '208', '{"ad":"17/4-c Birleşme, Devir, Dönüşüm ve Bölünme İşlemleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '209', '{"ad":"17/4-e Banka ve Sigorta Muameleleri Vergisi Kapsamına Giren İşlemler","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '211', '{"ad":"17/4-h Zirai Amaçlı Su Teslimleri İle Köy Tüzel Kişiliklerince Yapılan İçme Suyu teslimleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '212', '{"ad":"17/4-ı Serbest Bölgelerde Verilen Hizmetler","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '213', '{"ad":"17/4-j Boru Hattı İle Yapılan Petrol Ve Gaz Taşımacılığı","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '214', '{"ad":"17/4-k Organize Sanayi Bölgelerindeki Arsa ve İşyeri Teslimleri İle Konut Yapı Kooperatiflerinin Üyelerine Konut Teslimleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '215', '{"ad":"17/4-l Varlık Yönetim Şirketlerinin İşlemleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '216', '{"ad":"17/4-m Tasarruf Mevduatı Sigorta Fonunun İşlemleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '217', '{"ad":"17/4-n Basın-Yayın ve Enformasyon Genel Müdürlüğüne Verilen Haber Hizmetleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '218', '{"ad":"17/4-o Gümrük Antrepoları, Geçici Depolama Yerleri, Gümrüklü Sahalar ve Vergisiz Satış Yapılan Mağazalarla İlgili Hizmetler","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '219', '{"ad":"17/4-p Hazine ve Arsa Ofisi Genel Müdürlüğünün işlemleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '220', '{"ad":"17/4-r İki Tam Yıl Süreyle Sahip Olunan Taşınmaz ve İştirak Hisseleri Satışları","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '221', '{"ad":"Geçici 15 Konut Yapı Kooperatifleri, Belediyeler ve Sosyal Güvenlik Kuruluşlarına Verilen İnşaat Taahhüt Hizmeti","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '223', '{"ad":"Geçici 20/1 Teknoloji Geliştirme Bölgelerinde Yapılan İşlemler","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '225', '{"ad":"Geçici 23 Milli Eğitim Bakanlığına Yapılan Bilgisayar Bağışları İle İlgili Teslimler","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '226', '{"ad":"17/2-b Özel Okulları, Üniversite ve Yüksekokullar Tarafından Verilen Bedelsiz Eğitim Ve Öğretim Hizmetleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '227', '{"ad":"17/2-b Kanunların Gösterdiği Gerek Üzerine Bedelsiz Olarak Yapılan Teslim ve Hizmetler","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '228', '{"ad":"17/2-b Kanunun (17/1) Maddesinde Sayılan Kurum ve Kuruluşlara Bedelsiz Olarak Yapılan Teslimler","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '229', '{"ad":"17/2-b Gıda Bankacılığı Faaliyetinde Bulunan Dernek ve Vakıflara Bağışlanan Gıda, Temizlik, Giyecek ve Yakacak Maddeleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '230', '{"ad":"17/4-g Külçe Altın, Külçe Gümüş Ve Kiymetli Taşlarin Teslimi","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '231', '{"ad":"17/4-g Metal Plastik, Lastik, Kauçuk, Kağit, Cam Hurda Ve Atıkların Teslimi","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '232', '{"ad":"17/4-g Döviz, Para, Damga Pulu, Değerli Kağıtlar, Hisse Senedi ve Tahvil Teslimleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '233', '{"ad":"2942 Sayılı Kamulaştırma Kanunu Kapsamında Taşınmazların Devri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '234', '{"ad":"17/4-ş Konut Finansmanı Amacıyla Teminat Gösterilen ve İpotek Konulan Konutların Teslimi","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '235', '{"ad":"16/1-c Transit ve Gümrük Antrepo Rejimleri İle Geçici Depolama ve Serbest Bölge Hükümlerinin Uygulandığiı Malların Teslimi","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '236', '{"ad":"19/2 Usulüne Göre Yürürlüğe Girmiş Uluslararası Anlaşmalar Kapsamındaki İstisnalar (İade Hakkı Tanınmayan)","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '237', '{"ad":"17/4-t 5300 Sayılı Kanuna Göre Düzenlenen Ürün Senetlerinin İhtisas/Ticaret Borsaları Aracılığıyla İlk Teslimlerinden Sonraki Teslim","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '238', '{"ad":"17/4-u Varlıkların Varlık Kiralama Şirketlerine Devri İle Bu Varlıkların Varlık Kiralama Şirketlerince Kiralanması ve Devralınan Kuruma Devri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '239', '{"ad":"17/4-y Taşınmazların Finansal Kiralama Şirketlerine Devri, Finansal Kiralama Şirketi Tarafından Devredene Kiralanması ve Devri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '240', '{"ad":"17/4-z Patentli Veya Faydalı Model Belgeli Buluşa İlişkin Gayri Maddi Hakların Kiralanması, Devri ve Satışı","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '241', '{"ad":"TürkAkım Gaz Boru Hattı Projesine İlişkin Anlaşmanın (9/b) Maddesinde Yer Alan Hizmetler","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '242', '{"ad":"KDV 17/4-ö md. Gümrük Antrepoları, Geçici Depolama Yerleri ile Gümrüklü Sahalarda, İthalat ve İhracat İşlemlerine konu mallar ile transit rejim kapsamında işlem gören mallar için verilen ardiye, depolama ve terminal hizmetleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '250', '{"ad":"Diğerleri","istisnaTuru":"kismi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '301', '{"ad":"11/1-a Mal İhracatı","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '302', '{"ad":"11/1-a Hizmet İhracatı","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '303', '{"ad":"11/1-a Roaming Hizmetleri","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '304', '{"ad":"13/a Deniz Hava ve Demiryolu Taşıma Araçlarının Teslimi İle İnşa, Tadil, Bakım ve Onarımları","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '305', '{"ad":"13/b Deniz ve Hava Taşıma Araçları İçin Liman Ve Hava Meydanlarında Yapılan Hizmetler","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '306', '{"ad":"13/c Petrol Aramaları ve Petrol Boru Hatlarının İnşa ve Modernizasyonuna İlişkin Yapılan Teslim ve Hizmetler","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '307', '{"ad":"13/c Maden Arama, Altın, Gümüş ve Platin Madenleri İçin İşletme, Zenginleştirme Ve Rafinaj Faaliyetlerine İlişkin Teslim Ve Hizmetler[KDVGUT-(II/8-4)]","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '308', '{"ad":"13/d Teşvikli Yatırım Mallarının Teslimi","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '309', '{"ad":"13/e Liman Ve Hava Meydanlarının İnşası, Yenilenmesi Ve Genişletilmesi","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '310', '{"ad":"13/f Ulusal Güvenlik Amaçlı Teslim ve Hizmetler","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '311', '{"ad":"14/1 Uluslararası Taşımacılık","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '312', '{"ad":"15/a Diplomatik Organ Ve Misyonlara Yapılan Teslim ve Hizmetler","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '313', '{"ad":"15/b Uluslararası Kuruluşlara Yapılan Teslim ve Hizmetler","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '314', '{"ad":"19/2 Usulüne Göre Yürürlüğe Girmiş Uluslar Arası Anlaşmalar Kapsamındaki İstisnalar","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '315', '{"ad":"14/3 İhraç Konusu Eşyayı Taşıyan Kamyon, Çekici ve Yarı Romorklara Yapılan Motorin Teslimleri","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '316', '{"ad":"11/1-a Serbest Bölgelerdeki Müşteriler İçin Yapılan Fason Hizmetler","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '317', '{"ad":"17/4-s Engellilerin Eğitimleri, Meslekleri ve Günlük Yaşamlarına İlişkin Araç- Gereç ve Bilgisayar Programları","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '318', '{"ad":"Geçici 29 3996 Sayılı Kanuna Göre Yap-İşlet-Devret Modeli Çerçevesinde Gerçekleştirilecek Projeler, 3359 Sayılı Kanuna Göre Kiralama Karşılığı Yaptırılan Sağlık Tesislerine İlişkin Projeler ve 652 Sayılı Kanun Hükmünde Kararnameye Göre Kiralama Karşılığı Yaptırılan Eğitim Öğretim Tesislerine İlişkin Projelere İlişkin Teslim ve Hizmetler","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '319', '{"ad":"13/g Başbakanlık Merkez Teşkilatına Yapılan Araç Teslimleri","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '320', '{"ad":"Geçici 16 (6111 sayılı K.) İSMEP Kapsamında İstanbul İl Özel İdaresi''ne Bağlı Olarak Faaliyet Gösteren \"İstanbul Proje Koordinasyon Birimi\"ne Yapılacak Teslim ve Hizmetler","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '321', '{"ad":"Geçici 26 Birleşmiş Milletler (BM) ile Kuzey Atlantik Antlaşması Teşkilatı (NATO) Temsilcilikleri ve Bu Teşkilatlara Bağlı Program, Fon ve Özel İhtisas Kuruluşları ile İktisadi İşbirliği ve Kalkınma Teşkilatına (OECD) Resmi Kullanımları İçin Yapılacak Mal Teslimi ve Hizmet İfaları, Bunların Sosyal ve Ekonomik Yardım Amacıyla Bedelsiz Olarak Yapacakları Mal Teslimi ve Hizmet İfaları İle İlgili Bunlara Yapılan Mal Teslimi ve Hizmet İfaları","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '322', '{"ad":"11/1-a Türkiye''de İkamet Etmeyenlere Özel Fatura ile Yapılan Teslimler (Bavul Ticareti)","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '323', '{"ad":"13/ğ 5300 Sayılı Kanuna Göre Düzenlenen Ürün Senetlerinin İhtisas/Ticaret Borsaları Aracılığıyla İlk Teslimi","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '324', '{"ad":"13/h Türkiye Kızılay Derneğine Yapılan Teslim ve Hizmetler ile Türkiye Kızılay Derneğinin Teslim ve Hizmetleri","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '325', '{"ad":"13/ı Yem Teslimleri","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '326', '{"ad":"13/ı Gıda, Tarım ve Hayvancılık Bakanlığı Tarafından Tescil Edilmiş Gübrelerin Teslimi","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '327', '{"ad":"13/ı Gıda, Tarım ve Hayvancılık Bakanlığı Tarafından Tescil Edilmiş Gübrelerin İçeriğinde Bulunan Hammaddelerin Gübre Üreticilerine Teslimi","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '328', '{"ad":"13/i Konut veya İşyeri Teslimleri","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '329', '{"ad":"Eğitimde Fırsatları Artırma ve Teknolojiyi İyileştirme Hareketi (FATİH) projesi Kapsamında Milli Eğitim Bakanlığına Yapılacak Mal Teslimi ve Hizmet İfası","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '330', '{"ad":"KDV 13/j md. Organize Sanayi Bölgeleri ile Küçük Sanayi Sitelerinin İnşasına İlişkin Teslim ve Hizmetler","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '331', '{"ad":"KDV 13/m md. Ar-Ge, Yenilik ve Tasarım Faaliyetlerinde Kullanılmak Üzere Yapılan Yeni Makina ve Teçhizat Teslimlerinde İstisna","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '332', '{"ad":"KDV Geçici 39. Md. İmalat Sanayiinde Kullanılmak Üzere Yapılan Yeni Makina ve Teçhizat Teslimlerinde İstisna","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '333', '{"ad":"KDV 13/k md. Kapsamında Genel ve Özel Bütçeli Kamu İdarelerine, İl Özel İdarelerine, Belediyelere ve Köylere bağışlanan Tesislerin İnşasına İlişkin İstisna","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '334', '{"ad":"KDV 13/l md. Kapsamında Yabancılara Verilen Sağlık Hizmetlerinde İstisna","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '335', '{"ad":"KDV 13/n Basılı Kitap ve Süreli Yayınların Teslimleri","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '336', '{"ad":"Geçici 46 UEFA Müsabakaları Kapsamında Yapılacak Teslim ve Hizmetler","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '337', '{"ad":"Türk Akım Gaz Boru Hattı Projesine İlişkin Anlaşmanın (9/h) Maddesi Kapsamındaki Gaz Taşıma Hizmetleri","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '338', '{"ad":"İmalatçıların Mal İhracatları","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '339', '{"ad":"İmalat Sanayii ile Turizme Yönelik Yatırım Teşvik Belgesi Kapsamındaki İnşaat İşlerine İlişkin Teslim ve Hizmetler","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '340', '{"ad":"Elektrik Motorlu Taşıt Araçlarının Geliştirilmesine Yönelik Mühendislik Hizmetleri","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '341', '{"ad":"Afetzedelere Bağışlanacak Konutların İnşasına İlişkin İstisna","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '342', '{"ad":"Genel Bütçeli Kamu İdarelerine Bağışlanacak Taşınmazların İnşasına İlişkin İstisna","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '343', '{"ad":"Genel Bütçeli Kamu İdarelerine Bağışlanacak Konutların Yabancı Devlet Kurum ve Kuruluşlarına Teslimine İlişkin İstisna","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '344', '{"ad":"13/o Milli Savunma ve İç Güvenlik İhtiyaçlarında Kullanılmak Üzere Taşıt Teslimi","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '350', '{"ad":"Diğerleri","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'kdv_istisna_kodu', '351', '{"ad":"KDV - İstisna Olmayan Diğer","istisnaTuru":"tam"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ozel_matrah_kodu', '801', '{"ad":"Milli Piyango, Spor Toto vb. Oyunlar"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ozel_matrah_kodu', '802', '{"ad":"At Yarışları ve Diğer Müşterek Bahis ve Talih Oyunları"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ozel_matrah_kodu', '803', '{"ad":"Profesyonel Sanatçıların Yer Aldığı Gösteriler, Konserler, Profesyonel Sporcuların Katıldığı Sportif Faaliyetler, Maçlar, Yarışlar ve Yarışmalar"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ozel_matrah_kodu', '804', '{"ad":"Gümrük Depolarında ve Müzayede Mahallerinde Yapılan Satışlar"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ozel_matrah_kodu', '805', '{"ad":"Altından Mamül veya Altın İçeren Ziynet Eşyaları İle Sikke Altınların Teslimi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ozel_matrah_kodu', '806', '{"ad":"Tütün Mamülleri"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ozel_matrah_kodu', '807', '{"ad":"Muzır Neşriyat Kapsamındaki Gazete, Dergi vb. Periyodik Yayınlar"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ozel_matrah_kodu', '808', '{"ad":"Gümüşten Mamul veya Gümüş İçeren Ziynet Eşyaları ile Sikke Gümüşlerin Teslimi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ozel_matrah_kodu', '809', '{"ad":"Belediyeler Tarafından Yapılan Şehir İçi Yolcu Taşımacılığında Kullanılan Biletlerin ve Kartların Bayiler Tarafından Satışı"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ozel_matrah_kodu', '810', '{"ad":"Ön Ödemeli Elektronik Haberleşme Hizmetleri"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ozel_matrah_kodu', '811', '{"ad":"TŞOF Tarafından Araç Plakaları ile Sürücü Kurslarında Kullanılan Bir Kısım Evrakın Teslimi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ozel_matrah_kodu', '812', '{"ad":"KDV Uygulanmadan Alınan İkinci El Motorlu Kara Taşıtı veya Taşınmaz Teslimi"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ihrac_kayitli_kodu', '701', '{"ad":"3065 s. KDV Kanununun 11/1-c md. Kapsamındaki İhraç Kayıtlı Satış"}'::jsonb, DATE '2000-01-01', NULL),
  (gen_random_uuid(), 'ihrac_kayitli_kodu', '702', '{"ad":"DİİB ve Geçici Kabul Rejimi Kapsamındaki Satışlar"}'::jsonb, DATE '2000-01-01', NULL);

INSERT INTO "mevzuat_olaylari" ("id", "olay", "detay") VALUES
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "kdv_orani", "kaynak": "Cumhurbaşkanı Kararı 7346 (RG 07.07.2023)", "kayit": 6, "not": "%8/%18 09.07.2023 dahil sona erer; %10/%20 10.07.2023 başlar"}'::jsonb),
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "kdv_istisna_kodu", "kaynak": "UBL-TR Kod Listeleri v1.43", "yururlukBaslangic": "2000-01-01"}'::jsonb),
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "ozel_matrah_kodu", "kaynak": "UBL-TR Kod Listeleri v1.43", "yururlukBaslangic": "2000-01-01"}'::jsonb),
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "ihrac_kayitli_kodu", "kaynak": "UBL-TR Kod Listeleri v1.43", "yururlukBaslangic": "2000-01-01"}'::jsonb);

-- ─── Etki önizlemesi tüm türler için (MVZ-06) ────────────────────────────
-- Değişen ya da kaldırılan kalemi kullanan, yürürlükten sonraki tarihli taslak
-- fatura ve belgelerin (teklif/sipariş/irsaliye) sayısı. Yalnız toplam döner.
DROP FUNCTION mevzuat_etki_tevkifat(text[], date);
CREATE FUNCTION mevzuat_etki(p_tur text, p_anahtarlar text[], p_yururluk date)
RETURNS TABLE (taslak_fatura bigint, taslak_belge bigint, firma bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  WITH f AS (
    SELECT f.id, f.tenant_id FROM faturalar f
    WHERE f.durum = 'taslak' AND f.tarih >= p_yururluk AND (
      (p_tur = 'tevkifat_kodu' AND EXISTS (SELECT 1 FROM fatura_satirlari s WHERE s.fatura_id = f.id AND s.tevkifat_kodu = ANY(p_anahtarlar)))
      OR (p_tur = 'kdv_orani' AND EXISTS (SELECT 1 FROM fatura_satirlari s WHERE s.fatura_id = f.id AND s.kdv_orani::text::numeric = ANY(p_anahtarlar::numeric[])))
      OR (p_tur = 'kdv_istisna_kodu' AND EXISTS (SELECT 1 FROM fatura_satirlari s WHERE s.fatura_id = f.id AND s.gib_istisna_kodu = ANY(p_anahtarlar)))
      OR (p_tur = 'ozel_matrah_kodu' AND f.ozel_matrah_kodu = ANY(p_anahtarlar))
      OR (p_tur = 'ihrac_kayitli_kodu' AND f.ihrac_kayitli_kodu = ANY(p_anahtarlar))
    )
  ), b AS (
    SELECT b.id, b.tenant_id FROM belgeler b
    WHERE p_tur = 'kdv_orani' AND b.durum = 'taslak' AND b.tarih >= p_yururluk
      AND EXISTS (SELECT 1 FROM belge_satirlari s WHERE s.belge_id = b.id AND s.kdv_orani::text::numeric = ANY(p_anahtarlar::numeric[]))
  )
  SELECT (SELECT count(*) FROM f), (SELECT count(*) FROM b),
         (SELECT count(DISTINCT t) FROM (SELECT tenant_id t FROM f UNION SELECT tenant_id FROM b) x);
$$;
REVOKE ALL ON FUNCTION mevzuat_etki(text, text[], date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mevzuat_etki(text, text[], date) TO tekir_platform;
