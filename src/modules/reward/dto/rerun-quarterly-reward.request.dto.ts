import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class RerunQuarterlyRewardRequestDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-Q[1-4]$/)
  period!: string;

  @IsString()
  @IsNotEmpty()
  authToken!: string;
}
