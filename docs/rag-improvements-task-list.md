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

- [x] `CHUNK_OVERLAP` varsayılanını `0` → `150` yap (~%15 of `CHUNK_SIZE`). Düzeltme doğru, **ama etkisi o günkü corpus'ta ölçülemedi** — aşağıya bak. (3. maddedeki corpus bölünen belgeler getirdi; ızgara taraması 4. maddede.)
- [x] Reranker aç/kapa A/B koş.
- [ ] `rerankFetchK` A/B — 3. maddedeki corpus ile store 3 → **21 chunk**'a çıktı, yani artık prensipte ölçülebilir; ama varsayılan `fetchK=20` hâlâ neredeyse tüm store'u çekiyor, dolayısıyla anlamlı bir A/B için ya corpus büyümeli ya `fetchK` küçük değerlerde (3, 5, 10) taranmalı. 4. maddeye devrediyor.
- [x] Her iki değişikliği de 1. maddedeki baseline'a karşı raporla.

Kabul kriteri: İki ayarın etkisi sayısal olarak kayıtlı; hangisinin kalıcı olduğu baseline karşılaştırmasıyla gerekçelendirilmiş.

### Bulgu: corpus, chunking deneyleri için çok küçük

Corpus dosyalarının üçü de 1000 karakterin altında (691/779/768), `CHUNK_SIZE=1000`. Yani her dosya **tek chunk** oluyor — koşum çıktısı da bunu söylüyor: *"3 chunk(s) from 3 source(s)"*. Hiçbir metin bölünmediği için `CHUNK_OVERLAP`'in bu corpus'ta ölçülebilir etkisi **sıfır**. Varsayılan yine de düzeltildi (bölünme olan gerçek belgelerde doğru davranış), ama faydası **3. madde bitene kadar kanıtlanamaz**.

Aynı sebeple `rerankFetchK` de test edilemez: aday havuzu zaten 3 ile sınırlı.

### Reranker A/B (bge-small embedding, k=3, threshold=0.45, 17 vaka)

| Metrik | Reranker OFF | Reranker ON | Δ |
|---|---|---|---|
| P@k | 61.7% | **100.0%** | +38.3 |
| R@k | 100.0% | 100.0% | – |
| MRR | 0.950 | **1.000** | +0.050 |
| **falseRetrievalRate** | **85.7%** | **14.3%** | **−71.4** |
| falseAnswerRate | 0.0% | 0.0% | – |
| groundedness | 38.7% | 43.6% | +4.9 |
| retrieval latency | 18ms | 235ms | **13×** |

**Reranker, 1. maddede bulunan asıl problemi çözüyor.** Cevapsız sorularda eşiği geçen chunk oranı %85.7'den %14.3'e düşüyor. Mekanizma ortalama tutulan chunk sayısında görünüyor:

| | cevaplanabilir | cevapsız |
|---|---|---|
| Reranker OFF | 1.90 chunk | 1.71 chunk ← ayırt edemiyor |
| Reranker ON | 1.00 chunk | 0.14 chunk ← keskin ayrım |

Kosinüs benzerliği alakalı ile alakasızı neredeyse hiç ayırmıyor; cross-encoder ayırıyor.

**Öneri:** reranker açık kullanılsın. Varsayılan `false` kalmalı (GGUF model indirmesi gerektiriyor), ama README/deployment dokümanında önerilen konfigürasyon olarak işaretlensin.

> **Bu öneri 3. maddede revize edildi.** Gerçekçi corpus üzerinde reranker precision'ı recall ile satın alıyor (`hitRate` %100 → %92.2). 3. maddedeki A/B tablosuna bakın; koşulsuz "açık kullanılsın" tavsiyesi artık geçerli değil.

### Bu A/B'den çıkan iki uyarı

1. **`RETRIEVAL_THRESHOLD` iki farklı skor ölçeğine uygulanıyor.** Reranker kapalıyken kosinüs benzerliğine, açıkken cross-encoder'ın olasılık skoruna. `0.45` bu ikisinde aynı şeyi ifade etmiyor, dolayısıyla `falseRetrievalRate` kazancının bir kısmı kalite değil **ölçek artefaktı** olabilir. Reranker moduna göre ayrı eşik (veya skor normalizasyonu) gerekiyor — 4. maddeye eklendi.
2. **Reranker açıkken cevaplanabilir sorularda ortalama sadece 1.00 chunk tutuluyor** (1.90'dan düşüş). Recall %100 kaldığı için tek kaynaklı sorularda sorun yok, ama **çok kaynaklı soru henüz datasette yok**. Bu davranış 3. maddedeki çok kaynaklı vakalarla tekrar sınanmalı. → **Sınandı ve doğrulandı** (3. maddedeki A/B): çok kaynaklı recall %80 → %70, genel `hitRate` %100 → %92.2.

## 3. Değerlendirme setini gerçekçi hâle getirme

- [x] **Corpus'u model-ön-bilgisiyle cevaplanamaz hâle getir.** Kurgusal bir şirketin (Meridian
  Systems) kurgusal ürününe (Corvus) ait beş iç belge eklendi: ürün spesifikasyonu, destek/SLA
  politikası, sürüm notları, mimari karar kaydı (ADR-0007) ve mühendislik operasyon el kitabı.
  İçindeki her olgu uydurma — `CORVUS_QUOTA_EXCEEDED`, Halyard, Nightwatch rotasyonu — dolayısıyla
  doğru bir cevap yalnızca retrieval'dan gelebilir. Eski üç belge silinmedi.
