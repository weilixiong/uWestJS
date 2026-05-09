// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import { Controller, Get, Res, Module, INestApplication } from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import { UwsResponse } from '../../src/http/core/response';

// Shared state for event tracking across requests
const eventState = {
  finishCount: 0,
  closeCount: 0,
};

@Controller('events')
class EventsController {
  @Get('finish')
  finishEvent(@Res() res: UwsResponse) {
    res.on('finish', () => {
      eventState.finishCount++;
    });
    res.send('done');
  }

  @Get('close')
  closeEvent(@Res() res: UwsResponse) {
    res.on('close', () => {
      eventState.closeCount++;
    });
    // Intentionally do not send — wait for client abort
  }

  @Get('status')
  getStatus() {
    return { ...eventState };
  }

  @Get('reset')
  resetStatus() {
    eventState.finishCount = 0;
    eventState.closeCount = 0;
    return { reset: true };
  }
}

@Module({
  controllers: [EventsController],
})
class TestModule {}

describe('Response Events E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13353;

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

  beforeEach(async () => {
    await fetch(`${baseUrl}/events/reset`);
  });

  it('should emit finish event when response is sent', async () => {
    const response = await fetch(`${baseUrl}/events/finish`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('done');

    // Query status endpoint to verify finish event fired
    const statusResponse = await fetch(`${baseUrl}/events/status`);
    const status = await statusResponse.json();

    expect(status.finishCount).toBe(1);
  });

  it('should emit close event when connection is aborted', async () => {
    const controller = new AbortController();

    // Start request and abort quickly
    setTimeout(() => controller.abort(), 50);

    try {
      await fetch(`${baseUrl}/events/close`, {
        signal: controller.signal,
      });
    } catch {
      // Expected abort error
    }

    // Wait for server to process abort
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Query status endpoint to verify close event fired
    const statusResponse = await fetch(`${baseUrl}/events/status`);
    const status = await statusResponse.json();

    expect(status.closeCount).toBe(1);
  });

  it('should emit finish event for each completed request', async () => {
    // Send 3 requests
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${baseUrl}/events/finish`);
      expect(response.status).toBe(200);
    }

    const statusResponse = await fetch(`${baseUrl}/events/status`);
    const status = await statusResponse.json();

    expect(status.finishCount).toBe(3);
  });
});
