import { BadRequestException, HttpStatus, Logger } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  const filter = new ApiExceptionFilter();

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockHost(req: Partial<import('express').Request>) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const setHeader = jest.fn();
    const res = { status, setHeader, headersSent: false };
    return {
      host: {
        switchToHttp: () => ({
          getResponse: () => res,
          getRequest: () =>
            ({
              requestId: 'req-test-uuid',
              ...req,
            }) as import('express').Request,
        }),
      } as import('@nestjs/common').ArgumentsHost,
      res,
      json,
      statusFn: status,
    };
  }

  it('formats HttpException with requestId and message array', () => {
    const { host, json } = mockHost({});
    filter.catch(
      new BadRequestException({
        message: ['a', 'b'],
        error: 'Bad Request',
      }),
      host,
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        requestId: 'req-test-uuid',
        message: expect.arrayContaining(['a', 'b']),
      }),
    );
  });

  it('maps unknown errors to 500', () => {
    const { host, json } = mockHost({});
    filter.catch(new Error('boom'), host);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        requestId: 'req-test-uuid',
      }),
    );
  });
});
