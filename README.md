# 表单自动填写助手

一个轻量油猴脚本，用来在任意网页上手动填写一次表单后，把当前域名的表单字段和值保存成规则，后续打开同域名页面时自动回填。

作者：wushui

仓库：https://github.com/JinRudy/tampermonkey-form-autofill

## 安装

1. 打开安装地址：`https://raw.githubusercontent.com/JinRudy/tampermonkey-form-autofill/main/form-autofill.user.js`。
2. Tampermonkey 会识别 `.user.js` 并进入安装/覆盖页面。
3. 点击安装或覆盖现有脚本。
4. 如果要测试本地 `file://` 页面，需要在浏览器扩展设置里允许 Tampermonkey 访问文件 URL。

## 更新

脚本通过 GitHub Raw 做在线更新，不需要启动本地服务。

脚本 metadata 内置：

```text
@name        表单自动填写助手
@author      wushui
@namespace   https://github.com/JinRudy/tampermonkey-form-autofill
@homepageURL https://github.com/JinRudy/tampermonkey-form-autofill
@icon        https://raw.githubusercontent.com/JinRudy/tampermonkey-form-autofill/main/assets/icon.svg
@updateURL   https://raw.githubusercontent.com/JinRudy/tampermonkey-form-autofill/main/form-autofill.user.js
@downloadURL https://raw.githubusercontent.com/JinRudy/tampermonkey-form-autofill/main/form-autofill.user.js
```

日常更新流程：

1. 修改本地 `form-autofill.user.js`。
2. 递增脚本 metadata 里的 `@version`。
3. 运行测试。
4. commit 并 push 到 GitHub `main`。
5. Tampermonkey 会按自己的更新检查机制从 GitHub Raw 拉取新版；也可以在 Tampermonkey Dashboard 里点一次“检查更新”立即触发。

首次切换到 GitHub 更新源时，需要从安装地址覆盖安装一次。原因是旧的本地脚本没有 GitHub `@updateURL` / `@downloadURL`，Tampermonkey 还不知道去 GitHub 检查更新。

说明：Codex 的 Chrome 控制工具不能操作 `chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html#nav=dashboard` 这类扩展管理页，所以首次覆盖安装仍需要你在 Tampermonkey 页面确认；之后更新只需要推送 GitHub。

## 使用流程

1. 打开目标网页，像平常一样手动填写表单。
2. 在提交前，点击右下角“表单”按钮，打开管理浮层。
3. 默认规则会自动绑定当前域名，规则名默认为 `YYYYMMDDHHmmss`，可以手动修改。
4. 点击“保存当前页面表单”，脚本会记录当前页面所有可填写字段。
5. 后续再次打开同域名页面时，启用状态的规则会自动回填。
6. 在浮层里可以修改字段值，然后点“保存面板修改”；也可以点击“立即回填”验证当前规则。

## 支持范围

- 支持 `input`、`textarea`、`select`、`checkbox`、`radio`。
- 支持同一页面多个 `<form>` 同时保存和回填；默认只记录真实 `<form>` 内字段，不记录插件面板或页面散落字段。
- 默认跳过 `password`、`file`、`hidden`、`disabled` 字段，避免保存密码、上传路径和一次性 token。
- 不会自动提交表单，只负责填写。

## 本地验证

打开 `test-pages/basic.html`，安装脚本后按使用流程测试：

1. 填写“客户资料”和“偏好设置”两个表单。
2. 点击右下角“表单”按钮。
3. 点击“保存当前页面表单”。
4. 刷新页面，验证两个表单会自动恢复。

也可以运行 smoke 测试：

```bash
node tests/smoke.mjs
```

## 注意

- 默认按 `location.hostname` 分组保存规则；同一域名下不同路径会共用规则。
- 如果多个启用规则都命中同一个字段，后执行的规则会覆盖前面的值。
- 大量前端框架会异步渲染表单，脚本会在页面加载后短时间内重复尝试回填，但不会无限监听页面变化。
