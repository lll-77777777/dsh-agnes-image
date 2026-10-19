/**
 * dsh-agnes-image —— 浏览器半端（设置页）
 * ============================================================================
 * ⭐ client bundle 是自注册脚本（不是 ESM）：
 *     window.__ModuleLoader__.load({ id: 'dsh-agnes-image', factory: (require) => ... })
 *   id 必须等于 package.json 的 name。
 *
 * 只做一件事：让用户在「设置 → Agnes 生图」里填 API Key、挑模型和默认尺寸，
 * 并提供一个「测试连接」按钮。Key 存在 DSH 家目录（宿主半端写文件），
 * 这里只通过 /api/agnes-image/* 读回「有没有填 / 掩码后几位」。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-agnes-image',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/agnes-image'

    const SIZES = [
      '1024x1024',
      '1024x768',
      '768x1024',
      '1280x720',
      '720x1280',
      '1536x1024',
      '1024x1536',
    ]

    const MODEL_NOTE = {
      'agnes-image-2.1-flash': '更快，日常够用',
      'agnes-image-2.5-flash': '质量最高，也最慢',
    }

    const CSS = [
      '[data-ai-page]{display:flex;flex-direction:column;gap:18px;}',
      '[data-ai-sec]{display:flex;flex-direction:column;gap:8px;}',
      '[data-ai-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}',
      '[data-ai-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}',
      '[data-ai-card]{padding:12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));background:var(--dsw-alias-bg-l2,rgba(255,255,255,.03));display:flex;flex-direction:column;gap:10px;}',
      '[data-ai-row]{display:flex;align-items:center;gap:8px;}',
      '[data-ai-grow]{flex:1;min-width:0;}',
      '[data-ai-input]{flex:1;min-width:0;padding:6px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-l1,transparent);color:inherit;font-size:12px;font-family:inherit;}',
      '[data-ai-input]:focus{outline:none;border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.3));}',
      '[data-ai-select]{padding:6px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-l2,rgba(255,255,255,.05));color:inherit;font-size:12px;font-family:inherit;}',
      '[data-ai-btn]{padding:5px 12px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-l2,rgba(255,255,255,.05));color:inherit;}',
      '[data-ai-btn]:hover{background:var(--dsw-alias-bg-l3,rgba(255,255,255,.1));}',
      '[data-ai-btn]:disabled{opacity:.5;cursor:default;}',
      '[data-ai-btn][data-primary]{background:var(--dsw-alias-brand-primary,#4b6ef5);border-color:transparent;color:#fff;}',
      '[data-ai-btn][data-primary]:hover{filter:brightness(1.08);}',
      '[data-ai-msg]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#b0b6bd);white-space:pre-wrap;}',
      '[data-ai-msg][data-err]{color:var(--dsw-alias-danger,#e5534b);}',
      '[data-ai-badge]{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));color:var(--dsw-alias-label-tertiary,#9aa0a6);}',
      '[data-ai-badge][data-on]{color:#2ea043;border-color:rgba(46,160,67,.5);}',
    ].join('')

    async function api(path, options) {
      const res = await fetch(API + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}))
      let data = {}
      try { data = await res.json() } catch { /* 空响应 */ }
      if (!res.ok || data.ok === false) {
        throw new Error((data && data.error) || '请求失败（HTTP ' + res.status + '）')
      }
      return data
    }

    function Panel() {
      const [loading, setLoading] = React.useState(true)
      const [saving, setSaving] = React.useState(false)
      const [testing, setTesting] = React.useState(false)
      const [draftKey, setDraftKey] = React.useState('')
      const [draftOutDir, setDraftOutDir] = React.useState('')
      const [draftEndpoint, setDraftEndpoint] = React.useState('')
      const [draftCompatModel, setDraftCompatModel] = React.useState('')
      const [state, setState] = React.useState({
        hasKey: false, apiKeyMasked: '', apiKeyFromEnv: false,
        provider: 'agnes', endpoint: '', compatModel: '',
        model: '', size: '', models: [], outDir: '', outDirCustom: false, defaultOutDir: '',
      })
      const [msg, setMsg] = React.useState('')
      const [msgErr, setMsgErr] = React.useState(false)

      const notify = (text, isError) => { setMsg(text || ''); setMsgErr(!!isError) }

      const refresh = React.useCallback(async () => {
        try {
          const data = await api('/config')
          setState({
            hasKey: !!data.hasKey,
            apiKeyMasked: data.apiKeyMasked || '',
            apiKeyFromEnv: !!data.apiKeyFromEnv,
            provider: data.provider === 'compat' ? 'compat' : 'agnes',
            endpoint: data.endpoint || '',
            compatModel: data.compatModel || '',
            model: data.model || '',
            size: data.size || '',
            models: Array.isArray(data.models) ? data.models : [],
            outDir: data.outDir || '',
            outDirCustom: !!data.outDirCustom,
            defaultOutDir: data.defaultOutDir || '',
          })
          setDraftOutDir(data.outDir || '')
          setDraftEndpoint(data.endpoint || '')
          setDraftCompatModel(data.compatModel || '')
        } catch (error) {
          notify(String((error && error.message) || error), true)
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => { refresh() }, [refresh])

      const saveKey = async () => {
        const key = draftKey.trim()
        if (!key) { notify('先把 Key 粘进来', true); return }
        setSaving(true)
        notify('')
        try {
          const data = await api('/config', { method: 'POST', body: JSON.stringify({ apiKey: key }) })
          setDraftKey('')
          setState((s) => Object.assign({}, s, { hasKey: !!data.hasKey, apiKeyMasked: data.apiKeyMasked || '' }))
          notify('Key 已保存，可以点「测试连接」试试')
        } catch (error) {
          notify(String((error && error.message) || error), true)
        }
        setSaving(false)
      }

      const clearKey = async () => {
        setSaving(true)
        notify('')
        try {
          const data = await api('/config', { method: 'POST', body: JSON.stringify({ clearKey: true }) })
          setState((s) => Object.assign({}, s, { hasKey: !!data.hasKey, apiKeyMasked: data.apiKeyMasked || '' }))
          notify('Key 已清掉')
        } catch (error) {
          notify(String((error && error.message) || error), true)
        }
        setSaving(false)
      }

      const changeModel = async (model) => {
        setState((s) => Object.assign({}, s, { model }))
        try {
          await api('/config', { method: 'POST', body: JSON.stringify({ model }) })
        } catch (error) {
          notify(String((error && error.message) || error), true)
        }
      }

      const changeSize = async (size) => {
        setState((s) => Object.assign({}, s, { size }))
        try {
          await api('/config', { method: 'POST', body: JSON.stringify({ size }) })
        } catch (error) {
          notify(String((error && error.message) || error), true)
        }
      }

      const changeProvider = async (provider) => {
        setState((s) => Object.assign({}, s, { provider }))
        notify('')
        try {
          await api('/config', { method: 'POST', body: JSON.stringify({ provider }) })
          notify(provider === 'compat'
            ? '已切到自定义接口 —— 把地址和模型名填好再点「保存」'
            : '已切回 Agnes 官方接口')
        } catch (error) {
          notify(String((error && error.message) || error), true)
        }
      }

      const saveEndpoint = async () => {
        const endpoint = draftEndpoint.trim()
        const model = draftCompatModel.trim()
        if (!endpoint) { notify('接口地址不能空', true); return }
        if (!model) { notify('模型名不能空', true); return }
        setSaving(true)
        notify('')
        try {
          const data = await api('/config', {
            method: 'POST',
            body: JSON.stringify({ endpoint, compatModel: model, provider: 'compat' }),
          })
          setState((s) => Object.assign({}, s, {
            provider: 'compat',
            endpoint: data.endpoint || '',
            compatModel: data.compatModel || '',
          }))
          setDraftEndpoint(data.endpoint || '')
          setDraftCompatModel(data.compatModel || '')
          notify('自定义接口已保存，可以点「测试连接」试一张')
        } catch (error) {
          notify(String((error && error.message) || error), true)
        }
        setSaving(false)
      }

      const saveOutDir = async () => {
        const dir = draftOutDir.trim()
        if (!dir) { notify('目录不能空着；想用默认目录就点「恢复默认」', true); return }
        setSaving(true)
        notify('')
        try {
          const data = await api('/config', { method: 'POST', body: JSON.stringify({ outDir: dir }) })
          setState((s) => Object.assign({}, s, {
            outDir: data.outDir || '',
            outDirCustom: !!data.outDirCustom,
            defaultOutDir: data.defaultOutDir || s.defaultOutDir,
          }))
          setDraftOutDir(data.outDir || '')
          notify('存图目录改成：' + (data.outDir || ''))
        } catch (error) {
          notify(String((error && error.message) || error), true)
        }
        setSaving(false)
      }

      const resetOutDir = async () => {
        setSaving(true)
        notify('')
        try {
          const data = await api('/config', { method: 'POST', body: JSON.stringify({ outDir: '' }) })
          setState((s) => Object.assign({}, s, {
            outDir: data.outDir || '',
            outDirCustom: !!data.outDirCustom,
            defaultOutDir: data.defaultOutDir || s.defaultOutDir,
          }))
          setDraftOutDir(data.outDir || '')
          notify('已恢复默认目录')
        } catch (error) {
          notify(String((error && error.message) || error), true)
        }
        setSaving(false)
      }

      const test = async () => {
        setTesting(true)
        notify('正在画一张小图试试…（可能要几十秒）')
        try {
          const data = await api('/test', { method: 'POST' })
          notify(`通了！用了 ${(data.ms / 1000).toFixed(1)} 秒，返回 ${(data.bytes / 1024).toFixed(1)} KB 的 ${data.mediaType}`)
        } catch (error) {
          notify(String((error && error.message) || error), true)
        }
        setTesting(false)
      }

      if (loading) return h('div', { 'data-ai-page': '' }, h('div', { 'data-ai-note': '' }, '读取配置中…'))

      return h('div', { 'data-ai-page': '' },

        h('div', { 'data-ai-sec': '' },
          h('div', { 'data-ai-h': '' }, 'API Key'),
          h('div', { 'data-ai-card': '' },
            h('div', { 'data-ai-row': '' },
              h('span', { 'data-ai-badge': '', 'data-on': state.hasKey ? '' : undefined },
                state.hasKey ? '已配置' : '未配置'),
              state.hasKey
                ? h('span', { 'data-ai-note': '' }, state.apiKeyFromEnv ? '来自环境变量 AGNES_API_KEY' : `当前：${state.apiKeyMasked}`)
                : null),
            h('div', { 'data-ai-row': '' },
              h('input', {
                'data-ai-input': '',
                type: 'password',
                placeholder: '粘贴 API Key（sk-…）',
                value: draftKey,
                autoComplete: 'off',
                spellCheck: false,
                onChange: (e) => setDraftKey(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Enter') saveKey() },
              }),
              h('button', { 'data-ai-btn': '', 'data-primary': '', disabled: saving, onClick: saveKey }, saving ? '保存中…' : '保存')),
            h('div', { 'data-ai-row': '' },
              h('button', { 'data-ai-btn': '', disabled: testing || !state.hasKey, onClick: test }, testing ? '测试中…' : '测试连接'),
              h('button', { 'data-ai-btn': '', disabled: saving || !state.hasKey, onClick: clearKey }, '清除 Key')),
            h('div', { 'data-ai-note': '' },
              '去 ', h('a', { href: 'https://platform.agnes-ai.cn/settings/apiKeys', target: '_blank', rel: 'noreferrer', style: { color: 'inherit', textDecoration: 'underline' } }, 'platform.agnes-ai.cn'),
              ' 登录后创建 Key。目前 Agnes 图像生成免费。Key 只存在这台电脑的 ', h('code', null, '~/.dsh/agnes-image/config.json'), '，不会上传。'))),

        h('div', { 'data-ai-sec': '' },
          h('div', { 'data-ai-h': '' }, '接口来源'),
          h('div', { 'data-ai-card': '' },
            h('div', { 'data-ai-row': '' },
              h('button', {
                'data-ai-btn': '',
                'data-primary': state.provider === 'agnes' ? '' : undefined,
                onClick: () => changeProvider('agnes'),
              }, 'Agnes 官方'),
              h('button', {
                'data-ai-btn': '',
                'data-primary': state.provider === 'compat' ? '' : undefined,
                onClick: () => changeProvider('compat'),
              }, '自定义接口')),
            state.provider === 'agnes'
              ? h('div', { 'data-ai-note': '' }, '现在走 Agnes 官方接口 api.agnes-ai.cn，模型在下面「默认模型」里选。')
              : h(React.Fragment, null,
                h('div', { 'data-ai-row': '' },
                  h('input', {
                    'data-ai-input': '',
                    type: 'text',
                    placeholder: '接口地址，例如 https://api.openai.com/v1/images/generations',
                    value: draftEndpoint,
                    spellCheck: false,
                    onChange: (e) => setDraftEndpoint(e.target.value),
                  })),
                h('div', { 'data-ai-row': '' },
                  h('input', {
                    'data-ai-input': '',
                    type: 'text',
                    placeholder: '模型名，例如 gpt-image-1 / flux-1.1-pro',
                    value: draftCompatModel,
                    spellCheck: false,
                    onChange: (e) => setDraftCompatModel(e.target.value),
                    onKeyDown: (e) => { if (e.key === 'Enter') saveEndpoint() },
                  }),
                  h('button', { 'data-ai-btn': '', 'data-primary': '', disabled: saving, onClick: saveEndpoint }, saving ? '保存中…' : '保存')),
                h('div', { 'data-ai-note': '' },
                  '要求对方是 OpenAI 兼容的 ', h('code', null, '/v1/images/generations'), ' 接口（中转站、OpenAI、硅基流动一般都行）。Key 用上面那个框填，切换后 Agnes 的配置不会被清掉。')))),

        state.provider === 'agnes'
          ? h('div', { 'data-ai-sec': '' },
              h('div', { 'data-ai-h': '' }, '默认模型'),
              h('div', { 'data-ai-card': '' },
                h('div', { 'data-ai-row': '' },
                  h('select', {
                    'data-ai-select': '',
                    value: state.model,
                    onChange: (e) => changeModel(e.target.value),
                  }, (state.models.length ? state.models : ['agnes-image-2.1-flash']).map((m) =>
                    h('option', { key: m, value: m }, m + (MODEL_NOTE[m] ? ` —— ${MODEL_NOTE[m]}` : '')))),
                ),
                h('div', { 'data-ai-note': '' }, '模型可以在调用时临时指定，这里只是默认值。')))
          : null,

        h('div', { 'data-ai-sec': '' },
          h('div', { 'data-ai-h': '' }, '默认尺寸'),
          h('div', { 'data-ai-card': '' },
            h('div', { 'data-ai-row': '' },
              h('select', {
                'data-ai-select': '',
                value: state.size,
                onChange: (e) => changeSize(e.target.value),
              }, SIZES.map((s) => h('option', { key: s, value: s }, s)))),
            h('div', { 'data-ai-note': '' }, '调用时也能临时指定任意「宽x高」。'))),

        h('div', { 'data-ai-sec': '' },
          h('div', { 'data-ai-h': '' }, '存图目录'),
          h('div', { 'data-ai-card': '' },
            h('div', { 'data-ai-row': '' },
              h('span', { 'data-ai-badge': '', 'data-on': state.outDirCustom ? '' : undefined },
                state.outDirCustom ? '自定义' : '默认'),
              h('span', { 'data-ai-note': '', style: { wordBreak: 'break-all' } }, state.outDir || '')),
            h('div', { 'data-ai-row': '' },
              h('input', {
                'data-ai-input': '',
                type: 'text',
                placeholder: '绝对路径，例如 D:\\图片\\agnes（支持 ~ 开头）',
                value: draftOutDir,
                spellCheck: false,
                onChange: (e) => setDraftOutDir(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Enter') saveOutDir() },
              }),
              h('button', { 'data-ai-btn': '', 'data-primary': '', disabled: saving, onClick: saveOutDir }, saving ? '保存中…' : '保存'),
              h('button', { 'data-ai-btn': '', disabled: saving || !state.outDirCustom, onClick: resetOutDir }, '恢复默认')),
            h('div', { 'data-ai-note': '' },
              '默认是 ', h('code', null, state.defaultOutDir || '~/.dsh/agnes-image/out'),
              '。填绝对路径（也可以写 ~ 开头），目录不存在会自动建。每张图除了存盘，也会直接显示在对话里。'))),

        msg ? h('div', { 'data-ai-msg': '', 'data-err': msgErr ? '' : undefined }, msg) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-agnes-image')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-agnes-image: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'agnes-image', order: 46, label: 'Agnes 生图' },
          () => h(Panel),
        ))
      },
    }
  },
})
