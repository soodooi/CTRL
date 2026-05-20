// 导出所有公共API

// Schemas
export * from './schemas/tool-manifest';

// Interfaces
export * from './interfaces/tool';

// Implementations
export * from './implementations/base-tool';
export * from './implementations/tool-registry';

// 工具集成框架主类
export class CtrlToolIntegration {
  private static instance: CtrlToolIntegration;
  
  private constructor() {
    // 私有构造函数，确保单例
  }
  
  static getInstance(): CtrlToolIntegration {
    if (!CtrlToolIntegration.instance) {
      CtrlToolIntegration.instance = new CtrlToolIntegration();
    }
    return CtrlToolIntegration.instance;
  }
  
  /**
   * 初始化工具集成框架
   */
  async initialize(options: IntegrationOptions = {}): Promise<void> {
    console.log('Initializing CTRL Tool Integration framework...');
    
    // 初始化配置
    this.loadConfig(options);
    
    // 创建必要的目录
    await this.createDirectories();
    
    // 加载内置工具
    await this.loadBuiltinTools();
    
    console.log('CTRL Tool Integration framework initialized successfully');
  }
  
  /**
   * 创建工具实例
   */
  async createTool(manifest: ToolManifest): Promise<ITool> {
    const factory = new ToolFactory();
    return factory.createTool(manifest);
  }
  
  /**
   * 创建工具注册表
   */
  createToolRegistry(): ToolRegistry {
    return new ToolRegistry();
  }
  
  /**
   * 创建工具运行器
   */
  createToolRunner(registry: ToolRegistry): ToolRunner {
    return new ToolRunner(registry);
  }
  
  /**
   * 从文件加载工具
   */
  async loadToolFromFile(filePath: string): Promise<ITool> {
    const registry = new ToolRegistry();
    return registry.loadToolFromManifest(filePath);
  }
  
  /**
   * 从目录发现工具
   */
  async discoverTools(directory: string): Promise<ITool[]> {
    const registry = new ToolRegistry();
    return registry.discoverTools(directory);
  }
  
  // 私有方法
  private loadConfig(options: IntegrationOptions): void {
    // TODO: 从环境变量和配置文件中加载配置
    const defaultConfig = {
      toolDirectory: process.env.CTRL_TOOL_DIR || './tools',
      cacheDirectory: process.env.CTRL_CACHE_DIR || './cache',
      logLevel: process.env.CTRL_LOG_LEVEL || 'info',
      maxConcurrentTools: parseInt(process.env.CTRL_MAX_CONCURRENT_TOOLS || '10'),
      defaultResourceLimits: {
        memory_mb: parseInt(process.env.CTRL_DEFAULT_MEMORY_MB || '512'),
        cpu_percent: parseInt(process.env.CTRL_DEFAULT_CPU_PERCENT || '50'),
        timeout_seconds: parseInt(process.env.CTRL_DEFAULT_TIMEOUT_SECONDS || '30')
      }
    };
    
    this.config = { ...defaultConfig, ...options };
  }
  
  private async createDirectories(): Promise<void> {
    const dirs = [
      this.config.toolDirectory,
      this.config.cacheDirectory,
      `${this.config.toolDirectory}/builtin`,
      `${this.config.toolDirectory}/community`,
      `${this.config.toolDirectory}/user`,
      `${this.config.cacheDirectory}/manifests`,
      `${this.config.cacheDirectory}/results`
    ];
    
    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
    }
  }
  
  private async loadBuiltinTools(): Promise<void> {
    const builtinDir = `${this.config.toolDirectory}/builtin`;
    
    // 创建示例工具manifest
    const exampleTools = [
      {
        id: 'com.ctrl.builtin.text-processor',
        name: '文本处理器',
        version: '1.0.0',
        type: 'http' as const,
        description: '基础文本处理工具',
        input: { type: 'text' },
        output: { type: 'text' },
        extensions: {
          http: {
            endpoint: 'https://api.example.com/text-process',
            method: 'POST'
          }
        }
      },
      {
        id: 'com.ctrl.builtin.file-converter',
        name: '文件转换器',
        version: '1.0.0',
        type: 'cli' as const,
        description: '基础文件格式转换工具',
        input: { type: 'file' },
        output: { type: 'file' },
        extensions: {
          cli: {
            command: 'convert',
            args: ['-i', '{input}', '-o', '{output}']
          }
        }
      }
    ];
    
    // 保存示例工具manifest
    for (const tool of exampleTools) {
      const manifestPath = `${builtinDir}/${tool.id.replace(/\./g, '-')}.json`;
      await fs.writeFile(manifestPath, JSON.stringify(tool, null, 2));
    }
  }
  
  private config: IntegrationConfig = {};
}

