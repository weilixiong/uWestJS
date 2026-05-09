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
import { Writable } from 'stream';

@Controller('stream-test')
class StreamTestController {
  @Post('slow-consumer')
  @HttpCode(HttpStatus.OK)
  async slowConsumer(@Req() req: UwsRequest) {
    const chunks: Buffer[] = [];
    let chunkCount = 0;

    const slowWritable = new Writable({
      highWaterMark: 16 * 1024, // 16KB buffer
      write(chunk: Buffer, encoding, callback) {
        chunks.push(chunk);
        chunkCount++;

        // Simulate slow processing (5ms delay every 3 chunks)
        if (chunkCount % 3 === 0) {
          setTimeout(callback, 5);
        } else {
          callback();
        }
      },
    });

    req.pipe(slowWritable);

    await new Promise<void>((resolve, reject) => {
      slowWritable.once('finish', resolve);
      slowWritable.once('error', reject);
    });

    const buffer = Buffer.concat(chunks);
    const hash = crypto.createHash('md5').update(buffer).digest('hex');

    return { hash, size: buffer.length, chunkCount };
  }
}

@Module({
  controllers: [StreamTestController],
})
class TestModule {}

describe('Request Streaming - Backpressure E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13342;

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

  it('should handle backpressure from slow consumer (1MB)', async () => {
    const data = crypto.randomBytes(1024 * 1024); // 1MB
    const expectedHash = crypto.createHash('md5').update(data).digest('hex');

    const response = await fetch(`${baseUrl}/stream-test/slow-consumer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.hash).toBe(expectedHash);
    expect(result.size).toBe(1024 * 1024);
    expect(result.chunkCount).toBeGreaterThan(0);
  });
});
