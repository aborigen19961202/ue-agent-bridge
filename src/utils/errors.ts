export type ErrorCode =
  | "CONFIG_ERROR"
  | "VALIDATION_ERROR"
  | "BACKEND_ERROR"
  | "NOT_IMPLEMENTED"
  | "NOT_SUPPORTED"
  | "UNSAFE_COMMAND"
  | "UNSAFE_MUTATION"
  | "HELPER_UNAVAILABLE"
  | "NOT_FOUND"
  | "NOT_WRITABLE"
  | "INVALID_VALUE"
  | "EDITOR_UNAVAILABLE"
  | "LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

export class BridgeError extends Error {
  public readonly code: ErrorCode;

  public constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof BridgeError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}
