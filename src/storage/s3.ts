/**
 * S3ObjectStore — s3 / coze 渠道适配器（kit 官方实现）
 *
 * 实现 ObjectStore 契约：
 * - upload 直传 PutObjectCommand（key 即 fileName，不做隐式改名）
 * - getSignedUrl 用 SDK presigner 生成签名 URL（禁止自行拼接）
 * - getUploadUrl 用同一 presigner 生成上传（PUT）签名 URL（客户端直写）
 * - delete / exists 对应 DeleteObjectCommand / HeadObjectCommand
 * - 错误归一化：底层 SDK 错误包装为 ObjectStoreError
 *
 * 渠道差异只体现在连接凭证获取方式（s3 → S3_* 变量；coze → COZE_BUCKET_* 变量组），
 * 本类不感知渠道差异，凭证由调用方经 resolveStorageConfig 解析后传入。
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ResolvedStorageConfig } from "../config/storage";
import { ObjectStoreError } from "./errors";
import type { ObjectStore, GetUploadUrlOptions, UploadParams } from "./types";

/** S3ObjectStore 构造选项 */
export interface S3ObjectStoreOptions {
  /** 注入 S3Client（单测用）；缺省按 ResolvedStorageConfig 内部创建 */
  client?: S3Client;
  /** 签名 URL 默认有效期秒（默认 86400） */
  defaultExpireSeconds?: number;
}

/** 判断是否为 S3 404（HeadObject 对不存在对象返回 HTTP 404） */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode === 404
  );
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly defaultExpireSeconds: number;

  constructor(config: ResolvedStorageConfig, options?: S3ObjectStoreOptions) {
    this.bucket = config.bucket;
    this.defaultExpireSeconds = options?.defaultExpireSeconds ?? 86400;
    this.client =
      options?.client ??
      new S3Client({
        endpoint: config.endpointUrl,
        // 兼容 MinIO / Coze 等非 AWS 原生端点：默认 path-style；
        // 阿里云 OSS 等要求 virtual-hosted 的服务通过 S3_FORCE_PATH_STYLE=false 关闭
        forcePathStyle: config.forcePathStyle,
        region: config.region,
        ...(config.credentials
          ? {
              credentials: {
                accessKeyId: config.credentials.accessKeyId,
                secretAccessKey: config.credentials.secretAccessKey,
              },
            }
          : {}),
      });
  }

  async upload(params: UploadParams): Promise<string> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: params.fileName,
          Body: params.fileContent,
          ContentType: params.contentType,
        })
      );
      return params.fileName;
    } catch (err) {
      throw new ObjectStoreError("对象存储上传失败", { cause: err });
    }
  }

  async getSignedUrl(key: string, expireSeconds?: number): Promise<string> {
    try {
      return await awsGetSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn: expireSeconds ?? this.defaultExpireSeconds }
      );
    } catch (err) {
      throw new ObjectStoreError("对象存储签名 URL 生成失败", { cause: err });
    }
  }

  async getUploadUrl(options: GetUploadUrlOptions): Promise<string> {
    try {
      return await awsGetSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: options.key,
          ...(options.contentType ? { ContentType: options.contentType } : {}),
        }),
        // 写签名默认 300s：泄露代价高于读签名，独立安全默认（有意不走 defaultExpireSeconds）
        { expiresIn: options.expireSeconds ?? 300 }
      );
    } catch (err) {
      throw new ObjectStoreError("对象存储上传签名 URL 生成失败", { cause: err });
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
      );
      // DeleteObject 幂等：对象不存在也视为删除成功
      return true;
    } catch (err) {
      throw new ObjectStoreError("对象存储删除失败", { cause: err });
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) {
        return false;
      }
      throw new ObjectStoreError("对象存储存在性检查失败", { cause: err });
    }
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
  }
}
