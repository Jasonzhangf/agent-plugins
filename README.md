# DSH Plugins

DeepSeek Harness（DSH）的独立插件集合。插件在本仓库外开发，通过已安装的 DSH Profile 加载，不修改 `deepseek-harness` 源码。

## 插件

| 插件 | 说明 | 文档 |
| --- | --- | --- |
| `dsh-concurrency-limit` | 限制会话内模型请求和进程级工具调用并发，可从 Web 界面调整会话请求上限 | [`dsh-concurrency-limit/README.md`](dsh-concurrency-limit/README.md) |
| `dsh-multikey-provider` | 为 OpenAI-compatible Provider 增加多 API Key、priority/weighted 选择、失败切换、冷却和 probe | [`dsh-multikey-provider/README.md`](dsh-multikey-provider/README.md) |

## 通用开发流程

每个插件都是独立的 pnpm 项目，在对应插件目录执行：

```sh
pnpm install --frozen-lockfile
pnpm run check
```

构建 tarball：

```sh
pnpm pack
```

安装和运行方式、Profile patch、配置字段及恢复流程以各插件自己的 README 为准。

## 目录

- [`dsh-concurrency-limit/`](dsh-concurrency-limit/)：并发限制插件
- [`dsh-multikey-provider/`](dsh-multikey-provider/)：多 Key Provider 插件
- [`deepseek-harness/`](deepseek-harness/)：上游 DSH 参考 checkout，不是本仓库插件的运行时依赖
