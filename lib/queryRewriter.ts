import { GoogleGenerativeAI } from "@google/generative-ai";

export type RewriteResult = {
  cleaned: string;
  variants: string[];
  wasRewritten: boolean;
};

// Uses a fast model to clean up typos/abbreviations and generate
// alternative phrasings so retrieval has a better chance of matching
// relevant chunks even when the user's wording is imprecise.
export async function rewriteQuery(
  originalQuery: string,
): Promise<RewriteResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { cleaned: originalQuery, variants: [], wasRewritten: false };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { temperature: 0.3 },
    });

    const result = await model.generateContent(
      `You are a query rewriter for a document Q&A system.

Given a user question, do two things:
1. Clean the query: fix typos, expand abbreviations, make it a clear standalone question.
2. Generate exactly 2 alternative paraphrases that use different vocabulary but ask the same thing.

Respond in this exact JSON format (no markdown, no code fences):
{"cleaned": "...", "variants": ["...", "..."]}

User question: ${originalQuery}`,
    );

    const text = result.response.text().trim();
    // Strip potential markdown fences
    const jsonStr = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(jsonStr);

    const cleaned =
      typeof parsed.cleaned === "string" ? parsed.cleaned : originalQuery;
    const variants = Array.isArray(parsed.variants)
      ? parsed.variants.filter((v: unknown) => typeof v === "string").slice(0, 2)
      : [];
    const wasRewritten =
      cleaned.toLowerCase().trim() !== originalQuery.toLowerCase().trim();

    return { cleaned, variants, wasRewritten };
  } catch {
    // If rewriting fails, fall back to the original query.
    return { cleaned: originalQuery, variants: [], wasRewritten: false };
  }
}
