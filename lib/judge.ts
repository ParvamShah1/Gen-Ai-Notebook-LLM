import { GoogleGenerativeAI } from "@google/generative-ai";

export type Grade = "relevant" | "ambiguous" | "irrelevant";

export type JudgeResult = {
  grades: Grade[];
  kept: number;
  dropped: number;
};

// Uses a fast model to grade each retrieved chunk's relevance to the
// question. Irrelevant chunks are dropped before they reach the
// generation model, reducing hallucination risk (Corrective RAG).
export async function judgeChunks(
  question: string,
  chunks: { text: string }[],
): Promise<JudgeResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || chunks.length === 0) {
    return {
      grades: chunks.map(() => "relevant"),
      kept: chunks.length,
      dropped: 0,
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { temperature: 0 },
    });

    const chunkList = chunks
      .map(
        (c, i) =>
          `--- Chunk ${i + 1} ---\n${c.text.slice(0, 600)}`,
      )
      .join("\n\n");

    const result = await model.generateContent(
      `You are a strict relevance judge for a document Q&A system.

Question: ${question}

Below are retrieved text chunks. For EACH chunk, decide:
- "relevant"   — clearly helps answer the question
- "ambiguous"  — might be tangentially useful
- "irrelevant" — does not help answer the question at all

Be strict: prefer "irrelevant" over "ambiguous" when in doubt.

Respond with a JSON array of grades in order (no markdown, no code fences):
["relevant", "irrelevant", ...]

${chunkList}`,
    );

    const text = result.response.text().trim();
    const jsonStr = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed) || parsed.length !== chunks.length) {
      // Unexpected shape — keep everything as a safe fallback.
      return {
        grades: chunks.map(() => "relevant"),
        kept: chunks.length,
        dropped: 0,
      };
    }

    const grades: Grade[] = parsed.map((g: string) => {
      const lower = g.toLowerCase().trim();
      if (lower === "relevant" || lower === "ambiguous" || lower === "irrelevant")
        return lower;
      return "relevant"; // default safe
    });

    const dropped = grades.filter((g) => g === "irrelevant").length;
    return { grades, kept: chunks.length - dropped, dropped };
  } catch {
    // If judging fails, keep all chunks as a safe fallback.
    return {
      grades: chunks.map(() => "relevant"),
      kept: chunks.length,
      dropped: 0,
    };
  }
}