- [x] Mevcut 10 soruyu regresyon amacıyla koru, üzerine geniş golden set kur. Dataset 17 → **66
  vaka**; eski 17'si `regression` etiketiyle aynen duruyor, 49 yeni vaka `golden` etiketli.
- [x] Her belge için doğrudan, dolaylı ve benzer-konulu distractor sorular ekle
  (`direct` 24, `indirect` 18, `distractor` 4).
- [x] Cevapsız sorular ekle: `near-corpus` 11, `out-of-scope` 4 (toplam 15 cevapsız vaka).
- [x] Çok kaynaklı cevap gerektiren vakalar ekle (`multi-source` 5; her biri en az iki belge ister,
  unit test bunu zorunlu kılıyor).
- [x] Beklenen kaynaklara ek olarak beklenen bölüm/chunk kimliği tanımlama ihtiyacını değerlendir.
  **Sonuç: chunk kimliği yerine `expectedSnippets`.** Gerekçe aşağıda.
- [x] Her vaka için beklenen anahtar bilgiler, kaynak ve gerekçe kaydı tut (`expectedKeywords`,
  `expectedSnippets`, `expectedSources`, `rationale`, `tags`).
- [x] Eval'i CI'ya bağla — yalnızca deterministik retrieval metrikleri build'i kırıyor.

Kabul kriteri karşılandı: yeni set hem retrieval hem hallucination/abstention davranışını ayırt
ediyor, cevaplar corpus olmadan üretilemiyor ve gerileme `eval/gates.json` üzerinden build'i kırıyor.

### Chunk kimliği yerine snippet: gerekçe

Bölüm/chunk kimliği ile cevap anahtarı yazmak cazip ama kendi kendini geçersiz kılar: chunk
kimliği `CHUNK_SIZE` veya `CHUNK_OVERLAP` her değiştiğinde kayar — yani tam da eval'in taramak
için var olduğu ayarlar dataset'i bozar. Bunun yerine her cevaplanabilir vaka, corpus'tan
**birebir bir cümle parçası** (`expectedSnippets`) taşıyor; `snippetCoverage` metriği bunu
getirilen chunk metinlerinde arıyor (büyük/küçük harf ve satır sonu duyarsız). Sonuç aynı
granülerliği verir — doğru dosya değil, doğru *pasaj* geldi mi — ama yeniden chunk'lamaya
dayanıklıdır.

Yan fayda: cevap anahtarının corpus ile hâlâ uyuştuğu artık bir **unit test** ile doğrulanıyor
(`runner.test.ts`), embedding modeli veya vector store gerektirmeden. Bir belge düzenlenip bir
vakayı sessizce geçersiz kılarsa test kırılır.

### Yeni baseline (bge-small, k=3, threshold=0.45, reranker OFF, 66 vaka, 21 chunk / 8 kaynak)

```
RETRIEVAL (answerable only)  P@k= 56.2%  R@k= 98.0%  MRR= 0.928  hitRate=100.0%  snippet= 98.0%
ABSTENTION                   accuracy= 92.4%  falseAnswerRate= 20.0%  falseRetrievalRate=100.0%
ANSWER                       kwCoverage= 96.2%  groundedness= 36.8%
LATENCY                      retrieval=    19ms  generation=  3576ms
```

1. maddedeki baseline ile **doğrudan kıyaslanamaz** (farklı corpus, farklı vaka sayısı). Bu, yeni
sıfır noktası.

### Bu setin ortaya çıkardıkları

