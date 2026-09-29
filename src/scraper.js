const path = require('path')
const puppeteer = require('puppeteer')

const UM_DIA = 24 * 60 * 60 * 1000

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizarData(dataTexto) {
  return String(dataTexto || '')
    .replace(/nova|novo/gi, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\buma?\b/g, '1')
    .replace(/\s+/g, ' ')
    .trim()
}

function dataDentroDaJanela(dataTexto, inicio, agora = new Date()) {
  const texto = normalizarData(dataTexto)
  if (!texto) return false

  if (/minutos?|horas?|segundos?|agora|hoje|minutes?|hours?|just now/.test(texto)) return true
  if (/ontem|yesterday/.test(texto)) return new Date(agora.getTime() - UM_DIA) >= inicio

  if (/semanas?|weeks?|mes|month|anos?|years?/.test(texto)) return false

  const dia = texto.match(/(\d+)\s*(dias?|days?)/)
  if (dia) return new Date(agora.getTime() - Number(dia[1]) * UM_DIA) >= inicio

  return false
}

function lerEstrelas(rotulo) {
  const encontrado = String(rotulo || '').match(/(\d)(?:[,.]\d)?\s*(?:de\s*5\s*)?(?:estrelas?|stars?)/i)
  return encontrado ? Number(encontrado[1]) : null
}

function localizarPorTextoNoNavegador({ seletores, textos, ignorar }) {
  const normalizar = (valor) =>
    String(valor || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/\s+/g, ' ')
      .trim()

  const alvos = textos.map(normalizar)
  const bloqueios = (ignorar || []).map(normalizar)

  const visivel = (el) => {
    const caixa = el.getBoundingClientRect()
    const estilo = window.getComputedStyle(el)
    return caixa.width > 0 && caixa.height > 0 && estilo.visibility !== 'hidden' && estilo.display !== 'none'
  }

  const candidatos = [...document.querySelectorAll(seletores.join(', '))]
    .filter(visivel)
    .map((el) => ({
      el,
      rotulo: normalizar(`${el.getAttribute('aria-label') || ''} ${el.innerText || el.textContent || ''}`),
    }))
    .filter(({ rotulo }) => rotulo && !bloqueios.some((bloqueio) => rotulo.includes(bloqueio)))

  const peso = (el) => (el.getAttribute('role') === 'tab' ? 0 : 1)

  for (const alvo of alvos) {
    const achado = candidatos
      .filter(({ rotulo }) => rotulo.includes(alvo))
      .sort((a, b) => peso(a.el) - peso(b.el) || a.rotulo.length - b.rotulo.length)[0]
    if (achado) {
      achado.el.scrollIntoView({ block: 'center' })
      const caixa = achado.el.getBoundingClientRect()
      return {
        rotulo: achado.rotulo.slice(0, 100),
        x: caixa.left + caixa.width / 2,
        y: caixa.top + caixa.height / 2,
      }
    }
  }
  return null
}

async function clicarAlvo(page, alvo) {
  try {
    await page.mouse.click(alvo.x, alvo.y, { delay: 80 })
  } catch {
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.click(), alvo).catch(() => {})
  }
}

async function clicarPorTexto(page, opcoes, timeout = 10000) {
  const limite = Date.now() + timeout
  while (Date.now() < limite) {
    const alvo = await page.evaluate(localizarPorTextoNoNavegador, opcoes).catch(() => null)
    if (alvo) {
      await esperar(300)
      await clicarAlvo(page, alvo)
      return alvo.rotulo
    }
    await esperar(500)
  }
  return null
}

async function menuAberto(page, timeout) {
  const limite = Date.now() + timeout
  while (Date.now() < limite) {
    const aberto = await page
      .evaluate(() =>
        [...document.querySelectorAll('[role="menuitemradio"], [role="menu"] [data-index]')].some((el) => {
          const caixa = el.getBoundingClientRect()
          return caixa.width > 0 && caixa.height > 0
        })
      )
      .catch(() => false)
    if (aberto) return true
    await esperar(300)
  }
  return false
}

