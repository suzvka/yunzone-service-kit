/**
 * 存储渠道工厂
 *
 * 契约与官方适配器均在 kit：
 * - s3 / coze 渠道统一由 S3ObjectStore 适配（渠道差异 = 凭证获取方式）：
 *   - s3：凭证取自 S3_ENDPOINT_URL / S3_BUCKET_NAME
 *   - coze：按平台注入行为运行（COZE_BUCKET_* 变量组）
 * - env 可注入（默认 process.env），便于测试
 * - 组合根职责（统一约定）：校验 channel → 实例化 → init → 注册 disconnect 到进程退出钩子
 */

import { resolveStorageConfig } from "../config";
import { ObjectStoreConfigError } from "./errors";
import { S3ObjectStore } from "./s3";
import type { ObjectStore, ObjectStoreConfig } from "./types";

/**
 * 创建对象存储执行器（按 channel 分派凭证获取方式）
 *
 * @throws ObjectStoreConfigError 渠道对应凭证缺失时抛出（含诊断快照，见 config/resolveStorageConfig）
 */
export function createObjectStore(
  config: ObjectStoreConfig,
  env: Record<string, string | undefined> = process.env
): ObjectStore {
  switch (config.channel) {
    case "s3":
      // 通用模式：额外获取连接凭证（S3_ENDPOINT_URL / S3_BUCKET_NAME）
      return new S3ObjectStore(resolveStorageConfig({ provider: "s3", env }));
    case "coze":
      // coze 模式：按平台注入行为运行（COZE_BUCKET_* 变量组）
      return new S3ObjectStore(resolveStorageConfig({ provider: "coze", env }));
    case "none":
      // none = 显式无存储声明：任何创建存储执行器的行为都是配置错误（fail-fast）
      throw new ObjectStoreConfigError(
        "[storage/factory] channel 为 none（显式无存储），不应创建存储执行器。" +
          "业务应选择非对象存储方案。"
      );
    default: {
      // 编译期穷尽性守卫：新增渠道未在此分派即编译失败（运行期不可达）
      const exhaustive: never = config.channel;
      throw new ObjectStoreConfigError(
        `[storage/factory] 未分派的渠道: ${String(exhaustive)}`
      );
    }
  }
}
