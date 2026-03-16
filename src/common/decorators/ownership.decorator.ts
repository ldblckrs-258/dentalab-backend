import { SetMetadata } from '@nestjs/common';
import { OWNERSHIP_KEY } from '@common/constants';

/**
 * Direct ownership: resource has a field pointing to the owner user ID.
 * e.g., ChatSession.user_id = currentUser.id
 */
export interface DirectOwnership {
  /** Prisma model name (camelCase, e.g., 'chatSession') */
  model: string;
  /** Request param key for the resource ID (default: 'id') */
  paramKey?: string;
  /** Field on the model that holds the owner's user ID */
  ownerField: string;
  /** Permission that bypasses ownership check (e.g., 'chat_sessions:update:any') */
  bypassPermission?: string;
}

/**
 * Indirect ownership: resource belongs to an intermediate entity that belongs to the user.
 * e.g., Appointment.provider_id → Provider.id where Provider.user_id = currentUser.id
 */
export interface IndirectOwnership extends DirectOwnership {
  /** The intermediate model to join through */
  through: {
    /** Prisma model name (camelCase, e.g., 'provider') */
    model: string;
    /** Field on the intermediate model that the resource's ownerField points to (default: 'id') */
    foreignKey?: string;
    /** Field on the intermediate model that holds the user ID */
    userField: string;
  };
}

export type OwnershipConfig = DirectOwnership | IndirectOwnership;

export const CheckOwnership = (config: OwnershipConfig) =>
  SetMetadata(OWNERSHIP_KEY, config);
