# Metrikler ve Env Değişkenleri

Bu doküman iki şeyi listeler: eval harness'in (`npm run eval`, `src/core/rag/eval/`) ve
production'ın (`/metrics`) ürettiği tüm ölçülebilir metrikler, ve hangi env değişkeninin
hangi metrikleri etkilediği. Ölçülmüş değerler için bkz.
[rag-improvements-task-list.md](rag-improvements-task-list.md) ve
[EVAL_AND_RERANKING.md](EVAL_AND_RERANKING.md).

## 1. Ölçülebilir metrikler

### Retrieval metrikleri (cevaplanabilir vakalarda ölçülür)

| Metrik | Ne ölçer | Kaynak |
|---|---|---|
| `precisionAtK` | topK içindeki chunk'ların kaçı gerçekten alakalı kaynaktan | `metrics.ts:precisionAtK` |
| `recallAtK` | Beklenen kaynakların kaçı topK içine girdi | `metrics.ts:recallAtK` |
| `mrr` (reciprocalRank ortalaması) | Doğru chunk kaçıncı sırada geldi (1/rank) | `metrics.ts:reciprocalRank` |
| `hitRate` | En az bir doğru kaynak topK'ya girdi mi (0/1) | `metrics.ts:hitAtK` |
| `snippetCoverage` | Doğru **pasaj** (dosya değil, cümle parçası) getirildi mi | `metrics.ts:snippetCoverage` |

### Cevap kalitesi metrikleri (generation açıkken)

