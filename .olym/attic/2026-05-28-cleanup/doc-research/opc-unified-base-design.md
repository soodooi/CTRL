# OPC产出统一承接底座设计

## 核心洞察

所有OPC产出，无论表面形态如何，底层都是：

1. **计算**：输入 → 处理 → 输出
2. **状态**：数据存储 + 查询 + 更新
3. **流程**：步骤序列 + 条件分支
4. **交互**：消息 + 响应 + 协作

## 统一抽象：可执行单元 (Executable Unit)

### 定义
```
ExecutableUnit = {
  // 元数据
  id: String,
  version: String,
  manifest: Manifest,
  
  // 执行接口
  runtime: Runtime,
  capabilities: CapabilitySet,
  
  // 数据接口
  input_ports: Vec<Port>,
  output_ports: Vec<Port>,
  state: Option<StateMachine>,
  
  // 生命周期
  lifecycle: LifecycleManager
}
```

### 四个基本类型

#### 1. 计算单元 (ComputeUnit)
```rust
struct ComputeUnit {
    // 计算函数
    compute_fn: fn(Input, Context) -> Output,
    
    // 资源需求
    resource_profile: ResourceProfile,
    
    // 副作用声明
    side_effects: Vec<SideEffect>
}

// 例子：AI翻译、文本处理、数据分析
```

#### 2. 流程单元 (FlowUnit)
```rust
struct FlowUnit {
    // 步骤DAG
    steps: DirectedAcyclicGraph<Step>,
    
    // 数据流
    data_flow: HashMap<StepId, DataFlow>,
    
    // 条件分支
    conditions: Vec<Condition>
}

// 例子：工作流、自动化、审批流程
```

#### 3. 状态单元 (StateUnit)
```rust
struct StateUnit {
    // 数据模型
    schema: Schema,
    
    // CRUD操作
    operations: Operations,
    
    // 查询接口
    queries: Queries,
    
    // 关系
    relations: Relations
}

// 例子：知识库、任务管理、文档系统
```

#### 4. 交互单元 (InteractionUnit)
```rust
struct InteractionUnit {
    // 消息协议
    protocol: Protocol,
    
    // 会话管理
    sessions: SessionManager,
    
    // 响应处理
    handlers: Handlers,
    
    // 协作状态
    collaboration: CollaborationState
}

// 例子：聊天机器人、协同工具、通知系统
```

## 统一运行时底座

### 1. 执行引擎 (Execution Engine)
```rust
// 统一执行引擎
struct UnifiedExecutionEngine {
    // 单元注册表
    unit_registry: Registry<ExecutableUnit>,
    
    // 资源调度器
    scheduler: ResourceScheduler,
    
    // 沙箱管理器
    sandbox_manager: SandboxManager,
    
    // 事件总线
    event_bus: EventBus,
    
    // 执行单元
    async fn execute(
        &self,
        unit_id: String,
        input: Event,
        context: ExecutionContext
    ) -> ExecutionResult {
        // 1. 查找单元
        let unit = self.unit_registry.get(unit_id);
        
        // 2. 检查能力
        self.check_capabilities(unit.capabilities, context);
        
        // 3. 分配资源
        let resources = self.scheduler.allocate(unit.resource_profile);
        
        // 4. 创建沙箱
        let sandbox = self.sandbox_manager.create(unit, resources);
        
        // 5. 执行
        let result = sandbox.execute(input).await;
        
        // 6. 清理
        self.scheduler.release(resources);
        
        result
    }
}
```

### 2. 资源模型 (Resource Model)
```rust
// 统一资源抽象
enum Resource {
    // 计算资源
    Cpu(cores: u32, percent: u8),
    Memory(mb: u32),
    Gpu(memory_mb: u32),
    
    // 存储资源
    Storage(mb: u32, iops: u32),
    
    // 网络资源
    Network(bandwidth_mbps: u32, latency_ms: u32),
    
    // 外部服务
    ExternalService {
        endpoint: String,
        rate_limit: RateLimit,
        cost_per_call: Option<f64>
    },
    
    // 系统权限
    SystemPermission {
        fs_access: Vec<Path>,
        network_access: Vec<Domain>,
        device_access: Vec<Device>
    }
}
```

