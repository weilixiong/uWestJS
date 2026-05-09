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
  @Post('pipe-passthrough')
  @HttpCode(HttpStatus.OK)
  async pipePassThrough(@Req() req: UwsRequest) {
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

describe('Request Streaming - Pipe PassThrough E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13341;

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

  it('should pipe 500KB buffer to PassThrough stream', async () => {
    const data = crypto.randomBytes(500 * 1024); // 500KB
    const expectedHash = crypto.createHash('md5').update(data).digest('hex');

    const response = await fetch(`${baseUrl}/stream-test/pipe-passthrough`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.hash).toBe(expectedHash);
    expect(result.size).toBe(500 * 1024);
  });
});
