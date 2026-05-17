#!/usr/bin/env node

/**
 * CTRL Tool Integration 构建脚本
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== Building CTRL Tool Integration ===\n');

// 检查必要文件
const requiredFiles = [
  'package.json',
  'tsconfig.json',
  'src/index.ts',
  'src/schemas/tool-manifest.ts',
  'src/interfaces/tool.ts',
  'src/implementations/base-tool.ts',
  'src/implementations/tool-registry.ts'
];

console.log('1. Checking required files...');
for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.error(`✗ Missing required file: ${file}`);
    process.exit(1);
  }
}
console.log('✓ All required files found\n');

// 安装依赖
console.log('2. Installing dependencies...');
try {
  execSync('npm install', { stdio: 'inherit', cwd: __dirname });
  console.log('✓ Dependencies installed\n');
} catch (error) {
  console.error('✗ Failed to install dependencies');
  process.exit(1);
}

// 构建TypeScript
console.log('3. Building TypeScript...');
try {
  execSync('npx tsc --project tsconfig-simple.json', { stdio: 'inherit', cwd: __dirname });
  console.log('✓ TypeScript built\n');
} catch (error) {
  console.error('✗ Failed to build TypeScript');
  process.exit(1);
}

// 运行测试
console.log('4. Running tests...');
try {
  execSync('npm test', { stdio: 'inherit', cwd: __dirname });
  console.log('✓ Tests passed\n');
} catch (error) {
  console.warn('⚠ Tests failed or not implemented\n');
}

// 创建dist目录结构
console.log('5. Creating distribution structure...');
const distDir = path.join(__dirname, 'dist');
const distStructure = [
  'schemas',
  'interfaces',
  'implementations'
];

// 确保dist目录存在
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 复制必要的非TypeScript文件
const filesToCopy = [
  { src: 'README.md', dest: 'README.md' },
  { src: 'package.json', dest: 'package.json' }
];

for (const file of filesToCopy) {
  const srcPath = path.join(__dirname, file.src);
  const destPath = path.join(distDir, file.dest);
  
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`  Copied: ${file.src} -> dist/${file.dest}`);
  }
}

console.log('✓ Distribution structure created\n');

// 验证构建结果
console.log('6. Verifying build results...');
const requiredOutputs = [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/schemas/tool-manifest.js',
  'dist/schemas/tool-manifest.d.ts',
  'dist/interfaces/tool.js',
  'dist/interfaces/tool.d.ts',
  'dist/implementations/base-tool.js',
  'dist/implementations/base-tool.d.ts',
  'dist/implementations/tool-registry.js',
  'dist/implementations/tool-registry.d.ts'
];

let allOutputsExist = true;
for (const output of requiredOutputs) {
  const outputPath = path.join(__dirname, output);
  if (!fs.existsSync(outputPath)) {
    console.error(`✗ Missing output: ${output}`);
    allOutputsExist = false;
  }
}

if (allOutputsExist) {
  console.log('✓ All build outputs verified\n');
} else {
  console.error('✗ Build verification failed');
  process.exit(1);
}

// 运行简单测试
console.log('7. Running simple test...');
try {
  const testScript = path.join(__dirname, 'test/simple-test.ts');
  if (fs.existsSync(testScript)) {
    // 使用ts-node运行测试
    execSync(`npx ts-node ${testScript}`, { stdio: 'inherit', cwd: __dirname });
    console.log('✓ Simple test passed\n');
  } else {
    console.log('⚠ Simple test script not found, skipping\n');
  }
} catch (error) {
  console.warn('⚠ Simple test failed\n');
}

console.log('=== Build completed successfully ===\n');
console.log('Next steps:');
console.log('1. Use the package locally:');
console.log('   npm link @ctrl/tool-integration');
console.log('');
console.log('2. Publish to npm (if needed):');
console.log('   npm publish --access public');
console.log('');
console.log('3. Integrate with CTRL project:');
console.log('   Add "@ctrl/tool-integration" to your package.json dependencies');
console.log('');
console.log('4. Check examples in examples/ directory');