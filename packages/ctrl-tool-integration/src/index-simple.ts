// 简化的CTRL工具集成框架

// 导出核心类型
export * from './schemas/tool-manifest';

// 工具函数
import { z } from 'zod';

/**
 * 验证工具manifest
 */
export function validateToolManifest(manifest: any): { valid: boolean; errors?: string[] } {
  try {
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
  } catch (error: any) {
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
  type: 'http' | 'cli' | 'mcp' | 'webview' | 'declarative';
  author?: string;
  description?: string;
}): any {
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
  
  return baseManifest;
}

/**
 * CTRL工具集成框架主类
 */
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
  async initialize(options: any = {}): Promise<void> {
    console.log('Initializing CTRL Tool Integration framework...');
    
    // 初始化配置
    this.config = {
      toolDirectory: process.env.CTRL_TOOL_DIR || './tools',
      cacheDirectory: process.env.CTRL_CACHE_DIR || './cache',
      logLevel: process.env.CTRL_LOG_LEVEL || 'info',
      maxConcurrentTools: parseInt(process.env.CTRL_MAX_CONCURRENT_TOOLS || '10'),
      defaultResourceLimits: {
        memory_mb: parseInt(process.env.CTRL_DEFAULT_MEMORY_MB || '512'),
        cpu_percent: parseInt(process.env.CTRL_DEFAULT_CPU_PERCENT || '50'),
        timeout_seconds: parseInt(process.env.CTRL_DEFAULT_TIMEOUT_SECONDS || '30')
      },
      ...options
    };
    
    console.log('CTRL Tool Integration framework initialized successfully');
  }
  
  /**
   * 验证工具manifest
   */
  validateToolManifest(manifest: any): { valid: boolean; errors?: string[] } {
    return validateToolManifest(manifest);
  }
  
  /**
   * 生成工具ID
   */
  generateToolId(name: string, author?: string): string {
    return generateToolId(name, author);
  }
  
  /**
   * 创建示例工具manifest
   */
  createExampleToolManifest(options: {
    name: string;
    type: 'http' | 'cli' | 'mcp' | 'webview' | 'declarative';
    author?: string;
    description?: string;
  }): any {
    return createExampleToolManifest(options);
  }
  
  private config: any = {};
}

// 默认导出
export default CtrlToolIntegration;