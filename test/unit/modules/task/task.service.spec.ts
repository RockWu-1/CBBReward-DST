import { TaskService } from '../../../../src/modules/task/task.service';

describe('TaskService', () => {
  it('creates a task with PENDING status and persisted metadata', async () => {
    const create = jest.fn().mockResolvedValue({ id: 88, status: 'PENDING' });
    const service = new TaskService({
      task: { create, update: jest.fn() },
    } as any);

    await service.createTask({
      taskType: 'RECORD_RETRY_BULK',
      triggerSource: 'ADMIN',
      title: 'Bulk retry for 3 reward records',
      targetIds: [1, 2, 3],
      triggeredBy: 'admin@test.com',
      requestPayload: { recordIds: [1, 2, 3] },
    } as any);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskType: 'RECORD_RETRY_BULK',
        triggerSource: 'ADMIN',
        status: 'PENDING',
        title: 'Bulk retry for 3 reward records',
        targetIds: [1, 2, 3],
        triggeredBy: 'admin@test.com',
      }),
    });
  });

  it('marks a task as PARTIAL_FAILED with result payload and finish time', async () => {
    const update = jest.fn().mockResolvedValue({ id: 88, status: 'PARTIAL_FAILED' });
    const service = new TaskService({
      task: { create: jest.fn(), update },
    } as any);

    await service.markPartialFailed(88, {
      requestedCount: 3,
      successCount: 2,
      failedCount: 1,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 88 },
      data: expect.objectContaining({
        status: 'PARTIAL_FAILED',
        resultPayload: {
          requestedCount: 3,
          successCount: 2,
          failedCount: 1,
        },
        finishedAt: expect.any(Date),
      }),
    });
  });
});
