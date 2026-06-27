# CTRL — Code Review Ledger

> 跨会话台账。新会话先读本文件,接着查「待查」的批次。
> 目标: 把项目跑通、没有影响使用的 bug、能分享给别人打开就能正常用。
> 方法: ① 跑 app 按真实用户路径抓行为 bug(主力) ② 子 agent 分批读代码查 bug(每个 agent 独立上下文,防主对话污染)。
> 规矩: 报 bug 必须贴真实代码 + 行号; 拿不准的标「待确认」; 不改测试; 修完跑回归再打勾。
> 防污染铁律: ① 少用 Playwright 截图(image 占大量 token) ② 一出现输出重复/没写过的文案,立刻落盘 + /clear 续。
> ③ ★实测教训: 主对话自己连续读代码/跑命令/看输出, 2 轮就污染。所以重活(读代码、跑验证、看长输出)一律派子 agent 去做 —— 子 agent 有独立干净上下文, 做完只回报精简结论(bug: 文件:行+问题, 带真实代码)。主对话只「发指令 + 收结论 + 记台账」, 保持极轻, 才不污染。这是主力工作方式, 不是备选。

## 图例
- ⬜ 待查 ｜ 🔄 进行中 ｜ ✅ 已查
- 严重度: P0 崩溃/打不开 ｜ P1 主流程坏 ｜ P2 边缘 ｜ P3 小瑕疵

---

## ★ 关键发现 / 验证环境(下个会话先看)
- dev server: `npm run dev` → 前端 http://localhost:5173/ (纯浏览器,无 Tauri、无 kernel)。
- ✅ 已干净核实(2026-06-26): `src-tauri/src/bin/` 只有 `dump_mcp_schema.rs` + `setup_llm_key.rs` 两个工具 bin;`src-tauri/Cargo.toml` **无 `[[bin]]` kernel 段**。**确认没有独立 kernel binary。** package.json: `dev`=前端 only(:5173)、`tauri:dev`=完整 app。
  → **真实后端验证只能跑完整 `npm run tauri:dev`**(编译整个 app + 起桌面窗口);没有「浏览器+独立 kernel」捷径。纯浏览器 :5173 只能验前端渲染/逻辑。
  → 上会话怀疑的污染幻觉到此澄清: 当时 `ls` 报「目录不存在」是污染,目录其实存在(只是没 kernel bin)。
