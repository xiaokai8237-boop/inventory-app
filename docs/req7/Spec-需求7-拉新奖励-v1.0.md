# Spec - 需求7 拉新奖励 v1.0

> 生成日期：2026-08-10
> 基于：PRD v0.1 + 架构文档 v0.1 + UIUX 文档 v0.1（用户已确认 2026-08-10）
> 状态：已确认
> 代码库：C:/Users/82375/Documents/框/inventory-app（git HEAD 3047f36 = v8.0.0）

---

## 1. 产品定义

- **一句话描述**：老用户邀请新用户注册，双方都获得 VIP 会员奖励，形成拉新裂变闭环。
- **目标用户**：物流筐收发管理系统存量用户（邀请人）+ 被邀请的新用户。
- **核心问题**：需求6 已完成邀请转发，但邀请关系仅存本地、无奖励、无记录 → 需求7 补齐"奖励发放 + 邀请记录 + 防作弊"。

## 2. MVP 范围（锁定——不在此列表的功能一律不做）

| 优先级 | 功能 | 验收标准摘要 | RICE |
|--------|------|-------------|------|
| P0 | 新用户注册送 1 个月 VIP | setup 成功 → vipUntil = now + 30 天 | 9 |
| P0 | 邀请人奖励 15 天 VIP | 被邀请人带码注册成功 → 邀请人 vipUntil + 15 天 | 8 |
| P0 | 被邀请人奖励 15 天 VIP | 被邀请人带码注册成功 → 被邀请人 vipUntil 额外 + 15 天 | 8 |
| P0 | 邀请记录页 | 脱敏手机号 + 注册时间 + 奖励状态 | 7 |
| P0 | 防作弊进阶版 | 设备去重 + 月上限 20 人 + 异常注册检测 | 7 |
| P1 | 奖励到账提示 | 注册成功/被邀请人注册 → 弹窗提示 | 6 |
| P1 | 双端生效 | 网页 + APK（WebView 壳自动生效） | 8 |

## 3. 明确不做（Out-of-Scope — 锁定）

| 不做的功能 | 原因 | 何时考虑 |
|------------|------|----------|
| 阶梯奖励（邀请5/10人解锁更多） | MVP 先验证单向裂变 | 用户反馈后 v2 |
| 邀请排行/排行榜 | 社交属性弱于记录页 | 有运营需求后 |
| 按成交奖励 | 本产品无订单/成交概念 | 不适用 |
| 现金/红包奖励 | 涉及资金与提现 | 付费模式成熟后 |
| 短信验证码服务 | 现登录体系为手机号+密码+密保 | 未来接短信再评估 |
| 邀请链接追踪点击次数 | 无法跨端可靠实现 | 有埋点需求后 |

## 4. 技术架构（锁定 — 版本已锚定）

> 版本锚定：以下版本均为实际已安装/线上运行版本（2026-08-10 实锤）。

| 层 | 技术 | 实际版本 | 锁定原因 |
|----|------|----------|----------|
| 前端 | 原生 HTML/JS（单文件 index.html） | v8.0.0（约 160KB） | 存量沿用，零框架零依赖 |
| 后端 | Cloudflare Pages Functions | ESM（Node 22 运行时兼容） | 存量沿用，functions/auth/[[path]].js 分发 |
| 存储 | Cloudflare KV（BACKUP_KV） | Pages 绑定 | 存量沿用 |
| 部署 | Cloudflare Pages（git push 自动部署） | - | 存量沿用 |
| APK | Capacitor 8 壳（WebView 远程加载 pages.dev） | @capacitor/core ^8.5.0 | **改网页即双端生效，APK 不重打包** |
| 认证 | JWT-like token（KV tok_<token> 30 天 TTL） | 存量 | 存量沿用 |
| 图标 | 内联 SVG 描边图标（16/20/24px） | 存量 | P0-1 锁定一套，零 emoji |

## 5. API 端点清单（锁定——开发时以此为唯一依据）

| Method | Path | 功能 | 认证 | 请求体 | 响应体 |
|--------|------|------|------|--------|--------|
| POST | /auth/setup | 注册（扩展：带邀请码） | 无 | {phone, password, securityQ, securityA, deviceId, inviteCode?} | {ok, token, vipUntil} |
| POST | /auth/verify | 登录（扩展：返回 vipUntil） | 无 | {phone, password?, skipPwd?, deviceId} | {ok, token, vipUntil, data} |
| GET | /api/invite/records | 邀请记录列表 | token | - | {ok, list: [{phone, time, status}]} |
| GET | /api/invite/stats | 本月邀请统计 | token | - | {ok, monthCount, limit: 20} |

### 服务端发奖规则（/auth/setup 内原子执行）