- **`falseAnswerRate` %0 → %20.** Eski sette hiç hallucination görünmüyordu; burada model üç
  cevapsız soruya cevap uydurdu (ADR'de adı hiç geçmeyen üçüncü-parti motorları, var olmayan bir
  Vane latency SLA'i, hiç yazılmamış rotasyon büyüklüğü). 1. maddedeki "hallucination'ı önleyen
  tek şey prompt" tespiti artık ölçülüyor — ve prompt tek başına yetmiyor.
- **`falseRetrievalRate` %100.** Corpus büyüdükçe her cevapsız soru eşiğin üstünde chunk
  getiriyor. 4. maddenin (eşik + embedding) hedefi netleşti.
- **`multi-source` en zayıf sınıf: kwCoverage %70, R@k %80.** Model iki belgeli soruların
  yalnızca bir yarısını cevaplıyor. Sınıf bazlı tablo olmasa bu, %96'lık genel kwCoverage
  ortalamasının içinde kaybolurdu — `byTag` kırılımının varlık sebebi tam olarak bu.
- **`near-corpus` groundedness %5.2.** Uydurulan cevaplar gerçekten de kaynaklara dayanmıyor;
  groundedness proxy'si bu ayrımı yapabiliyor.
- **Generation metrikleri koşumlar arası oynuyor.** Aynı commit'te arka arkaya iki koşum
  `falseAnswerRate` %13.3 ve %20.0, `abstentionAccuracy` %95.5 ve %92.4 verdi. Bunlara eşik
  koymak build'i gürültüyle kırardı — CI kararının ampirik gerekçesi bu.

### Reranker A/B — gerçekçi sette sonuç tersine döndü

2. maddedeki A/B, üç chunk'lık corpus'ta reranker'ı bedava kazanç gibi göstermişti. 21 chunk ve
gerçek distractor'lar ile tablo değişiyor:

| Metrik | Reranker OFF | Reranker ON | Δ |
|---|---|---|---|
| P@k | 56.2% | **89.2%** | +33.0 |
| R@k | **98.0%** | 91.2% | −6.8 |
| MRR | **0.928** | 0.912 | −0.016 |
| hitRate | **100.0%** | 92.2% | −7.8 |
| snippetCoverage | **98.0%** | 89.2% | −8.8 |
| falseRetrievalRate | 100.0% | **13.3%** | −86.7 |
| retrieval latency | **17ms** | 1439ms | 85× |

Ortalama tutulan chunk sayısı mekanizmayı gösteriyor:

| | cevaplanabilir | cevapsız |
|---|---|---|
| Reranker OFF | 2.92 chunk | 2.60 chunk |
| Reranker ON | 1.14 chunk | 0.13 chunk |

**Reranker artık bedava değil: precision'ı recall ile satın alıyor.** Dört vakada doğru belge
tamamen düşüyor (`spec-bronze-query-timespan`, `adr-storage-cost-consequence`,
`handbook-deploy-window`, `multi-sev1-page-and-sla`) ve `multi-source` recall %80 → %70'e
geriliyor. 2. maddedeki "reranker açık kullanılsın" önerisi bu yüzden **koşullu**: cevapsız
soruların çokluğu recall kaybına değiyorsa evet, ama eşik ayarı (4. madde) yapılmadan önce
varsayılan olarak açılmamalı. 2. maddedeki 2 numaralı uyarı (tutulan chunk sayısının 1'e düşmesi)
böylece **doğrulandı**.

### CI

- `.github/workflows/ci.yml` — her push/PR'da: build + unit test, ve ayrı bir işte **deterministik
  retrieval eval** (Chroma service container + yerel bge-small GGUF, LLM yok). `EVAL_GATE=true`
  ile `eval/gates.json` eşiklerinin altına düşen koşum build'i kırar.
- `.github/workflows/eval-full.yml` — gecelik + manuel: generation dâhil tam koşum (Ollama service
  container). Metrikler raporlanır ve artifact olarak yüklenir, **gate değildir**.
- `parseGateConfig`, generation metriklerinin (groundedness, keywordCoverage, abstention,
  falseAnswerRate) gate olarak yazılmasını **reddediyor** — kural dokümanda değil, kodda.
- Cevap anahtarının corpus ile tutarlılığı unit testte doğrulanıyor, yani hiçbir servis
  gerektirmeden her commit'te.

## 4. Retrieval kalitesi: embedding, chunking, query

- [ ] **`RETRIEVAL_THRESHOLD`'u skor ölçeğinden bağımsız hâle getir.** Aynı eşik hem kosinüs benzerliğine hem cross-encoder olasılığına uygulanıyor; reranker'ı açmak eşiğin anlamını sessizce değiştiriyor (2. maddedeki A/B'den çıktı). Ya moda göre ayrı eşik, ya skor normalizasyonu.
- [ ] **Embedding modeli karşılaştırması yap.** Retrieval kalitesinde tek en büyük kaldıraç bu ve repo'da üç sağlayıcı hazır (`gemini`, `ollama`, `llama`). Türkçe/çok dilli içerik hedefleniyorsa çok dilli model karşılaştırması, chunking deneylerinden daha yüksek getirili.
- [x] Reranker açıkken cevaplanabilir sorularda tutulan chunk sayısının 1.00'e düşmesini çok kaynaklı vakalarla sına (2. maddeden devreden uyarı). **Doğrulandı**: 3. maddedeki A/B'de reranker cevaplanabilir sorularda ortalama 1.14 chunk tutuyor ve dört vakada doğru belgeyi tamamen düşürüyor. Kalan iş bu maddede: eşiği reranker moduna göre ayarlamak ve `topK`'yi çok kaynaklı sorular için yeniden değerlendirmek.
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
