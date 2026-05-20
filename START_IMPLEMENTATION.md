# CTRL-Hermes集成实施 - 立即开始

## 第一步：环境准备

### 1. 安装Hermes Agent
```bash
# 在开发机器上安装Hermes
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# 验证安装
hermes --version
```

### 2. 配置Minimax API Key
```bash
# 创建环境变量文件
echo "MINIMAX_API_KEY=<your-minimax-api-key>" > .env.local
echo "MINIMAX_MODEL=MiniMax-M2.7-highspeed" >> .env.local

# 测试Minimax连接
node -e "
const fetch = require('node-fetch');
const apiKey = process.env.MINIMAX_API_KEY;
fetch('https://api.minimax.chat/v1/models', {
  headers: { 'Authorization': \`Bearer \${apiKey}\` }
}).then(r => r.json()).then(console.log);
"
```

### 3. 创建基础包结构
```bash
# 创建Hermes集群管理包
mkdir -p packages/ctrl-hermes-cluster/src
mkdir -p packages/ctrl-hermes-cluster/__tests__

# 创建用户管理包
mkdir -p packages/ctrl-user-management/src
mkdir -p packages/ctrl-user-management/__tests__

# 创建LLM集成包
mkdir -p packages/ctrl-llm/src
mkdir -p packages/ctrl-llm/__tests__
```

## 第二步：创建基础实现

### 1. Hermes集群管理器基础
```typescript
// packages/ctrl-hermes-cluster/src/cluster-manager.ts
export interface HermesWorker {
  id: string;
  status: 'running' | 'starting' | 'stopped' | 'error';
  load: number; // 0-100
  lastHeartbeat: Date;
}

export class HermesClusterManager {
  private workers: Map<string, HermesWorker> = new Map();
  
  async start(): Promise<void> {
    console.log('启动Hermes集群管理器...');
    
    // 创建初始Worker
    await this.createInitialWorkers();
    
    console.log(`Hermes集群已启动，共有 ${this.workers.size} 个Worker`);
  }
  
  private async createInitialWorkers(): Promise<void> {
    // 创建3个初始Worker
    for (let i = 0; i < 3; i++) {
      const worker: HermesWorker = {
        id: `worker-${i}`,
        status: 'running',
        load: 0,
        lastHeartbeat: new Date()
      };
      this.workers.set(worker.id, worker);
    }
  }
  
  getWorkerCount(): number {
    return this.workers.size;
  }
  
  getWorkers(): HermesWorker[] {
    return Array.from(this.workers.values());
  }
}
```

### 2. 用户管理器基础
```typescript
// packages/ctrl-user-management/src/user-manager.ts
export interface UserProfile {
  id: string;
  createdAt: Date;
  quota: UserQuota;
  settings: UserSettings;
}

export class UserManager {
  private users: Map<string, UserProfile> = new Map();
  
  async getOrCreateUser(userId: string): Promise<UserProfile> {
    let user = this.users.get(userId);
    
    if (!user) {
      user = await this.createUser(userId);
      this.users.set(userId, user);
      console.log(`创建新用户: ${userId}`);
    }
    
    return user;
  }
  
  private async createUser(userId: string): Promise<UserProfile> {
    return {
      id: userId,
      createdAt: new Date(),
      quota: {
        maxRequestsPerMinute: 60,
        maxTokensPerDay: 100000,
        maxConcurrentRequests: 5,
        currentUsage: {
          requestsToday: 0,
          tokensToday: 0,
          concurrentRequests: 0
        }
      },
      settings: {
        defaultModel: 'minimax-2.7-highspeed',
        preferredRegion: 'auto',
        costLimitPerMonth: 50
      }
    };
  }
}
```

### 3. Minimax客户端基础
```typescript
// packages/ctrl-llm/src/minimax-client.ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class MinimaxClient {
  private apiKey: string;
  private baseUrl = 'https://api.minimax.chat/v1';
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  async chatCompletion(messages: ChatMessage[]): Promise<any> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7-highspeed',
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      })
    });
    
    if (!response.ok) {
      throw new Error(`Minimax API错误: ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}
```

## 第三步：创建测试

### 1. 集群管理器测试
```typescript
// packages/ctrl-hermes-cluster/__tests__/cluster-manager.test.ts
import { HermesClusterManager } from '../src/cluster-manager';

describe('HermesClusterManager', () => {
  let cluster: HermesClusterManager;
  
  beforeEach(async () => {
    cluster = new HermesClusterManager();
    await cluster.start();
  });
  
  test('应该创建初始Worker', () => {
    expect(cluster.getWorkerCount()).toBe(3);
  });
  
  test('应该能够获取Worker列表', () => {
    const workers = cluster.getWorkers();
    expect(workers).toHaveLength(3);
    expect(workers[0].id).toBe('worker-0');
  });
});
```

### 2. 用户管理器测试
```typescript
// packages/ctrl-user-management/__tests__/user-manager.test.ts
import { UserManager } from '../src/user-manager';

