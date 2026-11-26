// What Lua lacks of JavaScript, for the core of stickyflow translated to Lua: regular expressions and a few functions of Math and Number.

type Matcher = (s: string, i: number, caps: Array<string | undefined>, k: (j: number) => boolean) => boolean;

interface Pattern {
  match: Matcher;
  groups: number;
}

const DIGIT = (c: string) => c >= '0' && c <= '9';
const WORD = (c: string) => DIGIT(c) || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const SPACE = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';

class Parser {
  pos = 0;
  groups = 0;
  constructor(
    readonly src: string,
    readonly fold: boolean,
  ) {}

  peek(): string {
    return this.src.substring(this.pos, this.pos + 1);
  }

  eat(c: string): boolean {
    if (this.peek() === c) {
      this.pos++;
      return true;
    }
    return false;
  }

  parseAlt(): Matcher {
    const alts: Matcher[] = [this.parseSeq()];
    while (this.eat('|')) {
      alts.push(this.parseSeq());
    }
    if (alts.length === 1) {
      return alts[0];
    }
    return (s, i, caps, k) => {
      for (const alt of alts) {
        if (alt(s, i, caps, k)) {
          return true;
        }
      }
      return false;
    };
  }

  parseSeq(): Matcher {
    const items: Matcher[] = [];
    while (this.pos < this.src.length && this.peek() !== '|' && this.peek() !== ')') {
      items.push(this.parseQuantified());
    }
    const run = (index: number, s: string, i: number, caps: Array<string | undefined>, k: (j: number) => boolean): boolean =>
      index === items.length ? k(i) : items[index](s, i, caps, j => run(index + 1, s, j, caps, k));
    return (s, i, caps, k) => run(0, s, i, caps, k);
  }

  parseQuantified(): Matcher {
    const atom = this.parseAtom();
    let min = 1;
    let max = 1;
    const c = this.peek();
    if (c === '*') {
      min = 0;
      max = Infinity;
      this.pos++;
    } else if (c === '+') {
      min = 1;
      max = Infinity;
      this.pos++;
    } else if (c === '?') {
      min = 0;
      max = 1;
      this.pos++;
    } else if (c === '{') {
      const close = this.src.indexOf('}', this.pos);
      const body = this.src.substring(this.pos + 1, close);
      const comma = body.indexOf(',');
      if (comma < 0) {
        min = Number(body);
        max = min;
      } else {
        min = Number(body.substring(0, comma));
        const upper = body.substring(comma + 1);
        max = upper === '' ? Infinity : Number(upper);
      }
      this.pos = close + 1;
    } else {
      return atom;
    }
    const lazy = this.eat('?');
    return repeat(atom, min, max, lazy);
  }

  parseClassEscape(): (c: string) => boolean {
    const e = this.src.substring(this.pos, this.pos + 1);
    this.pos++;
    switch (e) {
      case 'd':
        return DIGIT;
      case 'D':
        return c => !DIGIT(c);
      case 'w':
        return WORD;
      case 'W':
        return c => !WORD(c);
      case 's':
        return SPACE;
      case 'S':
        return c => !SPACE(c);
      case 'n':
        return c => c === '\n';
      case 'r':
        return c => c === '\r';
      case 't':
        return c => c === '\t';
      default:
        return c => c === e;
    }
  }

  literal(ch: string): (c: string) => boolean {
    return this.fold ? c => c.toLowerCase() === ch.toLowerCase() : c => c === ch;
  }