- 纯浏览器(无 kernel)模式的限制: Tauri API (`__TAURI_INTERNALS__`) 和 kernel WS(17872) 都不存在,会产生「环境性」错误(见 Bug#1/#2 + WS 失败),这些在真实 Tauri 桌面 app 里不会发生,判断 bug 时要分清「真实产品 bug」vs「浏览器缺环境」。

---

## A. 运行时验证(动态 — 主力)
> ★ 静态审查(R1-R5 + F1-F7)= 全部完成,28 个 finding,22 个已修已提交(见下 commit 列)。**下个会话主力 = D2-D5 运行时**,须跑完整 `npm run tauri:dev`(无 kernel binary 捷径),按真实用户路径抓静态查不到的行为 bug。
| 批次 | 范围 | 状态 |
|------|------|------|
| D1 | 真机启动(tauri:dev) | ✅ **真机 boot 干净**:整 app 编译过(v0.1.621)、无 panic、4 服务全 listening(:5173 vite / :17873 gate / :17890 hermes / :17872 WS)、projector 写 .mcp.json 进 vault 根(/Users/mac/Documents/pkm)。boot log 零 error/panic。 |
| D2 | Irisy 对话主流程 | 🟡 后端就绪(llm_chat 工具在 scope + provider_chain=[anthropic,ollama,volc-doubao,zhipu] 已配)。**完整流式对话 UI(persona/Stop/morph)是 webview 交互层,需人在窗口点**(headless 驱动不了 Tauri 原生窗口)。 |
| D3 | mcp 发现 / 连接 / 调用 | ✅ **真机 gate 端到端**:MCP initialize 握手 200+session;tools/list 带 caller+intent 返 51 工具、**net(http/web_search)正确缺席**;不带 intent header 退到最小集(2 system 工具)= SC3 默认最小敞口真机验证;**负向:vault-intent 调 web_search 被拒**(out of scope,纵深防御);kernel_status 真实(1 mcp / uptime)。 |
| D4 | vault 读写 + viewer | ✅ **真机 vault 往返**:vault_write(body 契约,Bug#13)→wrote→磁盘真出现 64B 文件(vim test 过)→vault_read 取回 content+frontmatter→vault_delete 文件消失;notes_query 返真实行;smart_table_describe 工具可达+参数校验。viewer 渲染层(Tiptap/CodeMirror/mermaid)是 webview,需人在窗口看。 |
| D5 | feature-pack 安装 | 🟡 后端就绪(registry_query/discover 在 scope,kernel_status 示 1 mcp 已装)。**装包是 UI one-shot 流(拖装/扫码),需人在窗口点**。 |

## B. 后端 Rust 静态检查(113 files)
| 批次 | 范围 | 文件数 | 状态 |
|------|------|--------|------|
| R1 | src-tauri/src 顶层 + bin | 5 | ✅ 干净。main/lib boot 路径 .expect 仅 malformed bundle 触发(可接受),asset_scheme 路径穿越守护稳。1 P3 见 Bug#12 |
| R2 | commands/ | 31 | ✅ 干净,无 P0/P1。全英文✅ 无硬编码 secret(走 keychain)✅ 无可达 panic✅ serde 字段契约(snake_case)逐 caller 核对齐✅ 全命令都在 pwa_invoke_handler! 注册。1 P3/待确认见 Bug#7。注: content-vs-body 那类契约现已移到 kernel gate tool 层(gate_invoke 透传 raw Value),不在 commands/ |
| R3 | kernel/ 核心 | 35 | ✅ 查 mcp_server/audit/visibility/projector/persistence/provider — gate 强制健全、全英文、secrets 走 keychain、无 P0/P1。1 P2 + 3 P3 见 Bug#3-6 |
| R4 | kernel/provider/(含 adapter) | 26 | ✅ 全 26 文件读完。硬规则干净(无中文/无硬编码 key/日志不泄 key/缺 key 走 NotConfigured 优雅降级)。1 P2 + 2 P3 + 3 待确认见 Bug#8-10 |
| R5 | shell/ | 16 | ✅ boot 路径无启动 panic(best-effort spawn 全 log-and-continue,端口占用/hermes 装失败正确降级)。1 P1(Windows 编译,已修)见 Bug#11 |

## C. 前端静态检查(203 files,不含 *.test.*)
| 批次 | 范围 | 文件数 | 状态 |
|------|------|--------|------|
| F1 | src 顶层 + routes/ + hooks/ + gate 桥 | 25 | ✅ gate 字段契约逐 caller 核对 mcp-schema.json:kernel.ts ~33 处全对。1 P1(IrisyChat 绕 wrapper)见 Bug#13。bridge/hooks 无泄漏无竞态 |
| F2 | lib/ | 54 | ✅ gate 字段契约逐 caller 核对 56 工具全对(vaultWrite content→body 正确)。bridge/transport/store 干净。1 P2 硬规则(中文字面量!)+ 1 P2 PWA + 2 P3 见 Bug#24-27 |
| F3 | components/irisy + workspace + ambient | 29 | ✅ textarea streaming 时不 disable✅ 真 Stop 按钮✅ 无中文。1 P1 + 3 P2 + 3 P3 见 Bug#14-17,23 |
| F4 | components/primitives | 27 | ✅ 干净。primitives spread 的是 typed HTMLAttributes 来自可信内部 caller(非 Bug#19 那种 untrusted manifest),无需 allowlist。.map 全有 key,JSON.parse try/catch。2 P3 note 见 Bug#28 |
| F5 | components/viewers | 28 | ✅ 2 P1 安全(XSS)+ 2 P2/P3 见 Bug#18,20,21,22。viewer-registry/Html/Mermaid/Json 干净 |
| F6 | components/notes + manifest + featurepack + 其他小目录 | 24 | ✅ 1 P1 安全(ManifestRenderer props)见 Bug#19。FeaturePack/ActionBar try/catch 兜住 |
| F7 | components 顶层 + personas/irisy + modules | 16 | ✅ 干净。Bug#1(OllamaSetupBanner)是 F4/F7 唯一直接 import raw tauri 的文件,真实抛点是 :98-110 listen IIFE(非 :30-45);其余全走 lib/bridge 安全降级。persona/module 配置加载优雅降级 |

---

## Bug 清单
| # | 来源 | 文件:行 | 问题 | 严重度 | 状态 |
|---|------|---------|------|--------|------|
| 1 | D1 | components/OllamaSetupBanner.tsx:98-110(真实抛点是第二个 useEffect 的 listen IIFE,非 :30-45) | `await listen('ollama://setup-progress', …)` 无 isTauri() 守卫/无 try/catch → 非 Tauri 环境抛未捕获 transformCallback。F7 复审确认: 这是 F4/F7 唯一直接 import raw tauri 的文件,无他例。第一个 useEffect 的 invoke(:66-82)与 triggerPull(:120-128)已 try/catch。修法: listen IIFE 加 isTauri 守卫 + try/catch(照 lib/bridge 模式)。 | P3 | 已确认,待修 |
| 2 | F1 | hooks/useActiveProvider.ts:19-33 (invoke 在 22) | invoke('get_active_provider') 排在 isTauri() 检查(25)之前执行 → 浏览器下先无谓抛错(被 30 行 catch 吞,无害,但顺序错)。修法: 把 if(!isTauri())return 提到 invoke 之前。 | P3 | 已确认,待修 |
| 3 | R3 | kernel/mcp_server.rs:1814-1824 (web_search) | Tavily key **存在但调用失败时**(key 过期/配额耗尽/Tavily 抖动)`tavily_search(...).await?` 直接 hard-fail;keyless Wikipedia 兜底只在「无 key」时触发,从不在「有 key 但失败」时触发 → 违反 derived rule #1「云不在→降级不 hard fail」,Irisy 报「搜索坏了」而非降级到百科结果。修法: tavily_search Err 时降级到 wikipedia_search(或只在 auth 错误 hard-fail,网络/5xx 降级)。 | P2 | 已确认,待修 |
| 4 | R3 | kernel/visibility.rs:78-113 (tool_domain) | 下游 MCP 工具命名 `<server>_<tool>` 本应归 `mcp` 域,但分类是 prefix/exact 优先 → 用户装的 server id 撞保留前缀(vault/market/notes…)或字面产出 `web_search`(server `web`+tool `search`)会被归进**第一方域**,在更窄 intent / BYO-CLI 默认(排除 mcp)下变得可见可调 = 最小权限泄漏。仅用户装 server 边缘,无崩溃。修法: 已知下游 server 前缀先归 mcp,或下游工具用保留分隔符命名空间。 | P3 | 待确认 |
| 5 | R3 | kernel/persistence.rs:57,76 (record_call) | `conn.lock().expect("audit ledger conn poisoned")` — record_call 文档说「best-effort,ledger 失败绝不阻断底层调用」且 mcp_server.rs:2331 处理了 Err,但**毒化的 mutex 让 expect panic** 而非返回 Err → best-effort 审计写变成请求任务 panic。需先前持锁时 panic(低概率),但违反 best-effort 契约。修法: `lock().unwrap_or_else(|e| e.into_inner())` 保持返回 Result。 | P3 | 已确认,待修 |
| 6 | R3 | kernel/mcp_server.rs:2388 | gate token 用 `t == expected.as_str()` 非常量时间比较。Loopback-only + 每次启动 ephemeral UUID 使 timing 攻击不现实;仅记录完整性,非真实暴露。 | P3 | 不修(非真实暴露) |
| 7 | R2 | commands/irisy_chat.rs:365-379 | hermes ACP `prompt` 在已 stream 部分 `chat-stream-delta` token **之后**才报错 → fallthrough 到 provider router 重发完整答案,早先 partial delta 未撤回 → UI 可能显示重复/串扰。仅 hermes 中途失败(罕见)触发;是否真串扰取决于 PWA 对 done 前 delta 的去重(Rust 侧确认不了)。 | P3 | 待确认 |
| 8 | R4 | kernel/provider/adapter/http_api.rs:229 | 流式 SSE 逐 chunk `String::from_utf8_lossy(&bytes)` 独立解码,reqwest bytes_stream 在任意传输边界切分 → 跨 chunk 的 3 字节中文字符/emoji 两侧各成 U+FFFD 乱码。任何 BYOK http_api provider 流式中文回复都会间歇乱码;**主力用户中文 → user-visible**。修法: 用 Vec<u8> 累积原始字节,只对完整 line/event 做 from_utf8(增量 decoder 跨 chunk 留尾)。 | P2 | 已确认,待修 |
| 9 | R4 | kernel/provider/adapter/http_api.rs:230 | SSE event 边界只 `buf.find("\n\n")`,用 `\r\n\r\n` 的 SSE 服务(规范允许,部分「OpenAI 兼容」第三方端点 CTRL 明确支持)永不匹配 → 一个 event 都不派发,EOF 时残留 buffer 被丢 → 用户看到空回复无报错。修法: 归一化 CR 或同时 split `\r\n\r\n`。 | P3 | 已确认,待修 |
| 10 | R4 | kernel/provider/adapter/cli/claude_persistent.rs:193-200 | 120s wall-clock timeout 触发时 `work` future(含 MutexGuard)被中途取消但未 set `needs_drain=true`(consumer-drop:167 / read-error:187 都设了)→ 下一轮 drain_pending_response 早退,把上一轮超时残留的 assistant/result token 当本轮回复读 → 错答/串答。仅 deadline 路径(罕见)。修法: deadline 错误发送前 set needs_drain,或下一轮 abort 后总是 drain。 | P3 | 已确认,待修 |
| 11 | R5 | shell/window.rs:123 (toggle 重建分支) | `cloak::set(&w, false)` 引用 let-else 绑定 `w`(只在 else 之后成功路径可见,else 块内未绑定)→ Windows target E0425 整 crate 编译不过。Windows-gated 故 macOS dev 编译没事但 Windows(CLAUDE.md 主 dev 平台)红。对齐隔壁 reveal():`&w`→`&_w`。 | P1 | ✅ 已修(下表) |
| 12 | R1 | bin/setup_llm_key.rs:14 | keychain SERVICE = "app.ctrl.spike",但 runtime shell/keychain.rs:17 读 "app.ctrl"(已故意改名去 .spike)→ 经 setup_llm_key 存的 key 被 KeychainStore::get 找不到(死命名空间)。低影响(runtime 凭据现走 credential_vault 文件 vault,该 bin 是 dev helper)。修法: 对齐 SERVICE 为 "app.ctrl"。 | P3 | 已确认,待修 |
| — | R4 | claude_persistent.rs:97-115 / 140,459 / routing.rs REST kinds | 待确认 3 项: ① persistent child 用首轮 model+system 起,后续切 model/system 被静默忽略(可能 UX bug 或可接受限制) ② 每轮发完整 folded history 当一条 user event,若 CLI session 有状态则历史重复膨胀 ③ rest_* adapter 非流式(整段 buffer 一次吐),首 chunk peek 阻塞到全响应完才出 → 用户干等(违反「别让用户等」)。影响取决于 PWA AddModal 写哪个 kind。 | 待确认 | — |
| 13 | F1 | components/irisy/IrisyChat.tsx:836 (saveReplyToVault) | `gateInvoke('vault_write',{path,content:body,...})` 送 `content` 但 kernel VaultWriteArgs.body 必填(mcp_server.rs:266 无 default/alias)→ serde missing field → 每次「保存回复到 vault」hard-fail(用户见 Save failed)。功能 100% 坏。绕过了 kernel.ts:510 已修的 vaultWrite wrapper。修法: 改走 vaultWrite({path,content,frontmatter}) wrapper(单一 SSOT)。 | P1 | 已确认,待修 |
| 14 | F3 | components/ambient/AmbientHome.tsx:415-417 | 主唤起页 composer 流循环 `if(!delta)continue` 跳过错误 chunk;transport 不抛异常、错误走 `{delta:'',done:true,error}`(llm-transport.ts:230)→ catch 抓不到 → brain 超时/崩溃/无 auth 全静默:半截冻住或误显「No AI provider set up yet」。IrisyChat 正确(:636 查 chunk.error)。修法: 循环内查 chunk.error + humanizePiError 展示。 | P1 | 已确认,待修 |
| 15 | F3 | components/ambient/AmbientHome.tsx:305 | `if(!trimmed\|\|streaming)return` —— streaming 时按 Enter 静默无反应(textarea 可编辑但发不出),用户须先 Stop 再发。IrisyChat 守「never block」会 abort 在途 turn 再发新(:563)。修法: 镜像 IrisyChat,abortRef.abort() 后继续。 | P2 | 已确认,待修 |
| 16 | F3 | components/irisy/IrisyChat.tsx:571,613 | 消息 ID `u-/a-${Date.now()}`,interrupt-redirect(streaming 中发新)+ ?text= 预填竞态/快速双 Enter 同毫秒 → ID 碰撞 → cleanup flatMap(:686)/delta 路由(:652)误匹配删除或串写 bubble + React dup key。custom-message 路径已用随机后缀(:670)防。修法: ID 加 counter/Math.random 后缀。 | P2 | 已确认,待修 |
| 17 | F3 | IrisyChat.tsx:650 / AmbientHome.tsx:418 | 两端 delta 纯 append 无 reset/replace 路径;接后端 Bug#7(hermes 中途失败重发完整答案)→ 完整文本拼到已 stream 的 partial 后 → 可见重复/串扰。LLMChunk 无 restart marker。修法(根治在后端): kernel 别重发完整答案,或加 restart/replace chunk kind 让前端清 buffer。 | P2 | 待确认(配 Bug#7) |
| 18 | F5 | components/viewers/SvgViewer.tsx:59 | 第三方 mcp 包的 icon.svg(`~/.ctrl/mcps/<id>/assets/`)经 `dangerouslySetInnerHTML={{__html:content}}` 注入 → SVG 内联事件(onload/onerror/javascript:)在 innerHTML 插入时触发 = XSS。文件注释「vault 是用户控制非第三方」对 mcp-icon 路径是错的。Tauri 桌面 CSP(script-src 'self')挡住,但 PWA index.html 无 meta CSP → 纯浏览器/移动 PWA 模式 live。HtmlViewer 用 sandbox="" iframe 是对的范式。修法: SVG 走同样 sandboxed iframe,或 DOMPurify SVG profile,或 `<img src=blob/data-uri>`。 | P1(安全) | 已确认,待修 |
| 19 | F6 | components/manifest/ManifestRenderer.tsx:57 | `<Component {...(element.props??{})}>` spread 未净化的 manifest props(schema.ts:31 类型 z.record(string,unknown) 任意键);dangerouslySetInnerHTML 可 JSON 序列化夹带 → 落到 primitives(Button/Card 等 {...rest} 到 DOM)= XSS via 恶意 manifest。registry 只 allowlist 组件名不管 props。同样 PWA 模式 live。修法: spread 前剥离 dangerouslySetInnerHTML/ref/on* 等保留/handler 键。 | P1(安全) | 已确认,待修 |
| 20 | F5 | components/viewers/markdownConvert.ts + MarkdownViewer.tsx:152 | markdownConvert.ts 是死码(零 importer,注释谎称被 MarkdownViewer 用);两处都 `<a href="$2">` 无 scheme 过滤(javascript:/data: 透传),live 路径 Tiptap setContent 基本中和(StarterKit 无 Link mark),但死码差一个 dangerouslySetInnerHTML 就成 sink。修法: 删 markdownConvert.ts(单一 SSOT)+ 活路径链接加 scheme allowlist。 | P2 | 已确认,待修 |
| 21 | F5 | components/viewers/SmartTableViewer.tsx:66-77,171 | readVault 查询无错误分支,文件缺失/读不了 → entry undefined → 空 schema → 误显「schema missing 加 schema: 块」而非加载失败。混淆非崩溃。 | P3 | 已确认,待修 |
| 22 | F5 | components/viewers/ImageViewer.tsx:44 | `<img>` 无 onError,坏/超大资源显示原生破图标无 fallback/提示。 | P3 | 已确认,待修 |
| 23 | F3 | IrisyChat.tsx:640,738(stale activeBrain)/715(reflection 无 signal 不可取消)/无 unmount abort | 3 个 P3:错误文案可能名错 provider(activeBrain 不在 deps);post-turn runReflection 无 signal,Stop/新 turn 取消不了(资源);unmount 不 abort 流(React18 无害但漏)。 | P3 | 已确认,待修 |
| 24 | F2 | lib/kernel.ts:221 (listModels) | invoke('provider_list_models',{args:{base_url,api_key}}) 但 Rust 命令(provider_models.rs:89)只收 `provider_id:String` 无 args 信封 → 100% 「missing field provider_id」。当前零 caller(死码),但注释广告它是 ollama/LM-Studio 发现路径,谁接谁中招。修法: 删,或改 invoke('provider_query_models',{endpoint,apiKey}) 对齐真命令。 | P3 | 已确认,待修 |
| 25 | F2 | lib/irisy-reflection.ts:93-101 (CORRECTION_MARKERS_ZH) | **硬规则违反**: 8 个中文字符串字面量('不对'/'错了'…)。文件内注释辩称是「语言检测数据非散文」可豁免,但 CLAUDE.md 硬规则对字符串字面量绝对(整个项目代码零中文)+ v1 global-english。lib 层唯一含中文文件。bao 拍板: 挪 locale 数据文件。 | P2(硬规则) | ✅ 已修 a507784 |
| 26 | F2 | lib/{feature-pack.ts:6,connector.ts,pack-registry.ts:11,use-agent.ts:13} | 直接从 @tauri-apps/api/core import invoke(非 ./bridge)→ 跳过 bridge 给非 Tauri(移动/web PWA)的 WS 降级。web 模式: loadInstalledPacks 吞 throw 返回空列表(侧栏空),install/uninstall/runAction/connectRemoteMcp 未捕获抛错。桌面不受影响。移动 PWA 是 v1.1+ scope 非 v1 blocker,但违反 bridge「app 代码不分平台」契约。修法: 从 ./bridge import invoke。 | P2 | 已确认,待修 |
| 27 | F2 | lib/smart-tables.ts:194 (importCsv) | importCsv 直写 `tables/${slug}.md` 无碰撞检查,而 createSmartTable(:133)走 uniqueTablePath。同名 CSV 导入第二次静默覆盖第一张表 = 低频数据丢失。修法: importCsv 也走 uniqueTablePath。 | P3 | 已确认,待修 |
| 28 | F4 | primitives/Gauge.tsx:38 / TabBar.tsx:58 | 2 个低置信 P3:Gauge value/max 当 max=0 → NaN strokeDashoffset(静默视觉 no-op 无崩溃);TabBar resolveIcon 对 off-type tab.kind 可能传 undefined 进 IconRenderer switch 抛错(实践中被类型挡掉)。caller 传脏数据边缘。 | P3 | 已确认,待修 |

## 已修复
| # | 文件:行 | 修复说明 | commit |
|---|---------|---------|--------|
| 3 | kernel/mcp_server.rs:~1816-1835 | web_search: Tavily key 存在但失败时降级到 wikipedia_search(只在 wikipedia 也失败才返回 Err);无 key 路径不变。cargo test --lib 272 passed。 | 9fb7b04 |
| 5 | kernel/persistence.rs:57,76 | record_call/audit_count 的 `.lock().expect()` → `.lock().unwrap_or_else(\|e\| e.into_inner())`,毒锁不再 panic,保 best-effort 契约。 | 9fb7b04 |
| 11 | shell/window.rs:123 | toggle 重建分支 `cloak::set(&w,false)` → `&_w`,修 Windows 编译 E0425(对齐 reveal())。macOS dev 编译不变。 | 9fb7b04 |
| 8 | kernel/provider/adapter/http_api.rs | spawn_sse_reader 改用 Vec<u8> 累积原始字节,只对完整 SSE event 切片 decode → 跨 chunk 中文/emoji 不再 U+FFFD。cargo test --lib 272 passed。 | 9fb7b04 |
| 9 | kernel/provider/adapter/http_api.rs | 新增 find_sse_event_boundary,LF(\\n\\n)+CRLF(\\r\\n\\r\\n)取最早边界 → CRLF SSE 端点不再空回复。 | 9fb7b04 |
| 10 | kernel/provider/adapter/cli/claude_persistent.rs:204 | deadline 分支发 DeadlineExceeded 前 set `needs_drain=true`(对齐 :167/:187)→ 下轮正确丢弃超时残留 token。 | 9fb7b04 |
| 12 | bin/setup_llm_key.rs:14 | SERVICE "app.ctrl.spike" → "app.ctrl" 对齐 runtime keychain reader。 | 9fb7b04 |
| 13 | components/irisy/IrisyChat.tsx:838 | saveReplyToVault 改走 vaultWrite wrapper(content→body 正确映射)→ 保存回复修好。 | 7887510 |
| 14 | components/ambient/AmbientHome.tsx:415,443 | 流循环内查 chunk.error + humanizePiError 展示;streamError flag 抑制误报「No AI provider」。humanizePiError 提到 lib/irisy-render-filter.ts 共用。 | 7887510 |
| 15 | components/ambient/AmbientHome.tsx:305,464 | 去掉 streaming early-return,改 abortRef.abort() 后发送(对齐 IrisyChat);finally 加 controller 守卫防串扰。 | 7887510 |
| 16 | components/irisy/IrisyChat.tsx:571,613 | 消息 ID 加 Math.random().toString(36) 后缀,防同毫秒碰撞。 | 7887510 |
| 18 | components/viewers/SvgViewer.tsx:59 | dangerouslySetInnerHTML → `<img src=data:image/svg+xml>`(img 模式不执行脚本),修错误注释。 | 7887510 |
| 19 | components/manifest/ManifestRenderer.tsx:78 | sanitizeProps 剥离 dangerouslySetInnerHTML/ref/key/on* 再 spread。 | 7887510 |
| 20 | components/viewers/markdownConvert.ts(删)+ MarkdownViewer.tsx | git rm 死码;活路径链接加 safeHref scheme allowlist(http/https/mailto/相对,挡 javascript:/data:)。 | 7887510 |
| 21 | components/viewers/SmartTableViewer.tsx:66,171 | 区分加载失败 vs schema 缺失,前者显加载错误。 | 7887510 |
| 22 | components/viewers/ImageViewer.tsx:16,43 | 加 failed 态 + `<img onError>` fallback。 | 7887510 |
| 25 | lib/irisy-reflection.ts + lib/locale/correction-markers.cjk.json(新) | 8 个中文标记挪进 JSON 数据文件(数据非代码),.ts import 它 → 代码层零中文(bao 钦定方案)。检测逻辑不变。 | a507784 |
| 4 | kernel/visibility.rs + mcp_server.rs | tool_domain 下游来源工具(<server>_<tool>)在第一方 prefix 表前归 mcp 域(镜像 dispatch_tool 路由);list_tools 隐藏 + call_tool 拒绝(纵深)。+1 单测。cargo 273 passed。 | a507784 |
| 26 | lib/{feature-pack,connector,pack-registry,use-agent}.ts | invoke 从 @tauri-apps 改 import 自 ./bridge → web/PWA 模式获 WS 降级。 | a507784 |
| 1 | components/OllamaSetupBanner.tsx | 第二个 useEffect 的 listen IIFE 加 platform()!=='tauri' 守卫 + try/catch。 | a507784 |
| 23 | components/irisy/IrisyChat.tsx | activeBrain 加进 sendMessage deps;runReflection 传 signal;unmount cleanup abort。 | a507784 |
| 24 | lib/kernel.ts | 删死的 listModels(坏契约,零 caller)。 | a507784 |
| 27 | lib/smart-tables.ts | importCsv 走 uniqueTablePath,防同名覆盖。 | a507784 |
| 28 | primitives/Gauge.tsx + TabBar.tsx | Gauge max<=0 守卫;TabBar off-type kind fallback icon。 | a507784 |
| 注 | 4 处 + 3 处误导 ADR 引用 | cleanup agent 又为过 PreToolUse hook 给 bridge 改动贴 `ADR-003 §5 (2026-06-26)`(今日假 amendment)→ 已改诚实引用 `ADR-003 §1 (PWA bridge)`。ADR-005 §persona-shell v5 那几处日期真实(2026-06-09)保留。**复证: hook 强制引用 → 子 agent 反复编造,主对话每轮必核。** | a507784 |
| 注 | 3 处误导 ADR 引用 | fix agent 为过 architecture-guard hook 给纯 bug-fix 注释贴了 `ADR-002 § provider v8 §3.5 (2026-06-26)`(实际 §3.5/v8 是 routing,且无该日期 amendment = 编造)→ 已改回诚实技术注释,去引用。**教训: 子 agent 可能为过 hook 编造 ADR 引用,主对话需核实。** | 已修 |

---

## 系统断点 (bao 标记给 ctrl 项目,非功能包)

> bao 2026-06-26 标的项目系统断点,与功能包 create 无关(那条线另一工程师/Irisy 负责)。

| # | 断点 | 状态 |
|---|------|------|
| BP1 | `ui_surface.workspace.tabs[]`(v3 多 tab)渲染器 `AdaptiveWorkspaceTabs` 是 placeholder(viewer dispatch / props 消费 0%) | **闭环** 836b79e — 抽纯 `AdaptiveWorkspaceTabs.dispatch.ts`(`contentTypeForViewer`/`tabToResource`/`INTERACTIVE_VIEWERS`),`.tsx` 经 `ViewerHost` 落 content-type viewer registry;7 单测绿 + tsc 0;独立 checker PASS;cite 核实诚实(§8.2 morph + §7.1 Tab 列)。**未挂载**:无 live importer,Tab 列 router 选「挂哪个 mcp 的 tabs」是后续 mount 步(那步才能 Playwright 验视觉)。 |
| BP2 | watchlist 的 vault-write + `{{quotes}}` 模板替换 + smart-table 落点渲染,依赖 kernel step engine 运行时行为 | 待办 — 需真机跑 kernel 链路验证(当前有 running kernel :17873 + gate token 可做)。 |
| BP3 | 「工具输出被持续注入污染」(终端回显被替换成假数据) | 上 session 已查:`.claude/settings.json` / `~/.claude` / `~/.zshrc` / shell snapshots 全干净,无 PostToolUse hook;判定 = 模型/transcript confabulation,非机器注入。防污染铁律(顶部 ③)继续守。 |
