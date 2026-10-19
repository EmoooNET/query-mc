export type MCQueryErrorCode =
  | 'TIMEOUT'
  | 'CONNECTION_CLOSED'
  | 'NETWORK_ERROR'
  | 'PROTOCOL_ERROR';

/** 网络或协议错误；底层错误保留在 cause 中。 */
export class MCQueryError extends Error {
  override readonly name = 'MCQueryError';

  constructor(
    public readonly code: MCQueryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
