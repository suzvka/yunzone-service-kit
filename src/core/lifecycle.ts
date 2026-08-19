/**
 * 生命周期钩子形状（共享原语）
 *
 * 声明资源的创建/释放钩子，由组合根统一调度：
 * - init()      在首次使用前调用（连接、预热）
 * - disconnect() 进程退出前调用（释放连接、优雅关闭）
 *
 * 与 registry 的 isAvailable（健康检查）并列而非合并：
 * 生命周期属于"资源所有权"，健康检查属于"可用性路由"。
 */

export interface LifecycleAware {
  /** 初始化资源（组合根调用；未实现表示无需初始化） */
  init?(): Promise<void>;
  /** 释放资源（组合根调用；未实现表示无资源需要释放） */
  disconnect?(): Promise<void>;
}