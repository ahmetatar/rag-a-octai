npx --no node-llama-cpp pull --dir ./models hf:ggml-org/bge-small-en-v1.5-Q8_0-GGUF
npx --no node-llama-cpp pull --dir ./models hf:Qwen/Qwen3-1.7B-GGUF

# Optional cross-encoder reranker (RERANK_ENABLED=true, EMBEDDING_PROVIDER=llama).
# Point RERANK_MODEL_PATH at the downloaded file.
npx --no node-llama-cpp pull --dir ./models "hf:gpustack/bge-reranker-v2-m3-GGUF:Q4_K_M"
