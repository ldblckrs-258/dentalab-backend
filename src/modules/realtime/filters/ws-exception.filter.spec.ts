import { ArgumentsHost, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { WsExceptionFilter } from './ws-exception.filter';
import { WsErrorCode } from '../interfaces';

describe('WsExceptionFilter', () => {
  let mockClient: any;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    mockClient = { id: 'client-1', emit: jest.fn() } as any;
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  function createHost(client: any): ArgumentsHost {
    return {
      switchToWs: () => ({
        getClient: () => client,
      }),
    } as any;
  }

  it('should emit ws:error frame when WsException has code+message', () => {
    const filter = new WsExceptionFilter() as any;
    filter.catch(
      new WsException({
        code: WsErrorCode.WS_NO_TOKEN,
        message: 'Missing token',
      }),
      createHost(mockClient),
    );

    expect(mockClient.emit).toHaveBeenCalledWith('ws:error', {
      event: 'ws:error',
      code: 'WS_NO_TOKEN',
      message: 'Missing token',
      details: undefined,
    });
  });

  it('should emit ws:error frame when WsException has string error', () => {
    const filter = new WsExceptionFilter() as any;
    filter.catch(new WsException('simple error'), createHost(mockClient));

    expect(mockClient.emit).toHaveBeenCalledWith('ws:error', {
      event: 'ws:error',
      code: 'simple error',
      message: 'simple error',
      details: undefined,
    });
  });

  it('should include details when present in the error object', () => {
    const filter = new WsExceptionFilter() as any;
    filter.catch(
      new WsException({
        code: WsErrorCode.WS_VALIDATION_ERROR,
        message: 'Validation failed',
        details: { field: 'email' },
      }),
      createHost(mockClient),
    );

    expect(mockClient.emit).toHaveBeenCalledWith('ws:error', {
      event: 'ws:error',
      code: 'WS_VALIDATION_ERROR',
      message: 'Validation failed',
      details: { field: 'email' },
    });
  });

  it('should log ws.event.rejected with client id and code', () => {
    const filter = new WsExceptionFilter() as any;
    filter.catch(
      new WsException({
        code: WsErrorCode.WS_RATE_LIMITED,
        message: 'Rate limited',
      }),
      createHost(mockClient),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      'ws.event.rejected [client=client-1, reason=WS_RATE_LIMITED]',
    );
  });

  it('should fallback to WS_INTERNAL_ERROR for unknown object shape', () => {
    const filter = new WsExceptionFilter() as any;
    filter.catch(new WsException({ unknown: 'shape' }), createHost(mockClient));

    expect(mockClient.emit).toHaveBeenCalledWith('ws:error', {
      event: 'ws:error',
      code: WsErrorCode.WS_INTERNAL_ERROR,
      message: 'An error occurred',
      details: undefined,
    });
  });
});
