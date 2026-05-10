import { NextRequest, NextResponse } from "next/server";
import { Document } from "@langchain/core/documents";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { randomUUID } from "node:crypto";
import { chunkDocuments, indexChunks } from "@/lib/rag";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const name = file.name;
    const isPdf =
      file.type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
    const isText =
      file.type.startsWith("text/") || name.toLowerCase().endsWith(".txt");

    if (!isPdf && !isText) {
      return NextResponse.json(
        { error: "Only PDF and plain text files are supported" },
        { status: 400 },
      );
    }

    let docs: Document[];
    if (isPdf) {
      const loader = new PDFLoader(file);
      docs = await loader.load();
    } else {
      const text = await file.text();
      docs = [new Document({ pageContent: text, metadata: { source: name } })];
    }

    const chunks = await chunkDocuments(docs);
    if (chunks.length === 0) {
      return NextResponse.json(
        { error: "Could not extract any text from the file" },
        { status: 400 },
      );
    }

    const docId = randomUUID();
    await indexChunks(chunks, docId, name);

    return NextResponse.json({
      docId,
      source: name,
      chunkCount: chunks.length,
    });
  } catch (err) {
    console.error("ingest error", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
