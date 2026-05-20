import { FlomoNote, KeycapIdea, ParseResult } from './types';

/**
 * Flomo笔记解析器
 * 负责解析flomo笔记内容，提取keycap意向信息
 */
export class FlomoParser {
  private readonly ctrlTag = 'ctrl-keycap';
  
  /**
   * 检查笔记是否为keycap意向
   */
  isKeycapIdea(note: FlomoNote): boolean {
    const tags = note.tags || [];
    return tags.includes(this.ctrlTag);
  }
  
  /**
   * 解析flomo笔记，提取keycap意向
   */
  parseNote(note: FlomoNote): ParseResult {
    try {
      if (!this.isKeycapIdea(note)) {
        return {
          success: false,
          errors: ['Note is not marked as keycap idea']
        };
      }
      
      const content = note.content;
      const lines = content.split('\n').map(line => line.trim());
      
      // 提取基本信息
      const name = this.extractName(lines);
      const description = this.extractDescription(lines);
      const type = this.extractType(note.tags || [], lines);
      const priority = this.extractPriority(note.tags || []);
      const status = this.extractStatus(note.tags || []);
      const links = this.extractLinks(lines);
      const notes = this.extractNotes(lines);
      
      // 构建keycap意向
      const idea: KeycapIdea = {
        id: this.generateId(name),
        name,
        description,
        type,
        priority,
        status,
        recordedDate: note.created_at,
        source: 'flomo',
        tags: note.tags,
        links,
        notes,
        flomoNoteId: note.id,
        flomoNoteLink: note.memo_link,
      };
      
      // 验证数据
      const validation = this.validateIdea(idea);
      if (!validation.valid) {
        return {
          success: false,
          errors: validation.errors
        };
      }
      
      return {
        success: true,
        idea,
        warnings: validation.warnings
      };
      
    } catch (error: any) {
      return {
        success: false,
        errors: [`Parse error: ${error.message}`]
      };
    }
  }
  
  /**
   * 提取工具名称
   */
  private extractName(lines: string[]): string {
    // 第一行非空行作为名称
    for (const line of lines) {
      if (line && !line.startsWith('#') && !this.isMetadataLine(line)) {
        return line;
      }
    }
    return '未命名工具';
  }
  
  /**
   * 提取工具描述
   */
  private extractDescription(lines: string[]): string {
    const descriptionLines: string[] = [];
    let inDescription = false;
    
    for (const line of lines) {
      if (line.startsWith('描述：') || line.startsWith('description:')) {
        inDescription = true;
        descriptionLines.push(line.replace(/^(描述：|description:)\s*/, ''));
      } else if (inDescription && this.isMetadataLine(line)) {
        break;
      } else if (inDescription && line) {
        descriptionLines.push(line);
      }
    }
    
    return descriptionLines.join('\n') || '暂无描述';
  }
  
  /**
   * 提取工具类型
   */
  private extractType(tags: string[], lines: string[]): KeycapIdea['type'] {
    // 从标签中提取
    for (const tag of tags) {
      if (tag.startsWith('ctrl-')) {
        const type = tag.replace('ctrl-', '');
        if (['cli', 'http', 'mcp', 'webview', 'declarative'].includes(type)) {
          return type as KeycapIdea['type'];
        }
      }
    }
    
    // 从内容中提取
    for (const line of lines) {
      if (line.startsWith('类型：') || line.startsWith('type:')) {
        const typeStr = line.replace(/^(类型：|type:)\s*/, '').toLowerCase();
        if (['cli', 'http', 'mcp', 'webview', 'declarative'].includes(typeStr)) {
          return typeStr as KeycapIdea['type'];
        }
      }
    }
    
    // 默认类型
    return 'declarative';
  }
  
  /**
   * 提取优先级
   */
  private extractPriority(tags: string[]): KeycapIdea['priority'] {
    for (const tag of tags) {
      if (tag.startsWith('ctrl-p')) {
        const priority = tag.replace('ctrl-p', '');
        if (['0', '1', '2'].includes(priority)) {
          return `p${priority}` as KeycapIdea['priority'];
        }
      }
    }
    
    // 默认优先级
    return 'p2';
  }
  
