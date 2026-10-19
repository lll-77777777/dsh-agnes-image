/**
 * dsh-agnes-image —— 用 Agnes AI 生图
 * ============================================================================
 * 宿主半端：填 API Key（设置页 / 配置文件）、注册 `agnes_image` 工具、挂设置页要用的
 * HTTP 路由。密钥只存在本机 ~/.dsh/agnes-image/config.json，不出插件家目录。
 * ============================================================================
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { randomBytes } from 'node:crypto'

import { loadHostDeps } from './lib/hostdeps.mjs'
import {
  AGNES_MODELS,
  DEFAULT_MODEL,
  DEFAULT_SIZE,
  generateImage,
  generateImageCompat,
  imageSize,
  normalizeEndpoint,
  sniffImageMediaType,
} from './lib/agnes.mjs'
import {
  DEFAULT_VIDEO_ASPECT_RATIO,
  DEFAULT_VIDEO_MODEL,
  DEFAULT_VIDEO_SIZE,
  VIDEO_ASPECT_RATIOS,
  VIDEO_MODELS,
  VIDEO_MODES,
  VIDEO_SIZES,
  generateVideo,
} from './lib/video.mjs'

export const name = 'dsh-agnes-image'
export const inject = ['tools', 'webServer']

/* ------------------------------------------------------------------ 家目录 */

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}
function homeDir() {
  return join(dshHome(), 'agnes-image')
}
function configPath() {
  return join(homeDir(), 'config.json')
}
/** 默认输出目录：插件家目录下的 out/ */
function defaultOutDir() {
  return join(homeDir(), 'out')
}

/** 把 `~` / `~/xxx` 展开成用户主目录；其余原样返回 */
function expandPath(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (s === '~') return homedir()
  if (s.startsWith('~/') || s.startsWith('~\\')) return join(homedir(), s.slice(2))
  return s
}

/** 真正生效的输出目录：配置里自定义了就用自己的，没配就用默认 */
function resolveOutDir(cfg) {
  const custom = expandPath(cfg?.outDir)
  return custom || defaultOutDir()
}

