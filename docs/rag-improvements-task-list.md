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
- [x] Opsiyonel LLM-judge katmanı (`EVAL_JUDGE=true`): groundedness proxy'sinin mutlak bir hükme ihtiyaç duyduğu yerde devreye girer (`eval/judge.ts`). Yalnızca cevaplanan, `expectedKeywords` taşıyan vakaları derecelendiriyor; `judgeAccuracy` non-deterministic olduğu için `GATEABLE_METRICS` listesinde değil — deterministik katman tek CI gate'i olarak kalıyor.
- [x] Token/maliyet sayımı ekle. Ollama'nın `prompt_eval_count`/`eval_count` alanları `generateResponse`'un artık döndürdüğü `usage` alanına taşınıyor; rapor `totalPromptTokens`/`totalCompletionTokens`/`totalCostUsd` topluyor. Maliyet `EVAL_PROMPT_COST_PER_1K_TOKENS`/`EVAL_COMPLETION_COST_PER_1K_TOKENS` ile hesaplanıyor, ikisi de varsayılan `0` (self-hosted kurulumda gerçek bir fatura yok).

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
- [x] `rerankFetchK` A/B — kendi ölçeğinde (`RERANK_THRESHOLD=0.1`, 4. maddedeki düzeltmeyle) `fetchK ∈ {3, 5, 10, 20}` tarandı. Sonuç ve öneri aşağıda.
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

### `rerankFetchK` A/B (66 vaka, bge-small dışı — `.env` varsayılanı nomic-embed-text + reranker, kendi ölçeğinde `RERANK_THRESHOLD=0.1`)

Aday havuzu (`fetchK`), reranker'a giren ve `topK=3`'e kesilmeden önceki chunk sayısı. Dört değer,
aynı 66 vakalık set üzerinde ayrı koşumlar:

| fetchK | P@k | R@k | MRR | hitRate | snippet | multi-source R@k | multi-source snippet | retrieval latency |
|---|---|---|---|---|---|---|---|---|
| 3 (= topK, aday havuzu yok) | 87.6% | 94.1% | 0.961 | 98.0% | 89.2% | 60.0% | 70.0% | 276ms |
| 5 | 92.2% | 97.1% | 0.990 | 100.0% | 98.0% | 70.0% | 80.0% | 418ms |
| **10 (mevcut `.env`)** | 88.9% | 98.0% | 0.990 | 100.0% | 99.0% | 80.0% | 90.0% | 794ms |
| 20 (kod varsayılanı) | 88.2% | 99.0% | 0.990 | 100.0% | 99.0% | **90.0%** | 90.0% | 1501ms |

`falseRetrievalRate` dört koşumda da **%46.7** — sabit. `fetchK` sadece reranker'ın *neyi
görebildiğini* değiştiriyor; cevapsız sorularda eşiği geçip geçmeme kararı chunk sayısından değil
skorun kendisinden geliyor, dolayısıyla bu metrik `fetchK`'nin etki alanı dışında.

Üç bulgu:

