/**
 * lib/video.mjs —— Agnes AI 视频生成 API 封装（异步任务）
 * ============================================================================
 * 文档：https://agnes-ai.cn/zh-Hans/docs/agnes-video-25
 *
 *   创建任务 POST https://api.agnes-ai.cn/v1/videos
 *     { model, prompt, mode: text|keyframe|reference, seconds: "4".."12",
 *       size: 720P|1080P|1K|2K, aspect_ratio, seed?, n: 1,
 *       first_frame?, last_frame?, images?[] }
 *     → { video_id, status: queued|in_progress|completed|failed }
 *
 *   查询任务 GET https://api.agnes-ai.cn/agnesapi?video_id=<ID>&model_name=<MODEL>
 *     → { status, progress, url?, seconds, size }
 *
 *   异步接口：建完任务要轮询到 completed 才拿得到 url。
 *   计费：720P ¥0.15/秒、1080P 和 1K ¥0.25/秒、2K ¥0.35/秒（人民币刊例价）。
 *   参考素材必须是公网 http(s) 地址，data URI 和本地路径服务端都读不到。
 * ========================================================================== */

export const VIDEO_BASE_URL = 'https://api.agnes-ai.cn/v1'
export const VIDEO_QUERY_URL = 'https://api.agnes-ai.cn/agnesapi'
export const VIDEO_MODELS = ['agnes-video-2.5', 'agnes-video-2.5-flash']
export const DEFAULT_VIDEO_MODEL = 'agnes-video-2.5'
export const VIDEO_SIZES = ['720P', '1080P', '1K', '2K']
export const DEFAULT_VIDEO_SIZE = '720P'
export const VIDEO_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
export const DEFAULT_VIDEO_ASPECT_RATIO = '16:9'
export const VIDEO_MODES = ['text', 'keyframe', 'reference']
/** 人民币刊例价（元/秒），只用来给用户报个大概花了多少 */
export const VIDEO_PRICE_CNY = { '720P': 0.15, '1080P': 0.25, '1K': 0.25, '2K': 0.35 }
export const VIDEO_POLL_INTERVAL_MS = 2_000
export const VIDEO_TIMEOUT_MS = 900_000

/** 秒数：接受 "5" / 5，必须是 4–12 的整数 */
export function normalizeVideoSeconds(raw) {
  const n = Number(raw === undefined || raw === null || raw === '' ? 5 : raw)
  if (!Number.isInteger(n) || n < 4 || n > 12) {
    throw new Error('视频时长（seconds）要填 4–12 之间的整数秒，比如 "5"')
  }
  return String(n)
}

/** 参考素材只吃公网地址；本地路径 / data URI 直接给一句人话报错 */
export function toPublicMediaUrl(raw, label) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('data:')) {
    throw new Error(
      `${label} 不能传 data URI —— 视频接口只接受公网 http(s) 地址，` +
      '先把图传到图床/任意可公开访问的地方再填链接',
    )
  }
  throw new Error(
    `${label} 要填公网 http(s) 图片地址（不是本地路径 ${s}）—— ` +
    'Agnes 服务端要自己下载这张图，它读不到你电脑上的文件',
  )
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 建一个视频任务。不轮询、不下载，拿到 video_id 就返回。
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.model]
 * @param {string} opts.prompt
 * @param {'text'|'keyframe'|'reference'} [opts.mode]
 * @param {string} [opts.seconds]
 * @param {string} [opts.size]
 * @param {string} [opts.aspectRatio]
 * @param {number} [opts.seed]
 * @param {string} [opts.firstFrame]
 * @param {string} [opts.lastFrame]
 * @param {string[]} [opts.images]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{videoId:string, model:string, status:string, seconds:string, size:string, aspectRatio:string}>}
 */
