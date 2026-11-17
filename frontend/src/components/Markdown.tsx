import type { ReactNode } from "react";

// A small, safe reading of Markdown for work item descriptions and comments: headings, paragraphs,
// "-" and "1." lists, > quotes, ``` code blocks, `code`, **bold**, *italic*, [links](https://…),
// bare web addresses and @mentions. Everything becomes React elements; no HTML from the text is
// ever put on the page, and only http(s) and mailto links are made.

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function inline(text: string, mentionable: Set<string>, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: code first (nothing inside it is read), then links, bold, italic, mentions, bare URLs.
  const pattern = /(`[^`]+`)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*)\*(?!\w)|(?<![\w_])_([^_\s][^_]*)_(?!\w)|(^|[^\w@])@([a-z0-9._-]{2,40})|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/gi;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2] && m[3]) {
      out.push(
        SAFE_URL.test(m[3]) ? (
          <a key={k} href={m[3]} target="_blank" rel="noreferrer noopener">
            {m[2]}
          </a>
        ) : (
          <span key={k}>{m[2]}</span>
        ),
      );
    } else if (m[4]) out.push(<b key={k}>{inline(m[4], mentionable, k)}</b>);
    else if (m[5] || m[6]) out.push(<i key={k}>{m[5] ?? m[6]}</i>);
    else if (m[8]) {
      // The character before the @ (a space, a bracket) stays as plain text.
      if (m[7]) out.push(m[7]);
      const name = m[8].toLowerCase();
      out.push(
        mentionable.has(name) ? (
          <span key={k} className="md-mention">
            @{m[8]}
          </span>
        ) : (
          `@${m[8]}`
        ),
      );
    } else if (m[9]) {
      out.push(
        <a key={k} href={m[9]} target="_blank" rel="noreferrer noopener">
          {m[9]}
        </a>,
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text, usernames = [], className = "" }: { text: string; usernames?: string[]; className?: string }) {
  const mentionable = new Set(usernames.map((u) => u.toLowerCase()));
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] | null = null;
  let para: string[] = [];
  let code: string[] | null = null;
  const k = () => `b${blocks.length}`;
  const lines = (ls: string[], key: string) =>
    ls.flatMap((l, i) => [...(i ? [<br key={`${key}-br${i}`} />] : []), ...inline(l, mentionable, `${key}-${i}`)]);
  const flushPara = () => {
    if (para.length) blocks.push(<p key={k()}>{lines(para, k())}</p>);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it, mentionable, `${k()}-${i}`)}</li>);
      blocks.push(list.ordered ? <ol key={k()}>{items}</ol> : <ul key={k()}>{items}</ul>);
    }
    list = null;
  };
  const flushQuote = () => {
    if (quote) blocks.push(<blockquote key={k()}>{lines(quote, k())}</blockquote>);
    quote = null;
  };
  const flush = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (raw.trim().startsWith("```")) {
      if (code) {
        blocks.push(
          <pre key={k()}>
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = null;
      } else {
        flush();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(raw);
      continue;
    }
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const q = line.match(/^>\s?(.*)$/);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      const level = heading[1].length;
      const content = inline(heading[2], mentionable, k());
      blocks.push(level === 1 ? <h4 key={k()}>{content}</h4> : level === 2 ? <h5 key={k()}>{content}</h5> : <h6 key={k()}>{content}</h6>);
    } else if (bullet || numbered) {
      flushPara();
      flushQuote();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (q) {
      flushPara();
      flushList();
      (quote ??= []).push(q[1]);
    } else {
      flushList();
      flushQuote();
      para.push(line);
    }
  }
  if (code) blocks.push(<pre key={k()}><code>{(code as string[]).join("\n")}</code></pre>);
  flush();
  return <div className={`md ${className}`}>{blocks}</div>;
}
