# OPC产出具体承接方案

基于统一底座，具体分析如何承接各种OPC产出。

## 1. AI工具/Agent类产出

### 典型例子
- AI翻译工具（DeepL、Google Translate包装）
- 文本生成工具（GPT、Claude包装）
- 图像处理工具（Stable Diffusion、DALL-E包装）
- 数据分析工具（Pandas、数据分析AI）

### 承接方式：计算单元
```yaml
# AI翻译工具manifest
opc_unit:
  id: "com.deepl.translator"
  type: "compute"
  version: "1.0.0"
  
  capabilities:
    required:
      - "cpu:1core"
      - "memory:256mb"
      - "network:api.deepl.com"
    optional:
      - "gpu:1gb"  # 用于本地模型
  
  interfaces:
    input:
      - port: "text"
        type: "text"
        schema: { type: "string", maxLength: 5000 }
      - port: "target_lang"
        type: "enum"
        schema: { enum: ["EN", "ZH", "JA", "KO"] }
    
    output:
      - port: "translated"
        type: "text"
      - port: "confidence"
        type: "number"
        schema: { type: "number", minimum: 0, maximum: 1 }
  
  execution:
    runtime: "wasm"
    entrypoint: "translate"
    timeout: "10s"
    
  dependencies:
    - "lib:deepl-api>=1.0.0"
  
  metadata:
    author: { name: "DeepL", url: "https://www.deepl.com" }
    description: "DeepL AI翻译工具"
    tags: ["ai", "translation", "language"]
```

### 运行时实现
```rust
// WASM模块实现
#[wasm_bindgen]
pub struct DeepLTranslator {
    api_key: String,
    client: reqwest::Client,
}

#[wasm_bindgen]
impl DeepLTranslator {
    pub async fn translate(
        &self,
        text: String,
        target_lang: String
    ) -> Result<TranslationResult, JsError> {
        let response = self.client
            .post("https://api.deepl.com/v2/translate")
            .header("Authorization", format!("DeepL-Auth-Key {}", self.api_key))
            .json(&json!({
                "text": [text],
                "target_lang": target_lang
            }))
            .send()
            .await?;
        
        let result: DeepLResponse = response.json().await?;
        Ok(TranslationResult {
            translated: result.translations[0].text.clone(),
            confidence: result.translations[0].confidence.unwrap_or(0.0)
        })
    }
}
```

## 2. 工作流/自动化类产出

### 典型例子
- 内容创作流水线（收集→处理→发布）
- 数据备份工作流（收集→转换→存储）
- 日报生成工作流（数据收集→分析→格式化→发送）
- 客户跟进自动化（触发→处理→通知）

### 承接方式：流程单元
```yaml
# 内容创作工作流manifest
opc_unit:
  id: "com.creator.content-pipeline"
  type: "flow"
  version: "1.0.0"
  
  capabilities:
    required:
      - "cpu:2cores"
      - "memory:512mb"
      - "network:api.openai.com"
      - "network:api.notion.com"
    optional:
      - "storage:100mb"
  
  interfaces:
    input:
      - port: "topic"
        type: "text"
      - port: "audience"
        type: "enum"
        schema: { enum: ["general", "technical", "business"] }
    
    output:
      - port: "published_url"
        type: "url"
      - port: "analytics"
        type: "json"
  
  # DAG定义
  flow:
    steps:
      - id: "research"
        type: "compute"
        unit: "com.openai.researcher"
        input_mapping:
          topic: "$.topic"
          depth: "deep"
      
      - id: "outline"
        type: "compute"
        unit: "com.openai.outliner"
        input_mapping:
          research: "$.research.output"
          audience: "$.audience"
        depends_on: ["research"]
      
      - id: "write"
        type: "compute"
        unit: "com.openai.writer"
        input_mapping:
          outline: "$.outline.output"
          style: "professional"
        depends_on: ["outline"]
      
      - id: "publish"
        type: "compute"
        unit: "com.notion.publisher"
        input_mapping:
          content: "$.write.output"
          database_id: "${NOTION_DATABASE_ID}"
        depends_on: ["write"]
    
    outputs:
      published_url: "$.publish.output.url"
      analytics: "$.publish.output.metrics"
  
  execution:
    runtime: "dag"
    timeout: "300s"
  
  dependencies:
    - "unit:com.openai.researcher>=1.0.0"
    - "unit:com.openai.outliner>=1.0.0"
    - "unit:com.openai.writer>=1.0.0"
    - "unit:com.notion.publisher>=1.0.0"
```

