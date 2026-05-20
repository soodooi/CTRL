import {
  CtrlToolIntegration,
  ToolRegistry,
  ToolRunner,
  validateToolManifest,
  createExampleToolManifest
} from '@ctrl/tool-integration';

/**
 * CTRL工具集成使用示例
 * 
 * 这个示例展示了如何：
 * 1. 初始化工具集成框架
 * 2. 创建和注册工具
 * 3. 运行工具
 * 4. 管理工具生命周期
 */

async function main() {
  console.log('=== CTRL Tool Integration Example ===\n');
  
  // 1. 初始化框架
  console.log('1. Initializing CTRL Tool Integration framework...');
  const ctrl = CtrlToolIntegration.getInstance();
  await ctrl.initialize({
    toolDirectory: './my-tools',
    cacheDirectory: './my-cache',
    logLevel: 'debug'
  });
  
  // 2. 创建工具注册表
  console.log('\n2. Creating tool registry...');
  const registry = ctrl.createToolRegistry();
  
  // 3. 从文件加载工具
  console.log('\n3. Loading tools from manifest files...');
  try {
    // 加载AI算命工具
    const fortuneTool = await ctrl.loadToolFromFile('./examples/tool-manifests/ai-fortune.json');
    await registry.registerTool(fortuneTool);
    console.log(`✓ Loaded tool: ${fortuneTool.name} (${fortuneTool.id})`);
    
    // 加载网页抓取工具
    const scraplingTool = await ctrl.loadToolFromFile('./examples/tool-manifests/scrapling.json');
    await registry.registerTool(scraplingTool);
    console.log(`✓ Loaded tool: ${scraplingTool.name} (${scraplingTool.id})`);
  } catch (error) {
    console.warn(`⚠ Could not load tools from files: ${error.message}`);
    console.log('Creating example tools instead...');
    
    // 创建示例工具
    const exampleManifest = createExampleToolManifest({
      name: '示例文本处理器',
      type: 'http',
      author: 'ctrl-team',
      description: '示例HTTP工具'
    });
    
    const exampleTool = await ctrl.createTool(exampleManifest);
    await registry.registerTool(exampleTool);
    console.log(`✓ Created example tool: ${exampleTool.name}`);
  }
  
  // 4. 创建工具运行器
  console.log('\n4. Creating tool runner...');
  const runner = ctrl.createToolRunner(registry);
  
  // 5. 安装工具
  console.log('\n5. Installing tools...');
  const tools = await registry.listTools();
  for (const tool of tools) {
    try {
      await tool.install();
      console.log(`✓ Installed: ${tool.name}`);
    } catch (error) {
      console.warn(`⚠ Failed to install ${tool.name}: ${error.message}`);
    }
  }
  
  // 6. 运行工具示例
  console.log('\n6. Running tool examples...');
  
  // 获取第一个工具
  const firstTool = tools[0];
  if (firstTool) {
    console.log(`\nRunning ${firstTool.name}...`);
    
    try {
      const result = await runner.runTool(firstTool.id, {
        input: '1990-01-01 12:00:00', // 示例输入
        config: {
          language: 'zh-CN',
          detail_level: 'normal'
        },
        timeout_ms: 30000
      });
      
      if (result.success) {
        console.log('✓ Tool execution successful!');
        console.log('Result:', result.data);
        console.log('Execution time:', result.metadata?.execution_time_ms, 'ms');
      } else {
        console.log('✗ Tool execution failed:');
        console.log('Error:', result.error?.message);
      }
    } catch (error) {
      console.log('✗ Tool execution error:', error.message);
    }
  }
  
  // 7. 显示工具状态
  console.log('\n7. Tool status:');
  for (const tool of tools) {
    const status = await tool.getStatus();
    console.log(`\n${tool.name}:`);
    console.log(`  ID: ${tool.id}`);
    console.log(`  Installed: ${status.installed ? '✓' : '✗'}`);
    console.log(`  Running: ${status.running ? '✓' : '✗'}`);
    console.log(`  Startup policy: ${status.startupPolicy}`);
    
    if (status.lastRunTime) {
      console.log(`  Last run: ${status.lastRunTime.toLocaleString()}`);
    }
    
    const resourceUsage = await tool.getResourceUsage();
    console.log(`  Resource usage:`);
    console.log(`    Memory: ${resourceUsage.memory_mb}MB`);
    console.log(`    CPU: ${resourceUsage.cpu_percent}%`);
    console.log(`    Network: ${resourceUsage.network_mbps}Mbps`);
  }
  
  // 8. 显示运行统计
  console.log('\n8. Run statistics:');
  const stats = await runner.getRunStats();
  console.log(`Total runs: ${stats.totalRuns}`);
  console.log(`Recent runs (1h): ${stats.recentRuns}`);
  console.log(`Daily runs: ${stats.dailyRuns}`);
  console.log(`Success rate: ${(stats.successRate.overall * 100).toFixed(1)}%`);
  console.log(`Avg execution time: ${stats.avgExecutionTimeMs.overall.toFixed(0)}ms`);
  
  if (stats.mostUsedTools.length > 0) {
    console.log('\nMost used tools:');
    stats.mostUsedTools.forEach((tool, index) => {
      console.log(`  ${index + 1}. ${tool.toolId}: ${tool.count} runs`);
    });
  }
  
  // 9. 发现工具示例
  console.log('\n9. Discovering tools in directory...');
  try {
    const discoveredTools = await ctrl.discoverTools('./examples/tool-manifests');
    console.log(`Found ${discoveredTools.length} tools in directory`);
    
    for (const tool of discoveredTools) {
      console.log(`  - ${tool.name} (${tool.id})`);
    }
  } catch (error) {
    console.log('No tools discovered:', error.message);
  }
  
  // 10. 清理
  console.log('\n10. Cleaning up...');
  try {
    await runner.stopAll();
    console.log('✓ All tools stopped');
    
    // 只卸载示例工具，保留用户工具
    for (const tool of tools) {
      if (tool.id.startsWith('com.ctrl.builtin.')) {
        await tool.uninstall();
        console.log(`✓ Uninstalled: ${tool.name}`);
      }
    }
  } catch (error) {
    console.warn('Cleanup error:', error.message);
  }
  
  console.log('\n=== Example completed ===');
  console.log('\nNext steps:');
  console.log('1. Create your own tool manifests in ./my-tools/');
  console.log('2. Use CtrlToolIntegration.getInstance() to access the framework');
  console.log('3. Register and run your tools using ToolRegistry and ToolRunner');
  console.log('4. Implement custom tool types by extending BaseTool class');
}

