// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import { Controller, Get, Res, Module, INestApplication } from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import { UwsResponse } from '../../src/http/core/response';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TEST_TEMP_DIR = path.join(os.tmpdir(), 'uwestjs-response-stream-pipefrom');

@Controller('stream-test')
class StreamTestController {
  @Get('pipefrom')
  async pipeFrom(@Res() res: UwsResponse) {
    const testFilePath = path.join(TEST_TEMP_DIR, 'test-file.bin');
    const fileStream = fs.createReadStream(testFilePath);

    res.setHeader('x-is-piped', 'true');
    res.pipeFrom(fileStream);
  }
}

@Module({
  controllers: [StreamTestController],
})
class TestModule {}

describe('Response Streaming - pipeFrom() Convenience Wrapper E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13350;

  beforeAll(async () => {
    if (!fs.existsSync(TEST_TEMP_DIR)) {
      fs.mkdirSync(TEST_TEMP_DIR, { recursive: true });
    }

    // Create test file with random data
    const testFilePath = path.join(TEST_TEMP_DIR, 'test-file.bin');
    const testData = crypto.randomBytes(512 * 1024); // 512KB
    fs.writeFileSync(testFilePath, testData);

    const adapter = new UwsPlatformAdapter({ port, maxBodySize: 10 * 1024 * 1024 });
    app = await NestFactory.create(TestModule, adapter);
    await app.init();

    await new Promise<void>((resolve, reject) => {
      adapter.listen(port, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    baseUrl = `http://localhost:${port}`;
  }, 10000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (fs.existsSync(TEST_TEMP_DIR)) {
      fs.rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
  });

  it('should stream response using pipeFrom()', async () => {
    const testFilePath = path.join(TEST_TEMP_DIR, 'test-file.bin');
    const expectedBuffer = fs.readFileSync(testFilePath);
    const expectedHash = crypto.createHash('md5').update(expectedBuffer).digest('hex');

    const response = await fetch(`${baseUrl}/stream-test/pipefrom`);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-is-piped')).toBe('true');

    const receivedBuffer = Buffer.from(await response.arrayBuffer());
    const receivedHash = crypto.createHash('md5').update(receivedBuffer).digest('hex');

    expect(receivedHash).toBe(expectedHash);
    expect(receivedBuffer.byteLength).toBe(expectedBuffer.byteLength);
  });

  it('should stream large file using pipeFrom() (2MB)', async () => {
    const testFilePath = path.join(TEST_TEMP_DIR, 'test-file.bin');
    const testData = crypto.randomBytes(2 * 1024 * 1024); // 2MB
    fs.writeFileSync(testFilePath, testData);

    const expectedHash = crypto.createHash('md5').update(testData).digest('hex');

    const response = await fetch(`${baseUrl}/stream-test/pipefrom`);

    expect(response.status).toBe(200);

    const receivedBuffer = Buffer.from(await response.arrayBuffer());
    const receivedHash = crypto.createHash('md5').update(receivedBuffer).digest('hex');

    expect(receivedHash).toBe(expectedHash);
    expect(receivedBuffer.byteLength).toBe(testData.byteLength);
  }, 15000);
});
