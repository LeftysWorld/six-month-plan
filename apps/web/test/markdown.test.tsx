import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { Markdown } from '../src/components/Markdown.tsx';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

test('headings, tables, nested lists, bold and code', () => {
  const out = html('# Title\n\nSome **bold** and `code`.\n\n| A | B |\n|---|---|\n| 1 | x \\| y |\n\n- one\n  - nested\n- two\n\n<sub>fine print</sub>');
  assert.match(out, /<h1>Title<\/h1>/);
  assert.match(out, /<b>bold<\/b>/);
  assert.match(out, /<code>code<\/code>/);
  assert.match(out, /<th>A<\/th><th>B<\/th>/);
  assert.match(out, /<td>x \| y<\/td>/);
  assert.match(out, /<li>one<ul><li>nested<\/li><\/ul><\/li><li>two<\/li>/);
  assert.match(out, /fine print/);
});

test('text from a report is never treated as HTML', () => {
  const out = html('Hello <img src=x onerror=alert(1)> **<script>x</script>**');
  assert.ok(!out.includes('<img'));
  assert.ok(!out.includes('<script>'));
  assert.match(out, /&lt;img/);
});

test('a stray table-looking line does not hang', () => {
  assert.match(html('| not a table\nnext line'), /not a table/);
});

test('renders a whole workout report', { skip: !process.env.REPORT_MD }, () => {
  const out = html(readFileSync(process.env.REPORT_MD!, 'utf8'));
  assert.ok((out.match(/<table>/g) ?? []).length >= 4);
});
