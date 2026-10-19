/**
 * 本地自检（不进 DSH）：把插件用 stub ctx 跑一遍，看工具注册、DSL 编译、路由能不能work。
 * 跑法：node test/local-check.mjs
 */
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
process.env.DSH_HOME = join(here, '.tmp-home')
mkdirSync(process.env.DSH_HOME, { recursive: true })

const { apply, name, inject } = await import('../index.js')

const routes = []
const tools = []
const services = {
  attachments: {
    async saveImage({ mediaType, name: n }) {
      return { attachmentId: 'att_test', mediaType, bytes: 12, width: 4, height: 3, name: n }
    },
  },
}

const ctx = {
  logger: {
    debug: (...a) => console.log('  [debug]', ...a.map(String)),
    info: (...a) => console.log('  [info]', ...a.map(String)),
    warn: (...a) => console.log('  [warn]', ...a.map(String)),
  },
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  webServer: { register: (route) => { routes.push(route); return () => {} } },
  inject: (deps, fn) => { fn(ctx) },
  get: (k) => services[k],
  tools: { register: (t) => tools.push(t) },
}

console.log('plugin:', name, 'inject:', inject)
apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 100))

console.log('\n=== tools ===')
console.log('registered:', tools.map((t) => t.name))
const tool = tools[0]
console.log('parameters:', JSON.stringify(tool.parameters, null, 1))
console.log('output.schema:', JSON.stringify(tool.output.schema, null, 1))

console.log('\n=== routes ===')
console.log(routes.map((r) => `${r.kind} ${r.path}`))

{
  const modelParam = tool.parameters?.properties?.model
  const okModel = modelParam && !modelParam.enum
  console.log(`${okModel ? 'ok ' : 'BAD'} model 参数不锁 enum（自定义接口要能传任意模型名）`)
  const promptParam = tool.parameters?.properties?.prompt
  const promptRequired =
    promptParam?.required === true ||
    (Array.isArray(tool.parameters?.required) && tool.parameters.required.includes('prompt'))
  console.log(`${promptRequired ? 'ok ' : 'BAD'} prompt 仍是必填`)
}

function mockRes() {
  const out = { status: 0, headers: null, body: '' }
  return {
    out,
    writeHead(status, headers) { out.status = status; out.headers = headers },
    end(chunk) { out.body = chunk ? String(chunk) : '' },
  }
}

const route = routes[0]
for (const [method, url] of [['GET', '/api/agnes-image/config'], ['GET', '/api/agnes-image/nope']]) {
  const res = mockRes()
  await route.handler({ method, url, headers: {} }, res)
  console.log(`${method} ${url} -> ${res.out.status}`, res.out.body.slice(0, 240))
}

/* ------------------------------- POST 请求与输出目录 ------------------------------- */

function mockReq({ method, url, body }) {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      if (text) yield Buffer.from(text, 'utf8')
    },
  }
}

const customDir = join(here, '.tmp-out')
const cases = [
  { label: '自定义绝对目录', body: { outDir: customDir }, expect: 200 },
  { label: '相对路径应被拒', body: { outDir: 'just/relative' }, expect: 400 },
  { label: '恢复默认目录', body: { outDir: '' }, expect: 200 },
  // 注：`~` 展开在沙箱里验不了（写 C 盘会被 workspace-write 拦），逻辑在 expandPath 里，三条式
]

console.log('\n=== POST /config（输出目录） ===')
for (const c of cases) {
  const res = mockRes()
  await route.handler(mockReq({ method: 'POST', url: '/api/agnes-image/config', body: c.body }), res)
  let parsed = {}
  try { parsed = JSON.parse(res.out.body) } catch { /* ignore */ }
  const got = res.out.status
  const flag = got === c.expect ? 'ok ' : 'BAD'
  console.log(`${flag} ${c.label} -> ${got}`, c.expect === 200 ? `outDir=${parsed.outDir} custom=${parsed.outDirCustom}` : parsed.error)
}

console.log('\n=== GET 回读 ===')
{
  const res = mockRes()
  await route.handler({ method: 'GET', url: '/api/agnes-image/config', headers: {} }, res)
  const parsed = JSON.parse(res.out.body)
  console.log('outDir:', parsed.outDir, '| custom:', parsed.outDirCustom, '| default:', parsed.defaultOutDir)
}

rmSync(customDir, { recursive: true, force: true })

/* ---------------------------- 已下架模型的回落（effectiveModel） ---------------------------- */

