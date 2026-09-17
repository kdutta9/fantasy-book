// A deliberately small Markdown subset, rendered to React elements.
//
// No dependency and no `dangerouslySetInnerHTML`: the whole surface this book
// needs is paragraphs, a subhead, lists, a pull quote, a rule, bold, italics,
// code and links. A parser that handles exactly that is ~80 lines and cannot
// inject anything; a general one is 40 KB and can. If the prose ever genuinely
// needs tables or images, take the dependency then — not in advance.

let nextKey = 0;
const key = () => `md${nextKey++}`;

export function Markdown({ text, className }) {
  if (!text) return null;
  const blocks = text.trim().split(/\n{2,}/);
  return <div className={className}>{blocks.map((block) => renderBlock(block))}</div>;
}

function renderBlock(block) {
  const lines = block.split("\n");

  if (/^###\s/.test(lines[0])) return <h3 key={key()} className="md-h3">{inline(lines[0].replace(/^###\s+/, ""))}</h3>;
  if (/^(---|\*\*\*)$/.test(lines[0].trim())) return <hr key={key()} className="md-hr" />;

  if (lines.every((l) => /^>\s?/.test(l))) {
    return (
      <blockquote key={key()} className="md-quote">
        {inline(lines.map((l) => l.replace(/^>\s?/, "")).join(" "))}
      </blockquote>
    );
  }

  if (lines.every((l) => /^[-*]\s+/.test(l))) {
    return (
      <ul key={key()} className="md-list">
        {lines.map((l) => <li key={key()}>{inline(l.replace(/^[-*]\s+/, ""))}</li>)}
      </ul>
    );
  }

  if (lines.every((l) => /^\d+\.\s+/.test(l))) {
    return (
      <ol key={key()} className="md-list">
        {lines.map((l) => <li key={key()}>{inline(l.replace(/^\d+\.\s+/, ""))}</li>)}
      </ol>
    );
  }

  // A hard-wrapped paragraph is still one paragraph — the .md files are written
  // to a sane column width and nobody means a line break by hitting Enter.
  return <p key={key()} className="md-p">{inline(lines.join(" "))}</p>;
}

// One pass, longest-delimiter-first, so `**bold**` is never mistaken for two
// `*italic*` markers. Links are last because their label may itself be styled.
const INLINE = [
  { re: /`([^`]+)`/, render: (m) => <code key={key()} className="md-code">{m[1]}</code> },
  { re: /\*\*([^*]+)\*\*/, render: (m) => <strong key={key()}>{inline(m[1])}</strong> },
  { re: /(?:\*|_)([^*_]+)(?:\*|_)/, render: (m) => <em key={key()}>{inline(m[1])}</em> },
  {
    re: /\[([^\]]+)\]\(([^)]+)\)/,
    render: (m) => (
      <a key={key()} className="bk-link" href={m[2]}>
        {inline(m[1])}
      </a>
    ),
  },
];

function inline(text) {
  let earliest = null;
  for (const rule of INLINE) {
    const at = text.match(rule.re);
    if (at && (earliest == null || at.index < earliest.at.index)) earliest = { rule, at };
  }
  if (!earliest) return text;
  const { rule, at } = earliest;
  return [text.slice(0, at.index), rule.render(at), ...[].concat(inline(text.slice(at.index + at[0].length)))];
}
