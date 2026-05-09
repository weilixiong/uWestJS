// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import {
  Controller,
  Get,
  Delete,
  Req,
  Module,
  HttpCode,
  HttpStatus,
  INestApplication,
} from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import { UwsRequest } from '../../src/http/core/request';
import * as crypto from 'crypto';
import * as http from 'http';

@Controller('stream-test')
class StreamTestController {
  @Get('echo')
  @HttpCode(HttpStatus.OK)
  async getEcho(@Req() req: UwsRequest) {
    // Echo the request body back (non-standard but supported)
    // Use buffer() method which handles body parsing
    const body = await req.buffer();
    const hash = crypto.createHash('md5').update(body).digest('hex');

    return {
      method: 'GET',
      hash,
      size: body.length,
      echo: body.toString('utf8').substring(0, 50),
    };
  }

  @Delete('echo')
  @HttpCode(HttpStatus.OK)
  async deleteEcho(@Req() req: UwsRequest) {
    // Echo the request body back (non-standard but supported)
    // Use buffer() method which handles body parsing
    const body = await req.buffer();
    const hash = crypto.createHash('md5').update(body).digest('hex');

    return {
      method: 'DELETE',
      hash,
      size: body.length,
      echo: body.toString('utf8').substring(0, 50),
    };
  }
}

@Module({
  controllers: [StreamTestController],
})
class TestModule {}

describe('Request Streaming - Non-POST Methods E2E', () => {
  let app: INestApplication;
  const port = 13345;

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
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it('should handle GET request with body (non-standard)', async () => {
    const testData = 'GET request with body data - ' + 'x'.repeat(100);
    const expectedHash = crypto.createHash('md5').update(testData).digest('hex');

    const result = await new Promise<any>((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: port,
        path: '/stream-test/echo',
        method: 'GET',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(testData),
        },
      };

      const req = http.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk.toString();
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseData);
            resolve(parsed);
          } catch (_error) {
            reject(new Error(`Failed to parse response: ${responseData}`));
          }
        });
      });

      req.on('error', reject);
      req.write(testData);
      req.end();
    });

    expect(result.method).toBe('GET');
    expect(result.hash).toBe(expectedHash);
    expect(result.size).toBe(testData.length);
  });

  it('should handle DELETE request with body (non-standard)', async () => {
    const testData = 'DELETE request with body data - ' + 'y'.repeat(100);
    const expectedHash = crypto.createHash('md5').update(testData).digest('hex');

    const result = await new Promise<any>((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: port,
        path: '/stream-test/echo',
        method: 'DELETE',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(testData),
        },
      };

      const req = http.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk.toString();
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseData);
            resolve(parsed);
          } catch (_error) {
            reject(new Error(`Failed to parse response: ${responseData}`));
          }
        });
      });

      req.on('error', reject);
      req.write(testData);
      req.end();
    });

    expect(result.method).toBe('DELETE');
    expect(result.hash).toBe(expectedHash);
    expect(result.size).toBe(testData.length);
  });
});
