/**
 * 诊断：哪个图像模型能出图
 * 用插件自己的 lib/agnes.mjs 发请求，顺便验证请求格式没写错。
 */
import { generateImage, AGNES_MODELS, DEFAULT_MODEL } from '../lib/agnes.mjs'

const KEY = process.env.AGNES_KEY || ''
if (!KEY) {
  console.error('need AGNES_KEY')
  process.exit(1)
}

console.log('AGNES_MODELS =', AGNES_MODELS)
console.log('DEFAULT_MODEL =', DEFAULT_MODEL)

const candidates = ['agnes-image-2.0-flash', 'agnes-image-2.1-flash', 'agnes-image-2.5-flash']

for (const model of candidates) {
  const t0 = Date.now()
  try {
    const r = await generateImage({
      apiKey: KEY,
      model,
      prompt: 'a small red apple on a wooden table, soft light',
      size: '1024x1024',
      timeoutMs: 120000,
    })
    console.log(
      `✅ ${model}  ${r.mediaType}  ${(r.bytes.length / 1024).toFixed(1)}KB  ${Date.now() - t0}ms  revised=${String(r.revisedPrompt).slice(0, 60)}`,
    )
  } catch (e) {
    console.log(`❌ ${model}  ${Date.now() - t0}ms  ${e?.message ?? e}`)
  }
}
