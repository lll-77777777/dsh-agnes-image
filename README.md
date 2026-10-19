# dsh-agnes-image

DSH 插件：画图。默认用 [Agnes AI](https://platform.agnes-ai.cn/settings/apiKeys)，也可以换成任意 OpenAI 兼容的生图接口。
填一次 API Key，之后在对话里说「画一张…」就能出图 —— 图会直接显示在对话里，同时存到本地。

## 能干什么

| 场景 | 怎么说 |
| --- | --- |
| 文生图 | 「用 Agnes 画一只戴草帽的小鲸鱼」 |
| 图生图 / 改图 | 「照这张图再画一张，换成夜景」+ 图片路径 |
| 多图合成 | 「把这两张图合成一张，风格统一」 |

工具名 `agnes_image`，参数：

- `prompt`（必填）画面描述
- `size` 默认 `1024x1024`，也常用 `1024x768` / `768x1024`
- `model`：`agnes-image-2.1-flash`（默认，更快）/ `2.5-flash`（质量最高）
  - 2.0-flash 已于 2026-10 下架，调用会报 503「无可用渠道」；可用清单随时用 `GET /v1/models` 核对
- `images` 参考图列表，本地绝对路径或 http(s) 地址

## 配置

打开 **设置 → Agnes 生图**：

1. 去 <https://platform.agnes-ai.cn/settings/apiKeys> 创建 Key
2. 粘进输入框 → 保存
3. 点「测试连接」（会真画一张小图，几十秒）

Key 存在 `~/.dsh/agnes-image/config.json`，只在本机；也可以用环境变量 `AGNES_API_KEY` 给。

**存图目录可自定义**：同一页面的「存图目录」填绝对路径（也支持 `~` 开头），目录不存在会自动创建；
点「恢复默认」回到 `~/.dsh/agnes-image/out/`。设置存在 `config.json` 的 `outDir` 字段里。

**接口来源可切换**：设置页「接口来源」有两个按钮 ——「Agnes 官方」和「自定义接口」。

- Agnes 官方：默认，走 `https://api.agnes-ai.cn/v1/images/generations`，模型从下拉里选。
- 自定义接口：填**接口地址**（形如 `https://api.openai.com/v1/images/generations`）和**模型名**（如 `gpt-image-1`、`flux-1.1-pro`），
  Key 用上面同一个框填。要求对方是 **OpenAI 兼容**的 `/v1/images/generations` 接口 —— 中转站、OpenAI、硅基流动这类一般都行。
- 切回 Agnes 时自定义地址会保留，不用重填；Agnes 的模型选择也不会被覆盖。
- 自定义模式只发 `{ model, prompt, size, n }` 这四个通用字段，不带 `response_format`；
  返回 `b64_json` 还是 `url` 都能解析（带 `url` 的会自动下载）。
- 暂不支持「提交任务 → 轮询结果」那种异步接口（即梦、可灵一类）。

对应 `config.json` 字段：`provider`（`agnes` / `compat`）、`endpoint`、`compatModel`。

## 实现

- `index.js` —— 宿主半端：`agnes_image` 工具 + `/api/agnes-image/*` 设置接口
- `client.js` —— 浏览器半端：设置页（`settings.section`）
- `lib/agnes.mjs` —— API 封装（`POST https://api.agnes-ai.cn/v1/images/generations`）
- `lib/hostdeps.mjs` —— 从宿主树取 `defineTool`；拿不到就用等价实现兜底
- `test/local-check.mjs` —— 不进 DSH 的本地自检：`node test/local-check.mjs`

## 注意

- 目前 Agnes 图像生成免费（1K ¥0/张）。
- 报错会原样透出（比如 `无效的令牌`），多半是 Key 粘贴时带了空格。
