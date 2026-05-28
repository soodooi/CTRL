# flomo集成使用示例

## 快速开始

### 1. 安装依赖
```bash
cd packages/ctrl-flomo-integration
npm install
npm run build
```

### 2. 基本使用

#### 解析flomo笔记
```typescript
import { FlomoParser } from '@ctrl/flomo-integration';

const parser = new FlomoParser();

// 示例flomo笔记
const flomoNote = {
  id: 'note-123',
  content: `#ctrl-keycap #ctrl-p0 #ctrl-mcp
八字算命工具

描述：基于cantian-ai/bazi-mcp的八字算命工具
类型：MCP
优先级：P0
状态：想法
相关链接：https://github.com/cantian-ai/bazi-mcp

备注：作为第一个验证的OPC成品`,
  created_at: '2026-05-16T10:30:00Z',
  tags: ['ctrl-keycap', 'ctrl-p0', 'ctrl-mcp', 'ctrl-idea'],
  memo_link: 'https://flomoapp.com/memo/123'
};

// 解析笔记
const result = parser.parseNote(flomoNote);

if (result.success && result.idea) {
  console.log('解析成功:');
  console.log('- 名称:', result.idea.name);
  console.log('- 描述:', result.idea.description);
  console.log('- 类型:', result.idea.type);
  console.log('- 优先级:', result.idea.priority);
  console.log('- 状态:', result.idea.status);
} else {
  console.error('解析失败:', result.errors);
}
```

#### 同步flomo数据
```typescript
import { FlomoSync } from '@ctrl/flomo-integration';

// 配置同步器（需要flomo API Key）
const sync = new FlomoSync({
  apiKey: 'your-flomo-api-key-here',
  syncInterval: 3600000, // 1小时
  defaultTags: ['ctrl-keycap']
});

// 同步一次
async function syncOnce() {
  const ideas = await sync.syncKeycapIdeas();
  console.log(`同步到 ${ideas.length} 个意向`);
  
  // 导出为Markdown
  const markdown = sync.exportToMarkdown(ideas);
  console.log(markdown);
}

// 启动定期同步
const timerId = sync.startPeriodicSync((ideas) => {
  console.log(`定期同步完成，${ideas.length} 个意向`);
  
  // 可以在这里保存到文件或数据库
  saveIdeasToFile(ideas);
});

// 停止同步
// sync.stopPeriodicSync(timerId);
```

### 3. Webhook处理
```typescript
import { FlomoSync } from '@ctrl/flomo-integration';

const sync = new FlomoSync({
  apiKey: 'your-api-key',
  webhookSecret: 'your-webhook-secret'
});

// Express.js示例
app.post('/flomo-webhook', async (req, res) => {
  const secret = req.headers['x-flomo-secret'];
  const result = await sync.handleWebhook(req.body, secret);
  
  if (result.success && result.idea) {
    // 保存意向
    await saveKeycapIdea(result.idea);
    res.status(200).json({ success: true, idea: result.idea });
  } else {
    res.status(400).json({ success: false, errors: result.errors });
  }
});
```

## flomo笔记格式示例

### 标准格式
```
#ctrl-keycap #ctrl-p0 #ctrl-mcp
[工具名称]

描述：[详细描述]
类型：[CLI/HTTP/MCP/WebView/Declarative]
优先级：[P0/P1/P2]
状态：[想法/调研中/开发中/已完成/已上线]
相关链接：[URL1, URL2]

备注：[额外信息]
```

### 实际示例

#### 示例1：八字算命工具
```
#ctrl-keycap #ctrl-p0 #ctrl-mcp #ctrl-idea
八字算命工具

描述：基于cantian-ai/bazi-mcp的八字算命工具，飞书正在承接的OPC产出
类型：MCP
优先级：P0
状态：想法
相关链接：https://github.com/cantian-ai/bazi-mcp

备注：作为第一个验证的OPC成品，测试轻量化集成能力
```

#### 示例2：文本翻译工具
```
#ctrl-keycap #ctrl-p0 #ctrl-http #ctrl-idea
文本翻译工具

描述：选中文本翻译，支持多语言
类型：HTTP
优先级：P0
状态：想法
相关链接：

备注：基础工具，验证HTTP集成方式
```

#### 示例3：AI改写工具
```
#ctrl-keycap #ctrl-p0 #ctrl-http #ctrl-research
AI改写工具

描述：文本风格转换，如知乎风格、邮件风格、学术风格
类型：HTTP
优先级：P0
状态：调研中
相关链接：https://platform.minimax.chat

备注：需要调研Minimax API的文本改写能力
```

## 与CTRL项目集成

