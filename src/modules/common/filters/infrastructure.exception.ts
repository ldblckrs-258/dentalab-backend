import { HttpException, HttpStatus } from '@nestjs/common';

export class InfrastructureException extends HttpException {
  public readonly errorCode: string;
  public readonly service: string;
  public readonly operation: string;

  constructor(
    errorCode: string,
    service: string,
    operation: string,
    message?: string,
  ) {
    super(
      message ?? `Infrastructure error: ${service}.${operation}`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    this.errorCode = errorCode;
    this.service = service;
    this.operation = operation;
  }
}
