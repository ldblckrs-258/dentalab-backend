import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mergeMap, Observable, tap } from 'rxjs';
import {
  AUDIT_ACCESS_KEY,
  AUDIT_MUTATION_KEY,
  type AuditAccessConfig,
  type AuditMutationConfig,
} from '@common/decorators/audit.decorator';
import { RequestContextService } from '@modules/common/context/request-context';
import { AuditService } from './audit.service';
import { PrismaService } from '@modules/database';
import { isPairedDiffEmpty, pairedDiff } from './audit.utils';

/** Evict debounce entries older than this many milliseconds. */
const DEBOUNCE_TTL_MS = 60_000;
/** Start eviction sweep when the map exceeds this size. */
const DEBOUNCE_MAX_SIZE = 10_000;

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
  internal_document: 'internalDocument',
  inventory_item: 'inventoryItem',
  email: 'emailLog',
  chat_session: 'chatSession',
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly accessDebounce = new Map<string, number>();

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const mutation = this.reflector.get<AuditMutationConfig | undefined>(
      AUDIT_MUTATION_KEY,
      context.getHandler(),
    );
    const access = this.reflector.get<AuditAccessConfig | undefined>(
      AUDIT_ACCESS_KEY,
      context.getHandler(),
    );

    if (!mutation && !access) {
      return next.handle();
    }

    if (mutation) {
      return this.handleMutation(context, next, mutation);
    }
    return this.handleAccess(context, next, access!);
  }

  private handleMutation(
    context: ExecutionContext,
    next: CallHandler,
    config: AuditMutationConfig,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method = request.method as string;
    const paramKey = config.paramKey ?? 'id';
    let resourceId = request.params?.[paramKey] as string | undefined;
    if (!resourceId && config.useActorUserId) {
      resourceId = request.user?.id as string | undefined;
    }

    // Start the "before" fetch immediately — runs in parallel with the request
    // handler, so the mutation does not pay a DB round-trip in its hot path.
    const oldDataPromise: Promise<Record<string, unknown> | undefined> =
      resourceId && method !== 'POST'
        ? this.getOldData(config.resource, resourceId)
        : Promise.resolve(undefined);

    return next.handle().pipe(
      mergeMap(async (responseData) => {
        const oldData = await oldDataPromise;
        try {
          const newData =
            method === 'DELETE' ? undefined : this.extractNewData(responseData);
          let before: Record<string, unknown> = {};
          let after: Record<string, unknown> = {};
          if (method === 'POST') {
            if (newData) after = newData;
          } else if (method === 'DELETE') {
            if (oldData) before = oldData;
          } else {
            ({ before, after } = pairedDiff(oldData, newData));
          }

          if (!isPairedDiffEmpty(before, after)) {
            this.auditService.emit({
              code: config.code,
              resource: config.resource,
              resourceId: resourceId ?? this.extractId(responseData),
              before,
              after,
            });
          }
        } catch {
          /* best-effort */
        }
        return responseData;
      }),
    );
  }

  private handleAccess(
    context: ExecutionContext,
    next: CallHandler,
    config: AuditAccessConfig,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const paramKey = config.paramKey ?? 'id';
    const resourceId = request.params?.[paramKey] as string | undefined;

    return next.handle().pipe(
      tap(() => {
        if (!resourceId) return;
        // Prefer the validated sessionId from RequestContext over raw header.
        const sessionId = RequestContextService.getCurrentContext()?.sessionId;
        if (config.debounceSeconds && config.debounceSeconds > 0) {
          const key = `${sessionId ?? 'anon'}:${resourceId}:${config.code}`;
          const now = Date.now();
          const prev = this.accessDebounce.get(key);
          if (prev && now - prev < config.debounceSeconds * 1000) return;
          this.pruneDebounceMap(now);
          this.accessDebounce.set(key, now);
        }
        try {
          this.auditService.emit({
            code: config.code,
            resource: config.resource,
            resourceId,
          });
        } catch {
          /* best-effort */
        }
      }),
    );
  }

  private pruneDebounceMap(now: number): void {
    if (this.accessDebounce.size < DEBOUNCE_MAX_SIZE) return;
    const cutoff = now - DEBOUNCE_TTL_MS;
    for (const [key, ts] of this.accessDebounce) {
      if (ts < cutoff) this.accessDebounce.delete(key);
    }
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
        ? (structuredClone(record) as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private extractNewData(
    responseData: unknown,
  ): Record<string, unknown> | undefined {
    if (!responseData || typeof responseData !== 'object') return undefined;
    const data = (responseData as any).data ?? responseData;
    return structuredClone(data) as Record<string, unknown>;
  }

  private extractId(responseData: unknown): string | undefined {
    if (!responseData || typeof responseData !== 'object') return undefined;
    const data = (responseData as any).data ?? responseData;
    if (data && typeof data === 'object' && 'id' in data) {
      return data.id as string;
    }
    return undefined;
  }
}
