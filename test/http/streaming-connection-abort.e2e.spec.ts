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
import * as http from 'http';

@Controller('stream-test')
class StreamTestController {
  @Post('abort-test')
  @HttpCode(HttpStatus.OK)
  async abortTest(@Req() req: UwsRequest) {
    const chunks: Buffer[] = [];
    let aborted = false;
    let errorOccurred = false;

    return new Promise((resolve, _reject) => {
      req.on('data', (chunk) => {
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (!aborted) {
          resolve({
            success: true,
            bytesReceived: chunks.reduce((sum, c) => sum + c.length, 0),
            aborted: false,
          });
        }
      });

      req.on('error', (_error) => {
        errorOccurred = true;
      });

      req.on('close', () => {
        if (req.isAborted) {
          aborted = true;
          resolve({
            success: true,
            bytesReceived: chunks.reduce((sum, c) => sum + c.length, 0),
            aborted: true,
            errorOccurred,
          });
        }
      });
    });
  }
}

@Module({
  controllers: [StreamTestController],
})
class TestModule {}

describe('Request Streaming - Connection Abort E2E', () => {
  let app: INestApplication;
  const port = 13346;

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

  it('should handle connection abort during streaming', async () => {
    let requestDestroyed = false;

    // Create a promise that will be resolved when aborted
    const uploadPromise = new Promise<void>((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: port,
        path: '/stream-test/abort-test',
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      };

      const req = http.request(options, (res) => {
        res.on('data', (_chunk) => {
          // Data received but ignored - we expect abort, not completion
        });

        res.on('end', () => {
          // If we get a response, the request wasn't aborted properly
          reject(new Error('Request completed instead of being aborted'));
        });
      });

      let resolved = false;
      const safetyTimeout = setTimeout(() => {
        if (!resolved) {
          reject(new Error('Timeout: abort event did not fire'));
        }
      }, 3000);

      req.on('error', (error) => {
        if (resolved) return;
        // Expected error when we abort
        if (
          error.message.includes('aborted') ||
          error.code === 'ECONNRESET' ||
          error.code === 'EPIPE'
        ) {
          resolved = true;
          clearTimeout(safetyTimeout);
          requestDestroyed = true;
          resolve(); // This is expected
        } else {
          reject(error);
        }
      });

      req.once('close', () => {
        if (resolved) return;
        if (req.destroyed) {
          resolved = true;
          clearTimeout(safetyTimeout);
          requestDestroyed = true;
          resolve();
        }
      });

      // Start sending data slowly
      const chunkSize = 16 * 1024; // 16KB chunks
      let sent = 0;
      const totalSize = 5 * 1024 * 1024; // 5MB total
      let chunkCount = 0;

      const sendChunk = () => {
        if (sent >= totalSize || requestDestroyed) {
          if (!requestDestroyed) {
            req.end();
          }
          return;
        }

        const chunk = Buffer.alloc(chunkSize, 'x');
        sent += chunkSize;
        chunkCount++;

        // Abort after sending 3 chunks (48KB)
        if (chunkCount === 3) {
          setTimeout(() => {
            req.destroy();
          }, 10);
          return;
        }

        if (req.write(chunk)) {
          // Add small delay between chunks to ensure abort happens mid-stream
          setTimeout(sendChunk, 20);
        } else {
          req.once('drain', () => setTimeout(sendChunk, 20));
        }
      };

      sendChunk();
    });

    // Should resolve without error - abort is expected
    await expect(uploadPromise).resolves.toBeUndefined();
    expect(requestDestroyed).toBe(true);
  });

  it('should complete successfully without abort', async () => {
    const testData = Buffer.alloc(256 * 1024, 'a'); // 256KB

    const result = await new Promise<any>((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: port,
        path: '/stream-test/abort-test',
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': testData.length,
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

    expect(result.success).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.bytesReceived).toBe(256 * 1024);
  });
});
