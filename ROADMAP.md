# Enterprise RAG Roadmap

Bu belge, `raga-octi` RAG servisini "çalışan MVP"den "enterprise-grade"e taşıyacak
işleri sıralı bir task list olarak tanımlar. **Temiz bir session'da devam edilebilecek
şekilde** yazıldı: her task'ta amaç, gerekçe, dokunulacak dosyalar, yaklaşım, kabul
kriterleri ve doğrulama adımları var.

---

## Bu belgeyi kullanan agent için (ÖNCE OKU)

1. **Her task'ı tek başına, sırayla** ele al. Bir sonrakine geçmeden önce kullanıcıdan
   onay al (kullanıcının çalışma tarzı bu).
2. Her değişiklikten sonra: `npm run build` + `npx tsc --noEmit` temiz olmalı, `npm test`
   yeşil kalmalı, ve yeni davranış için **test yaz** (proje `*.test.ts` + Vitest kullanıyor).
3. Davranışsal düzeltmelerde **mutasyon testi** alışkanlığı benimsendi: düzeltmeyi geçici
   geri alıp ilgili testin kırmızıya döndüğünü doğrula, sonra geri yükle.
4. Gerçek altyapı testleri için ChromaDB'yi `podman`/`docker` ile ayağa kaldır (aşağıda).
   Ollama yoksa `EMBEDDING_PROVIDER=llama` ile yerel GGUF modeli kullanılabilir; LLM
   çağrıları için küçük bir sahte HTTP sunucusu yazılabilir (bkz. geçmiş session deseni).
5. Sırrı/dış servise gidecek işlemleri kullanıcı onayı olmadan yapma. `.env` gitignore'da,
   commit etme.
6. İş bitince bu belgede ilgili task'ın **Durum**'unu güncelle (`Todo → Done`).

---

## Mevcut durum (tamamlanan temel — 2026-07 turu)

Aşağıdakiler zaten yapıldı ve `main`'de (`b2724f9`):

- Tek embedding modeli (ingest = query), cosine uzayı, doğru benzerlik skoru yönü.
- Idempotent ingest (deterministik id `${source}#${index}` + `deleteBySource`), batch'li
  embedding/upsert.
- Girdi doğrulama (zod), upload limitleri, hata sızıntısı kapatıldı, `maxTokens` bağlandı.
- `/query` kaynak/citation döndürüyor, `/health` liveness, global error + 404 handler,
  graceful shutdown, lazy-singleton başlatma.
- Güvenlik başlıkları (helmet), rate limit, CORS; `DEBUG` → log seviyesi.
- Multi-stage Docker (debian slim, non-root), `.dockerignore`.
- 78 test, alias-aware Vitest, mutasyonla doğrulanmış.

**Genel değerlendirme:** Sağlam tek-düğümlü temel. Enterprise'ı ayıran katmanlar (auth/
multi-tenancy, retrieval kalitesi, eval, async ölçek, observability) henüz yok — bu
roadmap onları kapsıyor.

---

## Mimari harita (agent için hızlı yönlendirme)

```
src/
  app.ts                      # Express app kurulumu (middleware + route wiring) — auth/middleware buraya
  index.ts                    # Server bootstrap + graceful shutdown + process handlers
  config.ts                   # TÜM env config tek yerde (yeni ayarlar buraya ekle)
  routes/
    health.route.ts           # liveness
    ingest.route.ts (ingestion.route.ts)
    query.route.ts
    index.ts                  # router export barrel
  core/rag/
    ingestion.ts              # RagDataIngestor: dosya→chunk→embed→upsert; buildChunks/embedInBatches
    rag-orchestrator.ts       # RagOrchestrator.query: embed→search→threshold→generate→citations
    embedding/                # base + factory (createEmbedding) + ollama/llama/gemini
    llm/                      # LangModelBase + ollama/llama runner (generateResponse)
    vector-store/             # ChromaVectorStore: upsert/search/deleteBySource; toSimilarity
    chunkers/                 # RecursiveChunker
    file-handlers/            # resolveFileHandler (stateless) + text/pdf handlers + registry
    text-processors/          # DefaultTextProcessor (konservatif temizleme)
  infrastructure/
    async/                    # lazySingleton
    http/                     # error-handler, graceful-shutdown
    logging/                  # winston logger (config.debugMode'a bağlı)
```

**Doğrulanmış komutlar:**
- `npm run build`  → `tsc -p tsconfig.build.json && tsc-alias` (dist üretir, testleri hariç tutar)
- `npm test`       → `vitest run` (78 test)
- `npm run dev`    → nodemon + ts-node
- `npx tsc --noEmit`→ tip kontrolü (testler dahil)
- ChromaDB: `podman run -d --name chromadb -p 8000:8000 -e IS_PERSISTENT=TRUE -e ANONYMIZED_TELEMETRY=FALSE chromadb/chroma:latest`

