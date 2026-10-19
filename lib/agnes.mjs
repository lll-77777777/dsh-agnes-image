/**
 * lib/agnes.mjs —— Agnes AI 图像生成 API 封装
 * ============================================================================
 * 文档：https://agnes-ai.cn/zh-Hans/docs/agnes-image-20-flash
 *
 *   POST https://api.agnes-ai.cn/v1/images/generations
 *   Header: Authorization: Bearer <API_KEY> / Content-Type: application/json
 *   Body:
 *     model          必填，agnes-image-2.1-flash / 2.5-flash
 *                    （2.0-flash 已于 2026-10 下架，调用会报 503 无可用渠道）
 *                    可用清单随时可用 GET /v1/models 核对
 *     prompt         必填
 *     size           必填，如 1024x1024 / 1024x768 / 768x1024
 *     extra_body.image          图生图：图片数组（公网 URL 或 data:image/...;base64,...）
 *     extra_body.response_format  'url' 或 'b64_json'（⚠️ 不能放顶层）
 *   响应 data[0].b64_json 或 data[0].url
 * ============================================================================
 */
export const AGNES_ENDPOINT = 'https://api.agnes-ai.cn/v1/images/generations'
export const AGNES_MODELS = ['agnes-image-2.1-flash', 'agnes-image-2.5-flash']
export const DEFAULT_MODEL = 'agnes-image-2.1-flash'
export const DEFAULT_SIZE = '1024x1024'
export const DEFAULT_TIMEOUT_MS = 300_000

/** 从字节嗅探真实图片格式（不信任扩展名） */
export function sniffImageMediaType(buf) {
  if (!buf || buf.length < 12) return undefined
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

/** 从字节里读宽高（PNG / JPEG / WebP / GIF）；读不出返回 undefined */
export function imageSize(buf) {
  try {
    const mt = sniffImageMediaType(buf)
    if (mt === 'image/png') {
      if (buf.length < 24) return undefined
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    if (mt === 'image/gif') {
      if (buf.length < 10) return undefined
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    }
    if (mt === 'image/webp') {
      const fmt = buf.toString('ascii', 12, 16)
      if (fmt === 'VP8X' && buf.length >= 30) {
        return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
      }
      if (fmt === 'VP8 ' && buf.length >= 30) {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
      }
      if (fmt === 'VP8L' && buf.length >= 25) {
        const b = buf.readUInt32LE(21)
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
      }
      return undefined
    }
    if (mt === 'image/jpeg') {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue }
        const marker = buf[i + 1]
        const len = buf.readUInt16BE(i + 2)
        // SOF0..SOF15，排除 DHT(0xC4)/JPG(0xC8)/DAC(0xCC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
        }
        i += 2 + len
      }
    }
  } catch { /* 解析失败就算了 */ }
  return undefined
}

/* ============================================================================
 * 响应解析（Agnes 与自定义接口共用）
 * ========================================================================== */

async function interpretImageResponse(res, timeoutMs, label) {
  const raw = await res.text()
  let json = null
  try { json = JSON.parse(raw) } catch { /* 非 JSON，保留下面的原始文本 */ }

  if (!res.ok) {
    const detail = json?.error?.message || json?.message || json?.msg || raw.slice(0, 500)
    throw new Error(`${label}失败（HTTP ${res.status}）：${detail}`)
  }

  const item = json?.data?.[0] ?? json?.images?.[0] ?? null
  if (!item) throw new Error(`${label}返回空结果：${raw.slice(0, 500)}`)

  let bytes
  const b64 = item.b64_json ?? item.b64 ?? item.image_base64 ?? (typeof item === 'string' ? item : null)
  const remote = item.url ?? item.image_url ?? null
  if (b64) {
    bytes = Buffer.from(String(b64), 'base64')
  } else if (remote) {
    const img = await fetch(remote, { signal: AbortSignal.timeout(Math.max(30_000, timeoutMs)) })
    if (!img.ok) throw new Error(`${label}返回的图片 URL 下载失败（HTTP ${img.status}）`)
    bytes = Buffer.from(await img.arrayBuffer())
  } else {
    throw new Error(`${label}返回里既没有图片数据也没有 URL：${raw.slice(0, 500)}`)
  }
  if (!bytes || bytes.length === 0) throw new Error(`${label}返回的图片数据为空`)

  return { bytes, revisedPrompt: item.revised_prompt ?? null }
}

