// Policy mirrored from gerenciadorplacas; keep target checks aligned.
const DATABASE_APPLICATION = 'gerenciadorplacas'
const DATABASE_SCHEMA = 'placas'
// This project previously held unrelated CRM tables. Never reconnect this panel
// to it, even if an old .env or deploy setting is copied into the new setup.
const RETIRED_SHARED_PROJECT = 'ejzuxtvrdtpxtpdewviu'
const { databaseFailure } = require('./database-errors')

class PanelDatabaseError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PanelDatabaseError'
    this.code = code
  }
}

function expectedIdentity(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || ''))
    throw new PanelDatabaseError('IDENTITY_REQUIRED', 'Configure PLATES_DATABASE_ID com a identidade exclusiva do banco das placas. Nenhuma tabela foi criada automaticamente.')
  return value.toLowerCase()
}

function panelDatabaseUrl(value, projectRef = process.env.PLATES_SUPABASE_PROJECT_REF) {
  let url
  try { url = new URL(value) } catch {
    throw new PanelDatabaseError('INVALID_DATABASE_URL', 'Configure uma conexão PostgreSQL do painel.')
  }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/')
    throw new PanelDatabaseError('INVALID_DATABASE_URL', 'Este painel exige PostgreSQL. Não use o SQLite do CRM.')
  const host = url.hostname.toLowerCase()
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(host)
  if (!local) {
    const direct = /^db\.([a-z]{20})\.supabase\.co$/.exec(host)
    const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)
    let username
    try { username = decodeURIComponent(url.username) } catch {
      throw new PanelDatabaseError('INVALID_DATABASE_URL', 'Usuário da conexão inválido.')
    }
    const actualRef = direct?.[1] || (pooler ? /\.([a-z]{20})$/.exec(username)?.[1] : undefined)
    if (actualRef === RETIRED_SHARED_PROJECT || projectRef === RETIRED_SHARED_PROJECT)
      throw new PanelDatabaseError('SHARED_DATABASE_BLOCKED', 'O antigo projeto compartilhado foi bloqueado. Crie um projeto Supabase exclusivo para as placas.')
    if (!actualRef)
      throw new PanelDatabaseError('UNRECOGNIZED_DATABASE_HOST', 'Use a conexão direta ou o pooler oficial do novo Supabase exclusivo. Conexão remota não reconhecida foi bloqueada.')
    if (!/^[a-z]{20}$/.test(projectRef || ''))
      throw new PanelDatabaseError('PROJECT_REF_REQUIRED', 'Configure PLATES_SUPABASE_PROJECT_REF com o ID público do novo projeto exclusivo das placas.')
    if (actualRef !== projectRef)
      throw new PanelDatabaseError('WRONG_SUPABASE_PROJECT', 'A conexão não pertence ao projeto exclusivo configurado. Nenhuma conexão foi aberta.')
  }
  url.searchParams.set('schema', DATABASE_SCHEMA)
  return url.toString()
}

async function checkDatabaseIdentity(client, value) {
  const expected = expectedIdentity(value)
  let rows
  try {
    rows = await client.$queryRawUnsafe('SELECT id, application, "instanceId" FROM "placas"."PanelDatabaseIdentity"')
  } catch (error) {
    const safe = databaseFailure(error, 'identity_query')
    const failure = new PanelDatabaseError(safe.code, safe.message)
    failure.details = safe.details
    throw failure
  }
  if (rows.length !== 1 || rows[0].id !== 1 || rows[0].application !== DATABASE_APPLICATION || rows[0].instanceId !== expected)
    throw new PanelDatabaseError('WRONG_DATABASE', 'A identidade deste banco não corresponde ao painel. A operação foi bloqueada.')
}

module.exports = { DATABASE_APPLICATION, DATABASE_SCHEMA, RETIRED_SHARED_PROJECT, PanelDatabaseError, expectedIdentity, panelDatabaseUrl, checkDatabaseIdentity }
