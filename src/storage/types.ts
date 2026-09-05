/**
 * 对象存储抽象 — 核心类型定义
 *
 * 集群统一对象存储抽象形状（与 /db 的 SqlDb 契约同构）：
 * - key 即真理：调用方直接组织 storage key（如 "avatars/user123.jpg"），无字段映射层
 * - 渠道三值域：s3（通用 S3）/ coze（平台注入）/ none（显式无存储），渠道差异 = 连接凭证获取方式
 * - none 即显式无存储声明：任何存储操作（createObjectStore / resolveStorageConfig）
 *   对其 fail-fast 抛错，消费方应据此选择非对象存储方案，不做降级或空实现
 * - 生命周期：init/disconnect 钩子由组合根统一调度（继承 LifecycleAware）
 * - 契约内不声明 isAvailable：可用性 = 工厂创建时凭证解析 fail-fast（与 db 同构）
 */

import type { LifecycleAware } from "../core";

/** 存储渠道（值域统一；操作语义一致，仅连接凭证获取方式不同；none = 显式无存储声明） */
export type StorageChannel = "s3" | "coze" | "none";

/** 渠道配置：channel 显式必填，禁止自动嗅探与隐式默认 */
export interface ObjectStoreConfig {
  channel: StorageChannel;
}

/** 上传参数 */
export interface UploadParams {
  /** 文件二进制内容 */
  fileContent: Buffer;
  /** 逻辑文件名（即最终 storage key，建议按路径组织，如 "avatars/user123.jpg"） */
  fileName: string;
  /** MIME 类型 */
  contentType?: string;
}

/** 上传预签名 URL 参数 */
export interface GetUploadUrlOptions {
  /**
   * 目标存储 key（即最终落库的 key）。
   * 调用方负责组织目录前缀（如 "avatars/user123.jpg"）并保证唯一性，本契约不校验前缀。
   */
  key: string;
  /**
   * 固定 MIME 类型；签名时指定后，客户端 PUT 应携带一致值。
   * 注意：是否强制一致取决于对象存储实现——AWS S3 返回 403 拒绝，
   * 阿里云 OSS 不强制（实测不一致仍 200 通过）；需要强制 MIME 时由调用方校验。
   */
  contentType?: string;
  /** 有效期秒数；默认 300（写签名泄露代价高于读签名，短时效为安全默认值，可显式覆盖） */
  expireSeconds?: number;
}

/**
 * 对象存储执行器契约
 *
 * 领域真理 = storage key + 文件内容：
 * - upload 返回实际存储的 key（调用方应以返回值持久化引用，不做隐式改名）
 * - 渠道实现私有细节：
 *   - s3 模式实现需额外获取连接凭证（S3_ENDPOINT_URL / S3_BUCKET_NAME）
 *   - coze 模式实现按平台注入行为运行（COZE_BUCKET_* 变量组），不做自定义拼接
 * - 错误归一化：底层 SDK 错误统一包装为 ObjectStoreError 抛出
 */
export interface ObjectStore extends LifecycleAware {
  /**
   * 上传文件
   * 返回实际存储的 storage key（实现不做隐式改名，key 即 fileName）
   */
  upload(params: UploadParams): Promise<string>;

  /**
   * 根据 storage key 生成临时签名 URL
   * 禁止自行拼接 URL，必须使用 SDK 生成
   */
  getSignedUrl(key: string, expireSeconds?: number): Promise<string>;

  /**
   * 根据 storage key 生成「上传（PUT）」预签名 URL
   *
   * 语义：返回一个临时 URL，持有者可在有效期内以 PUT 方法向该 key 直写文件。
   * 对比 getSignedUrl（GET 读签名），本方法面向客户端直写场景。
   * 禁止自行拼接 URL，必须使用 SDK 生成。
   * 时效默认 300s：写签名独立安全默认（与 getSignedUrl 的 defaultExpireSeconds
   * 机制不同系有意为之，见 S3ObjectStore 实现）。
   */
  getUploadUrl(options: GetUploadUrlOptions): Promise<string>;

  /** 删除文件 */
  delete(key: string): Promise<boolean>;

  /** 检查文件是否存在 */
  exists(key: string): Promise<boolean>;
}
