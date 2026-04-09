type ExternalApiErrorParams = {
  provider: string;
  operation: string;
  message: string;
  retryable: boolean;
  statusCode?: number;
  code?: string;
  cause?: unknown;
};

export class ExternalApiError extends Error {
  readonly provider: string;
  readonly operation: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly code?: string;
  override readonly cause?: unknown;

  constructor(params: ExternalApiErrorParams) {
    super(params.message);
    this.name = ExternalApiError.name;
    this.provider = params.provider;
    this.operation = params.operation;
    this.retryable = params.retryable;
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.cause = params.cause;
  }

  static fromUnknown(provider: string, operation: string, error: unknown): ExternalApiError {
    if (error instanceof ExternalApiError) {
      return error;
    }

    const axiosLike = error as {
      message?: string;
      code?: string;
      response?: { status?: number; data?: { message?: string } };
    };

    const statusCode = axiosLike.response?.status;
    const message =
      axiosLike.response?.data?.message ??
      axiosLike.message ??
      `External call failed: ${provider}.${operation}`;

    const retryable = ExternalApiError.isRetryable(statusCode, axiosLike.code);

    return new ExternalApiError({
      provider,
      operation,
      message,
      retryable,
      statusCode,
      code: axiosLike.code,
      cause: error,
    });
  }

  private static isRetryable(statusCode?: number, code?: string): boolean {
    if (typeof statusCode === 'number') {
      return statusCode === 408 || statusCode === 429 || statusCode >= 500;
    }

    const retryableCodes = new Set([
      'ECONNABORTED',
      'ECONNREFUSED',
      'ECONNRESET',
      'EAI_AGAIN',
      'ENETDOWN',
      'ENETUNREACH',
      'ETIMEDOUT',
    ]);

    return Boolean(code && retryableCodes.has(code));
  }
}
