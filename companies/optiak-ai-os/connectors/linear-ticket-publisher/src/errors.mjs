export class PublisherError extends Error {
  constructor(code, { uncertain = false } = {}) {
    super(code);
    this.name = "PublisherError";
    this.code = code;
    this.uncertain = uncertain;
  }
}

export function errorCode(error, fallback = "internal_failure") {
  return error instanceof PublisherError ? error.code : fallback;
}
