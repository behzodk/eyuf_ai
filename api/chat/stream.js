// api/chat/stream.mjs
export const runtime = 'edge';

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const SYSTEM = `
You are a support assistant for the document "Basic Profile.pdf".
RULES:
- Answer ONLY using the provided Context snippets from that document.
- If the answer isn't in Context, reply: "I don't have that information."
- Add (Snippet N) after each factual sentence.
- Be concise and factual. Do not invent or assume.
- Answer only in Uzbek language.
`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function retrieve(question, k = 6, minSim = 0.30) {
  const emb = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: question
  });
  const vec = emb.data[0].embedding;

  const { data: rows, error } = await supabase.rpc('match_docs', {
    query_embedding: vec,
    match_count: k
  });
  if (error) throw error;

  const filtered = rows.filter((r) => r.similarity >= minSim);
  return { filtered };
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const question = (searchParams.get('question') || '').trim();
  if (!question) return new Response('Missing question', { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode(
          (event ? `event: ${event}\n` : '') +
          `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
        ));
      };

      try {
        const { filtered } = await retrieve(question, 6, 0.30);
        if (filtered.length === 0) {
          send('delta', "I don't have that information.");
          send('citations', []);
          send('done', {});
          controller.close();
          return;
        }

        const context = filtered
          .map((r, i) => `[Snippet ${i + 1}] path: ${r.path}\n${r.content}`)
          .join('\n\n');

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM },
            {
              role: 'user',
              content: `Question: ${question}

Context:
${context}

Return only the answer text now, with (Snippet N) after each factual sentence.`
            }
          ]
        });

        let full = '';
        for await (const part of completion) {
          const token = part?.choices?.[0]?.delta?.content || '';
          if (token) {
            full += token;
            send('delta', token);
          }
        }

        // Validate citations after the stream
        const CITEREG = /\(Snippet\s+(\d+)\)/g;
        const found = new Set();
        let m;
        while ((m = CITEREG.exec(full)) !== null) found.add(Number(m[1]));
        const validSnips = new Set(filtered.map((_, i) => i + 1));
        const allValid = [...found].every((n) => validSnips.has(n));

        if (!/\(Snippet\s+\d+\)/.test(full) || !allValid) {
          send('replace', { answer: "I don't have that information.", citations: [] });
          controller.close();
          return;
        }

        const citations = [...found].sort((a,b)=>a-b).map((n) => ({
          snippet: n,
          path: filtered[n - 1]?.path || 'Basic Profile.pdf',
        }));

        send('citations', citations);
        send('done', { finish_reason: 'stop' });
      } catch (err) {
        console.error(err);
        send('error', { message: 'Server error' });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    }
  });
}