  parseClass(): (c: string) => boolean {
    const negate = this.eat('^');
    const tests: Array<(c: string) => boolean> = [];
    let first = true;
    while (this.pos < this.src.length && (first || this.peek() !== ']')) {
      first = false;
      let test: (c: string) => boolean;
      let low: string | undefined;
      if (this.eat('\\')) {
        const e = this.peek();
        test = this.parseClassEscape();
        if (!/* single char escape */ ['d', 'D', 'w', 'W', 's', 'S'].includes(e)) {
          low = e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e;
        }
      } else {
        low = this.peek();
        this.pos++;
        test = this.literal(low);
      }
      if (low !== undefined && this.peek() === '-' && this.src.substring(this.pos + 1, this.pos + 2) !== ']') {
        this.pos++;
        let high = this.peek();
        this.pos++;
        if (high === '\\') {
          high = this.peek();
          this.pos++;
        }
        const from = low;
        const to = high;
        test = this.fold
          ? c => (c.toLowerCase() >= from.toLowerCase() && c.toLowerCase() <= to.toLowerCase()) || (c.toUpperCase() >= from.toUpperCase() && c.toUpperCase() <= to.toUpperCase())
          : c => c >= from && c <= to;
      }
      tests.push(test);
    }
    this.pos++;
    return c => {
      let hit = false;
      for (const t of tests) {
        if (t(c)) {
          hit = true;
          break;
        }
      }
      return negate ? !hit : hit;
    };
  }

  parseAtom(): Matcher {
    const c = this.peek();
    this.pos++;
    if (c === '(') {
      let capture = true;
      if (this.src.substring(this.pos, this.pos + 2) === '?:') {
        capture = false;
        this.pos += 2;
      }
      const index = capture ? ++this.groups : 0;
      const inner = this.parseAlt();
      this.pos++;
      if (!capture) {
        return inner;
      }
      return (s, i, caps, k) => {
        const before = caps[index];
        const done = inner(s, i, caps, j => {
          const saved = caps[index];
          caps[index] = s.substring(i, j);
          if (k(j)) {
            return true;
          }
          caps[index] = saved;
          return false;
        });
        if (!done) {
          caps[index] = before;
        }
        return done;
      };
    }
    if (c === '^') {
      return (_s, i, _caps, k) => i === 0 && k(i);
    }
    if (c === '$') {
      return (s, i, _caps, k) => i === s.length && k(i);
    }
    let test: (ch: string) => boolean;
    if (c === '.') {
      test = ch => ch !== '\n' && ch !== '\r';
    } else if (c === '[') {
      test = this.parseClass();
    } else if (c === '\\') {
      test = this.parseClassEscape();
    } else {
      test = this.literal(c);
    }
    return (s, i, _caps, k) => i < s.length && test(s.substring(i, i + 1)) && k(i + 1);
  }
}

function repeat(atom: Matcher, min: number, max: number, lazy: boolean): Matcher {
  const step = (count: number, s: string, i: number, caps: Array<string | undefined>, k: (j: number) => boolean): boolean => {
    const more = () => count < max && atom(s, i, caps, j => j !== i && step(count + 1, s, j, caps, k));
    if (count < min) {
      return atom(s, i, caps, j => step(count + 1, s, j, caps, k));
    }
    return lazy ? k(i) || more() : more() || k(i);
  };
  return (s, i, caps, k) => step(0, s, i, caps, k);
}

export class JsRegExp {
  lastIndex = 0;
  readonly global: boolean;
  readonly ignoreCase: boolean;
  readonly pattern: Pattern;

  constructor(
    readonly source: string,
    readonly flags: string,
  ) {
    this.global = flags.includes('g');
    this.ignoreCase = flags.includes('i');
    const parser = new Parser(source, this.ignoreCase);
    const match = parser.parseAlt();
    this.pattern = { match, groups: parser.groups };
  }

  // The match at or after a position, as exec gives it: the whole match, then the groups, with the index of the match.
  matchFrom(s: string, from: number): { index: number; end: number; caps: Array<string | undefined> } | null {
    for (let start = from; start <= s.length; start++) {
      const caps: Array<string | undefined> = [];
      let end = -1;
      if (
        this.pattern.match(s, start, caps, j => {
          end = j;
          return true;
        })
      ) {
        return { index: start, end, caps };
      }
    }
    return null;
  }
}

export interface ExecResult extends Array<string> {
  index: number;
  input: string;
}

function resultOf(re: JsRegExp, s: string, found: { index: number; end: number; caps: Array<string | undefined> }): ExecResult {
  const result = [s.substring(found.index, found.end)] as ExecResult;
  for (let g = 1; g <= re.pattern.groups; g++) {
    result[g] = found.caps[g] as string;
  }
  result.index = found.index;
  result.input = s;
  return result;
}

