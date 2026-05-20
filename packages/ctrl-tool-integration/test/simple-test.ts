import { 
  validateToolManifest,
  generateToolId,
  createExampleToolManifest 
} from '../src/index';

/**
 * 简单测试脚本
 * 验证工具集成框架的基本功能
 */

console.log('=== CTRL Tool Integration Simple Test ===\n');

// 测试1: 验证工具manifest
console.log('1. Testing tool manifest validation...');
const validManifest = {
  id: 'com.example.test-tool',
  name: '测试工具',
  version: '1.0.0',
  type: 'http'
};

const invalidManifest = {
  id: 'invalid id!',
  name: '测试工具',
  version: 'not-semver',
  type: 'invalid-type'
};

console.log('Valid manifest:', validateToolManifest(validManifest));
console.log('Invalid manifest:', validateToolManifest(invalidManifest));

// 测试2: 生成工具ID
console.log('\n2. Testing tool ID generation...');
const toolName = 'AI Fortune Teller';
const author = 'cantian-ai';
const toolId = generateToolId(toolName, author);
console.log(`Tool name: ${toolName}`);
console.log(`Author: ${author}`);
console.log(`Generated ID: ${toolId}`);

// 测试3: 创建示例工具manifest
console.log('\n3. Testing example tool manifest creation...');
const exampleManifest = createExampleToolManifest({
  name: '文本翻译工具',
  type: 'http',
  author: 'google',
  description: '多语言文本翻译工具'
});

console.log('Example manifest created:');
console.log(JSON.stringify(exampleManifest, null, 2));

// 测试4: 验证示例manifest
console.log('\n4. Validating example manifest...');
const validation = validateToolManifest(exampleManifest);
console.log('Validation result:', validation);

if (validation.valid) {
  console.log('✓ All tests passed!');
} else {
  console.log('✗ Tests failed:');
  validation.errors?.forEach(error => console.log(`  - ${error}`));
}

console.log('\n=== Test completed ===');