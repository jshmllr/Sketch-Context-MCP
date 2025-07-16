#!/usr/bin/env node

const { spawn } = require('child_process');

class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    console.log('🧪 Running Sketch Context MCP Tests\n');
    
    for (const test of this.tests) {
      try {
        console.log(`Running: ${test.name}`);
        await Promise.race([
          test.fn(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Test timeout')), 5000)
          )
        ]);
        console.log(`✅ ${test.name}\n`);
        this.passed++;
      } catch (error) {
        console.log(`❌ ${test.name}: ${error.message}\n`);
        this.failed++;
      }
    }

    console.log(`\n📊 Test Results:`);
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`📈 Total: ${this.tests.length}`);
    
    if (this.failed > 0) {
      process.exit(1);
    }
  }
}

const runner = new TestRunner();

// Test 1: Help command works
runner.test('Help command works', async () => {
  await new Promise((resolve, reject) => {
    const helpProcess = spawn('node', ['index.js', '--help']);
    let output = '';
    
    helpProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    helpProcess.on('close', (code) => {
      if (code === 0 && output.includes('sketch-api-key')) {
        resolve();
      } else {
        reject(new Error('Help command failed'));
      }
    });
    
    setTimeout(() => {
      helpProcess.kill();
      reject(new Error('Help command timeout'));
    }, 3000);
  });
});

// Test 2: Version command works
runner.test('Version command works', async () => {
  await new Promise((resolve, reject) => {
    const versionProcess = spawn('node', ['index.js', '--version']);
    let output = '';
    
    versionProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    versionProcess.on('close', (code) => {
      if (code === 0 && output.trim().match(/^\d+\.\d+\.\d+$/)) {
        resolve();
      } else {
        reject(new Error('Version command failed'));
      }
    });
    
    setTimeout(() => {
      versionProcess.kill();
      reject(new Error('Version command timeout'));
    }, 3000);
  });
});

// Test 3: Configuration validation prevents invalid ports
runner.test('Configuration validation prevents invalid ports', async () => {
  await new Promise((resolve, reject) => {
    const invalidProcess = spawn('node', ['index.js', '--port', '99999']);
    let errorOutput = '';
    
    invalidProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    invalidProcess.on('close', (code) => {
      if (code !== 0 && (errorOutput.includes('Port must be between') || errorOutput.includes('ConfigurationError'))) {
        resolve();
      } else {
        reject(new Error('Should have failed with invalid port'));
      }
    });
    
    setTimeout(() => {
      invalidProcess.kill();
      reject(new Error('Port validation timeout'));
    }, 3000);
  });
});

// Test 4: Basic server startup and shutdown
runner.test('Server starts and stops correctly', async () => {
  await new Promise((resolve, reject) => {
    const serverProcess = spawn('node', ['index.js', '--port', '3336', '--log-level', 'ERROR']);
    let started = false;
    
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('started successfully') || output.includes('Running on port')) {
        started = true;
        serverProcess.kill('SIGTERM');
      }
    });
    
    serverProcess.on('close', (code) => {
      if (started) {
        resolve();
      } else {
        reject(new Error(`Server failed to start, exit code: ${code}`));
      }
    });
    
    setTimeout(() => {
      if (!started) {
        serverProcess.kill();
        reject(new Error('Server startup timeout'));
      }
    }, 4000);
  });
});

// Run all tests
if (require.main === module) {
  runner.run().catch(console.error);
}

module.exports = { TestRunner };