// Only static messages and allowlisted codes leave this diagnostic. Never log
// Prisma exception text: it can contain connection strings, queries or passwords.
const messages = {
  IDENTITY_REQUIRED: 'Confira PLATES_DATABASE_ID: use o mesmo UUID do painel.',
  INVALID_DATABASE_URL: 'Confira a conexão PostgreSQL privada do bot.',
  SHARED_DATABASE_BLOCKED: 'O projeto antigo compartilhado está bloqueado. Use o novo projeto exclusivo.',
  UNRECOGNIZED_DATABASE_HOST: 'Use a conexão direta ou o pooler oficial do novo Supabase.',
  PROJECT_REF_REQUIRED: 'Configure PLATES_SUPABASE_PROJECT_REF com o ID público do novo projeto.',
  WRONG_SUPABASE_PROJECT: 'A conexão e o ID configurado apontam para projetos diferentes.',
  WRONG_DATABASE: 'A identidade gravada no banco não corresponde ao UUID configurado no bot.',
  SCHEMA_NOT_PREPARED: 'Uma tabela necessária não foi encontrada. Confira o banco da conexão; não execute reset ou db push.',
  DATABASE_AUTH_FAILED: 'O banco recusou a autenticação. Confira o usuário placas_bot e a senha própria dessa role; não use a senha do login nem a senha de placas_app.',
  DATABASE_UNREACHABLE: 'Não foi possível alcançar o banco. Confira host, porta e disponibilidade do novo Supabase.',
  DATABASE_CONNECTION_TIMEOUT: 'A conexão com o banco excedeu o prazo. Confira a rede e o pooler.',
  DATABASE_TLS_FAILED: 'A conexão segura com o banco falhou. Confira a configuração TLS recomendada pelo Supabase.',
  DATABASE_PERMISSION_DENIED: 'A role conectou, mas não tem permissão para a consulta. Confira as concessões de placas_bot no projeto correto.',
  DATABASE_CONNECTION_FAILED: 'A conexão com o banco foi interrompida. Confira a rede e o pooler.',
  PRISMA_INSTALL_REQUIRED: 'O cliente ou motor Prisma não está disponível. Execute npm ci com os scripts aprovados e npm run db:generate antes de repetir.',
  BOT_DATABASE_CHECK_FAILED: 'A conferência do banco falhou. Informe somente a etapa e os códigos deste relatório.',
}
const stages = ['client_initialization', 'identity_query', 'operational_reads']
function databaseFailure(error, stage = 'identity_query') {
  const candidates = [error?.code, error?.errorCode, error?.details?.prismaCode]
  const prismaCode = candidates.find(code => typeof code === 'string' && /^P\d{4}$/.test(code))
  const sqlCandidate = error?.meta?.code || error?.details?.sqlState
  const sqlState = typeof sqlCandidate === 'string' && /^[0-9A-Z]{5}$/.test(sqlCandidate) ? sqlCandidate : undefined
  let code = Object.hasOwn(messages, error?.code) ? error.code : undefined
  if (!code) {
    if (prismaCode === 'P1000' || ['28000', '28P01'].includes(sqlState)) code = 'DATABASE_AUTH_FAILED'
    else if (prismaCode === 'P1001') code = 'DATABASE_UNREACHABLE'
    else if (['P1002', 'P1008', 'P2024'].includes(prismaCode)) code = 'DATABASE_CONNECTION_TIMEOUT'
    else if (prismaCode === 'P1011') code = 'DATABASE_TLS_FAILED'
    else if (prismaCode === 'P1010' || sqlState === '42501') code = 'DATABASE_PERMISSION_DENIED'
    else if (prismaCode === 'P1017' || ['08000', '08003', '08006'].includes(sqlState)) code = 'DATABASE_CONNECTION_FAILED'
    else if (prismaCode === 'P2021' || ['42P01', '3F000'].includes(sqlState)) code = 'SCHEMA_NOT_PREPARED'
    // Prisma can omit errorCode on an InitializationError. Recognize only
    // standard failure descriptions internally; never return the original text.
    else if (/authentication failed|tenant or user not found/i.test(error?.message || '')) code = 'DATABASE_AUTH_FAILED'
    else if (/can't reach database server/i.test(error?.message || '')) code = 'DATABASE_UNREACHABLE'
    else if (error?.code === 'MODULE_NOT_FOUND' || /@prisma\/client did not initialize|run prisma generate|could not locate.*query engine|unable to require.*(?:query_engine|libquery_engine)/i.test(error?.message || '')) code = 'PRISMA_INSTALL_REQUIRED'
    else code = 'BOT_DATABASE_CHECK_FAILED'
  }
  const actualStage = stages.includes(error?.details?.stage) ? error.details.stage : stages.includes(stage) ? stage : 'identity_query'
  return { ok: false, code, message: messages[code], details: { stage: actualStage, prismaCode, sqlState }, whatsappStarted: false, messagesSent: 0, writes: false }
}
module.exports = { databaseFailure }
