CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE doc_chunks (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(1536),
  source_url TEXT NOT NULL,
  page_title TEXT NOT NULL
);
CREATE INDEX doc_chunks_embedding_idx ON doc_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE eval_tuples (
  eval_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  deal_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  transcript_signals JSONB NOT NULL,
  retrieved_chunk_ids TEXT[] NOT NULL,
  generated_deck JSONB NOT NULL,
  ae_diff JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE workflow_runs (
  run_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  deal_id TEXT,
  signals JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  status_message TEXT,
  slides JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX workflow_runs_user_status ON workflow_runs (user_id, status);

CREATE TABLE pipeline_runs (
  id SERIAL PRIMARY KEY,
  deal_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  signals JSONB NOT NULL,
  generated_deck JSONB,
  retrieved_chunk_ids TEXT[],
  retrieval_scores JSONB,
  total_slides INT,
  slides_failed_grounding INT DEFAULT 0,
  faithfulness_rate REAL,
  hallucination_check_iterations INT,
  latency_ms INT
);
