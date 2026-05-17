# CTRL Tool Integration

轻量化OPC成品承载平台工具集成框架。

## 设计目标

1. **轻量化**：最小化运行时开销，按需启动
2. **标准化**：统一的工具接口和配置格式
3. **安全**：沙箱环境运行，资源限制
4. **易用**：一键安装，简化配置

## 工具集成方式

### 1. 声明式工具 (JSON/YAML)
```json
{
  "id": "com.example.ai-fortune",
  "name": "AI算命",
  "version": "1.0.0",
  "type": "http",
  "endpoint": "https://api.example.com/fortune",
  "input": {
    "type": "text",
    "description": "输入生辰八字"
  },
  "output": {
    "type": "text",
    "description": "算命结果"
  },
  "config": {
    "api_key": {
      "type": "string",
      "required": true,
      "description": "API密钥"
    }
  }
}
```

### 2. CLI工具包装
```bash
#!/bin/bash
# CTRL CLI包装器
INPUT="$1"
OUTPUT_DIR="$2"

# 调用本地工具
python3 /path/to/tool/main.py --input "$INPUT" --output "$OUTPUT_DIR"

# 返回标准化结果
echo "{\"result\": \"$OUTPUT_DIR/result.json\"}"
```

### 3. MCP工具集成
```yaml
# MCP工具配置
mcp_tool:
  name: "飞书文档助手"
  server: "lark-mcp"
  config:
    app_id: "${FEISHU_APP_ID}"
    app_secret: "${FEISHU_APP_SECRET}"
    auth_type: "user"
  tools:
    - "docs:document.content:read"
    - "docs:document:write_only"
```

## 架构

```
┌─────────────────────────────────┐
│        CTRL Tool Runner         │
├─────────────────────────────────┤
│   Tool Registry & Lifecycle     │
├─────────────────────────────────┤
│  HTTP  │  CLI   │  MCP   │ ...  │
└─────────────────────────────────┘
```

## 快速开始

### 安装
```bash
npm install @ctrl/tool-integration
```

### 使用示例
```typescript
import { ToolRegistry, HttpTool, CliTool, McpTool } from '@ctrl/tool-integration';

// 创建工具注册表
const registry = new ToolRegistry();

// 注册HTTP工具
const fortuneTool = new HttpTool({
  id: 'com.example.ai-fortune',
  name: 'AI算命',
  endpoint: 'https://api.example.com/fortune',
  config: {
    api_key: process.env.FORTUNE_API_KEY
  }
});

// 注册CLI工具
const scraplingTool = new CliTool({
  id: 'com.example.scrapling',
  name: '网页抓取',
  command: 'python3',
  args: ['/path/to/scrapling/main.py', '--url', '{url}'],
  env: {
    PYTHONPATH: '/path/to/scrapling'
  }
});

// 运行工具
const result = await fortuneTool.run({
  input: '1990-01-01 12:00:00'
});

console.log(result);
```

## 工具生命周期管理

### 启动策略
- **OnDemand**：按需启动（默认）
- **Lazy**：延迟启动
- **Preload**：预加载
- **Resident**：常驻运行

### 资源限制
- CPU使用率限制
- 内存使用限制
- 网络带宽限制
- 文件系统访问限制

## 安全特性

### 沙箱环境
- 进程隔离
- 文件系统沙箱
- 网络访问控制
- 系统调用限制

### 权限管理
- 显式权限声明
- 用户确认授权
- 权限最小化原则

## 配置管理

### 环境变量
```bash
export CTRL_TOOL_DIR=/path/to/tools
export CTRL_CACHE_DIR=/path/to/cache
export CTRL_LOG_LEVEL=info
```

### 配置文件
```yaml
# ~/.ctrl/config.yaml
tools:
  - id: com.example.ai-fortune
    enabled: true
    config:
      api_key: ${FORTUNE_API_KEY}
  
  - id: com.example.scrapling
    enabled: true
    startup_policy: on_demand
    resource_limits:
      memory_mb: 512
      cpu_percent: 50
```

## 开发指南

### 创建新工具
1. 定义工具manifest
2. 实现工具运行器
3. 添加测试用例
4. 发布到工具市场

### 工具manifest规范
- 必须包含id、name、version
- 必须声明输入输出格式
- 必须声明所需权限
- 可选配置参数

### 测试工具
```bash
# 运行单元测试
npm test

# 运行集成测试
npm run test:integration

# 运行性能测试
npm run test:performance
```

## 部署

### 本地部署
```bash
# 安装依赖
npm install

# 构建
npm run build

# 启动
npm start
```

### Docker部署
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["npm", "start"]
```

## 贡献指南

1. Fork仓库
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 创建Pull Request

## 许可证

MIT