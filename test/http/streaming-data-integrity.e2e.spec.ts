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
import { PassThrough } from 'stream';

@Controller('stream-test')
class StreamTestController {
  @Post('data-integrity')
  @HttpCode(HttpStatus.OK)
  async dataIntegrity(@Req() req: UwsRequest) {
    const passThrough = new PassThrough();
    const chunks: Buffer[] = [];

    passThrough.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.pipe(passThrough);

    await new Promise<void>((resolve, reject) => {
      passThrough.once('end', resolve);
      passThrough.once('error', reject);
    });

    const buffer = Buffer.concat(chunks);
    const hash = crypto.createHash('md5').update(buffer).digest('hex');

    return { hash, size: buffer.length };
  }
}

@Module({
  controllers: [StreamTestController],
})
class TestModule {}

describe('Request Streaming - Data Integrity E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13343;

  beforeAll(async () => {
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
  });

  it('should maintain data integrity for binary pattern', async () => {
    // Create data with specific pattern
    const data = Buffer.alloc(256 * 1024); // 256KB
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }
    const expectedHash = crypto.createHash('md5').update(data).digest('hex');

    const response = await fetch(`${baseUrl}/stream-test/data-integrity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.hash).toBe(expectedHash);
    expect(result.size).toBe(256 * 1024);
  });

  it('should maintain data integrity for random bytes', async () => {
    const data = crypto.randomBytes(512 * 1024); // 512KB
    const expectedHash = crypto.createHash('md5').update(data).digest('hex');

    const response = await fetch(`${baseUrl}/stream-test/data-integrity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.hash).toBe(expectedHash);
    expect(result.size).toBe(512 * 1024);
  });
});
