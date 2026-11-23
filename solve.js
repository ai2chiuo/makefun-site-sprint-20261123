import { markdown } from './markdown.js';

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const html = (s) => s.replace(/[&<>"']/g, (c) => entities[c]);
const order = (a, b) => (a < b ? -1 : Number(a > b));
const trim = (s) => s.replace(/^[ \t]+|[ \t]+$/g, '');
const blank = /^[ \t]*$/;
const directory = (path) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function slugOf(s) {
  const plain = /[^\x00-\x7f]/.test(s) ? s.normalize('NFKD').replace(/\p{M}/gu, '') : s;
  return plain.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase().replace(/^-/, '').slice(0, 64).replace(/-$/, '') || 'untitled';
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

// Compile paths once. Only scope bindings are inherited; traversal inside values uses own properties.
const pathSyntax = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;

function reader(path) {
  if (!pathSyntax.test(path)) throw new SyntaxError(JSON.stringify(path) + ' is not a path');
  const [head, ...tail] = path.split('.');
  if (!tail.length) return (scope) => scope[head];
  if (tail.length === 1) {
    const key = tail[0];
    return (scope) => {
      const value = scope[head];
      return value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
    };
  }
  return (scope) => {
    let value = scope[head];
    for (const key of tail) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
      value = value[key];
    }
    return value;
  };
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
    parts.push(tag ? { tag: value } : { read: reader(value), raw });
    opener.lastIndex = offset = after;
  }
  if (offset < source.length) parts.push(source.slice(offset));
  return parts;
}

function render(parts, scope, templates, depth) {
  let output = '';
  for (const part of parts) {
    if (typeof part === 'string') {
      output += part;
    } else if (part.kind === 'for') {
      const items = part.read(scope);
      if (!Array.isArray(items) || !items.length) continue;
      const frame = Object.create(scope);
      const loop = { index: 0, first: true, last: false, length: items.length };
      for (let i = 0; i < items.length; i++) {
        // Define the binding even for names such as "__proto__" and "loop".
        frame[part.name] = items[i];
        frame.loop = loop;
        loop.index = i + 1;
        loop.first = i === 0;
        loop.last = i + 1 === items.length;
        output += render(part.body, frame, templates, depth);
      }
    } else if (part.kind === 'if') {
      const value = part.read(scope);
      const yes = Array.isArray(value) ? value.length > 0 : Boolean(value) || Number.isNaN(value);
      const branch = yes !== part.negate ? part.body : part.other;
      if (branch) output += render(branch, scope, templates, depth);
    } else if (part.kind === 'include') {
      const included = templates.get(part.name);
      if (included && depth < 8) output += render(included, scope, templates, depth + 1);
    } else {
      const value = display(part.read(scope));
      output += part.raw ? value : html(value);
    }
  }
  return output;
}

function compile(source) {
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
        ? { kind: 'for', name: each[1], read: reader(each[2]), body }
        : { kind: 'if', negate: Boolean(test[1]), read: reader(test[2]), body };
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
  return root;
}


function follow(dir, target) {
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

function longDate(date) {
  return date ? Number(date.slice(8)) + ' ' + months[Number(date.slice(5, 7)) - 1] + ' ' + date.slice(0, 4) : '';
}

function neighbor(card) {
  if (!card) return null;
  const { title, url, date, date_long } = card;
  return { title, url, date, date_long };
}

export function run(input) {
  const { site, files } = input;
  const base = site.base_url.replace(/\/+$/, '');
  const diagnostics = [];
  const templates = new Map();
  for (const name of Object.keys(input.templates).sort()) {
    try {
      templates.set(name, compile(input.templates[name]));
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
  for (const source of pages) {
    const { path, data, sourceDir } = source;
    const resolve = (target) => {
      if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|[/#])/.test(target)) return target;
      const hash = target.indexOf('#');
      const fragment = hash < 0 ? '' : target.slice(hash);
      const linkedPath = follow(sourceDir, hash < 0 ? target : target.slice(0, hash));
      const url = urls.get(linkedPath);
      if (url !== undefined) return url + fragment;
      if (staticPaths.has(linkedPath)) return base + '/' + linkedPath + fragment;
      broken.add('broken-link ' + path + ' -> ' + target);
      return target;
    };
    let headingNames;
    const md = markdown(data.body, resolve, html, (text) => {
      headingNames ??= new Names();
      return headingNames.claim(slug(text));
    });
    const date = data.date ?? '';
    source.card = {
      title: data.title,
      url: source.url,
      date,
      date_long: longDate(date),
      summary: data.summary ?? '',
      excerpt: md.excerpt,
      reading_minutes: Math.max(1, Math.ceil((data.body.match(/\S+/g)?.length ?? 0) / 200)),
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
  const shared = Object.assign(Object.create(null), {
    site: { title: site.title, base_url: base },
    tags,
    recent: postCards.slice(0, site.recent),
  });
  const output = {};
  function write(path, layout, values) {
    const template = templates.get(layout);
    if (template) output[path] = render(template, Object.assign(Object.create(shared), values), templates, 0);
  }

  for (const source of pages) {
    write(source.route + 'index.html', source.layout, {
      page: {
        ...source.card,
        slug: source.id,
        content: source.content,
        toc: source.toc,
        newer: source.newer ?? null,
        older: source.older ?? null,
        is_post: source.post,
      },
    });
  }
  if (templates.has('index')) {
    const total = Math.max(1, Math.ceil(posts.length / site.per_page));
    const indexUrl = (number) => base + (number === 1 ? '/' : '/page/' + number + '/');
    for (let number = 1; number <= total; number++) {
      write(number === 1 ? 'index.html' : 'page/' + number + '/index.html', 'index', {
        posts: postCards.slice((number - 1) * site.per_page, number * site.per_page),
        pager: {
          number,
          total,
          url: indexUrl(number),
          newer_url: number === 1 ? '' : indexUrl(number - 1),
          older_url: number === total ? '' : indexUrl(number + 1),
        },
      });
    }
  }
  if (templates.has('tag')) {
    for (const [index, tag] of tags.entries()) {
      write('tags/' + tag.slug + '/index.html', 'tag', { tag: { ...tag, posts: sortedGroups[index].posts } });
    }
  }
  write('tags/index.html', 'tags');
  for (const file of statics) {
    if (Object.hasOwn(output, file.path)) diagnostics.push('shadowed ' + file.path + ': a built page has its path');
    else output[file.path] = file.content;
  }
  diagnostics.push(...broken);
  diagnostics.sort();
  diagnostics.push('built ' + (pages.length - posts.length) + ' pages, ' + posts.length + ' posts, ' + tags.length + ' tags and ' + statics.length + ' static files');
  output['build-report.txt'] = diagnostics.join('\n') + '\n';
  return output;
}