### 1. 自动更新keycap意向记录
```typescript
// packages/ctrl-flomo-integration/src/integration.ts
import { FlomoSync } from './sync';
import { writeFileSync } from 'fs';
import { join } from 'path';

export class CTRLFlomoIntegration {
  private sync: FlomoSync;
  private recordPath: string;
  
  constructor(config: any) {
    this.sync = new FlomoSync(config);
    this.recordPath = join(__dirname, '../../doc/keycap-ideas-record.md');
  }
  
  async updateKeycapRecord(): Promise<void> {
    // 同步flomo数据
    const ideas = await this.sync.syncKeycapIdeas();
    
    // 生成Markdown内容
    const markdown = this.generateRecordMarkdown(ideas);
    
    // 更新记录文件
    writeFileSync(this.recordPath, markdown, 'utf-8');
    
    console.log(`已更新keycap意向记录，共 ${ideas.length} 个意向`);
  }
  
  private generateRecordMarkdown(ideas: any[]): string {
    // 生成完整的记录文档
    let markdown = `# CTRL Keycap意向记录\n\n`;
    markdown += `*最后同步时间：${new Date().toISOString()}*\n\n`;
    
    // ... 生成详细内容
    
    return markdown;
  }
}
```

### 2. 命令行工具
```typescript
// packages/ctrl-flomo-integration/bin/cli.ts
#!/usr/bin/env node

import { FlomoSync } from '../src/sync';
import { program } from 'commander';

program
  .name('ctrl-flomo')
  .description('CTRL flomo集成命令行工具')
  .version('0.1.0');

program
  .command('sync')
  .description('同步flomo keycap意向')
  .option('-k, --api-key <key>', 'Flomo API Key')
  .option('-o, --output <file>', '输出文件路径')
  .action(async (options) => {
    const sync = new FlomoSync({
      apiKey: options.apiKey || process.env.FLOMO_API_KEY
    });
    
    const ideas = await sync.syncKeycapIdeas();
    const markdown = sync.exportToMarkdown(ideas);
    
    if (options.output) {
      require('fs').writeFileSync(options.output, markdown, 'utf-8');
      console.log(`已保存到 ${options.output}`);
    } else {
      console.log(markdown);
    }
  });

program.parse();
```

## 配置说明

### 环境变量
```bash
# .env文件
FLOMO_API_KEY=your_flomo_api_key_here
FLOMO_WEBHOOK_SECRET=your_webhook_secret_here
FLOMO_SYNC_INTERVAL=3600000
```

### 配置文件
```json
// config/flomo.json
{
  "apiKey": "your_flomo_api_key",
  "baseUrl": "https://flomoapp.com/api/v1",
  "webhookSecret": "your_secret",
  "syncInterval": 3600000,
  "defaultTags": ["ctrl-keycap"],
  "output": {
    "markdown": "./doc/keycap-ideas-record.md",
    "json": "./data/keycap-ideas.json"
  }
}
```

## 故障排除

### 常见问题

1. **API Key无效**
   ```
   Error: Flomo API error: 401 Unauthorized
   ```
   解决方案：检查API Key是否正确，重新生成API Key。

2. **网络连接问题**
   ```
   Error: Failed to get flomo notes: fetch failed
   ```
   解决方案：检查网络连接，确保可以访问flomo API。

3. **解析失败**
   ```
   Parse error: Note is not marked as keycap idea
   ```
   解决方案：确保笔记包含`#ctrl-keycap`标签。

4. **格式错误**
   ```
   Errors: 工具名称不能为空
   ```
   解决方案：检查笔记格式，确保第一行非空行是工具名称。

### 调试模式
```typescript
// 启用详细日志
const sync = new FlomoSync({
  apiKey: 'your-key',
  syncInterval: 60000 // 1分钟，便于调试
});

// 手动触发同步并查看详细日志
sync.syncKeycapIdeas().then(ideas => {
  console.log('同步结果:', ideas);
}).catch(error => {
  console.error('同步错误:', error);
});
```

## 最佳实践

### 1. 笔记管理
- 使用标准格式记录
- 及时更新状态标签
- 添加相关链接和备注
- 定期整理和归档

### 2. 同步策略
- 生产环境：每小时同步一次
- 开发环境：每5分钟同步一次
- 手动触发：需要时立即同步

### 3. 数据备份
- 定期备份解析后的数据
- 保存原始flomo笔记链接
- 维护变更历史

### 4. 团队协作
- 统一标签规范
- 共享API Key（或使用团队账号）
- 定期同步和评审意向

## 下一步

### 短期计划
1. 实现基础同步功能
2. 集成到CTRL开发流程
3. 建立自动化更新机制

### 中期计划
1. 添加AI自动分类
2. 实现双向同步
3. 集成到CTRL前端界面

### 长期计划
1. 支持多笔记工具集成
2. 实现智能推荐和排序
3. 建立完整的工具开发生态

---

*更多信息请参考：[Flomo Integration Guide](./flomo-integration-guide.md)*
*示例代码位于：`packages/ctrl-flomo-integration/`*