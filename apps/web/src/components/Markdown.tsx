import type { ReactNode } from 'react';

/**
 * A small Markdown renderer for reports (the workout history and the coach's reports): headings,
 * paragraphs, bullet lists (nested by two spaces), tables, code blocks, **bold**, `code` and a
 * trailing <sub> line. It builds React elements, never HTML strings, so text from a report can't
 * inject anything into the page.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{blocks(text.replace(/\r\n/g, '\n'))}</div>;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? <b key={`${keyBase}-${n++}`}>{t.slice(2, -2)}</b> : <code key={`${keyBase}-${n++}`}>{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

interface Item {
  text: string;
  children: Item[];
}

function listItems(lines: string[]): Item[] {
  const root: Item[] = [];
  const stack: { indent: number; items: Item[] }[] = [{ indent: -1, items: root }];
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const text = line.trim().replace(/^[-*]\s+/, '');
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const item: Item = { text, children: [] };
    stack[stack.length - 1]!.items.push(item);
    stack.push({ indent, items: item.children });
  }
  return root;
}

function renderList(items: Item[], key: string): ReactNode {
  return (
    <ul key={key}>
      {items.map((it, i) => (
        <li key={i}>
          {inline(it.text, `${key}-${i}`)}
          {it.children.length > 0 && renderList(it.children, `${key}-${i}-c`)}
        </li>
      ))}
    </ul>
  );
}

function blocks(text: string): ReactNode[] {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    if (t.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) body.push(lines[i++]!);
      i++;
      out.push(
        <pre key={k++}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      const level = h[1]!.length;
      const content = inline(h[2]!, `h${k}`);
      out.push(level === 1 ? <h1 key={k++}>{content}</h1> : level === 2 ? <h2 key={k++}>{content}</h2> : <h3 key={k++}>{content}</h3>);
      i++;
      continue;
    }
    if (t.startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]!)) {
      const head = cells(t);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!));
      const empty = head.every((c) => !c);
      out.push(
        <div className="md-table" key={k++}>
          <table>
            {!empty && (
              <thead>
                <tr>
                  {head.map((c, j) => (
                    <th key={j}>{inline(c, `th${k}-${j}`)}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c, `td${k}-${ri}-${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^[-*]\s+/.test(t)) {
      const group: string[] = [];
      while (i < lines.length && lines[i]!.trim() && (/^\s*[-*]\s+/.test(lines[i]!) )) group.push(lines[i++]!);
      out.push(renderList(listItems(group), `l${k++}`));
      continue;
    }
    const sub = /^<sub>(.*)<\/sub>$/.exec(t);
    if (sub) {
      out.push(
        <p key={k++} className="xsmall muted">
          {sub[1]}
        </p>,
      );
      i++;
      continue;
    }
    // A paragraph runs until a blank line or the start of another block. It always takes at least
    // this line, so a stray "|" line that isn't a table can't stall the loop.
    const para: string[] = [lines[i++]!.trim()];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|[-*]\s|\||```)/.test(lines[i]!.trim())) para.push(lines[i++]!.trim());
    out.push(<p key={k++}>{inline(para.join(' '), `p${k}`)}</p>);
  }
  return out;
}
