# CTRL作为OPC成品承载平台设计文档

## 1. 核心定位调整

### 1.1 从"AI工具合集"到"OPC成品承载平台"
- **旧定位**：模块化的AI-native桌面工具合集 + 全网生态聚合入口
- **新定位**：OPC成品承载平台 + 轻量化分发渠道 + 分享访问门户

### 1.2 核心价值主张
- **对OPC创作者**：提供标准化的成品承载和分发渠道
- **对OPC用户**：提供统一的工具访问和管理界面
- **对飞书等平台**：提供轻量化的OPC段替代方案

## 2. 解决24小时开机问题

### 2.1 问题分析
用户在意电脑24小时开机，主要担忧：
1. **能耗问题**：持续运行增加电费
2. **系统资源**：占用内存和CPU
3. **稳定性**：长期运行可能影响系统稳定性
4. **隐私安全**：持续运行增加安全风险

### 2.2 解决方案：按需启动 + 智能休眠

#### 2.2.1 按需启动机制
```rust
// 工具生命周期管理
pub struct ToolLifecycle {
    // 工具状态
    status: ToolStatus,
    // 启动策略
    startup_policy: StartupPolicy,
    // 资源限制
    resource_limits: ResourceLimits,
}

pub enum StartupPolicy {
    // 按需启动：用户调用时启动
    OnDemand,
    // 延迟启动：系统空闲时启动
    Lazy,
    // 预启动：系统启动时预加载
    Preload,
    // 常驻：24小时运行
    Resident,
}
```

#### 2.2.2 智能休眠策略
- **空闲检测**：检测工具使用频率，自动休眠
- **资源监控**：监控CPU/内存使用，自动降级
- **唤醒机制**：用户访问时快速唤醒

#### 2.2.3 系统服务集成
- **Windows服务**：作为系统服务运行，支持自动重启
- **macOS LaunchDaemon**：作为守护进程运行
- **Linux systemd**：作为systemd服务运行

## 3. 飞书集成轻量化承接

### 3.1 飞书MCP现状分析
飞书官方提供MCP插件，支持：
- **文档操作**：创建、读取、编辑文档
- **任务管理**：创建、分配、跟踪任务
- **消息发送**：发送消息到个人或群组
- **日历管理**：创建、查看、管理日历事件

### 3.2 CTRL轻量化承接方案

#### 3.2.1 简化配置流程
```yaml
# CTRL飞书工具配置示例
feishu_tool:
  name: "飞书文档助手"
  type: "mcp"
  mcp_server: "lark-mcp"
  config:
    app_id: "${FEISHU_APP_ID}"
    app_secret: "${FEISHU_APP_SECRET}"
    auth_type: "user"  # 简化：只支持user模式
    enabled_modules: "document,task,message"
  permissions:
    - "docs:document.content:read"
    - "docs:document:write_only"
    - "task:task:write"
    - "im:message:send_as_bot"
```

#### 3.2.2 一键OAuth引导
- **图形化配置向导**：引导用户完成飞书应用创建
- **自动权限申请**：根据工具需求自动申请权限
- **Token安全存储**：使用系统Keychain安全存储

#### 3.2.3 数据同步策略
- **本地缓存**：常用数据本地缓存，减少网络请求
- **增量同步**：只同步变更数据，减少流量
- **离线支持**：基础功能支持离线使用

## 4. 工具集成层设计

### 4.1 轻量化集成接口
基于CTRL原有的6种接入方式，优化为更轻量的3层：

#### 4.1.1 声明式层（零代码）
```json
{
  "tool": {
    "id": "com.example.ai-fortune",
    "name": "AI算命",
    "type": "http",
    "endpoint": "https://api.example.com/fortune",
    "input": "text",
    "output": "text",
    "config": {
      "api_key": "${API_KEY}"
    }
  }
}
```

#### 4.1.2 CLI包装层（轻量脚本）
```bash
# CTRL CLI包装器示例
#!/bin/bash
# 包装mingli-bench工具
INPUT="$1"
OUTPUT_DIR="$2"

# 调用本地工具
python3 /path/to/mingli-bench/main.py --input "$INPUT" --output "$OUTPUT_DIR"

# 返回结果
echo "{\"result\": \"$OUTPUT_DIR/result.json\"}"
```

#### 4.1.3 MCP桥接层（标准协议）
```rust
// MCP桥接器，将任意工具包装为MCP服务器
pub struct McpBridge {
    tool: Box<dyn Tool>,
    server: McpServer,
}

impl McpBridge {
    pub fn new(tool: Box<dyn Tool>) -> Self {
        // 自动生成MCP工具定义
        let tools = vec![
            McpTool {
                name: tool.name(),
                description: tool.description(),
                input_schema: tool.input_schema(),
                // ...
            }
        ];
        
        McpBridge {
            tool,
            server: McpServer::new(tools),
        }
    }
}
```

### 4.2 工具运行时环境

#### 4.2.1 沙箱环境
- **进程隔离**：每个工具在独立进程中运行
- **资源限制**：限制CPU、内存、网络使用
- **文件系统沙箱**：限制文件访问范围

