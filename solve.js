import { markdown } from './markdown.js';

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const html = (s) => /[&<>"']/.test(s) ? s.replace(/[&<>"']/g, (c) => entities[c]) : s;
const order = (a, b) => (a < b ? -1 : Number(a > b));
const trim = (s) => s.replace(/^[ \t]+|[ \t]+$/g, '');
const blank = /^[ \t]*$/;
const directory = (path) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function slugOf(s) {
  const plain = /[^\x00-\x7f]/.test(s) ? s.normalize('NFKD').replace(/\p{M}/gu, '') : s;
  const dashed = plain.replace(/[^A-Za-z0-9]+/g, '-');
  const start = Number(dashed[0] === '-');
  const end = Math.min(dashed.length, start + 64);
  return dashed.slice(start, end - Number(dashed[end - 1] === '-')).toLowerCase() || 'untitled';
}

// Each base resumes where its last collision search ended. Occupied names never disappear.
class Names {
  constructor(reserved = []) {
    this.used = new Set(reserved);
    this.next = new Map();
  }

  claim(base) {
    let name = base;
    if (this.used.has(base)) {
      let suffix = this.next.get(base) ?? 2;
      do {
        name = base + '-' + suffix++;
      } while (this.used.has(name));
      this.next.set(base, suffix);
    }
    this.used.add(name);
    return name;
  }
}

const metaKeys = new Set(['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug']);
const months = 'January February March April May June July August September October November December'.split(' ');

function metadata(text) {
  text = text.replace(/\r\n?/g, '\n');
  if (text !== '---' && !text.startsWith('---\n')) return 'no front matter';
  const closing = /\n---(?=\n|$)/g;
  const end = closing.exec(text);
  if (!end || end.index < 3) return 'the front matter is not closed';
  const lines = text.slice(4, end.index).split('\n');
  const data = { body: text.slice(end.index + 5) };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line[0] === '#' || blank.test(line)) continue;
    const pair = /^([a-z_]+):(?: (.*))?$/.exec(line);
    if (!pair) return 'line ' + (i + 2) + ' is not "key: value"';
    const key = pair[1];
    let value = (pair[2] ?? '').replace(/[ \t]+$/, '');
    const label = 'key "' + key + '"';
    if (!metaKeys.has(key)) return 'unknown key "' + key + '"';
    if (Object.hasOwn(data, key)) return label + ' is given twice';
    if (!value) return label + ' has no value';

    switch (key) {
      case 'title':
      case 'summary':
        if (value[0] === '[') return label + ': a bare string opens on [';
        if (value[0] === '"') {
          if (value.length < 2 || !value.endsWith('"')) return label + ': a quoted string is not closed';
          const inner = value.slice(1, -1);
          const special = /\\["\\]|\\|"/g;
          for (const match of inner.matchAll(special)) {
            if (match[0] === '"') return label + ': a quoted string holds a stray quote';
            if (match[0] === '\\') return label + String.raw`: a quoted string holds an escape other than \" or \\`;
          }
          value = inner.replace(/\\(["\\])/g, '$1');
        }
        break;
      case 'date': {
        const year = +value.slice(0, 4);
        const month = +value.slice(5, 7);
        const day = +value.slice(8, 10);
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const limit = month === 2 ? 28 + Number(leap) : [4, 6, 9, 11].includes(month) ? 30 : 31;
        if (!/^\d{4}-\d\d-\d\d$/.test(value) || year < 1970 || year > 2099 || month < 1 || month > 12 || day < 1 || day > limit) {
          return label + ': not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)';
        }
        break;
      }
      case 'tags': {
        if (value[0] !== '[' || !value.endsWith(']')) return label + ': not a list [a, b]';
        const inner = value.slice(1, -1);
        value = inner.trim() ? inner.split(',').map((tag) => tag.trim()) : [];
        if (value.some((tag) => !tag || /["[\]]/.test(tag))) return label + ': an empty tag, or one holding " [ or ]';
        break;
      }
      case 'draft':
        if (value !== 'true' && value !== 'false') return label + ': true or false';
        value = value === 'true';
        break;
      case 'layout':
        if (!/^[a-z0-9-]+$/.test(value)) return label + ': not a template name';
        break;
      case 'slug':
        if (value.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return label + ': not a slug';
        break;
    }
    data[key] = value;
  }
  return Object.hasOwn(data, 'title') ? data : 'no title';
}

// Paths read a lexical binding first, then traverse only own properties.
const pathSyntax = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;

function templatePath(path) {
  if (!pathSyntax.test(path)) throw new SyntaxError(JSON.stringify(path) + ' is not a path');
  const [head, ...tail] = path.split('.');
  return { head, tail };
}

function own(value, key) {
  return value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
}

function display(value) {
  switch (typeof value) {
    case 'string': return value;
    case 'number':
    case 'boolean': return String(value);
    default: return Array.isArray(value) ? value.map(display).join(', ') : '';
  }
}

function scanTemplate(source) {
  const parts = [];
  const opener = /{{{|{{|{%/g;
  let offset = 0;
  for (let match; (match = opener.exec(source));) {
    const start = match.index;
    const marker = match[0];
    const tag = marker === '{%';
    const raw = marker.length === 3;
    const stop = source.indexOf(tag ? '%}' : raw ? '}}}' : '}}', opener.lastIndex);
    if (stop < 0) throw new SyntaxError('a ' + marker + ' is not closed');
    const value = source.slice(opener.lastIndex, stop).trim();
    let after = stop + marker.length;
    let before = start;
    if (tag) {
      const line = source.lastIndexOf('\n', start - 1) + 1;
      const newline = source.indexOf('\n', after);
      const lineEnd = newline === -1 ? source.length : newline;
      if (blank.test(source.slice(line, start)) && blank.test(source.slice(after, lineEnd))) {
        before = line;
        after = newline === -1 ? lineEnd : newline + 1;
      }
    }
    if (before > offset) parts.push(source.slice(offset, before));
    parts.push(tag ? { tag: value } : { read: templatePath(value), raw });
    opener.lastIndex = offset = after;
  }
  if (offset < source.length) parts.push(source.slice(offset));
  return parts;
}

function dependencies(parts) {
  const heads = new Set();
  for (const part of parts) {
    if (typeof part === 'string') continue;
    if (part.kind === 'include') return null;
    if (part.read) heads.add(part.read.head);
    for (const branch of [part.body, part.other]) {
      if (!branch) continue;
      const inner = dependencies(branch);
      if (!inner) return null;
      if (part.kind === 'for') {
        inner.delete(part.name);
        inner.delete('loop');
      }
      for (const head of inner) heads.add(head);
    }
  }
  return heads;
}

function reusable(parts) {
  const heads = dependencies(parts);
  return heads && [...heads].every(k => k === 'site' || k === 'tags' || k === 'recent') ? [...heads] : null;
}

function memoize(fn, slots) {
  let previous, text;
  return (scope, templates, depth) => {
    const values = slots.map(slot => scope[slot]);
    if (previous && values.every((v, i) => Object.is(v, previous[i]))) return text;
    previous = values;
    return text = fn(scope, templates, depth);
  };
}

function specialize(parts, escape, binding, memo = true) {
  const blocks = [];
  let serial = 0;
  const loopSlot = binding('loop');
  const read = ({ read: { head, tail } }) => {
    let code = `s[${binding(head)}]`;
    for (const key of tail) code = `own(${code},${JSON.stringify(key)})`;
    return code;
  };

  function emit(nodes) {
    let code = '';
    for (const part of nodes) {
      if (typeof part === 'string') {
        code += `o+=${JSON.stringify(part)};`;
        continue;
      }
      if (memo && (part.kind === 'for' || part.kind === 'if')) {
        const heads = reusable([part]);
        if (heads) {
          const render = specialize([part], escape, binding, false);
          blocks.push(memoize(render, heads.map(binding)));
          code += `o+=b[${blocks.length - 1}](s,t,d);`;
          continue;
        }
      }
      if (part.kind === 'for') {
        const n = serial++;
        const a = `a${n}`, l = `l${n}`, i = `i${n}`, old = `old${n}`, previous = `previous${n}`;
        const slot = binding(part.name);
        code += `{const ${a}=${read(part)};if(Array.isArray(${a})&&${a}.length){`;
        code += `const ${old}=s[${slot}],${previous}=s[${loopSlot}],${l}={index:0,first:true,last:false,length:${a}.length};`;
        code += `s[${loopSlot}]=${l};for(let ${i}=0;${i}<${a}.length;${i}++){`;
        if (slot !== loopSlot) code += `s[${slot}]=${a}[${i}];`;
        code += `${l}.index=${i}+1;${l}.first=${i}===0;${l}.last=${i}+1===${a}.length;`;
        code += emit(part.body) + `}s[${slot}]=${old};s[${loopSlot}]=${previous};}}`;
      } else if (part.kind === 'if') {
        const v = `v${serial++}`;
        code += `{const ${v}=${read(part)};if((Array.isArray(${v})?${v}.length>0:Boolean(${v})||Number.isNaN(${v}))!==${part.negate}){`;
        code += emit(part.body) + '}';
        if (part.other) code += 'else{' + emit(part.other) + '}';
        code += '}';
      } else if (part.kind === 'include') {
        const t = `t${serial++}`;
        code += `{const ${t}=t.get(${JSON.stringify(part.name)});if(${t}&&d<8)o+=${t}(s,t,d+1);}`;
      } else {
        const value = `display(${read(part)})`;
        code += 'o+=' + (part.raw ? value : `html(${value})`) + ';';
      }
    }
    return code;
  }
  // The emitted source contains fixed syntax, slot numbers and quoted data literals.
  const code = 'return function(s,t,d){let o="";' + emit(parts) + 'return o;}';
  const render = new Function('own', 'html', 'display', 'b', code)(own, escape, display, blocks);
  const heads = memo && reusable(parts);
  return heads ? memoize(render, heads.map(binding)) : render;
}

function compile(source, escape, binding) {
  const root = [];
  const stack = [{ active: root }];
  for (const part of scanTemplate(source)) {
    const parent = stack[stack.length - 1];
    if (typeof part === 'string' || part.tag === undefined) {
      parent.active.push(part);
      continue;
    }
    const tag = part.tag;
    const each = /^for ([A-Za-z_]\w*) in (\S+)$/.exec(tag);
    const test = each ? null : /^if (not )?(\S+)$/.exec(tag);
    if (each || test) {
      const body = [];
      const node = each
        ? { kind: 'for', name: each[1], read: templatePath(each[2]), body }
        : { kind: 'if', negate: Boolean(test[1]), read: templatePath(test[2]), body };
      parent.active.push(node);
      stack.push({ node, active: body });
    } else if (tag === 'else') {
      if (parent.node?.kind !== 'if' || parent.node.other) throw new SyntaxError('an else outside an if');
      parent.active = parent.node.other = [];
    } else if (tag === 'endfor' || tag === 'endif') {
      const kind = tag.slice(3);
      if (parent.node?.kind !== kind) throw new SyntaxError('an ' + tag + ' with no open ' + kind);
      stack.pop();
    } else {
      const include = /^include "([a-z0-9-]+)"$/.exec(tag);
      if (!include) throw new SyntaxError('{% ' + tag + ' %} is not a tag');
      parent.active.push({ kind: 'include', name: include[1] });
    }
  }
  if (stack.length > 1) throw new SyntaxError('a ' + stack[stack.length - 1].node.kind + ' is not closed');
  return specialize(root, escape, binding);
}

// Most relative targets can use their path verbatim. Keep the split path
// fallback for slash runs and dot segments, including unusual source directories.
const noncanonical = /^(?:\.{1,2})(?:\/|$)|\/(?:\.{0,2})(?:\/|$)/;

function follow(dir, target) {
  if (!noncanonical.test(target)) return dir ? dir + '/' + target : target;
  const parts = dir ? dir.split('/') : [];
  for (const part of target.split('/')) {
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== '.') {
      parts.push(part);
    }
  }
  return parts.join('/');
}

const linkScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/;

// Each sticky match consumes exactly 200 complete words. The mandatory
// trailing whitespace prevents a run of non-whitespace from being split.
const wordBatch = /(?:\s*\S+\s){200}/y;
const nextWord = /\S/g;

function readingMinutes(body) {
  let minutes = 0;
  let end = 0;
  wordBatch.lastIndex = 0;
  while (wordBatch.test(body)) {
    minutes++;
    end = wordBatch.lastIndex;
  }
  nextWord.lastIndex = end;
  return Math.max(1, minutes + Number(nextWord.test(body)));
}

function longDate(date) {
  return date ? Number(date.slice(8)) + ' ' + months[Number(date.slice(5, 7)) - 1] + ' ' + date.slice(0, 4) : '';
}

function neighbor(card) {
  if (!card) return null;
  const { title, url, date, date_long } = card;
  return { title, url, date, date_long };
}

export function run(input) {
  // Escaping is pure; this cache belongs to one build and never crosses cases.
  const escaped = new Map();
  const escape = (text) => {
    let result = escaped.get(text);
    if (result === undefined) {
      result = html(text);
      escaped.set(text, result);
    }
    return result;
  };
  const { site, files } = input;
  const base = site.base_url.replace(/\/+$/, '');
  const diagnostics = [];
  const slots = new Map();
  const binding = (name) => {
    let slot = slots.get(name);
    if (slot === undefined) slots.set(name, slot = slots.size);
    return slot;
  };
  const templates = new Map();
  for (const name of Object.keys(input.templates).sort()) {
    try {
      templates.set(name, compile(input.templates[name], escape, binding));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      diagnostics.push('template "' + name + '": ' + error.message);
    }
  }

  const pages = [];
  const posts = [];
  const statics = [];
  const urls = new Map();
  const staticPaths = new Set();
  const namespaces = new Map([['', new Names(['posts', 'tags', 'page'])]]);
  const slugs = new Map();
  const slug = (str) => {
    let canonical = slugs.get(str);
    if (canonical === undefined) {
      canonical = slugOf(str);
      slugs.set(str, canonical);
    }
    return canonical;
  };

  for (const file of files.slice().sort((a, b) => order(a.path, b.path))) {
    const { path, content } = file;
    if (!path.endsWith('.md')) {
      statics.push(file);
      staticPaths.add(path);
      continue;
    }
    const data = metadata(content);
    const post = path.startsWith('posts/');
    const reserved = path.startsWith('tags/') ? 'tags' : path.startsWith('page/') ? 'page' : '';
    const layout = data.layout ?? (post ? 'post' : 'page');
    const reason = typeof data === 'string' ? data
      : reserved ? reserved + '/ is the generator\'s own'
      : post && !data.date ? 'a post needs a date'
      : templates.has(layout) ? '' : 'layout "' + layout + '" is no template that parses';
    if (reason) {
      diagnostics.push('refused ' + path + ': ' + reason);
      continue;
    }
    if (data.draft) {
      diagnostics.push('draft ' + path);
      continue;
    }

    const sourceDir = directory(path);
    const dir = post ? 'posts' : sourceDir;
    let names = namespaces.get(dir);
    if (!names) namespaces.set(dir, names = new Names());
    const id = names.claim(data.slug ?? slug(data.title));
    const route = dir ? dir + '/' + id + '/' : id + '/';
    const url = base + '/' + route;
    const page = { path, data, sourceDir, post, layout, id, route, url };
    pages.push(page);
    if (post) posts.push(page);
    urls.set(path, url);
  }

  posts.sort((a, b) => order(b.data.date, a.data.date) || order(a.id, b.id));
  const groups = new Map();
  const broken = new Set();
  const directoryLinks = new Map();
  for (const source of pages) {
    const { path, data, sourceDir } = source;
    let links = directoryLinks.get(sourceDir);
    if (!links) directoryLinks.set(sourceDir, links = new Map());
    const resolve = (target) => {
      if (target[0] === '/' || target[0] === '#' || linkScheme.test(target)) return target;
      let href = links.get(target);
      if (href === undefined) {
        const hash = target.indexOf('#');
        const linkedPath = follow(sourceDir, hash < 0 ? target : target.slice(0, hash));
        const url = urls.get(linkedPath) ?? (staticPaths.has(linkedPath) ? base + '/' + linkedPath : null);
        href = url === null || hash < 0 ? url : url + target.slice(hash);
        links.set(target, href);
      }
      if (href !== null) return href;
      broken.add('broken-link ' + path + ' -> ' + target);
      return target;
    };
    let headingNames;
    const md = markdown(data.body, resolve, escape, (text) => {
      headingNames ??= new Names();
      return headingNames.claim(slug(text));
    }, html);
    const date = data.date ?? '';
    source.card = {
      title: data.title,
      url: source.url,
      date,
      date_long: longDate(date),
      summary: data.summary ?? '',
      excerpt: md.excerpt,
      reading_minutes: readingMinutes(data.body),
      tags: [],
    };
    source.content = md.content;
    source.toc = md.toc;
  }

  const postCards = posts.map((source) => source.card);
  for (const [index, source] of posts.entries()) {
    source.newer = neighbor(postCards[index - 1]);
    source.older = neighbor(postCards[index + 1]);
    if (!source.data.tags?.length) continue;
    const seen = new Set();
    for (const name of source.data.tags) {
      const id = slug(name);
      if (seen.has(id)) continue;
      seen.add(id);
      let group = groups.get(id);
      if (!group) {
        group = { ref: { name, slug: id, url: base + '/tags/' + id + '/' }, posts: [] };
        groups.set(id, group);
      }
      source.card.tags.push(group.ref);
      group.posts.push(source.card);
    }
  }
  for (const source of pages) {
    if (source.post || !source.data.tags?.length) continue;
    const seen = new Set();
    for (const name of source.data.tags) {
      const id = slug(name);
      if (seen.has(id)) continue;
      seen.add(id);
      source.card.tags.push(groups.get(id)?.ref ?? { name, slug: id, url: '' });
    }
  }

  const sortedGroups = [...groups.values()].sort((a, b) => b.posts.length - a.posts.length || order(a.ref.slug, b.ref.slug));
  const tags = sortedGroups.map(({ ref, posts }) => ({ ...ref, count: posts.length }));
  const output = {};
  const siteSlot = binding('site');
  const tagsSlot = binding('tags');
  const recentSlot = binding('recent');
  const pageSlot = binding('page');
  const postsSlot = binding('posts');
  const pagerSlot = binding('pager');
  const tagSlot = binding('tag');

  // Each render uses the same slots. Compiled loops save and restore lexical
  // bindings, including loop, so includes see the caller's active bindings.
  const scope = new Array(slots.size).fill(undefined);
  scope[siteSlot] = { title: site.title, base_url: base };
  scope[tagsSlot] = tags;
  scope[recentSlot] = postCards.slice(0, site.recent);
  function write(path, layout) {
    const template = templates.get(layout);
    if (template) output[path] = template(scope, templates, 0);
  }

  for (const source of pages) {
    scope[pageSlot] = {
      ...source.card,
      slug: source.id,
      content: source.content,
      toc: source.toc,
      newer: source.newer ?? null,
      older: source.older ?? null,
      is_post: source.post,
    };
    write(source.route + 'index.html', source.layout);
  }
  scope[pageSlot] = undefined;
  if (templates.has('index')) {
    const total = Math.max(1, Math.ceil(posts.length / site.per_page));
    const indexUrl = (number) => base + (number === 1 ? '/' : '/page/' + number + '/');
    for (let number = 1; number <= total; number++) {
      scope[postsSlot] = postCards.slice((number - 1) * site.per_page, number * site.per_page);
      scope[pagerSlot] = {
        number,
        total,
        url: indexUrl(number),
        newer_url: number === 1 ? '' : indexUrl(number - 1),
        older_url: number === total ? '' : indexUrl(number + 1),
      };
      write(number === 1 ? 'index.html' : 'page/' + number + '/index.html', 'index');
    }
    scope[postsSlot] = undefined;
    scope[pagerSlot] = undefined;
  }
  if (templates.has('tag')) {
    for (const [index, tag] of tags.entries()) {
      scope[tagSlot] = { ...tag, posts: sortedGroups[index].posts };
      write('tags/' + tag.slug + '/index.html', 'tag');
    }
    scope[tagSlot] = undefined;
  }
  write('tags/index.html', 'tags');
  for (const file of statics) {
    if (Object.hasOwn(output, file.path)) diagnostics.push('shadowed ' + file.path + ': a built page has its path');
    else output[file.path] = file.content;
  }
  for (const message of broken) diagnostics.push(message);
  diagnostics.sort();
  diagnostics.push('built ' + (pages.length - posts.length) + ' pages, ' + posts.length + ' posts, ' + tags.length + ' tags and ' + statics.length + ' static files');
  output['build-report.txt'] = diagnostics.join('\n') + '\n';
  return output;
}
