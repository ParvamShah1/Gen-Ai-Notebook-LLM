import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { retrieveTopK } from "@/lib/rag";

export const runtime = "nodejs";
export const maxDuration = 60;

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

    const top = await retrieveTopK(question, docId, 4);
    if (top.length === 0) {
      return NextResponse.json({
        answer: "I could not find this in the document.",
        sources: [],
      });
    }

    const context = top
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
      sources: top.map((d) => ({
        page: d.metadata?.loc?.pageNumber,
        text: d.pageContent,
        source: d.metadata?.source,
      })),
    });
  } catch (err) {
    console.error("query error", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
