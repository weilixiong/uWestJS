// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import {
  Controller,
  Post,
  Req,
  Module,
  HttpCode,
  HttpStatus,
  INestApplication,
} from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import { UwsRequest } from '../../src/http/core/request';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TEST_TEMP_DIR = path.join(os.tmpdir(), 'uwestjs-streaming-pipe-buffer');

@Controller('stream-test')
class StreamTestController {
  @Post('pipe-buffer')
  @HttpCode(HttpStatus.OK)
  async pipeBuffer(@Req() req: UwsRequest) {
    const fileName = req.headers['x-file-name'] as string;
    const filePath = path.join(TEST_TEMP_DIR, fileName);

    if (!fs.existsSync(TEST_TEMP_DIR)) {
      fs.mkdirSync(TEST_TEMP_DIR, { recursive: true });
    }

    const writable = fs.createWriteStream(filePath);
    req.pipe(writable);

    await new Promise<void>((resolve, reject) => {
      writable.once('finish', resolve);
      writable.once('error', reject);
    });

    const writtenBuffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('md5').update(writtenBuffer).digest('hex');
    fs.unlinkSync(filePath);

    return { hash, size: writtenBuffer.length };
  }
}

@Module({
  controllers: [StreamTestController],
})
class TestModule {}

describe('Request Streaming - Pipe Buffer E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13340;

  beforeAll(async () => {
    if (!fs.existsSync(TEST_TEMP_DIR)) {
      fs.mkdirSync(TEST_TEMP_DIR, { recursive: true });
    }

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
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (fs.existsSync(TEST_TEMP_DIR)) {
      fs.rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
  });

  it('should pipe 1MB buffer to writable stream', async () => {
    const data = crypto.randomBytes(1024 * 1024); // 1MB
    const expectedHash = crypto.createHash('md5').update(data).digest('hex');

    const response = await fetch(`${baseUrl}/stream-test/pipe-buffer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-file-name': 'test-1mb.bin',
      },
      body: data,
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.hash).toBe(expectedHash);
    expect(result.size).toBe(1024 * 1024);
  });
});