### 运行时实现
```rust
// DAG执行引擎
struct DagExecutor {
    steps: HashMap<StepId, Step>,
    dependencies: HashMap<StepId, Vec<StepId>>,
    data_flow: DataFlowGraph,
}

impl DagExecutor {
    async fn execute(&self, inputs: HashMap<PortId, Value>) -> ExecutionResult {
        // 拓扑排序
        let execution_order = self.topological_sort();
        
        // 执行上下文
        let mut context = ExecutionContext::new(inputs);
        
        for step_id in execution_order {
            let step = &self.steps[&step_id];
            
            // 准备输入
            let step_inputs = self.prepare_inputs(step, &context);
            
            // 执行步骤
            let step_result = self.execute_step(step, step_inputs).await?;
            
            // 更新上下文
            context.update(step_id, step_result);
        }
        
        // 收集输出
        let outputs = self.collect_outputs(&context);
        
        ExecutionResult {
            success: true,
            output: outputs,
            // ... 其他字段
        }
    }
}
```

## 3. 数据管理类产出

### 典型例子
- 个人知识库（笔记、文档管理）
- 任务管理系统（待办、进度跟踪）
- 客户关系管理（联系人、跟进记录）
- 资源库（图片、文件管理）

### 承接方式：状态单元
```yaml
# 个人知识库manifest
opc_unit:
  id: "com.personal.knowledge-base"
  type: "state"
  version: "1.0.0"
  
  capabilities:
    required:
      - "storage:1gb"
      - "cpu:1core"
      - "memory:256mb"
    optional:
      - "network:api.openai.com"  # 用于语义搜索
  
  interfaces:
    # CRUD操作
    operations:
      create_note:
        input:
          title: "text"
          content: "text"
          tags: "array<string>"
        output:
          id: "uuid"
          created_at: "datetime"
      
      update_note:
        input:
          id: "uuid"
          updates: "object"
        output:
          updated: "boolean"
          version: "number"
      
      delete_note:
        input:
          id: "uuid"
        output:
          deleted: "boolean"
      
      get_note:
        input:
          id: "uuid"
        output:
          note: "object"
    
    # 查询接口
    queries:
      search:
        input:
          query: "text"
          limit: "number"
          offset: "number"
        output:
          results: "array<object>"
          total: "number"
      
      by_tag:
        input:
          tag: "string"
        output:
          notes: "array<object>"
    
    # 状态接口
    state:
      schema:
        type: "object"
        properties:
          notes:
            type: "array"
            items:
              type: "object"
              properties:
                id: { type: "string" }
                title: { type: "string" }
                content: { type: "string" }
                tags: { type: "array", items: { type: "string" } }
                created_at: { type: "string", format: "date-time" }
                updated_at: { type: "string", format: "date-time" }
          indexes:
            type: "object"
            properties:
              by_tag: { type: "object" }
              by_date: { type: "object" }
  
  execution:
    runtime: "sqlite"  # 使用SQLite作为存储后端
    schema_migration: "auto"
  
  metadata:
    author: { name: "CTRL Team" }
    description: "个人知识库，支持笔记管理和语义搜索"
    tags: ["knowledge", "notes", "organization"]
```

