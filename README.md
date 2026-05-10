# NoteBook RAG

A NotebookLM-style RAG app: upload a PDF or text file, then ask questions grounded in its content.

Built with Next.js 16, LangChain, Gemini, and Qdrant Cloud.

## Live demo

> Deploy to Vercel and put the link here.

## How it works (RAG pipeline)

```
Upload  ──►  Parse  ──►  Chunk  ──►  Embed (Gemini)  ──►  Qdrant
                                                             │
                              User question ──► Embed ───────┘
                                                       │
                                                       ▼
                                       Top-k chunks → Gemini → Answer
```

1. **Ingestion** (`/api/ingest`)
   - PDFs are parsed with LangChain's `PDFLoader` (one document per page, page numbers preserved in metadata).
   - Text files are read directly into a single document.
2. **Chunking** — `RecursiveCharacterTextSplitter` with `chunkSize: 1000` and `chunkOverlap: 200`.
   - Walks separators in priority order (`\n\n` → `\n` → ` ` → `""`), so chunks respect paragraph and sentence boundaries before falling back to character-level splits.
   - 200-character overlap keeps context across boundaries so an answer that straddles two chunks isn't lost.
3. **Embedding** — Google `text-embedding-004` (768 dims).
4. **Storage** — Qdrant Cloud. All chunks land in a single collection (`notebook-rag`); each chunk is tagged with a unique `docId` in its payload so different uploads don't bleed into each other.
5. **Retrieval** (`/api/query`) — embeds the question, runs a Qdrant similarity search filtered by `docId`, returns top 4 chunks.
6. **Generation** — `gemini-2.5-flash` with a strict system prompt that forbids using outside knowledge. If the answer isn't in the retrieved context, the model replies *"I could not find this in the document."*
7. **Citations** — every answer ships with the source chunks (page numbers when available), shown under each response.

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
    ingest/route.ts   # parses + chunks + embeds the upload, writes to Qdrant
    query/route.ts    # embeds question, retrieves from Qdrant, calls Gemini
  page.tsx            # upload form + chat UI
  layout.tsx
  globals.css
lib/
  rag.ts              # chunking, Gemini embeddings, Qdrant store + retrieval
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
