# dsh-agnes-image

DSH 插件：画图。默认用 [Agnes AI](https://platform.agnes-ai.cn/settings/apiKeys)，也可以换成任意 OpenAI 兼容的生图接口。
填一次 API Key，之后在对话里说「画一张…」就能出图 —— 图会直接显示在对话里，同时存到本地。

## 能干什么

| 场景 | 怎么说 |
| --- | --- |
| 文生图 | 「用 Agnes 画一只戴草帽的小鲸鱼」 |
| 图生图 / 改图 | 「照这张图再画一张，换成夜景」+ 图片路径 |
| 多图合成 | 「把这两张图合成一张，风格统一」 |
| 文生视频 | 「生成一段视频：雨夜霓虹街道，跑车缓慢驶过」 |
| 让图动起来 | 「用这张图当首帧，生成 5 秒视频」+ 公网图片链接 |

工具名 `agnes_image`，参数：

- `prompt`（必填）画面描述
- `size` 默认 `1024x1024`，也常用 `1024x768` / `768x1024`
- `model`：`agnes-image-2.1-flash`（默认，更快）/ `2.5-flash`（质量最高）
  - 2.0-flash 已于 2026-10 下架，调用会报 503「无可用渠道」；可用清单随时用 `GET /v1/models` 核对
- `images` 参考图列表，本地绝对路径或 http(s) 地址

## 视频（agnes_video）

第二个工具，走 [Agnes Video 2.5](https://agnes-ai.cn/zh-Hans/docs/agnes-video-25)。它是**异步任务**：
提交后要轮询几十秒到几分钟，完成后把 mp4 存到本地（`存图目录\videos\`），并在对话里回显成文件。

参数：

- `prompt`（必填）
- `mode`：`text`（默认，纯文生）/ `keyframe`（首尾帧）/ `reference`（参考图/音频/视频）；不填会按有没有给 `firstFrame` / `images` 自动推断
- `seconds` 4–12 的整数秒，默认 `5`
- `size`：`720P`（默认）/ `1080P` / `1K` / `2K`
- `aspectRatio`：默认 `16:9`，竖屏用 `9:16`
- `firstFrame` / `lastFrame`：首尾帧图片的**公网 URL**
- `images`：参考图公网 URL 列表（最多 8 张）
- `seed`、`model`（`agnes-video-2.5` 默认；`agnes-video-2.5-flash` 更快，720P 限时免费）

**计费**（人民币刊例价）：720P ¥0.15/秒，1080P 和 1K ¥0.25/秒，2K ¥0.35/秒。
默认 5 秒 720P ≈ ¥0.75。输入视频的秒数也会算进计费时长。

⭐ **`agnes-video-2.5-flash` 当前 720P 限时免费**：输出秒数、输入秒数、参考图都按 ¥0 计
（免费政策以 Agnes 平台公告为准）。flash 只支持 720P，最多 5 张参考图 + 3 段参考音频。
想省钱或先看效果，就用 `model: "agnes-video-2.5-flash"` + `size: "720P"`。

**素材限制**：首尾帧、参考图/音频/视频必须是公网 http(s) 地址 —— Agnes 服务端自己去下载，
本地文件路径和 data URI 都读不到，填了会直接报错提示。纯 `text` 模式不需要任何图片。

**只在「Agnes 官方」接口下可用**：切到自定义 OpenAI 兼容接口时，`agnes_video` 会明确拒绝。

## 安装

前提：已经装好 DeepSeek Harness（DSH），并且用的是 `desktop` profile。

**1. 放代码**

把本仓库放到任意目录，下面以 `D:\plugins\dsh-agnes-image` 为例。

**2. 在 profile 里登记依赖**

编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`：

```json
{
  "dependencies": {
    "dsh-agnes-image": "link:D:/plugins/dsh-agnes-image"
  }
}
```

**3. 建 junction，让 node_modules 能解析到它**

Windows 用管理员 PowerShell 跑（`link:` 依赖需要真实目录在 node_modules 里）：

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-agnes-image" `
  -Target "D:\plugins\dsh-agnes-image"
```

**4. 加进 bundles 列表**

还是那个 `package.json`，在 `dsh.profile.bundles` 末尾加上插件名：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["其他插件…", "dsh-agnes-image"]
    }
  }
}
```

**5. 重启 DSH**

重启后浏览器打开 `http://127.0.0.1:<端口>/api/agnes-image/config`，能返回 JSON 就说明加载成功
（端口每次启动都不同，看启动日志或环境变量 `DSH_WEB_URL`）。然后去 **设置 → Agnes 生图** 填 Key。

**不想用 link 的话**：整个目录复制到 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-agnes-image`，
再照第 4 步加 bundles、重启即可（改代码后要重新复制）。

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

- `index.js` —— 宿主半端：`agnes_image` / `agnes_video` 工具 + `/api/agnes-image/*` 设置接口
- `client.js` —— 浏览器半端：设置页（`settings.section`）
- `lib/agnes.mjs` —— 生图 API 封装（`POST https://api.agnes-ai.cn/v1/images/generations`）
- `lib/video.mjs` —— 视频 API 封装（`POST /v1/videos` 建任务 + `GET /agnesapi` 轮询 + 下载）
- `lib/hostdeps.mjs` —— 从宿主树取 `defineTool`；拿不到就用等价实现兜底
- `test/local-check.mjs` —— 不进 DSH 的本地自检：`node test/local-check.mjs`

## 注意

- 目前 Agnes 图像生成免费（1K ¥0/张）。
- 报错会原样透出（比如 `无效的令牌`），多半是 Key 粘贴时带了空格。