```
1. 校验手机号格式 + 密码 ≥6 位 + 密保必填（现有逻辑）
2. 读 account_<phone>：若已存在 → 返回错误"该手机号已注册"（防重复注册）
3. 新用户基础奖励：vipUntil = now + 30 天（无条件）
4. 若携带 inviteCode（KW+手机号后6位）：
   a. 解析邀请人手机号，校验 account_<inviter> 存在且 != 本人
   b. 防作弊校验（任一失败 → 不发邀请奖励，新用户 30 天照发）：
      - 设备去重：device_acc_<deviceId>.phones 已有 ≥2 账号 → deny
      - 月上限：invite_cnt_<inviter>_<YYYYMM> ≥ 20 → deny
      - 异常注册：同设备 10 分钟内 ≥3 次 setup → deny
   c. 通过 → 邀请人 vipUntil +15 天；被邀请人 vipUntil 额外 +15 天
   d. 写 invite_rel_<inviteePhone> = {inviterPhone, code, time, status: granted|denied}
   e. invite_cnt_<inviter>_<YYYYMM> += 1（granted 时）
   f. device_acc_<deviceId>.phones.push(inviteePhone)
5. 写 account_<phone>（含 vipUntil）
6. 返回 {ok, token, vipUntil}
```

## 6. 数据库表清单（锁定 — KV key 设计）

| key | 核心字段 | 说明 |
|-----|----------|------|
| account_<phone> | +vipUntil（ISO 字符串） | 扩展既有结构，新增字段 |
| invite_rel_<inviteePhone> | {inviterPhone, code, time, status} | 邀请关系（幂等：已存在不覆盖） |
| invite_cnt_<inviterPhone>_<YYYYMM> | 数字 | 邀请人当月已奖励人数（防作弊） |
| device_acc_<deviceId> | {phones: [], count, times: []} | 设备关联账号数 + 注册时间窗（异常检测） |

## 7. 页面清单（锁定）

| 页面 | 路由/容器 | 核心组件 | 对应 API | 设计 Token 主题 |
|------|-----------|----------|----------|-----------------|
| page-invite 拉新页（增强） | 现有 page-invite | 邀请记录入口按钮 + 本月进度条（X/20） | /api/invite/stats | 深空蓝晶+金 |
| page-invite-records 邀请记录页（新增） | 新 page 容器 | 记录列表项（头像占位/脱敏手机号/时间/状态徽标） | /api/invite/records | 深空蓝晶+金+绿/红 |
| 奖励到账弹窗（新增） | 复用 showModal 机制 | 皇冠 SVG + 奖励天数 + 到期日期 + 确认 | - | 深空蓝晶+金 |

## 8. 设计 Token（锁定）

- **主色**：#0A1A22（深空蓝底）/ #0E3340（卡片）/ 金 #F5DC92 / 渐变金 #F8E3A6→#E0A63E / 青 #7CE8E0 / 绿 #4ADE80 / 红 #FF6B6B
- **字体**：Noto Sans SC（思源黑体，SIL OFL 免费商用），栈 `'Noto Sans SC','Source Han Sans SC','HarmonyOS Sans SC',sans-serif`
- **图标库**：内联 SVG 描边图标（16/20/24px），**零 emoji**（P0-1）
- **主题**：深色（深空蓝晶）
- **对标品牌**：沿用本项目既有设计语言（非营销落地页，实用工具风）

## 9. 验收标准（锁定 — EARS 格式，QA 唯一依据）

| 编号 | 功能 | EARS 格式验收标准 | 优先级 |
|------|------|-------------------|--------|
| AC-01 | 注册送VIP | When 新用户通过 /auth/setup 注册成功，系统**必须**将该账号 vipUntil 设为 now+30 天并返回 | P0 |
| AC-02 | 重复注册 | If 手机号已存在于 account_<phone>，系统**必须**返回错误且**不得**覆盖原账号 | P0 |
| AC-03 | 邀请奖励 | When 新用户携带有效 inviteCode 注册成功，系统**必须**给邀请人 vipUntil +15 天 | P0 |
| AC-04 | 被邀请奖励 | When 新用户携带有效 inviteCode 注册成功，系统**必须**给被邀请人 vipUntil 额外 +15 天 | P0 |
| AC-05 | 无效邀请码 | If inviteCode 对应邀请人不存在或为本人，系统**必须**忽略该码且新用户 30 天照发 | P0 |
| AC-06 | 设备去重 | When 同一 deviceId 已关联 ≥2 个账号再次带码注册，系统**必须**拒绝发邀请人奖励（deny） | P0 |
| AC-07 | 月上限 | When 邀请人当月已奖励 20 人，第 21 次带码注册，系统**必须**拒绝发邀请人奖励 | P0 |
| AC-08 | 异常注册 | When 同设备 10 分钟内 setup ≥3 次，系统**必须**对后续带码注册拒绝发邀请奖励 | P0 |
| AC-09 | 邀请记录 | When 邀请人登录后请求 /api/invite/records，系统**必须**返回脱敏手机号/注册时间/状态 | P0 |
| AC-10 | 登录同步VIP | When 用户登录 /auth/verify 成功，响应**必须**包含 vipUntil，前端同步到 localStorage | P0 |
| AC-11 | 记录页展示 | When 邀请记录页加载，系统**必须**显示本月进度 X/20 与记录列表 | P1 |
| AC-12 | 奖励提示 | When 注册成功或被邀请人注册成功，系统**必须**弹出奖励到账提示 | P1 |
| AC-13 | 零emoji | While 渲染所有新增 UI，系统**必须**只使用 SVG 图标，不得出现 emoji 功能图标 | P0 |
| AC-14 | 双端生效 | When 网页版功能上线，APK（WebView 加载 pages.dev）**必须**无需重装即生效 | P0 |