  /**
   * 提取状态
   */
  private extractStatus(tags: string[]): KeycapIdea['status'] {
    const statusTags = ['idea', 'research', 'development', 'completed', 'released'];
    
    for (const tag of tags) {
      if (tag.startsWith('ctrl-')) {
        const status = tag.replace('ctrl-', '');
        if (statusTags.includes(status)) {
          return status as KeycapIdea['status'];
        }
      }
    }
    
    // 默认状态
    return 'idea';
  }
  
  /**
   * 提取相关链接
   */
  private extractLinks(lines: string[]): string[] {
    const links: string[] = [];
    
    for (const line of lines) {
      if (line.startsWith('相关链接：') || line.startsWith('links:')) {
        const linkStr = line.replace(/^(相关链接：|links:)\s*/, '');
        links.push(...linkStr.split(',').map(l => l.trim()).filter(l => l));
      } else if (this.isUrl(line)) {
        links.push(line);
      }
    }
    
    return links;
  }
  
  /**
   * 提取备注
   */
  private extractNotes(lines: string[]): string {
    const noteLines: string[] = [];
    let inNotes = false;
    
    for (const line of lines) {
      if (line.startsWith('备注：') || line.startsWith('notes:')) {
        inNotes = true;
        noteLines.push(line.replace(/^(备注：|notes:)\s*/, ''));
      } else if (inNotes && this.isMetadataLine(line)) {
        break;
      } else if (inNotes && line) {
        noteLines.push(line);
      }
    }
    
    return noteLines.join('\n') || '';
  }
  
  /**
   * 生成唯一ID
   */
  private generateId(name: string): string {
    const timestamp = Date.now().toString(36);
    const nameHash = this.hashString(name).slice(0, 8);
    return `keycap-${timestamp}-${nameHash}`;
  }
  
  /**
   * 简单字符串哈希
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
  
  /**
   * 检查是否为元数据行
   */
  private isMetadataLine(line: string): boolean {
    const metadataPrefixes = [
      '描述：', 'description:',
      '类型：', 'type:',
      '优先级：', 'priority:',
      '状态：', 'status:',
      '相关链接：', 'links:',
      '备注：', 'notes:'
    ];
    
    return metadataPrefixes.some(prefix => line.startsWith(prefix));
  }
  
  /**
   * 检查是否为URL
   */
  private isUrl(str: string): boolean {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * 验证keycap意向数据
   */
  private validateIdea(idea: KeycapIdea): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // 必填字段检查
    if (!idea.name || idea.name === '未命名工具') {
      errors.push('工具名称不能为空');
    }
    
    if (!idea.description || idea.description === '暂无描述') {
      warnings.push('工具描述为空，建议补充');
    }
    
    // 类型检查
    if (!['cli', 'http', 'mcp', 'webview', 'declarative'].includes(idea.type)) {
      errors.push(`无效的工具类型: ${idea.type}`);
    }
    
    // 优先级检查
    if (!['p0', 'p1', 'p2'].includes(idea.priority)) {
      errors.push(`无效的优先级: ${idea.priority}`);
    }
    
    // 状态检查
    if (!['idea', 'research', 'development', 'completed', 'released'].includes(idea.status)) {
      errors.push(`无效的状态: ${idea.status}`);
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  /**
   * 批量解析笔记
   */
  parseNotes(notes: FlomoNote[]): ParseResult[] {
    return notes.map(note => this.parseNote(note));
  }
  
  /**
   * 从Webhook数据解析
   */
  parseWebhook(webhookData: any): ParseResult {
    try {
      // 构建模拟的FlomoNote
      const note: FlomoNote = {
        id: `webhook-${Date.now()}`,
        content: webhookData.content,
        created_at: webhookData.created_at || new Date().toISOString(),
        tags: webhookData.tags || [],
        memo_link: webhookData.memo_link || ''
      };
      
      return this.parseNote(note);
    } catch (error: any) {
      return {
        success: false,
        errors: [`Webhook parse error: ${error.message}`]
      };
    }
  }
}