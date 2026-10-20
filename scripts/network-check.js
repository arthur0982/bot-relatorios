const path = require('node:path')
const os = require('node:os')
const { checkNetwork } = require('../src/network-check')

async function main() {
  const args = process.argv.slice(2)
  if (args.length && !(args.length === 2 && args[0] === '--panel-directory' && args[1])) throw new Error('INVALID_ARGUMENT')
  const panel = args[1] || path.join(process.env.USERPROFILE || os.homedir(), 'nfc-review-panel')
  console.log(JSON.stringify(await checkNetwork({ botFile: path.resolve(__dirname, '../.env'), panelFile: path.resolve(panel, '.env'), environment: process.env }), null, 2))
}
main().catch(() => {
  console.error(JSON.stringify({ ok: false, code: 'NETWORK_CHECK_FAILED', message: 'Confira a pasta do painel. Nenhum arquivo, senha ou banco foi alterado; nenhuma exceção privada foi impressa.' }))
  process.exitCode = 1
})