## 10. 边界与约束

- 不支持 IE；移动端优先（360-428px）
- 版本号规则：需求7 上线升 **v8.1.0**（小位 0→1，功能新增）/ sw v272→v273 / version.txt 同步
- 前端改动需同步 3 处版本：APP_VERSION（index.html）/ sw CACHE（sw.js）/ version.txt
- 防作弊为服务端权威判断，前端不可绕过
- 测试期 VIP_TEST_MODE=true 保留（便于验收），正式收费时切 false

## 11. 内嵌已知坑（从项目记忆拉取）

| 坑 | 技术栈指纹 | 根因 | 修法 |
|----|------------|------|------|
| git push GitHub 失败（大文件必断） | inventory-app | HTTPS smart HTTP 截断 | `git -c http.sslBackend=openssl push`；APK 大文件用 pages.dev 绝对 URL |
| raw.githubusercontent 国内不可达 | app-version.json | 被墙 | APK 下载地址必须用 pages.dev 正式域名 |
| 替换页面残留旧元素 | index.html | 历史遗留卡未删 | 严格对照定稿设计稿，只保留设计稿元素 |
| 删除数据复活 | restoreFromCloud | 自动恢复无条件 | 需求7 不涉及删除，但发奖逻辑必须幂等（invite_rel_ 已存在不覆盖） |
| emoji 残留 | index.html | 历史用 emoji 作图标 | 开发后 grep 扫描 `[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}]` 等，替换 SVG |

## 12. 端到端验证步骤（Spec 锁定）

```bash
# 1. 本地语法检查（两个 functions 文件 + index.html JS）
node --check "functions/auth/[[path]].js"
node --check "functions/[[path]].js"

# 2. 启动本地预览（可选，需 wrangler 环境）
# npx wrangler pages dev . --binding BACKUP_KV=xxx

# 3. 核心成功流：新用户带邀请码注册
# POST /auth/setup {phone:"13800138001", password:"Test@1234", securityQ:"q", securityA:"a", deviceId:"dev-test-1", inviteCode:"KW138000"}
# 断言：ok=true，返回 vipUntil = now+30天+15天（被邀请人）；account_13800138000.vipUntil = now+15天（邀请人）
# 断言：invite_rel_13800138001.status = granted；invite_cnt_13800138000_202608 = 1

# 4. 关键错误流：重复注册
# POST /auth/setup 同手机号 13800138001 → 断言：返回错误，原账号不被覆盖

# 5. 防作弊流：同设备第 3 个账号带码注册
# deviceId 同为 dev-test-1，第 3 次 setup 带 inviteCode
# 断言：新用户 30 天照发，邀请人**不** +15（status=denied）

# 6. 登录同步
# POST /auth/verify {phone:"13800138001", password:"Test@1234", deviceId:"dev-test-1"}
# 断言：响应含 vipUntil

# 7. 邀请记录
# GET /api/invite/records（带 token）→ 断言：list 含 {phone:"138****8001", time, status}
```

## 13. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-08-10 | Spec v1.0 生成 | 三文档用户确认 | 全部 |
| 2026-08-10 | **v1.1 小改**：① 注册页新增「邀请码（选填）」输入框（设计稿图5/5）② 海报底部链接条改二维码区（图4/5）③ 海报文案"输入邀请码注册"→"扫码注册，自动领会员" ④ 邀请码来源优先级：手动填 > URL 参数 | 用户 Phase 2 反馈：直接下载 APP 的用户无邀请码入口；线下扫码需二维码 | 前端 setup 页 + page-invite + 海报 Canvas；后端 /auth/setup 接收 inviteCode（已预留） |
