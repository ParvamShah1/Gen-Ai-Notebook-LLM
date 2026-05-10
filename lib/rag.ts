import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";

export const COLLECTION_NAME = "notebook-rag";
const EMBEDDING_MODEL = "gemini-embedding-001";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const embeddings = () =>
  new GoogleGenerativeAIEmbeddings({
    apiKey: requireEnv("GEMINI_API_KEY"),
    model: EMBEDDING_MODEL,
  });

const qdrantConfig = () => ({
  url: requireEnv("QDRANT_URL"),
  apiKey: process.env.QDRANT_API_KEY,
  collectionName: COLLECTION_NAME,
});

const rawClient = () =>
  new QdrantClient({
    url: requireEnv("QDRANT_URL"),
    apiKey: process.env.QDRANT_API_KEY,
  });

// Recursive character splitting: walks separators ["\n\n", "\n", " ", ""]
// in order, preserving semantic boundaries (paragraphs > lines > words)
// before falling back to character-level splits. Overlap keeps context across
// chunk boundaries so retrieval doesn't miss answers that straddle a split.
export async function chunkDocuments(docs: Document[]): Promise<Document[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  return splitter.splitDocuments(docs);
}

export async function indexChunks(
  chunks: Document[],
  docId: string,
  source: string,
): Promise<void> {
  const tagged = chunks.map(
    (c) =>
      new Document({
        pageContent: c.pageContent,
        metadata: { ...c.metadata, docId, source },
      }),
  );
  await QdrantVectorStore.fromDocuments(tagged, embeddings(), qdrantConfig());

  // Ensure a payload index exists on metadata.docId so we can filter by it.
  // Qdrant requires explicit indexes for filterable fields; without this the
  // similarity search with filter returns 400 Bad Request.
  try {
    await rawClient().createPayloadIndex(COLLECTION_NAME, {
      field_name: "metadata.docId",
      field_schema: "keyword",
    });
  } catch {
    // Index already exists — safe to ignore.
  }
}

export async function retrieveTopK(
  question: string,
  docId: string,
  k = 4,
): Promise<Document[]> {
  const store = await QdrantVectorStore.fromExistingCollection(
    embeddings(),
    qdrantConfig(),
  );
  return store.similaritySearch(question, k, {
    must: [{ key: "metadata.docId", match: { value: docId } }],
  });
}
