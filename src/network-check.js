const { lookup } = require('node:dns/promises')
const net = require('node:net')
const { readFile } = require('node:fs/promises')
const { parse } = require('dotenv')
const { panelDatabaseUrl, expectedIdentity } = require('./database-identity')

const keys = ['DATABASE_URL', 'PLATES_DATABASE_ID', 'PLATES_SUPABASE_PROJECT_REF']
const safeCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET', 'TIMEOUT'])
const safeCode = error => safeCodes.has(error?.code) ? error.code : 'NETWORK_FAILED'
const configCodes = new Set(['IDENTITY_REQUIRED', 'INVALID_DATABASE_URL', 'SHARED_DATABASE_BLOCKED', 'UNRECOGNIZED_DATABASE_HOST', 'PROJECT_REF_REQUIRED', 'WRONG_SUPABASE_PROJECT'])
async function readConfig(file) {
  try { return { found: true, values: parse(await readFile(file)) } }
  catch { return { found: false, values: {} } }
}

// URLs/passwords stay inside this function. Its return value is safe to print.
function inspectConnections(botFile, panelFile, environment = {}) {
  const overrides = Object.fromEntries(keys.map(key => [key, Object.hasOwn(environment, key) && environment[key] !== botFile.values[key]]))
  const bot = { ...botFile.values }
  for (const key of keys) if (Object.hasOwn(environment, key)) bot[key] = environment[key]
  const panel = panelFile.values
  const urls = {}, identities = {}, values = { bot, panel }, report = {}
  for (const name of ['bot', 'panel']) {
    const config = values[name], file = name === 'bot' ? botFile : panelFile
    if (!file.found) { report[name] = { found: false, valid: false, code: 'CONFIG_FILE_NOT_FOUND' }; continue }
    try {
      const url = new URL(panelDatabaseUrl(config.DATABASE_URL, config.PLATES_SUPABASE_PROJECT_REF))
      const identity = expectedIdentity(config.PLATES_DATABASE_ID)
      const username = decodeURIComponent(url.username), ref = config.PLATES_SUPABASE_PROJECT_REF
      const role = name === 'bot' ? 'placas_bot' : 'placas_app'
      const port = Number(url.port || '5432')
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT')
      urls[name] = url; identities[name] = identity
      report[name] = {
        found: true, valid: true, host: url.hostname, port,
        connectionType: url.hostname.includes('.pooler.supabase.com') ? port === 6543 ? 'transaction_pooler' : 'session_pooler' : url.hostname.endsWith('.supabase.co') ? 'direct_supabase' : 'local',
        expectedRole: username === role || username === `${role}.${ref}`,
        tlsRequired: url.searchParams.get('sslmode') === 'require',
      }
    } catch (error) { report[name] = { found: true, valid: false, code: configCodes.has(error.code) ? error.code : 'INVALID_CONFIG' } }
  }
  const comparison = urls.bot && urls.panel ? {
    sameHost: urls.bot.hostname === urls.panel.hostname,
    samePort: report.bot.port === report.panel.port,
    sameDatabase: urls.bot.pathname === urls.panel.pathname,
    sameProjectRef: bot.PLATES_SUPABASE_PROJECT_REF === panel.PLATES_SUPABASE_PROJECT_REF,
    sameIdentity: identities.bot === identities.panel,
    sameSslMode: urls.bot.searchParams.get('sslmode') === urls.panel.searchParams.get('sslmode'),
    samePoolerSetting: urls.bot.searchParams.get('pgbouncer') === urls.panel.searchParams.get('pgbouncer'),
  } : null
  return { ...report, comparison, environmentOverridesFile: overrides }
}

async function probeNetwork({ host, port }, timeoutMs = 5000) {
  host = host.replace(/^\[|\]$/g, '')
  let dnsTimer
  const dns = await Promise.race([
    lookup(host, { all: true }).then(rows => ({ ok: true, ipv4Available: rows.some(row => row.family === 4), ipv6Available: rows.some(row => row.family === 6) })).catch(error => ({ ok: false, code: safeCode(error) })),
    new Promise(resolve => { dnsTimer = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), timeoutMs) }),
  ]).finally(() => clearTimeout(dnsTimer))
  if (!dns.ok) return { dns, tcp: { ok: false, skipped: true } }
  const tcp = await new Promise(resolve => {
    let socket, timer, finished = false
    function finish(result) {
      if (finished) return
      finished = true; clearTimeout(timer)
      if (socket) socket.destroy()
      resolve(result)
    }
    timer = setTimeout(() => finish({ ok: false, code: 'TIMEOUT' }), timeoutMs)
    try {
      socket = net.createConnection({ host, port, autoSelectFamily: true })
      socket.once('connect', () => finish({ ok: true }))
      socket.once('error', error => finish({ ok: false, code: safeCode(error) }))
    } catch (error) { finish({ ok: false, code: safeCode(error) }) }
  })
  return { dns, tcp }
}

async function checkNetwork({ botFile, panelFile, environment = {}, probe = probeNetwork }) {
  const [bot, panel] = await Promise.all([readConfig(botFile), readConfig(panelFile)])
  const report = inspectConnections(bot, panel, environment)
  const cache = new Map()
  await Promise.all(['bot', 'panel'].map(async name => {
    const target = report[name]
    if (!target.valid) return
    const key = `${target.host}:${target.port}`
    if (!cache.has(key)) cache.set(key, probe({ host: target.host, port: target.port }))
    target.network = await cache.get(key)
  }))
  return {
    readOnly: true, databaseOpened: false, sqlExecuted: false, messagesSent: 0,
    ...report,
    note: 'TCP acessível não confirma autenticação, permissões ou saúde do pooler. Compare os destinos e depois repita db:check. Nenhum arquivo foi alterado.',
  }
}
module.exports = { inspectConnections, probeNetwork, checkNetwork }