1. **`fetchK=3` (aday havuzu yok, reranker yalnızca zaten seçilmiş 3 chunk'ı yeniden sıralıyor)
   ölçülebilir şekilde en kötüsü** — hitRate %98'e düşüyor, gate'lerin 4'ü kırılıyor
   (`snippetCoverage`, `golden.snippetCoverage`, `multi-source.recallAtK`,
   `distractor.mrr`). Reranker'ın işe yaraması için vektör aramasının ona gerçek bir aday
   havuzu sunması gerekiyor — kendi başına yeniden sıralamak yetmiyor.
2. **`fetchK=5`'ten `fetchK=20`'ye kazanç neredeyse tamamen `multi-source.recallAtK`'te**
   (%70 → %90); tek-kaynaklı metrikler (`hitRate`, `MRR`) `fetchK=5`'te zaten tavan yapmış
   durumda. Bunun sebebi basit: çok kaynaklı bir soru iki farklı belgeden chunk gerektiriyor,
   dar bir aday havuzu bu iki belgenin ikisini birden vektör aramasından geçiremeyebiliyor.
3. **Latency `fetchK` ile ~doğrusal büyüyor** (276→418→794→1501ms) — cross-encoder her adayı
   tek tek skorluyor, dolayısıyla `fetchK` doğrudan reranker'a yapılan çağrı sayısı.

**Sonuç: `.env`'deki `RERANK_FETCH_K=10` iyi bir orta nokta.** `fetchK=20`'ye kıyasla
multi-source recall'da 10 puan (`%80` vs `%90`) veriyor ama latency'nin yarısında
(`794ms` vs `1501ms`); `fetchK=5`'e kıyasla latency'nin ~2 katını harcayıp multi-source
recall'da 10 puan daha kazanıyor. Kod varsayılanı (`config.ts`) `20` olarak bırakıldı —
çok kaynaklı trafiğin ağırlıklı olduğu bir kurulum için doğru seçim hâlâ o — ama `.env`'in
`10`'da durması, latency'ye duyarlı bir kurulum için gerekçeli bir taviz, rastgele bir sayı
değil.

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

> **Bu sıfır noktası da 4. maddede geçersiz kılındı.** Buradaki `21 chunk`, başlık farkında
> olmayan salt karakter-bazlı chunklamadan geliyor. 4. maddede eklenen bölüm-yolu metadata'sı
> chunk sınırlarını da değiştirdi (`21 → 35`), dolayısıyla bu tablo ve bu bölümdeki reranker
> A/B'si artık **farklı bir pipeline'ın** anlık görüntüsü — yön olarak geçerli, sayı olarak
> değil. Güncel sayı için 4. maddenin "Başlık/bölüm yolu metadata'sı" alt bölümüne bakın.

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

> ⚠️ **Bu bölümdeki sonuç 4. maddede geçersiz çıktı.** Aşağıdaki A/B, reranker'ı kosinüs
> ölçeğinden ödünç alınan `0.45` eşiğiyle ölçüyor — yani tam olarak 2. maddedeki 1 numaralı
> uyarının tarif ettiği hata. Kendi ölçeğindeki doğru eşikte (`0.1`) reranker recall
> kaybetmiyor; her retrieval metriğinde kosinüsü yeniyor. Doğru tablo 4. maddede.

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

~~**Reranker artık bedava değil: precision'ı recall ile satın alıyor.**~~ Bu yorum yanlıştı ve
sebebi 2. maddedeki 1 numaralı uyarının ta kendisi: yukarıdaki `0.45`, kosinüs ölçeğine ait bir
sayı ve cross-encoder olasılığına uygulanınca çok fazla chunk kesiyor. 4. maddede kendi ölçeğinde
süpürüldüğünde reranker `0.1`'de hiç recall kaybetmiyor (hit %100, multi-source recall %90) —
yani kayıp reranker'ın değil, eşiğin. Doğru tablo 4. maddede.

Yine de bu koşumdan geçerli kalan bir şey var: **reranker agresif keser.** `0.45`'te
cevaplanabilir sorularda ortalama 1.14 chunk tutuyor ve dört vakada doğru belgeyi tamamen
düşürüyor. 2. maddedeki 2 numaralı uyarı (tutulan chunk sayısının düşmesi) bu anlamda
**doğrulandı** — ama sonucu eşikle yönetilebilir bir davranış, kalıcı bir kayıp değil.

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

- [x] **`RETRIEVAL_THRESHOLD`'u skor ölçeğinden bağımsız hâle getir.** Ayrı eşik seçildi: `RETRIEVAL_THRESHOLD` kosinüs benzerliğini, yeni `RERANK_THRESHOLD` cross-encoder olasılığını derecelendiriyor. Normalizasyon değil ayrı eşik, çünkü iki skor farklı şeyleri ölçüyor — birini diğerine haritalamak uydurma bir denklik yaratırdı. Orchestrator hangi eşiği uygulayacağını **reranker'ın gerçekten çalışıp çalışmadığına** göre seçiyor (yapılandırıldığına göre değil): reranker hata alıp vector order'a düştüğünde geride kosinüs skorları kalıyor, oraya cross-encoder eşiğini uygulamak sessizce yanlış birim olurdu. `/query` yanıtı artık hangi ölçekte olduğunu `scoreScale` ile bildiriyor.
- [x] **Embedding modeli karşılaştırması yap.** bge-small (yerel GGUF) vs nomic-embed-text (Ollama), her biri kendi eşik süpürmesiyle. Sonuç ve — daha önemlisi — sonucun sınırı aşağıda.
- [x] Reranker açıkken cevaplanabilir sorularda tutulan chunk sayısının 1.00'e düşmesini çok kaynaklı vakalarla sına (2. maddeden devreden uyarı). **Doğrulandı**: 3. maddedeki A/B'de reranker cevaplanabilir sorularda ortalama 1.14 chunk tutuyor ve dört vakada doğru belgeyi tamamen düşürüyor. Kalan iş bu maddede: eşiği reranker moduna göre ayarlamak ve `topK`'yi çok kaynaklı sorular için yeniden değerlendirmek.
- [x] Karakter yerine token odaklı chunk boyutlarını değerlendirme altyapısına ekle. Yeni `CHUNK_UNIT=tokens` (varsayılan `characters`), `RecursiveCharacterTextSplitter`'ın `lengthFunction`'ına cl100k_base token sayacı veriyor (`chunkers/token-length.ts`) — bölme mantığı (paragraf/cümle/kelime sınırlarında recursive kesme) aynı kalıyor, yalnızca "ne kadar" ölçüsü değişiyor. Hem ingestion hem eval aynı `config.chunkUnit`'i kullanıyor, dolayısıyla eval production'ın gerçekten yaptığını ölçüyor. Yan bulgu: `chunker.ts`'teki `import uuid from 'uuid'` default import'u vitest/ESM altında kırıktı (uuid'nin default export'u yok) — hiçbir mevcut test `chunk()`'ı gerçekten çağırmadığı için yakalanmamıştı; `import { v4 } from 'uuid'`'a çevrildi.
- [x] Chunk boyutu × overlap ızgarasını eval setinde tara (2. maddedeki düzeltmenin üstüne ince ayar). Sonuç ve sınırı aşağıda.
- [x] Başlık, alt başlık ve bölüm yolunu çıkarıp her chunk metadata'sına koy. Sonuç, yan bulgu (bir metin-işleme hatası) ve ölçülen etki aşağıda.
- [x] Chunk metnine gerektiğinde bölüm bağlamı ekle. `CHUNK_INCLUDE_SECTION_CONTEXT` olarak eklendi — varsayılan **kapalı**, gerekçe aşağıda: bu corpus'ta ölçülen etki iyileştirme değil bozulma.
- [x] PDF'lerde sayfa bazlı bölme ile genel PDF handler kullanımını netleştir. Bulgu ve yapılan değişiklik aşağıda.
- [x] **Query tarafı iyileştirmelerini değerlendir**: query rewriting, multi-query, HyDE. Üçü de uygulandı (`src/core/rag/query/`, `QUERY_STRATEGY` env). Ölçüm ve öneri aşağıda.
- [x] Farklı stratejileri eval sonuçlarıyla karşılaştır ve kazananı gerekçesiyle kaydet. Eşik, embedding, chunking (2/3/4. maddeler) ve şimdi query stratejileri (aşağıda) için yapıldı — liste artık tamamen kapalı.

### Eşik süpürmesi: kosinüs eşiği zayıf bir alet

66 vaka, k=3, reranker kapalı. Her satır ayrı bir tam koşum:

| Eşik | bge P@k | bge hit | bge falseRetr | nomic P@k | nomic hit | nomic falseRetr |
|---|---|---|---|---|---|---|
| 0.35 (varsayılan) | 53.6% | 100.0% | 100.0% | 54.2% | 100.0% | 100.0% |
| 0.45 | 56.2% | 100.0% | 100.0% | 57.2% | 100.0% | 100.0% |
| 0.50 | 58.8% | 100.0% | 93.3% | 62.1% | 100.0% | 93.3% |
| 0.55 | 61.8% | 98.0% | 86.7% | 68.3% | 96.1% | 93.3% |
| 0.60 | 65.7% | 98.0% | 86.7% | 69.0% | 86.3% | 60.0% |
| 0.65 | – | – | – | 65.4% | 72.5% | 33.3% |

**Varsayılan `0.35` fiilen hiçbir şey yapmıyor** — tüm skor bandının altında. Ve daha önemlisi:
hiçbir kosinüs eşiği, recall'u yıkmadan false retrieval'ı anlamlı biçimde kesemiyor. bge'de
%60 eşikte bile 15 cevapsız sorunun 13'ü hâlâ chunk getiriyor; nomic'te %33'e inmek hit
rate'in %72.5'e düşmesine mal oluyor. **Kosinüs skoru "yakın" ile "cevabı taşıyor"u ayırt
etmiyor.** Varsayılan yine de değiştirilmedi: kazanç marjinal ve modele bağlı, asıl kaldıraç
aşağıda.

### Cross-encoder eşiği: 3. maddedeki sonucu geçersiz kılıyor

Aynı set, bge-small + reranker, kendi ölçeğinde süpürüldü:

| Eşik | P@k | R@k | MRR | hit | snippet | falseRetr | multi-source R@k |
|---|---|---|---|---|---|---|---|
| 0.02 | 81.4% | **100.0%** | **0.990** | **100.0%** | **98.0%** | 80.0% | **100.0%** |
| 0.05 | 84.6% | **100.0%** | **0.990** | **100.0%** | **98.0%** | 66.7% | **100.0%** |
| **0.10** | 88.2% | 99.0% | **0.990** | **100.0%** | 97.1% | 33.3% | 90.0% |
| 0.20 | 91.2% | 96.1% | 0.971 | 98.0% | 94.1% | 20.0% | 80.0% |
| 0.45 | 89.2% | 91.2% | 0.912 | 92.2% | 89.2% | 13.3% | 70.0% |

3. maddede reranker'ı `0.45`'te ölçmüştüm — kosinüs ölçeğinden ödünç alınmış bir sayı. Tablonun
son satırı o koşum. **"Reranker precision'ı recall ile satın alıyor" sonucu bir eşik
artefaktıymış.** Kendi ölçeğinde `0.1`'de reranker, kosinüs baseline'ını **her** retrieval
metriğinde yeniyor:

| | kosinüs @0.45 | reranker @0.1 |
|---|---|---|
| P@k | 56.2% | **88.2%** |
| R@k | 98.0% | **99.0%** |
| MRR | 0.928 | **0.990** |
| hit | 100.0% | 100.0% |
| snippet | **98.0%** | 97.1% |
| falseRetrievalRate | 100.0% | **33.3%** |
| multi-source R@k | 80.0% | **90.0%** |

`RERANK_THRESHOLD` varsayılanı bu yüzden **0.1**: hit rate tam, recall neredeyse tam, false
retrieval üçte birine iniyor. Daha agresif eşik isteyen (cevapsız trafiğin baskın olduğu
kurulum) 0.2'ye çıkabilir, bedeli multi-source recall.

Bu aynı zamanda 2. maddedeki 1 numaralı uyarının doğrulanması: o A/B'deki `falseRetrievalRate`
kazancının **tamamı** ölçek artefaktıydı.

### Embedding karşılaştırması: kazanan var, ama dar bir koşulda

Reranker **kapalıyken**, her model kendi en iyi çalışma noktasında:

| | bge-small (yerel GGUF, 36 MB) | nomic-embed-text (Ollama, 274 MB) |
|---|---|---|
| MRR | 0.928 | **0.944** |
| hit | 100.0% | 100.0% |
| snippet | **98.0%** | 97.1% |
| multi-source R@k | 80.0% | **90.0%** |
| skor dağılımı | dar (eşik işe yaramıyor) | **geniş (eşik ayarlanabilir)** |
| retrieval latency | **~19ms** (in-process) | ~25ms (HTTP) |

**nomic-embed-text kazanıyor** — MRR ve çok kaynaklı recall'da önde, ve skorları eşik
ayarlanabilecek kadar yayılıyor. Repo varsayılanı zaten bu, yani karar mevcut varsayılanı
doğruluyor.

**Ama sonucun sınırı şu:** reranker açıkken iki model **birebir aynı** sonucu veriyor
(P@k 88.2%, MRR 0.990, snippet 97.1% — her ikisi için de). Aday havuzunu `fetchK=5`'e daraltıp
tekrar denedim, fark yine ihmal edilebilir (P@k 89.2% vs 90.2%). Sebep: 21 chunk'lık store'da
reranker aday havuzunun neredeyse tamamını görüyor ve embedding'in sıralamasını tamamen eziyor.
Yani **embedding seçimi yalnızca reranker'sız yolda ölçülebiliyor**; önerilen konfigürasyonda
(reranker açık) bu corpus embedding modelleri arasında ayrım yapamıyor. "Fark yok" değil,
"bu sette fark ölçülemez" — gerçek bir ayrım için daha büyük bir store gerekiyor.

Yan bulgu: `fetchK` 20 → 5 düşünce yalnızca multi-source recall %90 → %80 geriliyor, gerisi
sabit — burada gözlemlenen bu daralma, embedding modelleri arasındaki farkı örtüyor.
`fetchK`'nin kendi başına tam etkisi (3, 5, 10, 20 taraması, latency dahil) artık 2. maddede.

### Chunk boyutu × overlap ızgarası: reranker burada da farkı örtüyor

Önerilen konfigürasyonun tamamıyla (nomic-embed-text, reranker açık, `RERANK_THRESHOLD=0.1`),
66 vaka, 8 kaynak belge (691–3207 karakter). İki ayrı 1B tarama — chunk boyutu, overlap'i
kendi `%15`'inde sabit tutarak; sonra overlap, boyutu `1000`'de sabit tutarak:

**Chunk boyutu** (overlap = boyutun %15'i):

| chunkSize/overlap | chunk sayısı | P@k | R@k | MRR | hit | snippet | multi-source R@k |
|---|---|---|---|---|---|---|---|
| 300/45 | 78 | 91.5% | 99.0% | 0.990 | 100.0% | 92.2% | 90.0% |
| 500/75 | 43 | 87.9% | 97.1% | 0.971 | 98.0% | 93.1% | 90.0% |
| 750/112 | 30 | 89.5% | 99.0% | **1.000** | 100.0% | 99.0% | 90.0% |
| **1000/150 (mevcut)** | 21 | 88.9% | 98.0% | 0.990 | 100.0% | 99.0% | 80.0% |
| 1500/225 | 17 | 86.9% | **100.0%** | 0.990 | 100.0% | **100.0%** | **100.0%** |
| 2000/300 | 13 | 88.2% | 99.0% | 0.990 | 100.0% | 99.0% | 90.0% |

**Overlap** (chunkSize = 1000 sabit):

| overlap | chunk sayısı | P@k | R@k | MRR | hit | snippet | multi-source R@k |
|---|---|---|---|---|---|---|---|
| 0 | 21 | 88.9% | 98.0% | 0.990 | 100.0% | 97.1% | 80.0% |
| 75 | 21 | 89.5% | 98.0% | 0.990 | 100.0% | 97.1% | 80.0% |
| **150 (mevcut)** | 21 | 88.9% | 98.0% | 0.990 | 100.0% | 99.0% | 80.0% |
| 200 | 22 | 86.9% | 97.1% | 0.971 | 98.0% | 97.1% | 90.0% |
| 300 | 24 | 92.2% | 99.0% | 0.990 | 100.0% | 98.0% | 90.0% |
| 500 (%50) | 30 | 91.8% | **100.0%** | **1.000** | 100.0% | 99.0% | **100.0%** |

Üç okuma:

1. **Tek-kaynaklı metrikler (`hitRate`, `MRR`, `P@k`) ızgara boyunca esasen düz** — %87–92
   P@k, %98–100 hit bandında dalgalanıyor, monoton bir trend yok. Bu, embedding
   karşılaştırmasındaki bulgunun tekrarı: **reranker açıkken chunk sınırlarının etkisi de
   büyük ölçüde örtülüyor** — cross-encoder aday havuzunu zaten yeniden puanlıyor, chunk'ın
   nereden kesildiği kadar önemli değil.
2. **Gerçek sinyal `multi-source.recallAtK`'te** — ama set 5 vakadan oluşuyor, yani her puan
   %20'lik bir vaka. `overlap=150→300` ve `overlap=300→500` arası %80→%90→%100 artışı, tek
   tek vakaların eşiği geçmeye başlamasıyla açıklanabilir; büyük chunk'ların (1500, overlap
   %50) iki belgeyi aynı chunk'a düşürme ihtimalinin artması fiziksel olarak makul, ama
   **5 vakalık bir örneklemden kalıcı bir eğri çıkarmak iddialı olur.**
3. **Chunk sayısı işletme maliyeti olarak gerçek bir eksen** — `300/45` 78 chunk üretiyor
   (aynı 15KB corpus için `2000/300`'ün 6 katı), yani ~6 kat daha fazla embedding çağrısı ve
   vektör kaydı, retrieval kalitesinde ölçülebilir bir kazanç karşılığı olmadan.

**Sonuç: mevcut `CHUNK_SIZE=1000`/`CHUNK_OVERLAP=150` ızgarada en kötü nokta değil, ama en
iyisi de değil.** `multi-source.recallAtK`'i tutarlı biçimde iyileştiren tek değişken overlap
oranı — `overlap=300` (chunkSize'ın %30'u, mevcut %15'in iki katı), chunk sayısını
21'den 24'e (~%15) çıkarma bedeliyle multi-source recall'u %80'den %90'a taşıyor, diğer
metriklerde de kayıp yok. `overlap=500` (%50) tavana çıkarıyor ama chunk maliyetinin
neredeyse yarım katını fazladan ödetiyor, o son 10 puan için gerekçesi zayıf. **Öneri:
`CHUNK_OVERLAP`'i `150`'den `300`'e çıkarmayı düşün; `CHUNK_SIZE`'ı bu corpus'ta değiştirmeye
gerek yok** — ızgara boyunca kazanç yok, kayıp da yok, dolayısıyla varsayılan kalabilir.

Bu bulgu embedding karşılaştırmasıyla aynı sınırı taşıyor: **reranker açıkken ölçülen, chunking
kararının "nihai sonuca" etkisi**, ham retrieval'a etkisi değil. Reranker'sız yolda (fallback
skorlama, ya da reranker'ın hiç olmadığı bir kurulum) chunk boyutunun etkisi muhtemelen daha
büyük görünür — bu aynı ızgara reranker kapalıyken henüz taranmadı.

### Önerilen konfigürasyon

```
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=nomic-embed-text
RERANK_ENABLED=true
RERANK_MODEL_PATH=./models/hf_gpustack_bge-reranker-v2-m3.Q4_K_M.gguf
RERANK_THRESHOLD=0.1
RETRIEVAL_THRESHOLD=0.5     # reranker devre dışı kalırsa geçerli olan yedek
```

Kabul kriteri: En iyi konfigürasyon eval setinde baseline'a göre retrieval metriklerini korur veya iyileştirir; chunk tek başına okunabilir kalır; latency/maliyet regresyonu kabul edilebilir sınırda.

### Başlık/bölüm yolu metadata'sı: yapı algılama, bir yan-bulgu ve ölçülen etki

Her chunk'a artık `heading` (en yakın başlık) ve `sectionPath` (kök başlıktan itibaren tam yol,
`" > "` ile ayrılmış — örn. `"2. Components > 2.1 Kestrel collector"`) ekleniyor
(`chunkers/section-splitter.ts`). Başlık tespiti markup'a değil **yapıya** dayanıyor: bir
satır, kendi başına bir paragraf oluşturuyorsa (öncesinde ve sonrasında boş satır ya da
belge sınırı var) ve cümle noktalamasıyla bitmiyorsa başlık sayılıyor — bir gövde paragrafı,
tek satırlık olsa bile, nokta/virgül/noktalı virgül/iki nokta ile biter; başlık bitmez. Bu,
`DefaultTextProcessor`'ın kendi ihtiyatlı yaklaşımıyla aynı ruhta: emin olmadığı iki bölümü
asla birleştirmiyor. Numaralı anahat varsa (`"2.1 Foo"`, `"2 Bar"`'dan bir seviye derin)
derinlik ondan çıkarılıyor; numarasız başlıklar (bir ADR'nin "Context"/"Decision"/
"Consequences"'ı gibi) her zaman aynı düzeyde kardeş kabul ediliyor — iç içelik bilgisi yok,
bu bir eksiklik değil doğru okuma. Belge önce bu yapıya göre bölümlere ayrılıyor, her bölümün
gövdesi ayrı ayrı chunklanıyor (bir chunk artık asla iki farklı başlığın altındaki metni
karıştırmıyor), `chunk`/`totalChunks` metadata'sı sonra tüm belge genelinde yeniden
numaralanıyor.

**Yan bulgu: `DefaultTextProcessor.fixLineBreaks` tüm boş satırları yutuyordu.** Bu metot
PDF'lerden çıkan cümle-içi zorla-sarılmış satırları birleştirmek için var
(`"metin\nkalanı"` → `"metin kalanı"`), ama regex'in negatif geriye-bakışı yalnızca
`[.!?:]`'yi hariç tutuyordu, `\n`'i değil — sonuç olarak her `\n\n` çiftinin **ikinci**
`\n`'i de "noktalamadan sonra gelmeyen bir `\n`" sayılıp boşluğa çevriliyordu. Yani
`TextFileHandler`'dan (ve aynı işlemciyi kullanan HTML/PDF handler'larından) geçen her metinde
paragraf sınırları sessizce yok oluyordu — bir başlık algılayıcısının dayandığı tam olarak o
sinyal. Düzeltme tek satır: geriye-bakışa `\n`'i de eklemek (`(?<![.!?:\n])`). Bu olmadan
başlık/bölüm-yolu özelliği, bu commit'te eklenen tüm testler yeşil görünse de (testler ham
metin üzerinde çalışıyordu, `TextFileHandler`'ın işlediği metin üzerinde değil) production'da
**hiçbir** `.txt`/`.md`/HTML belgesinde çalışmazdı — yalnızca gerçek corpus üzerinden uçtan uca
doğrulama (`ChromaVectorStore`'a yazılan metadata'yı sorgulamak) bunu ortaya çıkardı.

**Ölçülen etki** (önerilen konfigürasyon: nomic-embed-text, reranker açık,
`RERANK_THRESHOLD=0.1`, 66 vaka, 8 kaynak):

| | Düzeltme öncesi (chunk sınırları başlıktan bağımsız) | Düzeltme sonrası (chunk sınırları bölüme saygılı) |
|---|---|---|
| chunk sayısı | 21 | 35 |
| P@k | 88.9% | 85.3% |
| R@k | 98.0% | 97.1% |
| MRR | 0.990 | 0.971 |
| hitRate | 100.0% | 98.0% |
| snippetCoverage | 99.0% | 97.1% |
| falseRetrievalRate | 46.7% | **33.3%** |
| `regression` etiketi (17 vaka) | değişmedi | hitRate/R@k/MRR/snippet hepsi %100 — **etkilenmedi** |

Küçük ama gerçek bir kayıp var: bölüme saygılı chunklama daha küçük, daha topik-saf parçalar
üretiyor (35 vs 21), bu da birkaç vakada tam eşleşen chunk'ı biraz daha zor buluyor. Karşılığında
`falseRetrievalRate` üçte bir oranında iyileşiyor — daha küçük, daha saf chunk'lar cevapsız
sorularda daha az yanlışlıkla eşiği geçiyor. `regression` etiketi (orijinal genel-kültür
sorular) tamamen etkilenmedi — kayıp yalnızca yapılandırılmış Corvus corpus'unda. **`eval/gates.json`'daki 11 gate'in hepsi hâlâ geçiyor**, dolayısıyla bu bir regresyon değil, kabul
edilebilir bir taviz olarak kaydedildi.

**Önemli:** bu maddedeki ve yukarıdaki (eşik süpürmesi, embedding karşılaştırması, fetchK,
chunk boyutu × overlap) tüm tablolar bu düzeltmeden **önceki** 21-chunk'lık pipeline'da
ölçüldü — o zaman chunk sınırları tamamen karakter bazlıydı, başlık farkında değildi. Bu
tablolar artık farklı bir pipeline'ın anlık görüntüsü; yön olarak hâlâ geçerliler (reranker
kazanıyor, eşik ölçeği önemli, vb.) ama üzerlerine yeni bir sayısal karşılaştırma inşa
edilecekse önce mevcut (35-chunk, başlık-farkında) pipeline'da yeniden ölçülmeleri gerekir.

### Chunk metnine bölüm bağlamı: ölçüldü, varsayılan kapalı kaldı

Önceki alt bölüm chunk **metadata**'sına `heading`/`sectionPath` ekledi (programatik kullanım
için — filtreleme, UI'da kaynak gösterimi). Bu madde farklı bir şey soruyor: aynı bilgi chunk'ın
**metnine** de eklensin mi — yani embedding modelinin ve LLM'in gördüğü şeyin parçası olsun mu?
Bu, Anthropic'in "contextual retrieval" tekniğinin küçük ölçekli hâli: her chunk'ın başına kendi
bölüm yolunu (`"2. Components > 2.1 Kestrel collector"`) ekleyip öyle embed etmek.

`CHUNK_INCLUDE_SECTION_CONTEXT=true` olarak uygulandı (`ingestion.ts:withSectionContext`) ve
gerçek corpus'ta ölçüldü — sonuç beklenenin tersi:

| Metrik | Kapalı (varsayılan) | Açık |
|---|---|---|
| hitRate | **98.0%** | 96.1% |
| MRR | **0.971** | 0.951 |
| R@k | **97.1%** | 96.1% |
| snippetCoverage | **97.1%** | 96.1% |
| falseRetrievalRate | **33.3%** | 46.7% |
| multi-source R@k | **90.0%** | 80.0% |

Her retrieval metriğinde **açık** olan kayıp — kazanç yok. İki kez tekrarlanan koşumda birebir
aynı sayılar çıktı (deterministik, gürültü değil). Muhtemel sebep: bu corpus'taki chunk'lar
zaten küçük ve tek-konulu (bölüm başına 200-450 karakter); başlık metnini öne eklemek,
embedding'in ayırt edici gücünü chunk'ın kendi içeriğinden çalıp aynı belgenin başlık
kelimelerine (`"Components"`, `"Corvus"` vb.) kaydırıyor — bu kelimeler aynı dokümanın birçok
chunk'ında ortak, dolayısıyla ayırt etmek yerine birbirine benzetiyor. Anthropic'in orijinal
sonucu büyük, çok-belgeli corpus'larda LLM-üretimi zengin bağlam özetleriyle ölçülmüştü; küçük
bir corpus'ta basit bir breadcrumb aynı kazancı vermiyor.

**Karar: varsayılan kapalı kalsın.** Özellik var ve çalışıyor (`heading`/`sectionPath`
metadata'sı bu bayraktan bağımsız her zaman ekleniyor), ama bu corpus'taki ölçüm onu
varsayılan yapmayı haklı çıkarmıyor. Daha büyük veya daha çeşitli belgeli bir corpus'ta farklı
sonuç verebilir — açmak isteyen bunu kendi corpus'unda ölçüp karar vermeli.

### PDF handler: iki tane vardı, biri hiç kullanılmıyordu

"Netleştirme" ihtiyacı gerçekmiş: repoda iki PDF handler vardı —
`PdfFileHandler` (bütün belgeyi tek bir metin bloğu olarak çıkarır) ve `PdfPageFileHandler`
(her sayfayı ayrı bir `Document` olarak çıkarır, `page` numarasıyla etiketler).
`registerFileHandlers` çağrılarını grep'ledim (`app.ts`, `eval.ts`): **`application/pdf` her
ikisinde de `PdfPageFileHandler`'a bağlanıyor**, `PdfFileHandler` hiçbir yerde kayıtlı değil —
yalnızca kendi dosyasından export ediliyordu, ne bir test ne bir doküman referansı vardı.
Git geçmişi de bunun bir "eski sürüm" olmadığını, ikisinin de ilk commit'te birlikte
eklendiğini ama yalnızca sayfa-bazlı olanın hiç kullanılmadığını gösteriyor.

**Yapılan:** kullanılmayan `pdf-file-handler.ts` silindi, export listesinden çıkarıldı.
`PdfPageFileHandler` artık tek PDF handler ve neden sayfa-bazlının tercih edildiği (sayfa
numarasıyla kesin alıntı, büyük dosyada tek `getText()` çağrısının maliyetini sınırlama)
kod içinde belgelendi.

**Belgelenen bir etkileşim:** `RagDataIngestor`, `splitIntoSections`'ı her `Document` için ayrı
ayrı çalıştırıyor — PDF'lerde bu, her SAYFA için ayrı demek. Bir başlığın gövdesi sayfa
sınırını aşarsa, aynı başlık yolu altında iki ayrı bölüm olarak görünür (metin kaybolmaz,
yalnızca "bu gövde önceki sayfadan devam ediyor" bilgisi taşınmaz) — `CHUNK_SIZE`'ın zaten
yaptığı keyfi-sınır ödününün sayfa hizalı hâli. Bu, kod yorumunda belgelendi; ayrı bir kod
değişikliği gerektirmiyor, davranışın bilinmesi gereken bir sınırı.

### Query tarafı: üç strateji uygulandı, üçü de ölçüldü — kazanan yok

Liste 4. maddeye kadar tamamen ingestion odaklıydı (chunking, embedding, reranking); sorgu
tarafı hiç dokunulmamıştı. Üç strateji `src/core/rag/query/` altında eklendi, `QUERY_STRATEGY`
env değişkeniyle seçiliyor:

- **`rewrite`** — LLM soruyu tek, temiz bir arama ifadesine dönüştürüyor (kısaltmaları açma,
  sohbet dolgusunu atma).
- **`multi-query`** — LLM sorunun 3 farklı ifadesini üretiyor, hepsi aranıyor, `id` bazında
  en iyi skor tutularak birleştiriliyor (`rag-orchestrator.ts:mergeSearchResults` — eval bunu
  aynen yeniden kullanıyor, kendi kopyasını yazmıyor).
- **`hyde`** — LLM soruya cevap verecek varsayımsal bir pasaj yazıyor, o pasaj embed ediliyor
  (soru değil) — fikir, bir sorunun embedding'i cevabın embedding'inden yapısal olarak uzak
  olduğu için, cevap-biçimli bir metnin daha yakın olması.

Her üçü de başarısız olursa (LLM'e ulaşılamaz, JSON parse edilemez) ham soruya düşüyor —
sorguyu asla başarısız etmiyor.

**Ölçüm ve dürüst sınırı:** tam 66 vakalık koşum, her strateji için soru başına en az bir LLM
çağrısı gerektirdiğinden (retrieval-only bir koşumda bile) donanımı fazla ısıttı ve yarıda
kesildi. Bunun yerine 12 vakalık temsili bir alt kümede (spec/support/multi-source/near-corpus/
out-of-scope/indirect/regression karışımı, önerilen konfigürasyon: nomic + reranker) dört
strateji karşılaştırıldı:

| Strateji | P@k | R@k | MRR | hit | snippet | retrieval latency |
|---|---|---|---|---|---|---|
| **none (varsayılan)** | 83.3% | 100.0% | 0.944 | 100.0% | 100.0% | **575ms** |
| rewrite | 83.3% | 100.0% | 0.944 | 100.0% | 100.0% | 6890ms |
| multi-query | 83.3% | 100.0% | 0.944 | 100.0% | 100.0% | 5367ms |
| hyde | 81.5% | 100.0% | 0.944 | 100.0% | **88.9%** | 4924ms |

`rewrite` ve `multi-query`, `none` ile **her retrieval metriğinde birebir aynı** — bu küçük
corpus'ta ve zaten doğrudan-ifadeli sorularda hiçbir şey kazandırmıyorlar. `hyde` ise ölçülebilir
şekilde **kötüleşiyor** (snippet %100→%88.9). Kazanan taraf yalnızca latency'de belirgin: her
üç strateji de tek bir ekstra LLM çağrısı yüzünden retrieval süresini **9-12 kat** artırıyor
(575ms → 5-7 saniye) — generation'ın kendisi henüz eklenmeden.

12 vaka, 66'nın altıda biri; tek bir vakanın kayması ~%8'lik bir puan demek, dolayısıyla bu
sayılar 1-4. maddelerin tam-set koşumlarıyla aynı güvenilirlikte değil — yön güçlü (hiçbir
strateji tek bir metrikte bile `none`'ı **geçmedi**, hyde açıkça geride), mutlak sayı yönelim.

**Sonuç ve gerekçe: `QUERY_STRATEGY` varsayılanı `none` kalsın.** Bu corpus küçük (8 belge) ve
sorular çoğunlukla doğrudan ifadeli; üç strateji de bu tür bir corpus'ta çözecek bir problem
bulamıyor — kazandıkları hiçbir kalite artmadan gelen saf gecikme maliyeti. Daha büyük,
çeşitli-vocabulary'li bir corpus'ta veya sorgular gerçekten dolaylı/kötü-ifadeliyse tablo
değişebilir; kod her üç stratejiyi de destekliyor, açmak isteyen kendi corpus'unda ölçüp karar
vermeli — tıpkı `CHUNK_INCLUDE_SECTION_CONTEXT` için yapılan öneri gibi.

## 5. Metadata, sürümleme ve tekilleştirme

- [ ] Standart metadata şeması tanımla: `sourceUrl`, `title`, `sectionPath`, `version`, `updatedAt`, `language`, `documentType`, `accessLevel`. (`sectionPath` ve `heading` 4. maddede eklendi — chunk'larda artık `source`, `chunk`, `totalChunks`, `tenantId`, `heading`, `sectionPath` ve PDF'lerde `page` var. Kalan alanlar: `sourceUrl`, `title`, `version`, `updatedAt`, `language`, `documentType`, `accessLevel`.)
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