// 运行示例
main().catch(error => {
  console.error('Example failed:', error);
  process.exit(1);
});

/**
 * 高级使用示例：创建自定义工具
 */
class CustomToolExample {
  /**
   * 创建飞书集成工具
   */
  static async createFeishuTool(): Promise<void> {
    console.log('\n=== Creating Feishu Integration Tool ===');
    
    const feishuManifest = {
      id: 'com.larksuite.feishu-integration',
      name: '飞书集成工具',
      version: '1.0.0',
      type: 'mcp',
      description: '飞书官方MCP集成，支持文档、任务、消息等操作',
      input: { type: 'text' },
      output: { type: 'text' },
      startup_policy: 'on_demand' as const,
      resource_limits: {
        memory_mb: 256,
        cpu_percent: 20,
        timeout_seconds: 30
      },
      permissions: ['network'],
      extensions: {
        mcp: {
          server: 'lark-mcp',
          config: {
            command: 'npx',
            args: ['-y', '@larksuiteoapi/lark-mcp', 'mcp'],
            env: {
              FEISHU_APP_ID: '${FEISHU_APP_ID}',
              FEISHU_APP_SECRET: '${FEISHU_APP_SECRET}',
              FEISHU_AUTH_TYPE: 'user'
            }
          },
          tools: [
            'docs:document.content:read',
            'docs:document:write_only',
            'task:task:write',
            'im:message:send_as_bot'
          ]
        }
      },
      settings: {
        app_id: {
          type: 'string',
          required: true,
          description: '飞书应用App ID'
        },
        app_secret: {
          type: 'password',
          required: true,
          description: '飞书应用App Secret'
        },
        enabled_modules: {
          type: 'string',
          required: false,
          description: '启用的模块',
          default: 'document,task,message',
          options: ['document', 'task', 'message', 'calendar', 'all']
        }
      }
    };
    
    // 验证manifest
    const validation = validateToolManifest(feishuManifest);
    if (validation.valid) {
      console.log('✓ Feishu tool manifest is valid');
      
      // 这里可以创建和注册工具
      // const tool = await ctrl.createTool(feishuManifest);
      // await registry.registerTool(tool);
      
      console.log('Feishu tool ready for integration!');
      console.log('Note: You need to set FEISHU_APP_ID and FEISHU_APP_SECRET environment variables');
    } else {
      console.log('✗ Feishu tool manifest validation failed:');
      validation.errors?.forEach(error => console.log(`  - ${error}`));
    }
  }
  
