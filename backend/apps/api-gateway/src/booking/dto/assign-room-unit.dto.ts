import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, ValidateIf } from 'class-validator';

export class AssignRoomUnitDto {
  // null이면 배정 해제. 필드를 아예 빼면 400 (실수로 해제되는 것을 막는다)
  @ApiProperty({
    description: '배정할 호실 ID. null이면 배정 해제',
    example: 1,
    nullable: true,
    type: Number,
  })
  @ValidateIf((dto: AssignRoomUnitDto) => dto.roomUnitId !== null)
  @IsInt()
  @Min(1)
  roomUnitId: number | null;
}
