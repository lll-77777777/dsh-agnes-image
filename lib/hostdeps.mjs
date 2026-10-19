/**
 * lib/hostdeps.mjs —— 从宿主那棵树里取 `@deepseek-ai/dsh-tools` 的 defineTool
 * ============================================================================
 * 为什么要有它：桌面版 profile 是 `autoInstallPeers: false`，`@deepseek-ai/*` 这类
 * optional peer 不会被装进插件自己的 node_modules；直接 `import '@deepseek-ai/dsh-tools'`
 * 有概率整条插件不激活。所以：
 *   ① 先按若干候选路径找宿主那份（跟宿主同一份，行为最一致）；
 *   ② 找不到再 bare import（万一 profile 树里恰好有）；
 *   ③ 都没有就退到本地等价实现 —— 插件照常加载，工具注册若是被 marker 拒了，
 *      日志里会看得到原因（不因为一个 import 让整条插件消失）。
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 插件自己那棵树（`dependencies` 装出来的那份）—— 用模块位置算，别依赖 cwd */
const SELF_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai')

/** 可能藏着宿主 `@deepseek-ai` 包的地方（按可能性排序） */
export function candidateRoots() {
  const out = []
  const push = (p) => { if (p && !out.includes(p)) out.push(p) }
  push(process.env.DSH_HOST_MODULES)

  const appdata = process.env.APPDATA
  if (appdata) {
    const npm = join(appdata, 'npm', 'node_modules')
    push(join(npm, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
    push(join(npm, '@deepseek-ai'))
    try {
      for (const n of readdirSync(join(npm, '@deepseek-ai'))) {
        push(join(npm, '@deepseek-ai', n, 'node_modules', '@deepseek-ai'))
      }
    } catch { /* 没有就算了 */ }
  }
  push('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')

  // profile 树：有些机器上这些包是被别的插件 hoist 到 profile 根上的
  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    for (const p of readdirSync(join(dshHome, 'profiles'))) {
      push(join(dshHome, 'profiles', p, 'node_modules', '@deepseek-ai'))
    }
  } catch { /* 没有就算了 */ }

  // 桌面版 app.asar 解包目录
  try {
    const localApp = join(process.env.LOCALAPPDATA || '', 'Programs')
    for (const n of readdirSync(localApp)) {
      if (!/deepseek|dsh/i.test(n)) continue
      push(join(localApp, n, 'resources', 'app.asar.unpacked', 'node_modules', '@deepseek-ai'))
    }
  } catch { /* 没有就算了 */ }

  push(SELF_MODULES)
  return out
}

/** 按包的 exports['.'] 找入口文件，返回 file:// URL */
function entryUrlFor(root, name) {
  try {
    const dir = join(root, name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) return null
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    const dot = pkg.exports?.['.']
    const rel = typeof dot === 'string'
      ? dot
      : (dot?.import || dot?.default || pkg.module || pkg.main)
    if (!rel) return null
    const file = join(dir, String(rel).replace(/^\.\//, ''))
    return existsSync(file) ? pathToFileURL(file).href : null
  } catch { return null }
}

/** 试从宿主树里 import 一个包；拿不到返回 null（失败原因写进 notes，方便排查） */
async function fromHostTree(name, log) {
  const fails = []
  for (const root of candidateRoots()) {
    if (root === SELF_MODULES) continue // 自己那份交给 bare import 处理
    const url = entryUrlFor(root, name)
    if (!url) continue
    try {
      const mod = await import(url)
      log(`${name}：从宿主树取到（${url.replace(/^file:\/\/\//, '')}）`)
      return mod
    } catch (e) { fails.push(`${e?.code || 'ERR'}:${root}`) }
  }
  if (fails.length) log(`${name}：宿主树里都不行（${fails.slice(0, 3).join(' ')}）`)
  return null
}

/* ------------------------------------------------------------------ 本地兜底 */

/**
 * 复刻宿主 `dsh-tools/schema` 的作者 DSL 编译（只覆盖本插件用到的那几个能力：
 * type / enum / const / items / properties / additionalProperties / oneOf / required）。
 * 宿主那份 defineTool 返回的就是个普通对象（没有 marker），所以本地实现只要把
 * "作者写法" 翻成同一份 JSON Schema，`ctx.tools.register` 一样认。
 */
const ANNOTATIONS = ['description', 'title', 'default', 'examples']

function compileValue(input, where, allowRequired) {
  if (!input || typeof input !== 'object') throw new Error(`${where} 必须是 schema 对象`)
  const node = {}
  for (const key of ANNOTATIONS) if (Object.hasOwn(input, key)) node[key] = input[key]
  if (Object.hasOwn(input, 'required')) {
    if (!allowRequired) throw new Error(`${where}.required 只能写在属性上`)
    if (input.required !== true) throw new Error(`${where}.required 只能是 true`)
  }

  if (Object.hasOwn(input, 'oneOf')) {
    if (!Array.isArray(input.oneOf) || input.oneOf.length === 0) throw new Error(`${where}.oneOf 必须是非空数组`)
    node.oneOf = input.oneOf.map((branch, index) => compileValue(branch, `${where}.oneOf[${index}]`, false))
    return node
  }

  const type = input.type
  const scalar = ['string', 'number', 'integer', 'boolean', 'null']
  if (type === 'array') {
    node.type = 'array'
    if (Object.hasOwn(input, 'items')) node.items = compileValue(input.items, `${where}.items`, false)
    return node
  }
  if (type === 'object') {
    node.type = 'object'
    const properties = {}
    const required = []
    for (const [key, child] of Object.entries(input.properties || {})) {
      if (child?.required === true) required.push(key)
      properties[key] = compileValue(child, `${where}.properties.${key}`, true)
    }
    node.properties = properties
    if (required.length) node.required = required
    if (Object.hasOwn(input, 'additionalProperties')) node.additionalProperties = input.additionalProperties
    return node
  }
  if (scalar.includes(type)) {
    node.type = type
    if (Object.hasOwn(input, 'enum')) {
      if (!Array.isArray(input.enum) || input.enum.length === 0) throw new Error(`${where}.enum 必须是非空数组`)
      node.enum = [...input.enum]
    }
    if (Object.hasOwn(input, 'const')) node.const = input.const
    return node
  }
  throw new Error(`${where}.type 只能是 string/number/integer/boolean/null/array/object，或者用 oneOf`)
}

function compileParameters(spec, toolName) {
  const compiled = compileValue({ type: 'object', properties: spec || {} }, `defineTool(${toolName}).parameters`, false)
  return compiled
}

/** 缺一个必填参数就在进 execute 之前拦住，报错文字跟宿主一致些 */
function checkRequired(schema, args) {
  const missing = (schema.required || []).filter((key) => !Object.hasOwn(args || {}, key))
  if (missing.length) throw new Error(`invalid arguments: missing required ${missing.join(', ')}`)
}

function localDefineTool(options, log) {
  if (!options || typeof options !== 'object') throw new Error('defineTool: 缺少 options')
  if (typeof options.name !== 'string' || !options.name) throw new Error('defineTool: name 必填')
  if (!options.output || typeof options.output.render !== 'function') {
    throw new Error(`defineTool(${options.name}): output.render 必填`)
  }
  const parameters = compileParameters(options.parameters, options.name)
  const schema = compileValue(options.output.schema, `defineTool(${options.name}).output.schema`, false)
  if (schema.type !== 'object') throw new Error(`defineTool(${options.name}): output.schema 必须是 object 根`)

  log?.(`dsh-tools 拿不到 —— 本地等价实现顶上了（工具 ${options.name}）`)
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema,
      render: (args, value) => options.output.render(args, value),
      ...(typeof options.output.presentationMeta === 'function'
        ? { presentationMeta: (args, value) => options.output.presentationMeta(args, value) }
        : {}),
    },
    async execute(args, exec) {
      checkRequired(parameters, args)
      return options.execute(args, exec)
    },
  }
}

/**
 * 取回宿主半端要用的一点点东西
 * @returns {Promise<{defineTool:Function, notes:string[]}>}
 */
export async function loadHostDeps() {
  const notes = []
  const log = (m) => notes.push(m)

  let dtMod = await fromHostTree('dsh-tools', log)
  if (!dtMod) {
    try {
      dtMod = await import('@deepseek-ai/dsh-tools')
      log('dsh-tools：宿主树里没有，用自己依赖里那份')
    } catch (e) {
      log(`dsh-tools 拿不到（${e?.code || ''}）—— 用本地等价实现顶上`)
      dtMod = null
    }
  }
  const defineTool = dtMod?.defineTool || ((options) => localDefineTool(options, log))
  return { defineTool, notes }
}