// 类型定义
interface IntegrationOptions {
  toolDirectory?: string;
  cacheDirectory?: string;
  logLevel?: string;
  maxConcurrentTools?: number;
  defaultResourceLimits?: ResourceLimits;
}

interface IntegrationConfig {
  toolDirectory: string;
  cacheDirectory: string;
  logLevel: string;
  maxConcurrentTools: number;
  defaultResourceLimits: ResourceLimits;
}

// 工具函数
import * as fs from 'fs/promises';

/**
 * 验证工具manifest
 */
export function validateToolManifest(manifest: any): { valid: boolean; errors?: string[] } {
  try {
    // TODO: 使用zod进行完整验证
    const requiredFields = ['id', 'name', 'version', 'type'];
    const errors: string[] = [];
    
    for (const field of requiredFields) {
      if (!manifest[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // 验证ID格式
    if (manifest.id && !/^[a-z0-9.-]+$/.test(manifest.id)) {
      errors.push('ID must be in domain format (e.g., com.example.tool-name)');
    }
    
    // 验证版本格式
    if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      errors.push('Version must be in semver format (e.g., 1.0.0)');
    }
    
    // 验证工具类型
    const validTypes = ['http', 'cli', 'mcp', 'webview', 'declarative'];
    if (manifest.type && !validTypes.includes(manifest.type)) {
      errors.push(`Invalid tool type: ${manifest.type}. Valid types are: ${validTypes.join(', ')}`);
    }
    
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    return {
      valid: false,
      errors: [error.message]
    };
  }
}

/**
 * 生成工具ID
 */
export function generateToolId(name: string, author: string = 'unknown'): string {
  const normalizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  const normalizedAuthor = author
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  return `com.${normalizedAuthor}.${normalizedName}`;
}

/**
 * 创建示例工具manifest
 */
export function createExampleToolManifest(options: {
  name: string;
  type: ToolType;
  author?: string;
  description?: string;
}): ToolManifest {
  const id = generateToolId(options.name, options.author);
  
  const baseManifest: any = {
    id,
    name: options.name,
    version: '1.0.0',
    type: options.type,
    description: options.description || `A ${options.type} tool for ${options.name}`,
    startup_policy: 'on_demand',
    permissions: ['network']
  };
  
  // 根据类型添加扩展配置
  switch (options.type) {
    case 'http':
      baseManifest.extensions = {
        http: {
          endpoint: 'https://api.example.com/endpoint',
          method: 'POST'
        }
      };
      baseManifest.input = { type: 'text' };
      baseManifest.output = { type: 'text' };
      break;
      
    case 'cli':
      baseManifest.extensions = {
        cli: {
          command: 'example',
          args: ['--input', '{input}']
        }
      };
      baseManifest.input = { type: 'text' };
      baseManifest.output = { type: 'text' };
      break;
      
    case 'mcp':
      baseManifest.extensions = {
        mcp: {
          server: 'example-mcp-server',
          config: {}
        }
      };
      break;
      
    default:
      // 其他类型保持基本配置
      break;
  }
  
  return baseManifest as ToolManifest;
}

// 默认导出
export default CtrlToolIntegration;

// 常用工具函数导出
export {
  validateToolManifest,
  generateToolId,
  createExampleToolManifest
};