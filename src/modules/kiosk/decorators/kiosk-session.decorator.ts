import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const KioskSession = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const session = request.kioskSession;
    return data ? session?.[data] : session;
  },
);