async function fecharCookies(page, nome) {
  const rotulo = await clicarPorTexto(
    page,
    {
      seletores: ['button', 'input[type="submit"]', '[role="button"]'],
      textos: ['aceitar tudo', 'accept all', 'reject all', 'rejeitar tudo', 'aceitar'],
    },
    4000
  )

  if (!rotulo) {
    console.log(`  ${nome}: nenhum pop-up de cookies encontrado.`)
    return
  }

  console.log(`  ${nome}: pop-up de cookies fechado (${rotulo}).`)
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null)
  await esperar(3000)
}

async function dispensarLogin(page, nome) {
  const rotulo = await clicarPorTexto(
    page,
    {
      seletores: ['button', '[role="button"]', 'a'],
      textos: ['dispensar', 'agora nao', 'nao, obrigado', 'nao obrigado', 'dismiss', 'not now', 'no thanks'],
    },
    1500
  )
  if (rotulo) {
    console.log(`  ${nome}: janela de login do Google dispensada (${rotulo}).`)
    await esperar(1000)
  }
  return Boolean(rotulo)
}

async function abrirAvaliacoes(page, nome) {
  await dispensarLogin(page, nome)
  const rotulo = await clicarPorTexto(
    page,
    {
      seletores: ['button', '[role="tab"]'],
      textos: ['avaliacoes', 'opinioes', 'reviews'],
      ignorar: ['escrever', 'write a review', 'adicionar'],
    },
    12000
  )

  if (!rotulo) {
    const abas = await page
      .evaluate(() =>
        [...document.querySelectorAll('button, [role="tab"]')]
          .map((el) => (el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 15)
      )
      .catch(() => [])
    console.log(`  ${nome}: separador de avaliações não encontrado. URL: ${page.url()}`)
    if (abas.length) console.log(`  ${nome}: elementos visíveis: ${abas.join(' | ')}`)
    return false
  }

  console.log(`  ${nome}: separador de avaliações clicado (${rotulo}).`)
  await esperar(2000)
  return true
}

function clicarBotaoOrdenarNoNavegador() {
  const botao = [...document.querySelectorAll('button, [role="button"]')].find((el) =>
    /classificar avalia|ordenar avalia|^ordenar$|sort reviews/i.test(
      `${el.getAttribute('aria-label') || ''}`.trim() || `${el.getAttribute('data-value') || ''}`.trim()
    )
  )
  if (!botao) return false
  botao.click()
  return true
}

function clicarMaisRecentesNoNavegador() {
  const itens = [...document.querySelectorAll('[role="menuitemradio"], [role="menu"] [data-index]')]
  const item = itens.find((el) => /mais recentes|newest/i.test(el.innerText || '')) || itens.find((el) => el.getAttribute('data-index') === '1')
  if (!item) return false
  item.click()
  return true
}

async function ordenarMaisRecentes(page, nome) {
  let pediuLogin = false
  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    await dispensarLogin(page, nome)
    const ordenar = await clicarPorTexto(
      page,
      {
        seletores: ['button', '[role="button"]'],
        textos: ['classificar avaliacoes', 'ordenar avaliacoes', 'ordenar', 'sort reviews', 'sort'],
      },
      10000
    )

    if (!ordenar) {
      console.log(`  ${nome}: botão Ordenar não encontrado (tentativa ${tentativa}/3).`)
      continue
    }

    console.log(`  ${nome}: botão Ordenar clicado (${ordenar}).`)

    if (!(await menuAberto(page, 3000))) {
      if (await dispensarLogin(page, nome)) pediuLogin = true
      console.log(`  ${nome}: o menu não abriu com o clique do mouse. A tentar clique via JavaScript...`)
      await page.evaluate(clicarBotaoOrdenarNoNavegador).catch(() => false)
    }

    if (!(await menuAberto(page, 3000))) {
      console.log(`  ${nome}: o menu de ordenação não abriu (tentativa ${tentativa}/3).`)
      await esperar(1000)
      continue
    }

    const recentes = await clicarPorTexto(
      page,
      {
        seletores: ['[role="menuitemradio"]', '[role="menuitem"]', '[role="option"]', '[role="menu"] [data-index]'],
        textos: ['mais recentes', 'newest'],
      },
      4000
    )

    if (!recentes) {
      console.log(`  ${nome}: opção Mais recentes não encontrada no menu (tentativa ${tentativa}/3).`)
      await page.keyboard.press('Escape').catch(() => {})
      await esperar(1000)
      continue
    }

    await esperar(800)
    if (await menuAberto(page, 300)) {
      await page.evaluate(clicarMaisRecentesNoNavegador).catch(() => false)
    }

    console.log(`  ${nome}: opção Mais recentes clicada (${recentes}).`)
    await esperar(3500)
    return
  }

  if (pediuLogin) {
    throw new Error(
      'O Google exige login para ordenar as avaliações. Rode npm run login-google, entre numa conta Google e depois rode o robô de novo. Nenhum relatório foi enviado.'
    )
  }
  throw new Error(
    'Não foi possível ordenar as avaliações por Mais recentes. Nenhum relatório foi enviado para não informar 0 avaliações por engano.'
  )
}

