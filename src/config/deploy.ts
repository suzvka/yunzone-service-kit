/**
 * 部署环境适配层（TICKET-001：配置键命名中立化）
 *
 * 集群统一约定（三层命名空间模型）：
 * - 通用契约键一律中立命名（DEPLOY_ENV / PROJECT_DOMAIN_DEFAULT / ...），
 *   平台差异通过 DEPLOY_PROVIDER 分派键值表达；
 * - 平台注入变量名（Coze 侧 COZE_*、PG*）不可改名，由本适配层在
 *   **读取时**回退映射到中立键（不写 process.env，避免全局副作用）；
 * - 服务代码禁止裸读平台注入变量，必须经中立键（通用契约）
 *   或自有 schema 显式声明（项目私有层）接入。
 *
 * 双通道覆盖：
 * - loadEnv 路径：消费端传 `deploymentAliases` 常量（见 LoadEnvOptions.aliases）；
 * - 解析器路径：resolveBaseUrl / resolveListenAddress / /ops 报告内部调用
 *   `normalizeDeployEnv` 后读取中立键。
 */

import { applyAliases } from "./env";

/**
 * 部署平台（DEPLOY_PROVIDER 取值；缺省 self 通用模式，不默认绑定任一平台；
 * Coze 部署必须显式设置 coze 以启用平台注入回退，vercel/render 等预留扩展点）
 */
export type DeployProviderKind = "coze" | "self";

const SUPPORTED_PROVIDERS: DeployProviderKind[] = ["coze", "self"];

/**
 * 平台注入适配别名：中立键 → 平台注入旧名列表（供 loadEnv 的 aliases 选项）。
 * 永久机制：平台注入变量名不可改名，适配层在读取时回退映射（不写 process.env）。
 * 仅当中立键未设置时回退读取旧名；诊断快照只列规范名。
 */
export const deploymentAliases: Record<string, string[]> = {
  DEPLOY_ENV: ["COZE_PROJECT_ENV"],
  PROJECT_DOMAIN_DEFAULT: ["COZE_PROJECT_DOMAIN_DEFAULT"],
  WORKSPACE_PATH: ["COZE_WORKSPACE_PATH"],
  PORT: ["DEPLOY_RUN_PORT"],
};

/** normalizeDeployEnv 参数 */
export interface NormalizeDeployEnvOptions {
  /** 显式指定部署平台；默认读取 env.DEPLOY_PROVIDER，未设置则回退 self（通用模式） */
  provider?: DeployProviderKind;
}

let warnedMissingProvider = false;

/** 输出一次缺省 provider 警告（防平台切换或被忽略的平台注入，不改变行为） */
function warnDefaultProvider(): void {
  if (warnedMissingProvider) return;
  warnedMissingProvider = true;
  console.warn(
    "[service-kit/config] DEPLOY_PROVIDER is not set, defaulting to \"self\" " +
      "(通用模式：中立键直读，不启用平台注入回退；Coze 部署请显式设置 DEPLOY_PROVIDER=coze)"
  );
}

/**
 * 将平台注入环境变量按 DEPLOY_PROVIDER 分派映射到中立键（读取时映射，返回拷贝）。
 *
 * - self（默认）：无平台注入，中立键直读（通用模式，不默认绑定任一平台）；
 * - coze（显式设置）：中立键未设置时回退读取 Coze 注入旧名（COZE_* / DEPLOY_RUN_PORT）；
 * - 未知 provider 抛错（未落地的平台显式报错，不静默回退）。
 *
 * 不修改 process.env（与 applyAliases 的既有哲学一致）。
 */
export function normalizeDeployEnv(
  env: Record<string, string | undefined>,
  options?: NormalizeDeployEnvOptions
): Record<string, string | undefined> {
  const provider =
    options?.provider ?? ((env.DEPLOY_PROVIDER || "self") as DeployProviderKind);

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(
      `[service-kit/config] normalizeDeployEnv: unknown DEPLOY_PROVIDER "${provider}". ` +
        `Supported: ${SUPPORTED_PROVIDERS.join(", ")}. ` +
        `(vercel/render 等平台适配未落地，见 TICKET-001)`
    );
  }

  if (options?.provider === undefined && env.DEPLOY_PROVIDER === undefined) {
    warnDefaultProvider();
  }

  if (provider === "coze") {
    return applyAliases(env, deploymentAliases);
  }
  return { ...env };
}
