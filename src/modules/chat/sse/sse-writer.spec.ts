import type { Response } from 'express';
import { SseWriter } from './sse-writer';

function makeMockRes() {
  const headers: Record<string, string> = {};
  const writes: string[] = [];
  let ended = false;
  const setHeader = jest.fn((k: string, v: string) => {
    headers[k] = v;
  });
  const flushHeaders = jest.fn();
  const write = jest.fn((chunk: string) => writes.push(chunk));
  const end = jest.fn(() => {
    ended = true;
  });
  const res = {
    setHeader,
    flushHeaders,
    write,
    end,
  } as unknown as Response;
  return {
    res,
    writes,
    headers,
    isEnded: () => ended,
    flushHeaders,
    end,
  };
}

describe('SseWriter', () => {
  it('sets SSE headers + flushes', () => {
    const { res, headers, flushHeaders } = makeMockRes();
    new SseWriter(res);
    expect(headers['Content-Type']).toBe('text/event-stream');
    expect(headers['Cache-Control']).toBe('no-cache, no-transform');
    expect(headers['Connection']).toBe('keep-alive');
    expect(headers['X-Accel-Buffering']).toBe('no');
    expect(flushHeaders).toHaveBeenCalled();
  });

  it('emits correctly framed events', () => {
    const { res, writes } = makeMockRes();
    const w = new SseWriter(res);
    w.emit('session', { sessionId: 'abc', userMessageId: 'm1' });
    expect(writes[0]).toBe(
      'event: session\ndata: {"sessionId":"abc","userMessageId":"m1"}\n\n',
    );
  });

  it('close() ends response and prevents further writes', () => {
    const { res, writes, end } = makeMockRes();
    const w = new SseWriter(res);
    w.close();
    w.emit('delta', { text: 'x' });
    expect(end).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(0);
  });
});