---

## Task list (öncelik sırasına göre)

Sıralama, "gerçek kullanıcıya açılacaksa" mantığına göre: önce güvenlik açığı, sonra
dayanıklılık, sonra kaliteyi ölçme, sonra kaliteyi artırma.

---

### T1 — Kimlik doğrulama + kiracı (tenant) izolasyonu
**Durum:** ✅ Done (2026-07) · **Öncelik:** P0 (güvenlik) · **Bağımlılık:** yok

> **Yapıldı:** API key → tenant eşlemesi (`AUTH_ENABLED` + `API_KEYS=key:tenant,...`),
> `authMiddleware` (`x-api-key` veya `Bearer`), `/health` hariç `/ingest` + `/query` auth
> arkasında. İzolasyon metadata-filtre ile: her chunk'a `tenantId` yazılıyor, `query`
> Chroma `where: { tenantId }` ile sınırlanıyor, `deleteBySource` tenant-scoped (`$and`).
> Auth kapalıyken tek-kiracı modda `default` tenant atanıyor (geriye uyumlu).
> **Doğrulama:** 17 yeni test (auth middleware, tenant tag/filter, store where/delete,
> route 401) + gerçek ChromaDB ile e2e cross-tenant sızıntı testi (ACME secret Globex'e
> görünmüyor). Toplam 95 test yeşil.
> **Sonraki tur için not:** JWT/OAuth'a geçiş `authMiddleware` içinde izole; API key
> lookup şu an sabit-zamanlı değil (hashmap) — yüksek güvenlik gerekirse `timingSafeEqual`.

**Amaç:** Uçları auth'a bağla ve retrieval'ı isteği yapan kiracının görmeye yetkili
olduğu dokümanlarla sınırla.

**Neden:** Şu an tüm uçlar açık ve tek global koleksiyon (`docs`) var → herkes herkesin
dokümanını sorgulayabilir. Bu, enterprise için kabul edilemez bir veri sızıntısı riski.

**Dokunulacak dosyalar:**
- `src/app.ts` — auth middleware ekle (route'lardan önce, `/health` hariç).
- `src/config.ts` — API key(ler) / JWT secret / auth modu ayarları.
- `src/infrastructure/http/` — yeni `auth.ts` middleware.
- `src/core/rag/ingestion.ts` + `rag-orchestrator.ts` — chunk metadata'sına `tenantId`
  ekle; query'de vektör aramasına `where: { tenantId }` filtresi geçir.
- `src/core/rag/vector-store/chroma-vector-store.ts` — `search`/`deleteBySource`'a
  metadata filtresi (where) parametresi ekle.

**Yaklaşım:**
1. Basit başlangıç: `Authorization: Bearer <key>` veya `x-api-key`; anahtar→tenant eşlemesi
   config'ten. (İleride JWT/OAuth'a genişletilebilir; arayüzü buna uygun tut.)
2. İstek bağlamına `tenantId` koy (Express `res.locals` veya request augmentation).
3. Ingest: her chunk metadata'sına `tenantId` yaz. Query: `store.search`'e tenant filtresi
   geç (Chroma `where`). `deleteBySource` de tenant-scoped olmalı.
4. Alternatif/daha güçlü izolasyon: tenant başına ayrı koleksiyon (`docs_${tenantId}`).
   Karar noktası — metadata-filtre (basit) vs collection-per-tenant (güçlü izolasyon).

**Kabul kriterleri:**
- Auth'suz istek → 401.
- Tenant A'nın yüklediği doküman, Tenant B'nin sorgusunda **asla** dönmüyor.
- `/health` auth'suz erişilebilir kalıyor.

**Doğrulama:** İki farklı key ile ingest + cross-query testi (route testi + gerçek Chroma
ile e2e). `chroma-vector-store` filtresi için birim testi.

---

### T2 — Asenkron ingest + dayanıklılık (retry/backoff/timeout)
**Durum:** Todo · **Öncelik:** P0 (dayanıklılık) · **Bağımlılık:** yok

**Amaç:** Büyük/toplu doküman yüklemesini HTTP isteğini bloke etmeden işle; dış servis
(Chroma/Ollama) çağrılarına timeout + retry + backoff ekle.

**Neden:** Ingest şu an senkron — büyük PDF'te istek timeout olur, worker bloke olur.
Ollama/Chroma bir an takılırsa istek süresiz asılı kalır (timeout yok).

