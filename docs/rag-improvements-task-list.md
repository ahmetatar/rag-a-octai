# RAG İyileştirme Task Listesi

Sıra ölçüm önceliklidir: ingestion/chunking değişikliklerinin faydası, güvenilir bir eval olmadan görülemez. Ancak 1. maddeden hemen sonra, ucuz ve yüksek getirili iki ayar (chunk overlap + reranker) devreye alınır; bunlar tam bir golden set beklemez.

Kod referansları bu listenin yazıldığı andaki `main` durumuna göredir.

## 1. Eval altyapısı, cevapsızlık ve groundedness

- [x] Eval veri şemasına `expectedAnswerable` ve `expectedRefusal` alanlarını ekle.
- [x] `expectedSources: []` olan vakaların yanlışlıkla başarılı sayılmasını düzelt. `recallAtK`/`hitAtK` artık boş beklenti için `undefined` dönüyor; retrieval metrikleri yalnızca cevaplanabilir vakalar üzerinden ortalanıyor.
- [x] Eval koşumunda production'daki `threshold` filtrelemesini de uygula (`EVAL_THRESHOLD` ile taranabilir).
- [x] `abstentionAccuracy`, `falseAnswerRate` ve `falseRetrievalRate` metriklerini ekle.
- [x] Yanıtın reddetme davranışını ölç: `NO_ANSWER` sentinel protokolü (`llm/abstention.ts`); prompt onu yayıyor, orchestrator client'a sızdırmadan `abstained` bayrağına çeviriyor, eval deterministik olarak ölçüyor.
- [x] **Groundedness ölçümü ekle**: cevabın kelime-trigram'larının getirilen chunk'larda bulunma oranı. Deterministik, model gerektirmiyor.
- [x] Latency alanlarını rapora ekle (retrieval + generation, ms).
- [x] Yeni metrikler ve boş kaynak vakaları için unit test yaz.
- [x] Eval raporuna cevaplanabilir/cevapsız vaka dağılımını ve yeni metrikleri ekle.
- [ ] Opsiyonel LLM-judge katmanı (`EVAL_JUDGE=true`): groundedness proxy'sinin mutlak bir hükme ihtiyaç duyduğu yerde devreye girer. Deterministik katman CI gate'i olarak kalır.
- [ ] Token/maliyet sayımı ekle (şu an yalnızca süre ölçülüyor).

Kabul kriteri: Cevapsız vaka, doğru reddedildiğinde başarılı; alakasız kaynak veya uydurulmuş yanıt üretildiğinde başarısız sayılır. Cevabın kaynaklara dayanıp dayanmadığı ayrı bir metrikle görünür.

Not: Groundedness bir *proxy*'dir — modelin kendi kelimeleriyle doğru cevabı düşük, yanlış chunk'ın akıcı parafrazını yüksek puanlar. Koşumlar arası göreli sinyal olarak okunmalı.

### Baseline (ölçüldü: bge-small embedding, qwen3:1.7b, k=3, threshold=0.45, 17 vaka)

```
RETRIEVAL (answerable only)  P@k= 61.7%  R@k=100.0%  MRR= 0.950  hitRate=100.0%
ABSTENTION                   accuracy=100.0%  falseAnswerRate=  0.0%  falseRetrievalRate= 85.7%
ANSWER                       kwCoverage=100.0%  groundedness= 38.7%
LATENCY                      retrieval=    17ms  generation=  2103ms
```

Bu baseline'ın söyledikleri:

