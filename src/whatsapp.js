const qrcode = require('qrcode-terminal')
const { Client, LocalAuth } = require('whatsapp-web.js')

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function novoCliente() {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  })

  const pronto = new Promise((resolve, reject) => {
    client.once('ready', resolve)
    client.once('auth_failure', (mensagem) => {
      reject(new Error(`Falha ao autenticar o WhatsApp: ${mensagem}`))
    })
  })
  pronto.catch(() => {})

  client.on('qr', (qr) => {
    console.log('Escaneie o QR Code com o WhatsApp que envia os relatórios:')
    qrcode.generate(qr, { small: true })
  })

  client.on('disconnected', (motivo) => {
    console.error('WhatsApp desconectado:', motivo)
  })

  return { client, pronto }
}

function criarWhatsapp() {
  let atual = novoCliente()

  async function conectar() {
    await Promise.all([atual.client.initialize(), atual.pronto])
  }

  async function conectado() {
    try {
      const estado = await comTempoLimite(atual.client.getState(), 15000, 'O WhatsApp não respondeu.')
      return estado === 'CONNECTED'
    } catch {
      return false
    }
  }

  async function reconectar() {
    console.log('A reconectar o WhatsApp...')
    await atual.client.destroy().catch(() => {})
    atual = novoCliente()
    await comTempoLimite(conectar(), 3 * 60 * 1000, 'O WhatsApp não reconectou em 3 minutos.')
    console.log('WhatsApp reconectado.')
  }

  return {
    get client() {
      return atual.client
    },
    conectar,
    async garantirConexao() {
      if (await conectado()) return
      await reconectar()
    },
    async encerrar() {
      await atual.client.destroy().catch(() => {})
    },
  }
}

function normalizarTelefone(telefone) {
  let numero = String(telefone || '').replace(/\D/g, '')
  if (numero.length === 10 || numero.length === 11) numero = `55${numero}`
  return numero
}

async function enviarMensagem(whatsapp, telefone, texto) {
  const numero = normalizarTelefone(telefone)
  if (numero.length < 12 || numero.length > 13) throw new Error('A placa não tem um WhatsApp válido.')

  for (let tentativa = 1; ; tentativa += 1) {
    try {
      await whatsapp.garantirConexao()
      const contato = await comTempoLimite(whatsapp.client.getNumberId(numero), 30000, 'O WhatsApp demorou a localizar o número.')
      const destino = typeof contato === 'string' ? contato : contato?._serialized
      if (!destino) throw Object.assign(new Error(`O número ${numero} não está no WhatsApp.`), { definitivo: true })
      await comTempoLimite(whatsapp.client.sendMessage(destino, texto), 60000, 'O WhatsApp demorou a enviar a mensagem.')
      return
    } catch (erro) {
      if (erro.definitivo || tentativa >= 3) throw erro
      console.log(`  Falha ao enviar (${erro.message}). Nova tentativa em 10s...`)
      await esperar(10000)
    }
  }
}

module.exports = { criarWhatsapp, enviarMensagem, normalizarTelefone }
