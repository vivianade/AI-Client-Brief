# AI 客户需求整理器

把客户需求转成结构化 AI 项目方案，并在浏览器中保存历史项目。

## 第一步：配置 AI

1. 找到项目里的 `.env.example`。
2. 复制一份，命名为 `.env`。
3. 打开 `.env`，填写：

```env
AI_API_URL=https://api.openai.com/v1
AI_API_KEY=把你的API Key填在这里
AI_MODEL=gpt-4o-mini
```

## 第二步：启动

在项目文件夹打开 PowerShell，运行：

```powershell
node server.js
```

然后打开：`http://127.0.0.1:4173`

## 第三步：测试 AI

1. 填完页面中标有“必填”的内容。
2. 点击“AI 智能分析”。
3. 页面出现 8 个 AI 分析区域，表示 AI 已接通。

如果修改过 `.env`，请先关闭正在运行的服务，再重新执行 `node server.js`。

## 自动检查

```powershell
node --test tests/*.test.js
```

## Render 部署

在 Render 创建 Web Service 后填写：

```text
Build Command: npm install
Start Command: npm start
```

在 Render 的 Environment 中配置：

```text
HOST=0.0.0.0
AI_API_URL=你的 API 地址
AI_API_KEY=你的 API Key
AI_MODEL=你的模型名称
```

`PORT` 由 Render 自动提供，不需要手动填写。本地未配置 `HOST` 时，服务仍默认监听 `127.0.0.1:4173`。

历史项目继续使用 V1 的浏览器存储，不需要迁移。
