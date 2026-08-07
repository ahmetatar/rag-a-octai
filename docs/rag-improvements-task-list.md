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
- [ ] Karakter yerine token odaklı chunk boyutlarını değerlendirme altyapısına ekle.
- [ ] Chunk boyutu × overlap ızgarasını eval setinde tara (2. maddedeki düzeltmenin üstüne ince ayar).
- [ ] Başlık, alt başlık ve bölüm yolunu çıkarıp her chunk metadata'sına koy.
- [ ] Chunk metnine gerektiğinde bölüm bağlamı ekle.
- [ ] PDF'lerde sayfa bazlı bölme ile genel PDF handler kullanımını netleştir.
- [ ] **Query tarafı iyileştirmelerini değerlendir**: query rewriting, multi-query, HyDE. Liste bu noktaya kadar tamamen ingestion odaklı; sorgu tarafı ölçülmeden bırakılmamalı.
- [ ] Farklı stratejileri eval sonuçlarıyla karşılaştır ve kazananı gerekçesiyle kaydet. (Eşik ve embedding için yapıldı — aşağıya bakın; chunking ve query stratejileri için açık.)

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
sabit. 2. maddede ölçülemez denen `rerankFetchK` A/B'si böylece kısmen yanıtlandı: bu boyutta
etkisi küçük ama sıfır değil.

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
