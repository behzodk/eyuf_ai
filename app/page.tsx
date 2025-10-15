'use client';

import { useEffect, useRef, useState } from 'react';

type Msg = { who: 'you' | 'bot'; html?: string; text?: string };

export default function Page() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    { who: 'bot', html: `<strong>Assalomu alaykum!</strong> El-yurt umidi Foundation bo‘yicha savollarni shu yerda yozing.` }
  ]);
  const inputRef = useRef<HTMLInputElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, open]);

  function closeStream() {
    if (esRef.current) {
      try { esRef.current.close(); } catch {}
      esRef.current = null;
    }
  }

  function addYou(text: string) {
    setMessages(m => [...m, { who: 'you', text }]);
  }
  function addEmptyBot() {
    setMessages(m => [...m, { who: 'bot', text: '' }]);
  }
  function appendToLastBot(delta: string) {
    setMessages(m => {
      const last = m[m.length - 1];
      if (!last || last.who !== 'bot') return m;
      const head = m.slice(0, -1);
      return [...head, { ...last, text: (last.text ?? '') + delta }];
    });
  }
  function addBotHTML(html: string) {
    setMessages(m => [...m, { who: 'bot', html }]);
  }

  async function ask() {
    const q = inputRef.current?.value.trim() ?? '';
    if (!q) return;
    if (!open) setOpen(true);

    addYou(q);
    inputRef.current!.value = '';
    setBusy(true);

    // Placeholders
    addBotHTML(`<div class="ey-skel"></div>`);
    addBotHTML(`<span class="ey-thinking"><span></span><span></span><span></span> Fikr yuritilmoqda…</span>`);
    addEmptyBot();

    // Remove placeholders once the streaming bubble exists
    setTimeout(() => {
      setMessages(m =>
        m.filter(x =>
          x.html !== `<div class="ey-skel"></div>` &&
          x.html !== `<span class="ey-thinking"><span></span><span></span><span></span> Fikr yuritilmoqda…</span>`
        )
      );
    }, 60);

    // Start SSE
    closeStream();
    const es = new EventSource(`/api/chat/stream?question=${encodeURIComponent(q)}`);
    esRef.current = es;

    es.addEventListener('delta', (e) => appendToLastBot((e as MessageEvent).data));
    es.addEventListener('citations', (e) => {
      try {
        const cites = JSON.parse((e as MessageEvent).data) as Array<{ snippet: number; path: string }>;
        if (cites.length) {
          const html = cites.map(c => `<li>Snippet ${c.snippet} — ${c.path}</li>`).join('');
          addBotHTML(`<div class="ey-sources"><strong>Manbalar</strong><ul>${html}</ul></div>`);
        }
      } catch {}
    });

    const finish = () => { setBusy(false); closeStream(); };
    es.addEventListener('done', finish);
    es.addEventListener('error', () => {
      addBotHTML(`<span class="ey-error">Xatolik yuz berdi. Iltimos, qayta urinib ko‘ring.</span>`);
      finish();
    });
  }

  function stop() {
    closeStream();
    setBusy(false);
  }

  return (
    <>
      {/* Simple hero so the page isn’t empty */}
      <main className="ey-page">
        <section className="ey-hero">
          <div className="ey-badge">El-yurt umidi • RAG Chat</div>
          <h1>El-yurt umidi Foundation haqida savol-javob</h1>
          <p className="ey-sub">Javoblar PDF kontekstiga tayanadi va qisqa, aniq ko‘rinishda qaytariladi.</p>
          <button className="ey-primary" onClick={() => setOpen(true)}>Chatni ochish</button>
        </section>
      </main>

      {/* Floating Chat */}
      <div className={`ey-chat-root ${open ? 'is-open' : ''}`} aria-live="polite">
        {/* FAB */}
        <button
          className="ey-fab"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
          title={open ? 'Yopish' : 'Chatni ochish'}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3a9 9 0 1 0 3.2 17.4L21 21l-.6-3.8A9 9 0 0 0 12 3Z" stroke="currentColor" strokeWidth="1.6"/>
          </svg>
          <span>Bekki AI</span>
        </button>

        {/* Panel */}
        <section className={`ey-panel ${open ? 'open' : ''}`} role="dialog" aria-modal="true" aria-busy={busy}>
          <header className="ey-head">
            <div className="ey-avatar">EY</div>
            <div className="ey-meta">
              <div className="ey-title">Bekki AI</div>
              <div className="ey-status">{busy ? 'Fikr yuritilmoqda…' : 'Onlayn'}</div>
            </div>
            <button className="ey-x" onClick={() => setOpen(false)} aria-label="Yopish">×</button>
          </header>

          <div className="ey-bar" data-busy={busy}></div>

          <div className="ey-log" ref={logRef}>
            {messages.map((m, i) => (
              <div key={i} className={`ey-bubble ${m.who === 'you' ? 'me' : 'bot'}`}>
                {m.html ? <span dangerouslySetInnerHTML={{ __html: m.html }} /> : (m.text ?? '')}
              </div>
            ))}
          </div>

          <footer className="ey-row">
            <input
              ref={inputRef}
              placeholder="Savolingizni yozing…"
              onKeyDown={(e) => e.key === 'Enter' && !busy && ask()}
              disabled={busy}
            />
            <button className="ey-stop" onClick={stop} style={{ display: busy ? 'inline-flex' : 'none' }}>
              To‘xtatish
            </button>
            <button className="ey-send" onClick={ask} disabled={busy}>Yuborish</button>
          </footer>
        </section>
      </div>

      {/* Global palette */}
      <style jsx global>{`
        :root{
          --ey-bg:#0b1220; --ey-panel:#0f1a2b; --ey-card:#121f35; --ey-text:#eaf0ff;
          --ey-muted:#9bb0d4; --ey-accent:#2b76ff; --ey-accent-2:#25d0ff;
          --ey-border:#21304a; --ey-success:#18c08f; --ey-danger:#ff6b6b;
          --ey-shadow:0 16px 40px rgba(0,0,0,.35);
        }
        @media (prefers-color-scheme: light){
          :root{
            --ey-bg:#f6f9ff; --ey-panel:#ffffff; --ey-card:#ffffff; --ey-text:#0b1220;
            --ey-muted:#5b6b88; --ey-border:#e3e9f5; --ey-shadow:0 16px 40px rgba(0,0,0,.08);
          }
        }
        html, body {
          margin:0; padding:0;
          background:
            radial-gradient(1100px 800px at 85% -10%, rgba(37,208,255,.22), transparent 60%),
            radial-gradient(900px 700px at -10% 120%, rgba(43,118,255,.18), transparent 60%),
            var(--ey-bg);
          color: var(--ey-text);
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        }
      `}</style>

      {/* Component styles */}
      <style jsx>{`
        /* Page */
        .ey-page { min-height: 60vh; display: grid; place-items: center; padding: 40px 20px; }
        .ey-hero { text-align: center; max-width: 720px; }
        .ey-badge { display:inline-block; padding:6px 10px; border-radius:999px; background:linear-gradient(135deg, rgba(43,118,255,.2), rgba(37,208,255,.2)); color:var(--ey-text); border:1px solid rgba(255,255,255,.14); font-size:12px; margin-bottom:10px }
        .ey-hero h1 { margin: 8px 0 6px; font-size: 28px; font-weight: 700; letter-spacing: .2px }
        .ey-sub { color: var(--ey-muted); margin: 0 0 14px }
        .ey-primary { padding: 10px 14px; border:0; border-radius: 12px; color:#fff; cursor:pointer; box-shadow: var(--ey-shadow);
          background: radial-gradient(60% 120% at 100% 0%, var(--ey-accent-2), transparent), linear-gradient(135deg, var(--ey-accent), #0047ff);
          transition: transform .15s ease;
        }
        .ey-primary:active { transform: translateY(1px) }

        /* Floating root */
        .ey-chat-root{ position: fixed; right: 22px; bottom: 22px; z-index: 1000 }
        .ey-chat-root.is-open .ey-fab{ opacity: 0; pointer-events: none; transform: translateY(6px) scale(.96) }

        /* FAB */
        .ey-fab{ display:flex; align-items:center; gap:8px; padding:12px 14px; border:0; border-radius: 999px; color:#fff; cursor:pointer; box-shadow: var(--ey-shadow);
          background: radial-gradient(80% 200% at 100% -20%, var(--ey-accent-2), transparent), linear-gradient(135deg, var(--ey-accent), #0c54ff);
          transition: transform .16s ease, opacity .16s ease;
          z-index: 1;
        }
        .ey-fab:hover { transform: translateY(-1px) }

        /* PANEL — FLEX COLUMN so footer always fits */
        .ey-panel{
          position:absolute; right: 0; bottom: 64px;
          width: 380px;
          height: min(80vh, 600px);                 /* responsive height */
          background: var(--ey-panel);
          border: 1px solid var(--ey-border); border-radius: 16px; overflow: hidden; box-shadow: var(--ey-shadow);
          transform-origin: 90% 100%; transform: scale(.96) translateY(8px); opacity: 0; pointer-events: none;
          transition: transform .18s cubic-bezier(.2,.8,.2,1), opacity .18s;
          z-index: 2;

          display: flex;                            /* key: flex column */
          flex-direction: column;
        }
        .ey-panel.open{ transform: scale(1) translateY(0); opacity: 1; pointer-events: auto; }

        .ey-head{
          flex: 0 0 auto;
          display:flex; align-items:center; gap:10px; padding: 12px 14px; border-bottom: 1px solid var(--ey-border);
          background: linear-gradient(180deg, rgba(255,255,255,.04), transparent)
        }
        .ey-avatar{ width: 32px; height: 32px; border-radius: 50%; display:grid; place-items:center; font-weight: 700; color:#fff;
          background: linear-gradient(135deg, var(--ey-accent), #0c54ff); box-shadow: 0 0 0 6px rgba(43,118,255,.1) }
        .ey-meta{ line-height: 1.25 }
        .ey-title{ font-weight: 700 }
        .ey-status{ font-size: 12px; color: var(--ey-muted) }
        .ey-x{ margin-left:auto; background: transparent; border:0; color: var(--ey-muted); font-size: 20px; cursor:pointer }

        .ey-bar{
          flex: 0 0 3px;
          height:3px; width:0%;
          background: linear-gradient(90deg, var(--ey-accent), var(--ey-accent-2));
          transition: width .7s ease
        }
        .ey-panel[aria-busy="true"] .ey-bar { width: 85% }
        .ey-panel[aria-busy="false"] .ey-bar { width: 0% }

        /* Chat log fills remaining space */
        .ey-log{
          flex: 1 1 auto;                           /* fills leftover */
          min-height: 0;                            /* enables overflow in flex */
          overflow:auto;
          padding:14px; display:flex; flex-direction:column; gap:10px;
          background: radial-gradient(500px 300px at 85% 10%, rgba(43,118,255,.08), transparent 60%),
                      radial-gradient(500px 300px at 0% 100%, rgba(37,208,255,.08), transparent 60%);
        }

        .ey-bubble{ max-width: 78%; padding:10px 12px; border-radius: 14px; border: 1px solid var(--ey-border); background: var(--ey-card); animation: eyDrop .18s ease forwards; opacity: 0; transform: translateY(6px) }
        .ey-bubble.me{ margin-left:auto; border-bottom-right-radius:6px; background: linear-gradient(180deg, rgba(255,255,255,.02), transparent), var(--ey-card) }
        .ey-bubble.bot{ margin-right:auto; border-bottom-left-radius:6px }
        @keyframes eyDrop { to { opacity: 1; transform: none } }

        .ey-sources{ margin-top:6px; padding-top:6px; border-top:1px dashed var(--ey-border); color: var(--ey-muted); font-size: 12px }
        .ey-sources ul{ margin:6px 0 0 16px; padding:0 }

        /* Footer stays visible */
        .ey-row{
          flex: 0 0 auto;                           /* fixed block at bottom */
          display:flex; gap:8px; padding: 10px; border-top: 1px solid var(--ey-border);
          background: linear-gradient(180deg, rgba(255,255,255,.03), transparent);
          padding-bottom: max(10px, env(safe-area-inset-bottom)); /* iOS safe area */
        }
        .ey-row input{ flex:1; padding:10px 12px; border-radius: 12px; border:1px solid var(--ey-border); outline: none; background: var(--ey-card); color: var(--ey-text) }
        .ey-send, .ey-stop{ padding:10px 12px; border:0; border-radius:12px; color:#fff; cursor:pointer }
        .ey-send{ background: linear-gradient(135deg, var(--ey-accent), #0c54ff) }
        .ey-stop{ background: linear-gradient(135deg, var(--ey-danger), #ff8f8f) }

        /* Thinking dots */
        .ey-thinking{ display:inline-flex; align-items:center; gap:6px; color: var(--ey-muted); font-size: 13px }
        .ey-thinking span { width:6px; height:6px; border-radius:50%; background: var(--ey-muted); opacity:.6; animation: eyBounce 1.2s infinite ease-in-out }
        .ey-thinking span:nth-child(2){ animation-delay: .15s }
        .ey-thinking span:nth-child(3){ animation-delay: .30s }
        @keyframes eyBounce { 0%,80%,100% { transform: translateY(0); opacity:.4 } 40% { transform: translateY(-5px); opacity:1 } }

        /* Skeleton */
        .ey-skel{ width: 240px; height: 56px; border-radius: 12px; border:1px solid var(--ey-border);
          background: linear-gradient(90deg, rgba(255,255,255,.05), rgba(255,255,255,.12), rgba(255,255,255,.05));
          background-size: 250% 100%; animation: eyShimmer 1.2s linear infinite }
        @keyframes eyShimmer{ 0%{ background-position: 200% 0 } 100%{ background-position: -40% 0 } }

        .ey-error{ color: var(--ey-danger) }

        /* Mobile: taller panel so footer never clips */
        @media (max-width: 480px){
          .ey-panel{ width: 94vw; height: min(80vh, 680px); bottom: 70px; }
        }
      `}</style>
    </>
  );
}