console.log('\n=== 过期模型回落 ===')
{
  // 直接往 config.json 里塞一个已下架的 2.0-flash，看 GET 是否回落到默认
  const { writeFileSync } = await import('node:fs')
  const cfgPath = join(process.env.DSH_HOME, 'agnes-image', 'config.json')
  writeFileSync(cfgPath, JSON.stringify({ model: 'agnes-image-2.0-flash' }), 'utf8')
  const res = mockRes()
  await route.handler({ method: 'GET', url: '/api/agnes-image/config', headers: {} }, res)
  const parsed = JSON.parse(res.out.body)
  const good = parsed.model === 'agnes-image-2.1-flash'
  console.log(`${good ? 'ok ' : 'BAD'} 存了 2.0-flash -> 生效 ${parsed.model}（应为 agnes-image-2.1-flash）`)
  // 再塞一个合法值，确认不会被覆盖
  writeFileSync(cfgPath, JSON.stringify({ model: 'agnes-image-2.5-flash' }), 'utf8')
  const res2 = mockRes()
  await route.handler({ method: 'GET', url: '/api/agnes-image/config', headers: {} }, res2)
  const parsed2 = JSON.parse(res2.out.body)
  console.log(`${parsed2.model === 'agnes-image-2.5-flash' ? 'ok ' : 'BAD'} 存了 2.5-flash -> 生效 ${parsed2.model}`)
}

console.log('\n=== 接口来源 provider / endpoint ===')
{
  const post = async (body) => {
    const res = mockRes()
    await route.handler(mockReq({ method: 'POST', url: '/api/agnes-image/config', body }), res)
    let parsed = {}
    try { parsed = JSON.parse(res.out.body) } catch { /* 非 JSON */ }
    return { status: res.out.status, parsed }
  }
  const getConfig = async () => {
    const res = mockRes()
    await route.handler({ method: 'GET', url: '/api/agnes-image/config', headers: {} }, res)
    return JSON.parse(res.out.body)
  }

  let r = await post({
    provider: 'compat',
    endpoint: 'https://api.example.com/v1/images/generations',
    compatModel: 'gpt-image-1',
  })
  const ok1 = r.status === 200 && r.parsed.provider === 'compat' && r.parsed.endpoint === 'https://api.example.com/v1/images/generations'
  console.log(`${ok1 ? 'ok ' : 'BAD'} 切自定义接口 -> ${r.status} provider=${r.parsed.provider} model=${r.parsed.compatModel}`)

  r = await post({ endpoint: 'ftp://nope' })
  console.log(`${r.status === 400 ? 'ok ' : 'BAD'} 非 http 地址被拒 -> ${r.status} ${r.parsed.error}`)

  r = await post({ endpoint: 'api.example.com/v1/images' })
  console.log(`${r.status === 400 ? 'ok ' : 'BAD'} 缺协议头被拒 -> ${r.status} ${r.parsed.error}`)

  r = await post({ compatModel: 'x'.repeat(200) })
  console.log(`${r.status === 400 ? 'ok ' : 'BAD'} 超长模型名被拒 -> ${r.status} ${r.parsed.error}`)

  // 切回 Agnes 后端点仍保留（切回来不用重填），provider 回 agnes
  r = await post({ provider: 'agnes' })
  const back = await getConfig()
  console.log(`${back.provider === 'agnes' ? 'ok ' : 'BAD'} 切回 Agnes -> provider=${back.provider}（endpoint 仍保存着：${back.endpoint ? '是' : '否'}）`)

  // 再切回 compat 并清空 endpoint，确认优雅退回而不是崩
  r = await post({ provider: 'compat', endpoint: '' })
  console.log(`${r.status === 200 && r.parsed.endpoint === '' ? 'ok ' : 'BAD'} 清空接口地址 -> ${r.status} endpoint="${r.parsed.endpoint}"`)

  // 参数校验的底层函数
  const { normalizeEndpoint } = await import('../lib/agnes.mjs')
  try {
    normalizeEndpoint('')
    console.log('BAD 空地址没报错')
  } catch (error) {
    console.log('ok  normalizeEndpoint 拒绝空地址:', error.message)
  }
}

console.log('\n=== tool execute 无 key ===')
try {
  await tool.execute({ prompt: 'a whale' }, {})
} catch (error) {
  console.log('throws ok:', error.message)
}

console.log('\n=== tool execute 缺必填 ===')
try {
  await tool.execute({}, {})
} catch (error) {
  console.log('throws ok:', error.message)
}

rmSync(process.env.DSH_HOME, { recursive: true, force: true })
console.log('\nall checks done')