### 运行时实现
```rust
// 状态单元实现
struct KnowledgeBase {
    db: SqliteConnection,
    embedding_model: Option<EmbeddingModel>,
}

impl StateUnit for KnowledgeBase {
    async fn create_note(&self, input: CreateNoteInput) -> Result<CreateNoteOutput> {
        let note = Note {
            id: Uuid::new_v4(),
            title: input.title,
            content: input.content,
            tags: input.tags,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        
        // 保存到数据库
        self.db.execute(
            "INSERT INTO notes (id, title, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            params![
                note.id.to_string(),
                note.title,
                note.content,
                serde_json::to_string(&note.tags)?,
                note.created_at.to_rfc3339(),
                note.updated_at.to_rfc3339()
            ]
        ).await?;
        
        // 更新索引
        self.update_indexes(&note).await?;
        
        Ok(CreateNoteOutput {
            id: note.id,
            created_at: note.created_at,
        })
    }
    
    async fn search(&self, input: SearchInput) -> Result<SearchOutput> {
        if let Some(model) = &self.embedding_model {
            // 语义搜索
            let query_embedding = model.embed(&input.query).await?;
            let results = self.semantic_search(query_embedding, input.limit).await?;
            Ok(SearchOutput { results, total: results.len() as u32 })
        } else {
            // 关键词搜索
            let results = self.keyword_search(&input.query, input.limit, input.offset).await?;
            let total = self.count_keyword_results(&input.query).await?;
            Ok(SearchOutput { results, total })
        }
    }
}
```

## 4. 协作工具类产出

### 典型例子
- 团队聊天机器人
- 协同编辑工具
- 通知和提醒系统
- 投票和决策工具

### 承接方式：交互单元
```yaml
# 团队聊天机器人manifest
opc_unit:
  id: "com.team.chat-bot"
  type: "interaction"
  version: "1.0.0"
  
  capabilities:
    required:
      - "cpu:1core"
      - "memory:512mb"
      - "network:api.slack.com"
      - "network:api.openai.com"
    optional:
      - "storage:100mb"
  
  interfaces:
    # 消息协议
    protocol:
      type: "websocket"
      format: "json"
      events:
        message_received:
          schema:
            type: "object"
            properties:
              channel: { type: "string" }
              user: { type: "string" }
              text: { type: "string" }
              timestamp: { type: "string", format: "date-time" }
        
        message_sent:
          schema:
            type: "object"
            properties:
              channel: { type: "string" }
              text: { type: "string" }
              attachments: { type: "array", items: { type: "object" } }
    
    # 会话管理
    sessions:
      timeout: "30m"
      max_sessions: 1000
      persistence: "memory"  # 或 "database"
    
    # 消息处理器
    handlers:
      - pattern: "help"
        action: "show_help"
        description: "显示帮助信息"
      
      - pattern: "remind me to (.+)"
        action: "create_reminder"
        description: "创建提醒"
      
      - pattern: "what can you do"
        action: "list_capabilities"
        description: "列出功能"
      
      - pattern: ".*"  # 默认处理器
        action: "ai_response"
        description: "AI回复"
    
    # 状态接口
    state:
      schema:
        type: "object"
        properties:
          reminders:
            type: "array"
            items:
              type: "object"
              properties:
                id: { type: "string" }
                user: { type: "string" }
                text: { type: "string" }
                due_at: { type: "string", format: "date-time" }
                completed: { type: "boolean" }
          user_preferences:
            type: "object"
            additionalProperties:
              type: "object"
              properties:
                timezone: { type: "string" }
                language: { type: "string" }
                notification_preferences: { type: "object" }
  
  execution:
    runtime: "node"  # Node.js适合聊天机器人
    entrypoint: "bot.js"
    keep_alive: true  # 常驻运行
  
  dependencies:
    - "lib:slack-sdk>=1.0.0"
    - "lib:openai>=4.0.0"
    - "lib:node-schedule>=2.0.0"
```

### 运行时实现
```javascript
// Node.js聊天机器人实现
class TeamChatBot {
  constructor(config) {
    this.slack = new SlackClient(config.slackToken);
    this.openai = new OpenAIClient(config.openaiKey);
    this.sessions = new Map();
    this.reminders = new ReminderManager();
  }
  
  async handleMessage(event) {
    const { channel, user, text, timestamp } = event;
    
    // 获取或创建会话
    const session = this.getSession(user, channel);
    
    // 匹配处理器
    const handler = this.matchHandler(text);
    
    // 执行处理器
    let response;
    switch (handler.action) {
      case 'show_help':
        response = await this.showHelp();
        break;
      
      case 'create_reminder':
        const match = text.match(/remind me to (.+)/i);
        response = await this.createReminder(user, match[1]);
        break;
      
      case 'ai_response':
        response = await this.generateAIResponse(text, session.context);
        break;
      
      default:
        response = { text: "I didn't understand that. Try 'help' for assistance." };
    }
    
    // 发送响应
    await this.slack.postMessage({
      channel,
      text: response.text,
      attachments: response.attachments
    });
    
    // 更新会话
    session.update({
      lastMessage: text,
      lastResponse: response.text,
      timestamp
    });
  }
  
  async generateAIResponse(text, context) {
    const messages = [
      { role: "system", content: "You are a helpful team assistant." },
      ...context.map(msg => ({
        role: msg.from === 'user' ? 'user' : 'assistant',
        content: msg.text
      })),
      { role: "user", content: text }
    ];
    
    const completion = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages,
      max_tokens: 500
    });
    
    return {
      text: completion.choices[0].message.content,
      metadata: {
        model: "gpt-4",
        tokens: completion.usage.total_tokens
      }
    };
  }
}
```

