const blank = /^[ \t]*$/;
const trim = (s) => s.replace(/^[ \t]+|[ \t]+$/g, '');
const fence = /^\x60{3}([A-Za-z0-9_+-]*)[ \t]*$/;
const closeFence = /^\x60{3}[ \t]*$/;
const heading = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const rule = /^(?:---|\*\*\*)[ \t]*$/;
const bullet = /^[-*] (.*)$/;
const ordered = /^(\d{1,9})\. (.*)$/;
const continued = /^ {2,}\S/;
const escapable = '\\`*_[]()#+-.!>';
const entity = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function delimiter(text, from, marker) {
  // Skip an escaped pair, and for emphasis consume pairs of stars as a unit.
  for (let at = from; at < text.length; at++) {
    const char = text[at];
    if (char === '\\' && at + 1 < text.length && escapable.includes(text[at + 1])) {
      at++;
    } else if (marker === ']' && char === ']') {
      return at;
    } else if (marker !== ']' && char === '*') {
      if (text[at + 1] === '*') {
        if (marker === '**') return at;
        at++;
      } else if (marker === '*') {
        return at;
      }
    }
  }
  return -1;
}

function spans(text, link, escape) {
  const special = /[\\\x60*\[&<>"']/g;
  let cursor = 0;
  let output = '';
  for (let match; (match = special.exec(text));) {
    const at = match.index;
    const char = match[0];
    output += text.slice(cursor, at);
    cursor = at + 1;

    if (char === '\\' && cursor < text.length && escapable.includes(text[cursor])) {
      const next = text[cursor++];
      output += entity[next] ?? next;
    } else if (char === '`') {
      const close = text.indexOf('`', cursor);
      if (close > cursor) {
        output += '<code>' + escape(text.slice(cursor, close)) + '</code>';
        cursor = close + 1;
      } else {
        output += char;
      }
    } else if (char === '*') {
      const strong = text[cursor] === '*';
      if (strong) cursor++;
      const marker = strong ? '**' : '*';
      const close = delimiter(text, cursor, marker);
      if (close > cursor) {
        const tag = strong ? 'strong' : 'em';
        output += '<' + tag + '>' + spans(text.slice(cursor, close), link, escape) + '</' + tag + '>';
        cursor = close + marker.length;
      } else {
        output += marker;
      }
    } else if (char === '[') {
      const close = delimiter(text, cursor, ']');
      const end = close >= 0 && text[close + 1] === '(' ? text.indexOf(')', close + 2) : -1;
      if (end > close + 2) {
        const target = text.slice(close + 2, end);
        if (!/\s/.test(target)) {
          output += '<a href="' + escape(link(target)) + '">' + spans(text.slice(cursor, close), link, escape) + '</a>';
          cursor = end + 1;
          special.lastIndex = cursor;
          continue;
        }
      }
      output += '[';
    } else {
      output += entity[char] ?? char;
    }
    special.lastIndex = cursor;
  }
  return output + text.slice(cursor);
}

function breaksParagraph(line) {
  switch (line[0]) {
    case '`': return fence.test(line);
    case '#': return Boolean(heading.exec(line)?.[2]);
    case '*':
    case '-': return rule.test(line);
    case ' ':
    case '\t':
    case undefined: return blank.test(line);
    default: return false;
  }
}

// Render blocks as they are recognized. Paragraph boundaries deliberately differ from block starts.
export function markdown(body, link, escape, headingId) {
  const lines = body.split('\n');
  const inline = (text) => spans(text, link, escape);
  let content = '';
  let excerpt;
  const toc = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i++];
    const first = line[0];
    if ((first === undefined || first === ' ' || first === '\t') && blank.test(line)) continue;
    const code = first === '`' ? fence.exec(line) : null;
    const title = first === '#' ? heading.exec(line) : null;
    if (code) {
      const lang = code[1];
      content += lang ? '<pre><code class="language-' + lang + '">' : '<pre><code>';
      while (i < lines.length && !closeFence.test(lines[i])) content += escape(lines[i++]) + '\n';
      i++;
      content += '</code></pre>\n';
    } else if (title?.[2]) {
      const level = title[1].length;
      const id = headingId(title[2]);
      const html = inline(title[2]);
      if (level === 2 || level === 3) toc.push({ level, id, html });
      content += '<h' + level + ' id="' + id + '">' + html + '</h' + level + '>\n';
    } else if ((first === '-' || first === '*') && rule.test(line)) {
      content += '<hr>\n';
    } else if (first === '>') {
      let quoted = trim(line.slice(1));
      while (lines[i]?.[0] === '>') {
        const next = trim(lines[i++].slice(1));
        if (next) quoted += (quoted ? '\n' : '') + next;
      }
      content += '<blockquote>\n' + (quoted ? '<p>' + inline(quoted) + '</p>\n' : '') + '</blockquote>\n';
    } else {
      const marker = first === '-' || first === '*' ? bullet : first >= '0' && first <= '9' ? ordered : null;
      const item = marker?.exec(line);
      if (item) {
        const numbered = marker === ordered;
        const field = numbered ? 2 : 1;
        const type = numbered ? 'ol' : 'ul';
        const start = numbered ? Number(item[1]) : 1;
        content += '<' + type + (start !== 1 ? ' start="' + start + '"' : '') + '>\n';
        let current = trim(item[field]);
        while (i < lines.length) {
          const next = marker.exec(lines[i]);
          if (next) {
            content += '<li>' + inline(current) + '</li>\n';
            current = trim(next[field]);
          } else if (continued.test(lines[i])) {
            current += '\n' + trim(lines[i]);
          } else {
            break;
          }
          i++;
        }
        content += '<li>' + inline(current) + '</li>\n</' + type + '>\n';
      } else {
        let paragraph = trim(line);
        while (i < lines.length && !breaksParagraph(lines[i])) paragraph += '\n' + trim(lines[i++]);
        const html = inline(paragraph);
        excerpt ??= html;
        content += '<p>' + html + '</p>\n';
      }
    }
  }
  return { content, toc, excerpt: excerpt ?? '' };
}