/* ============================================================================
 * Agnes 官方接口
 * ========================================================================== */

/**
 * 调一次 Agnes 生图 API。
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.model]
 * @param {string} opts.prompt
 * @param {string} [opts.size]
 * @param {string[]} [opts.images]  图生图输入：公网 URL 或 data URI；本地路径由调用方先转好
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{bytes: Buffer, mediaType: string, revisedPrompt?: string|null, model: string, size: string}>}
 */
export async function generateImage(opts) {
  const apiKey = String(opts?.apiKey || '').trim()
  if (!apiKey) throw new Error('还没填 Agnes AI 的 API Key —— 去「设置 → Agnes 生图」里填一下')
  const prompt = String(opts?.prompt || '').trim()
  if (!prompt) throw new Error('prompt 不能为空')
  const model = String(opts?.model || DEFAULT_MODEL)
  const size = String(opts?.size || DEFAULT_SIZE)
  const images = Array.isArray(opts?.images) ? opts.images.filter(Boolean) : []
  const timeoutMs = Number(opts?.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS

  /** @type {any} */
  const body = { model, prompt, size }
  const extra = { response_format: 'b64_json' }
  if (images.length) extra.image = images
  body.extra_body = extra

  const res = await fetch(AGNES_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const { bytes, revisedPrompt } = await interpretImageResponse(res, timeoutMs, 'Agnes 生图')
  const mediaType = sniffImageMediaType(bytes) || 'image/png'
  return { bytes, mediaType, revisedPrompt, model, size }
}

/* ============================================================================
 * 自定义接口（OpenAI 兼容的 /images/generations）
 * ========================================================================== */

/** 校验并返回可用的接口地址 */
export function normalizeEndpoint(raw) {
  const url = String(raw || '').trim()
  if (!url) throw new Error('自定义接口还没填地址 —— 去「设置 → Agnes 生图」填接口地址')
  if (!/^https?:\/\//i.test(url)) throw new Error('接口地址要填 http(s) 开头的完整地址，例如 https://api.openai.com/v1/images/generations')
  return url
}

/**
 * 走任意 OpenAI 兼容的 /v1/images/generations 接口出图。
 * 请求体只放通用字段（model/prompt/size/n），不带 response_format：
 * 让服务端按默认返回 url 或 b64_json，两种解析都支持，兼容面最大。
 *
 * @param {object} opts
 * @param {string} opts.endpoint
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.prompt
 * @param {string} [opts.size]
 * @param {string[]} [opts.images]
 * @param {number} [opts.timeoutMs]
 */
export async function generateImageCompat(opts) {
  const endpoint = normalizeEndpoint(opts?.endpoint)
  const apiKey = String(opts?.apiKey || '').trim()
  if (!apiKey) throw new Error('还没填 API Key —— 去「设置 → Agnes 生图」里填一下')
  const prompt = String(opts?.prompt || '').trim()
  if (!prompt) throw new Error('prompt 不能为空')
  const model = String(opts?.model || '').trim()
  if (!model) throw new Error('自定义接口还没填模型名 —— 去「设置 → Agnes 生图」里填一下')
  const size = String(opts?.size || DEFAULT_SIZE)
  const images = Array.isArray(opts?.images) ? opts.images.filter(Boolean) : []
  const timeoutMs = Number(opts?.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS

  /** @type {any} */
  const body = { model, prompt, size, n: 1 }
  if (images.length) body.image = images

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const { bytes, revisedPrompt } = await interpretImageResponse(res, timeoutMs, '自定义接口生图')
  const mediaType = sniffImageMediaType(bytes) || 'image/png'
  return { bytes, mediaType, revisedPrompt, model, size }
}
