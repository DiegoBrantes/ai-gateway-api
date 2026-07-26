import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BadRequestError, ProviderError } from '../utils/errors';
import { errorHandler } from './error.middleware';

function fakeReplyRequest() {
  const sent: { status?: number; body?: unknown } = {};
  const reply = {
    status(code: number) {
      sent.status = code;
      return reply;
    },
    send(body: unknown) {
      sent.body = body;
      return reply;
    },
  } as unknown as FastifyReply;
  const request = {
    id: 'req-1',
    log: { error: vi.fn() },
  } as unknown as FastifyRequest;
  return { reply, request, sent };
}

describe('errorHandler', () => {
  it('maps a ZodError to 400 with details', () => {
    const { reply, request, sent } = fakeReplyRequest();
    const zerr = z.object({ a: z.string() }).safeParse({ a: 1 });
    errorHandler((zerr as { error: z.ZodError }).error, request, reply);
    expect(sent.status).toBe(400);
    expect((sent.body as { error: { code: string } }).error.code).toBe('bad_request');
  });

  it('maps an AppError (4xx) to its status without logging', () => {
    const { reply, request, sent } = fakeReplyRequest();
    errorHandler(new BadRequestError('nope'), request, reply);
    expect(sent.status).toBe(400);
    expect(request.log.error).not.toHaveBeenCalled();
  });

  it('logs 5xx AppErrors and returns their status', () => {
    const { reply, request, sent } = fakeReplyRequest();
    errorHandler(new ProviderError('openai', 'boom', 502), request, reply);
    expect(sent.status).toBe(502);
    expect(request.log.error).toHaveBeenCalled();
  });

  it('passes through Fastify client errors (<500) with their message', () => {
    const { reply, request, sent } = fakeReplyRequest();
    const fastifyErr = Object.assign(new Error('bad content type'), { statusCode: 415 });
    errorHandler(fastifyErr as never, request, reply);
    expect(sent.status).toBe(415);
    expect((sent.body as { error: { message: string } }).error.message).toBe(
      'bad content type',
    );
  });

  it('hides internals for unexpected 5xx errors', () => {
    const { reply, request, sent } = fakeReplyRequest();
    errorHandler(new Error('secret stacktrace') as never, request, reply);
    expect(sent.status).toBe(500);
    expect((sent.body as { error: { message: string } }).error.message).toBe(
      'An unexpected error occurred',
    );
    expect(request.log.error).toHaveBeenCalled();
  });
});
