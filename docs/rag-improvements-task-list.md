# RAG İyileştirme Task Listesi

Aşağıdaki sırayla ilerlemeyi öneriyorum. Önce ölçüm altyapısını güçlendirmek önemli; aksi halde ingestion/chunking değişikliklerinin faydasını güvenilir biçimde göremeyiz.

## 1. Eval altyapısı ve cevapsızlık

- [x] Eval veri şemasına `expectedAnswerable` ve gerekirse `expectedRefusal` alanlarını ekle.
- [x] `expectedSources: []` olan vakaların mevcut metriklerde yanlışlıkla başarılı sayılmasını düzelt.
- [x] Eval koşumunda production’daki `threshold` filtrelemesini de uygula.
- [x] `abstentionAccuracy`, `falseAnswerRate` ve `falseRetrievalRate` metriklerini ekle.
- [x] Yanıtın reddetme davranışını ölç: kaynak boşken uydurma yerine güvenli cevap vermeli.
- [x] Yeni metrikler ve boş kaynak vakaları için unit test yaz.
- [x] Eval raporuna cevaplanabilir/cevapsız vaka dağılımını ve yeni metrikleri ekle.

Kabul kriteri: Cevapsız vaka, doğru reddedildiğinde başarılı; alakasız kaynak veya uydurulmuş yanıt üretildiğinde başarısız sayılır.

## 2. Değerlendirme setini gerçekçi hâle getirme

- [x] Mevcut 10 soruyu koruyup daha geniş, alan-özel bir golden set oluştur.
- [x] Her belge için doğrudan, dolaylı ve benzer-konulu distractor sorular ekle.
- [x] Cevapsız sorular ekle: tamamen kapsam dışı ve corpus’a yakın ama cevabı olmayan sorular.
- [x] Çok kaynaklı cevap gerektiren vakalar ekle.
- [x] Beklenen kaynaklara ek olarak beklenen bölüm/chunk kimliği tanımlama ihtiyacını değerlendir.
- [x] Her vaka için beklenen anahtar bilgiler, kaynak ve gerekçe kaydı tut.
- [x] Eval’i CI’da çalışacak şekilde temel kalite eşiğiyle bağla.

Kabul kriteri: Dataset, hem retrieval hem de hallucination/abstention davranışını temsil eder; değişikliklerde metrik gerilemesi görünür olur.

## 3. Chunking ve bağlam koruma

- [ ] Varsayılan `CHUNK_OVERLAP=0` değerini deneysel olarak optimize et.
- [ ] Karakter yerine token odaklı chunk boyutlarını değerlendirme altyapısına ekle.
- [ ] Başlık, alt başlık ve bölüm yolunu çıkarıp her chunk metadata’sına koy.
- [ ] Chunk metnine gerektiğinde bölüm bağlamı ekle.
- [ ] PDF’lerde sayfa bazlı bölme ile genel PDF handler kullanımını netleştir.
- [ ] Farklı chunk stratejilerini eval sonuçlarıyla karşılaştır.

Kabul kriteri: En iyi strateji eval setinde baseline’a göre retrieval metriklerini korur veya iyileştirir; chunk tek başına okunabilir kalır.

## 4. Metadata, sürümleme ve tekilleştirme

- [ ] Standart metadata şeması tanımla: `sourceUrl`, `title`, `sectionPath`, `version`, `updatedAt`, `language`, `documentType`, `accessLevel`.
- [ ] Ingestion API’sinden veya belge özelliklerinden metadata alma yolunu belirle.
- [ ] Aynı kaynak adına göre güncelleme davranışını sürdür.
- [ ] Farklı adla yüklenen aynı içeriği hash ile tespit edip deduplicate et.
- [ ] Eski/güncel belge sürümlerinin retrieval kuralını belirle.
- [ ] Metadata filtrelerinin vector store katmanında uygulanmasını ekle.

Kabul kriteri: Her sonuç kaynak, sayfa/bölüm ve sürüm açısından izlenebilir; güncel olmayan veya yinelenen içerik yanlışlıkla öncelik kazanmaz.

## 5. Belge kalitesi ve özel formatlar

- [ ] Taranmış PDF’ler için OCR stratejisi belirle ve destek ekle.
- [ ] Tablo içeriğinin satır-sütun ilişkisini koruyacak dönüşüm uygula.
- [ ] Kod bloklarının bölünmesini azaltacak özel chunking kuralları ekle.
- [ ] HTML’de navigation, footer ve tekrar eden boilerplate temizliğini güçlendir.
- [ ] Ingestion kalite uyarıları ekle: boş metin, düşük karakter oranı, aşırı tekrar, OCR ihtiyacı.

Kabul kriteri: İşlenemeyen veya düşük kaliteli belge sessizce indekslenmez; durum açıkça raporlanır.

## 6. Güvenlik ve yetkilendirme

- [ ] Ingestion öncesi PII, API anahtarı ve secret tespiti için politika belirle.
- [ ] Tespit edilen hassas içeriği reddetme, maskeleme veya karantinaya alma davranışını seç.
- [ ] `accessLevel`/rol bazlı metadata filtrelemesi ekle.
- [ ] Tenant izolasyonu testlerine rol ve erişim seviyesi senaryolarını ekle.
- [ ] Silme, yeniden indeksleme ve sürüm güncelleme denetim kayıtlarını ekle.

Kabul kriteri: Kullanıcı yalnızca yetkili olduğu chunk’ları retrieval aşamasında görebilir.

## 7. Operasyonel kalite

- [ ] Eval sonuçlarını tarih, konfigürasyon, embedding modeli ve corpus sürümüyle kaydet.
- [ ] Baseline raporunu versiyonla; değişim raporu üret.
- [ ] Retrieval skor dağılımı ve abstention oranı için gözlemlenebilirlik metrikleri ekle.
- [ ] Düzenli yeniden indeksleme ve geri alma prosedürünü dokümante et.
- [ ] Dataset/metadata değişiklikleri için migration stratejisi yaz.

İlk uygulanacak iş olarak **1. Eval altyapısı ve cevapsızlık** maddesini öneririm. Bu, kalan tüm iyileştirmeleri ölçülebilir hâle getirir.
