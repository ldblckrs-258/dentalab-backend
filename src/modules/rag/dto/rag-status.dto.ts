export class RagStatusDto {
  id!: string;
  sourceType!: string;
  sourceId!: string;
  status!: string;
  errorMessage!: string | null;
  totalParentChunks!: number;
  totalChildChunks!: number;
  contentHash!: string | null;
  ingestionTimeMs!: number | null;
  createdAt!: Date;
  updatedAt!: Date;
}
