# dsh-multikey-provider

`dsh-multikey-provider` 是一个独立的 DeepSeek Harness（DSH）插件，为已安装的
Provider 增加多 API Key 管理和按策略切换能力。

插件不读取 DSH Harness checkout，也不修改官方 Provider 包。官方
`@deepseek-ai/dsh-llm-pi-ai` 继续安装并保持 active；插件只插入自己的
`multikey-provider` entry，注册自己的 pool routes 和配置 namespace。

## 能力

- 在一个 pool route 下配置 primary key 和多个备用 key。
- `priority`：优先使用数字更小的 priority 层；同一优先级内按 `weight` 分配。
- `weighted`：所有可用 key 按 `weight` 分配。
- 在业务输出开始前，对明确的账号/凭据类失败依次尝试下一个 key。
- `401`、`403` 等认证失败会立即进入 1 小时冷却；冷却结束后必须 probe 成功才重新进入候选池。
- quota 和 rate-limit 按会话记录；普通请求、模型、上下文、服务端、超时和传输错误不会触发多 Key 切换。
- Web Models 页面沿用官方布局；多 Key 控件只出现在已配置 pool provider 的现有 `ProviderEditor` 中。
- 通过 loopback control 暴露脱敏 health view 和单 Key probe；Key 的真实值不进入 settings、metadata 或业务 payload。

### 官方体验保持不变

- 未配置的 Provider 不出现在已配置列表，只出现在官方 `Add provider` 选择器。
- 添加并保存 Provider 后，列表行仍使用官方布局。
- 打开已配置的 pool Provider 编辑器后，才显示 `Additional API Keys` 和 pool policy。
- 不新增 Models 页面、导航项、Plugins 专用编辑器或 `multikey/*` route。
- 官方 Provider 的 route、model、discovery、单 Key 配置仍由官方 entry 管理。

## 安装

插件需要安装到目标 DSH Profile。推荐使用构建后的 tarball：

```sh
cd dsh-multikey-provider
pnpm install --frozen-lockfile
pnpm run check
pnpm pack
dsh plugin --profile web add ./dsh-multikey-provider-0.1.7.tgz
```

开发时也可以直接安装当前目录：

```sh
dsh plugin --profile web add ./dsh-multikey-provider
```

Headless Profile：

```sh
dsh plugin --profile headless add ./dsh-multikey-provider-0.1.7.tgz
```

安装后检查插件 entry：

```sh
dsh --profile web --dump-config
dsh --profile headless --dump-config
```

通用 bundle 只插入插件 entry：

```yaml
- insert:
    - id: multikey-provider
      name: dsh-multikey-provider
```

Web Profile 需要在自己的 overlay 中禁用官方 Models entry，让插件接管同一个
`settings.section:models` owner：

```yaml
- id: ui-settings-models
  name: '@deepseek-ai/dsh-client-ui-settings-models'
  disabled: true
```

这条 Web-only overlay 不应放进通用 bundle。Headless 没有 Models entry，只安装
插件 entry，不应产生 absent-target warning。没有修改 `llm-pi-ai` 的 patch；
官方 Provider entry 继续 active。

## 配置

配置写入插件自己的 namespace：

```yaml
multikey-provider:
  providers:
    <pool-route>:
      sourceProvider: <official-provider-route>
      displayName: <显示名称>
      apiKeyEnv: <PRIMARY_REF>
      apiKeyPool:
        mode: priority
        primary:
          enabled: true
          priority: 0
          weight: 1
        keys:
          - id: backup-1
            credentialRef: <BACKUP_REF_1>
            enabled: true
            priority: 1
            weight: 1
          - id: backup-2
            credentialRef: <BACKUP_REF_2>
            enabled: true
            priority: 1
            weight: 2
        maxAttempts: 3
        health:
          failureThreshold: 3
          openCircuitMs: 60000
```

`<PRIMARY_REF>` 和 `<BACKUP_REF_*>` 是 credential reference，例如环境变量名，
不是 API Key 明文。真实凭据通过 DSH Credentials 服务保存或解析。

不要把 `apiKeyPool` 写入官方 `llm-pi-ai` namespace。官方 Provider 的单 Key
配置与插件的 pool 配置是两个明确的 owner：

```yaml
llm-pi-ai:
  providers:
    <official-route>:
      apiKeyEnv: <OFFICIAL_REF>

multikey-provider:
  providers:
    <pool-route>:
      sourceProvider: <official-route>
      apiKeyEnv: <PRIMARY_REF>
      apiKeyPool:
        # ...
```

### Provider 字段

| 字段 | 作用 |
| --- | --- |
| `sourceProvider` | 继承已安装 catalog Provider 的 endpoint、协议和 model catalog；默认使用 pool route 名称 |
| `apiKeyEnv` | primary credential reference；启用 `apiKeyPool` 时必填 |
| `displayName` | Models 页面显示名称 |
| `api` / `baseURL` / `models` | 自定义 endpoint 时使用；catalog route 可直接继承官方定义 |
| `modelOverrides` | 对继承的单个 model 做局部覆盖 |

自定义 endpoint 需要自己提供协议、地址和 model catalog，例如：

```yaml
multikey-provider:
  providers:
    <custom-pool-route>:
      displayName: <Custom Provider>
      api: openai-completions
      baseURL: https://example.invalid/v1
      models:
        - id: <model-id>
          name: <Model Name>
          contextWindow: 262144
          maxTokens: 32768
      apiKeyEnv: <PRIMARY_REF>
      apiKeyPool:
        mode: weighted
        keys:
          - id: backup-1
            credentialRef: <BACKUP_REF_1>
            weight: 2
```

