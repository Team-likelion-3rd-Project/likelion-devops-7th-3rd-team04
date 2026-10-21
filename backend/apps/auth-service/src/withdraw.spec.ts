import { JwtService } from '@nestjs/jwt';
import { of, throwError } from 'rxjs';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { parseApiRpcError } from '@app/common';
import { AuthServiceService } from './auth-service.service';
import { Credential } from './entities/credential.entity';
import { AdminCredential } from './entities/admin-credential.entity';

// LDP-95: 이용 예정 예약이 있으면 회원 탈퇴 거절 — 아무것도 지우기 전에 확인한다
describe('AuthServiceService 회원 탈퇴 (이용 예정 예약 확인)', () => {
  const deleteUser = jest.fn();
  const countUpcomingReservations = jest.fn();
  const credentialDelete = jest.fn();
  const redisDel = jest.fn();
  let service: AuthServiceService;

  const withdraw = () =>
    service.withdraw({ userId: 7 }).catch((e: unknown) => e);

  beforeEach(() => {
    jest.clearAllMocks();
    deleteUser.mockReturnValue(of({ success: true }));
    countUpcomingReservations.mockReturnValue(of({ count: 0 }));
    credentialDelete.mockResolvedValue({ affected: 1 });
    redisDel.mockResolvedValue(1);
    service = new AuthServiceService(
      { delete: credentialDelete } as unknown as Repository<Credential>,
      {} as Repository<AdminCredential>,
      new JwtService({}),
      { getService: () => ({ deleteUser }) } as never,
      { getService: () => ({ countUpcomingReservations }) } as never,
      { del: redisDel } as unknown as Redis,
    );
    service.onModuleInit();
  });

  it('이용 예정 예약이 없으면 지금처럼 탈퇴한다 (프로필·자격증명·세션 삭제)', async () => {
    expect(await withdraw()).toEqual({ success: true });

    expect(countUpcomingReservations).toHaveBeenCalledWith({ userId: 7 });
    expect(deleteUser).toHaveBeenCalledWith({ id: 7 });
    expect(credentialDelete).toHaveBeenCalledWith({ userId: 7 });
    expect(redisDel).toHaveBeenCalled();
  });

  it('이용 예정 예약이 있으면 409 HAS_UPCOMING_RESERVATIONS — 계정을 하나도 지우지 않는다', async () => {
    countUpcomingReservations.mockReturnValue(of({ count: 2 }));

    const error = await withdraw();

    expect(parseApiRpcError(error)).toMatchObject({
      status: 409,
      code: 'HAS_UPCOMING_RESERVATIONS',
      retryable: false,
    });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(credentialDelete).not.toHaveBeenCalled();
    expect(redisDel).not.toHaveBeenCalled();
  });

  it('예약 서비스에 연결할 수 없으면 503 — 확인 못 한 채 지우지 않는다', async () => {
    countUpcomingReservations.mockReturnValue(
      throwError(() => ({ code: 14, details: 'No connection established' })),
    );

    const error = await withdraw();

    expect(parseApiRpcError(error)).toMatchObject({
      status: 503,
      code: 'BOOKING_SERVICE_UNAVAILABLE',
      retryable: true,
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
