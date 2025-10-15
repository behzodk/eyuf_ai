export const runtime = 'edge';

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const SYSTEM = `
You are a support assistant for El yurt umidi foundation.
RULES:
- Answer ONLY using the provided Context snippets from that document but you can search somethings from internet or past data.
- If the answer isn't in Context or clear in internet, reply: "Menda faqat El-yurt Umidi Foundation haqidagi savollarga javob bera olaman."
- Add (Snippet N) after each factual sentence.
- Be concise and factual. Do not invent or assume.
- Answer only in Uzbek language.
- Never answer in english
`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

async function retrieve(question: string, k = 6, minSim = 0.30) {
  const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: question });
  const vec = emb.data[0].embedding;
  const { data: rows, error } = await supabase.rpc('match_docs', {
    query_embedding: vec, match_count: k
  });
  if (error) throw error;
  const filtered = (rows ?? []).filter((r: any) => r.similarity >= minSim);
  return { filtered };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const question = (searchParams.get('question') || '').trim();
  if (!question) return new Response('Missing question', { status: 400 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const closeOnce = () => {
        if (!closed) {
          closed = true;
          try { controller.close(); } catch {}
        }
      };

      const send = (event: string | null, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              (event ? `event: ${event}\n` : '') +
              `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
            )
          );
        } catch {
          // enqueue can throw if client disconnected; stop further writes
          closeOnce();
        }
      };

      // If the client disconnects, stop writing
      // (Edge runtime exposes an AbortSignal on Request)
      const abort = (req as any).signal as AbortSignal | undefined;
      abort?.addEventListener('abort', () => closeOnce());

      try {
        const { filtered } = await retrieve(question, 6, 0.30);

        if (!filtered.length) {
          send('delta', "Menda bunday ma'lumot yo'q.");
          send('citations', []);
          send('done', {});
          return closeOnce();
        }

        const context = filtered.map((r: any, i: number) =>
          `[Snippet ${i+1}] path: ${r.path}\n${r.content}`
        ).join('\n\n');

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content:
`Question: ${question}

Context:
${context}

Return only the answer text now, with (Snippet N) after each factual sentence.` }
          ]
        });

        let full = '';
        for await (const part of completion) {
          const tok = part?.choices?.[0]?.delta?.content || '';
          if (tok) { full += tok; send('delta', tok); }
          if (closed) break;
        }

        // Validate citations
        const CITEREG = /\(Snippet\s+(\d+)\)/g;
        const found = new Set<number>(); let m: RegExpExecArray | null;
        while ((m = CITEREG.exec(full)) !== null) found.add(Number(m[1]));
        const validSnips = new Set(filtered.map((_: any, i: number) => i + 1));
        const allValid = [...found].every(n => validSnips.has(n));

        if (!/\(Snippet\s+\d+\)/.test(full) || !allValid) {
          send('replace', { answer: "Menda bunday ma'lumot yo'q.", citations: [] });
          return closeOnce();
        }

        const citations = [...found].sort((a,b)=>a-b).map(n => ({
          snippet: n,
          path: filtered[n-1]?.path || 'Basic Profile.pdf'
        }));
        send('citations', citations);
        send('done', { finish_reason: 'stop' });
        return closeOnce();

      } catch (e) {
        send('error', { message: 'Server error' });
        return closeOnce();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform'
    }
  });
}