| Metrik | Ne ölçer |
|---|---|
| `keywordCoverage` | Cevapta beklenen anahtar bilgilerin kaçı geçiyor |
| `groundedness` | Cevabın kelime-trigram'larının kaçı getirilen chunk'larda var (kaynağa sadakat proxy'si) |

### Abstention / hallucination metrikleri

| Metrik | Ne ölçer |
|---|---|
| `abstentionAccuracy` | Cevaplama/reddetme kararı doğru mu (her iki yönde de) |
| `falseAnswerRate` | Cevapsız sorulara model yine de cevap uydurdu mu (hallucination) |
| `falseRetrievalRate` | Cevapsız sorularda eşiği geçen (alakasız) chunk getirildi mi |

### Latency metrikleri

| Metrik | Ne ölçer |
|---|---|
| `retrievalMs` | Embed + vector search (+ varsa rerank) süresi |
| `generationMs` | LLM cevap üretme süresi |

### Token/maliyet metrikleri (generation açıkken, backend rapor ediyorsa)

| Metrik | Ne ölçer |
|---|---|
| `totalPromptTokens` | Koşumdaki tüm generation çağrılarının toplam prompt token'ı (Ollama `prompt_eval_count`) |
| `totalCompletionTokens` | Koşumdaki tüm generation çağrılarının toplam completion token'ı (Ollama `eval_count`) |
| `totalCostUsd` | `EVAL_*_COST_PER_1K_TOKENS` oranlarıyla hesaplanan tahmini USD maliyet; oranlar `0` ise her zaman `0` |

### LLM-judge metriği (`EVAL_JUDGE=true`, opsiyonel)

| Metrik | Ne ölçer |
|---|---|
| `judgeAccuracy` | İkinci bir LLM'in cevabı `expectedKeywords`'e karşı doğru/yanlış olarak derecelendirdiği vakaların oranı. `groundedness` proxy'sinin veremediği mutlak hükmü verir; kendisi de non-deterministic olduğu için **gate edilemez** (`gates.ts:GATEABLE_METRICS`), yalnızca raporlanır. Kod: `eval/judge.ts` |

### Production/canlı metrikler (`/metrics`, Prometheus — eval dışı, kod: `src/infrastructure/observability/metrics.ts`)

| Metrik | Ne ölçer |
|---|---|
| `rag_retrieval_top_score` (histogram) | Canlıda gelen sorguların en yüksek retrieval skoru dağılımı |
| `http_request_duration_seconds` (method/route/status) | Endpoint bazlı gecikme |
| process/default Node metrikleri | CPU, heap, event loop vb. |

## 1b. Prometheus + Grafana ile izleme (production/canlı metrikler)

`/metrics` endpoint'i Prometheus formatında zaten expose ediliyor
(`src/infrastructure/observability/metrics.ts`). `docker-compose.yml`'e eklenen `prometheus`
ve `grafana` servisleri bunu otomatik scrape edip görselleştiriyor:

```bash
docker compose up -d prometheus grafana   # podman kullanıyorsan: podman compose up -d ...
```

- **Prometheus**: http://localhost:9090 — scrape config: `monitoring/prometheus/prometheus.yml`
  (hedef: `api:3000/metrics`, 15s aralıkla).
- **Grafana**: http://localhost:3001 — kullanıcı/şifre `admin`/`admin` (ilk girişte değiştir).
  Prometheus datasource'u ve "RAG Overview" dashboard'u (`monitoring/grafana/provisioning/`)
  otomatik provision edilir — elle kurulum gerekmez.
  - Retrieval top score (p50/p90) ve dağılım (heatmap) — `rag_retrieval_top_score`
  - Route bazlı istek oranı ve p95 gecikme — `http_request_duration_seconds`
  - 5xx hata oranı

Bu, `npm run eval` harness'inin sonuçlarını **değil**, canlı `/query` trafiğinin retrieval
kalitesini gösterir. Eval harness kısa ömürlü bir batch script olduğu için (scrape edilecek
sürekli bir endpoint'i yok), onun sonuçlarını Grafana'ya taşımak için ayrı bir yaklaşım
(Pushgateway) gerekir — henüz kurulmadı.

## 2. Env değişkeni → etkilediği metrikler

| Env değişkeni | Etkilediği metrikler | Nasıl |
|---|---|---|
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_MODEL_PATH` | `precisionAtK`, `recallAtK`, `mrr`, `hitRate`, `snippetCoverage`, `retrievalMs`, dolaylı `groundedness`/`keywordCoverage` | Vektör uzayını ve skor dağılımını belirler — hangi chunk "yakın" sayılır. Ölçülmüş örnek: nomic vs bge-small, MRR 0.928→0.944, multi-source recall %80→%90 |
| `RETRIEVAL_THRESHOLD` | `precisionAtK`, `recallAtK`, `hitRate`, `falseRetrievalRate` | **Sadece rerank çalışmadığında** uygulanır (kosinüs ölçeği). Yüksek eşik → precision↑ ama hitRate/recall↓ |
| `RERANK_ENABLED` | `precisionAtK`, `recallAtK`, `mrr`, `hitRate`, `snippetCoverage`, `falseRetrievalRate`, `retrievalMs` (büyük artış) | Açıkken cross-encoder aday sıralamasını domine eder; ölçülen etki: P@k %56→%88, falseRetrieval %100→%33, latency 17ms→1439ms |
| `RERANK_MODEL_PATH` | Rerank açıkken yukarıdaki tüm retrieval metrikleri | Hangi cross-encoder kullanıldığı → sıralama kalitesi |
| `RERANK_FETCH_K` | `recallAtK` (özellikle multi-source), `retrievalMs` | Rerank'a giren aday havuzu boyutu. Ölçülmüş: 20→5 düşünce multi-source recall %90→%80 |
| `RERANK_THRESHOLD` | `precisionAtK`, `recallAtK`, `hitRate`, `falseRetrievalRate` | **Sadece rerank çalıştığında** uygulanır (cross-encoder ölçeği). 0.1→0.2'de falseRetrieval yarıya iner ama multi-source recall'dan taviz verir |
| `RAG_TOP_K` | `precisionAtK`, `recallAtK`, `hitRate`, `snippetCoverage`, dolaylı `groundedness`/`keywordCoverage`, `generationMs` | Kaç chunk tutulacağı — düşükse recall/precision trade-off'u değişir, yükseldikçe LLM'e giden context büyür |
| `RAG_MAX_TOP_K` | Hiçbiri (sadece request-time üst sınır) | — |
| `CHUNK_SIZE`, `CHUNK_OVERLAP` | Tüm retrieval metrikleri (chunk sınırları değiştiği için farklı vektörler), `snippetCoverage`, dolaylı `groundedness` | Not: mevcut eval corpus'u bunu ölçecek kadar büyük değil — dokümanda "ölçülemedi" olarak işaretli |
| `CHUNK_UNIT` | Aynı üstteki metrikler | `characters` (varsayılan) veya `tokens`. `tokens`'ta `CHUNK_SIZE`/`CHUNK_OVERLAP` aynı sayılar cl100k_base token'ı olarak sayılır — bölme mantığı (paragraf/cümle/kelime sınırları) aynı kalır, yalnızca "ne kadar" ölçüsü değişir. Kod: `chunkers/token-length.ts` |
| `CHUNK_INCLUDE_SECTION_CONTEXT` | `precisionAtK`, `recallAtK`, `mrr`, `hitRate`, `snippetCoverage`, `falseRetrievalRate` | Varsayılan `false`. Her chunk'ın metnine kendi bölüm yolunu (`"2. Components > 2.1 Kestrel collector"`) ekler — yalnızca metadata'ya değil, embedding'e giren metne de. Ölçüldü: bu corpus'ta her retrieval metriğinde **kayıp** (hitRate %98.0→%96.1, MRR 0.971→0.951, falseRetrievalRate %33.3→%46.7) — küçük, tek-konulu chunk'larda başlık kelimeleri ayırt ediciliği azaltıyor. Varsayılan bu yüzden kapalı; `heading`/`sectionPath` metadata'sı bu bayraktan bağımsız her zaman ekleniyor. Kod: `ingestion.ts:withSectionContext` |
| `QUERY_STRATEGY` | `precisionAtK`, `recallAtK`, `mrr`, `hitRate`, `snippetCoverage`, `retrievalMs` | Varsayılan `none`. `rewrite`/`multi-query`/`hyde` — her biri soru başına ek bir LLM çağrısı. 12 vakalık alt küme ölçümü: üçü de hiçbir retrieval metriğinde `none`'ı geçmedi (`hyde` snippet'te ölçülebilir kötüleşme gösterdi), retrieval latency'sini 9-12 kat artırdılar (575ms→5-7sn). Kod: `core/rag/query/` |
| `EMBEDDING_BATCH_SIZE` | Hiçbiri (kalite metriği yok) | Sadece ingestion throughput/latency'sini etkiler, retrieval kalitesine dokunmaz |
| `GENERATION_MODEL`, `GENERATION_MODEL_PATH` | `keywordCoverage`, `groundedness`, `abstentionAccuracy`, `falseAnswerRate`, `generationMs` | Hangi LLM cevap ürettiği — retrieval metriklerine dokunmaz, sadece cevap kalitesine |
| `MAX_TOKENS` | `groundedness`, `keywordCoverage` (dolaylı — cevap kesilirse), `generationMs` | Cevap uzunluğu üst sınırı |
| `EVAL_JUDGE`, `EVAL_JUDGE_MODEL` | `judgeAccuracy` | Açıkken (`EVAL_GENERATE=true` şart) ikinci bir LLM cevabı derecelendirir; model belirtilmezse `GENERATION_MODEL` kullanılır |
| `EVAL_PROMPT_COST_PER_1K_TOKENS`, `EVAL_COMPLETION_COST_PER_1K_TOKENS` | `totalCostUsd` | Self-hosted kurulumda varsayılan `0`; hosted model fiyatlandırması simüle etmek için ayarlanır |
| `MAX_QUERY_LENGTH` | Hiçbiri (validasyon sınırı, `400` hatası) | — |
| `CHROMADB_HOST/PORT/COLLECTION` | `retrievalMs` (ulaşılabilirlik/ağ gecikmesi), `/health/ready` | Kalite metriklerine dokunmaz, sadece erişilebilirlik ve gecikme |
| `EXTERNAL_TIMEOUT_MS`, `EXTERNAL_RETRY_ATTEMPTS` | `retrievalMs`, `generationMs` (kuyruk/timeout senaryolarında), `http_request_duration_seconds` | Dış çağrı hataları/gecikmeleri retry ile maskeleniyor ama tail latency'yi etkiler |
| `READINESS_TIMEOUT_MS` | Yalnızca `/health/ready` sonucu | Eval/kalite metriklerine etkisi yok |
| `QUEUE_DRIVER`, `REDIS_URL`, `QUEUE_CONCURRENCY`, `JOB_ATTEMPTS`, `UPLOAD_DIR` | Hiçbiri (eval metrikleri) | Sadece ingestion (async job) throughput/güvenilirliğini etkiler — retrieval/cevap kalitesine dokunmaz |
| `AUTH_ENABLED`, `API_KEY_HASHES`, `DEFAULT_TENANT` | Hiçbiri (RAG kalitesi) | `http_request_duration_seconds`'ta `401` oranını etkileyebilir, retrieval/cevap kalitesine dokunmaz |
| `CORS_ORIGINS`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `TRUST_PROXY` | Hiçbiri (RAG kalitesi) | Sadece HTTP katmanı davranışı |
| `PORT`, `DEBUG` | Hiçbiri | — |

**Özetle kalite metriklerini gerçekten oynatan 8 değişken:** `EMBEDDING_PROVIDER/MODEL`,
`RETRIEVAL_THRESHOLD`, `RERANK_ENABLED/MODEL_PATH/FETCH_K/THRESHOLD`, `RAG_TOP_K`,
`CHUNK_SIZE/OVERLAP` (ölçülememiş olsa da teorik etkisi var), `GENERATION_MODEL`,
`MAX_TOKENS`. Geri kalanlar (queue, auth, CORS, timeout'lar) operasyonel/güvenlik ayarları —
retrieval veya cevap kalitesine dokunmuyor, sadece throughput/erişilebilirlik/gecikmeyi
etkiliyor.