- **`falseRetrievalRate = %85.7` — ilk gerçek bulgu.** 7 cevapsız sorunun 6'sı hâlâ eşiğin üstünde chunk getiriyor. Konu-ilgili ama cevap-taşımayan chunk'lar. Prompt şu an bunu telafi ettiği için `falseAnswerRate = %0`; yani hallucination'ı önleyen tek şey prompt, retrieval değil. Bu 4. maddenin (embedding + threshold) işi.
- **`kwCoverage = %100` şu an anlamsız.** Corpus genel kültür olduğu için model retrieval çalışmasa da doğru anahtar kelimeleri üretiyor — 3. maddenin ilk kalemi tam olarak bunu çözecek.
- **`P@k` 33.3% → 61.7%** yükseldi; sebebi kalite artışı değil, eval'in artık production threshold'unu uygulaması (alakasız chunk'lar sayıma girmiyor). Eski sayılarla kıyaslanamaz; baseline buradan başlar.

## 2. Hızlı kazanımlar (golden set'i beklemez)

- [ ] `CHUNK_OVERLAP` varsayılanını düzelt. Şu an `config.ts` içinde `0`; karakter tabanlı recursive splitter'da bu, cümle/paragraf ortasından kesip bağlamı koparıyor. Bu bir deney konusu değil, hatalı varsayılan — baseline ölçümünden hemen sonra düzeltilir, sonra 4. maddede ince ayarı yapılır.
- [ ] Reranker aç/kapa ve `rerankFetchK` için A/B koş. Reranker zaten kurulu ve `eval/runner.ts` onu destekliyor; neredeyse bedava bir karşılaştırma.
- [ ] Her iki değişikliği de 1. maddedeki baseline'a karşı raporla.

Kabul kriteri: İki ayarın etkisi sayısal olarak kayıtlı; hangisinin kalıcı olduğu baseline karşılaştırmasıyla gerekçelendirilmiş.

## 3. Değerlendirme setini gerçekçi hâle getirme

- [ ] **Corpus'u model-ön-bilgisiyle cevaplanamaz hâle getir.** Mevcut corpus (`solar-system.txt`, `photosynthesis.txt`, `roman-empire.txt`) genel kültür; LLM bu soruları retrieval hiç çalışmasa da cevaplıyor, dolayısıyla `keywordCoverage` şu an retrieval'ı ölçmüyor. Alan-özel, modelin bilemeyeceği içerik şart.
- [ ] Mevcut 10 soruyu regresyon amacıyla koru, üzerine geniş golden set kur.
- [ ] Her belge için doğrudan, dolaylı ve benzer-konulu distractor sorular ekle.
- [ ] Cevapsız sorular ekle: tamamen kapsam dışı ve corpus'a yakın ama cevabı olmayan sorular.
- [ ] Çok kaynaklı cevap gerektiren vakalar ekle.
- [ ] Beklenen kaynaklara ek olarak beklenen bölüm/chunk kimliği tanımlama ihtiyacını değerlendir.
- [ ] Her vaka için beklenen anahtar bilgiler, kaynak ve gerekçe kaydı tut.
- [ ] Eval'i CI'ya bağla — **ama yalnızca deterministik retrieval metrikleri build'i kırsın.** Tam koşum (generation dahil) Chroma + Ollama + embedding modeli ister; her PR'da yavaş ve flaky olur, LLM üretimi non-deterministik olduğu için eşik takılması gürültüye döner. Tam koşum nightly veya manuel tetikli; generation metrikleri raporlanır ama gate değildir.

Kabul kriteri: Dataset, hem retrieval hem de hallucination/abstention davranışını temsil eder; cevaplar corpus olmadan üretilemez; değişikliklerde metrik gerilemesi görünür olur.

## 4. Retrieval kalitesi: embedding, chunking, query

- [ ] **Embedding modeli karşılaştırması yap.** Retrieval kalitesinde tek en büyük kaldıraç bu ve repo'da üç sağlayıcı hazır (`gemini`, `ollama`, `llama`). Türkçe/çok dilli içerik hedefleniyorsa çok dilli model karşılaştırması, chunking deneylerinden daha yüksek getirili.
- [ ] Karakter yerine token odaklı chunk boyutlarını değerlendirme altyapısına ekle.
- [ ] Chunk boyutu × overlap ızgarasını eval setinde tara (2. maddedeki düzeltmenin üstüne ince ayar).
- [ ] Başlık, alt başlık ve bölüm yolunu çıkarıp her chunk metadata'sına koy.
- [ ] Chunk metnine gerektiğinde bölüm bağlamı ekle.
- [ ] PDF'lerde sayfa bazlı bölme ile genel PDF handler kullanımını netleştir.
- [ ] **Query tarafı iyileştirmelerini değerlendir**: query rewriting, multi-query, HyDE. Liste bu noktaya kadar tamamen ingestion odaklı; sorgu tarafı ölçülmeden bırakılmamalı.
- [ ] Farklı stratejileri eval sonuçlarıyla karşılaştır ve kazananı gerekçesiyle kaydet.

Kabul kriteri: En iyi konfigürasyon eval setinde baseline'a göre retrieval metriklerini korur veya iyileştirir; chunk tek başına okunabilir kalır; latency/maliyet regresyonu kabul edilebilir sınırda.

## 5. Metadata, sürümleme ve tekilleştirme

- [ ] Standart metadata şeması tanımla: `sourceUrl`, `title`, `sectionPath`, `version`, `updatedAt`, `language`, `documentType`, `accessLevel`. (Şu an chunk'larda yalnızca `source`, `chunk`, `totalChunks`, `tenantId` ve PDF'lerde `page` var.)
- [ ] Ingestion API'sinden veya belge özelliklerinden metadata alma yolunu belirle.
- [ ] Aynı kaynak adına göre güncelleme davranışını sürdür (mevcut delete-then-upsert korunur).
- [ ] Farklı adla yüklenen aynı içeriği hash ile tespit edip deduplicate et.
- [ ] Eski/güncel belge sürümlerinin retrieval kuralını belirle.
- [ ] Metadata filtrelerinin vector store katmanında uygulanmasını ekle.

Kabul kriteri: Her sonuç kaynak, sayfa/bölüm ve sürüm açısından izlenebilir; güncel olmayan veya yinelenen içerik yanlışlıkla öncelik kazanmaz.

## 6. Güvenlik ve yetkilendirme

Not: `accessLevel` bazlı filtreleme 5. maddedeki metadata filtreleme altyapısına bağlıdır. Kurumsal bir gereklilik hâline gelirse bu bölüm 5 ile birlikte öne çekilir.

- [ ] Ingestion öncesi PII, API anahtarı ve secret tespiti için politika belirle.
- [ ] Tespit edilen hassas içeriği reddetme, maskeleme veya karantinaya alma davranışını seç.
- [ ] `accessLevel`/rol bazlı metadata filtrelemesi ekle.
- [ ] Tenant izolasyonu testlerine rol ve erişim seviyesi senaryolarını ekle.
- [ ] Silme, yeniden indeksleme ve sürüm güncelleme denetim kayıtlarını ekle.

Kabul kriteri: Kullanıcı yalnızca yetkili olduğu chunk'ları retrieval aşamasında görebilir.

## 7. Belge kalitesi ve özel formatlar

- [ ] Taranmış PDF'ler için OCR stratejisi belirle ve destek ekle.
- [ ] Tablo içeriğinin satır-sütun ilişkisini koruyacak dönüşüm uygula.
- [ ] Kod bloklarının bölünmesini azaltacak özel chunking kuralları ekle.
- [ ] HTML'de navigation, footer ve tekrar eden boilerplate temizliğini güçlendir.
- [ ] Ingestion kalite uyarıları ekle: boş metin, düşük karakter oranı, aşırı tekrar, OCR ihtiyacı.

Kabul kriteri: İşlenemeyen veya düşük kaliteli belge sessizce indekslenmez; durum açıkça raporlanır.

## 8. Operasyonel kalite

- [ ] Eval sonuçlarını tarih, konfigürasyon, embedding modeli ve corpus sürümüyle kaydet.
- [ ] Baseline raporunu versiyonla; değişim raporu üret.
- [ ] Retrieval skor dağılımı ve abstention oranı için gözlemlenebilirlik metrikleri ekle.
- [ ] Düzenli yeniden indeksleme ve geri alma prosedürünü dokümante et.
- [ ] Dataset/metadata değişiklikleri için migration stratejisi yaz.

---

İlk uygulanacak iş: **1. Eval altyapısı, cevapsızlık ve groundedness**. Bu, kalan tüm iyileştirmeleri ölçülebilir hâle getirir. Hemen ardından 2. madde (hızlı kazanımlar) gelir; 3. madde beklenmez.