export async function createVideoTask(opts) {
  const apiKey = String(opts?.apiKey || '').trim()
  if (!apiKey) throw new Error('还没填 Agnes AI 的 API Key —— 去「设置 → Agnes 生图」里填一下')
  const prompt = String(opts?.prompt || '').trim()
  if (!prompt) throw new Error('prompt 不能为空')
  const model = VIDEO_MODELS.includes(opts?.model) ? opts.model : DEFAULT_VIDEO_MODEL
  const mode = VIDEO_MODES.includes(opts?.mode) ? opts.mode : 'text'
  const seconds = normalizeVideoSeconds(opts?.seconds)
  const size = VIDEO_SIZES.includes(opts?.size) ? opts.size : DEFAULT_VIDEO_SIZE
  const aspectRatio = VIDEO_ASPECT_RATIOS.includes(opts?.aspectRatio)
    ? opts.aspectRatio
    : DEFAULT_VIDEO_ASPECT_RATIO

  const firstFrame = toPublicMediaUrl(opts?.firstFrame, 'firstFrame（首帧）')
  const lastFrame = toPublicMediaUrl(opts?.lastFrame, 'lastFrame（尾帧）')
  const images = (Array.isArray(opts?.images) ? opts.images : [])
    .map((u) => toPublicMediaUrl(u, 'images（参考图）'))
    .filter(Boolean)
  if (images.length > 8) throw new Error('参考图最多 8 张')

  if (mode === 'keyframe' && !firstFrame && !lastFrame) {
    throw new Error('keyframe 模式至少要给 firstFrame 或 lastFrame 之一')
  }
  if (mode === 'reference' && images.length === 0) {
    throw new Error('reference 模式至少要给一张参考图（images）')
  }

  /** @type {any} */
  const body = { model, prompt, mode, seconds, size, aspect_ratio: aspectRatio, n: 1 }
  if (Number.isInteger(opts?.seed)) body.seed = opts.seed
  if (mode === 'keyframe') {
    if (firstFrame) body.first_frame = firstFrame
    if (lastFrame) body.last_frame = lastFrame
  }
  if (mode === 'reference' && images.length) body.images = images

  const timeoutMs = Number(opts?.timeoutMs) > 0 ? Number(opts.timeoutMs) : 120_000
  const res = await fetch(`${VIDEO_BASE_URL}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const raw = await res.text()
  let json = null
  try { json = JSON.parse(raw) } catch { /* 非 JSON */ }
  if (!res.ok) {
    const detail = json?.error?.message || json?.message || json?.msg || raw.slice(0, 500)
    throw new Error(`Agnes 建视频任务失败（HTTP ${res.status}）：${detail}`)
  }
  const videoId = json?.video_id || json?.id || json?.task_id
  if (!videoId) throw new Error(`Agnes 建视频任务没返回 video_id：${raw.slice(0, 500)}`)
  return {
    videoId: String(videoId),
    model,
    status: String(json?.status || 'queued'),
    seconds,
    size,
    aspectRatio,
  }
}

/**
 * 查一次任务状态（不等待）。
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.videoId
 * @param {string} [opts.model]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{status:string, progress:number, url:string|null, seconds:string|null, size:string|null, error:string|null}>}
 */
export async function fetchVideoTask({ apiKey, videoId, model, timeoutMs }) {
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('还没填 Agnes AI 的 API Key')
  const params = new URLSearchParams({ video_id: String(videoId) })
  if (model) params.set('model_name', String(model))
  const res = await fetch(`${VIDEO_QUERY_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(Number(timeoutMs) > 0 ? Number(timeoutMs) : 60_000),
  })
  const raw = await res.text()
  let json = null
  try { json = JSON.parse(raw) } catch { /* 非 JSON */ }
  if (!res.ok) {
    const detail = json?.error?.message || json?.message || raw.slice(0, 500)
    throw new Error(`Agnes 查视频任务失败（HTTP ${res.status}）：${detail}`)
  }
  return {
    status: String(json?.status || ''),
    progress: Number(json?.progress ?? 0),
    url: json?.url || null,
    seconds: json?.seconds ?? null,
    size: json?.size ?? null,
    error: json?.error ? (json.error.message || JSON.stringify(json.error)) : null,
  }
}

/**
 * 建任务 → 轮询 → 下载成字节。onProgress({status, progress, elapsedMs}) 每轮回调一次。
 * @param {object} opts 同 createVideoTask，外加：
 * @param {(e:{status:string, progress:number, elapsedMs:number})=>void} [opts.onProgress]
 * @param {number} [opts.pollTimeoutMs]
 * @returns {Promise<{bytes:Buffer, mediaType:string, videoId:string, model:string, seconds:string, size:string, aspectRatio:string, remoteUrl:string, elapsedMs:number, costCny:number}>}
 */
export async function generateVideo(opts) {
  const startedAt = Date.now()
  const task = await createVideoTask(opts)
  const pollTimeoutMs = Number(opts?.pollTimeoutMs) > 0 ? Number(opts.pollTimeoutMs) : VIDEO_TIMEOUT_MS
  const deadline = startedAt + pollTimeoutMs

  let last = null
  for (;;) {
    last = await fetchVideoTask({ apiKey: opts.apiKey, videoId: task.videoId, model: task.model })
    opts?.onProgress?.({ status: last.status, progress: last.progress, elapsedMs: Date.now() - startedAt })
    if (last.status === 'completed') break
    if (last.status === 'failed') {
      throw new Error(`Agnes 视频生成失败：${last.error || '任务返回 failed，没给原因'}`)
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `等了 ${Math.round((Date.now() - startedAt) / 1000)} 秒还没生成完（video_id=${task.videoId}，` +
        `进度 ${last.progress}%）。任务可能还在跑，可以稍后用同一 video_id 再查。`,
      )
    }
    await sleep(VIDEO_POLL_INTERVAL_MS)
  }

  const remoteUrl = last?.url
  if (!remoteUrl) throw new Error('任务显示 completed 但没返回视频地址')
  const res = await fetch(remoteUrl, { signal: AbortSignal.timeout(180_000) })
  if (!res.ok) throw new Error(`视频文件下载失败（HTTP ${res.status}）`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (!bytes.length) throw new Error('下载到的视频是空的')

  const size = VIDEO_SIZES.includes(last.size) ? last.size : task.size
  const secondsNum = Number(last.seconds ?? task.seconds) || Number(task.seconds)
  // Agnes Video 2.5 Flash 当前限时免费（仅 720P）：输出秒数、输入秒数、参考图都按 ¥0 计费
  const freeFlash = task.model === 'agnes-video-2.5-flash' && size === '720P'
  const unit = freeFlash ? 0 : VIDEO_PRICE_CNY[size] ?? VIDEO_PRICE_CNY[DEFAULT_VIDEO_SIZE]
  return {
    bytes,
    mediaType: 'video/mp4',
    videoId: task.videoId,
    model: task.model,
    seconds: String(last.seconds ?? task.seconds),
    size,
    aspectRatio: task.aspectRatio,
    remoteUrl,
    elapsedMs: Date.now() - startedAt,
    costCny: Math.round(secondsNum * unit * 100) / 100,
    free: freeFlash,
  }
}
