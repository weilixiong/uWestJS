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
import * as http from 'http';

const TEST_TEMP_DIR = path.join(os.tmpdir(), 'uwestjs-streaming-chunked');

@Controller('stream-test')
class StreamTestController {
  @Post('chunked')
  @HttpCode(HttpStatus.OK)
  async chunkedTransfer(@Req() req: UwsRequest) {
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

describe('Request Streaming - Chunked Transfer Encoding E2E', () => {
  let app: INestApplication;
  const port = 13344;

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

  it('should handle chunked transfer encoding with file stream', async () => {
    // Create a test file to stream
    const testFilePath = path.join(TEST_TEMP_DIR, 'source-file.bin');
    const testData = crypto.randomBytes(512 * 1024); // 512KB
    fs.writeFileSync(testFilePath, testData);

    const expectedHash = crypto.createHash('md5').update(testData).digest('hex');

    // Use Node.js http module to send chunked request
    const result = await new Promise<{ hash: string; size: number }>((resolve, reject) => {
      const fileStream = fs.createReadStream(testFilePath);

      const options = {
        hostname: 'localhost',
        port: port,
        path: '/stream-test/chunked',
        method: 'POST',
        headers: {
          'Transfer-Encoding': 'chunked',
          'Content-Type': 'application/octet-stream',
          'x-file-name': 'chunked-upload.bin',
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

      // Pipe file stream to request (this creates chunked encoding)
      fileStream.pipe(req);
      fileStream.on('error', reject);
    });

    // Cleanup source file
    fs.unlinkSync(testFilePath);

    expect(result.hash).toBe(expectedHash);
    expect(result.size).toBe(512 * 1024);
  });
});