### 3. 数据流模型 (Data Flow Model)
```rust
// 统一数据流
struct DataFlowSystem {
    // 端口注册
    ports: HashMap<PortId, Port>,
    
    // 连接
    connections: Vec<Connection>,
    
    // 数据类型系统
    type_system: TypeSystem,
    
    // 序列化格式
    serialization: SerializationFormat,
    
    // 连接两个单元
    fn connect(
        &mut self,
        source: (UnitId, PortId),
        sink: (UnitId, PortId)
    ) -> Result<ConnectionId> {
        // 检查类型兼容性
        let source_type = self.ports[&source.1].data_type;
        let sink_type = self.ports[&sink.1].data_type;
        
        if !self.type_system.is_compatible(source_type, sink_type) {
            return Err(TypeMismatchError);
        }
        
        // 创建连接
        let connection = Connection {
            id: generate_id(),
            source,
            sink,
            protocol: self.serialization.default_protocol()
        };
        
        self.connections.push(connection);
        Ok(connection.id)
    }
}
```

### 4. 状态管理 (State Management)
```rust
// 统一状态管理
struct StateManagementSystem {
    // 状态存储后端
    storage_backend: StorageBackend,
    
    // 事件溯源
    event_sourcing: EventSourcingEngine,
    
    // CRDT同步（用于协作）
    crdt_sync: CrdtSyncEngine,
    
    // 查询引擎
    query_engine: QueryEngine,
    
    // 保存状态
    async fn save_state(
        &self,
        unit_id: String,
        state: State,
        metadata: StateMetadata
    ) -> Result<Version> {
        // 1. 序列化状态
        let serialized = self.serialize_state(state);
        
        // 2. 生成事件
        let event = StateUpdatedEvent {
            unit_id: unit_id.clone(),
            state_hash: hash(&serialized),
            timestamp: now(),
            metadata
        };
        
        // 3. 存储到事件日志
        self.event_sourcing.append(event).await?;
        
        // 4. 保存到存储
        let version = self.storage_backend.save(
            unit_id,
            serialized
        ).await?;
        
        // 5. 同步到其他设备（如果启用）
        if metadata.should_sync {
            self.crdt_sync.sync(unit_id, version).await?;
        }
        
        Ok(version)
    }
}
```

## 统一接口标准

### 1. 声明式配置 (Declarative Configuration)
```yaml
# 统一manifest格式
opc_unit:
  # 基本信息
  id: "com.example.unit-type"
  version: "1.0.0"
  type: "compute|flow|state|interaction"
  
  # 能力声明
  capabilities:
    required:
      - "cpu:2cores"
      - "memory:512mb"
      - "network:api.example.com"
    optional:
      - "gpu:2gb"
      - "storage:1gb"
  
  # 接口定义
  interfaces:
    input:
      - port: "main_input"
        type: "text"
        schema: { type: "string", maxLength: 10000 }
      - port: "config"
        type: "json"
        schema: { type: "object" }
    
    output:
      - port: "main_output"
        type: "text"
      - port: "metadata"
        type: "json"
    
    state:
      schema: { /* JSON Schema */ }
      operations: ["create", "read", "update", "delete", "query"]
  
  # 执行配置
  execution:
    runtime: "wasm|deno|python|node"
    entrypoint: "main"
    timeout: "30s"
    retry_policy: { max_attempts: 3, backoff: "exponential" }
  
  # 依赖声明
  dependencies:
    - "lib:openai-api>=1.0.0"
    - "service:database"
    - "tool:image-processor"
  
  # 元数据
  metadata:
    author: { name: "Author", email: "author@example.com" }
    description: "Unit description"
    tags: ["ai", "processing", "utility"]
    license: "MIT"
```

### 2. 执行上下文 (Execution Context)
```rust
// 统一执行上下文
struct ExecutionContext {
    // 环境变量
    env: HashMap<String, String>,
    
    // 配置
    config: HashMap<String, Value>,
    
    // 用户身份
    user: UserIdentity,
    
    // 权限令牌
    tokens: HashMap<String, AuthToken>,
    
    // 会话状态
    session: SessionState,
    
    // 资源限制
    resource_limits: ResourceLimits,
    
    // 外部服务客户端
    services: ServiceClients,
    
    // 日志记录器
    logger: Logger,
    
    // 指标收集
    metrics: MetricsCollector
}
```

