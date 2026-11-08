// Единый формат ошибки API — зеркалит backend/internal/api/response.go:
// {error: string, message: string, field?: string}.

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export const ValidationError = (field: string, message: string) =>
  new AppError(422, "validation_error", message, field);
export const NotFoundError = () =>
  new AppError(404, "not_found", "ресурс не найден");
export const ConflictError = () =>
  new AppError(409, "conflict", "конфликт данных");
export const VersionMismatchError = () =>
  new AppError(409, "version_mismatch", "объект изменён другим пользователем, обновите версию");
export const PreconditionError = () =>
  new AppError(412, "precondition_failed", "операция недопустима");
export const ForbiddenError = () =>
  new AppError(403, "forbidden", "недостаточно прав");
export const UnauthorizedError = () =>
  new AppError(401, "unauthorized", "требуется вход");

export function errorHandler(err: unknown): Response {
  if (err instanceof AppError) {
    const body: Record<string, unknown> = {
      error: err.code,
      message: err.message,
    };
    if (err.field) body.field = err.field;
    return Response.json(body, { status: err.status });
  }
  return Response.json(
    { error: "internal_error", message: "внутренняя ошибка сервера" },
    { status: 500 },
  );
}
