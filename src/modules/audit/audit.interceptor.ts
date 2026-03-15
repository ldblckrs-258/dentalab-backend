import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDITED_KEY } from '@common/constants';
import { AuditService } from './audit.service';
import { PrismaService } from '@modules/database';
import { redactSensitiveFields, shallowDiff } from './audit.utils';

const HTTP_METHOD_TO_ACTION: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

// Maps resource names to Prisma model delegate names
const RESOURCE_TO_MODEL: Record<string, string> = {
  user: 'user',
  role: 'role',
  permission: 'permission',
  patient: 'patient',
  provider: 'provider',
  appointment: 'appointment',
  procedure: 'procedure',
  appointment_type: 'appointmentType',
  treatment_plan: 'treatmentPlan',
  clinical_note: 'clinicalNote',
  form: 'form',
  internal_document: 'internalDocument',
  inventory_item: 'inventoryItem',
  email_template: 'emailTemplate',
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const resourceName = this.reflector.get<string>(
      AUDITED_KEY,
      context.getHandler(),
    );

    if (!resourceName) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const method = request.method as string;
    const action = HTTP_METHOD_TO_ACTION[method];

    if (!action) {
      return next.handle();
    }

    const resourceId = request.params?.id as string | undefined;
    const userId = request.user?.id as string | undefined;
    const ip = request.ip as string;

    // Capture old data for update/delete
    let oldData: Record<string, unknown> | undefined;
    if ((action === 'update' || action === 'delete') && resourceId) {
      oldData = await this.getOldData(resourceName, resourceId);
    }

    return next.handle().pipe(
      tap((responseData) => {
        // Fire-and-forget audit log
        setImmediate(() => {
          const newData =
            action === 'delete'
              ? undefined
              : this.extractNewData(responseData, oldData);

          const redactedOldData = oldData
            ? redactSensitiveFields(oldData)
            : undefined;
          const redactedNewData = newData
            ? redactSensitiveFields(newData)
            : undefined;

          void this.auditService.log({
            userId,
            action,
            resource: resourceName,
            resourceId: resourceId ?? this.extractId(responseData),
            oldData: redactedOldData,
            newData: redactedNewData,
            ipAddress: ip,
          });
        });
      }),
    );
  }

  private async getOldData(
    resourceName: string,
    id: string,
  ): Promise<Record<string, unknown> | undefined> {
    const modelName = RESOURCE_TO_MODEL[resourceName];
    if (!modelName) return undefined;

    try {
      const model = (this.prisma.baseClient as any)[modelName];
      if (!model) return undefined;
      const record = await model.findUnique({ where: { id } });
      return record
        ? (JSON.parse(JSON.stringify(record)) as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private extractNewData(
    responseData: unknown,
    oldData?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!responseData || typeof responseData !== 'object') return undefined;

    const data = (responseData as any).data ?? responseData;
    const newDataParsed = JSON.parse(JSON.stringify(data)) as Record<
      string,
      unknown
    >;

    if (oldData) {
      return shallowDiff(oldData, newDataParsed);
    }
    return newDataParsed;
  }

  private extractId(responseData: unknown): string | undefined {
    if (!responseData || typeof responseData !== 'object') return undefined;
    const data = (responseData as any).data ?? responseData;
    return data?.id;
  }
}