async function esperarCartoes(page, timeout = 10000) {
  const limite = Date.now() + timeout
  while (Date.now() < limite) {
    const total = await page.evaluate(() => document.querySelectorAll('.jftiEf, [data-review-id]').length).catch(() => 0)
    if (total > 0) return true
    await esperar(500)
  }
  return false
}

function expandirComentariosNoNavegador() {
  const botoes = [...document.querySelectorAll('.jftiEf button.w8nwRe, [data-review-id] button.w8nwRe')]
  botoes.forEach((botao) => botao.click())
  return botoes.length
}

function extrairCartoesNoNavegador() {
  const todos = [...document.querySelectorAll('.jftiEf, [data-review-id]')]
  const cartoes = todos.filter((card) => !card.parentElement?.closest('.jftiEf, [data-review-id]'))

  return cartoes.map((card, indice) => {
    const limpar = (valor) => String(valor || '').replace(/\s+/g, ' ').trim()
    const autor = limpar(card.querySelector('.d4r55')?.textContent) || 'Cliente'
    const dataTexto = limpar(card.querySelector('.rsqaWe')?.textContent)
    const texto = limpar(card.querySelector('.wiI7pd')?.textContent)
    const estrelas = card.querySelector('.kvMYJc, [role="img"][aria-label*="estrela"], [role="img"][aria-label*="star"]')
    return {
      id: card.getAttribute('data-review-id') || `${indice}:${autor}:${dataTexto}`,
      autor,
      dataTexto,
      texto,
      rotuloEstrelas: estrelas?.getAttribute('aria-label') || '',
    }
  })
}

function rolarListaNoNavegador() {
  const card = document.querySelector('.jftiEf, [data-review-id]')
  let painel = card?.parentElement
  while (painel && painel.scrollHeight <= painel.clientHeight + 10) painel = painel.parentElement
  if (!painel) return false
  const antes = painel.scrollTop
  painel.scrollTop = painel.scrollHeight
  return painel.scrollTop !== antes
}

const TENTATIVAS = 3
const MAX_VOLTAS = 60

function urlsDoPlace(placa) {
  const placeId = placa.placeId?.trim()
  if (!placeId) return []
  const id = encodeURIComponent(placeId)
  return [
    `https://www.google.com/maps/place/?q=place_id:${id}&hl=pt-BR`,
    `https://www.google.com/maps/search/?api=1&query=${id}&query_place_id=${id}&hl=pt-BR`,
  ]
}

