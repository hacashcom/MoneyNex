// test/ui/envboot.mjs — 让 `node test/ui/*.mjs` 无需先 source env.sh：
// 未检测到沙盒环境变量时，通过 bash source test/ui/env.sh 后重_exec 自身。
// 必须作为第一条 import（静态 import 按序执行，lib.mjs 顶层就要读 ext-ids.json）。
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.env.MNX_IDS_FILE && !process.env.MNX_ENV_BOOTED) {
  const __dir = path.dirname(fileURLToPath(import.meta.url))
  const argv = [path.resolve(process.argv[1]), ...process.argv.slice(2)]
    .map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(' ')
  const r = spawnSync('bash', ['-c',
    `source '${__dir}/env.sh' >/dev/null 2>&1; export MNX_ENV_BOOTED=1; exec node ${argv}`,
  ], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