#### 4.2.2 依赖管理
- **自动依赖检测**：检测工具所需依赖
- **一键安装**：自动安装缺失依赖
- **版本管理**：管理工具和依赖版本

## 5. 分享功能架构

### 5.1 分享功能需求
用户要求："通过CTRL的分享功能随时可以访问"

#### 5.1.1 分享内容
- **工具配置**：工具的配置和状态
- **运行结果**：工具的运行结果和数据
- **访问链接**：生成可分享的访问链接

#### 5.1.2 访问控制
- **公开分享**：任何人都可以访问
- **密码保护**：需要密码才能访问
- **时间限制**：分享链接有效期限制
- **访问次数限制**：限制访问次数

### 5.2 技术实现

#### 5.2.1 分享服务架构
```rust
pub struct ShareService {
    // 分享存储
    storage: ShareStorage,
    // 访问控制
    access_control: AccessControl,
    // 同步服务
    sync_service: SyncService,
}

pub enum ShareItem {
    // 工具配置分享
    ToolConfig {
        tool_id: String,
        config: serde_json::Value,
        state: ToolState,
    },
    // 运行结果分享
    ToolResult {
        tool_id: String,
        result: serde_json::Value,
        metadata: ResultMetadata,
    },
    // 访问链接分享
    AccessLink {
        url: String,
        expires_at: Option<DateTime>,
        access_count: u32,
    },
}
```

#### 5.2.2 跨设备同步
- **CTRL云服务**：通过CTRL云服务同步分享状态
- **端到端加密**：分享数据端到端加密
- **冲突解决**：多设备编辑冲突解决

#### 5.2.3 快速访问机制
- **短链接生成**：生成易于分享的短链接
- **二维码支持**：生成二维码方便移动端访问
- **深链接支持**：支持应用深链接直接打开

## 6. 前端 + 本地知识管理 + Copilot Agent

### 6.1 前端统一界面
- **工具市场**：浏览、搜索、安装工具
- **工具管理**：管理已安装工具，配置、启用、禁用
- **运行界面**：统一的工具运行界面
- **结果展示**：标准化的结果展示格式

### 6.2 本地知识管理
- **知识库集成**：集成本地知识库（如Obsidian、Logseq）
- **智能检索**：基于语义的本地知识检索
- **知识图谱**：构建本地知识图谱
- **自动整理**：AI辅助知识整理和分类

### 6.3 Copilot Agent
- **智能推荐**：根据上下文推荐相关工具
- **工作流编排**：编排多个工具形成工作流
- **学习优化**：学习用户使用习惯，优化推荐
- **故障诊断**：诊断工具运行问题，提供解决方案

## 7. 实施路线图

### Phase 1: 基础承载平台 (2-3周)
1. **工具集成框架**：实现声明式、CLI、HTTP���种集成方式
2. **生命周期管理**：实现按需启动和智能休眠
3. **基础分享功能**：实现工具配置和结果分享

### Phase 2: 飞书集成优化 (1-2周)
1. **飞书MCP集成**：集成飞书官方MCP插件
2. **简化配置向导**：实现图形化配置向导
3. **数据同步优化**：实现本地缓存和增量同步

### Phase 3: 高级功能 (2-3周)
1. **Copilot Agent**：实现智能推荐和工作流编排
2. **本地知识管理**：集成本地知识库和智能检索
3. **跨设备同步**：实现完整的跨设备同步方案

### Phase 4: 生态建设 (持续)
1. **工具市场**：建设工具市场和分发渠道
2. **开发者生态**：建设开发者文档和SDK
3. **合作伙伴**：与工具开发者建立合作关系

## 8. 技术挑战和解决方案

### 8.1 技术挑战
1. **工具兼容性**：不同工具使用不同技术栈
2. **安全性**：第三方工具可能包含恶意代码
3. **性能**：多个工具同时运行可能影响系统性能
4. **用户体验**：需要统一的用户体验

### 8.2 解决方案
1. **标准化接口**：定义标准化的工具接口
2. **沙箱环境**：在沙箱环境中运行工具
3. **资源管理**：实现智能资源管理和调度
4. **设计系统**：建立统一的设计系统和组件库

## 9. 成功指标

### 9.1 技术指标
- **工具启动时间**：< 2秒
- **内存占用**：< 100MB（基础运行时）
- **CPU占用**：< 5%（空闲时）
- **网络延迟**：< 100ms（本地操作）

### 9.2 业务指标
- **工具数量**：支持100+种工具
- **用户数量**：1000+ OPC用户
- **分享次数**：平均每个用户每月分享10+次
- **工具使用率**：平均每个用户每周使用5+种工具

## 10. 总结

CTRL作为OPC成品承载平台，通过轻量化集成、智能生命周期管理、强大的分享功能，为OPC创作者和用户提供了一个理想的平台。这个方案解决了用户关心的24小时开机问题，同时提供了完整的飞书集成方案，实现了用户"只要提供前端、本地知识管理、Copilot agent，通过CTRL的分享功能随时可以访问"的需求。