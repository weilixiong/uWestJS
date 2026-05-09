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
  @Post('large-payload')
  @HttpCode(HttpStatus.OK)
  async largePayload(@Req() req: UwsRequest) {
    const passthrough = new PassThrough();
    req.pipe(passthrough);

    const chunks: Buffer[] = [];
    passthrough.on('data', (chunk) => {
      chunks.push(chunk);
    });

    await new Promise<void>((resolve) => {
      passthrough.on('end', resolve);
    });

    const body = Buffer.concat(chunks);
    const hash = crypto.createHash('md5').update(body).digest('hex');

    return { hash, size: body.length };
  }
}

@Module({
  controllers: [StreamTestController],
})
class TestModule {}

describe('Request Streaming - Large Payloads E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13347;

  beforeAll(async () => {
    // Increase max body size to 20MB for large payload tests
    const adapter = new UwsPlatformAdapter({ port, maxBodySize: 20 * 1024 * 1024 });
    app = await NestFactory.create(TestModule, adapter);
    await app.init();

    await new Promise<void>((resolve, reject) => {
      adapter.listen(port, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    baseUrl = `http://localhost:${port}`;
  }, 30000); // Increase timeout for setup

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it('should handle 2MB payload', async () => {
    const data = crypto.randomBytes(2 * 1024 * 1024); // 2MB
    const expectedHash = crypto.createHash('md5').update(data).digest('hex');

    const response = await fetch(`${baseUrl}/stream-test/large-payload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: data,
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.hash).toBe(expectedHash);
    expect(result.size).toBe(2 * 1024 * 1024);
  }, 15000); // 15 second timeout

  it('should handle 5MB payload', async () => {
    const data = crypto.randomBytes(5 * 1024 * 1024); // 5MB
    const expectedHash = crypto.createHash('md5').update(data).digest('hex');

    const response = await fetch(`${baseUrl}/stream-test/large-payload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: data,
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.hash).toBe(expectedHash);
    expect(result.size).toBe(5 * 1024 * 1024);
  }, 20000); // 20 second timeout
});
