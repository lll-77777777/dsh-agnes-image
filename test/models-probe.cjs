/** 诊断：Agnes 账号能用哪些模型（只读查询） */
const https = require('node:https')

const KEY = process.env.AGNES_KEY || ''
if (!KEY) {
  console.error('need AGNES_KEY')
  process.exit(1)
}

function get(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.agnes-ai.cn',
        path,
        method: 'GET',
        headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
        timeout: 20000,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode, body }))
      },
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.end()
  })
}

;(async () => {
  for (const p of ['/v1/models', '/v1/models?type=image']) {
    try {
      const r = await get(p)
      console.log(`\n=== GET ${p} -> ${r.status}`)
      console.log(r.body.slice(0, 3000))
    } catch (e) {
      console.log(`\n=== GET ${p} ERR`, e.message)
    }
  }
})()
