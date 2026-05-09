// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import { Controller, Get, Res, Module, INestApplication } from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import { UwsResponse } from '../../src/http/core/response';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TEST_TEMP_DIR = path.join(os.tmpdir(), 'uwestjs-response-stream-content-length');

@Controller('stream-test')
class StreamTestController {
  @Get('content-length')
  async contentLengthStream(@Res() res: UwsResponse) {
    const testFilePath = path.join(TEST_TEMP_DIR, 'test-file.bin');
    const stats = fs.statSync(testFilePath);
    const fileStream = fs.createReadStream(testFilePath);

    res.setHeader('x-is-streamed', 'true');
    await res.stream(fileStream, stats.size);
  }
}

@Module({
  controllers: [StreamTestController],
})
class TestModule {}

describe('Response Streaming - Content-Length Mode E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13348;

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

  it('should stream response with Content-Length header', async () => {
    const testFilePath = path.join(TEST_TEMP_DIR, 'test-file.bin');
    const expectedBuffer = fs.readFileSync(testFilePath);
    const expectedHash = crypto.createHash('md5').update(expectedBuffer).digest('hex');

    const response = await fetch(`${baseUrl}/stream-test/content-length`);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-is-streamed')).toBe('true');
    expect(response.headers.get('content-length')).toBe(String(expectedBuffer.byteLength));

    const receivedBuffer = Buffer.from(await response.arrayBuffer());
    const receivedHash = crypto.createHash('md5').update(receivedBuffer).digest('hex');

    expect(receivedHash).toBe(expectedHash);
    expect(receivedBuffer.byteLength).toBe(expectedBuffer.byteLength);
  });

  it('should stream large file with Content-Length (2MB)', async () => {
    // Overwrite the same file the controller reads
    const testFilePath = path.join(TEST_TEMP_DIR, 'test-file.bin');
    const testData = crypto.randomBytes(2 * 1024 * 1024); // 2MB
    fs.writeFileSync(testFilePath, testData);

    const expectedHash = crypto.createHash('md5').update(testData).digest('hex');

    const response = await fetch(`${baseUrl}/stream-test/content-length`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(testData.byteLength));

    const receivedBuffer = Buffer.from(await response.arrayBuffer());
    const receivedHash = crypto.createHash('md5').update(receivedBuffer).digest('hex');

    expect(receivedHash).toBe(expectedHash);
    expect(receivedBuffer.byteLength).toBe(testData.byteLength);
  }, 15000);
});
