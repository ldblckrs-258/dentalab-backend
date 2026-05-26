import {
  registerDecorator,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  ValidationOptions,
  ValidateIf,
  IsIn,
  IsUUID,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';

export type ScopeType = 'patient' | 'documents';

@ValidatorConstraint({ name: 'ScopeExclusive', async: false })
class ScopeExclusiveConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as ScopeDto;
    if (dto.type === 'patient') {
      return (
        typeof dto.patientId === 'string' &&
        (dto.ragDocumentIds === undefined ||
          dto.ragDocumentIds === null ||
          (Array.isArray(dto.ragDocumentIds) &&
            dto.ragDocumentIds.length === 0))
      );
    }
    if (dto.type === 'documents') {
      return (
        Array.isArray(dto.ragDocumentIds) &&
        dto.ragDocumentIds.length >= 1 &&
        dto.ragDocumentIds.length <= 5 &&
        (dto.patientId === undefined || dto.patientId === null)
      );
    }
    return false;
  }

  defaultMessage(): string {
    return 'chat.scope.invalid_combination';
  }
}

export function IsScopeExclusive(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: ScopeExclusiveConstraint,
    });
  };
}

export class ScopeDto {
  @IsIn(['patient', 'documents'], { message: 'chat.scope.invalid_combination' })
  @IsScopeExclusive()
  type!: ScopeType;

  @ValidateIf((o: ScopeDto) => o.type === 'patient')
  @IsUUID('4', { message: 'chat.scope.patient_required' })
  patientId?: string;

  @ValidateIf((o: ScopeDto) => o.type === 'documents')
  @IsArray({ message: 'chat.scope.documents_required' })
  @ArrayMinSize(1, { message: 'chat.scope.documents_required' })
  @ArrayMaxSize(5, { message: 'chat.scope.limit_exceeded' })
  @IsUUID('4', { each: true, message: 'chat.scope.documents_required' })
  ragDocumentIds?: string[];
}
