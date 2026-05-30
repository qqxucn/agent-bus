/**
 * claw-bus OpenClaw 集成层 — 运行时设置。
 *
 * 提供 setup 入口，在 OpenClaw 设置阶段配置总线连接参数。
 */

/**
 * setup-entry：轻量级设置入口。
 * 当用户执行 openclaw channels add --channel claw-bus 时触发。
 */
export async function setupClawBus(): Promise<void> {
  // TODO: 当 OpenClaw 支持 channel 设置向导时，补充交互式配置步骤
  console.log('[claw-bus] 请通过 openclaw.json 配置 channels.claw-bus 节点');
  console.log('[claw-bus] 必填字段: busUrl, busToken');
  console.log('[claw-bus] 选填字段: busWsUrl, agentId, mode 等');
}