export function __re(source: string, flags = ''): JsRegExp {
  return new JsRegExp(source, flags);
}

export function __exec(re: JsRegExp, s: string): ExecResult | null {
  const from = re.global ? re.lastIndex : 0;
  const found = from > s.length ? null : re.matchFrom(s, from);
  if (!found) {
    re.lastIndex = 0;
    return null;
  }
  if (re.global) {
    re.lastIndex = found.end > found.index ? found.end : found.end + 1;
  }
  return resultOf(re, s, found);
}

export function __test(re: JsRegExp, s: string): boolean {
  return __exec(re, s) !== null;
}

function allMatches(re: JsRegExp, s: string): ExecResult[] {
  const out: ExecResult[] = [];
  let from = 0;
  while (from <= s.length) {
    const found = re.matchFrom(s, from);
    if (!found) {
      break;
    }
    out.push(resultOf(re, s, found));
    from = found.end > found.index ? found.end : found.end + 1;
  }
  return out;
}

export function __match(s: string, re: JsRegExp): ExecResult | string[] | null {
  if (!re.global) {
    const found = re.matchFrom(s, 0);
    return found ? resultOf(re, s, found) : null;
  }
  const all = allMatches(re, s).map(m => m[0]);
  return all.length > 0 ? all : null;
}

export function __matchAll(s: string, re: JsRegExp): ExecResult[] {
  return allMatches(re, s);
}

export function __search(s: string, re: JsRegExp): number {
  const found = re.matchFrom(s, 0);
  return found ? found.index : -1;
}

type Replacer = string | ((...args: never[]) => string);

function expand(template: string, m: ExecResult): string {
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const c = template.substring(i, i + 1);
    const next = template.substring(i + 1, i + 2);
    if (c === '$' && next === '&') {
      out += m[0];
      i++;
    } else if (c === '$' && DIGIT(next)) {
      out += m[Number(next)] ?? '';
      i++;
    } else if (c === '$' && next === '$') {
      out += '$';
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

function replaceWith(s: string, matches: ExecResult[], replacement: Replacer): string {
  let out = '';
  let last = 0;
  for (const m of matches) {
    out += s.substring(last, m.index);
    if (typeof replacement === 'string') {
      out += expand(replacement, m);
    } else {
      const args: unknown[] = [];
      for (let g = 0; g < m.length; g++) {
        args.push(m[g]);
      }
      args.push(m.index, s);
      out += (replacement as (...a: unknown[]) => string)(...args);
    }
    last = m.index + m[0].length;
  }
  return out + s.substring(last);
}

export function __replace(s: string, pattern: JsRegExp | string, replacement: Replacer): string {
  if (typeof pattern === 'string') {
    const at = s.indexOf(pattern);
    if (at < 0) {
      return s;
    }
    const m = [pattern] as ExecResult;
    m.index = at;
    m.input = s;
    return replaceWith(s, [m], replacement);
  }
  if (pattern.global) {
    return replaceWith(s, allMatches(pattern, s), replacement);
  }
  const found = pattern.matchFrom(s, 0);
  return found ? replaceWith(s, [resultOf(pattern, s, found)], replacement) : s;
}

export function __replaceAll(s: string, pattern: JsRegExp | string, replacement: Replacer): string {
  if (typeof pattern === 'string') {
    return s.split(pattern).join(typeof replacement === 'string' ? replacement : '');
  }
  return replaceWith(s, allMatches(pattern, s), replacement);
}

export function __split(s: string, separator: JsRegExp, limit?: number): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of allMatches(separator, s)) {
    if (m[0].length === 0 && (m.index === 0 || m.index === s.length)) {
      continue;
    }
    out.push(s.substring(last, m.index));
    for (let g = 1; g < m.length; g++) {
      out.push(m[g]);
    }
    last = m.index + m[0].length;
  }
  out.push(s.substring(last));
  return limit === undefined ? out : out.slice(0, limit);
}

export function __hypot(...values: number[]): number {
  let sum = 0;
  for (const v of values) {
    sum += v * v;
  }
  return Math.sqrt(sum);
}

