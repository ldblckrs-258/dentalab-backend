import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SkipResponseWrap, Public } from '@common/decorators';
import { HealthService } from './health.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @SkipResponseWrap()
  @HttpCode(HttpStatus.OK)
  liveness() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @SkipResponseWrap()
  async readiness(@Res() res: Response): Promise<void> {
    const result = await this.healthService.checkReadiness();
    const statusCode =
      result.status === 'unhealthy'
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.OK;
    res.status(statusCode).json(result);
  }
}