  /**
   * 创建本地知识库工具
   */
  static async createLocalKnowledgeBaseTool(): Promise<void> {
    console.log('\n=== Creating Local Knowledge Base Tool ===');
    
    const kbManifest = {
      id: 'com.ctrl.local-knowledge-base',
      name: '本地知识库',
      version: '1.0.0',
      type: 'cli',
      description: '本地知识管理和检索工具，支持RAG和语义搜索',
      input: { type: 'text' },
      output: { type: 'text' },
      startup_policy: 'lazy' as const, // 延迟启动，减少资源占用
      resource_limits: {
        memory_mb: 1024,
        cpu_percent: 40,
        timeout_seconds: 60
      },
      permissions: ['network', 'filesystem'],
      extensions: {
        cli: {
          command: 'python',
          args: ['-m', 'local_kb', 'query', '--query', '{input}'],
          env: {
            KB_DATA_PATH: './knowledge-base',
            KB_EMBEDDING_MODEL: 'all-MiniLM-L6-v2',
            KB_MAX_RESULTS: '5'
          },
          working_dir: './kb-workspace',
          shell: false
        }
      },
      settings: {
        data_path: {
          type: 'string',
          required: false,
          description: '知识库数据路径',
          default: './knowledge-base'
        },
        embedding_model: {
          type: 'string',
          required: false,
          description: '嵌入模型',
          default: 'all-MiniLM-L6-v2',
          options: ['all-MiniLM-L6-v2', 'text-embedding-ada-002', 'bge-large-zh']
        },
        max_results: {
          type: 'number',
          required: false,
          description: '最大返回结果数',
          default: 5,
          min: 1,
          max: 20
        },
        similarity_threshold: {
          type: 'number',
          required: false,
          description: '相似度阈值',
          default: 0.7,
          min: 0,
          max: 1
        }
      }
    };
    
    const validation = validateToolManifest(kbManifest);
    if (validation.valid) {
      console.log('✓ Local knowledge base tool manifest is valid');
      console.log('This tool provides:');
      console.log('  - Local RAG (Retrieval Augmented Generation)');
      console.log('  - Semantic search across documents');
      console.log('  - Offline knowledge management');
      console.log('  - Integration with Obsidian/Logseq notes');
    } else {
      console.log('✗ Validation failed:', validation.errors);
    }
  }
}

// 运行高级示例
async function runAdvancedExamples() {
  console.log('\n\n=== Advanced Examples ===');
  await CustomToolExample.createFeishuTool();
  await CustomToolExample.createLocalKnowledgeBaseTool();
}

// 注释掉这行以运行高级示例
// runAdvancedExamples().catch(console.error);