// Bitwise operators as JavaScript has them: on 32 bits, signed, while Lua works on 64.
const TWO32 = 4294967296;
const TWO31 = 2147483648;

function toUint32(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) {
    return 0;
  }
  const n = (x < 0 ? Math.ceil(x) : Math.floor(x)) % TWO32;
  return n < 0 ? n + TWO32 : n;
}

function toInt32(x: number): number {
  const u = toUint32(x);
  return u >= TWO31 ? u - TWO32 : u;
}

export function __and(a: number, b: number): number {
  return toInt32(toUint32(a) & toUint32(b));
}

export function __or(a: number, b: number): number {
  return toInt32(toUint32(a) | toUint32(b));
}

export function __xor(a: number, b: number): number {
  return toInt32(toUint32(a) ^ toUint32(b));
}

export function __not(a: number): number {
  return toInt32(TWO32 - 1 - toUint32(a));
}

export function __shl(a: number, b: number): number {
  return toInt32(toUint32(a) * 2 ** (toUint32(b) % 32));
}

export function __shr(a: number, b: number): number {
  return Math.floor(toUint32(a) / 2 ** (toUint32(b) % 32));
}

export function __sar(a: number, b: number): number {
  return Math.floor(toInt32(a) / 2 ** (toUint32(b) % 32));
}

export function __imul(a: number, b: number): number {
  const ua = toUint32(a);
  const ub = toUint32(b);
  const high = Math.floor(ua / 65536);
  const low = ua % 65536;
  return toInt32((((high * ub) % 65536) * 65536 + low * ub) % TWO32);
}

export function __is(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number' && a === 0 && b === 0) {
    return 1 / a === 1 / b;
  }
  // biome-ignore lint/suspicious/noSelfCompare: NaN
  return a === b || (a !== a && b !== b);
}

// Array.isArray handed on as a function, as in values.some(Array.isArray): Lua has no Array to take it from.
export function __isArray(value: unknown): boolean {
  return Array.isArray(value);
}

export function __isFinite(value: unknown): boolean {
  return typeof value === 'number' && value === value && value !== Infinity && value !== -Infinity;
}

export function __newArray<T>(length: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < length; i++) {
    out.push(undefined as T);
  }
  return out;
}

let functionCount = 0;
const functionNames = new Map<unknown, string>();

export function __fnName(f: unknown): string {
  let name = functionNames.get(f);
  if (name === undefined) {
    name = `f${++functionCount}`;
    functionNames.set(f, name);
  }
  return name;
}

function quote(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.substring(i, i + 1);
    out += c === '"' ? '\\"' : c === '\\' ? '\\\\' : c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : c;
  }
  return `${out}"`;
}

