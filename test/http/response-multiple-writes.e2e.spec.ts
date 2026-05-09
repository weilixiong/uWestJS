// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import { Controller, Get, Res, Module, INestApplication } from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import { UwsResponse } from '../../src/http/core/response';

@Controller('write-test')
class WriteTestController {
  @Get('multiple-writes')
  multipleWrites(@Res() res: UwsResponse) {
    res.setHeader('x-multi-write', 'true');
    res.write('Hello ');
    res.write('World');
    res.send('!');
  }

  @Get('many-writes')
  manyWrites(@Res() res: UwsResponse) {
    res.setHeader('x-many-writes', 'true');
    for (let i = 0; i < 10; i++) {
      res.write(`chunk-${i}-`);
    }
    res.send('end');
  }
}

@Module({
  controllers: [WriteTestController],
})
class TestModule {}

describe('Response Multiple Writes + Send E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13352;

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
  }, 10000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it('should combine multiple res.write() calls with res.send()', async () => {
    const response = await fetch(`${baseUrl}/write-test/multiple-writes`);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-multi-write')).toBe('true');

    const body = await response.text();
    expect(body).toBe('Hello World!');
  });

  it('should handle many res.write() calls batched correctly', async () => {
    const response = await fetch(`${baseUrl}/write-test/many-writes`);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-many-writes')).toBe('true');

    const body = await response.text();
    const expected = Array.from({ length: 10 }, (_, i) => `chunk-${i}-`).join('') + 'end';
    expect(body).toBe(expected);
  });
});
