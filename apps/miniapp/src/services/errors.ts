export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (isErrMsgObject(error)) {
    return error.errMsg;
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return fallback;
}

function isErrMsgObject(error: unknown): error is { errMsg: string } {
  return Boolean(error && typeof error === "object" && "errMsg" in error && typeof (error as { errMsg?: unknown }).errMsg === "string");
}
