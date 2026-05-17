# NoteBook RAG

A NotebookLM-style RAG app: upload a PDF or text file, then ask questions grounded in its content.

Built with Next.js 16, LangChain, Gemini, and Qdrant Cloud.

## Live demo

> Deploy to Vercel and put the link here.

## How it works (RAG pipeline with CRAG)

```
                        ┌─── Corrective RAG (CRAG) ───┐
                        │                              │
User question           │                              │
      │                 │                              │
      ▼                 │                              │
  Query Rewriter ───────┤  (gemini-2.0-flash)          │
      │                 │                              │
      ├─ cleaned query  │                              │
      ├─ variant 1      │                              │
      └─ variant 2      │                              │
           │            │                              │
           ▼            │                              │
  Multi-Query Retrieve  │  3 queries → Qdrant → dedup  │
           │            │                              │
           ▼            │                              │
  LLM-as-Judge ─────────┤  grade: relevant/ambiguous/  │
      │                 │  irrelevant → drop bad ones  │
      │                 │                              │
      └─────────────────┘                              │
           │                                           │
           ▼                                           │
  Guarded Generation ──── gemini-2.5-flash ── Answer   │
                                                       │
Upload ─► Parse ─► Chunk ─► Embed ─► Qdrant ──────────┘
```

### Ingestion pipeline

1. **Parsing** (`/api/ingest`) — PDFs via LangChain's `PDFLoader` (page numbers preserved); plain text read directly.
2. **Chunking** — `RecursiveCharacterTextSplitter` with `chunkSize: 1000` and `chunkOverlap: 200`.
   - Walks separators in priority order (`\n\n` → `\n` → ` ` → `""`), so chunks respect paragraph and sentence boundaries before falling back to character-level splits.
   - 200-character overlap keeps context across boundaries so an answer that straddles two chunks isn't lost.
3. **Embedding** — Google `gemini-embedding-001` (3072 dims).
4. **Storage** — Qdrant Cloud. All chunks land in a single collection (`notebook-rag`); each chunk is tagged with a unique `docId` in its payload so different uploads don't bleed into each other. A payload index on `metadata.docId` is auto-created for filtered retrieval.

### CRAG query pipeline

5. **Query Rewriting** (`lib/queryRewriter.ts`) — `gemini-2.0-flash` fixes typos, expands abbreviations, and generates 2 alternative paraphrases to improve retrieval coverage.
6. **Multi-Query Retrieval** (`lib/rag.ts`) — all 3 queries (cleaned + 2 variants) run in parallel against Qdrant with `k=6` each. Results are deduplicated by the first 160 characters.
7. **LLM-as-Judge** (`lib/judge.ts`) — `gemini-2.0-flash` grades each chunk as `relevant`, `ambiguous`, or `irrelevant`. Irrelevant chunks are dropped before reaching the generation model. If every chunk is dropped, the system returns a canned "not found" message instead of hallucinating.
8. **Guarded Generation** — `gemini-2.5-flash` (the larger model, reserved only for the final answer) with a strict system prompt forbidding outside knowledge.
9. **Citations + CRAG metadata** — every response shows source chunks with page numbers, plus inline badges: rewritten query, variant count, and judge kept/total.

## Local setup

You need three things:
- **Gemini API key** — https://aistudio.google.com/apikey (free tier).
- **Qdrant Cloud cluster** — https://cloud.qdrant.io (free 1 GB tier). After creating a cluster, copy the **cluster URL** and create an **API key**.
- **Node.js 20+**.

```bash
npm install
cp .env.example .env.local
# fill in GEMINI_API_KEY, QDRANT_URL, QDRANT_API_KEY in .env.local
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) → import the repo.
3. Add three environment variables:
   - `GEMINI_API_KEY`
   - `QDRANT_URL`
   - `QDRANT_API_KEY`
4. Deploy.

The Qdrant collection (`notebook-rag`) is auto-created on the first upload — no manual setup needed.

## Project layout

```
app/
  api/
    ingest/route.ts     # parse + chunk + embed + write to Qdrant
    query/route.ts      # CRAG pipeline: rewrite → multi-retrieve → judge → generate
  page.tsx              # upload form + chat UI + CRAG badges
  layout.tsx
  globals.css
lib/
  rag.ts                # chunking, embeddings, Qdrant store, multi-query retrieval
  queryRewriter.ts      # CRAG step 1: typo fixing + query paraphrasing
  judge.ts              # CRAG step 3: LLM-as-judge relevance grading
```

## Tech

- Next.js 16 (App Router, Node runtime API routes)
- LangChain (`PDFLoader`, `RecursiveCharacterTextSplitter`, `GoogleGenerativeAIEmbeddings`, `QdrantVectorStore`)
- Google Generative AI SDK (`gemini-2.5-flash`)
- Qdrant Cloud
- TypeScript, React 19

## Limits

- Max upload ≈ 4.5 MB (Vercel hobby request body limit).
- API route timeout 60 s — large PDFs may time out during embedding on the first ingest.
- All uploads share one Qdrant collection. To wipe the collection, delete it from the Qdrant Cloud dashboard.
