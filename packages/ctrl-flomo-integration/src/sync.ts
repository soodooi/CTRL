import { FlomoConfig, FlomoNote, KeycapIdea, ParseResult } from './types';
import { FlomoParser } from './parser';

/**
 * Flomo同步器
 * 负责从flomo同步笔记数据
 */
export class FlomoSync {
  private config: FlomoConfig;
  private parser: FlomoParser;
  
  constructor(config: Partial<FlomoConfig>) {
    this.config = {
      apiKey: config.apiKey || '',
      baseUrl: config.baseUrl || 'https://flomoapp.com/api/v1',
      webhookSecret: config.webhookSecret,
      syncInterval: config.syncInterval || 3600000,
      defaultTags: config.defaultTags || ['ctrl-keycap']
    };
    
    this.parser = new FlomoParser();
    
    if (!this.config.apiKey) {
      throw new Error('Flomo API Key is required');
    }
  }
  
  /**
   * 获取flomo笔记
   */
  async getNotes(tag?: string): Promise<FlomoNote[]> {
    try {
      const url = tag 
        ? `${this.config.baseUrl}/memo?tag=${tag}`
        : `${this.config.baseUrl}/memo`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Flomo API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.memos || [];
      
    } catch (error: any) {
      console.error('Failed to get flomo notes:', error.message);
      return [];
    }
  }
  
  /**
   * 获取keycap意向笔记
   */
  async getKeycapNotes(): Promise<FlomoNote[]> {
    const allNotes: FlomoNote[] = [];
    
    // 获取所有默认标签的笔记
    for (const tag of this.config.defaultTags) {
      const notes = await this.getNotes(tag);
      allNotes.push(...notes);
    }
    
    // 去重
    const uniqueNotes = this.deduplicateNotes(allNotes);
    
    return uniqueNotes;
  }
  
  /**
   * 同步keycap意向
   */
  async syncKeycapIdeas(): Promise<KeycapIdea[]> {
    console.log('Starting flomo keycap ideas sync...');
    
    const notes = await this.getKeycapNotes();
    console.log(`Found ${notes.length} keycap notes`);
    
    const parseResults = this.parser.parseNotes(notes);
    
    const successfulIdeas: KeycapIdea[] = [];
    const failedResults: ParseResult[] = [];
    
    for (const result of parseResults) {
      if (result.success && result.idea) {
        successfulIdeas.push(result.idea);
      } else {
        failedResults.push(result);
      }
    }
    
    console.log(`Successfully parsed ${successfulIdeas.length} ideas`);
    
    if (failedResults.length > 0) {
      console.warn(`Failed to parse ${failedResults.length} notes:`);
      for (const result of failedResults) {
        console.warn(`- Errors: ${result.errors?.join(', ')}`);
      }
    }
    
    return successfulIdeas;
  }
  
  /**
   * 处理Webhook请求
   */
  async handleWebhook(webhookData: any, secret?: string): Promise<ParseResult> {
    // 验证Webhook签名（如果配置了secret）
    if (this.config.webhookSecret && secret !== this.config.webhookSecret) {
      return {
        success: false,
        errors: ['Invalid webhook secret']
      };
    }
    
    return this.parser.parseWebhook(webhookData);
  }
  
  /**
   * 启动定期同步
   */
  startPeriodicSync(callback?: (ideas: KeycapIdea[]) => void): NodeJS.Timeout {
    console.log(`Starting periodic sync every ${this.config.syncInterval / 60000} minutes`);
    
    const syncTask = async () => {
      try {
        const ideas = await this.syncKeycapIdeas();
        if (callback) {
          callback(ideas);
        }
      } catch (error: any) {
        console.error('Periodic sync failed:', error.message);
      }
    };
    
    // 立即执行一次
    syncTask();
    
    // 设置定时任务
    return setInterval(syncTask, this.config.syncInterval);
  }
  
  /**
   * 停止定期同步
   */
  stopPeriodicSync(timerId: NodeJS.Timeout): void {
    clearInterval(timerId);
    console.log('Stopped periodic sync');
  }
  
  /**
   * 笔记去重
   */
  private deduplicateNotes(notes: FlomoNote[]): FlomoNote[] {
    const seen = new Set<string>();
    const uniqueNotes: FlomoNote[] = [];
    
    for (const note of notes) {
      const key = note.id || note.slug || note.content;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueNotes.push(note);
      }
    }
    
    return uniqueNotes;
  }
  
  /**
   * 导出为Markdown格式
   */
  exportToMarkdown(ideas: KeycapIdea[]): string {
    let markdown = `# Keycap Ideas from Flomo\n\n`;
    markdown += `*Generated on ${new Date().toISOString()}*\n\n`;
    
    // 按优先级分组
    const byPriority: Record<string, KeycapIdea[]> = {
      p0: [],
      p1: [],
      p2: []
    };
    
    for (const idea of ideas) {
      byPriority[idea.priority].push(idea);
    }
    
    // 输出每个优先级组
    for (const [priority, priorityIdeas] of Object.entries(byPriority)) {
      if (priorityIdeas.length === 0) continue;
      
      const priorityLabel = priority.toUpperCase();
      markdown += `## ${priorityLabel} Priority (${priorityIdeas.length})\n\n`;
      
      for (const idea of priorityIdeas) {
        markdown += `### ${idea.name}\n\n`;
        markdown += `- **描述**: ${idea.description}\n`;
        markdown += `- **类型**: ${idea.type.toUpperCase()}\n`;
        markdown += `- **状态**: ${this.getStatusLabel(idea.status)}\n`;
        markdown += `- **记录时间**: ${new Date(idea.recordedDate).toLocaleString()}\n`;
        
        if (idea.tags && idea.tags.length > 0) {
          markdown += `- **标签**: ${idea.tags.join(', ')}\n`;
        }
        
        if (idea.links && idea.links.length > 0) {
          markdown += `- **相关链接**:\n`;
          for (const link of idea.links) {
            markdown += `  - ${link}\n`;
          }
        }
        
        if (idea.notes) {
          markdown += `- **备注**: ${idea.notes}\n`;
        }
        
        if (idea.flomoNoteLink) {
          markdown += `- **Flomo链接**: [查看笔记](${idea.flomoNoteLink})\n`;
        }
        
        markdown += `\n`;
      }
    }
    
    return markdown;
  }
  
  /**
   * 获取状态标签
   */
  private getStatusLabel(status: KeycapIdea['status']): string {
    const labels: Record<KeycapIdea['status'], string> = {
      idea: '💡 想法',
      research: '🔍 调研中',
      development: '🚧 开发中',
      completed: '✅ 已完成',
      released: '🚀 已上线'
    };
    
    return labels[status] || status;
  }
}