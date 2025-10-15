// Load .env first (OPENAI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, etc.)
import "dotenv/config";

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ESM-friendly __dirname (works on Node 18+, and uses import.meta.dirname when available)
const __dirname =
  typeof import.meta.dirname !== "undefined"
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));

/* ---------- App ---------- */
const app = express();
app.use(cors());
app.use(express.json());

/* ---------- Serve /public (index.html) ---------- */
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ---------- Env checks ---------- */
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_URL or SUPABASE_ANON_KEY missing");
}

/* ---------- Clients ---------- */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/* ---------- RAG config ---------- */
const SYSTEM = `
You are a support assistant for the document "Basic Profile.pdf".
RULES:
- Answer ONLY using the provided Context snippets from that document.
- If the answer isn't in Context, reply: "I don't have that information."
- Add (Snippet N) after each factual sentence.
- Be concise and factual. Do not invent or assume.
-Answer only in uzbek language.
`;

const OutSchema = z.object({
  answer: z.string(),
  citations: z.array(z.object({ snippet: z.number().int().min(1), path: z.string() }))
});

/* ---------- Retrieval ---------- */
async function retrieve(question, k = 6, minSim = 0.28) {
  const emb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: question
  });
  const vec = emb.data[0].embedding;

  const { data: rows, error } = await supabase.rpc("match_docs", {
    query_embedding: vec,
    match_count: k
  });
  if (error) throw error;

  const filtered = rows.filter((r) => r.similarity >= minSim);
  return { rows, filtered };
}

/* ---------- Chat endpoint ---------- */
app.post("/api/chat", async (req, res) => {
  try {
    const question = (req.body?.question || "").trim();
    if (question.length < 2) {
      return res.status(400).json({ error: "Ask a question." });
    }

    const { filtered } = await retrieve(question, 6, 0.3);
    if (filtered.length === 0) {
      return res.json({ answer: "I don't have that information.", citations: [] });
    }

    const context = filtered
      .map((r, i) => `[Snippet ${i + 1}] path: ${r.path}\n${r.content}`)
      .join("\n\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Question: ${question}

Context:
${context}

Return JSON:
{
  "answer": "…sentences with (Snippet N) after each factual sentence…",
  "citations": [{"snippet":N,"path":"..."}...]
}`
        }
      ]
    });

    let payload;
    try {
      payload = OutSchema.parse(JSON.parse(completion.choices[0].message.content));
    } catch {
      return res.json({ answer: "I don't have that information.", citations: [] });
    }

    const validSnippets = new Set(filtered.map((_, i) => i + 1));
    const valid = payload.citations.every((c) => validSnippets.has(c.snippet));
    if (!valid || !/\(Snippet\s+\d+\)/.test(payload.answer)) {
      return res.json({ answer: "I don't have that information.", citations: [] });
    }

    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/chat/stream", async (req, res) => {
  // SSE headers
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // helper to send SSE events
  const send = (event, data) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
  };

  // Close handler
  let clientClosed = false;
  req.on("close", () => { clientClosed = true; });

  try {
    const question = (req.query?.question || "").toString().trim();
    if (!question) {
      send("error", { message: "Ask a question." });
      return res.end();
    }

    // 1) Retrieve context (same as your POST route)
    const { filtered } = await retrieve(question, 6, 0.30);
    if (filtered.length === 0) {
      send("delta", "I don't have that information.");
      send("citations", []);
      return res.end();
    }

    const context = filtered
      .map((r, i) => `[Snippet ${i + 1}] path: ${r.path}\n${r.content}`)
      .join("\n\n");

    // 2) Start OpenAI streaming
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Question: ${question}

Context:
${context}

Return only the answer text now, with (Snippet N) after each factual sentence.`
        }
      ],
    });

    let full = "";
    for await (const part of stream) {
      if (clientClosed) break;
      const token = part?.choices?.[0]?.delta?.content || "";
      if (token) {
        full += token;
        send("delta", token); // stream incremental text
      }
    }

    // 3) Post-stream: validate citations and send them as a separate event
    const CITEREG = /\(Snippet\s+(\d+)\)/g;
    const found = new Set();
    let m;
    while ((m = CITEREG.exec(full)) !== null) found.add(Number(m[1]));
    const validSnippets = new Set(filtered.map((_, i) => i + 1));
    const allValid = [...found].every((n) => validSnippets.has(n));

    if (!/\(Snippet\s+\d+\)/.test(full) || !allValid) {
      // Let the client know answer wasn't fully grounded
      send("warning", { message: "Answer might be ungrounded. Falling back." });
      // Client can choose to replace the message:
      send("replace", { answer: "I don't have that information.", citations: [] });
      return res.end();
    }

    // Map citations to paths and send
    const citations = [...found].sort((a,b)=>a-b).map((n) => ({
      snippet: n,
      path: filtered[n - 1]?.path || "Basic Profile.pdf",
    }));
    send("citations", citations);
    send("done", { finish_reason: "stop" });
    res.end();
  } catch (e) {
    console.error(e);
    send("error", { message: "Server error" });
    res.end();
  }
});

/* ---------- Start ---------- */
const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`Strict PDF RAG running on http://localhost:${PORT}`));``