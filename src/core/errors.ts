/**
 * 共享错误基类
 *
 * 集群内所有领域错误（存储、配置、运维等）的统一基类。
 * 提供 code / cause / toJSON，便于跨服务传输与日志聚合。
 *
 * 使用方式：
 * ```ts
 * class StorageError extends KitError {}
 * throw new StorageError("...", { cause, code: "STORAGE_DOWN" });
 * ```
 */

/** KitError 构造参数 */
export interface KitErrorOptions {
  /** 机器可读错误码（默认取类名） */
  code?: string;
  /** 根因（原始 Error） */
  cause?: unknown;
}

export class KitError extends Error {
  /** 机器可读错误码 */
  readonly code: string;

  constructor(message: string, options?: KitErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options?.code ?? this.name;
    if (options?.cause !== undefined && (this as { cause?: unknown }).cause === undefined) {
      // ES2022 以下运行时兜底：显式挂载 cause
      Object.defineProperty(this, "cause", { value: options.cause, enumerable: false });
    }
  }

  /** 序列化为可结构化日志的纯对象（不泄露堆栈） */
  toJSON(): { name: string; code: string; message: string; cause?: unknown } {
    const json: { name: string; code: string; message: string; cause?: unknown } = {
      name: this.name,
      code: this.code,
      message: this.message,
    };
    if (this.cause !== undefined) {
      json.cause = this.cause instanceof Error ? this.cause.message : this.cause;
    }
    return json;
  }
}