// Arrays are told from objects by their keys, since both are tables in Lua; keys of an object are sorted, so the text is the same each time.
export function __json(value: unknown): string {
  if (value === undefined || value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return quote(value);
  }
  if (typeof value === 'number') {
    return value === value && value !== Infinity && value !== -Infinity ? String(value) : 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => (item === undefined ? 'null' : __json(item))).join(',')}]`;
  }
  const keys = Object.keys(value as object).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined && typeof item !== 'function') {
      parts.push(`${quote(key)}:${__json(item)}`);
    }
  }
  return `{${parts.join(',')}}`;
}

export function __jsonParse(text: string): unknown {
  let pos = 0;
  const ws = () => {
    while (pos < text.length && SPACE(text.substring(pos, pos + 1))) {
      pos++;
    }
  };
  const value = (): unknown => {
    ws();
    const c = text.substring(pos, pos + 1);
    if (c === '"') {
      pos++;
      let out = '';
      while (pos < text.length && text.substring(pos, pos + 1) !== '"') {
        let ch = text.substring(pos, pos + 1);
        if (ch === '\\') {
          pos++;
          const e = text.substring(pos, pos + 1);
          ch = e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
        }
        out += ch;
        pos++;
      }
      pos++;
      return out;
    }
    if (c === '[') {
      pos++;
      const items: unknown[] = [];
      ws();
      if (text.substring(pos, pos + 1) === ']') {
        pos++;
        return items;
      }
      while (true) {
        items.push(value());
        ws();
        const sep = text.substring(pos, pos + 1);
        pos++;
        if (sep === ']') {
          return items;
        }
        if (sep !== ',') {
          throw new Error('bad json');
        }
      }
    }
    if (c === '{') {
      pos++;
      const obj: Record<string, unknown> = {};
      ws();
      if (text.substring(pos, pos + 1) === '}') {
        pos++;
        return obj;
      }
      while (true) {
        const key = value() as string;
        ws();
        pos++;
        obj[key] = value();
        ws();
        const sep = text.substring(pos, pos + 1);
        pos++;
        if (sep === '}') {
          return obj;
        }
        if (sep !== ',') {
          throw new Error('bad json');
        }
      }
    }
    for (const [word, result] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.substring(pos, pos + word.length) === word) {
        pos += word.length;
        return result;
      }
    }
    let end = pos;
    while (end < text.length && '+-0123456789.eE'.includes(text.substring(end, end + 1))) {
      end++;
    }
    if (end === pos) {
      throw new Error('bad json');
    }
    const n = Number(text.substring(pos, end));
    pos = end;
    return n;
  };
  const result = value();
  ws();
  if (pos < text.length) {
    throw new Error('bad json');
  }
  return result;
}

// Array.prototype.sort is stable in JavaScript; Lua's table.sort is not, and the order of drawing depends on it.
export function __sort<T>(items: T[], compare?: (a: T, b: T) => number): T[] {
  const cmp =
    compare ??
    ((a: T, b: T) => {
      const x = String(a);
      const y = String(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  const n = items.length;
  if (n < 2) {
    return items;
  }
  let src = items.slice();
  let dst: T[] = [];
  for (let width = 1; width < n; width *= 2) {
    dst = [];
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n);
      const hi = Math.min(lo + 2 * width, n);
      let i = lo;
      let j = mid;
      while (i < mid && j < hi) {
        if (cmp(src[j], src[i]) < 0) {
          dst.push(src[j]);
          j++;
        } else {
          dst.push(src[i]);
          i++;
        }
      }
      while (i < mid) {
        dst.push(src[i]);
        i++;
      }
      while (j < hi) {
        dst.push(src[j]);
        j++;
      }
    }
    src = dst;
  }
  for (let k = 0; k < n; k++) {
    items[k] = src[k];
  }
  return items;
}

export function __toSorted<T>(items: readonly T[], compare?: (a: T, b: T) => number): T[] {
  return __sort(items.slice(), compare);
}

// Truth as JavaScript has it: 0, NaN and the empty text are false, which in Lua they are not.
export function __t<T>(value: T): value is Exclude<NonNullable<T>, false | 0 | ''> {
  return !(value === undefined || value === null || value === false || value === 0 || value === '' || value !== value);
}

export function __lor<A, B>(left: A, right: () => B): Exclude<NonNullable<A>, false | 0 | ''> | B {
  return __t(left) ? (left as Exclude<NonNullable<A>, false | 0 | ''>) : right();
}

export function __land<A, B>(left: A, right: () => B): A | B {
  return __t(left) ? right() : left;
}

// A value the translator cannot see as an array, handed to it as one, so that its methods are the ones of an array.
export function __arr(value: unknown): any[] {
  return value as any[];
}

declare global {
  // Made in Lua by the loader: the arguments as a list, without the ones that are undefined.
  function __compact(this: void, ...items: unknown[]): any[];
}

declare global {
  // Made in Lua by the loader: an object whose getters are called when their property is read.
  function __getters(this: void, object: object, getters: Record<string, () => unknown>): object;
  // Made in Lua by the loader: a deep copy of plain data, as structuredClone gives it.
  function __deepClone(this: void, value: unknown): unknown;
}

export function __clone<T>(value: T): T {
  return __deepClone(value) as T;
}

// Work for later runs now: there is no event loop in TeX, and a figure is read once.
export function __microtask(callback: () => void): void {
  callback();
}