async function abrirNavegador({ headless = process.env.HEADLESS !== 'false' } = {}) {
  return puppeteer.launch({
    headless,
    userDataDir: path.resolve(__dirname, '..', '.puppeteer_perfil'),
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=pt-BR', '--disable-blink-features=AutomationControlled'],
  })
}

async function abrirPaginaComAvaliacoes(page, urls, nome) {
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa += 1) {
    const url = urls[(tentativa - 1) % urls.length]
    console.log(`  ${nome}: a abrir o Google Maps (tentativa ${tentativa}/${TENTATIVAS})...`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await esperar(3000)

    const bloqueio = await page.evaluate(() => /unusual traffic|n[aã]o [eé] um rob[oô]|captcha/i.test(document.body?.innerText || ''))
    if (bloqueio) {
      throw new Error('O Google bloqueou a leitura das avaliações. Rode de novo com HEADLESS=false.')
    }

    await fecharCookies(page, nome)
    if (await abrirAvaliacoes(page, nome)) return

    if (tentativa < TENTATIVAS) {
      console.log(`  ${nome}: o Maps abriu sem o separador de avaliações. A recarregar...`)
      await esperar(3000)
    }
  }

  throw new Error(
    'O Google Maps abriu sem o separador de avaliações em todas as tentativas. Nenhum relatório foi enviado para não informar 0 avaliações por engano.'
  )
}

async function coletarAvaliacoes(browser, placa, inicio) {
  const urls = urlsDoPlace(placa)
  if (!urls.length) {
    throw new Error('A placa não tem Place ID. Preencha o Place ID no painel antes de ligar o robô.')
  }

  const nome = placa.nomeEmpresa || placa.codigo || placa.id
  const page = await browser.newPage()
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' })
    await page.setViewport({ width: 1366, height: 900 })

    await abrirPaginaComAvaliacoes(page, urls, nome)

    await ordenarMaisRecentes(page, nome)

    if (!(await esperarCartoes(page))) {
      throw new Error('O separador de avaliações abriu, mas nenhum cartão apareceu. Nenhum relatório foi enviado.')
    }
    console.log(`  ${nome}: cartões de avaliação carregados.`)

    const vistos = new Map()
    let semNovos = 0

    for (let volta = 0; volta < MAX_VOLTAS; volta += 1) {
      const expandidos = await page.evaluate(expandirComentariosNoNavegador).catch(() => 0)
      if (expandidos) await esperar(800)
      const lote = await page.evaluate(extrairCartoesNoNavegador)
      let novos = 0
      for (const card of lote) {
        if (vistos.has(card.id)) continue
        vistos.set(card.id, {
          autor: card.autor,
          texto: card.texto.slice(0, 500),
          dataTexto: normalizarData(card.dataTexto),
          estrelas: lerEstrelas(card.rotuloEstrelas),
        })
        novos += 1
      }

      const ultimos = [...vistos.values()].slice(-3)
      if (ultimos.length === 3 && ultimos.every((item) => !dataDentroDaJanela(item.dataTexto, inicio))) break

      semNovos = novos === 0 ? semNovos + 1 : 0
      if (semNovos >= 3) break

      const rolou = await page.evaluate(rolarListaNoNavegador).catch(() => false)
      if (!rolou) break
      await esperar(1200)
    }

    const todas = [...vistos.values()]
    const naJanela = todas.filter((item) => dataDentroDaJanela(item.dataTexto, inicio))
    console.log(`  ${nome}: ${todas.length} cartão(ões) lido(s), ${naJanela.length} dentro da janela.`)
    if (todas.length) console.log(`  ${nome}: datas lidas: ${todas.map((item) => item.dataTexto || '(sem data)').join(' | ')}`)
    return naJanela
  } finally {
    await page.close().catch(() => {})
  }
}

module.exports = { abrirNavegador, coletarAvaliacoes, dataDentroDaJanela }
