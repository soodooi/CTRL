# flomo与CTRL项目集成指南

## 概述

本指南说明如何将flomo笔记工具与CTRL项目集成，用于记录和管理keycap（工具）意向。

## flomo简介

flomo（浮墨笔记）是一个专注于记录灵感和想法的笔记工具，特点包括：
- 快速输入（支持API、Raycast等）
- 标签系统
- 全平台同步
- 无广告，注重隐私

## 集成方案

### 方案1：Webhook自动同步（推荐）

#### 配置步骤
1. **获取flomo API Key**
   - 登录flomo网页版
   - 进入设置 → API
   - 获取API Key

2. **配置flomo Inbox Webhook**
   - 在flomo设置中配置Inbox Webhook
   - Webhook URL：`https://your-server.com/flomo-webhook`
   - 配置触发条件（如特定标签）

3. **实现Webhook处理器**
   ```typescript
   // packages/ctrl-webhook/src/flomo-handler.ts
   export class FlomoHandler {
     async handleWebhook(request: Request): Promise<Response> {
       const data = await request.json();
       
       // 解析flomo笔记
       const note = this.parseFlomoNote(data);
       
       // 检查是否为keycap意向
       if (this.isKeycapIdea(note)) {
         // 提取工具信息
         const toolIdea = this.extractToolIdea(note);
         
         // 保存到keycap意向记录
         await this.saveToKeycapRecord(toolIdea);
         
         // 可选：发送通知
         await this.sendNotification(toolIdea);
       }
       
       return new Response('OK', { status: 200 });
     }
   }
   ```

#### 标签约定
建议在flomo中使用以下标签：
- `#ctrl-keycap` - 标记为keycap意向
- `#ctrl-p0`、`#ctrl-p1`、`#ctrl-p2` - 优先级标签
- `#ctrl-cli`、`#ctrl-http`、`#ctrl-mcp` - 工具类型标签
- `#ctrl-idea`、`#ctrl-research`、`#ctrl-dev` - 状态标签

### 方案2：API定期同步

#### 实现步骤
1. **定期调用flomo API**
   ```typescript
   // packages/ctrl-sync/src/flomo-sync.ts
   export class FlomoSync {
     private apiKey: string;
     private baseUrl = 'https://flomoapp.com/api/v1';
     
     async syncKeycapIdeas(): Promise<void> {
       // 获取带有#ctrl-keycap标签的笔记
       const notes = await this.getNotesByTag('ctrl-keycap');
       
       for (const note of notes) {
         // 解析并保存
         const toolIdea = this.parseNote(note);
         await this.saveToRecord(toolIdea);
       }
     }
     
     private async getNotesByTag(tag: string): Promise<any[]> {
       const response = await fetch(
         `${this.baseUrl}/memo?tag=${tag}`,
         {
           headers: {
             'Authorization': `Bearer ${this.apiKey}`,
             'Content-Type': 'application/json'
           }
         }
       );
       
       return await response.json();
     }
   }
   ```

2. **设置定时任务**
   ```typescript
   // 每小时同步一次
   setInterval(() => {
     const sync = new FlomoSync();
     sync.syncKeycapIdeas();
   }, 60 * 60 * 1000);
   ```

### 方案3：手动同步（简单起步）

#### 操作流程
1. **在flomo中记录**
   ```
   #ctrl-keycap #ctrl-p0 #ctrl-mcp
   八字算命工具
   
   描述：基于cantian-ai/bazi-mcp的八字算命工具
   类型：MCP
   优先级：P0
   状态：想法
   相关链接：GitHub: cantian-ai/bazi-mcp
   
   备注：作为第一个验证的OPC成品
   ```

2. **定期整理到项目文档**
   - 每周整理一次flomo中的记录
   - 手动更新到`doc/keycap-ideas-record.md`
   - 更新状态和优先级

## 笔记格式规范

### 标准格式
```
#ctrl-keycap #ctrl-p0 #ctrl-mcp
[工具名称]

描述：[详细描述]
类型：[CLI/HTTP/MCP/WebView/Declarative]
优先级：[P0/P1/P2]
状态：[想法/调研中/开发中/已完成]
相关链接：[URL或参考]

备注：[额外信息]
```

### 示例
```
#ctrl-keycap #ctrl-p1 #ctrl-http
飞书消息发送工具

描述：通过飞书API发送消息到群聊或个人
类型：HTTP
优先级：P1
状态：想法
相关链接：飞书开放平台文档

备注：需要OAuth授权，适合企业场景
```

## 自动化处理规则