### 3. 结果格式 (Result Format)
```rust
// 统一执行结果
struct ExecutionResult {
    // 成功/失败
    success: bool,
    
    // 输出数据
    output: HashMap<PortId, Value>,
    
    // 状态变更
    state_changes: Vec<StateChange>,
    
    // 产生的事件
    emitted_events: Vec<Event>,
    
    // 资源使用
    resource_usage: ResourceUsage,
    
    // 执行时间
    execution_time: Duration,
    
    // 错误信息
    error: Option<ExecutionError>,
    
    // 调试信息
    debug: Option<DebugInfo>,
    
    // 后续建议
    suggestions: Vec<Suggestion>
}
```

## 具体实现策略

### 阶段1：基础运行时
1. **计算单元支持**：WASM/Deno沙箱，支持简单计算
2. **基本资源管理**：CPU/内存限制，简单调度
3. **输入输出接口**：文本/JSON数据传递

### 阶段2：完整类型支持
1. **流程单元**：DAG执行引擎，条件分支
2. **状态单元**：事件溯源状态管理
3. **交互单元**：消息协议，会话管理

### 阶段3：高级功能
1. **协作支持**：CRDT同步，实时协作
2. **分布式执行**：跨设备单元执行
3. **市场生态**：单元发现、安装、更新

## 技术选型建议

### 运行时层
- **WASM**：安全沙箱，多语言支持
- **Deno**：TypeScript运行时，权限控制
- **Lua/Luau**：轻量脚本，游戏行业验证

### 数据层
- **SQLite**：本地数据存储
- **Yjs**：CRDT协作
- **MessagePack/CBOR**：高效序列化

### 通信层
- **ST-SS协议**：现有CTRL协议
- **gRPC/Protobuf**：高效RPC
- **WebSocket**：实时通信

### 调度层
- **Tokio**：异步运行时
- **Rayon**：并行计算
- **Cgroups**：资源限制（Linux）

## 优势

### 1. 统一性
- 所有OPC产出使用同一套抽象
- 统一的配置、执行、管理接口
- 可组合、可复用

### 2. 扩展性
- 新的产出类型只需实现对应trait
- 运行时可插拔，支持多种技术栈
- 资源模型可扩展

### 3. 安全性
- 统一的沙箱和权限模型
- 能力安全（Capability Security）
- 资源隔离和限制

### 4. 协作性
- 内置状态同步和协作支持
- 可组合成复杂系统
- 易于分享和分发

## 应用场景

### 场景1：AI翻译工具
- **类型**：计算单元
- **实现**：WASM模块，调用翻译API
- **组合**：可与其他单元组合（如：文本提取→翻译→格式化）

### 场景2：内容创作工作流
- **类型**：流程单元
- **实现**：DAG定义多个计算单元
- **协作**：状态单元保存草稿，多人协作编辑

### 场景3：个人知识库
- **类型**：状态单元 + 计算单元
- **实现**：状态单元管理文档，计算单元提供搜索/摘要
- **同步**：CRDT同步到其他设备

### 场景4：团队协作工具
- **类型**：交互单元 + 状态单元
- **实现**：交互单元处理消息，状态单元管理任务状态
- **扩展**：可添加计算单元提供AI辅助

## 总结

这个统一底座的核心思想是：**所有OPC产出，无论表面形态如何，底层都是可执行单元**。通过统一的抽象和运行时，我们可以：

1. **承接任何类型的OPC产出**：计算、流程、状态、交互
2. **提供统一的用户体验**：配置、执行、管理方式一致
3. **支持自由组合**：单元可以连接成复杂系统
4. **确保安全可控**：统一的沙箱和权限模型
5. **便于生态发展**：标准化的接口和分发机制

这样，CTRL就成为了真正的"OPC产出承载平台"，而不仅仅是工具合集。