/** 读配置；坏文件当成空配置，不让插件起不来 */
async function readConfig() {
  try {
    const parsed = JSON.parse(await readFile(configPath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeConfig(patch) {
  const cur = await readConfig()
  const next = { ...cur, ...patch }
  await mkdir(homeDir(), { recursive: true })
  await writeFile(configPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

/** 真实生效的 key：配置文件优先，其次环境变量 */
async function effectiveApiKey(cfg) {
  const fromCfg = typeof cfg?.apiKey === 'string' ? cfg.apiKey.trim() : ''
  if (fromCfg) return fromCfg
  return String(process.env.AGNES_API_KEY || '').trim()
}

/** 只露头尾，避免把整串密钥回传给页面 */
function maskKey(key) {
  if (!key) return ''
  if (key.length <= 12) return `${key.slice(0, 2)}****`
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

/**
 * 真实生效的模型：配置里存的值如果已经不在可用清单里（比如 2.0-flash 下架了），
 * 自动回落到默认值，免得用户被一条过期的配置卡住、一直报 503。
 */
function effectiveModel(cfg) {
  const m = typeof cfg?.model === 'string' ? cfg.model.trim() : ''
  return AGNES_MODELS.includes(m) ? m : DEFAULT_MODEL
}

/** 接口来源：只有明确配成 compat 才走自定义，其余一律回 Agnes 官方 */
function effectiveProvider(cfg) {
  return cfg?.provider === 'compat' ? 'compat' : 'agnes'
}

function effectiveEndpoint(cfg) {
  return typeof cfg?.endpoint === 'string' ? cfg.endpoint.trim() : ''
}

function effectiveCompatModel(cfg) {
  return typeof cfg?.compatModel === 'string' ? cfg.compatModel.trim() : ''
}

/* ------------------------------------------------------------ 图片落盘/命名 */

function extFor(mediaType) {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  if (mediaType === 'image/gif') return 'gif'
  return 'png'
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/* --------------------------------------------------------------- HTTP 路由 */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  return JSON.parse(text)
}

function createRoute(ctx) {
  return {
    kind: 'prefix',
    path: '/api/agnes-image',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const path = url.pathname.replace(/\/+$/, '')
        const method = (req.method || 'GET').toUpperCase()

        if (path === '/api/agnes-image/config' && method === 'GET') {
          const cfg = await readConfig()
          const key = await effectiveApiKey(cfg)
          return sendJson(res, 200, {
            ok: true,
            hasKey: Boolean(key),
            apiKeyMasked: maskKey(key),
            apiKeyFromEnv: !cfg?.apiKey && Boolean(process.env.AGNES_API_KEY),
            provider: effectiveProvider(cfg),
            endpoint: effectiveEndpoint(cfg),
            compatModel: effectiveCompatModel(cfg),
            model: effectiveModel(cfg),
            size: cfg.size || DEFAULT_SIZE,
            models: AGNES_MODELS,
            outDir: resolveOutDir(cfg),
            outDirCustom: Boolean(expandPath(cfg?.outDir)),
            defaultOutDir: defaultOutDir(),
          })
        }

        if (path === '/api/agnes-image/config' && method === 'POST') {
          const body = await readJsonBody(req)
          const patch = {}
          if (typeof body.apiKey === 'string' && body.apiKey.trim()) patch.apiKey = body.apiKey.trim()
          if (body.clearKey === true) patch.apiKey = ''
          if (typeof body.model === 'string' && AGNES_MODELS.includes(body.model)) patch.model = body.model
          if (typeof body.size === 'string' && /^\d{2,5}x\d{2,5}$/.test(body.size.trim())) patch.size = body.size.trim()

          // 接口来源：agnes（默认）/ compat（自定义 OpenAI 兼容接口）
          if (body.provider === 'agnes' || body.provider === 'compat') patch.provider = body.provider

          // 自定义接口地址：空串 = 清空（切回 Agnes 时用不上）
          if (typeof body.endpoint === 'string') {
            const raw = body.endpoint.trim()
            if (!raw) {
              patch.endpoint = ''
            } else {
              try {
                patch.endpoint = normalizeEndpoint(raw)
              } catch (error) {
                return sendJson(res, 400, { ok: false, error: error?.message || '接口地址不合法' })
              }
            }
          }

          // 自定义接口的模型名：自由文本，只做长度和字符的粗筛
          if (typeof body.compatModel === 'string') {
            const raw = body.compatModel.trim()
            if (raw.length > 120 || /[\r\n\t]/.test(raw)) {
              return sendJson(res, 400, { ok: false, error: '模型名太长或含换行符' })
            }
            patch.compatModel = raw
          }
          if (typeof body.outDir === 'string') {
            const raw = body.outDir.trim()
            if (!raw) {
              // 空 = 恢复默认目录
              patch.outDir = ''
            } else {
              const abs = expandPath(raw)
              if (!isAbsolute(abs)) {
                return sendJson(res, 400, { ok: false, error: '输出目录要填绝对路径，例如 D:\\图片\\agnes' })
              }
              try {
                await mkdir(abs, { recursive: true })
              } catch (error) {
                return sendJson(res, 400, {
                  ok: false,
                  error: `这个目录建不出来：${error?.code || error?.message || error}`,
                })
              }
              patch.outDir = abs
            }
          }
          const next = await writeConfig(patch)
          const key = await effectiveApiKey(next)
          return sendJson(res, 200, {
            ok: true,
            hasKey: Boolean(key),
            apiKeyMasked: maskKey(key),
            provider: effectiveProvider(next),
            endpoint: effectiveEndpoint(next),
            compatModel: effectiveCompatModel(next),
            model: effectiveModel(next),
            size: next.size || DEFAULT_SIZE,
            outDir: resolveOutDir(next),
            outDirCustom: Boolean(expandPath(next.outDir)),
            defaultOutDir: defaultOutDir(),
          })
        }

        if (path === '/api/agnes-image/test' && method === 'POST') {
          const cfg = await readConfig()
          const key = await effectiveApiKey(cfg)
          if (!key) return sendJson(res, 400, { ok: false, error: '还没填 API Key' })
          const started = Date.now()
          const probePrompt = 'a tiny cute whale wearing a straw hat, flat illustration, plain white background'
          const result =
            effectiveProvider(cfg) === 'compat'
              ? await generateImageCompat({
                  endpoint: effectiveEndpoint(cfg),
                  apiKey: key,
                  model: effectiveCompatModel(cfg),
                  size: cfg.size || DEFAULT_SIZE,
                  prompt: probePrompt,
                  timeoutMs: 120_000,
                })
              : await generateImage({
                  apiKey: key,
                  model: effectiveModel(cfg),
                  size: cfg.size || DEFAULT_SIZE,
                  prompt: probePrompt,
                  timeoutMs: 120_000,
                })
          return sendJson(res, 200, {
            ok: true,
            ms: Date.now() - started,
            provider: effectiveProvider(cfg),
            model: result.model,
            mediaType: result.mediaType,
            bytes: result.bytes.length,
          })
        }

        return sendJson(res, 404, { ok: false, error: 'not found' })
      } catch (error) {
        ctx.logger?.warn?.(`[agnes-image] 路由出错：${error?.message || error}`)
        return sendJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  }
}

/* ------------------------------------------------------------------- 插件 */

export function apply(ctx) {
  loadHostDeps()
    .then(({ defineTool, notes }) => wire(ctx, defineTool, notes))
    .catch((error) => ctx.logger?.warn?.(`[agnes-image] 加载失败：${error?.message || error}`))
}

function wire(ctx, defineTool, notes) {
  for (const note of notes) ctx.logger?.debug?.(`[agnes-image] ${note}`)

  // 设置页要用的 HTTP 接口
  try {
    const dispose = ctx.webServer.register(createRoute(ctx))
    if (typeof ctx.effect === 'function' && typeof dispose === 'function') ctx.effect(() => dispose)
  } catch (error) {
    ctx.logger?.warn?.(`[agnes-image] 挂路由失败：${error?.message || error}`)
  }

  // 回显图片必须用到 attachments 服务，等它就绪再注册工具
  ctx.inject(['attachments'], (actx) => {
    const attachments = actx.get('attachments')

    actx.tools.register(
      defineTool({
        name: 'agnes_image',
        description:
          '生成图片（文生图 / 图生图 / 多图合成）。生成完会把图片直接回显给你看，并同时存成本地文件。' +
          '默认走 Agnes AI，用户也可以在设置里切到自定义的 OpenAI 兼容接口。' +
          '适合要"画一张图""按这张图再画一张""把这两张图合起来"这类需求。' +
          'prompt 写英文通常效果更好；size 建议 1024x1024、1024x768、768x1024 这类常见比例。',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            description: '画面描述。想改图时，把要保留/要改的部分都写清楚。',
          },
          size: {
            type: 'string',
            description: `输出尺寸，形如 1024x1024 / 1024x768 / 768x1024。默认 ${DEFAULT_SIZE}。`,
          },
          model: {
            type: 'string',
            description:
              `模型名。Agnes 模式下可填 ${AGNES_MODELS.join(' / ')}（默认 ${DEFAULT_MODEL}，2.5 质量最高、2.1 更快）；` +
              '自定义接口模式下填对方的模型名。不填就用设置里保存的默认值。',
          },
          images: {
            type: 'array',
            items: { type: 'string' },
            description:
              '参考图列表（图生图/合成用）：可以是本地文件绝对路径，也可以是 http(s) 图片地址。' +
              '不传就是纯文生图。',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', required: true, description: '本地保存路径' },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              attachmentId: { type: 'string', required: true },
              revisedPrompt: { oneOf: [{ type: 'string' }, { type: 'null' }] },
              model: { type: 'string' },
              size: { type: 'string' },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text:
                `画好了，存在 ${value.path}（${value.width}x${value.height}，` +
                `${(value.bytes / 1024).toFixed(1)} KB，${value.model}）` +
                (value.revisedPrompt ? `\n实际用的提示词：${value.revisedPrompt}` : ''),
            },
            {
              type: 'image',
              attachment: {
                attachmentId: value.attachmentId,
                mediaType: value.mediaType,
                bytes: value.bytes,
                width: value.width,
                height: value.height,
                name: `agnes-${value.width}x${value.height}`,
              },
            },
          ],
          presentationMeta: (_args, value) => ({ path: value.path }),
        },
        async execute(args) {
          const cfg = await readConfig()
          const apiKey = await effectiveApiKey(cfg)
          if (!apiKey) {
            throw new Error('还没填 Agnes AI 的 API Key —— 打开「设置 → Agnes 生图」填一下，或设环境变量 AGNES_API_KEY')
          }

          // 参考图：公网地址原样传，本地文件转成 data URI
          const refs = []
          for (const item of Array.isArray(args.images) ? args.images : []) {
            const ref = String(item || '').trim()
            if (!ref) continue
            if (/^https?:\/\//i.test(ref) || ref.startsWith('data:')) {
              refs.push(ref)
              continue
            }
            const file = ref
            let buf
            try {
              buf = await readFile(file)
            } catch {
              throw new Error(`读不到参考图：${file}`)
            }
            const mediaType = sniffImageMediaType(buf)
            if (!mediaType) throw new Error(`参考图不是可识别的图片（png/jpeg/webp/gif）：${file}`)
            refs.push(`data:${mediaType};base64,${buf.toString('base64')}`)
          }

          const provider = effectiveProvider(cfg)
          const size = args.size || cfg.size || DEFAULT_SIZE
          let result
          if (provider === 'compat') {
            result = await generateImageCompat({
              endpoint: effectiveEndpoint(cfg),
              apiKey,
              model: String(args.model || '').trim() || effectiveCompatModel(cfg),
              prompt: args.prompt,
              size,
              images: refs,
            })
          } else {
            result = await generateImage({
              apiKey,
              model: AGNES_MODELS.includes(args.model) ? args.model : effectiveModel(cfg),
              prompt: args.prompt,
              size,
              images: refs,
            })
          }

          const mediaType = result.mediaType || sniffImageMediaType(result.bytes) || 'image/png'
          const dims = imageSize(result.bytes) || {}
          const dir = resolveOutDir(cfg)
          try {
            await mkdir(dir, { recursive: true })
          } catch (error) {
            throw new Error(
              `输出目录建不出来：${dir}（${error?.code || error?.message || error}）` +
              '—— 去「设置 → Agnes 生图」换一个能写的目录',
            )
          }
          const fileName = `agnes-${stamp()}-${randomBytes(3).toString('hex')}.${extFor(mediaType)}`
          const filePath = join(dir, fileName)
          try {
            await writeFile(filePath, result.bytes)
          } catch (error) {
            throw new Error(
              `图片存不进 ${dir}（${error?.code || error?.message || error}）` +
              '—— 去「设置 → Agnes 生图」换个目录',
            )
          }

          const saved = await attachments.saveImage({
            data: result.bytes,
            mediaType,
            name: fileName,
          })

          return {
            path: filePath,
            mediaType: saved?.mediaType || mediaType,
            bytes: saved?.bytes ?? result.bytes.length,
            width: saved?.width ?? dims.width ?? 0,
            height: saved?.height ?? dims.height ?? 0,
            attachmentId: saved?.attachmentId ?? '',
            revisedPrompt: result.revisedPrompt ?? null,
            model: result.model,
            size: result.size,
          }
        },
      }),
    )

    actx.tools.register(
      defineTool({
        name: 'agnes_video',
        description:
          '生成视频（Agnes Video 2.5）。异步任务：提交后要等几十秒到几分钟，出来会存成本地 mp4 并把文件回显给你。' +
          '按秒计费（720P ¥0.15/秒、1080P 和 1K ¥0.25/秒、2K ¥0.35/秒），默认 5 秒 720P 约 ¥0.75。' +
          '适合要"生成一段视频""让这张图动起来"（首尾帧）这类需求。参考图必须是公网 http(s) 链接，本地路径不行。',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            description: '视频内容描述：主体、动作、镜头语言、光线、声音都可以写进去。',
          },
          mode: {
            type: 'string',
            enum: VIDEO_MODES,
            description: '生成模式：text 纯文生视频（默认）；keyframe 首尾帧控制；reference 用参考图/音频/视频。不填会按给没给 firstFrame/images 自动推断。',
          },
          seconds: { type: 'string', description: '时长，4–12 的整数秒，默认 "5"。' },
          size: { type: 'string', enum: VIDEO_SIZES, description: '分辨率档位，默认 720P（最便宜）。' },
          aspectRatio: {
            type: 'string',
            enum: VIDEO_ASPECT_RATIOS,
            description: '画幅比例，默认 16:9；竖屏短视频用 9:16。',
          },
          firstFrame: { type: 'string', description: '首帧图片公网 URL（keyframe 模式，与 lastFrame 至少给一个）' },
          lastFrame: { type: 'string', description: '尾帧图片公网 URL（keyframe 模式）' },
          images: {
            type: 'array',
            items: { type: 'string' },
            description: '参考图公网 URL 列表（reference 模式，最多 8 张）',
          },
          seed: { type: 'integer', description: '随机种子，同样的种子更容易复现同一条片子。' },
          model: {
            type: 'string',
            enum: VIDEO_MODELS,
            description: `模型：默认 ${DEFAULT_VIDEO_MODEL}（质量最高），2.5-flash 更快。`,
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', required: true, description: '本地保存路径' },
              fileName: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              videoId: { type: 'string', required: true },
              model: { type: 'string', required: true },
              seconds: { type: 'string', required: true },
              size: { type: 'string', required: true },
              aspectRatio: { type: 'string', required: true },
              elapsedMs: { type: 'integer', required: true },
              costCny: { type: 'number', required: true },
              attachmentId: { type: 'string' },
            },
          },
          render: (_args, value) => {
            const blocks = [
              {
                type: 'text',
                text:
                  `视频好了：${value.path}（${value.seconds} 秒，${value.size}，` +
                  `${(value.bytes / 1024 / 1024).toFixed(1)} MB，约 ¥${value.costCny.toFixed(2)}，` +
                  `花了 ${Math.round(value.elapsedMs / 1000)} 秒生成）`,
              },
            ]
            if (value.attachmentId) {
              blocks.push({
                type: 'file',
                attachment: {
                  attachmentId: value.attachmentId,
                  name: value.fileName,
                  mediaType: value.mediaType,
                  bytes: value.bytes,
                },
              })
            }
            return blocks
          },
          presentationMeta: (_args, value) => ({ path: value.path }),
        },
        async execute(args) {
          const cfg = await readConfig()
          const apiKey = await effectiveApiKey(cfg)
          if (!apiKey) {
            throw new Error('还没填 Agnes AI 的 API Key —— 打开「设置 → Agnes 生图」填一下，或设环境变量 AGNES_API_KEY')
          }
          if (effectiveProvider(cfg) === 'compat') {
            throw new Error(
              '视频只在「Agnes 官方」接口下能用 —— 去「设置 → Agnes 生图」把接口来源切回官方（自定义接口只支持生图）',
            )
          }

          const mode = VIDEO_MODES.includes(args.mode)
            ? args.mode
            : (args.firstFrame || args.lastFrame
              ? 'keyframe'
              : (Array.isArray(args.images) && args.images.length ? 'reference' : 'text'))

          const result = await generateVideo({
            apiKey,
            model: VIDEO_MODELS.includes(args.model) ? args.model : DEFAULT_VIDEO_MODEL,
            prompt: args.prompt,
            mode,
            seconds: args.seconds,
            size: VIDEO_SIZES.includes(args.size) ? args.size : DEFAULT_VIDEO_SIZE,
            aspectRatio: VIDEO_ASPECT_RATIOS.includes(args.aspectRatio)
              ? args.aspectRatio
              : DEFAULT_VIDEO_ASPECT_RATIO,
            seed: args.seed,
            firstFrame: args.firstFrame,
            lastFrame: args.lastFrame,
            images: args.images,
          })

          const dir = join(resolveOutDir(cfg), 'videos')
          try {
            await mkdir(dir, { recursive: true })
          } catch (error) {
            throw new Error(`视频目录建不出来：${dir}（${error?.code || error?.message || error}）`)
          }
          const fileName = `agnes-video-${stamp()}-${randomBytes(3).toString('hex')}.mp4`
          const filePath = join(dir, fileName)
          try {
            await writeFile(filePath, result.bytes)
          } catch (error) {
            throw new Error(`视频存不进 ${dir}（${error?.code || error?.message || error}）`)
          }

          // 能存进附件就顺手回显一条文件卡片；宿主不支持就只给路径，不影响已存好的文件
          let attachmentId = ''
          try {
            const saved = await attachments.saveFile({ data: result.bytes, name: fileName })
            attachmentId = saved?.attachmentId || ''
          } catch { /* 忽略：附件回显是加分项 */ }

          return {
            path: filePath,
            fileName,
            mediaType: result.mediaType,
            bytes: result.bytes.length,
            videoId: result.videoId,
            model: result.model,
            seconds: result.seconds,
            size: result.size,
            aspectRatio: result.aspectRatio,
            elapsedMs: result.elapsedMs,
            costCny: result.costCny,
            attachmentId,
          }
        },
      }),
    )
  })
}
