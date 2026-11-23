const blank = /^[ \t]*$/;
const trimPattern = /^[ \t]+|[ \t]+$/g;
const horizontal = (c) => c === ' ' || c === '\t';
const trim = (text) => horizontal(text[0]) || horizontal(text[text.length - 1]) ? text.replace(trimPattern, '') : text;
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
  const candidate = text.indexOf(marker, from);
  if (candidate < 0) return -1;
  const backslash = text.indexOf('\\', from);
  if ((backslash < 0 || backslash > candidate) && (marker !== '*' || text[candidate + 1] !== '*')) {
    return candidate;
  }
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

const special = /[\\\x60*\[&<>"']/g;

function spans(text, link, escape) {
  let cursor = 0;
  let output = '';
  special.lastIndex = 0;
  for (let match; (match = special.exec(text));) {
    const at = match.index;
    const char = match[0];
    if (at > cursor) output += text.slice(cursor, at);
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

// Advance by offsets into the body. Paragraphs with no trimming keep a
// contiguous range, and fenced text can be escaped as one string.
export function markdown(body, link, escape, headingId, escapeBlock = escape) {
  let start = 0;
  let end = body.indexOf('\n');
  if (end < 0) end = body.length;
  let content = '';
  let excerpt;
  const toc = [];

  function next() {
    start = end + 1;
    end = body.indexOf('\n', start);
    if (end < 0) end = body.length;
  }

  function line() {
    return body.slice(start, end);
  }

  function isBlank(first) {
    return start === end || (horizontal(first) && blank.test(line()));
  }

  function endsParagraph(first) {
    if (isBlank(first)) return true;
    if (first === '`') return fence.test(line());
    if (first === '#') return Boolean(heading.exec(line())?.[2]);
    if (first === '-' || first === '*') return rule.test(line());
    return false;
  }

  while (start <= body.length) {
    const first = body[start];
    if (isBlank(first)) {
      next();
      continue;
    }

    const code = first === '`' ? fence.exec(line()) : null;
    if (code) {
      const language = code[1];
      content += language ? '<pre><code class="language-' + language + '">' : '<pre><code>';
      next();
      const codeStart = start;
      while (start <= body.length && (body[start] !== '`' || !closeFence.test(line()))) next();
      if (start > codeStart) {
        content += escapeBlock(body.slice(codeStart, start - 1)) + '\n';
      }
      next();
      content += '</code></pre>\n';
      continue;
    }

    const title = first === '#' ? heading.exec(line()) : null;
    if (title?.[2]) {
      const level = title[1].length;
      const id = headingId(title[2]);
      const html = spans(title[2], link, escape);
      if (level === 2 || level === 3) toc.push({ level, id, html });
      content += '<h' + level + ' id="' + id + '">' + html + '</h' + level + '>\n';
      next();
      continue;
    }

    if ((first === '-' || first === '*') && rule.test(line())) {
      content += '<hr>\n';
      next();
      continue;
    }

    if (first === '>') {
      let quote = '';
      do {
        const text = trim(body.slice(start + 1, end));
        if (text) quote += (quote ? '\n' : '') + text;
        next();
      } while (body[start] === '>');
      content += quote ? '<blockquote>\n<p>' + spans(quote, link, escape) + '</p>\n</blockquote>\n' : '<blockquote>\n</blockquote>\n';
      continue;
    }

    const marker = first === '-' || first === '*' ? bullet : first >= '0' && first <= '9' ? ordered : null;
    const item = marker?.exec(line());
    if (item) {
      const numbered = marker === ordered;
      const field = numbered ? 2 : 1;
      const type = numbered ? 'ol' : 'ul';
      const number = numbered ? Number(item[1]) : 1;
      content += '<' + type + (number !== 1 ? ' start="' + number + '"' : '') + '>\n';
      let current = trim(item[field]);
      next();
      while (start < body.length) {
        const nextItem = marker.exec(line());
        if (nextItem) {
          content += '<li>' + spans(current, link, escape) + '</li>\n';
          current = trim(nextItem[field]);
        } else if (body[start] === ' ' && continued.test(line())) {
          current += '\n' + trim(line());
        } else {
          break;
        }
        next();
      }
      content += '<li>' + spans(current, link, escape) + '</li>\n</' + type + '>\n';
      continue;
    }

    const paragraphStart = start;
    let paragraphEnd;
    let trimLines = false;
    do {
      trimLines ||= horizontal(body[start]) || horizontal(body[end - 1]);
      paragraphEnd = end;
      next();
    } while (start <= body.length && !endsParagraph(body[start]));
    let text = body.slice(paragraphStart, paragraphEnd);
    // In JavaScript, multiline anchors also recognize CR, U+2028 and U+2029,
    // unlike the block dialect's LF-only line splitting.
    if (trimLines && /[\r\u2028\u2029]/.test(text)) {
      text = text.split('\n').map(trim).join('\n');
    } else if (trimLines) {
      text = text.replace(/^[ \t]+|[ \t]+$/gm, '');
    }
    const html = spans(text, link, escape);
    excerpt ??= html;
    content += '<p>' + html + '</p>\n';
  }
  return { content, toc, excerpt: excerpt ?? '' };
}
