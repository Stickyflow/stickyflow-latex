// Rewrites the copy of the core so that the TypeScript-to-Lua translator can take it: every use of a regular expression goes through the
// engine in __shims.ts, and the few functions Lua lacks are replaced by their helpers.
import { writeFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import ts from 'typescript'

const cfg = ts.getParsedCommandLineOfConfigFile('tsconfig.json', {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
const program = ts.createProgram(cfg.fileNames, cfg.options)
const checker = program.getTypeChecker()
const SHIMS = `${process.cwd().replace(/\\/g, '/')}/core/__shims`

const isRegExp = (node) => {
  const type = checker.getTypeAtLocation(node)
  const name = (t) => t.getSymbol()?.getName() ?? t.aliasSymbol?.getName()
  if (type.isUnion()) return type.types.some((t) => name(t) === 'RegExp')
  return name(type) === 'RegExp'
}
const isString = (node) => {
  const type = checker.getNonNullableType(checker.getTypeAtLocation(node))
  return (type.flags & ts.TypeFlags.StringLike) !== 0 || (type.isUnion() && type.types.every((t) => (t.flags & ts.TypeFlags.StringLike) !== 0))
}
// A value whose truth differs between JavaScript and Lua: a number or a text may be 0 or empty.
const LOOSE = ts.TypeFlags.NumberLike | ts.TypeFlags.StringLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.Any | ts.TypeFlags.Unknown
const looseType = (type) => {
  if (type.isUnion()) return type.types.some(looseType)
  if (type.isIntersection()) return type.types.some(looseType)
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const constraint = checker.getBaseConstraintOfType(type)
    return !constraint || looseType(constraint)
  }
  return (type.flags & LOOSE) !== 0
}
const loose = (node) => looseType(checker.getTypeAtLocation(node))
const ARRAY_METHODS = new Set(['map', 'filter', 'forEach', 'some', 'every', 'reduce', 'reduceRight', 'find', 'findIndex', 'join', 'flatMap', 'flat', 'concat', 'slice', 'indexOf', 'lastIndexOf', 'entries', 'keys', 'values', 'at', 'fill', 'push', 'pop', 'shift', 'unshift', 'splice', 'reverse', 'findLast', 'findLastIndex'])
const isArrayType = (type) => checker.isArrayLikeType(type) || (type.isUnion() && type.types.every((t) => checker.isArrayLikeType(t)))
const unclearArray = (node) => {
  const type = checker.getNonNullableType(checker.getTypeAtLocation(node))
  if (isArrayType(type) || (type.flags & ts.TypeFlags.StringLike) || type.getSymbol()?.getName() === 'Map' || type.getSymbol()?.getName() === 'Set') return false
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true
  return type.isUnion() && type.types.some((t) => checker.isArrayLikeType(t))
}
const TRUTH_CALLBACKS = new Set(['filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex'])
const maybeUndefined = (node) => {
  const type = checker.getTypeAtLocation(node)
  const has = (t) => (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) !== 0
  return has(type) || (type.isUnion() && type.types.some(has))
}
const isFunction = (node) => checker.getTypeAtLocation(node).getCallSignatures().length > 0
const STRING_METHODS = new Set(['replace', 'replaceAll', 'split', 'match', 'matchAll', 'search'])
const CALLS = { 'Math.hypot': '__hypot', 'Math.imul': '__imul', 'Object.is': '__is', 'Number.isFinite': '__isFinite', 'JSON.stringify': '__json', 'JSON.parse': '__jsonParse' }
const GLOBAL_CALLS = { structuredClone: '__clone', queueMicrotask: '__microtask' }
const VALUES = { 'Number.isFinite': '__isFinite' }

let changedFiles = 0
for (const sf of program.getSourceFiles()) {
  if (!sf.fileName.includes('/core/') || sf.fileName.endsWith('__shims.ts')) continue
  const used = new Set()
  const text = sf.text

  // The text of a node with its rewritten children put in.
  const rewrite = (node) => {
    const own = transform(node)
    if (own !== undefined) return own
    let out = ''
    let pos = node.getStart(sf)
    node.forEachChild((child) => {
      const start = child.getStart(sf)
      out += text.slice(pos, start) + rewrite(child)
      pos = child.getEnd()
    })
    return out + text.slice(pos, node.getEnd())
  }
  // A condition with the truth of JavaScript, tested part by part, so that TypeScript still narrows through && and ||.
  const condition = (node) => {
    if (ts.isParenthesizedExpression(node)) return `(${condition(node.expression)})`
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return `${condition(node.left)} ${node.operatorToken.getText(sf)} ${condition(node.right)}`
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) return `!${condition(node.operand)}`
    return loose(node) ? call('__t', [rewrite(node)]) : rewrite(node)
  }
  const needsCondition = (node) => {
    if (ts.isParenthesizedExpression(node)) return needsCondition(node.expression)
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return needsCondition(node.left) || needsCondition(node.right)
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) return needsCondition(node.operand)
    return loose(node)
  }
  const rewriteWithCondition = (node, cond) => {
    let out = ''
    let pos = node.getStart(sf)
    node.forEachChild((child) => {
      const start = child.getStart(sf)
      out += text.slice(pos, start) + (child === cond ? condition(child) : rewrite(child))
      pos = child.getEnd()
    })
    return out + text.slice(pos, node.getEnd())
  }
  const call = (name, args) => {
    used.add(name)
    return `${name}(${args.join(', ')})`
  }
  const transform = (node) => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const literal = node.getText(sf)
      const end = literal.lastIndexOf('/')
      return call('__re', [JSON.stringify(literal.slice(1, end)), JSON.stringify(literal.slice(end + 1))])
    }
    // A list with holes that is filtered right away: Lua loses everything after the first hole, so the holes are left out as it is made.
    if (ts.isArrayLiteralExpression(node) && node.elements.some((e) => !ts.isSpreadElement(e) && maybeUndefined(e)) &&
        ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === 'filter') {
      used.add('__compactDeclared')
      return `__compact(${node.elements.map(rewrite).join(', ')})`
    }
    // Getters in an object literal: the object gets a metatable in Lua that calls them when the property is read.
    if (ts.isObjectLiteralExpression(node) && node.properties.some((p) => ts.isGetAccessorDeclaration(p))) {
      const plainProps = []
      const getters = []
      for (const p of node.properties) {
        if (ts.isGetAccessorDeclaration(p)) getters.push(`${p.name.getText(sf)}: () => ${rewrite(p.body)}`)
        else plainProps.push(rewrite(p))
      }
      used.add('__compactDeclared')
      return `__getters({ ${plainProps.join(', ')} }, { ${getters.join(', ')} }) as any`
    }
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText(sf) === 'String.raw' && ts.isNoSubstitutionTemplateLiteral(node.template)) {
      return JSON.stringify(node.template.rawText)
    }
    if (ts.isNewExpression(node) && node.expression.getText(sf) === 'RegExp') {
      return call('__re', (node.arguments ?? []).map(rewrite))
    }
    if (ts.isNewExpression(node) && node.expression.getText(sf) === 'Array' && node.arguments?.length === 1 && !ts.isArrayLiteralExpression(node.arguments[0])) {
      return call('__newArray', [rewrite(node.arguments[0])])
    }
    if (ts.isBinaryExpression(node)) {
      const K = ts.SyntaxKind
      const ops = {
        [K.AmpersandToken]: '__and', [K.BarToken]: '__or', [K.CaretToken]: '__xor', [K.LessThanLessThanToken]: '__shl',
        [K.GreaterThanGreaterThanToken]: '__sar', [K.GreaterThanGreaterThanGreaterThanToken]: '__shr',
      }
      const assigns = {
        [K.AmpersandEqualsToken]: '__and', [K.BarEqualsToken]: '__or', [K.CaretEqualsToken]: '__xor', [K.LessThanLessThanEqualsToken]: '__shl',
        [K.GreaterThanGreaterThanEqualsToken]: '__sar', [K.GreaterThanGreaterThanGreaterThanEqualsToken]: '__shr',
      }
      const kind = node.operatorToken.kind
      if (ops[kind]) return call(ops[kind], [rewrite(node.left), rewrite(node.right)])
      if (assigns[kind]) {
        const target = rewrite(node.left)
        return `${target} = ${call(assigns[kind], [target, rewrite(node.right)])}`
      }
    }
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) && loose(node.left)) {
      const helper = node.operatorToken.kind === ts.SyntaxKind.BarBarToken ? '__lor' : '__land'
      return call(helper, [rewrite(node.left), `() => (${rewrite(node.right)})`])
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken && needsCondition(node.operand)) {
      return `!${condition(node.operand)}`
    }
    if (ts.isConditionalExpression(node) && needsCondition(node.condition)) {
      return `${condition(node.condition)} ? ${rewrite(node.whenTrue)} : ${rewrite(node.whenFalse)}`
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.TildeToken) {
      return call('__not', [rewrite(node.operand)])
    }
    if ((ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) && needsCondition(node.expression)) {
      return rewriteWithCondition(node, node.expression)
    }
    if (ts.isForStatement(node) && node.condition && needsCondition(node.condition)) {
      return rewriteWithCondition(node, node.condition)
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && GLOBAL_CALLS[node.expression.text]) {
      return call(GLOBAL_CALLS[node.expression.text], node.arguments.map(rewrite))
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression
      const method = callee.name.text
      const shim = CALLS[callee.getText(sf)]
      if (shim) return call(shim, node.arguments.map(rewrite))
      if (STRING_METHODS.has(method) && isString(callee.expression) && node.arguments.length > 0 && isRegExp(node.arguments[0])) {
        const receiver = rewrite(callee.expression)
        const done = call(`__${method}`, [receiver, ...node.arguments.map(rewrite)])
        return callee.questionDotToken ? `(${receiver} == null ? undefined : ${done})` : done
      }
      if (ARRAY_METHODS.has(method) && unclearArray(callee.expression)) {
        const receiver = call('__arr', [rewrite(callee.expression)])
        return `${receiver}${callee.questionDotToken ? '?.' : '.'}${method}(${node.arguments.map(rewrite).join(', ')})`
      }
      if ((method === 'sort' || method === 'toSorted') && checker.isArrayLikeType(checker.getNonNullableType(checker.getTypeAtLocation(callee.expression)))) {
        const receiver = rewrite(callee.expression)
        const done = call(`__${method}`, [receiver, ...node.arguments.map(rewrite)])
        return callee.questionDotToken ? `(${receiver} == null ? undefined : ${done})` : done
      }
      if (TRUTH_CALLBACKS.has(method) && node.arguments.length > 0 && checker.isArrayLikeType(checker.getNonNullableType(checker.getTypeAtLocation(callee.expression)))) {
        const fn = node.arguments[0]
        const signature = checker.getTypeAtLocation(fn).getCallSignatures()[0]
        if (signature && looseType(checker.getReturnTypeOfSignature(signature))) {
          const rest = node.arguments.slice(1).map(rewrite)
          const wrapped = `(...__a: any[]) => ${call('__t', [`(${rewrite(fn)} as any)(...__a)`])}`
          return `${rewrite(callee.expression)}${callee.questionDotToken ? '?.' : '.'}${method}(${[wrapped, ...rest].join(', ')})`
        }
      }
      if ((method === 'test' || method === 'exec') && isRegExp(callee.expression)) {
        return call(`__${method}`, [rewrite(callee.expression), ...node.arguments.map(rewrite)])
      }
    }
    if (ts.isPropertyAccessExpression(node) && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
      const shim = VALUES[node.getText(sf)]
      if (shim) {
        used.add(shim)
        return shim
      }
      if (node.name.text === 'name' && isFunction(node.expression)) return call('__fnName', [rewrite(node.expression)])
    }
    return undefined
  }

  let body = ''
  let pos = 0
  for (const statement of sf.statements) {
    body += text.slice(pos, statement.getStart(sf)) + rewrite(statement)
    pos = statement.getEnd()
  }
  body += text.slice(pos)
  if (body === text) continue
  if (used.size === 0) {
    writeFileSync(sf.fileName, body)
    changedFiles++
    continue
  }
  let from = relative(dirname(sf.fileName), SHIMS).replace(/\\/g, '/')
  if (!from.startsWith('.')) from = `./${from}`
  writeFileSync(sf.fileName, `import { ${[...used].sort().join(', ')} } from '${from}';\n${body}`)
  changedFiles++
}
console.log('rewritten files', changedFiles)
