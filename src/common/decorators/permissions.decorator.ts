import { SetMetadata } from '@nestjs/common';
import { PERMISSIONS_KEY, ANY_PERMISSION_KEY } from '@common/constants';

// AND logic: all permissions required
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

// OR logic: any one permission sufficient
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);
