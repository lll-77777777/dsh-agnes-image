const https = require('node:https')

const body = JSON.stringify({
  model: 'agnes-image-2.0-flash',
  prompt: 'test',
  size: '1024x1024',
  extra_body: { response_format: 'b64_json' },
})

const req = https.request({
  hostname: 'api.agnes-ai.cn',
  path: '/v1/images/generations',
  method: 'POST',
  timeout: 30000,
  headers: {
    Authorization: 'Bearer sk-invalid-key-for-connectivity-test',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
}, (res) => {
  let text = ''
  res.on('data', (c) => { text += c })
  res.on('end', () => {
    console.log('STATUS', res.statusCode)
    console.log(text.slice(0, 600))
  })
})
req.on('error', (e) => console.log('ERR', e.code, e.message))
req.on('timeout', () => { console.log('TIMEOUT'); req.destroy() })
req.write(body)
req.end()
