'use client';
import { useRef, useState } from 'react';

export default function Page() {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<{ who:'you'|'bot'; text:string }[]>([]);
  const esRef = useRef<EventSource|null>(null);

  const ask = () => {
    const q = input.current?.value.trim();
    if (!q) return;
    setMessages(m => [...m, { who:'you', text:q }, { who:'bot', text:'' }]);
    input.current!.value = '';
    setBusy(true);

    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    const es = new EventSource(`/api/chat/stream?question=${encodeURIComponent(q)}`);
    esRef.current = es;

    es.addEventListener('delta', (e) => {
      setMessages(m => {
        const last = m[m.length-1];
        const head = m.slice(0, -1);
        return [...head, { ...last, text: last.text + (e as MessageEvent).data }];
      });
    });

    es.addEventListener('citations', (e) => {
      // optional: render citations (JSON)
      console.log('citations', (e as MessageEvent).data);
    });

    const finish = () => { setBusy(false); es.close(); esRef.current = null; };
    es.addEventListener('done', finish);
    es.addEventListener('error', finish);
  };

  return (
    <main style={{padding:24, fontFamily:'system-ui'}}>
      <h1>Ask about the “Basic Profile” PDF</h1>
      <div style={{margin:'10px 0'}}>
        <input ref={input} placeholder="Savolingizni yozing…" disabled={busy}
          onKeyDown={(e)=> e.key==='Enter' && ask()} style={{padding:8, width:360}}/>
        <button onClick={ask} disabled={busy} style={{marginLeft:8, padding:'8px 12px'}}>Send</button>
        {busy && <span style={{marginLeft:8}}>Streaming…</span>}
      </div>
      <div>
        {messages.map((m,i)=>(
          <div key={i} style={{maxWidth:600, margin:'8px 0',
            background:m.who==='you'?'#eef':'#111', color:m.who==='you'?'#000':'#fff',
            padding:10, borderRadius:10}}>
            {m.text}
          </div>
        ))}
      </div>
    </main>
  );
}
