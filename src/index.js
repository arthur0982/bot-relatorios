require('dotenv').config({ quiet: true })

const cron = require('node-cron')
const { prisma, checkDatabase, disconnectDatabase } = require('./db')
const { formatarDataHora, inicioDoDiaBrasilia, inicioJanelaAvaliacoes } = require('./janela')
const { abrirNavegador, coletarAvaliacoes } = require('./scraper')
const { gerarRelatorio, montarMensagem } = require('./relatorio')
const { criarWhatsapp, enviarMensagem, normalizarTelefone } = require('./whatsapp')

const TEMPO_LIMITE_LEITURA = 4 * 60 * 1000
const RECICLAR_NAVEGADOR_A_CADA = 15

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pausaEntreEnvios() {
  return esperar(8000 + Math.floor(Math.random() * 7000))
}

function comTempoLimite(promessa, ms, mensagem) {
  let timer
  return Promise.race([
    promessa,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(mensagem)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

function exigirAmbiente() {
  if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL no arquivo .env.')
  if (process.env.USAR_GEMINI === 'true' && !process.env.GEMINI_API_KEY) {
    throw new Error('Defina GEMINI_API_KEY no arquivo .env ou desligue o Gemini com USAR_GEMINI="false".')
  }
}

async function registrar(placaId, status, resumo, erro) {
  try {
    await prisma.botLog.create({
      data: {
        placaId,
        status,
        resumo: resumo || 'Envio não realizado.',
        erro: erro ? String(erro).slice(0, 4000) : null,
      },
    })
  } catch (falha) {
    console.error(`  Não foi possível gravar o histórico da placa ${placaId}:`, falha instanceof Error ? falha.message : falha)
  }
}

function nomeDaPlaca(placa) {
  return placa.nomeEmpresa || placa.contrato?.nomeEmpresa || placa.codigo || placa.id
}

function agruparPlacas(placas) {
  const grupos = new Map()
  for (const placa of placas) {
    const telefone = normalizarTelefone(placa.telefoneWhatsapp || placa.contrato?.telefoneContato)
    const chave = `${placa.placeId?.trim() || placa.id}|${telefone || placa.id}`
    if (!grupos.has(chave)) grupos.set(chave, { telefone, placas: [] })
    grupos.get(chave).placas.push(placa)
  }
  return [...grupos.values()]
}

function navegadorQuebrado(erro) {
  const texto = erro instanceof Error ? erro.message : String(erro)
  return /Target closed|Session closed|Protocol error|detached|Connection closed|browser has disconnected|Navigating frame was detached|tempo limite/i.test(texto)
}

function criarGerenciadorNavegador() {
  let browser = null
  let usos = 0

  async function fechar() {
    if (browser) await browser.close().catch(() => {})
    browser = null
    usos = 0
  }

  async function abrir() {
    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      try {
        browser = await abrirNavegador()
        usos = 0
        return
      } catch (erro) {
        console.error(`  Falha ao abrir o Chrome (tentativa ${tentativa}/3):`, erro instanceof Error ? erro.message : erro)
        await esperar(5000)
      }
    }
    throw new Error('Não foi possível abrir o Chrome para ler as avaliações.')
  }

  return {
    async obter() {
      if (!browser || !browser.connected || usos >= RECICLAR_NAVEGADOR_A_CADA) {
        await fechar()
        await abrir()
      }
      usos += 1
      return browser
    },
    reiniciar: fechar,
    fechar,
  }
}

async function executarRodada(whatsapp) {
  const agora = new Date()
  const inicio = inicioJanelaAvaliacoes(agora)
  const inicioDoDia = inicioDoDiaBrasilia(agora)
  const forcar = process.argv.includes('--forcar')

  const todas = await prisma.placa.findMany({
    where: { botAtivo: true, tipo: 'GOOGLE', status: 'ATIVA', contrato: { is: { ativo: true } } },
    include: { contrato: { select: { nomeEmpresa: true, telefoneContato: true, ativo: true } } },
    orderBy: [{ contratoId: 'asc' }, { nomeEmpresa: 'asc' }],
  })

  const placas = todas.filter((placa) => placa.contrato?.ativo !== false)
  const inativas = todas.length - placas.length

  console.log(`${formatarDataHora(agora)} — ${placas.length} placa(s) com o robô ligado. Janela desde ${formatarDataHora(inicio)}.`)
  if (inativas) console.log(`  ${inativas} placa(s) ignorada(s) porque o contrato está inativo.`)
  if (placas.length === 0) return

  const grupos = agruparPlacas(placas)
  const leituras = new Map()
  const navegador = criarGerenciadorNavegador()
  const totais = { enviados: 0, erros: 0, pulados: 0 }

  try {
    for (const [indice, grupo] of grupos.entries()) {
      const principal = grupo.placas[0]
      const nome = nomeDaPlaca(principal)
      const ids = grupo.placas.map((placa) => placa.id)
      let mensagem = ''

      console.log(`\n[${indice + 1}/${grupos.length}] ${nome}${ids.length > 1 ? ` (${ids.length} placas do mesmo local)` : ''}`)

      try {
        if (!forcar) {
          const jaEnviado = await prisma.botLog.findFirst({
            where: { placaId: { in: ids }, status: 'SUCESSO', enviadoEm: { gte: inicioDoDia } },
          })
          if (jaEnviado) {
            console.log(`  ${nome}: já recebeu o relatório hoje. Use npm run agora para reenviar.`)
            totais.pulados += 1
            continue
          }
        }

        const placeId = principal.placeId?.trim()
        let avaliacoes = placeId ? leituras.get(placeId) : undefined
        if (!avaliacoes) {
          console.log(`  ${nome}: lendo avaliações...`)
          const browser = await navegador.obter()
          try {
            avaliacoes = await comTempoLimite(
              coletarAvaliacoes(browser, principal, inicio),
              TEMPO_LIMITE_LEITURA,
              'A leitura do Google Maps passou do tempo limite de 4 minutos.'
            )
          } catch (erro) {
            if (navegadorQuebrado(erro)) await navegador.reiniciar()
            throw erro
          }
          if (placeId) leituras.set(placeId, avaliacoes)
        } else {
          console.log(`  ${nome}: avaliações já lidas nesta rodada, reaproveitando.`)
        }

        console.log(`  ${nome}: ${avaliacoes.length} avaliação(ões) na janela.`)
        const relatorio = await gerarRelatorio(principal, avaliacoes, inicio, agora)
        mensagem = montarMensagem(nome, relatorio)
        await enviarMensagem(whatsapp, grupo.telefone, mensagem)
        for (const id of ids) await registrar(id, 'SUCESSO', mensagem, null)
        totais.enviados += 1
        console.log(`  ${nome}: enviado.`)
        if (indice < grupos.length - 1) await pausaEntreEnvios()
      } catch (erro) {
        const detalhe = erro instanceof Error ? erro.message : 'Falha desconhecida.'
        console.error(`  ${nome}: ${detalhe}`)
        for (const id of ids) await registrar(id, 'ERRO', mensagem, detalhe)
        totais.erros += 1
      }
    }
  } finally {
    await navegador.fechar()
  }

  console.log(`\nRodada concluída: ${totais.enviados} enviado(s), ${totais.erros} com erro, ${totais.pulados} já enviado(s) hoje.`)
}

function protegerProcesso() {
  process.on('unhandledRejection', (motivo) => {
    console.error('Erro não tratado:', motivo instanceof Error ? motivo.message : motivo)
  })
  process.on('uncaughtException', (erro) => {
    console.error('Exceção não tratada:', erro instanceof Error ? erro.message : erro)
  })
}

async function main() {
  exigirAmbiente()
  await checkDatabase()
  // Refuse the wrong schema/role before opening Chrome or WhatsApp.
  await prisma.placa.count()
  protegerProcesso()

  const whatsapp = criarWhatsapp()
  await whatsapp.conectar()
  console.log('WhatsApp conectado.')

  if (process.argv.includes('--forcar')) {
    try {
      await executarRodada(whatsapp)
    } finally {
      await whatsapp.encerrar()
      await prisma.$disconnect()
    }
    process.exit(0)
  }

  let rodando = false
  cron.schedule(
    '0 20 * * 6',
    async () => {
      if (rodando) {
        console.log('A rodada anterior ainda está em andamento. Este disparo foi ignorado.')
        return
      }
      rodando = true
      try {
        await executarRodada(whatsapp)
      } catch (erro) {
        console.error('Falha na rodada de sábado:', erro instanceof Error ? erro.message : erro)
      } finally {
        rodando = false
      }
    },
    { timezone: 'America/Sao_Paulo', noOverlap: true, name: 'relatorio-semanal' }
  )

  console.log('Robô no ar. Próximo disparo: sábado às 20:00, horário de Brasília.')
}

main().catch(async (erro) => {
  const allowed = ['IDENTITY_REQUIRED', 'INVALID_DATABASE_URL', 'SHARED_DATABASE_BLOCKED', 'UNRECOGNIZED_DATABASE_HOST', 'PROJECT_REF_REQUIRED', 'WRONG_SUPABASE_PROJECT', 'SCHEMA_NOT_PREPARED', 'WRONG_DATABASE']
  console.error(allowed.includes(erro.code) ? `${erro.code}: ${erro.message}` : 'BOT_START_FAILED: confira banco exclusivo, permissões e conexão do WhatsApp. Nenhuma exceção bruta foi impressa.')
  await disconnectDatabase().catch(() => {})
  process.exit(1)
})
