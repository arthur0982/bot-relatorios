const { GoogleGenAI } = require('@google/genai')
const { formatarDataHora } = require('./janela')

const ESQUEMA_RELATORIO = {
  type: 'object',
  additionalProperties: false,
  properties: {
    total: { type: 'integer' },
    positivas: { type: 'integer' },
    medias: { type: 'integer' },
    negativas: { type: 'integer' },
    resumo: { type: 'string' },
    citacoesPositivas: { type: 'array', items: { type: 'string' } },
    citacaoNegativa: { type: 'string', nullable: true },
  },
  required: ['total', 'positivas', 'medias', 'negativas', 'resumo', 'citacoesPositivas', 'citacaoNegativa'],
}

function contagensLocais(avaliacoes) {
  return avaliacoes.reduce(
    (acc, item) => {
      if (item.estrelas >= 4) acc.positivas += 1
      else if (item.estrelas != null && item.estrelas <= 2) acc.negativas += 1
      else acc.medias += 1
      return acc
    },
    { total: avaliacoes.length, positivas: 0, medias: 0, negativas: 0 }
  )
}

function citar(item) {
  const frase = item.texto ? `"${item.texto}"` : '(sem comentário escrito)'
  const estrelas = item.estrelas ? ` ${'⭐'.repeat(item.estrelas)}` : ''
  return `${frase} — ${item.autor}${estrelas}`
}

function garantirCitacoes(relatorio, avaliacoes) {
  const positivas = avaliacoes.filter((item) => item.estrelas >= 4 && item.texto)
  const negativas = avaliacoes.filter((item) => item.estrelas != null && item.estrelas <= 2 && item.texto)
  const citacoes = Array.isArray(relatorio.citacoesPositivas) ? relatorio.citacoesPositivas.filter(Boolean) : []

  for (const item of positivas) {
    if (citacoes.length >= 3) break
    if (citacoes.some((citacao) => citacao.includes(item.texto.slice(0, 40)))) continue
    citacoes.push(citar(item))
  }

  let citacaoNegativa = typeof relatorio.citacaoNegativa === 'string' && relatorio.citacaoNegativa.trim()
    ? relatorio.citacaoNegativa.trim()
    : null
  if (!citacaoNegativa && negativas[0]) citacaoNegativa = citar(negativas[0])

  return { ...relatorio, citacoesPositivas: citacoes.slice(0, 5), citacaoNegativa }
}

