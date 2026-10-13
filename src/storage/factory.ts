/**
 * 存储渠道工厂
 *
 * 契约与官方适配器均在 kit：
 * - s3 / coze 渠道统一由 S3ObjectStore 适配（渠道差异 = 凭证获取方式）：
 *   - s3：凭证取自 S3_ENDPOINT_URL / S3_BUCKET_NAME
 *   - coze：按平台注入行为运行（COZE_BUCKET_* 变量组）
 * - 业务注册渠道（2026-10-13 开放化）：经 registerStorageChannel 登记的工厂分派
 *   （kit 辅助定位：不约束业务；渠道选择不再迫使业务在 kit 之外重抄分支）
 * - env 可注入（默认 process.env），便于测试
 * - 组合根职责（统一约定）：校验 channel → 实例化 → init → 注册 disconnect 到进程退出钩子
 */

import { resolveStorageConfig } from "../config";
import { ObjectStoreConfigError } from "./errors";
import { S3ObjectStore } from "./s3";
import { getStorageChannelFactory } from "./registry";
import type { ObjectStore, ObjectStoreConfig } from "./types";

/**
 * 创建对象存储执行器（按 channel 分派：内置官方适配器 ∪ 业务注册渠道）
 *
 * @throws ObjectStoreConfigError 渠道对应凭证缺失 / 未注册时抛出（含诊断快照，
 *               见 config/resolveStorageConfig）
 */
export function createObjectStore(
  config: ObjectStoreConfig,
  env: Record<string, string | undefined> = process.env
): ObjectStore {
  if (config.channel === "none") {
    // none = 显式无存储声明：任何创建存储执行器的行为都是配置错误（fail-fast）
    throw new ObjectStoreConfigError(
      "[storage/factory] channel 为 none（显式无存储），不应创建存储执行器。" +
        "业务应选择非对象存储方案。"
    );
  }
  switch (config.channel) {
    case "s3":
      // 通用模式：额外获取连接凭证（S3_ENDPOINT_URL / S3_BUCKET_NAME）
      return new S3ObjectStore(resolveStorageConfig({ provider: "s3", env }));
    case "coze":
      // coze 模式：按平台注入行为运行（COZE_BUCKET_* 变量组）
      return new S3ObjectStore(resolveStorageConfig({ provider: "coze", env }));
    default: {
      // 业务注册渠道（开放注册表；未注册 → fail-fast，不静默降级）
      const factory = getStorageChannelFactory(config.channel);
      if (factory) return factory({ env });
      throw new ObjectStoreConfigError(
        `[storage/factory] 未分派且未注册的渠道: ${String(config.channel)}。` +
          "自定义渠道须先经 registerStorageChannel 登记。"
      );
    }
  }
}
