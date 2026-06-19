export class ForkNeoError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ForkNeoError";
  }
}