**Dokunulacak dosyalar:**
- `src/routes/ingestion.route.ts` — ingest'i kuyruğa al, `202 Accepted` + `jobId` dön.
- Yeni: `src/core/rag/jobs/` — iş kuyruğu (basit in-memory queue ile başla; sonra
  BullMQ/Redis'e taşınabilir arayüz), worker, `job status` deposu.
- Yeni uç: `GET /ingest/status/:jobId`.
- `src/core/rag/embedding/*` + `llm/*` + `vector-store/*` — dış çağrılara `AbortSignal`
  timeout + retry/backoff sar (yeni `infrastructure/async/retry.ts` helper).
- `src/config.ts` — timeout, retry sayısı, backoff, queue ayarları.

**Yaklaşım:**
1. Retry helper: exponential backoff + jitter, yalnızca geçici hatalarda (network, 5xx,
   timeout). Circuit breaker opsiyonel ama arayüzü hazırla.
2. Tüm dış I/O (`ollama.embed`, `ollama.chat`, `chroma.*`) `withTimeout(signal)` ile sarılı.
3. Ingest job modeli: `{ id, status: queued|processing|done|failed, error?, counts }`.
   In-memory başla (arayüzü store'lanabilir tut → Redis'e geçiş kolay olsun).
4. Worker ingest'i çalıştırır; route sadece job üretir.

**Kabul kriterleri:**
- `POST /ingest` → hemen `202 { jobId }` döner, büyük dosyada bile bloke olmaz.
- `GET /ingest/status/:jobId` doğru durumu döner.
- Ollama/Chroma yavaşsa istek `config.requestTimeoutMs` sonunda temiz hata verir, asılı
  kalmaz.
- Geçici hatada retry devreye girer (test: 1. çağrı hata, 2. başarılı).

**Doğrulama:** Retry helper birim testi (sahte flaky fonksiyon). Timeout testi (sahte
yavaş sunucu). Job lifecycle testi.

---

### T3 — Değerlendirme (evaluation) harness'i
**Durum:** Todo · **Öncelik:** P1 · **Bağımlılık:** T1 (opsiyonel), T4'ten ÖNCE olmalı

**Amaç:** Retrieval ve cevap kalitesini ölçen bir eval iskeleti kur, böylece sonraki
kalite değişiklikleri (T4) körlemesine değil ölçülerek yapılsın.

**Neden:** "Sistem iyi mi?" sorusu şu an cevaplanamıyor. Reranking/hybrid gibi
değişikliklerin gerçekten iyileştirip iyileştirmediğini görmek için baseline şart.

**Dokunulacak dosyalar:**
- Yeni: `eval/` — golden dataset (soru + beklenen kaynak/cevap), eval runner script.
- Yeni: `src/core/rag/eval/` — metrik hesaplayıcılar (context precision/recall,
  faithfulness, answer relevance — RAGAS mantığı).
- `package.json` — `npm run eval` script'i.

**Yaklaşım:**
1. Küçük golden set (10-20 soru) + bilinen dokümanlar. `eval/dataset.jsonl`.
2. Metrikler:
   - **Retrieval:** context precision/recall @k (beklenen kaynak dönen sonuçlarda mı?).
   - **Answer:** faithfulness (cevap bağlama dayanıyor mu — LLM-judge), answer relevance.
3. Runner: dataset üzerinde ingest+query çalıştır, metrikleri raporla (tablo + JSON).
4. LLM-judge için mevcut LLM sağlayıcısını kullan (deterministiklik için düşük sıcaklık).

**Kabul kriterleri:**
- `npm run eval` çalışır, baseline skorları tablo olarak basar ve JSON'a yazar.
- Metrikler tekrarlanabilir (aynı girdi → yakın skor).

**Doğrulama:** Bilinen iyi/kötü retrieval senaryolarında metriklerin beklenen yönde
çıktığını gösteren birim testleri.

---

### T4 — Retrieval kalitesi: reranking + hibrit arama
**Durum:** Todo · **Öncelik:** P1 · **Bağımlılık:** T3 (önce ölçüm olmalı)

**Amaç:** Dense-only aramanın üstüne reranking ve keyword/BM25 hibrit arama ekleyerek
retrieval doğruluğunu artır.

**Neden:** Kaba vektör benzerliği isim/kod/ID gibi lexical eşleşmelerde ve ince
ayrımlarda zayıf. Reranking + hybrid, RAG kalitesindeki en büyük tek sıçramadır.

**Dokunulacak dosyalar:**
- Yeni: `src/core/rag/reranking/` — `Reranker` soyutlaması + implementasyon
  (cross-encoder: BGE-reranker yerel, veya Cohere Rerank API).
- `src/core/rag/rag-orchestrator.ts` — search sonrası rerank adımı ekle (topK'dan fazla
  aday çek → rerank → gerçek topK'ya indir).
- `src/core/rag/vector-store/chroma-vector-store.ts` — keyword/BM25 arama veya Chroma
  full-text; sonra dense + sparse skorlarını birleştir (RRF - Reciprocal Rank Fusion).
- `src/config.ts` — rerank sağlayıcı/model, aday sayısı (fetchK), füzyon ağırlıkları.

**Yaklaşım:**
1. Önce **reranking** (daha kolay, büyük kazanç): fetchK=20 çek, cross-encoder ile
   yeniden sırala, topK=3-5'e indir.
2. Sonra **hibrit**: BM25/keyword skoru + dense skoru RRF ile birleştir.
3. Her adımdan sonra **T3 eval'i çalıştır**, iyileşmeyi sayısal göster.

**Kabul kriterleri:**
- Reranking açık/kapalı karşılaştırmasında eval metrikleri (context precision) yükseliyor.
- Lexical bir sorgu (ör. tam bir ürün kodu) hibrit ile doğru dokümanı buluyor, dense-only
  bulamıyorken.

**Doğrulama:** T3 eval harness'i ile before/after skorları. Reranker birim testi.

---

### T5 — Streaming yanıt + çok-turlu (multi-turn) oturum
**Durum:** Todo · **Öncelik:** P2 · **Bağımlılık:** yok

**Amaç:** `/query` yanıtını token-by-token akıt (SSE); opsiyonel konuşma geçmişi desteği.

**Neden:** Enterprise chat UX'i akış bekler (algılanan gecikme çok düşer). Multi-turn,
takip sorularını mümkün kılar.

**Dokunulacak dosyalar:**
- `src/routes/query.route.ts` — SSE / streaming yanıt yolu (ör. `?stream=true` veya
  `Accept: text/event-stream`).
- `src/core/rag/llm/*` — `generateResponse` yanında `generateStream` (Ollama `stream:true`).
- `src/core/rag/rag-orchestrator.ts` — streaming query varyantı.
- (Opsiyonel) oturum/geçmiş: hafif in-memory veya store; prompt'a önceki turları kat.

**Kabul kriterleri:**
- Streaming istekte cevap parça parça gelir; kaynaklar sonda (veya başta) döner.
- Non-streaming yol aynen çalışmaya devam eder (geriye uyumlu).

**Doğrulama:** SSE chunk'larını toplayıp tam cevabı doğrulayan test (sahte streaming LLM).

---

### T6 — Observability: metrik + tracing + readiness + correlation id
**Durum:** Todo · **Öncelik:** P2 · **Bağımlılık:** yok

**Amaç:** Prometheus metrikleri, OpenTelemetry tracing, gerçek readiness probe ve request
correlation id ekle.

**Neden:** Şu an sadece log var. Enterprise ops için gecikme/hata/token metrikleri,
uçtan uca trace ve bağımlılık-hazırlık kontrolü gerekir.

**Dokunulacak dosyalar:**
- Yeni: `src/routes/health.route.ts` → `/health/ready` (Chroma + Ollama ping'i) ekle;
  mevcut `/health` liveness kalsın.
- Yeni: `src/infrastructure/observability/` — metrics (prom-client), tracing (OTel setup),
  correlation-id middleware.
- `src/app.ts` — correlation-id + metrics middleware; `GET /metrics` ucu.
- `src/infrastructure/logging/default-logger.ts` — log'lara correlation id ekle.

**Kabul kriterleri:**
- `/metrics` Prometheus formatı döner (istek sayısı, gecikme histogramı, retrieval skoru).
- `/health/ready` bağımlılıklar hazır değilse 503 döner.
- Her istek log'unda korelasyon id var; embed→search→generate zinciri trace'te görünür.

**Doğrulama:** `/metrics` ve `/health/ready` route testleri (bağımlılık up/down senaryoları).

---

### T7 — Veri yönetimi: silme/güncelleme uçları + format genişletme + PII
**Durum:** Todo · **Öncelik:** P2 · **Bağımlılık:** T1 (tenant-scoped silme)

**Amaç:** Doküman silme/listeleme uçları aç, desteklenen formatları genişlet, ingest'te
PII maskeleme opsiyonu ekle.

**Neden:** GDPR/KVKK "unutulma hakkı" için silme zorunlu (`deleteBySource` var ama uç
yok). docx/html/csv gibi formatlar enterprise'da beklenir.

**Dokunulacak dosyalar:**
- Yeni uçlar: `DELETE /documents/:source`, `GET /documents` (tenant-scoped).
- `src/routes/` — yeni `documents.route.ts`.
- `src/core/rag/vector-store/chroma-vector-store.ts` — listeleme (distinct source) desteği.
- `src/core/rag/file-handlers/` — docx/html/csv handler'ları (registry'ye ekle).
- (Opsiyonel) `src/core/rag/text-processors/` — PII tespiti/maskeleme adımı.

**Kabul kriterleri:**
- `DELETE /documents/:source` o dokümanın tüm chunk'larını (tenant-scoped) siler.
- En az bir yeni format (docx veya html) ingest edilebilir.

**Doğrulama:** Silme sonrası query'de o dokümanın dönmediğini gösteren e2e test; yeni
format handler birim testi.

---

### T8 — Prompt injection savunması
**Durum:** Todo · **Öncelik:** P2 · **Bağımlılık:** yok

**Amaç:** Yüklenen doküman içeriğindeki talimat-enjeksiyonuna (ör. "ignore previous
instructions") karşı savunma ekle.

**Neden:** Retrieval ile gelen doküman metni doğrudan LLM prompt'una gidiyor; kötü niyetli
doküman sistem talimatını ezmeye çalışabilir.

**Dokunulacak dosyalar:**
- `src/core/rag/llm/ollama-model-runner.ts` (ve base) — prompt kurgusunda bağlamı net
  sınırla (delimiter/XML tag), sistem talimatını güçlendir; bağlamın "talimat değil veri"
  olduğunu vurgula.
- (Opsiyonel) ingest veya query'de basit enjeksiyon-desen tespiti + işaretleme.

**Kabul kriterleri:**
- Bilinen enjeksiyon ifadeleri içeren bir bağlamda model sistem talimatını korur (test:
  enjeksiyonlu chunk → model yine de görevine sadık).

**Doğrulama:** Enjeksiyonlu bağlam ile prompt kurgusunu doğrulayan test (LLM-judge veya
prompt içeriği assertion'ı).

---

### T9 — Ölçeklenebilir vektör DB & kalıcılık stratejisi (araştırma + karar)
**Durum:** Todo · **Öncelik:** P3 · **Bağımlılık:** yok

**Amaç:** Tek-düğüm ChromaDB'nin ötesinde replikasyon/backup/ölçek için yönetilen bir
vektör DB değerlendir (pgvector / Qdrant / Weaviate). Karar dokümanı + gerekirse
`VectorStore` arayüzü ardında yeni implementasyon.

**Neden:** Enterprise'da HA, backup ve yatay ölçek gerekir; tek Chroma düğümü SPOF.

**Dokunulacak dosyalar:**
- `src/core/rag/vector-store/` — `VectorStore` soyut arayüzü çıkar (şu an `ChromaVectorStore`
  somut); yeni implementasyon eklenebilir olsun.
- Karar dokümanı: `docs/adr/` (Architecture Decision Record).

**Kabul kriterleri:**
- `VectorStore` arayüzü tanımlı; `ChromaVectorStore` onu implemente ediyor; orchestrator/
  ingestor arayüze bağımlı.
- Trade-off karşılaştırması yazılı.

**Doğrulama:** Arayüz refactor'ı sonrası mevcut 78 test + e2e yeşil kalmalı.

---

## Çalışma sırası (özet)

| Sıra | Task | Öncelik | Neden bu sırada |
|------|------|---------|-----------------|
| 1 | ✅ T1 Auth + tenant izolasyonu | P0 | Güvenlik açığı; her şeyden önce |
| 2 | T2 Async ingest + dayanıklılık | P0 | İlk büyük dosyada patlar |
| 3 | T3 Eval harness | P1 | Sonraki kalite işleri ölçülsün diye |
| 4 | T4 Reranking + hybrid | P1 | Asıl kalite sıçraması (T3 ile ölçülerek) |
| 5 | T5 Streaming + multi-turn | P2 | UX olgunluğu |
| 6 | T6 Observability | P2 | Ops görünürlüğü |
| 7 | T7 Veri yönetimi + format | P2 | Uyumluluk (KVKK) + kapsam |
| 8 | T8 Prompt injection savunması | P2 | Güvenlik sertleştirme |
| 9 | T9 Vektör DB ölçek kararı | P3 | Uzun vadeli altyapı |

> Her task bitince: bu tablodaki ve task başlığındaki **Durum**'u `Done` yap, kısa bir
> "ne yapıldı + nasıl doğrulandı" notu ekle.
