"use client";

import { useState, useRef, FormEvent } from "react";

type Source = {
  page?: number;
  text: string;
  source?: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};

export default function Home() {
  const [docId, setDocId] = useState<string | null>(null);
  const [docName, setDocName] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadStatus({ type: "info", text: "Reading and indexing document…" });
    setMessages([]);
    setDocId(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/ingest", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setDocId(data.docId);
      setDocName(data.source);
      setUploadStatus({
        type: "success",
        text: `Indexed "${data.source}" — ${data.chunkCount} chunks stored in Qdrant.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setUploadStatus({ type: "error", text: msg });
    } finally {
      setUploading(false);
    }
  }

  async function handleAsk(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!question.trim() || !docId) return;

    const q = question.trim();
    setQuestion("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setAsking(true);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, docId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Query failed");

      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.answer, sources: data.sources },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Error: ${msg}` },
      ]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <main>
      <h1>NoteBook RAG</h1>
      <p className="tagline">
        Upload a PDF or text file, then ask questions grounded in its content.
        Powered by Gemini + Qdrant.
      </p>

      <form className="card" onSubmit={handleUpload}>
        <div className="upload-row">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            className="file-input"
            disabled={uploading}
          />
          <button type="submit" disabled={uploading}>
            {uploading ? "Indexing…" : "Upload & index"}
          </button>
        </div>
        {uploadStatus && (
          <div className={`status ${uploadStatus.type}`}>
            {uploadStatus.text}
          </div>
        )}
      </form>

      <div className="card">
        {messages.length === 0 ? (
          <div className="empty-hint">
            {docId
              ? `Ask anything about "${docName}".`
              : "Upload a document above to start chatting."}
          </div>
        ) : (
          <div className="chat">
            {messages.map((m, i) => (
              <div key={i} className={`message ${m.role}`}>
                <div className="role-label">
                  {m.role === "user" ? "You" : "Assistant"}
                </div>
                <div>{m.content}</div>
                {m.sources && m.sources.length > 0 && (
                  <details className="sources">
                    <summary>Sources ({m.sources.length})</summary>
                    {m.sources.map((s, j) => (
                      <div key={j} className="source-item">
                        <div className="source-meta">
                          {s.source}
                          {s.page ? ` · page ${s.page}` : ""}
                        </div>
                        {s.text.length > 400
                          ? s.text.slice(0, 400) + "…"
                          : s.text}
                      </div>
                    ))}
                  </details>
                )}
              </div>
            ))}
          </div>
        )}

        <form className="input-row" onSubmit={handleAsk}>
          <input
            type="text"
            className="text-input"
            placeholder={
              docId ? "Ask a question…" : "Upload a document first…"
            }
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={!docId || asking}
          />
          <button type="submit" disabled={!docId || asking || !question.trim()}>
            {asking ? "…" : "Ask"}
          </button>
        </form>
      </div>
    </main>
  );
}