function lerJson(texto) {
  const limpo = String(texto || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim()
  const inicio = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (inicio === -1 || fim === -1) throw new Error('A IA não devolveu o JSON do relatório.')
  return JSON.parse(limpo.slice(inicio, fim + 1))
}

function promptRelatorio(placa, avaliacoes, inicio, agora) {
  const lista = avaliacoes.length
    ? avaliacoes
        .map((item, indice) =>
          [
            `${indice + 1}. Autor: ${item.autor}`,
            `Estrelas: ${item.estrelas ?? 'não informada'}`,
            `Data: ${item.dataTexto || 'não informada'}`,
            `Texto: ${item.texto || '(sem comentário)'}`,
          ].join('\n')
        )
        .join('\n\n')
    : 'Nenhuma avaliação neste período.'

  return `Você é o redator do relatório semanal de avaliações do Google da empresa "${placa.nomeEmpresa || 'o estabelecimento'}".
O período é de ${formatarDataHora(inicio)} até ${formatarDataHora(agora)}, horário de Brasília.
Use somente as avaliações listadas abaixo. Não invente avaliação, autor, nota nem citação.

Classifique assim:
- positiva: 4 ou 5 estrelas
- média: 3 estrelas
- negativa: 1 ou 2 estrelas
Se a nota não existir, classifique pelo texto. Sem texto e sem nota, considere média.

A resposta DEVE conter, e somente conter, um JSON válido neste formato:
{
  "total": 0,
  "positivas": 0,
  "medias": 0,
  "negativas": 0,
  "resumo": "",
  "citacoesPositivas": [],
  "citacaoNegativa": null
}

O JSON DEVE trazer estes campos, com estes significados:
- total: a quantidade total de avaliações da semana.
- positivas, medias e negativas: o número de avaliações positivas, médias e negativas. A soma dos três deve ser igual ao total.
- resumo: um resumo geral, em português do Brasil, com 3 a 5 linhas, tom leve, espontâneo e próximo, com alguns emojis, pronto para WhatsApp. Se a maioria das avaliações for positiva, parabenize a equipe com entusiasmo. Se houver negativas, trate com empatia e sugira ouvir o cliente.
- citacoesPositivas: citação de pelo menos 3 avaliações positivas, se houver. Se houver menos de 3, cite todas as positivas que existirem. Cada item é a citação literal do comentário, entre aspas, seguida do nome do autor. Se não houver positiva, use uma lista vazia.
- citacaoNegativa: citação de pelo menos 1 avaliação negativa, se houver. A citação é literal, entre aspas, seguida do nome do autor. Se não houver negativa, use null.

Não inclua avaliação de fora da lista e não escreva nada fora do JSON.

Avaliações:
${lista}`
}

function escolher(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

function plural(qtd, singular, varias) {
  return `${qtd} ${qtd === 1 ? singular : varias}`
}

function formatarDia(valor) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(new Date(valor))
}

function mediaEstrelas(avaliacoes) {
  const notas = avaliacoes.map((item) => item.estrelas).filter((nota) => nota != null)
  if (!notas.length) return null
  return (notas.reduce((soma, nota) => soma + nota, 0) / notas.length).toFixed(1).replace('.', ',')
}

function cenario({ total, positivas, negativas }) {
  if (total === 0) return 'vazio'
  const taxa = positivas / total
  if (negativas === 0 && taxa >= 0.8 && total >= 3) return 'excelente'
  if (taxa >= 0.6 && negativas <= 1) return 'bom'
  if (negativas > positivas) return 'atencao'
  return 'misto'
}

const ABERTURAS = {
  excelente: [
    '🎉 Que semana incrível, {empresa}!',
    '🏆 Parabéns, {empresa}! Semana de brilhar!',
    '🚀 Uau, {empresa}! Os clientes estão amando vocês!',
    '🥳 Semana nota 10, {empresa}!',
  ],
  bom: [
    '👏 Boa semana, {empresa}!',
    '😊 Olá, {empresa}! A semana foi positiva por aqui.',
    '✨ Oi, {empresa}! Chegou o resumo da semana e tem coisa boa!',
  ],
  misto: ['👋 Olá, {empresa}! Chegou o resumo da sua semana.', '📬 Oi, {empresa}! Veja como foram as avaliações desta semana.'],
  atencao: [
    '👋 Olá, {empresa}! Chegou o resumo da semana, com alguns pontos de atenção.',
    '📬 Oi, {empresa}! Esta semana vale uma olhadinha com carinho nas avaliações.',
  ],
  vazio: ['👋 Olá, {empresa}!', '📬 Oi, {empresa}! Passando para trazer o resumo da semana.'],
}

function comentario(tipo, r) {
  const positivas = plural(r.positivas, 'avaliação positiva', 'avaliações positivas')
  const opcoes = {
    excelente: [
      r.positivas === r.total
        ? `Todas as ${r.total} avaliações foram positivas — isso é resultado de um atendimento caprichado! 💪`
        : `Foram ${r.positivas} avaliações positivas de ${r.total} — isso é resultado de um atendimento caprichado! 💪`,
      'Seus clientes saíram felizes e fizeram questão de contar pro mundo. A equipe está de parabéns! 🙌',
      `Nenhuma reclamação e ${positivas} nesta semana. Continue assim que o Google agradece! 😍`,
    ],
    bom: [
      'A maioria dos clientes saiu satisfeita. Bora manter o ritmo! 💪',
      `Chegaram ${positivas} nesta semana. Tá no caminho certo! 🚀`,
    ],
    misto: [
      'A semana teve de tudo um pouco. Vale conferir os comentários para ajustar o que for preciso. 🔍',
      'Teve elogio e teve sugestão — os dois ajudam a crescer! 🌱',
    ],
    atencao: [
      'Algumas avaliações apontaram pontos a melhorar. Responder com gentileza no Google faz toda a diferença! 🤝',
      'Nem toda semana é perfeita — o importante é ouvir o cliente e ajustar. Estamos juntos! 💙',
    ],
    vazio: [
      'Nesta semana não chegaram avaliações novas no Google. 🤔',
      'A semana foi tranquila: nenhuma avaliação nova no Google por enquanto. 😌',
    ],
  }
  return escolher(opcoes[tipo])
}

const ENCERRAMENTOS = {
  excelente: ['Bora pra mais uma semana de sucesso! 🚀', 'Orgulho de fazer parte disso! 💚', 'Que venham muitas outras assim! ✨'],
  bom: ['Até o próximo sábado! 👋', 'Seguimos juntos! 🤝'],
  misto: ['Conte com a gente! 🤝', 'Até o próximo sábado! 👋'],
  atencao: ['Conte com a gente! 🤝', 'Semana que vem tem mais! 💪'],
  vazio: [
    '💡 Dica: convide seus clientes a aproximar o celular da placa no balcão — avaliar leva menos de 1 minuto!',
    '💡 Dica: um "já avaliou a gente no Google?" na hora de pagar faz milagres! 😉',
  ],
}

function montarMensagem(empresa, relatorio) {
  const tipo = cenario(relatorio)
  const linhas = [escolher(ABERTURAS[tipo]).replace('{empresa}', `*${empresa}*`), '']

  const periodo = relatorio.periodo ? ` (${formatarDia(relatorio.periodo.inicio)} a ${formatarDia(relatorio.periodo.fim)})` : ''
  linhas.push(`📊 *Números da semana*${periodo}`, `⭐ Avaliações novas: *${relatorio.total}*`)

  if (relatorio.total > 0) {
    linhas.push(`😍 Positivas: ${relatorio.positivas}`, `😐 Médias: ${relatorio.medias}`, `😟 Negativas: ${relatorio.negativas}`)
    if (relatorio.media) linhas.push(`🌟 Nota média da semana: *${relatorio.media}*`)
  }

  linhas.push('', relatorio.resumoIA || comentario(tipo, relatorio))

  if (relatorio.citacoesPositivas.length) {
    linhas.push('', '💬 *O que os clientes disseram:*')
    relatorio.citacoesPositivas.forEach((citacao) => linhas.push(`• ${citacao}`))
  }
  if (relatorio.citacaoNegativa) {
    linhas.push('', '🔎 *Vale a atenção:*', `• ${relatorio.citacaoNegativa}`)
  }

  linhas.push('', escolher(ENCERRAMENTOS[tipo]), '', '_Resumo automático das suas placas NFC 📲_')
  return linhas.join('\n')
}

const ESPERAS_GEMINI = [5000, 15000, 30000]

function erroTemporario(erro) {
  const texto = erro instanceof Error ? erro.message : String(erro)
  return /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|timeout|ECONNRESET|fetch failed/i.test(texto)
}

async function pedirAoGemini(prompt) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const modelo = process.env.GEMINI_MODEL || 'gemini-3.8-flash'

  for (let tentativa = 0; ; tentativa += 1) {
    try {
      const response = await ai.models.generateContent({
        model: modelo,
        contents: prompt,
        config: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseJsonSchema: ESQUEMA_RELATORIO,
        },
      })
      return lerJson(response.text || '')
    } catch (erro) {
      if (!erroTemporario(erro) || tentativa >= ESPERAS_GEMINI.length) throw erro
      const espera = ESPERAS_GEMINI[tentativa]
      console.log(`  Gemini ocupado. Nova tentativa em ${espera / 1000}s (${tentativa + 1}/${ESPERAS_GEMINI.length})...`)
      await new Promise((resolve) => setTimeout(resolve, espera))
    }
  }
}

