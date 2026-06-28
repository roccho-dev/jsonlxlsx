import { utf8Decode, isBytes } from './binary.mjs';

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(value) {
  return String(value == null ? '' : value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function stripPrefix(name) {
  return String(name || '').includes(':') ? String(name).split(':').pop() : String(name || '');
}

function readTag(src, start) {
  let quote = null;
  let i = start;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return { content: src.slice(start + 1, i), end: i + 1 };
    }
  }
  throw new Error('Unterminated XML tag');
}

function parseAttrs(s) {
  const attrs = {};
  const re = /([^\s=\/]+)\s*=\s*("[^"]*"|'[^']*')/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1]] = xmlUnescape(m[2].slice(1, -1));
  return attrs;
}

function parseXml(input) {
  const src = isBytes(input) ? utf8Decode(input) : String(input || '');
  const doc = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [doc];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      const text = xmlUnescape(src.slice(i));
      if (text) stack[stack.length - 1].children.push({ name: '#text', attrs: {}, children: [], text });
      break;
    }
    if (lt > i) {
      const text = xmlUnescape(src.slice(i, lt));
      if (text) stack[stack.length - 1].children.push({ name: '#text', attrs: {}, children: [], text });
    }
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      const text = end < 0 ? src.slice(lt + 9) : src.slice(lt + 9, end);
      if (text) stack[stack.length - 1].children.push({ name: '#text', attrs: {}, children: [], text });
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      const tag = readTag(src, lt);
      i = tag.end;
      continue;
    }
    const tag = readTag(src, lt);
    let content = tag.content.trim();
    if (content.startsWith('/')) {
      const name = content.slice(1).trim().split(/\s+/)[0];
      const node = stack.pop();
      if (!node || stripPrefix(node.name) !== stripPrefix(name)) {
        throw new Error(`XML closing tag mismatch: ${name}`);
      }
      i = tag.end;
      continue;
    }
    const selfClosing = content.endsWith('/');
    if (selfClosing) content = content.slice(0, -1).trim();
    const m = /^(\S+)/.exec(content);
    if (!m) throw new Error('Invalid XML tag');
    const name = m[1];
    const node = { name, attrs: parseAttrs(content.slice(name.length)), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = tag.end;
  }
  if (stack.length !== 1) throw new Error(`Unclosed XML tag: ${stack[stack.length - 1].name}`);
  return doc.children.find(c => c.name !== '#text') || doc;
}

function textOf(node) {
  if (!node) return '';
  if (node.name === '#text') return node.text || '';
  return (node.children || []).map(textOf).join('');
}

function children(node, localName) {
  if (!node) return [];
  return (node.children || []).filter(c => c.name !== '#text' && (!localName || stripPrefix(c.name) === localName));
}

function firstChild(node, localName) {
  return children(node, localName)[0] || null;
}

function descendants(node, localName, out = []) {
  if (!node) return out;
  for (const child of node.children || []) {
    if (child.name !== '#text') {
      if (!localName || stripPrefix(child.name) === localName) out.push(child);
      descendants(child, localName, out);
    }
  }
  return out;
}

function attr(node, name) {
  if (!node || !node.attrs) return undefined;
  if (Object.prototype.hasOwnProperty.call(node.attrs, name)) return node.attrs[name];
  const wanted = stripPrefix(name);
  for (const [k, v] of Object.entries(node.attrs)) {
    if (stripPrefix(k) === wanted) return v;
  }
  return undefined;
}

function attrsWithoutNs(node) {
  const out = {};
  for (const [k, v] of Object.entries((node && node.attrs) || {})) out[stripPrefix(k)] = v;
  return out;
}

function serializeXml(node) {
  if (!node) return '';
  if (node.name === '#text') return xmlEscape(node.text || '');
  const attrs = Object.entries(node.attrs || {}).map(([k, v]) => ` ${k}="${xmlEscape(v)}"`).join('');
  const body = (node.children || []).map(serializeXml).join('');
  return body ? `<${node.name}${attrs}>${body}</${node.name}>` : `<${node.name}${attrs}/>`;
}

function xmlDecl(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
}

export { xmlEscape, xmlUnescape, stripPrefix, parseXml, textOf, children, firstChild, descendants, attr, attrsWithoutNs, serializeXml, xmlDecl };
