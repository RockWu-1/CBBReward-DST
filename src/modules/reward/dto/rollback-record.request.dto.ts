import { IsNotEmpty, IsString } from 'class-validator';

export class RollbackRecordRequestDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsString()
  @IsNotEmpty()
  operator!: string;
}