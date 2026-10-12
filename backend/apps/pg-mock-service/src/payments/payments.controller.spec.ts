import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

describe('PaymentsController', () => {
  let controller: PaymentsController;

  const createMock = jest.fn();
  const approveMock = jest.fn();
  const cancelMock = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: PaymentsService,
          useValue: {
            create: createMock,
            approve: approveMock,
            cancel: cancelMock,
          },
        },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
  });

  it('create는 서비스의 create에 위임한다', () => {
    const dto: CreatePaymentDto = {
      orderId: 'order_test_0001',
      amount: 50000,
      orderName: '더블룸 1박',
      paymentMethod: 'CARD',
    };
    controller.create(dto);
    expect(createMock).toHaveBeenCalledWith(dto);
  });

  it('approve는 X-Mock-Result 헤더 값을 그대로 서비스에 전달한다', () => {
    controller.approve('pgmock_test', 'fail');
    expect(approveMock).toHaveBeenCalledWith('pgmock_test', 'fail');
  });

  it('cancel은 서비스의 cancel에 위임한다', () => {
    controller.cancel('pgmock_test', { cancelReason: '고객 변심' });
    expect(cancelMock).toHaveBeenCalledWith('pgmock_test', {
      cancelReason: '고객 변심',
    });
  });
});
