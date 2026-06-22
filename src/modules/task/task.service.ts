import { Injectable } from '@nestjs/common';
import { Prisma, TaskStatus, TaskTriggerSource, TaskType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type CreateTaskInput = {
  taskType: TaskType;
  triggerSource: TaskTriggerSource;
  title: string;
  period?: string;
  rewardBatchId?: number;
  rewardRecordId?: number;
  targetIds?: Prisma.InputJsonValue;
  triggeredBy?: string;
  requestPayload?: Prisma.InputJsonValue;
};

@Injectable()
export class TaskService {
  constructor(private readonly prisma: PrismaService) {}

  createTask(input: CreateTaskInput) {
    const data: Prisma.TaskUncheckedCreateInput = {
      ...input,
      status: TaskStatus.PENDING,
    };

    return this.prisma.task.create({
      data,
    });
  }

  markRunning(taskId: number) {
    return this.prisma.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.RUNNING, startedAt: new Date() },
    });
  }

  markSuccess(taskId: number, resultPayload?: Prisma.InputJsonValue) {
    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.SUCCESS,
        resultPayload: resultPayload ?? Prisma.JsonNull,
        finishedAt: new Date(),
      },
    });
  }

  markFailed(taskId: number, errorMessage: string, resultPayload?: Prisma.InputJsonValue) {
    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.FAILED,
        errorMessage,
        resultPayload: resultPayload ?? Prisma.JsonNull,
        finishedAt: new Date(),
      },
    });
  }

  markPartialFailed(taskId: number, resultPayload: Prisma.InputJsonValue) {
    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.PARTIAL_FAILED,
        resultPayload,
        finishedAt: new Date(),
      },
    });
  }
}
