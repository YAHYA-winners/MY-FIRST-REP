export class AppError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export function notFound(what = "Élément"): AppError {
  return new AppError(`${what} introuvable.`, 404);
}

export function assertFound<T>(value: T | null | undefined, what = "Élément"): T {
  if (value === null || value === undefined) throw notFound(what);
  return value;
}