### Pool 字段

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `mode` | `priority` | `priority` 先选最低数字的 priority 层；`weighted` 在全体候选中按 weight 分配 |
| `primary.enabled` | `true` | 是否允许 primary 进入候选 |
| `primary.priority` | `0` | primary 的优先级 |
| `primary.weight` | `1` | primary 的权重 |
| `keys[].id` | 必填 | 备用 key 的稳定 ID，只允许小写字母、数字和连字符 |
| `keys[].credentialRef` | 必填 | 备用 key 的 credential reference |
| `keys[].priority` | `index + 1` | 备用 key 的优先级 |
| `keys[].weight` | `1` | 备用 key 的权重 |
| `maxAttempts` | 启用 key 数量 | 一次请求最多尝试的 key 数 |
| `health.failureThreshold` | `3` | 非认证的可切换失败达到该次数后打开 circuit；quota/rate-limit 状态按会话隔离 |
| `health.openCircuitMs` | `60000` | 普通 circuit 的打开时长；认证失败固定使用 1 小时冷却 |

### 选择和切换

每次请求都从当前健康候选中选择 key：

1. `priority` 模式先选 priority 数字最小的一层，再在该层按 weight 选择。
2. `weighted` 模式忽略 priority，在所有候选中按 weight 选择。
3. 当前 key 只有在尚未产生业务内容时遇到以下分类才会切换：
   `AUTH`、`QUOTA`、`RATE_LIMIT`、`MISSING_CREDENTIAL`、`INVALID_CREDENTIAL`。
4. 每次切换都会排除本次请求已尝试的 key，直到达到 `maxAttempts`。
5. 已产生文本或工具业务输出后，key 已提交，不再切换。
6. 所有候选都耗尽时显式返回原始失败，不转换为成功，也不静默 fallback。

认证失败包括 `401`、`403` 等明确的 AUTH/INVALID_CREDENTIAL 分类。此类 key
立即进入 1 小时冷却，冷却结束后仍保持 `probeRequired`，只有 probe 成功才回到
候选池。Probe 失败不会把 key 放回候选池。

## Web Models 使用

1. 打开 DSH Web 的 Models 设置。
2. 使用官方 `Add provider` 选择器添加对应的 pool route。
3. 保存后，pool route 会按官方 Provider 行显示。
4. 打开该已配置 Provider 的编辑器。
5. 在现有 ProviderEditor 内填写 `Additional API Keys`：
   - 选择 `priority` 或 `weighted`；
   - 设置 `maxAttempts` 和 health policy；
   - 添加备用 key 的 ID、credential reference、priority 和 weight；
   - 启用、禁用或删除备用 key；
   - 保存配置并对指定 key 执行 `Probe`。

备用 Key 的保存顺序与官方单 Key 保存一致：先写 provider settings，再写
credential store。若 settings 写入失败，不会写 credential；若 settings 已成功但
credential 写入失败，已保存的 key 会显示“凭据未保存”，按钮变为“重试”，重试只
补写 credential，不会重复写入 pool 配置。credential value 始终不会进入 settings
payload。

普通官方 Provider 行不显示多 Key 控件。多 Key 控件只由
`settingsNs === 'multikey-provider'` 的已配置 pool row 触发。

## Headless 控制

插件提供 loopback control endpoint：

```text
/multikey-provider
```

控制面只提供两类操作：

- `view`：读取脱敏的 key health projection；
- `probe`：对指定 route/key 执行一次精确 probe。

控制数据、切换状态、health 和 credential value 不会写入 `GenerateOptions`、
`StreamChunk`、请求 metadata、会话事件或 provider 业务 payload。

## 卸载和恢复官方 Provider

恢复官方 Provider 必须删除插件 bundle/patch 后重启 DSH，不能把 hot reload
当作恢复证据：

```sh
# 1. 从目标 Profile 删除 dsh-multikey-provider bundle 和 Web-only overlay
# 2. 用目标 Profile 的精确 service/PID 操作重启 DSH
dsh --profile web --dump-config
```

恢复后应确认：

- 官方 `llm-pi-ai` entry active；
- Web 的官方 `ui-settings-models` entry active；
- `multikey-provider` entry 消失；
- pool routes、插件 namespace 和插件 Models client 消失；
- 原官方 provider/model/settings 路径可以调用。

仓库内的恢复校验脚本只接受“移除 bundle + 精确重启 + 原路径重放”的证据：

```sh
node scripts/verify-restored-profile.mjs <restored-dump-config.yaml> <evidence.json>
```

## 开发和验证

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm pack
```

`pnpm run check` 包含：

- architecture / registry gate；
- TypeScript typecheck；
- ESLint；
- 59 项测试及 coverage；
- build；
- package content / secret / official runtime import 检查。

架构和实现文档：

- [Architecture implementation design](docs/architecture/implementation-architecture.md)
- [Detailed design](docs/architecture/detailed-design.md)
- [Test design](docs/architecture/test-design.md)
- [Review wiki](docs/wiki/index.md)
- [UI states and screenshots](docs/ui/README.md)
- [Architecture diagrams](docs/diagrams/README.md)
- [Upstream baseline](UPSTREAM.md)