## 5. 混合型产出承接

很多OPC产出是混合型的，例如：

### 例子：智能项目管理系统
- **状态单元**：管理任务、进度、文档
- **计算单元**：AI任务分配、进度预测
- **流程单元**：工作流自动化
- **交互单元**：团队通知、聊天

### 承接方式：组合单元
```yaml
# 智能项目管理系统manifest
opc_unit:
  id: "com.smart.project-manager"
  type: "composite"
  version: "1.0.0"
  
  # 组合多个单元
  components:
    - id: "task-manager"
      type: "state"
      unit: "com.basic.task-manager"
      config:
        schema: "extended"
        notifications: true
    
    - id: "ai-assistant"
      type: "compute"
      unit: "com.openai.project-assistant"
      config:
        model: "gpt-4"
        capabilities: ["planning", "estimation", "risk_analysis"]
    
    - id: "workflow-engine"
      type: "flow"
      unit: "com.basic.workflow-engine"
      config:
        templates: ["sprint_planning", "retrospective", "review"]
    
    - id: "team-notifier"
      type: "interaction"
      unit: "com.basic.team-notifier"
      config:
        channels: ["slack", "email", "in-app"]
  
  # 组件间连接
  connections:
    - source: ["task-manager", "task_created"]
      sink: ["team-notifier", "notify"]
      transform: "format_notification"
    
    - source: ["task-manager", "task_updated"]
      sink: ["ai-assistant", "analyze"]
      condition: "priority == 'high'"
    
    - source: ["ai-assistant", "recommendation"]
      sink: ["workflow-engine", "trigger"]
      transform: "create_workflow"
    
    - source: ["workflow-engine", "completed"]
      sink: ["task-manager", "update"]
      transform: "mark_completed"
  
  # 统一接口
  interfaces:
    input:
      - port: "command"
        type: "enum"
        schema: { enum: ["create_task", "start_sprint", "generate_report"] }
      - port: "data"
        type: "json"
    
    output:
      - port: "result"
        type: "json"
      - port: "notifications"
        type: "array<object>"
    
    state:
      exposed: ["tasks", "sprints", "reports"]
      operations: ["query", "aggregate", "export"]
```

## 承接优势总结

### 1. **统一性**
- 所有产出使用同一套抽象和接口
- 统一的配置、部署、管理方式
- 可互相操作和组合

### 2. **可扩展性**
- 新的产出类型只需实现对应单元类型
- 运行时支持多种技术栈
- 资源模型可灵活扩展

### 3. **安全性**
- 统一的沙箱和权限模型
- 能力安全（最小权限原则）
- 资源隔离和限制

### 4. **协作性**
- 内置状态同步和消息传递
- 支持实时协作
- 易于分享和分发

### 5. **性能**
- 资源感知的调度
- 本地优先的执行
- 高效的序列化和通信

## 实施路线

### 阶段1：基础单元支持
1. 计算单元（WASM/Deno）
2. 简单状态单元（SQLite）
3. 基本交互单元（WebSocket）

### 阶段2：完整类型支持
1. 流程单元（DAG引擎）
2. 高级状态单元（事件溯源、CRDT）
3. 高级交互单元（协议支持、会话管理）

### 阶段3：混合和高级功能
1. 组合单元支持
2. 分布式执行
3. 市场生态

这样，CTRL就能真正成为"OPC产出承载平台"，而不是简单的工具合集。