async function gerarRelatorio(placa, avaliacoes, inicio, agora = new Date()) {
  const locais = contagensLocais(avaliacoes)
  const extras = { periodo: { inicio, fim: agora }, media: mediaEstrelas(avaliacoes) }
  const semIA = () => garantirCitacoes({ ...locais, ...extras, resumoIA: null, citacoesPositivas: [], citacaoNegativa: null }, avaliacoes)

  if (avaliacoes.length === 0 || process.env.USAR_GEMINI !== 'true') return semIA()

  let bruto
  try {
    bruto = await pedirAoGemini(promptRelatorio(placa, avaliacoes, inicio, agora))
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : String(erro)
    console.log(`  Gemini indisponível (${detalhe.slice(0, 160)}). A enviar resumo automático sem IA.`)
    return semIA()
  }
  const soma = Number(bruto.positivas) + Number(bruto.medias) + Number(bruto.negativas)
  const numerosCoerentes = Number(bruto.total) === avaliacoes.length && soma === avaliacoes.length
  const numeros = numerosCoerentes
    ? {
        total: Number(bruto.total),
        positivas: Number(bruto.positivas),
        medias: Number(bruto.medias),
        negativas: Number(bruto.negativas),
      }
    : locais

  return garantirCitacoes(
    {
      ...numeros,
      ...extras,
      resumoIA: typeof bruto.resumo === 'string' && bruto.resumo.trim() ? bruto.resumo.trim() : null,
      citacoesPositivas: bruto.citacoesPositivas,
      citacaoNegativa: bruto.citacaoNegativa,
    },
    avaliacoes
  )
}

module.exports = { gerarRelatorio, montarMensagem }