### 1. 标签解析规则
- `#ctrl-keycap`：标记为keycap意向
- `#ctrl-p[0-2]`：解析优先级
- `#ctrl-[type]`：解析工具类型
- `#ctrl-[status]`：解析状态

### 2. 内容解析规则
- 第一行：工具名称
- `描述：`开头：工具描述
- `类型：`开头：工具类型
- `优先级：`开头：优先级
- `状态：`开头：状态
- `相关链接：`开头：链接
- `备注：`开头：备注

### 3. 自动分类规则
基于内容关键词自动分类：
- 包含"API"、"HTTP"、"REST"：类型为HTTP
- 包含"命令行"、"CLI"、"shell"：类型为CLI
- 包含"MCP"、"Anthropic"：类型为MCP
- 包含"网页"、"WebView"、"界面"：类型为WebView
- 其他：类型为Declarative

## 与CTRL项目集成

### 1. 项目结构
```
CTRL/
├── packages/
│   ├── ctrl-flomo-integration/     # flomo集成包
│   │   ├── src/
│   │   │   ├── flomo-handler.ts    # Webhook处理器
│   │   │   ├── flomo-sync.ts       # API同步器
│   │   │   └── flomo-parser.ts     # 笔记解析器
│   │   └── package.json
├── doc/
│   ├── keycap-ideas-record.md      # 意向记录主文档
│   └── flomo-integration-guide.md  # 本指南
```

### 2. 数据流
```
flomo笔记 → Webhook/API → 解析器 → 意向记录 → 开发计划
    ↑                                      ↓
用户输入                              工具开发
```

### 3. 状态同步
- **flomo状态更新**：在flomo中更新标签（如`#ctrl-dev` → `#ctrl-done`）
- **项目状态同步**：自动同步到`keycap-ideas-record.md`
- **开发进度跟踪**：与GitHub Issues或项目管理工具集成

## 最佳实践

### 1. 记录规范
- 使用标准格式记录
- 添加足够的标签
- 包含相关链接
- 定期整理和更新

### 2. 优先级管理
- P0：立即开始，核心验证
- P1：近期规划，重要功能
- P2：长期考虑，探索性功能

### 3. 状态跟踪
- 想法：初步想法
- 调研中：正在调研技术方案
- 开发中：正在开发
- 已完成：开发完成
- 已上线：已集成到CTRL平台

## 故障排除

### 常见问题
1. **Webhook未触发**
   - 检查flomo Webhook配置
   - 检查服务器可访问性
   - 检查日志记录

2. **API调用失败**
   - 检查API Key有效性
   - 检查网络连接
   - 检查API限制

3. **解析错误**
   - 检查笔记格式
   - 检查标签使用
   - 检查内容结构

### 调试建议
1. 启用详细日志
2. 测试单个笔记同步
3. 检查中间数据
4. 验证最终结果

## 扩展功能

### 1. AI自动分类
使用Minimax API自动分类和提取信息：
```typescript
async function autoClassifyNote(content: string): Promise<ToolIdea> {
  const prompt = `分析以下工具意向：
${content}

请提取：名称、描述、类型、优先级、状态、相关链接、备注`;
  
  const response = await minimaxClient.chatCompletion({
    messages: [{ role: 'user', content: prompt }]
  });
  
  return this.parseAIResponse(response);
}
```

### 2. 自动生成manifest
基于工具描述自动生成manifest草案：
```typescript
async function generateManifestDraft(idea: ToolIdea): Promise<ToolManifest> {
  const prompt = `根据以下工具描述生成CTRL工具manifest：
名称：${idea.name}
描述：${idea.description}
类型：${idea.type}

请生成完整的manifest JSON`;
  
  // 调用Minimax API
  // 解析和验证manifest
  // 返回结果
}
```

### 3. 社区征集集成
将flomo记录与社区反馈集成：
- 从V2EX、即刻等社区收集意向
- 自动记录到flomo
- 同步到项目文档

## 开始使用

### 快速开始
1. **选择集成方案**
   - 推荐：方案1（Webhook自动同步）
   - 简单：方案3（手动同步）

2. **配置flomo**
   - 创建`#ctrl-keycap`标签
   - 配置Webhook或准备API Key

3. **开始记录**
   - 按标准格式记录工具意向
   - 添加适当标签
   - 定期整理和更新

### 下一步
1. 实现基础集成
2. 测试同步流程
3. 优化解析规则
4. 扩展高级功能

---

*本指南将持续更新，反映最佳实践和新技术*
*最后更新：2026-05-16*