describe('UserManager', () => {
  let userManager: UserManager;
  
  beforeEach(() => {
    userManager = new UserManager();
  });
  
  test('应该能够创建新用户', async () => {
    const user = await userManager.getOrCreateUser('test-user-123');
    
    expect(user.id).toBe('test-user-123');
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.quota.maxRequestsPerMinute).toBe(60);
  });
  
  test('应该返回已存在的用户', async () => {
    const user1 = await userManager.getOrCreateUser('test-user-456');
    const user2 = await userManager.getOrCreateUser('test-user-456');
    
    expect(user1).toBe(user2); // 应该是同一个对象
  });
});
```

## 第四步：运行测试

### 1. 安装测试依赖
```bash
# 在CTRL项目根目录
npm install --save-dev jest @types/jest ts-jest
npm install --save-dev node-fetch @types/node-fetch
```

### 2. 配置Jest
```json
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@ctrl/(.*)$': '<rootDir>/packages/$1/src'
  }
};
```

### 3. 运行测试
```bash
# 运行所有测试
npm test

# 运行特定包测试
npm test -- packages/ctrl-hermes-cluster

# 监视模式
npm test -- --watch
```

## 第五步：创建演示应用

### 1. 创建演示脚本
```typescript
// demo/hermes-integration-demo.ts
import { HermesClusterManager } from '../packages/ctrl-hermes-cluster/src/cluster-manager';
import { UserManager } from '../packages/ctrl-user-management/src/user-manager';
import { MinimaxClient } from '../packages/ctrl-llm/src/minimax-client';

async function demo() {
  console.log('=== CTRL-Hermes集成演示 ===\n');
  
  // 1. 启动集群
  console.log('1. 启动Hermes集群...');
  const cluster = new HermesClusterManager();
  await cluster.start();
  console.log(`   已启动 ${cluster.getWorkerCount()} 个Worker\n`);
  
  // 2. 创建用户
  console.log('2. 创建用户...');
  const userManager = new UserManager();
  const user = await userManager.getOrCreateUser('demo-user-001');
  console.log(`   用户ID: ${user.id}`);
  console.log(`   配额: ${user.quota.maxRequestsPerMinute} 请求/分钟\n`);
  
  // 3. 测试Minimax连接
  console.log('3. 测试Minimax连接...');
  const minimax = new MinimaxClient(process.env.MINIMAX_API_KEY || '');
  const isConnected = await minimax.testConnection();
  console.log(`   Minimax连接: ${isConnected ? '✅ 成功' : '❌ 失败'}\n`);
  
  // 4. 测试聊天
  if (isConnected) {
    console.log('4. 测试聊天功能...');
    const messages = [
      { role: 'user' as const, content: '你好，请用一句话介绍你自己' }
    ];
    
    try {
      const response = await minimax.chatCompletion(messages);
      const reply = response.choices[0]?.message?.content;
      console.log(`   AI回复: ${reply}\n`);
    } catch (error) {
      console.log(`   聊天测试失败: ${error}\n`);
    }
  }
  
  console.log('=== 演示完成 ===');
}

// 运行演示
demo().catch(console.error);
```

### 2. 运行演示
```bash
# 设置环境变量
export MINIMAX_API_KEY="<your-minimax-api-key>"

# 编译和运行
npx tsx demo/hermes-integration-demo.ts
```

## 第六步：下一步计划

### 本周完成：
1. ✅ 环境准备和基础包创建
2. ✅ 基础类实现
3. ✅ 单元测试编写
4. ✅ 演示应用创建
5. ⏳ 集成测试编写

### 下周计划：
1. 实现真正的Hermes Worker管理
2. 实现Docker容器化部署
3. 实现负载均衡
4. 实现成本优化基础
5. 创建API网关

### 两周后目标：
1. 可运行的Hermes集群
2. 基础用户管理
3. Minimax集成
4. 简单API接口
5. 基础监控

## 快速开始命令总结

```bash
# 1. 安装Hermes
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# 2. 设置环境变量
echo "MINIMAX_API_KEY=你的API_KEY" > .env.local

# 3. 创建包结构
mkdir -p packages/{ctrl-hermes-cluster,ctrl-user-management,ctrl-llm}/src

# 4. 编写基础代码
# 参考上面的代码示例

# 5. 安装测试依赖
npm install --save-dev jest @types/jest ts-jest node-fetch @types/node-fetch

# 6. 运行测试
npm test

# 7. 运行演示
npx tsx demo/hermes-integration-demo.ts
```

## 遇到问题？

### 常见问题解决：

1. **Hermes安装失败**
   ```bash
   # 尝试手动安装
   git clone https://github.com/NousResearch/hermes-agent.git
   cd hermes-agent
   pip install -e .
   ```

2. **Minimax API连接失败**
   - 检查API Key是否正确
   - 检查网络连接
   - 检查账户余额

3. **TypeScript编译错误**
   ```bash
   # 检查tsconfig.json
   npx tsc --noEmit
   
   # 安装缺失的类型定义
   npm install --save-dev @types/node
   ```

4. **测试失败**
   ```bash
   # 详细输出
   npm test -- --verbose
   
   # 调试模式
   npm test -- --inspect-brk
   ```

## 联系方式

- **问题反馈**: 创建GitHub Issue
- **技术讨论**: 项目文档中的讨论区
- **紧急支持**: 查看监控和日志

---

**开始实施吧！** 从第一步开始，逐步构建强大的CTRL-Hermes集成平台。记住：小步快跑，持续验证，快速迭代。