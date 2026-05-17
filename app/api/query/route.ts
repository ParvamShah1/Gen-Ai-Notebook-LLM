import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { multiQueryRetrieve } from "@/lib/rag";
import { rewriteQuery } from "@/lib/queryRewriter";
import { judgeChunks, type Grade } from "@/lib/judge";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CONTEXT_CHUNKS = 10;

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions strictly using the provided context from a user-uploaded document.

Rules:
- Only answer using facts found in the CONTEXT below. Do not use outside knowledge.
- If the answer is not contained in the context, reply exactly: "I could not find this in the document."
- Quote or paraphrase relevant parts when useful.
- When citing, reference the page number if available, e.g. "(page 4)".
- Be concise and direct.`;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      question?: string;
      docId?: string;
    };
    const { question, docId } = body;

    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "Missing 'question'" },
        { status: 400 },
      );
    }
    if (!docId || typeof docId !== "string") {
      return NextResponse.json(
        { error: "Upload a document first" },
        { status: 400 },
      );
    }

    // ── CRAG Step 1: Query Rewriting ──
    const rewrite = await rewriteQuery(question);
    const allQueries = [rewrite.cleaned, ...rewrite.variants];

    // ── CRAG Step 2: Multi-query Retrieval ──
    const retrieved = await multiQueryRetrieve(allQueries, docId, 6);

    if (retrieved.length === 0) {
      return NextResponse.json({
        answer: "I could not find this in the document.",
        sources: [],
        rag: {
          originalQuery: question,
          rewrittenQuery: rewrite.cleaned,
          variants: rewrite.variants,
          wasRewritten: rewrite.wasRewritten,
          retrieved: 0,
          kept: 0,
          dropped: 0,
          grades: [],
        },
      });
    }

    // ── CRAG Step 3: LLM-as-Judge Relevance Grading ──
    const judgeResult = await judgeChunks(
      rewrite.cleaned,
      retrieved.map((d) => ({ text: d.pageContent })),
    );

    const kept = retrieved.filter(
      (_, i) => judgeResult.grades[i] !== "irrelevant",
    );

    if (kept.length === 0) {
      return NextResponse.json({
        answer: "I could not find relevant information about this in the document.",
        sources: [],
        rag: {
          originalQuery: question,
          rewrittenQuery: rewrite.cleaned,
          variants: rewrite.variants,
          wasRewritten: rewrite.wasRewritten,
          retrieved: retrieved.length,
          kept: 0,
          dropped: retrieved.length,
          grades: judgeResult.grades,
        },
      });
    }

    // ── CRAG Step 4: Guarded Generation ──
    const contextChunks = kept.slice(0, MAX_CONTEXT_CHUNKS);
    const context = contextChunks
      .map(
        (d, i) =>
          `[#${i + 1}${d.metadata?.loc?.pageNumber ? ` page ${d.metadata.loc.pageNumber}` : ""}]\n${d.pageContent}`,
      )
      .join("\n\n---\n\n");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server missing GEMINI_API_KEY" },
        { status: 500 },
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { temperature: 0.1 },
    });

    const result = await model.generateContent(
      `CONTEXT:\n\n${context}\n\nQUESTION: ${question}`,
    );
    const answer =
      result.response.text() || "I could not find this in the document.";

    return NextResponse.json({
      answer,
      sources: contextChunks.map((d) => ({
        page: d.metadata?.loc?.pageNumber,
        text: d.pageContent,
        source: d.metadata?.source,
      })),
      rag: {
        originalQuery: question,
        rewrittenQuery: rewrite.cleaned,
        variants: rewrite.variants,
        wasRewritten: rewrite.wasRewritten,
        retrieved: retrieved.length,
        kept: judgeResult.kept,
        dropped: judgeResult.dropped,
        grades: judgeResult.grades,
      },
    });
  } catch (err) {
    console.error("query error", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
