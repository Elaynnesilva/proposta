import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProposalRaw, getSettings, getTemplateContentRaw, saveProposal, saveTemplateContent, getPublicProposalRaw, getPublicSettings, getPublicTemplateContentRaw, setProposalPublic, saveImageAsMedia, fetchMediaByRef, saveSettings } from '../lib/db'
import { carregarFotos, coletarRefs, aplicarFotos } from '../lib/media'
import { podeEditarAgora } from '../lib/acesso'
import { auth } from '../lib/firebase'
import { buildSlides } from '../lib/slides'
import { DEFAULT_IMAGES, DEFAULT_SHARED_TEXT } from '../lib/content'
import { STYLE, paletteToCssVars, readableTextColor, isLowContrast, DEFAULT_PALETTE, FIXED_SWATCHES } from '../lib/templates'
import { toEmbedUrl, listItems, juntarTopicos } from '../lib/fields'

const SLIDE_ICONS = {
  cover: '🏠', agenda: '📋', profile: '👩‍🎨', divider: '—', clientRequest: '🗂️',
  reasons: '💡', scopeSection: '📐', modeling: '🧊', journeyFlow: '🧭', stages: '🎯',
  feedbacks: '💬', pricingCalc: '🧮', packagePricing: '💰', packagesSummary: '📊', payment: '💳', video: '🎬',
  custom: '✨', closing: '❤️', beforeAfter: '🔁',
}

/**
 * Slide "Antes e depois" sem nenhuma foto nem texto. Ele existe em toda proposta (é montado
 * junto com os outros), mas vazio não deve chegar ao cliente: fica de fora do link público, do
 * modo Apresentar e do PDF. Na tela de edição ele continua na lista, para poder ser preenchido.
 * Conta-se a quantidade de fotos (e não se a foto já carregou), senão o slide "piscaria" sumindo
 * enquanto as fotos ainda estão chegando do banco.
 */
function slideVazio(s) {
  if (s.type !== 'beforeAfter') return false
  const temTexto = [s.leftText, s.rightText].some((t) => String(t || '').trim())
  return !temTexto && !(s.leftImages?.length) && !(s.rightImages?.length)
}

/**
 * Hoje TODO slide pode ser salvo para as outras propostas — inclusive o avulso ("Novo
 * slide"), que passou a poder virar parte do modelo e aparecer sozinho nas próximas
 * propostas (ver customSlides no conteúdo do modelo). A lista fica aqui, vazia, porque é o
 * lugar de marcar qualquer tipo que um dia precise voltar a ser preso a uma proposta só.
 */
const PROPOSAL_ONLY_SLIDE_TYPES = new Set([])

/**
 * Última opção de "onde salvar" que a pessoa escolheu. Fica guardada no navegador para vir
 * já marcada na próxima edição: antes a pergunta voltava sempre para "todas as propostas",
 * e quem salvava algo só numa proposta e esquecia de remarcar acabava espalhando a mudança
 * para todas sem querer.
 */
const SCOPE_KEY = 'propostaplus:ultimoEscopo'
const VIDEO_SCOPE_KEY = 'propostaplus:ultimoEscopoVideo'
function lerEscopoSalvo(key, padrao) {
  try {
    const v = localStorage.getItem(key)
    return v === 'proposal' || v === 'tipologia' || v === 'allTypes' ? v : padrao
  } catch { return padrao }
}
function guardarEscopo(key, scope) {
  try { localStorage.setItem(key, scope) } catch { /* navegador sem storage: segue sem lembrar */ }
}

/**
 * Campos que NUNCA viram padrão das outras propostas, mesmo quando "todos os tipos" está
 * marcado: são textos montados com os dados DESTE cliente (o título da capa traz o nome
 * dele, e os itens trazem o objetivo do projeto). Esses continuam salvos só na proposta
 * atual — é o que permite a FOTO da capa valer para todas as propostas sem carregar junto
 * o nome do cliente anterior.
 */
const CLIENT_FIELDS_BY_SLIDE = {
  cover: ['title', 'items'],
  'client-request': ['objetivoProjeto'],
}

/** Textos que também existem em Configurações > Textos padrão — ao salvar "em todos os tipos",
 *  atualizamos os dois lugares, pra tela de Configurações nunca mostrar um texto desatualizado. */
const SHARED_TEXT_SLIDES = new Set(['agenda', 'about', 'reasons', 'journey', 'stages', 'feedbacks', 'closing'])

const EXPORT_W = 1600
const EXPORT_H = 900

/** Nome do arquivo baixado: "Cliente - Proposta - dd-mm-aa" (usa o primeiro nome do cliente e a data de hoje) */
function exportFileName(proposal) {
  const nomeCompleto = proposal?.fields?.nomeCliente || proposal?.name || 'Cliente'
  const primeiroNome = nomeCompleto.trim().split(/\s+/)[0]
  const hoje = new Date()
  const dd = String(hoje.getDate()).padStart(2, '0')
  const mm = String(hoje.getMonth() + 1).padStart(2, '0')
  const aa = String(hoje.getFullYear()).slice(-2)
  const safe = primeiroNome.replace(/[^\w\-]/g, '')
  return `${safe} - Proposta - ${dd}-${mm}-${aa}.pdf`
}

/**
 * "Missing or insufficient permissions" ao salvar para as outras propostas quer dizer uma
 * coisa só: as regras do Firestore publicadas no console ainda não têm a biblioteca de
 * imagens da conta (users/{uid}/media) — o arquivo firestore.rules do projeto tem, mas ele
 * não vai sozinho para o Firebase junto com o deploy da Vercel, precisa ser publicado lá.
 * Sem essa regra, a foto não tem onde ser gravada e o salvamento inteiro é recusado.
 */
/** Copia um texto usando a API moderna e, se ela for recusada, o jeito antigo (textarea +
 *  execCommand). Devolve true/false em vez de lançar erro — quem chama decide o que fazer. */
async function copiarParaAreaDeTransferencia(texto) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texto); return true }
  } catch { /* cai no jeito antigo abaixo */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = texto
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

function scopeSaveErrorMessage(err) {
  const msg = err?.message || ''
  if (err?.code === 'permission-denied' || /permission/i.test(msg)) {
    return 'O Firebase recusou o salvamento (permissão). Publique as regras do arquivo firestore.rules no Console do Firebase (Firestore Database > Regras > Publicar) — elas precisam incluir a biblioteca de imagens da conta. Enquanto isso, use "Só nesta proposta", que continua funcionando.'
  }
  return `Não consegui salvar essa edição para as outras propostas (${msg || 'erro desconhecido'}). Tente de novo, ou use uma foto menor.`
}

/**
 * A apresentação também funciona como GERADOR DE PDF invisível.
 *
 * Com exportOnly, ela não desenha interface nenhuma: carrega a proposta, monta os slides,
 * baixa as fotos, gera o PDF e avisa quem chamou. É assim que o painel consegue gerar o PDF
 * dentro da própria janela de encerramento, sem jogar a pessoa pra dentro da apresentação —
 * toda a montagem dos slides já mora aqui, então reaproveitar é mais seguro do que duplicar.
 */
export default function Presenter({ proposalId, exportOnly = false, onExportProgress, onExportEnd }) {
  const params = useParams()
  const id = proposalId || params.id
  const publicUid = exportOnly ? null : params.uid
  const isPublic = !!publicUid
  const navigate = useNavigate()
  /* teste vencido: some tudo que altera a apresentação. Ver, apresentar e baixar o PDF
     continuam — é o "apenas visualizar" combinado. Antes os botões ficavam na tela, a edição
     abria e nada era salvo, o que só se descobria depois de perder o trabalho. */
  const podeEditar = podeEditarAgora()
  const [proposal, setProposal] = useState(null)
  const [settings, setSettings] = useState(null)
  const [templateContent, setTemplateContent] = useState(null)
  const [index, setIndex] = useState(0)
  const [revealCount, setRevealCount] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportIndex, setExportIndex] = useState(0)
  const [linkCopied, setLinkCopied] = useState(false)
  const [linkModalUrl, setLinkModalUrl] = useState('')
  const exportouAutomatico = useRef(false)
  // id do slide recém-criado pelo botão "+ Novo slide": assim que ele aparecer na lista,
  // a apresentação pula pra ele e já abre o painel de edição
  const [slideNovoId, setSlideNovoId] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // modo "Apresentar": só o slide na tela, em tela cheia, sem lista lateral, botões, setas ou
  // bolinhas — é o que o cliente vê. Navega com clique, setas e espaço; sai com Esc.
  const [apresentando, setApresentando] = useState(false)
  const [dicaSair, setDicaSair] = useState(false)
  const saiuDaApresentacaoEm = useRef(0)
  const exportRef = useRef(null)
  const mobileSlideRef = useRef(null)

  // desfazer/refazer: guarda um histórico de versões anteriores da proposta (textos, imagens,
  // cores, ordem, visibilidade — tudo que passa por updateProposal). historyVersion só existe
  // pra forçar o React a re-renderizar os botões (habilitado/desabilitado) quando o histórico muda.
  const historyRef = useRef([])
  const futureRef = useRef([])
  const [historyVersion, setHistoryVersion] = useState(0)

  /** Todas as edições da proposta (textos, imagens, cores, ordem, ocultar slide, campos,
   *  visibilidade de preços) devem passar por aqui em vez de setProposal direto, pra entrarem
   *  no histórico de desfazer/refazer e serem salvas de forma consistente. */
  function updateProposal(updater) {
    return new Promise((resolve) => {
      setProposal((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        if (next === prev) { resolve(prev); return prev }
        historyRef.current.push(prev)
        if (historyRef.current.length > 50) historyRef.current.shift()
        futureRef.current = []
        setHistoryVersion((v) => v + 1)
        // grava no Firestore uma cópia com as fotos trocadas por referências curtas (pra nunca
        // estourar o limite de 1MB por documento) — mas o estado local (a variável "next", que
        // é o que aparece na tela) continua com a foto de verdade, então ela aparece na hora,
        // sem precisar recarregar a página. Se esse salvamento falhar (ex: imagem grande
        // demais mesmo depois de comprimida, ou sem internet), avisa em vez de falhar em
        // silêncio — antes disso, a mudança ficava só na tela e sumia ao recarregar a página,
        // sem nenhum aviso de que não tinha sido salva de verdade.
        replaceDataUrls(next, next.id)
          .then((toSave) => saveProposal(toSave))
          .then(() => resolve(next))
          .catch((err) => {
            console.error(err)
            alert(`Não consegui salvar essa alteração (${err?.message || 'erro desconhecido'}). Ela pode não aparecer se você recarregar a página — tente de novo, ou use uma foto menor.`)
            resolve(next)
          })
        return next
      })
    })
  }

  function undo() {
    if (!historyRef.current.length) return
    setProposal((prev) => {
      const previous = historyRef.current.pop()
      futureRef.current.push(prev)
      replaceDataUrls(previous, previous.id)
        .then((toSave) => saveProposal(toSave))
        .catch((err) => { console.error(err); alert('Não consegui salvar o "desfazer". Tente de novo.') })
      setHistoryVersion((v) => v + 1)
      return previous
    })
  }

  function redo() {
    if (!futureRef.current.length) return
    setProposal((prev) => {
      const nextState = futureRef.current.pop()
      historyRef.current.push(prev)
      replaceDataUrls(nextState, nextState.id)
        .then((toSave) => saveProposal(toSave))
        .catch((err) => { console.error(err); alert('Não consegui salvar o "refazer". Tente de novo.') })
      setHistoryVersion((v) => v + 1)
      return nextState
    })
  }

  // tela cheia no mobile: usa a Fullscreen API de verdade (esconde a barra do navegador) e
  // tenta travar a orientação em paisagem — se o navegador não permitir (iOS Safari não tem
  // Fullscreen API em elementos comuns), cai num modo "tela cheia" só via CSS mesmo assim,
  // então o botão sempre funciona, ele só não esconde a barra do navegador nesses casos
  async function toggleMobileFullscreen() {
    if (!isFullscreen) {
      setIsFullscreen(true)
      try { await mobileSlideRef.current?.requestFullscreen?.() } catch { /* segue no modo CSS */ }
      try { await screen.orientation?.lock?.('landscape') } catch { /* navegador não suporta, tudo bem */ }
    } else {
      try { if (document.fullscreenElement) await document.exitFullscreen?.() } catch { /* ignora */ }
      try { screen.orientation?.unlock?.() } catch { /* ignora */ }
      setIsFullscreen(false)
    }
  }

  async function entrarApresentacao() {
    setEditing(false)
    setApresentando(true)
    // o aviso "Esc para sair" aparece só nos primeiros segundos, pra quem apresenta — some
    // antes do cliente reparar
    setDicaSair(true)
    setTimeout(() => setDicaSair(false), 2500)
    // tela cheia de verdade esconde também a barra do navegador e a do Windows. Se o navegador
    // não deixar, a apresentação continua ocupando a janela inteira do mesmo jeito.
    try { await document.documentElement.requestFullscreen?.() } catch { /* segue sem tela cheia */ }
  }

  async function sairApresentacao() {
    saiuDaApresentacaoEm.current = Date.now()
    setApresentando(false)
    setDicaSair(false)
    try { if (document.fullscreenElement) await document.exitFullscreen?.() } catch { /* ignora */ }
  }

  useEffect(() => {
    function onFsChange() {
      if (!document.fullscreenElement) {
        setIsFullscreen(false)
        // Esc no navegador sai da tela cheia sozinho; aqui a apresentação acompanha e volta
        // a mostrar os botões, em vez de ficar "presa" sem nenhum jeito de editar
        setApresentando((estava) => {
          if (estava) saiuDaApresentacaoEm.current = Date.now()
          return false
        })
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  useEffect(() => {
    if (isPublic) {
      getPublicProposalRaw(publicUid, id).then(setProposal)
      getPublicSettings(publicUid).then(setSettings)
      getPublicTemplateContentRaw(publicUid).then(setTemplateContent)
    } else {
      getProposalRaw(id).then(setProposal)
      getSettings().then(setSettings)
      getTemplateContentRaw().then(setTemplateContent)
    }
  }, [id, isPublic, publicUid])

  /**
   * Carregamento das fotos sob demanda.
   *
   * A proposta e o conteúdo do modelo chegam com as referências curtas, sem as fotos. Aqui a
   * gente baixa só as do slide que está na tela (e as do seguinte, pra virada não ter espera),
   * guardando cada uma em cache — na memória e no navegador. Nas próximas aberturas, elas já
   * estão prontas e não custam nem transferência nem tempo.
   */
  const contaDasFotos = isPublic ? publicUid : auth.currentUser?.uid
  const [fotosVersao, setFotosVersao] = useState(0)

  const pedirFotos = useCallback(async (refs) => {
    if (!contaDasFotos || !refs.length) return
    const mudou = await carregarFotos(refs, {
      uid: contaDasFotos,
      proposalId: id,
      buscarNoBanco: (ref) => fetchMediaByRef(ref, { uid: contaDasFotos, proposalId: id }),
    })
    if (mudou) setFotosVersao((v) => v + 1)
  }, [contaDasFotos, id])

  const content = { ...DEFAULT_SHARED_TEXT, ...(templateContent?.shared || {}) }
  const images = proposal
    ? { ...DEFAULT_IMAGES[proposal.tipologia], ...(templateContent?.images?.[proposal.tipologia] || {}) }
    : null

  // resolve o vídeo principal em cascata: só esta proposta -> este tipo de projeto -> todos os tipos
  const tipologiaVideo = templateContent?.images?.[proposal?.tipologia] || {}
  const sharedVideo = templateContent?.sharedVideo || {}
  const resolvedVideoUrl = proposal?.videoUrl || tipologiaVideo.videoUrl || sharedVideo.videoUrl || ''
  // o painel de edição chama o link do YouTube de "embedUrl" e o conteúdo do modelo o chama de
  // "videoEmbedUrl" — aceita os dois nomes aqui, senão um vídeo salvo para o tipo de projeto ou
  // para todos os tipos era gravado com um nome e procurado com o outro, e nunca aparecia
  const resolvedEmbedUrl = proposal?.videoEmbedUrl
    || tipologiaVideo.videoEmbedUrl || tipologiaVideo.embedUrl
    || sharedVideo.videoEmbedUrl || sharedVideo.embedUrl || ''

  /**
   * Slides extras ("Novo slide") vêm de dois lugares: os salvos no modelo (valem para todas
   * as propostas, ou só para um tipo de projeto) e os criados dentro desta proposta. Juntamos
   * os dois por id — o da proposta vence, pra uma edição local nunca ser engolida pelo modelo.
   */
  const customSlides = useMemo(() => {
    const doModelo = templateContent?.customSlides || {}
    const byId = new Map()
    ;[...(doModelo.all || []), ...(doModelo[proposal?.tipologia] || [])].forEach((c) => { if (c?.id) byId.set(c.id, c) })
    ;(proposal?.customSlides || []).forEach((c, i) => {
      const cid = c.id || `custom-${i}`
      byId.set(cid, { ...c, id: cid })
    })
    return [...byId.values()]
  }, [templateContent, proposal?.tipologia, proposal?.customSlides])

  /**
   * Uma CÓPIA não guarda uma foto do slide original: guarda só { id, copyOf } mais o que foi
   * editado nela. Na hora de montar, ela pega o slide de origem recém-construído e aplica as
   * suas próprias mudanças por cima. Assim a cópia de um slide de pacotes continua mostrando
   * os valores atuais do cliente, em vez de congelar os valores do dia em que foi copiada.
   */
  const copias = useMemo(() => customSlides.filter((c) => c.copyOf), [customSlides])

  const baseSlides = useMemo(() => {
    if (!proposal || !settings) return []
    return buildSlides({
      fields: proposal.fields || {},
      content, images, settings,
      custom: customSlides.filter((c) => !c.copyOf),
      videoUrl: resolvedVideoUrl,
      videoEmbedUrl: resolvedEmbedUrl,
      visibility: proposal.visibility || {},
      hiddenSlides: proposal.hiddenSlides || [],
    })
  }, [proposal, settings, templateContent, customSlides])

  /** insere cada cópia logo abaixo do slide de origem, já com o conteúdo dele */
  const baseSlidesComCopias = useMemo(() => {
    if (!copias.length) return baseSlides
    const saida = []
    baseSlides.forEach((s) => {
      saida.push(s)
      copias.filter((c) => c.copyOf === s.id).forEach((c) => {
        const { copyOf, id, ...edicoes } = c
        // a cópia nasce com os textos do original mas é independente: sem fieldCode, ela guarda
        // os próprios tópicos e não escreve por cima do campo de "Dados do projeto" do original
        saida.push({ ...s, ...edicoes, id, copyOf, isCopy: true, fieldCode: undefined })
      })
    })
    // cópias cujo original foi ocultado ou não existe mais não podem sumir sem aviso
    const jaIncluidas = new Set(saida.map((x) => x.id))
    copias.forEach((c) => {
      if (jaIncluidas.has(c.id)) return
      saida.push({ ...c, type: c.type || 'custom', isCopy: true })
    })
    return saida
  }, [baseSlides, copias])

  const slidesMontados = useMemo(() => {
    // ORDEM DE PRECEDÊNCIA das edições de slide, da mais geral para a mais específica:
    //   1. o slide "de fábrica" montado a partir dos dados da proposta (buildSlides)
    //   2. o que foi salvo para TODOS os tipos de projeto (slideDefaults.all)
    //   3. o que foi salvo só para este tipo de projeto (slideDefaults[tipologia])
    //   4. o que foi editado só nesta proposta (proposal.slideOverrides)
    // É isso que faz uma foto colocada uma vez aparecer sozinha nas próximas propostas.
    const defaultsAll = templateContent?.slideDefaults?.all || {}
    const defaultsTipologia = templateContent?.slideDefaults?.[proposal?.tipologia] || {}
    let list = baseSlidesComCopias.map((s) => {
      const base = { ...s, ...(defaultsAll[s.id] || {}), ...(defaultsTipologia[s.id] || {}) }
      const ov = proposal?.slideOverrides?.[s.id]
      const merged = { ...base, ...(ov || {}) }
      // a descrição do "Acompanhamento de obra" vem sempre de "Dados do projeto" — nunca de um
      // override salvo por engano numa versão antiga, senão um texto desatualizado ficaria
      // "preso" ali pra sempre, escondendo qualquer atualização feita depois nos dados do projeto
      if (s.id === 'obra') merged.description = s.description
      // mesma lógica para os tópicos do escopo (Plantas, Vistas 2D, Interiores…) e das etapas da
      // jornada: eles vêm de "Dados do projeto". Antes, salvar o slide pelo painel gravava uma
      // CÓPIA dos tópicos junto com a edição — e, salvando "para todas as propostas", a cópia de
      // um cliente passava a aparecer no slide de todos os outros, escondendo o que estava nos
      // dados (ex.: "Consultoria de interiores" nos dados, "Móveis Planejados" no slide).
      // Agora os dados sempre ganham; cópias antigas que ficaram gravadas são simplesmente ignoradas.
      if (s.fieldCode) merged.items = s.items
      // os prazos previstos de cada apresentação vêm sempre de "Dados do projeto" — um
      // override salvo antes (com as datas do cliente anterior) não pode congelá-los aqui.
      // Só a escolha de ocultar (hideDeadlines) é que continua vindo do que foi salvo.
      if (s.id === 'stages' && Array.isArray(merged.stages)) {
        merged.stages = merged.stages.map((st, i) => ({ ...st, deadlines: s.stages?.[i]?.deadlines || [] }))
      }
      // a página de obra virou "uma foto na lateral"; propostas antigas guardaram a foto numa
      // lista (quando ela ainda era uma seção de escopo) — aproveita a primeira, pra ninguém
      // perder a imagem que já tinha escolhido
      if (s.type === 'scopeSplit' && !merged.image && merged.images?.length) merged.image = merged.images[0]?.url || ''
      return merged
    })

    const order = proposal?.slideOrder
    if (order && order.length) {
      const byId = Object.fromEntries(list.map((s) => [s.id, s]))
      const ordered = order.map((sid) => byId[sid]).filter(Boolean)
      // slide que não existia quando a ordem foi gravada (ex.: o "Antes e depois", criado depois
      // que a pessoa já tinha arrastado slides nesta proposta) entra logo depois do slide que vem
      // antes dele na ordem padrão — e não no fim da apresentação, como acontecia antes
      list.forEach((s, i) => {
        if (order.includes(s.id)) return
        let pos = -1
        for (let k = i - 1; k >= 0 && pos < 0; k--) pos = ordered.findIndex((x) => x.id === list[k].id)
        ordered.splice(pos + 1, 0, s)
      })
      list = ordered
    }
    return list
  }, [baseSlidesComCopias, templateContent, proposal?.tipologia, proposal?.slideOverrides, proposal?.slideOrder])

  /**
   * Duas listas: a "crua", que ainda tem as referências curtas (é dela que sabemos QUAIS fotos
   * um slide precisa), e a final, com as fotos que já chegaram no lugar. O que ainda não
   * chegou fica vazio — o slide desenha o espaço em branco e se redesenha quando a foto vem.
   */
  const slidesBrutos = slidesMontados
  const slides = useMemo(
    () => aplicarFotos(slidesMontados, contaDasFotos, id),
    [slidesMontados, contaDasFotos, id, fotosVersao],
  )

  // páginas ocultadas pela pessoa ficam fora da apresentação e do PDF, mas continuam
  // listadas (esmaecidas) na barra lateral, prontas para serem reativadas quando quiser
  const hiddenIds = useMemo(() => new Set(proposal?.hiddenSlides || []), [proposal?.hiddenSlides])
  // o que o cliente vê (link público e modo Apresentar) também pula os slides vazios — ver slideVazio
  const modoCliente = apresentando || isPublic
  const visibleSlides = useMemo(
    () => slides.filter((s) => !hiddenIds.has(s.id) && !(modoCliente && slideVazio(s))),
    [slides, hiddenIds, modoCliente],
  )
  // o PDF é sempre "para o cliente": slide vazio fica de fora mesmo baixando pela tela de edição.
  // É uma lista própria (e não um filtro que liga durante a geração) para o número de páginas
  // contado no começo da geração ser o mesmo das páginas desenhadas.
  const slidesDoPdf = useMemo(() => visibleSlides.filter((s) => !slideVazio(s)), [visibleSlides])

  /**
   * Quando a lista muda (entrar/sair do modo Apresentar, ocultar ou reordenar um slide…), a
   * apresentação continua no MESMO slide, procurando-o pelo nome interno. Antes ela ficava no
   * mesmo NÚMERO, e o número passava a apontar para outro slide: entrar no modo Apresentar com
   * um slide vazio antes do atual pulava a pessoa para o slide seguinte sem ela perceber.
   */
  const ultimoIdMostrado = useRef(null)
  const ultimaListaVisivel = useRef(visibleSlides)
  useEffect(() => {
    if (ultimaListaVisivel.current !== visibleSlides) {
      ultimaListaVisivel.current = visibleSlides
      // slide recém-criado: quem decide para onde ir é o "pular para o slide novo", logo abaixo
      if (!slideNovoId) {
        const idx = visibleSlides.findIndex((s) => s.id === ultimoIdMostrado.current)
        if (idx >= 0 && idx !== index) { setIndex(idx); return }
      }
    }
    ultimoIdMostrado.current = visibleSlides[index]?.id
  }, [visibleSlides, index, slideNovoId])

  /**
   * Pede as fotos do slide atual e do seguinte (a virada fica sem espera). Como as referências
   * são apagadas na montagem acima, a lista "crua" de onde tirar as referências é a de antes
   * da troca — por isso olhamos o slide correspondente em slidesBrutos.
   */
  useEffect(() => {
    if (!slidesBrutos.length) return
    const alvoIds = [visibleSlides[index]?.id, visibleSlides[index + 1]?.id].filter(Boolean)
    const alvos = slidesBrutos.filter((s) => alvoIds.includes(s.id))
    pedirFotos(coletarRefs(alvos))
  }, [slidesBrutos, visibleSlides, index, pedirFotos])

  // sempre que a lista de slides visíveis muda de tamanho (ao ocultar um slide, reordenar, etc.)
  // garante que o índice atual continua dentro dos limites — sem isso, ocultar o slide que
  // estava sendo mostrado (ou o último da lista) deixava "slide" undefined e a apresentação
  // aparecia cortada/quebrada até trocar de página manualmente
  useEffect(() => {
    setIndex((i) => {
      if (visibleSlides.length === 0) return 0
      return Math.min(i, visibleSlides.length - 1)
    })
  }, [visibleSlides.length])

  const slide = visibleSlides[index]

  /**
   * Prévia ao vivo da edição: enquanto o painel está aberto, ele manda aqui o que está sendo
   * editado e a tela desenha o slide já com isso — sem salvar. Só vale para o slide que está
   * sendo editado; ao salvar ou fechar o painel, a prévia some e fica o que foi gravado.
   */
  const [previa, setPrevia] = useState(null)
  useEffect(() => { if (!editing) setPrevia(null) }, [editing])
  const slideNaTela = editing && slide && previa?.slideId === slide.id ? { ...slide, ...previa.patch } : slide

  /** Fecha o painel. Se a pessoa mexeu e não salvou, confirma antes: agora que a mudança já
   *  aparece no slide, fechar sem salvar podia dar a impressão de que ela tinha ficado gravada. */
  function fecharEdicao(salvou) {
    if (salvou !== true && previa?.alterado && !confirm('Fechar sem salvar? O que você mudou neste slide será descartado.')) return
    setEditing(false)
    setPrevia(null)
  }

  const palette = proposal?.palette || DEFAULT_PALETTE
  const [c1, c2, c3] = palette
  const cssVars = paletteToCssVars(palette)

  const goNext = useCallback(() => { setIndex((i) => Math.min(i + 1, visibleSlides.length - 1)); setRevealCount(0) }, [visibleSlides.length])
  const goPrev = useCallback(() => { setIndex((i) => Math.max(i - 1, 0)); setRevealCount(999) }, [])
  const itemsLength = getItemsLength(slide)

  const handleAdvance = () => {
    if (editing || exporting) return
    if (revealCount < itemsLength) setRevealCount((c) => c + 1)
    else goNext()
  }

  useEffect(() => {
    function onKey(e) {
      if (editing || exporting) return
      // digitando num campo (link do cliente, renomear…) as teclas são do campo, não do slide
      const alvo = e.target
      if (alvo?.tagName === 'INPUT' || alvo?.tagName === 'TEXTAREA' || alvo?.isContentEditable) return
      // avançar/voltar aceitam também Page Down/Page Up e setas para baixo/cima: são as teclas
      // que os passadores de slide (e os apps de celular que funcionam como controle remoto)
      // enviam. Antes só as setas laterais e o espaço funcionavam, e o passador não fazia nada.
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); handleAdvance(); return }
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); goPrev(); return }
      if (e.key === 'Escape') {
        // durante a apresentação, Esc só encerra a apresentação. E o mesmo Esc que tirou a tela
        // cheia não pode, logo em seguida, ser lido como "sair da proposta" e jogar a pessoa
        // para o editor no meio da reunião — por isso a janela de 1 segundo
        if (apresentando) { sairApresentacao(); return }
        if (Date.now() - saiuDaApresentacaoEm.current < 1000) return
        if (isPublic) return
        navigate(`/proposta/${id}/editar`)
      }
    }
    // "capture": a apresentação recebe a tecla antes de qualquer botão da página — um botão com
    // foco (ex.: o "Apresentar" recém-clicado) não "engole" mais o espaço
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  /**
   * O vídeo do YouTube fica dentro de um "quadro" separado da página. Depois de clicar nele, o
   * teclado passa a falar só com o vídeo, e as setas pararam de trocar de slide até alguém clicar
   * fora. Ao mudar de slide, o foco volta para a apresentação.
   */
  useEffect(() => {
    if (document.activeElement?.tagName === 'IFRAME') document.activeElement.blur()
  }, [index])

  useEffect(() => {
    if (!slideNovoId) return
    const idx = visibleSlides.findIndex((x) => x.id === slideNovoId)
    if (idx < 0) return
    setIndex(idx)
    setRevealCount(999)
    setEditing(true)
    setSlideNovoId(null)
  }, [slideNovoId, visibleSlides])

  function jumpToId(slideId) {
    const idx = visibleSlides.findIndex((s) => s.id === slideId)
    if (idx < 0) return
    // trocar de slide com o painel aberto descarta o que não foi salvo — pergunta antes
    if (editing && slideId !== slide?.id && previa?.alterado && !confirm('Trocar de slide sem salvar? O que você mudou neste slide será descartado.')) return
    setIndex(idx)
    setRevealCount(999)
  }

  /**
   * Nome do slide na lista lateral, escolhido pela pessoa. É só um apelido para se achar na
   * lista: não muda o título que aparece dentro do slide. Fica guardado nesta proposta.
   * Nome vazio volta ao nome automático (o título do slide).
   */
  function renomearSlide(slideId, nome) {
    updateProposal((prev) => {
      const nomes = { ...(prev.slideNames || {}) }
      const limpo = String(nome || '').trim()
      if (limpo) nomes[slideId] = limpo
      else delete nomes[slideId]
      return { ...prev, slideNames: nomes }
    })
  }

  function reorder(fromIdx, toIdx) {
    updateProposal((prev) => {
      const ids = slides.map((s) => s.id)
      const [moved] = ids.splice(fromIdx, 1)
      ids.splice(toIdx, 0, moved)
      return { ...prev, slideOrder: ids }
    })
  }

  function saveOverridePerProposal(slideId, patch) {
    updateProposal((prev) => {
      const overrides = { ...(prev.slideOverrides || {}), [slideId]: { ...(prev.slideOverrides?.[slideId] || {}), ...patch } }
      return { ...prev, slideOverrides: overrides }
    })
  }

  /**
   * Salva a edição de um slide no nível escolhido:
   *   'proposal'  → só nesta proposta
   *   'tipologia' → em todas as propostas deste tipo de projeto (residencial, comercial…)
   *   'allTypes'  → em todas as propostas, de todos os tipos
   *
   * Nos dois últimos casos a edição vai para o "conteúdo do modelo" da conta, que toda
   * proposta lê ao montar os slides — é por isso que uma foto ou um texto colocado aqui
   * aparece sozinho nas PRÓXIMAS propostas, sem precisar refazer nada.
   */
  /**
   * O slide "sobre mim" é montado com os dados da pessoa (nome, texto e registro), que moram
   * em Configurações — e não no modelo de apresentação. Editar pelo slide grava lá também,
   * senão a edição valeria só na apresentação e os dois lugares ficariam divergindo.
   */
  async function espelharSobreMimNasConfiguracoes(patch) {
    const novos = {}
    if (typeof patch.title === 'string') novos.professionalName = patch.title
    if (Array.isArray(patch.items)) {
      const [texto, registro] = patch.items
      if (typeof texto === 'string') novos.bio = texto
      if (typeof registro === 'string') novos.registration = registro
    }
    if (!Object.keys(novos).length) return
    const atualizado = { ...settings, ...novos }
    setSettings(atualizado)
    await saveSettings(atualizado).catch((err) => console.error(err))
  }

  async function saveSlideByScope(slideId, patch, scope, slideType) {
    if (slideId === 'about') await espelharSobreMimNasConfiguracoes(patch)
    if (!scope || scope === 'proposal') {
      saveOverridePerProposal(slideId, patch)
      return
    }
    const bucket = scope === 'tipologia' ? (proposal?.tipologia || 'residencial') : 'all'

    // slide extra salvo para as outras propostas: ele deixa de ser "desta proposta" e passa a
    // fazer parte do modelo (aparece sozinho nas próximas). Guardamos o slide inteiro, não só
    // o patch, porque ele não é montado a partir dos dados do projeto como os demais.
    // uma CÓPIA salva para as outras propostas: o conteúdo editado segue o caminho normal
    // (vai pro padrão, mais abaixo), mas a existência dela — o par { id, copyOf } — também
    // precisa ir pro modelo, senão a cópia continuaria existindo só nesta proposta e a
    // pessoa salvaria "para todas" sem ela aparecer em lugar nenhum.
    const copiaAtual = slides.find((x) => x.id === slideId && x.isCopy)
    if (copiaAtual) {
      const referencia = { id: slideId, copyOf: copiaAtual.copyOf }
      updateProposal((prev) => ({
        ...prev,
        customSlides: (prev.customSlides || []).filter((c, i) => (c.id || `custom-${i}`) !== slideId),
      }))
      setTemplateContent((prev) => {
        const todos = { ...(prev?.customSlides || {}) }
        const lista = (todos[bucket] || []).filter((c) => c.id !== slideId)
        todos[bucket] = [...lista, referencia]
        const nextContent = { ...(prev || {}), customSlides: todos }
        saveTemplateContent(nextContent).catch((err) => { console.error(err); alert(scopeSaveErrorMessage(err)) })
        return nextContent
      })
    }

    if (slideType === 'custom' && !copiaAtual) {
      const atual = slides.find((x) => x.id === slideId) || {}
      const completo = { ...atual, ...patch, id: slideId, type: 'custom' }
      delete completo.deadlines
      updateProposal((prev) => {
        const overrides = { ...(prev.slideOverrides || {}) }
        delete overrides[slideId]
        return {
          ...prev,
          slideOverrides: overrides,
          customSlides: (prev.customSlides || []).filter((c, i) => (c.id || `custom-${i}`) !== slideId),
        }
      })
      return new Promise((resolve) => {
        setTemplateContent((prev) => {
          const todos = { ...(prev?.customSlides || {}) }
          const lista = (todos[bucket] || []).filter((c) => c.id !== slideId)
          todos[bucket] = [...lista, completo]
          const nextContent = { ...(prev || {}), customSlides: todos }
          saveTemplateContent(nextContent)
            .then(resolve)
            .catch((err) => { console.error(err); alert(scopeSaveErrorMessage(err)); resolve() })
          return nextContent
        })
      })
    }

    // a capa (e a solicitação do cliente) misturam material de apresentação — a foto, as
    // cores — com texto montado a partir dos dados DESTE cliente. Só a primeira parte pode
    // virar padrão das outras propostas; o nome do cliente fica sempre preso a esta.
    const clientKeys = CLIENT_FIELDS_BY_SLIDE[slideId] || []
    const templatePatch = {}
    const localPatch = {}
    Object.entries(patch).forEach(([k, v]) => {
      if (clientKeys.includes(k)) localPatch[k] = v
      else templatePatch[k] = v
    })

    // se esta proposta tinha uma edição própria pros mesmos campos, ela venceria a nova
    // regra geral e daria a impressão de que "não salvou" — então limpamos esses campos
    // do override desta proposta antes de gravar o padrão (e, no mesmo passo, guardamos
    // os campos que continuam sendo só desta proposta)
    updateProposal((prev) => {
      const current = prev.slideOverrides?.[slideId] || {}
      const cleaned = { ...current }
      Object.keys(templatePatch).forEach((k) => { delete cleaned[k] })
      Object.assign(cleaned, localPatch)
      const overrides = { ...(prev.slideOverrides || {}) }
      if (Object.keys(cleaned).length) overrides[slideId] = cleaned
      else delete overrides[slideId]
      return { ...prev, slideOverrides: overrides }
    })

    if (!Object.keys(templatePatch).length) return

    return new Promise((resolve) => {
      setTemplateContent((prev) => {
        const slideDefaults = { ...(prev?.slideDefaults || {}) }
        slideDefaults[bucket] = {
          ...(slideDefaults[bucket] || {}),
          [slideId]: { ...(slideDefaults[bucket]?.[slideId] || {}), ...templatePatch },
        }
        const nextContent = { ...(prev || {}), slideDefaults }
        // textos que também vivem em Configurações > Textos padrão continuam sincronizados
        if (scope === 'allTypes' && SHARED_TEXT_SLIDES.has(slideId)) {
          nextContent.shared = mapPatchToSharedContent(slideId, templatePatch, { ...DEFAULT_SHARED_TEXT, ...(prev?.shared || {}) })
        }
        saveTemplateContent(nextContent)
          .then(resolve)
          .catch((err) => {
            console.error(err)
            alert(scopeSaveErrorMessage(err))
            resolve()
          })
        return nextContent
      })
    })
  }

  /** Salva o vídeo principal no nível certo: só esta proposta, este tipo de projeto, ou todos os tipos. */
  /** Atualiza campos de "Dados do projeto" direto pelo slide (ex: Objetivo do projeto),
   *  garantindo que fique sincronizado com a aba "Dados do projeto" do editor. */
  async function saveFieldsPatch(patch) {
    return updateProposal((prev) => ({ ...prev, fields: { ...(prev.fields || {}), ...patch } }))
  }

  /** Atualiza a visibilidade de pacotes/formas de pagamento (mesmo dado da aba "Preços a mostrar" do editor).
   *  Quando packageId é informado, a mudança vale só para aquele pacote. */
  function saveVisibilityPatch(patch, packageId) {
    updateProposal((prev) => {
      let visibility = { ...(prev.visibility || {}) }
      if (packageId && patch.payments) {
        visibility = {
          ...visibility,
          paymentsByPackage: {
            ...(visibility.paymentsByPackage || {}),
            [packageId]: { ...(visibility.paymentsByPackage?.[packageId] || visibility.payments || {}), ...patch.payments },
          },
        }
      } else {
        visibility = { ...visibility, ...patch, payments: { ...(visibility.payments || {}), ...(patch.payments || {}) } }
      }
      return { ...prev, visibility }
    })
  }

  async function saveVideoByScope(scope, patch) {
    if (scope === 'proposal') {
      saveOverridePerProposal('video', patch)
      return
    }

    // o conteúdo do modelo guarda o link com o nome "videoEmbedUrl" (é o que a resolução em
    // cascata lá em cima procura); o painel manda como "embedUrl". Traduz aqui, num lugar só.
    const templatePatch = {
      videoUrl: patch.videoUrl || '',
      videoPath: patch.videoPath || '',
      videoEmbedUrl: patch.embedUrl || '',
    }

    // um vídeo salvo antes "só nesta proposta" venceria o padrão que está sendo gravado agora
    // (inclusive um link apagado, que fica salvo como vazio) — então limpa esse resto primeiro,
    // senão dá a impressão de que salvar para as outras propostas não funcionou
    updateProposal((prev) => {
      const overrides = { ...(prev.slideOverrides || {}) }
      const tinhaOverride = !!overrides.video
      delete overrides.video
      if (!tinhaOverride && !prev.videoUrl && !prev.videoEmbedUrl) return prev
      return { ...prev, slideOverrides: overrides, videoUrl: '', videoEmbedUrl: '' }
    })

    return new Promise((resolve) => {
      setTemplateContent((prev) => {
        const nextContent = scope === 'tipologia'
          ? {
              ...(prev || {}),
              images: {
                ...(prev?.images || {}),
                [proposal.tipologia]: { ...(prev?.images?.[proposal.tipologia] || {}), ...templatePatch },
              },
            }
          : { ...(prev || {}), sharedVideo: { ...(prev?.sharedVideo || {}), ...templatePatch } }
        saveTemplateContent(nextContent)
          .then(resolve)
          .catch((err) => { console.error(err); alert(scopeSaveErrorMessage(err)); resolve() })
        return nextContent
      })
    })
  }

  function toggleHidden(slideId) {
    updateProposal((prev) => {
      const hidden = new Set(prev.hiddenSlides || [])
      hidden.has(slideId) ? hidden.delete(slideId) : hidden.add(slideId)
      return { ...prev, hiddenSlides: [...hidden] }
    })
  }

  /**
   * Gerar o link e copiar o link são duas coisas diferentes, e antes um erro em qualquer uma
   * das duas virava a mesma mensagem ("não consegui gerar o link"). Na prática o que falhava
   * quase sempre era só a CÓPIA: a área de transferência do navegador exige permissão, janela
   * em foco e contexto seguro, e recusa em várias situações (app instalado, aba sem foco,
   * navegador embutido). Agora, se o link foi gerado mas a cópia falhar, ele aparece na tela
   * para copiar à mão — em vez de a pessoa achar que o link não existe.
   */
  async function handleCopyLink() {
    let url = ''
    try {
      if (!proposal.public) {
        await setProposalPublic(id, true)
        setProposal((prev) => ({ ...prev, public: true }))
      }
      const uidForLink = auth.currentUser?.uid
      if (!uidForLink) throw new Error('sessão expirada')
      url = `${window.location.origin}/#/ver/${uidForLink}/${id}`
    } catch (err) {
      console.error(err)
      alert(`Não consegui liberar esta proposta para o link do cliente (${err?.message || 'erro desconhecido'}). Confira a conexão e tente de novo.`)
      return
    }
    if (await copiarParaAreaDeTransferencia(url)) {
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 3000)
    } else {
      setLinkModalUrl(url)
    }
  }

  /**
   * Remove um slide extra de vez: ele pode estar guardado na proposta, no modelo (quando foi
   * salvo "para todas as propostas" ou para um tipo), ou nos dois — então limpamos os dois
   * lugares, senão ele voltaria a aparecer na próxima abertura.
   */
  function excluirSlideExtra(slideId) {
    // vale para slides extras E para cópias: os dois moram na mesma lista
    setEditing(false)
    updateProposal((prev) => {
      const overrides = { ...(prev.slideOverrides || {}) }
      delete overrides[slideId]
      return {
        ...prev,
        slideOverrides: overrides,
        customSlides: (prev.customSlides || []).filter((c, i) => (c.id || `custom-${i}`) !== slideId),
        slideOrder: (prev.slideOrder || []).filter((sid) => sid !== slideId),
        hiddenSlides: (prev.hiddenSlides || []).filter((sid) => sid !== slideId),
      }
    })
    setTemplateContent((prev) => {
      const atuais = prev?.customSlides
      if (!atuais) return prev
      const todos = {}
      let mudou = false
      Object.entries(atuais).forEach(([bucket, lista]) => {
        const filtrada = (lista || []).filter((c) => c.id !== slideId)
        if (filtrada.length !== (lista || []).length) mudou = true
        todos[bucket] = filtrada
      })
      if (!mudou) return prev
      const nextContent = { ...prev, customSlides: todos }
      saveTemplateContent(nextContent).catch((err) => { console.error(err); alert(scopeSaveErrorMessage(err)) })
      return nextContent
    })
  }

  /**
   * Duplica qualquer slide — inclusive os que vêm prontos. A cópia guarda só a referência ao
   * original ({ copyOf }); tudo que for editado nela fica guardado junto e é aplicado por cima
   * na hora de montar. Ela aparece logo abaixo do original, é editável e salvável como
   * qualquer outra, e — por não ser um slide de fábrica — pode ser excluída.
   */
  function duplicarSlide(slideId) {
    const original = slides.find((x) => x.id === slideId)
    if (!original) return
    const copia = {
      id: `copia-${Date.now().toString(36)}`,
      copyOf: original.copyOf || slideId,
      title: original.title ? `${original.title} (cópia)` : 'Cópia',
    }
    updateProposal((prev) => ({ ...prev, customSlides: [...(prev.customSlides || []), copia], slideOrder: ordemComNovoDepoisDe(slideId, copia.id) }))
    setSlideNovoId(copia.id)
  }

  /**
   * Ordem dos slides com um slide novo encaixado logo DEPOIS de outro (o que está na tela, ou o
   * que foi duplicado). Antes o slide novo ia para o fim da apresentação e era preciso arrastá-lo
   * de volta até o lugar certo. Grava a ordem completa, do jeito que já é feito ao arrastar.
   */
  function ordemComNovoDepoisDe(idReferencia, idNovo) {
    const ids = slides.map((s) => s.id).filter((sid) => sid !== idNovo)
    const pos = ids.indexOf(idReferencia)
    ids.splice(pos >= 0 ? pos + 1 : ids.length, 0, idNovo)
    return ids
  }

  /** Cria um slide extra já dentro da apresentação, pula pra ele e abre a edição. */
  function novoSlide() {
    // nasce no formato livre: página inteira, tópicos à esquerda, centralizados na altura —
    // a pessoa muda posição, formato do texto e divide a página no "Editar slide"
    const novo = {
      id: `custom-${Date.now().toString(36)}`,
      title: 'Novo slide', layoutMode: 'inteiro',
      blocos: [{ formato: 'topicos', itens: [''], alinhH: 'left', alinhV: 'center' }, { formato: 'topicos', itens: [''] }],
    }
    updateProposal((prev) => ({ ...prev, customSlides: [...(prev.customSlides || []), novo], slideOrder: ordemComNovoDepoisDe(slide?.id, novo.id) }))
    setSlideNovoId(novo.id)
  }

  /**
   * Quando o painel manda a pessoa baixar o PDF antes de encerrar a proposta, ele abre a
   * Quando a janela de encerramento precisa do PDF, ela monta esta apresentação invisível
   * (exportOnly). A geração começa sozinha e, ao terminar, fica registrado na proposta que o
   * PDF foi gerado — é isso que destrava o botão de encerrar.
   */
  useEffect(() => {
    if (!exportOnly || !proposal || !settings) return
    if (exportouAutomatico.current) return
    exportouAutomatico.current = true
    handleExportPdf().then((ok) => onExportEnd?.(ok))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportOnly, proposal, settings])

  async function handleExportPdf() {
    setExporting(true)
    try {
      // o PDF fotografa todos os slides, então aqui — e só aqui — as fotos são baixadas de
      // uma vez. Fora disso, cada slide busca as suas quando entra na tela.
      await pedirFotos(coletarRefs(slidesBrutos))
      const { default: html2canvas } = await import('html2canvas')
      const { jsPDF } = await import('jspdf')
      let pdf = null
      for (let i = 0; i < slidesDoPdf.length; i++) {
        setExportIndex(i)
        setExportProgress(i + 1)
        onExportProgress?.(i + 1, slidesDoPdf.length)
        // dá um tempinho para a imagem daquele slide carregar antes de "fotografar"
        await new Promise((resolve) => setTimeout(resolve, 400))
        const node = exportRef.current
        let canvas
        try {
          canvas = await html2canvas(node, {
            width: EXPORT_W, height: EXPORT_H, scale: 2, useCORS: true, allowTaint: true,
            backgroundColor: '#28313C', logging: false, imageTimeout: 15000,
            // iframes (vídeo do YouTube) nunca devem ser capturados — travam o html2canvas
            ignoreElements: (el) => el.tagName === 'IFRAME',
          })
        } catch (slideErr) {
          console.error('Falha ao capturar slide', i, slideErr)
          continue // pula esse slide em vez de derrubar o PDF inteiro
        }
        // 0.95: as plantas têm linhas finas e texto pequeno, que o JPEG mais comprimido
        // borrava — a diferença de tamanho do arquivo é pequena e a leitura melhora bastante
        const img = canvas.toDataURL('image/jpeg', 0.95)
        if (!pdf) pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [EXPORT_W, EXPORT_H] })
        else pdf.addPage([EXPORT_W, EXPORT_H], 'landscape')
        pdf.addImage(img, 'JPEG', 0, 0, EXPORT_W, EXPORT_H)
      }
      if (!pdf) throw new Error('Nenhum slide pôde ser capturado')
      pdf.save(exportFileName(proposal))
      // fica registrado que existe um PDF desta proposta — é o que destrava "Encerrar
      // proposta" no painel. O app não tem como saber se o arquivo foi guardado numa pasta;
      // o que ele sabe, e é o que importa aqui, é que o PDF chegou a ser gerado e baixado.
      if (!isPublic) await updateProposal((prev) => ({ ...prev, pdfExportedAt: new Date().toISOString() }))
      return true
    } catch (err) {
      if (!exportOnly) alert('Não consegui gerar o PDF agora. Tente de novo em alguns segundos.')
      console.error(err)
      return false
    } finally {
      setExporting(false)
    }
  }

  /**
   * Proposta encerrada ou recusada não abre mais a apresentação, nem digitando o endereço
   * direto. Esconder só o botão no painel não bastava: as fotos já foram apagadas, então o
   * que aparecia eram as imagens padrão do modelo — dando a impressão de que a apresentação
   * continuava inteira. A exportação de PDF é a exceção, porque é ela que gera a cópia final
   * dentro da janela de encerramento.
   */
  if (!exportOnly && !isPublic && proposal && (proposal.closed || proposal.status === 'recusada')) {
    return (
      <div className="min-h-screen bg-sand flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 max-w-md w-full border border-line text-center">
          <h1 className="font-display text-2xl text-ink mb-2">Apresentação indisponível</h1>
          <p className="text-sm text-ink/80 mb-6">
            {proposal.closed
              ? 'Esta proposta foi encerrada: a apresentação e as fotos foram apagadas para liberar espaço. Os dados do projeto continuam guardados.'
              : 'Esta proposta foi marcada como recusada, então a apresentação não fica mais disponível.'}
          </p>
          <button onClick={() => navigate('/')} className="text-sm px-5 py-2.5 rounded-full bg-ink text-white">Voltar para as propostas</button>
        </div>
      </div>
    )
  }

  if (!proposal || !settings) {
    if (exportOnly) return null
    return <div className="min-h-screen flex items-center justify-center text-muted">Carregando apresentação…</div>
  }

  // modo gerador: só o nó invisível de onde as páginas são "fotografadas", sem interface
  if (exportOnly) {
    return (
      <div style={{ position: 'fixed', left: -99999, top: 0, width: EXPORT_W, height: EXPORT_H, overflow: 'hidden' }}>
        <div ref={exportRef} className="pdf-export-mode" style={{ width: EXPORT_W, height: EXPORT_H }}>
          {slidesDoPdf[exportIndex] && (
            <SlideView slide={slidesDoPdf[exportIndex]} c1={c1} c2={c2} c3={c3} revealCount={999} settings={settings} exportMode />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-ink text-white select-none overflow-hidden" style={{ ...cssVars, fontFamily: STYLE.bodyFont }}>

      {/* ============ MOBILE (abaixo de "sm"): tela empilhada ============
          tela do slide fixa no topo, ícones fixos logo abaixo, e a lista de slides
          (ou o painel de edição, no lugar dela) preenchendo o resto, rolável. */}
      <div className="sm:hidden h-full flex flex-col">
        <div
          ref={mobileSlideRef}
          className={isFullscreen ? 'relative shrink-0 bg-ink w-full h-full overflow-hidden' : 'relative shrink-0 bg-ink overflow-hidden'}
          style={isFullscreen ? {} : { height: '38vh', minHeight: 220 }}
        >
          <ScaledCanvas onClick={handleAdvance} onSwipeNext={handleAdvance} onSwipePrev={goPrev}>
            <SlideView slide={slideNaTela} c1={c1} c2={c2} c3={c3} revealCount={editing ? 999 : revealCount} settings={settings} />
          </ScaledCanvas>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 pointer-events-none">
            {visibleSlides.map((s, i) => (
              <div key={s.id} className="h-1.5 rounded-full transition-all" style={{ width: i === index ? 22 : 6, background: i === index ? c1 : 'rgba(255,255,255,0.35)' }} />
            ))}
          </div>
          <button onClick={(e) => { e.stopPropagation(); goPrev() }} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/25 flex items-center justify-center">‹</button>
          <button onClick={(e) => { e.stopPropagation(); handleAdvance() }} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/25 flex items-center justify-center">›</button>
          <div className="absolute top-2 right-2 flex items-center gap-1.5">
            <div className="text-[11px] bg-black/40 backdrop-blur px-2 py-1 rounded-full">{index + 1}/{visibleSlides.length}</div>
            <button onClick={(e) => { e.stopPropagation(); toggleMobileFullscreen() }} className="text-[11px] bg-black/40 backdrop-blur w-7 h-7 rounded-full flex items-center justify-center" title="Preencher tela">{isFullscreen ? '⤡' : '⤢'}</button>
          </div>
          {isFullscreen && (
            <button onClick={(e) => { e.stopPropagation(); toggleMobileFullscreen() }} className="absolute top-2 left-2 text-[11px] bg-black/40 backdrop-blur px-2.5 py-1.5 rounded-full">✕ Sair</button>
          )}
        </div>

        {!isFullscreen && (
          <>
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-[#1c232b] border-b border-white/10 overflow-x-auto">
              {!isPublic && (
                <button onClick={() => navigate(`/proposta/${id}/editar`)} className="text-xs bg-white/10 px-3 py-1.5 rounded-full shrink-0">← Sair</button>
              )}
              {!isPublic && podeEditar && (
                <button onClick={() => (editing ? fecharEdicao() : setEditing(true))} className="text-xs px-3 py-1.5 rounded-full shrink-0 transition" style={{ background: editing ? c1 : 'rgba(255,255,255,.1)' }}>✎ {editing ? 'Fechar edição' : 'Editar slide'}</button>
              )}
              {!isPublic && (
                <button onClick={handleCopyLink} className="text-xs bg-white/10 px-3 py-1.5 rounded-full shrink-0">🔗 {linkCopied ? 'Copiado ✓' : 'Link'}</button>
              )}
              {!isPublic && podeEditar && (
                <button onClick={novoSlide} className="text-xs bg-white/10 px-3 py-1.5 rounded-full shrink-0">✚ Novo slide</button>
              )}
              {!isPublic && podeEditar && (
                <button onClick={() => duplicarSlide(slide.id)} className="text-xs bg-white/10 px-3 py-1.5 rounded-full shrink-0">⧉ Duplicar</button>
              )}
              <button disabled={exporting} onClick={handleExportPdf} className="text-xs bg-white/10 px-3 py-1.5 rounded-full shrink-0 disabled:opacity-50">⇩ {exporting ? `Gerando… ${exportProgress}/${slidesDoPdf.length}` : 'Baixar PDF'}</button>
              {!isPublic && (
                <div className="flex items-center gap-1 shrink-0 ml-auto">
                  <button disabled={!historyRef.current.length} onClick={undo} className="text-xs bg-white/10 disabled:opacity-30 w-8 h-8 rounded-full flex items-center justify-center" title="Desfazer">↩</button>
                  <button disabled={!futureRef.current.length} onClick={redo} className="text-xs bg-white/10 disabled:opacity-30 w-8 h-8 rounded-full flex items-center justify-center" title="Refazer">↪</button>
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto bg-[#1c232b]">
              {editing && slide ? (
                <EditPanel
                  key={slide.id}
                  embedded
                  slide={slide}
                  palette={palette}
                  proposal={proposal}
                  allowGlobal={!PROPOSAL_ONLY_SLIDE_TYPES.has(slide.type)}
                  onSave={(patch, scope) => saveSlideByScope(slide.id, patch, scope, slide.type)}
                  onSaveVideoScope={(scope, patch) => saveVideoByScope(scope, patch)}
                  onSaveFields={saveFieldsPatch}
                  onSaveVisibility={saveVisibilityPatch}
                  onDeleteSlide={excluirSlideExtra}
                  onClose={fecharEdicao}
                  onPreview={setPrevia}
                />
              ) : (
                <SlideSidebar
                  embedded
                  slides={isPublic ? visibleSlides : slides}
                  currentId={slide?.id}
                  hiddenIds={hiddenIds}
                  onJump={jumpToId}
                  onToggleHidden={isPublic ? null : toggleHidden}
                  onReorder={isPublic ? null : reorder}
                  nomes={proposal?.slideNames}
                  onRename={isPublic || !podeEditar ? null : renomearSlide}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* ============ DESKTOP ("sm" pra cima): layout original lado a lado ============ */}
      <div className="hidden sm:flex h-full">
        {sidebarOpen && !apresentando && (
          <SlideSidebar
            slides={isPublic ? visibleSlides : slides}
            currentId={slide?.id}
            hiddenIds={hiddenIds}
            onJump={jumpToId}
            onToggleHidden={isPublic ? null : toggleHidden}
            onReorder={isPublic ? null : reorder}
            nomes={proposal?.slideNames}
            onRename={isPublic || !podeEditar ? null : renomearSlide}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        <div className="relative flex-1 min-w-0 overflow-hidden">
          <ScaledCanvas onClick={handleAdvance} onSwipeNext={handleAdvance} onSwipePrev={goPrev}>
            <SlideView slide={slideNaTela} c1={c1} c2={c2} c3={c3} revealCount={editing ? 999 : revealCount} settings={settings} />
          </ScaledCanvas>

          {apresentando && (
            <>
              {/* setas discretas nos cantos de CIMA (e não no meio das laterais, onde ficam fora
                  do modo apresentação): assim não cobrem fotos e textos do slide */}
              <button onClick={(e) => { e.stopPropagation(); goPrev() }} className="absolute top-3 left-3 z-20 w-9 h-9 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur flex items-center justify-center" title="Voltar">‹</button>
              <button onClick={(e) => { e.stopPropagation(); handleAdvance() }} className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur flex items-center justify-center" title="Avançar">›</button>
              {/* canto inferior direito "invisível": não aparece para o cliente, mas passando o
                  mouse (ou tocando, num tablet sem tecla Esc) mostra a saída da apresentação */}
              <button
                onClick={(e) => { e.stopPropagation(); sairApresentacao() }}
                className="absolute bottom-0 right-0 z-20 px-4 py-3 text-xs opacity-0 hover:opacity-100 focus:opacity-100 transition"
              >
                <span className="bg-black/50 backdrop-blur px-3 py-1.5 rounded-full">✕ Sair da apresentação</span>
              </button>
              {dicaSair && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 text-xs bg-black/60 backdrop-blur px-3 py-1.5 rounded-full pointer-events-none">
                  Clique ou use as setas para avançar · Esc para sair
                </div>
              )}
            </>
          )}

          {!apresentando && (<>
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-2 sm:px-4 py-2 sm:py-3 pointer-events-none gap-1 sm:gap-2">
            <div className="flex items-center gap-1 sm:gap-2 pointer-events-auto">
              {!sidebarOpen && (
                <button onClick={(e) => { e.stopPropagation(); setSidebarOpen(true) }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-2.5 sm:px-3 py-1.5 rounded-full transition">☰<span className="hidden sm:inline"> Slides</span></button>
              )}
              {!isPublic && (
                <button onClick={(e) => { e.stopPropagation(); navigate(`/proposta/${id}/editar`) }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-2.5 sm:px-3 py-1.5 rounded-full transition">← <span className="hidden sm:inline">Sair</span></button>
              )}
            </div>
            <div className="flex items-center gap-1 sm:gap-2 pointer-events-auto overflow-x-auto max-w-[70vw] sm:max-w-none">
              {/* primeiro botão e com a cor da marca: é o que se usa na frente do cliente */}
              <button onClick={(e) => { e.stopPropagation(); entrarApresentacao() }} className="text-xs px-2.5 sm:px-3 py-1.5 rounded-full transition shrink-0 font-medium hover:opacity-90" style={{ background: c1 }}>
                ▶<span className="hidden sm:inline"> Apresentar</span>
              </button>
              {!isPublic && (
                <>
                  {podeEditar && (
                    <button onClick={(e) => { e.stopPropagation(); if (editing) fecharEdicao(); else setEditing(true) }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-2.5 sm:px-3 py-1.5 rounded-full transition shrink-0">✎<span className="hidden sm:inline"> {editing ? 'Fechar edição' : 'Editar slide'}</span></button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); handleCopyLink() }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-2.5 sm:px-3 py-1.5 rounded-full transition shrink-0">
                    🔗<span className="hidden sm:inline"> {linkCopied ? 'Link copiado ✓' : 'Link para o cliente'}</span>
                  </button>
                  {podeEditar && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); novoSlide() }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-2.5 sm:px-3 py-1.5 rounded-full transition shrink-0">
                        ✚<span className="hidden sm:inline"> Novo slide</span>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); duplicarSlide(slide.id) }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-2.5 sm:px-3 py-1.5 rounded-full transition shrink-0">
                        ⧉<span className="hidden sm:inline"> Duplicar</span>
                      </button>
                    </>
                  )}
                </>
              )}
              <button disabled={exporting} onClick={(e) => { e.stopPropagation(); handleExportPdf() }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-2.5 sm:px-3 py-1.5 rounded-full transition disabled:opacity-50 shrink-0">
                ⇩<span className="hidden sm:inline"> {exporting ? `Gerando PDF… ${exportProgress}/${slidesDoPdf.length}` : 'Baixar PDF'}</span>
              </button>
              {!isPublic && (
                <>
                  <button disabled={!historyRef.current.length} onClick={(e) => { e.stopPropagation(); undo() }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur disabled:opacity-30 w-8 h-8 rounded-full flex items-center justify-center shrink-0" title="Desfazer">↩</button>
                  <button disabled={!futureRef.current.length} onClick={(e) => { e.stopPropagation(); redo() }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur disabled:opacity-30 w-8 h-8 rounded-full flex items-center justify-center shrink-0" title="Refazer">↪</button>
                </>
              )}
              <div className="text-xs bg-black/30 backdrop-blur px-2.5 sm:px-3 py-1.5 rounded-full shrink-0">{index + 1}/{visibleSlides.length}</div>
            </div>
          </div>

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 pointer-events-none">
            {visibleSlides.map((s, i) => (
              <div key={s.id} className="h-1.5 rounded-full transition-all" style={{ width: i === index ? 22 : 6, background: i === index ? c1 : 'rgba(255,255,255,0.35)' }} />
            ))}
          </div>

          <button onClick={(e) => { e.stopPropagation(); goPrev() }} className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur flex items-center justify-center">‹</button>
          <button onClick={(e) => { e.stopPropagation(); handleAdvance() }} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur flex items-center justify-center">›</button>
          </>)}

          {editing && slide && !apresentando && (
            <EditPanel
              key={slide.id}
              slide={slide}
              palette={palette}
              proposal={proposal}
              allowGlobal={!PROPOSAL_ONLY_SLIDE_TYPES.has(slide.type)}
              onSave={(patch, scope) => saveSlideByScope(slide.id, patch, scope, slide.type)}
              onSaveVideoScope={(scope, patch) => saveVideoByScope(scope, patch)}
              onSaveFields={saveFieldsPatch}
              onSaveVisibility={saveVisibilityPatch}
              onDeleteSlide={excluirSlideExtra}
              onClose={fecharEdicao}
              onPreview={setPrevia}
            />
          )}
        </div>
      </div>

      {linkModalUrl && (
        <div className="no-print fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setLinkModalUrl('')}>
          <div className="bg-white text-ink rounded-xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-medium mb-1">Link para o cliente</h3>
            <p className="text-xs text-muted mb-3">O link está pronto. Seu navegador não deixou copiar automaticamente, então copie daqui:</p>
            <input
              readOnly value={linkModalUrl} autoFocus
              onFocus={(e) => e.target.select()}
              className="w-full text-xs p-2.5 rounded-lg border border-line bg-sand outline-none mb-3"
            />
            <div className="flex gap-2">
              <button onClick={() => setLinkModalUrl('')} className="flex-1 text-sm py-2.5 rounded-lg border border-line text-muted">Fechar</button>
              <button
                onClick={async () => { if (await copiarParaAreaDeTransferencia(linkModalUrl)) { setLinkCopied(true); setLinkModalUrl(''); setTimeout(() => setLinkCopied(false), 3000) } }}
                className="flex-1 text-sm py-2.5 rounded-lg bg-clay text-white font-medium"
              >Copiar</button>
            </div>
          </div>
        </div>
      )}

      {/* área invisível usada só para "fotografar" cada slide na hora de gerar o PDF */}
      <div style={{ position: 'fixed', left: -99999, top: 0, width: EXPORT_W, height: EXPORT_H, overflow: 'hidden' }}>
        <div ref={exportRef} className="pdf-export-mode" style={{ width: EXPORT_W, height: EXPORT_H }}>
          {exporting && slidesDoPdf[exportIndex] && (
            <SlideView slide={slidesDoPdf[exportIndex]} c1={c1} c2={c2} c3={c3} revealCount={999} settings={settings} exportMode />
          )}
        </div>
      </div>
    </div>
  )
}

/** Traduz um "patch" (title/items/quote/author) feito num slide para os campos certos
 *  do conteúdo compartilhado (o mesmo texto usado em todas as propostas). */
function mapPatchToSharedContent(slideId, patch, shared) {
  const next = { ...shared }
  if (slideId === 'agenda') {
    if (patch.title !== undefined) next.agendaTitle = patch.title
    if (patch.items) next.agenda = patch.items
  } else if (slideId === 'about') {
    if (patch.title !== undefined) next.aboutTitle = patch.title
    if (patch.items?.[0] !== undefined) next.aboutBody = patch.items[0]
    if (patch.items?.[1] !== undefined) next.aboutRegistration = patch.items[1]
  } else if (slideId === 'reasons') {
    if (patch.title !== undefined) next.reasonsTitle = patch.title
    if (patch.items !== undefined) next.reasons = patch.items
  } else if (slideId === 'journey') {
    if (patch.subtitle !== undefined) next.journeySubtitle = patch.subtitle
    if (patch.items !== undefined) next.journey = patch.items
  } else if (slideId === 'stages') {
    if (patch.title !== undefined) next.stagesTitle = patch.title
    if (patch.stages !== undefined) next.stages = patch.stages
    if (patch.footnote !== undefined) next.observations = patch.footnote
  } else if (slideId === 'feedbacks') {
    if (patch.title !== undefined) next.feedbacksTitle = patch.title
    if (patch.items !== undefined) next.feedbacks = patch.items
  } else if (slideId === 'closing') {
    if (patch.title !== undefined) next.closingHeadline = patch.title
    if (patch.quote !== undefined) next.closingQuote = patch.quote
    if (patch.author !== undefined) next.closingAuthor = patch.author
  }
  return next
}

function getItemsLength(slide) {
  if (!slide) return 0
  // capa e "sobre mim" agora mostram os textos juntos, sem precisar clicar —
  // então um clique já avança pro próximo slide, sem etapas escondidas no meio
  if (slide.type === 'cover' || slide.type === 'profile') return 0
  // antes e depois: o "Antes" já abre na tela e o "Depois" entra com um clique — é a revelação
  // que dá graça a esse tipo de comparação. Sem nada do lado "Depois", não há o que revelar.
  if (slide.type === 'beforeAfter') {
    const temDepois = (slide.rightImages?.length || 0) > 0 || String(slide.rightText || '').trim()
    return temDepois ? 1 : 0
  }
  // slide livre (o "Novo slide" com posição e formato escolhidos): cada tópico, card (ou a
  // descrição) e cada foto entra com um clique, primeiro o lado esquerdo, depois o direito
  if (slide.type === 'custom' && slide.layoutMode && !slide.embedUrl && !slide.videoUrl) {
    return blocosDoSlideLivre(slide).reduce((soma, b) => soma + conteudoDoBloco(b).passos, 0)
  }
  // um feedback só, com fotos do projeto ao lado: aparece tudo junto, já ao abrir
  if (slide.type === 'feedbacks' && slide.feedbackLayout === 'unico') return 0
  // nestes dois, o texto aparece todo de uma vez — quem controla o clique agora são as imagens
  if (slide.type === 'scopeSection' || slide.type === 'modeling') return contagemDeFotos(slide)
  // slide extra sem vídeo usa o mesmo desenho das seções de escopo: o texto aparece inteiro e
  // quem avança um a um são as fotos
  if (slide.type === 'custom' && !slide.embedUrl && !slide.videoUrl) return contagemDeFotos(slide)
  // aqui os textos continuam clicáveis normalmente, mas os cards de valor entram como um passo extra, no final
  if (slide.type === 'pricingCalc') return (slide.hourValue || slide.dayValue) ? 1 : 0
  // o valor + prazo do pacote é o 1º passo; os cards de pagamento vêm depois, um a um
  if (slide.type === 'packagePricing') return (slide.paymentCards?.length || 0) + 1
  if (slide.type === 'packagesSummary') return slide.packages?.length || 0
  // a solicitação do cliente revela os dados um a um (e os ambientes como último passo) —
  // sem contar esses passos aqui, o primeiro clique já pulava para o slide seguinte e os
  // textos nunca chegavam a aparecer
  if (slide.type === 'clientRequest') return (slide.rows?.length || 0) + (slide.ambientes?.length ? 1 : 0)
  if (Array.isArray(slide.items)) return slide.items.length
  if (slide.type === 'stages') return slide.stages?.length || 0
  return 0
}

/**
 * Quantos cliques o slide tem: uma parada por foto. Com uma foto só na lateral, ela já entra
 * junto com o texto (é o desenho de duas colunas), então não há parada nenhuma — senão ficava
 * um clique "vazio" antes de passar de página.
 */
function contagemDeFotos(slide) {
  const imgs = effectiveImages(slide)
  const lateral = slide.imagePlacement === 'left' || slide.imagePlacement === 'right'
  if (imgs.length === 1 && lateral) return 0
  return imgs.length
}

/** Junta o(s) campo(s) de imagem antigos (image/image2) com o novo array "images",
 *  para as propostas mais antigas continuarem funcionando sem precisar reeditar nada. */
function effectiveImages(slide) {
  if (slide.images && slide.images.length) return slide.images
  return [slide.image, slide.image2].filter(Boolean).map((url) => ({ url }))
}

const RATIO_CSS = { '1:1': '1 / 1', '4:5': '4 / 5', '5:4': '5 / 4', '9:16': '9 / 16', '16:9': '16 / 9' }
/** o mesmo formato como número (largura ÷ altura), pra calcular o tamanho das fotos em JS */
const RATIO_NUM = { '1:1': 1, '4:5': 0.8, '5:4': 1.25, '9:16': 9 / 16, '16:9': 16 / 9 }

/* ---------------- BARRA LATERAL DE SLIDES ---------------- */

function SlideSidebar({ slides, currentId, hiddenIds, onJump, onToggleHidden, onReorder, onClose, nomes = {}, onRename, embedded = false }) {
  const dragFrom = useRef(null)
  const canManage = !!onReorder
  // slide sendo renomeado agora (só um por vez) e o texto digitado até confirmar
  const [renomeando, setRenomeando] = useState(null)
  const [nomeDigitado, setNomeDigitado] = useState('')
  const nomeDe = (s) => nomes?.[s.id] || s.title || slideFallbackLabel(s)
  function comecarRenomear(s) {
    if (!onRename) return
    setRenomeando(s.id)
    setNomeDigitado(nomeDe(s))
  }
  function confirmarRenomear() {
    if (renomeando) onRename(renomeando, nomeDigitado)
    setRenomeando(null)
  }

  return (
    <div className={embedded ? 'w-full h-full bg-[#1c232b] flex flex-col' : 'w-56 shrink-0 bg-[#1c232b] border-r border-white/10 flex flex-col'}>
      {!embedded && (
        <div className="flex items-center justify-between px-3 py-3 border-b border-white/10">
          <span className="text-xs uppercase tracking-wide text-white/50">Slides</span>
          <button onClick={onClose} className="text-white/50 hover:text-white text-xs">ocultar ✕</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-2">
        {slides.map((s, i) => {
          const hidden = hiddenIds.has(s.id)
          return (
            <div
              key={s.id}
              // enquanto renomeia, a linha não pode ser arrastada: senão selecionar o texto com o
              // mouse viraria um "arrastar slide"
              draggable={canManage && renomeando !== s.id}
              onDragStart={() => (dragFrom.current = i)}
              onDragOver={(e) => canManage && e.preventDefault()}
              onDrop={() => { if (canManage && dragFrom.current !== null && dragFrom.current !== i) onReorder(dragFrom.current, i); dragFrom.current = null }}
              className={`group mx-2 mb-1 px-2.5 py-2 rounded-lg flex items-center gap-2 text-xs transition ${s.id === currentId ? 'bg-white/15 text-white' : hidden ? 'text-white/30' : 'text-white/60 hover:bg-white/5'}`}
              title={canManage && renomeando !== s.id ? (onRename ? 'Arraste para reordenar · dois cliques para renomear' : 'Arraste para reordenar') : undefined}
            >
              <span className="text-white/30 text-[10px] w-4 text-center shrink-0">{i + 1}</span>
              {renomeando === s.id ? (
                <input
                  autoFocus
                  value={nomeDigitado}
                  onChange={(e) => setNomeDigitado(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') confirmarRenomear()
                    if (e.key === 'Escape') setRenomeando(null)
                  }}
                  onBlur={confirmarRenomear}
                  onFocus={(e) => e.target.select()}
                  placeholder="Vazio = nome automático"
                  className="flex-1 min-w-0 bg-white text-ink text-xs px-2 py-1 rounded outline-none"
                />
              ) : (
                <span
                  onClick={() => !hidden && onJump(s.id)}
                  onDoubleClick={() => comecarRenomear(s)}
                  className={`flex-1 flex items-center gap-2 min-w-0 ${hidden ? 'cursor-default' : 'cursor-pointer'}`}
                >
                  <span>{SLIDE_ICONS[s.type] || '•'}</span>
                  <span className="truncate">{nomeDe(s)}</span>
                </span>
              )}
              {onRename && renomeando !== s.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); comecarRenomear(s) }}
                  // no computador o lápis só aparece com o mouse em cima da linha (lista mais limpa);
                  // no celular não existe "mouse em cima", então ele fica sempre visível
                  className={`shrink-0 text-white/40 hover:text-white text-xs transition ${embedded ? '' : 'opacity-0 group-hover:opacity-100'}`}
                  title="Renomear na lista"
                >✎</button>
              )}
              {onToggleHidden && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleHidden(s.id) }}
                  className="shrink-0 text-white/40 hover:text-white text-xs"
                  title={hidden ? 'Mostrar esta página' : 'Ocultar esta página'}
                >{hidden ? '🚫' : '👁'}</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ColorSwatchRow({ palette, value, onChange }) {
  // remove duplicatas (ex: quando a própria paleta já tem o mesmo bege das cores fixas)
  const seen = new Set()
  const options = [...palette, ...FIXED_SWATCHES.map((s) => s.hex)].filter((hex) => {
    const key = hex.toUpperCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return (
    <div className="flex gap-2 flex-wrap mb-1">
      {options.map((hex, i) => (
        <button
          key={`${hex}-${i}`}
          onClick={() => onChange(hex)}
          title={hex}
          className={`w-7 h-7 rounded-md border-2 transition ${value === hex ? 'border-clay' : 'border-line'}`}
          style={{ background: hex }}
        />
      ))}
      {value && (
        <button onClick={() => onChange('')} className="text-[11px] text-muted hover:text-ink px-2" title="Voltar ao padrão">padrão</button>
      )}
    </div>
  )
}

function slideFallbackLabel(s) {
  if (s.type === 'divider') return s.title
  if (s.type === 'closing') return 'Encerramento'
  if (s.type === 'video') return 'Vídeo'
  // enquanto o nome do profissional não for preenchido em Configurações, o slide "sobre mim"
  // fica sem título — e sem isso apareceria só "profile" na lista lateral
  if (s.type === 'profile') return 'Sobre mim'
  return s.type
}

/* ---------------- PAINEL DE EDIÇÃO RÁPIDA DO SLIDE ---------------- */

function ImagePositionPicker({ image, onChange }) {
  const boxRef = useRef(null)
  const posX = image.posX ?? 50
  const posY = image.posY ?? 50

  function updateFromEvent(e) {
    const rect = boxRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
    onChange({ posX: Math.round(x), posY: Math.round(y) })
  }

  function handlePointerDown(e) {
    e.preventDefault()
    updateFromEvent(e)
    const onMove = (ev) => updateFromEvent(ev)
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      ref={boxRef}
      onPointerDown={handlePointerDown}
      className="relative w-full h-32 rounded-lg overflow-hidden cursor-crosshair border border-line select-none"
      style={{ aspectRatio: RATIO_CSS[image.ratio] || undefined }}
      title="Clique e arraste para escolher o enquadramento"
    >
      <img src={image.url} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" style={{ objectPosition: `${posX}% ${posY}%` }} />
      <div className="absolute w-4 h-4 rounded-full border-2 border-white shadow pointer-events-none" style={{ left: `calc(${posX}% - 8px)`, top: `calc(${posY}% - 8px)`, background: '#B85C3E' }} />
    </div>
  )
}

const COLOR_CUSTOMIZABLE_TYPES = new Set(['cover', 'divider', 'agenda', 'profile', 'clientRequest', 'reasons', 'scopeSection', 'scopeSplit', 'modeling', 'journeyFlow', 'stages', 'feedbacks', 'pricingCalc', 'packagePricing', 'packagesSummary', 'custom', 'closing', 'beforeAfter'])

/** formatos de foto oferecidos nas listas de fotos (mesmos usados no resto do sistema) */
const RATIO_OPCOES = [
  ['', 'Preencher o espaço'],
  ['1:1', '1:1 — quadrado'],
  ['4:5', '4:5 — retrato'],
  ['5:4', '5:4 — paisagem'],
  ['9:16', '9:16 — vertical'],
  ['16:9', '16:9 — widescreen'],
]

/** Os campos do "Antes e depois" num objeto só, para o painel editar e salvar juntos. */
function lerAntesDepois(slide) {
  return {
    leftTitle: slide.leftTitle ?? 'Antes',
    leftText: slide.leftText || '',
    leftImages: JSON.parse(JSON.stringify(slide.leftImages || [])),
    rightTitle: slide.rightTitle ?? 'Depois',
    rightText: slide.rightText || '',
    rightImages: JSON.parse(JSON.stringify(slide.rightImages || [])),
  }
}

/**
 * Lista de fotos com limite (ex.: até 4), cada uma com trocar/remover, ajuste de enquadramento
 * e formato. setFotos recebe uma função que devolve a nova lista — necessário porque várias
 * fotos escolhidas de uma vez terminam de comprimir cada uma no seu tempo, e cada uma precisa
 * entrar na lista mais atual, senão uma apagaria a outra.
 */
function ListaDeFotosEditor({ fotos, setFotos, max, onPickFile, formatoPadrao = '' }) {
  return (
    <div className="mb-2">
      {fotos.map((f, i) => (
        <div key={i} className="border border-line rounded-lg p-2 mb-2">
          <SingleImageField
            compact previewClass="w-full h-24"
            value={f}
            onChange={(next) => setFotos((prev) => (next.url
              ? prev.map((x, k) => (k === i ? { ...x, ...next } : x))
              : prev.filter((_, k) => k !== i)))}
            onPickFile={onPickFile}
          />
          <select
            value={f.ratio || ''}
            onChange={(e) => { const ratio = e.target.value; setFotos((prev) => prev.map((x, k) => (k === i ? { ...x, ratio } : x))) }}
            className="text-xs border border-line rounded px-2 py-1.5 w-full mt-2"
          >
            {RATIO_OPCOES.map(([v, rotulo]) => <option key={v} value={v}>{rotulo}</option>)}
          </select>
        </div>
      ))}
      {fotos.length < max && (
        <label className="text-xs cursor-pointer text-clay font-medium block">
          + adicionar foto ({fotos.length}/{max})
          <input type="file" accept="image/*" multiple hidden onChange={(e) => {
            const arquivos = Array.from(e.target.files || []).slice(0, max - fotos.length)
            arquivos.forEach((file) => onPickFile(file, (url) => setFotos((prev) => (prev.length >= max ? prev : [...prev, { url, posX: 50, posY: 50, ratio: formatoPadrao }]))))
            e.target.value = ''
          }} />
        </label>
      )}
    </div>
  )
}

/** Botões de escolha (um ativo por vez), usados para formato da página, do texto e posição. */
function Escolha({ opcoes, valor, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap mb-3">
      {opcoes.map(([v, rotulo]) => (
        <button
          key={v} type="button" onClick={() => onChange(v)}
          className={`text-xs px-2.5 py-1.5 rounded-full border transition ${valor === v ? 'bg-ink text-white border-ink' : 'border-line hover:bg-sand'}`}
        >{rotulo}</button>
      ))}
    </div>
  )
}

/** Editor de um bloco do slide livre (página inteira, ou um dos lados da página dividida). */
function EditorDeBloco({ rotulo, bloco, setBloco, titulo, onTitulo, corFundo, onCorFundo, corTexto, onCorTexto, palette, maxFotos, onPickFile }) {
  const formato = bloco.formato || 'topicos'
  const itens = bloco.itens || ['']
  const cards = bloco.cards || [{ titulo: '', texto: '' }]
  const campo = 'w-full text-sm p-2 rounded-lg border border-line outline-none focus:border-clay'
  return (
    <div className="border border-line rounded-lg p-3 mb-3">
      {rotulo && <div className="text-sm font-semibold mb-3 pb-2 border-b border-line">{rotulo}</div>}
      <label className="text-xs font-medium text-ink/70 block mb-1">Título</label>
      <textarea value={titulo} rows={2} onChange={(e) => onTitulo(e.target.value)} className={`${campo} mb-1`} />
      <p className="text-[11px] text-muted mb-3">Enter quebra o título em mais de uma linha. Deixe vazio para não ter título.</p>

      <label className="text-xs font-medium text-ink/70 block mb-1">Cor do fundo</label>
      <ColorSwatchRow palette={palette} value={corFundo} onChange={onCorFundo} />
      <label className="text-xs font-medium text-ink/70 block mb-1 mt-2">Cor do texto</label>
      <ColorSwatchRow palette={palette} value={corTexto} onChange={onCorTexto} />
      <div className="mb-3" />

      <label className="text-xs font-medium text-ink/70 block mb-1">Formato do texto</label>
      <Escolha
        valor={formato}
        onChange={(v) => setBloco((b) => ({ ...b, formato: v }))}
        opcoes={[['topicos', 'Tópicos'], ['descricao', 'Descrição grande'], ['cards', 'Cards'], ['nenhum', 'Sem texto']]}
      />

      {formato === 'topicos' && (
        <div className="mb-3">
          {itens.map((t, i) => (
            <div key={i} className="flex gap-1.5 mb-1.5 items-start">
              {/* caixa que cresce com o texto: Enter escreve na linha de baixo do MESMO tópico */}
              <textarea
                value={t} rows={Math.max(1, String(t || '').split('\n').length)}
                onChange={(e) => { const v = e.target.value; setBloco((b) => ({ ...b, itens: (b.itens || ['']).map((x, k) => (k === i ? v : x)) })) }}
                className={`${campo} resize-none`} placeholder={`Tópico ${i + 1}`}
              />
              <button onClick={() => setBloco((b) => ({ ...b, itens: (b.itens || ['']).filter((_, k) => k !== i) }))} className="text-xs text-red-600 shrink-0 mt-2">✕</button>
            </div>
          ))}
          <button onClick={() => setBloco((b) => ({ ...b, itens: [...(b.itens || ['']), ''] }))} className="text-xs text-clay">+ tópico</button>
          <p className="text-[11px] text-muted mt-1">Enter continua o mesmo tópico na linha de baixo; "+ tópico" cria outro.</p>
        </div>
      )}

      {formato === 'descricao' && (
        <textarea value={bloco.texto || ''} rows={5} onChange={(e) => { const texto = e.target.value; setBloco((b) => ({ ...b, texto })) }} className={`${campo} mb-3`} placeholder="Escreva o texto. Enter quebra a linha." />
      )}

      {formato === 'cards' && (
        <div className="mb-3">
          <label className="text-xs font-medium text-ink/70 block mb-1">Cards por linha</label>
          <Escolha
            valor={String(bloco.cardsPorLinha || '')}
            onChange={(v) => setBloco((b) => ({ ...b, cardsPorLinha: v ? Number(v) : '' }))}
            opcoes={[['', 'Automático'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]}
          />
          {cards.map((c, i) => (
            <div key={i} className="border border-line rounded-lg p-2 mb-2">
              <div className="flex gap-1.5 mb-1.5">
                <input value={c.titulo || ''} onChange={(e) => { const v = e.target.value; setBloco((b) => ({ ...b, cards: (b.cards || [{}]).map((x, k) => (k === i ? { ...x, titulo: v } : x)) })) }} className={campo} placeholder="Título do card" />
                <button onClick={() => setBloco((b) => ({ ...b, cards: (b.cards || [{}]).filter((_, k) => k !== i) }))} className="text-xs text-red-600 shrink-0">✕</button>
              </div>
              <textarea value={c.texto || ''} rows={2} onChange={(e) => { const v = e.target.value; setBloco((b) => ({ ...b, cards: (b.cards || [{}]).map((x, k) => (k === i ? { ...x, texto: v } : x)) })) }} className={campo} placeholder="Texto do card" />
            </div>
          ))}
          <button onClick={() => setBloco((b) => ({ ...b, cards: [...(b.cards || [{ titulo: '', texto: '' }]), { titulo: '', texto: '' }] }))} className="text-xs text-clay">+ card</button>
        </div>
      )}

      <label className="text-xs font-medium text-ink/70 block mb-1">Fotos (opcional, até {maxFotos})</label>
      <ListaDeFotosEditor
        fotos={bloco.imagens || []}
        setFotos={(upd) => setBloco((b) => ({ ...b, imagens: upd(b.imagens || []) }))}
        max={maxFotos} onPickFile={onPickFile}
      />

      <label className="text-xs font-medium text-ink/70 block mb-1 mt-2">Posição do texto</label>
      <Escolha valor={bloco.alinhH || 'left'} onChange={(v) => setBloco((b) => ({ ...b, alinhH: v }))} opcoes={[['left', '⇤ Esquerda'], ['center', 'Centro'], ['right', 'Direita ⇥']]} />
      <Escolha valor={bloco.alinhV || 'center'} onChange={(v) => setBloco((b) => ({ ...b, alinhV: v }))} opcoes={[['top', '⤒ Topo'], ['center', 'Meio'], ['bottom', 'Embaixo ⤓']]} />
      {(bloco.imagens || []).length > 0 && <p className="text-[11px] text-muted">Com fotos, o texto fica no topo e as fotos ocupam o espaço abaixo dele.</p>}
    </div>
  )
}

/**
 * Campo de UMA imagem, com pré-visualização, trocar, remover e \"ajustar\" (enquadramento).
 * Usado em todo lugar que tem uma foto só — capa, slides de duas colunas, cards de
 * apresentação, etapas da jornada, feedbacks e pacotes — pra que TODA imagem do sistema
 * tenha o mesmo ajuste de enquadramento, não só as das faixas com várias fotos.
 *
 * value: { url, posX, posY } — posX/posY são a parte da foto que fica visível no recorte.
 */
function SingleImageField({ label, hint, value, onChange, onPickFile, previewClass = 'w-full h-28', compact = false }) {
  const [adjusting, setAdjusting] = useState(false)
  const url = value?.url || ''
  const posX = value?.posX ?? 50
  const posY = value?.posY ?? 50

  return (
    <div className={compact ? '' : 'mb-3'}>
      {label && <label className="text-xs font-medium text-ink/70 block mb-1">{label}</label>}
      {hint && <p className="text-[11px] text-muted mb-1">{hint}</p>}
      {url && (
        <>
          <img src={url} alt="" className={`${previewClass} object-cover rounded-lg mb-1`} style={{ objectPosition: `${posX}% ${posY}%` }} />
          <div className="flex items-center gap-3 mb-1">
            <button onClick={() => setAdjusting((v) => !v)} className="text-xs text-clay">{adjusting ? 'fechar ajuste' : 'ajustar'}</button>
            <button onClick={() => { setAdjusting(false); onChange({ url: '', posX: 50, posY: 50 }) }} className="text-xs text-red-600">remover imagem</button>
          </div>
          {adjusting && (
            <div className="mb-2">
              <p className="text-[11px] text-muted mb-1">Arraste dentro da imagem para escolher o enquadramento</p>
              <ImagePositionPicker image={{ url, posX, posY }} onChange={(patch) => onChange({ ...(value || {}), url, ...patch })} />
            </div>
          )}
        </>
      )}
      <label className="text-xs cursor-pointer text-clay font-medium block">
        {url ? 'Trocar imagem' : '+ adicionar imagem'}
        <input type="file" accept="image/*" hidden onChange={(e) => {
          const file = e.target.files[0]; if (!file) return
          onPickFile(file, (dataUrl) => onChange({ ...(value || {}), url: dataUrl }))
          e.target.value = ''
        }} />
      </label>
    </div>
  )
}

/** Roda uma promise com um prazo máximo — se estourar, rejeita, mesmo que a promise original
 *  nunca "resolva nem falhe" (é o que evita a pessoa ficar presa num "Enviando… 0%" pra sempre). */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

/**
 * Reduz o tamanho da foto ANTES de enviar (redimensiona pro máximo de 1920px no lado maior e
 * comprime como JPEG) — fotos de celular costumam vir com 3000-4000px e vários MB, e isso é o
 * que estava deixando o envio lento. Se der qualquer problema ao comprimir, devolve o arquivo
 * original (mais lento, mas nunca impede de enviar).
 */
/**
 * Reduz o tamanho da foto ANTES de salvar (redimensiona pro máximo de 1400px no lado maior e
 * comprime como JPEG) e devolve já em base64 (data URL) — fotos de celular costumam vir com
 * 3000-4000px e vários MB, e é isso que fazia o envio demorar e o texto final (base64) passar
 * fácil de 1MB, o limite por documento do Firestore. Se der qualquer problema ao comprimir,
 * devolve a foto original (convertida pra base64 do mesmo jeito) — nunca trava o envio.
 */
function resizeImageFile(file, maxDim = 1400, quality = 0.75) {
  function fallbackToDataUrl() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }
  if (!file.type?.startsWith('image/') || file.type === 'image/svg+xml') return fallbackToDataUrl()
  // PNG, WebP e GIF podem ter fundo transparente — nesses casos exporta como PNG (preserva a
  // transparência) em vez de JPEG (que sempre pinta um fundo sólido por baixo, apagando a
  // transparência pra sempre). Fotos comuns (JPEG) continuam virando JPEG, bem mais leve.
  const preserveAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif'
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    const cleanup = () => URL.revokeObjectURL(url)
    img.onload = () => {
      // margem confortável abaixo de 1MB (o limite por documento do Firestore) — PNG não tem
      // um controle de "qualidade" como o JPEG, então se ainda não couber depois de gerar,
      // tenta de novo em tamanhos cada vez menores (até 6 vezes) em vez de desistir e a foto
      // simplesmente não salvar (o que estava fazendo fotos com fundo transparente sumirem
      // silenciosamente ao recarregar a página — o salvamento falhava sem avisar ninguém)
      const TARGET_CHARS = 800000
      function renderAt(dim, q) {
        let { width, height } = img
        if (width > dim || height > dim) {
          if (width > height) { height = Math.round(height * (dim / width)); width = dim }
          else { width = Math.round(width * (dim / height)); height = dim }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        return preserveAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', q)
      }
      let dim = maxDim
      let q = quality
      let out = renderAt(dim, q)
      let attempts = 0
      while (out.length > TARGET_CHARS && attempts < 6) {
        if (!preserveAlpha && q > 0.4) { q = Math.max(0.4, q - 0.15) } else { dim = Math.round(dim * 0.75) }
        out = renderAt(dim, q)
        attempts++
      }
      cleanup()
      resolve(out)
    }
    img.onerror = () => { cleanup(); fallbackToDataUrl().then(resolve) }
    img.src = url
  })
}

/**
 * Antes de gravar um slide, troca toda foto em base64 (data:image/...) por uma referência
 * curta a um documento separado no Firestore — percorre arrays/objetos recursivamente, então
 * funciona pra qualquer formato (um array de imagens, um objeto com .image, etc.) sem precisar
 * saber o formato exato de cada campo.
 */
async function replaceDataUrls(value, proposalId) {
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => replaceDataUrls(v, proposalId)))
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    const resolved = await Promise.all(keys.map((k) => replaceDataUrls(value[k], proposalId)))
    const next = { ...value }
    keys.forEach((k, i) => { next[k] = resolved[i] })
    return next
  }
  if (typeof value === 'string' && value.startsWith('data:image')) {
    return saveImageAsMedia(proposalId, value)
  }
  return value
}

/** Etapas da jornada aceitam o formato antigo (só a URL) e o novo ({ url, posX, posY }). */
const TIPOLOGIA_LABEL = { residencial: 'Residencial', comercial: 'Comercial', corporativo: 'Corporativo' }

function normalizeStepImages(list) {
  return (list || []).map((v) => (typeof v === 'string' ? { url: v } : (v || {})))
}

function EditPanel({ slide, allowGlobal, onSave, onClose, onPreview, palette = DEFAULT_PALETTE, proposal, onSaveVideoScope, onSaveFields, onSaveVisibility, onDeleteSlide, embedded = false }) {
  // slides de material de apresentação já nascem com "todas as propostas, de todos os tipos"
  // selecionado: é o comportamento pedido — o que se coloca aqui deve valer para as próximas
  // propostas também, sem precisar refazer. Slides de um cliente específico continuam
  // sempre presos à proposta (allowGlobal = false).
  const [scope, setScope] = useState(allowGlobal ? lerEscopoSalvo(SCOPE_KEY, 'allTypes') : 'proposal')
  const [title, setTitle] = useState(slide.title || slide.headline || '')
  const [items, setItems] = useState(Array.isArray(slide.items) && typeof slide.items[0] !== 'object' ? [...slide.items] : null)
  const [quote, setQuote] = useState(slide.quote || '')
  const [author, setAuthor] = useState(slide.author || '')
  const [subtitle, setSubtitle] = useState(slide.subtitle || '')
  const [description, setDescription] = useState(slide.description || '')
  const [bgColor, setBgColor] = useState(slide.bgColor || '')
  const [textColor, setTextColor] = useState(slide.textColor || '')
  const [stepImages, setStepImages] = useState(() => normalizeStepImages(slide.stepImages))
  const isStages = slide.type === 'stages'
  const [stages, setStages] = useState(() => (slide.stages ? JSON.parse(JSON.stringify(slide.stages)) : []))
  const [footnote, setFootnote] = useState(slide.footnote || '')
  const isReasons = slide.type === 'reasons'
  const [reasonsList, setReasonsList] = useState(() => (isReasons && Array.isArray(slide.items) ? JSON.parse(JSON.stringify(slide.items)) : []))
  const isFeedbacks = slide.type === 'feedbacks'
  const [feedbacks, setFeedbacks] = useState(() => (isFeedbacks && Array.isArray(slide.items) ? JSON.parse(JSON.stringify(slide.items)) : []))
  // feedbacks: "grade" (vários lado a lado) ou "unico" (um feedback + até 2 fotos do projeto ao lado)
  const [feedbackLayout, setFeedbackLayout] = useState(slide.feedbackLayout || 'grade')
  const [sideImages, setSideImages] = useState(() => JSON.parse(JSON.stringify(slide.sideImages || [])))
  // antes e depois: título, texto e fotos de cada lado, e as cores do lado direito
  const isBeforeAfter = slide.type === 'beforeAfter'
  const [antesDepois, setAntesDepois] = useState(() => lerAntesDepois(slide))
  const [bgColor2, setBgColor2] = useState(slide.bgColor2 || '')
  const [textColor2, setTextColor2] = useState(slide.textColor2 || '')
  // slide livre: página inteira ou dividida, com um bloco de conteúdo por parte. Fica em estado
  // (e não lido direto do slide) porque um slide extra antigo pode ser convertido aqui mesmo.
  const [layoutMode, setLayoutMode] = useState(slide.layoutMode || '')
  const [blocos, setBlocos] = useState(() => JSON.parse(JSON.stringify(slide.blocos || [{}, {}])))
  // página dividida: qual lado está aberto para edição (0 = esquerdo, 1 = direito)
  const [ladoAtivo, setLadoAtivo] = useState(0)

  /**
   * Troca o conteúdo dos dois lados de lugar — título, textos, fotos, posição e cores juntos —
   * para quem começou a montar num lado e quer o conteúdo do outro, sem apagar e refazer.
   * O título do lado esquerdo é o próprio título do slide; o do direito fica no bloco 2.
   */
  function trocarLados() {
    const tituloEsquerdo = title
    setTitle(blocos[1]?.titulo || '')
    setBlocos((prev) => {
      const { titulo: _semTitulo, ...direitoVaiParaEsquerda } = prev[1] || {}
      return [direitoVaiParaEsquerda, { ...(prev[0] || {}), titulo: tituloEsquerdo }]
    })
    setBgColor(bgColor2); setBgColor2(bgColor)
    setTextColor(textColor2); setTextColor2(textColor)
    // a aba acompanha o conteúdo: quem estava editando o lado esquerdo continua vendo o mesmo
    // conteúdo, agora na aba do lado direito
    setLadoAtivo((l) => 1 - l)
  }
  // o slide extra sem vídeo usa o mesmo desenho das seções de escopo, então também ganha a
  // lista de várias fotos (e o "não usar imagem" de verdade)
  const isCustomSemVideo = slide.type === 'custom' && !slide.embedUrl && !slide.videoUrl
  const livre = isCustomSemVideo && !!layoutMode
  const isMultiImage = slide.type === 'scopeSection' || slide.type === 'modeling' || (isCustomSemVideo && !livre)
  // guarda as fotos removidas pelo "não usar imagem" pra poder devolvê-las se desmarcar
  const [imagensGuardadas, setImagensGuardadas] = useState([])
  const [images, setImages] = useState(() => effectiveImages(slide))
  const [imageLayout, setImageLayout] = useState(slide.imageLayout || 'row')
  // com UMA foto só: embaixo do texto (padrão) ou ocupando a lateral, como nos slides de foto fixa
  const [imagePlacement, setImagePlacement] = useState(slide.imagePlacement || 'below')
  const [imagesPerRow, setImagesPerRow] = useState(slide.imagesPerRow || '')
  const [adjustingIdx, setAdjustingIdx] = useState(null)
  const hasSingleImage = 'image' in slide && !isMultiImage && !livre && slide.type !== 'cover'
  const isCover = slide.type === 'cover'
  // a foto única agora carrega o enquadramento junto ({ url, posX, posY }) — é o mesmo
  // objeto usado pelo SingleImageField em todos os outros lugares do painel
  const [kicker, setKicker] = useState(slide.kicker || '')
  const [coverImage, setCoverImage] = useState({ url: slide.image || '', posX: slide.imagePosX, posY: slide.imagePosY })
  const [singleImage, setSingleImage] = useState({ url: slide.image || '', posX: slide.imagePosX, posY: slide.imagePosY })
  const [noImage, setNoImage] = useState(!!slide.noImage)
  const [imagePosition, setImagePosition] = useState(slide.imagePosition || 'left')
  const isClientRequest = slide.type === 'clientRequest'
  const [objetivoProjeto, setObjetivoProjeto] = useState(slide.objetivoProjeto || '')
  const isPackagePricing = slide.type === 'packagePricing'
  // mesmo campo "Benefícios do pacote" que alimenta o card deste pacote no Resumo dos
  // pacotes — editar aqui ou lá atualiza o mesmo lugar (ver isPackagesSummary mais abaixo)
  // juntarTopicos (e não um simples "uma linha por item"): mantém recuadas as linhas de
  // continuação de um tópico com várias linhas, senão elas virariam tópicos novos ao salvar
  const [packageBenefitsText, setPackageBenefitsText] = useState(juntarTopicos(slide.benefits))
  // bônus do pacote: mesmo esquema dos benefícios — mora nos dados do projeto (campo "Bônus -
  // Pacote ..."), então aparece aqui, no Resumo dos pacotes e em Dados do projeto ao mesmo tempo
  const [packageBonusText, setPackageBonusText] = useState(juntarTopicos(slide.bonus))
  const isPackagesSummary = slide.type === 'packagesSummary'
  const [hidePayments, setHidePayments] = useState(!!slide.hidePayments)
  const [hideDescriptions, setHideDescriptions] = useState(!!slide.hideDescriptions)
  const [packageExtras, setPackageExtras] = useState(() => (slide.packages || []).reduce((acc, pkg) => {
    acc[pkg.id] = { ...(slide.packageExtras?.[pkg.id] || {}) }
    return acc
  }, {}))
  // os tópicos de "o que está incluso" são os mesmos que já aparecem no card de cada pacote
  // (slide.packages[].benefits, que vêm dos campos "Benefícios do pacote" de cada pacote) —
  // editar aqui atualiza os mesmos campos, então o que a pessoa vê é sempre o que pode editar
  const [packageBenefits, setPackageBenefits] = useState(() => (slide.packages || []).reduce((acc, pkg) => {
    acc[pkg.id] = juntarTopicos(pkg.benefits)
    return acc
  }, {}))
  const isVideo = slide.type === 'video'
  const [embedUrl, setEmbedUrl] = useState(slide.embedUrl || '')
  const [uploadingCount, setUploadingCount] = useState(0)
  const [scopePopup, setScopePopup] = useState(false)
  const [titleScale, setTitleScale] = useState(Number(slide.titleScale) || 100)
  const [textScale, setTextScale] = useState(Number(slide.textScale) || 100)

  /** Comprime a foto e devolve o base64 pronto pra pré-visualizar aqui no painel — bem rápido,
   *  tudo local, sem rede. O envio de verdade pro Firestore só acontece quando a pessoa aperta
   *  "Salvar" (ver save() mais abaixo), pra não fazer uma viagem de rede por foto adicionada. */
  function handleImageFile(file, onDone) {
    if (!file) return
    setUploadingCount((n) => n + 1)
    withTimeout(resizeImageFile(file), 10000)
      .then((dataUrl) => onDone(dataUrl))
      .catch((err) => {
        console.error(err)
        alert('Não consegui processar essa imagem agora. Tente de novo ou use uma foto menor.')
      })
      .finally(() => setUploadingCount((n) => Math.max(0, n - 1)))
  }
  const [videoScope, setVideoScope] = useState(() => lerEscopoSalvo(VIDEO_SCOPE_KEY, 'proposal'))

  // trocar de slide com o painel aberto recria o painel do zero (o Presenter passa key={slide.id}),
  // então cada campo já nasce com os valores do slide novo. Antes havia aqui um "recomeço" que
  // copiava campo por campo; com a prévia ao vivo, ele fazia o painel parecer "alterado" sem a
  // pessoa ter mexido em nada.

  function addImages(fileList) {
    const files = Array.from(fileList || [])
    files.forEach((file) => {
      handleImageFile(file, (url) => setImages((prev) => [...prev, { url, ratio: '' }]))
    })
  }

  /**
   * "Salvar" nunca grava direto: abre o pop-up perguntando onde a edição deve valer. A
   * pergunta aparece SEMPRE, em todos os slides e em toda edição — antes ela ficava no alto
   * do painel, fora do campo de visão de quem rolou até o fim, e era fácil salvar sem
   * perceber qual opção estava marcada. A última escolha vem pré-marcada só para poupar
   * cliques; a confirmação continua sendo obrigatória.
   */
  function save() { setScopePopup(true) }

  /**
   * Junta tudo o que está no painel em duas partes: "patch" (o que é do slide, salvo no escopo
   * escolhido) e "campos" (o que mora em Dados do projeto). Não grava nada — quem grava é o
   * aplicarSalvamento. A prévia ao vivo usa esta mesma montagem, então o que aparece no slide
   * enquanto se edita é exatamente o que vai ser salvo.
   */
  function montarEdicao() {
    const campos = {}
    const patch = slide.type === 'closing' ? { title, quote, author } : { title }
    patch.titleScale = titleScale
    patch.textScale = textScale
    // tópicos que vêm de "Dados do projeto" voltam para lá (só desta proposta), em vez de
    // virarem uma cópia no slide — assim o slide e os dados nunca mais ficam diferentes
    if (items && slide.fieldCode) campos[slide.fieldCode] = juntarTopicos(items)
    else if (items && !livre) patch.items = items
    if (slide.type === 'divider') { patch.subtitle = subtitle }
    if (slide.type === 'journeyFlow') { patch.subtitle = subtitle }
    if (isClientRequest) { campos.objetivoProjeto = objetivoProjeto }
    // mesmo campo "Benefícios do pacote" usado no card deste pacote no Resumo dos pacotes —
    // editar num lugar atualiza o outro, porque os dois leem do mesmo campo da planilha
    if (isPackagePricing) {
      const pkgCap = `${slide.packageId.charAt(0).toUpperCase()}${slide.packageId.slice(1)}`
      campos[`beneficios${pkgCap}`] = packageBenefitsText
      campos[`bonus${pkgCap}`] = packageBonusText
    }
    // a página de "Acompanhamento de obra" busca a descrição direto de "Dados do projeto"
    // (campo Descrição do acompanhamento de obra) — editar aqui atualiza esse campo, então
    // não fica um texto "preso" só nesta proposta, desalinhado do resto dos dados
    if (slide.id === 'obra') { campos.acompanhamentoObraDescricao = description }
    if (isPackagesSummary) {
      patch.packageExtras = packageExtras
      patch.hidePayments = hidePayments
      patch.hideDescriptions = hideDescriptions
      // os tópicos editados aqui são os mesmos campos "Benefícios do pacote" usados nos
      // cards de cada pacote — salvar aqui atualiza os dois lugares de uma vez
      Object.entries(packageBenefits).forEach(([pkgId, text]) => {
        campos[`beneficios${pkgId.charAt(0).toUpperCase()}${pkgId.slice(1)}`] = text
      })
    }
    if (isStages) {
      // as datas em si moram em "Dados do projeto" e são remontadas a cada proposta — aqui só
      // vai o que é do slide (título, tópicos, foto e a escolha de mostrar ou não os prazos).
      // Sem isso, salvar "para todas as propostas" congelaria as datas deste cliente no modelo.
      patch.stages = stages.map(({ deadlines, ...resto }) => resto)
      patch.footnote = footnote
    }
    if (isReasons) { patch.items = reasonsList }
    if (isFeedbacks) {
      patch.items = feedbacks
      patch.feedbackLayout = feedbackLayout
      patch.sideImages = sideImages.slice(0, 2)
    }
    if (isBeforeAfter) {
      Object.assign(patch, antesDepois, { bgColor2, textColor2 })
      patch.leftImages = (antesDepois.leftImages || []).slice(0, 4)
      patch.rightImages = (antesDepois.rightImages || []).slice(0, 4)
    }
    // os dois blocos são guardados sempre, mesmo na página inteira: assim, quem dividir a página,
    // voltar para inteira e dividir de novo não perde o que tinha montado no lado direito
    if (livre) Object.assign(patch, { layoutMode, blocos: [blocos[0] || {}, blocos[1] || {}], bgColor2, textColor2 })

    // imagens e cores vão no MESMO patch do resto, e são salvas no escopo escolhido pela
    // pessoa (esta proposta / este tipo de projeto / todos os tipos). Antes elas eram sempre
    // forçadas para "só esta proposta", porque o conteúdo compartilhado não tinha onde
    // guardar imagem por slide — agora tem (slideDefaults, no conteúdo do modelo), então uma
    // foto colocada aqui pode valer para as próximas propostas.
    // As fotos seguem em base64 no estado local (pra aparecer na hora); quem troca por uma
    // referência curta antes de gravar é o updateProposal / saveTemplateContent.
    if (isMultiImage) {
      Object.assign(patch, { images, imageLayout, imagePlacement, imagesPerRow: Number(imagesPerRow) || null, image: null, image2: null })
      // a "Acompanhamento de obra" usa a descrição vinda de "Dados do projeto" (ver acima) —
      // não duplica aqui como override, senão o texto do campo nunca mais apareceria
      if (slide.id !== 'obra') patch.description = description
    }
    if (hasSingleImage) {
      Object.assign(patch, { image: singleImage.url || '', imagePosX: singleImage.posX ?? 50, imagePosY: singleImage.posY ?? 50, noImage, imagePosition })
      if (slide.type === 'scopeSplit' && slide.id !== 'obra') patch.description = description
    }
    if (isCover) Object.assign(patch, { kicker, image: coverImage.url || '', imagePosX: coverImage.posX ?? 50, imagePosY: coverImage.posY ?? 50 })
    if (slide.type === 'journeyFlow') patch.stepImages = stepImages
    if (COLOR_CUSTOMIZABLE_TYPES.has(slide.type)) Object.assign(patch, { bgColor, textColor })
    return { patch, campos }
  }

  /**
   * O que a tela desenha enquanto se edita: a mesma montagem do Salvar, mais o que no slide
   * vem de Dados do projeto (benefícios, objetivo, tópicos do escopo…). Essa parte é gravada nos
   * dados, e não no slide, então para aparecer na hora precisa ser aplicada aqui também.
   */
  function montarPrevia() {
    if (isVideo) return { embedUrl: toEmbedUrl(embedUrl) }
    const { patch } = montarEdicao()
    const previa = { ...patch }
    if (items && slide.fieldCode) previa.items = items
    if (isClientRequest) previa.objetivoProjeto = objetivoProjeto
    if (isPackagePricing) { previa.benefits = listItems(packageBenefitsText); previa.bonus = listItems(packageBonusText) }
    if (slide.id === 'obra') previa.description = description
    if (isPackagesSummary) previa.packages = (slide.packages || []).map((p) => ({ ...p, benefits: listItems(packageBenefits[p.id] || '') }))
    // as datas das apresentações não vão no salvamento (moram nos dados), mas precisam
    // continuar na tela durante a edição
    if (isStages) previa.stages = stages
    return previa
  }

  /**
   * Prévia ao vivo: a cada mudança no painel, o slide na tela é redesenhado com ela, sem salvar
   * nada. Antes só dava para ver o resultado depois de salvar — e, para corrigir, era preciso
   * abrir, salvar e conferir de novo. "alterado" diz se a pessoa já mexeu em algo (a primeira
   * passada é só a abertura do painel), para avisar antes de fechar sem salvar.
   */
  const previaJaMontada = useRef(false)
  useEffect(() => {
    const alterado = previaJaMontada.current
    previaJaMontada.current = true
    onPreview?.({ slideId: slide.id, patch: montarPrevia(), alterado })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, quote, author, subtitle, description, bgColor, textColor, stepImages, stages, footnote, reasonsList, feedbacks,
    feedbackLayout, sideImages, antesDepois, bgColor2, textColor2, layoutMode, blocos, images, imageLayout, imagePlacement,
    imagesPerRow, kicker, coverImage, singleImage, noImage, imagePosition, objetivoProjeto, packageBenefitsText,
    packageBonusText, hidePayments, hideDescriptions, packageExtras, packageBenefits, embedUrl, titleScale, textScale, items])

  function aplicarSalvamento(escopoEscolhido) {
    setScopePopup(false)
    if (isVideo) {
      guardarEscopo(VIDEO_SCOPE_KEY, escopoEscolhido)
      onSaveVideoScope?.(escopoEscolhido, { videoUrl: '', videoPath: '', embedUrl: toEmbedUrl(embedUrl) })
      onClose(true)
      return
    }
    const { patch, campos } = montarEdicao()
    if (Object.keys(campos).length) onSaveFields?.(campos)
    guardarEscopo(SCOPE_KEY, escopoEscolhido)
    onSave(patch, escopoEscolhido)
    // "true" = fechou porque salvou: não pergunta se quer descartar as alterações
    onClose(true)
  }

  return (
    <div className={embedded ? 'no-print w-full h-full bg-white text-ink p-4 overflow-y-auto' : 'no-print absolute top-0 right-0 h-full w-full sm:w-96 bg-white text-ink shadow-2xl p-5 overflow-y-auto z-30'} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium">Editar este slide</h3>
        <button onClick={onClose} className="text-muted text-sm">✕</button>
      </div>

      {/* slide livre: a primeira decisão é o formato da página, então ela vem antes de tudo e
          em destaque — o resto do painel (um quadro ou dois) depende dela */}
      {livre && (
        <div className="mb-4 p-3 rounded-lg border-2 border-clay bg-clay/5">
          <div className="text-sm font-medium text-ink mb-2">Formato da página</div>
          <Escolha valor={layoutMode} onChange={setLayoutMode} opcoes={[['inteiro', 'Página inteira'], ['dividido', 'Dividida ao meio']]} />
          {layoutMode === 'dividido' && (
            <button onClick={trocarLados} className="text-xs px-3 py-1.5 rounded-full border border-clay text-clay hover:bg-clay hover:text-white transition">
              ⇄ Trocar os lados de lugar
            </button>
          )}
        </div>
      )}

      <div className="mb-4 p-3 border border-line rounded-lg bg-sand">
        <div className="text-xs font-medium text-ink mb-2">Tamanho dos textos deste slide</div>
        <EscalaSlider label="Títulos" value={titleScale} onChange={setTitleScale} />
        <EscalaSlider label="Descrição, tópicos e demais textos" value={textScale} onChange={setTextScale} />
      </div>

      {/* no slide livre, título e cores ficam DENTRO do quadro de cada parte (página, ou lado
          esquerdo e lado direito): antes o título e as cores do lado esquerdo ficavam soltos lá em
          cima, longe do resto do lado esquerdo, e confundiam qual lado estava sendo editado */}
      {livre && layoutMode === 'dividido' && (
        // um lado por vez, escolhido nestes botões: com os dois quadros empilhados, o painel ficava
        // comprido e era fácil editar o lado errado sem perceber
        <div className="grid grid-cols-2 gap-2 mb-3">
          {[[0, '◧ Lado esquerdo'], [1, 'Lado direito ◨']].map(([i, rotulo]) => (
            <button
              key={i} onClick={() => setLadoAtivo(i)}
              className={`text-sm py-2.5 rounded-lg border-2 font-medium transition ${ladoAtivo === i ? 'bg-ink text-white border-ink' : 'border-line text-ink/70 hover:bg-sand'}`}
            >{rotulo}</button>
          ))}
        </div>
      )}

      {livre ? (
        (layoutMode === 'dividido' ? [ladoAtivo] : [0]).map((i) => (
          <EditorDeBloco
            key={i}
            rotulo={layoutMode === 'dividido' ? (i === 0 ? 'Lado esquerdo' : 'Lado direito') : 'Conteúdo da página'}
            titulo={i === 0 ? title : (blocos[1]?.titulo || '')}
            onTitulo={i === 0 ? setTitle : (v) => setBlocos((prev) => [prev[0] || {}, { ...(prev[1] || {}), titulo: v }])}
            corFundo={i === 0 ? bgColor : bgColor2}
            onCorFundo={i === 0 ? setBgColor : setBgColor2}
            corTexto={i === 0 ? textColor : textColor2}
            onCorTexto={i === 0 ? setTextColor : setTextColor2}
            palette={palette}
            maxFotos={layoutMode === 'dividido' ? 4 : 6}
            bloco={blocos[i] || {}}
            setBloco={(upd) => setBlocos((prev) => {
              const proximo = [prev[0] || {}, prev[1] || {}]
              proximo[i] = upd(proximo[i])
              return proximo
            })}
            onPickFile={handleImageFile}
          />
        ))
      ) : (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">
            {isBeforeAfter ? 'Nome do slide (aparece só na lista lateral)' : 'Título'}
          </label>
          {/* caixa de várias linhas: dá pra apertar Enter e a quebra aparece igual no slide */}
          <textarea value={title} rows={2} onChange={(e) => setTitle(e.target.value)} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-1" />
          <p className="text-[11px] text-muted mb-4">Aperte Enter para quebrar o título em mais de uma linha.</p>
        </>
      )}

      {isCover && (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">Texto pequeno acima do título</label>
          <textarea
            value={kicker} rows={2} onChange={(e) => setKicker(e.target.value)}
            placeholder="Ex: Apresentação de proposta de projeto"
            className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-1"
          />
          <p className="text-[11px] text-muted mb-4">Fica sempre numa linha só; use Enter para quebrar onde você quiser.</p>
          <div className="mb-4">
            <SingleImageField
              label="Imagem de fundo da capa"
              value={coverImage} onChange={setCoverImage} onPickFile={handleImageFile}
            />
          </div>
        </>
      )}

      {isPackagesSummary && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">O que mostrar nos cards</label>
          <label className="flex items-center gap-2 text-sm mb-1.5 cursor-pointer">
            <input type="checkbox" checked={!hidePayments} onChange={(e) => setHidePayments(!e.target.checked)} />
            Mostrar formas de pagamento
          </label>
          <label className="flex items-center gap-2 text-sm mb-1 cursor-pointer">
            <input type="checkbox" checked={!hideDescriptions} onChange={(e) => setHideDescriptions(!e.target.checked)} />
            Mostrar descrições (tópicos do pacote e texto extra)
          </label>
          <p className="text-[11px] text-muted mb-4">Ocultar as descrições não tira as fotos dos pacotes.</p>

          <label className="text-xs font-medium text-ink/70 block mb-2">Imagem e descrição de cada pacote</label>
          {(slide.packages || []).map((pkg) => {
            const extra = packageExtras[pkg.id] || {}
            return (
              <div key={pkg.id} className="border border-line rounded-lg p-3 mb-3">
                <div className="text-sm font-medium mb-2">{pkg.label}</div>
                <SingleImageField
                  previewClass="w-full h-20"
                  value={{ url: extra.image || '', posX: extra.posX, posY: extra.posY }}
                  onChange={(next) => setPackageExtras((prev) => ({ ...prev, [pkg.id]: { ...prev[pkg.id], image: next.url, posX: next.posX, posY: next.posY } }))}
                  onPickFile={handleImageFile}
                />
                <label className="text-xs font-medium text-ink/70 block mb-1">O que está incluso neste pacote (um tópico por linha)</label>
                <textarea
                  value={packageBenefits[pkg.id] || ''}
                  onChange={(e) => setPackageBenefits((prev) => ({ ...prev, [pkg.id]: e.target.value }))}
                  placeholder={'Estudo e criação do projeto\nImagens realistas 3D\n...'}
                  rows={4}
                  className="w-full text-xs p-2 rounded border border-line outline-none focus:border-clay mb-2"
                />
                <p className="text-[11px] text-muted mb-2">Isso atualiza os mesmos tópicos do card "{pkg.label}" nos pacotes. Linha começando com espaço continua o tópico de cima.</p>
                <label className="text-xs font-medium text-ink/70 block mb-1">Texto extra (opcional, aparece embaixo da foto)</label>
                <textarea
                  value={extra.description || ''}
                  onChange={(e) => setPackageExtras((prev) => ({ ...prev, [pkg.id]: { ...prev[pkg.id], description: e.target.value } }))}
                  placeholder="Uma observação extra sobre este pacote…"
                  rows={2}
                  className="w-full text-xs p-2 rounded border border-line outline-none focus:border-clay"
                />
              </div>
            )
          })}
        </div>
      )}

      {isClientRequest && (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">Objetivo do projeto</label>
          <textarea value={objetivoProjeto} onChange={(e) => setObjetivoProjeto(e.target.value)} rows={3} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-1" placeholder="Ex: Reforma completa de interiores…" />
          <p className="text-[11px] text-muted mb-4">Isso atualiza também o campo "Objetivo do projeto" em Dados do projeto.</p>
        </>
      )}

      {slide.type === 'divider' && (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">Subtítulo (opcional)</label>
          <textarea value={subtitle} onChange={(e) => setSubtitle(e.target.value)} rows={2} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-4" placeholder="Uma linha de apoio abaixo do título…" />
        </>
      )}

      {COLOR_CUSTOMIZABLE_TYPES.has(slide.type) && !livre && (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">Cor do fundo</label>
          <ColorSwatchRow palette={palette} value={bgColor} onChange={setBgColor} />

          <label className="text-xs font-medium text-ink/70 block mb-1 mt-3">Cor do texto</label>
          <ColorSwatchRow palette={palette} value={textColor} onChange={setTextColor} />
          <p className="text-[11px] text-muted mt-1">A cor escolhida vale também para o título. Se ficar difícil de ler sobre o fundo, o sistema clareia ou escurece o mesmo tom até dar contraste.</p>
          {isCover && <p className="text-[11px] text-muted mt-1">Na capa, a cor do texto vale também sobre a foto de fundo. Sem cor escolhida, o texto volta a ser branco.</p>}
          {isBeforeAfter && <p className="text-[11px] text-muted mt-1">As cores acima valem para o lado esquerdo.</p>}
          <div className="mb-4" />
        </>
      )}

      {/* antes e depois: o lado direito tem cores próprias (sem escolha, fundo branco). No slide
          livre, as cores de cada lado ficam dentro do quadro daquele lado (ver EditorDeBloco). */}
      {isBeforeAfter && (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">Cor do fundo — lado direito</label>
          <ColorSwatchRow palette={palette} value={bgColor2} onChange={setBgColor2} />
          <label className="text-xs font-medium text-ink/70 block mb-1 mt-3">Cor do texto — lado direito</label>
          <ColorSwatchRow palette={palette} value={textColor2} onChange={setTextColor2} />
          <div className="mb-4" />
        </>
      )}

      {isPackagePricing && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Benefícios do pacote (um tópico por linha)</label>
          <textarea
            value={packageBenefitsText}
            onChange={(e) => setPackageBenefitsText(e.target.value)}
            placeholder={'Estudo e criação do projeto\nImagens realistas 3D\n...'}
            rows={6}
            className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-1"
          />
          <p className="text-[11px] text-muted mb-4">Isso atualiza o mesmo card deste pacote no Resumo dos pacotes. Para continuar o mesmo tópico na linha de baixo, comece a linha com um espaço.</p>

          <label className="text-xs font-medium text-ink/70 block mb-1">★ Bônus do pacote (opcional, um bônus por linha)</label>
          <textarea
            value={packageBonusText}
            onChange={(e) => setPackageBonusText(e.target.value)}
            placeholder="Projeto da fachada da casa"
            rows={2}
            className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-1"
          />
          <p className="text-[11px] text-muted mb-4">Deixe em branco para não mostrar bônus. O bônus aparece em destaque também no Resumo dos pacotes.</p>
        </div>
      )}

      {slide.type === 'packagePricing' && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Formas de pagamento a mostrar neste pacote ({slide.title})</label>
          {[['cartao', 'Cartão de crédito (12x)'], ['prazo', 'Parcelado por prazo de projeto'], ['avista', 'À vista (com desconto)'], ['metade', 'Metade / Metade']].map(([id, label]) => {
            const checked = (proposal?.visibility?.paymentsByPackage?.[slide.packageId] ?? proposal?.visibility?.payments)?.[id] !== false
            return (
              <label key={id} className="flex items-center gap-2 text-sm mb-1.5 cursor-pointer">
                <input
                  type="checkbox" checked={checked}
                  onChange={() => onSaveVisibility?.({ payments: { [id]: !checked } }, slide.packageId)}
                />
                {label}
              </label>
            )
          })}
        </div>
      )}

      {slide.type === 'journeyFlow' && (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">Subtítulo</label>
          <textarea value={subtitle} rows={2} onChange={(e) => setSubtitle(e.target.value)} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-4" />
        </>
      )}

      {slide.type === 'closing' && (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">Frase</label>
          <textarea value={quote} onChange={(e) => setQuote(e.target.value)} rows={2} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-4" />
          <label className="text-xs font-medium text-ink/70 block mb-1">Autor(a)</label>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-4" />
        </>
      )}

      {isVideo && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Link de incorporação (YouTube/Vimeo, modo "embed")</label>
          <p className="text-[11px] text-muted mb-2">Suba o vídeo como "não listado" no YouTube e cole aqui o link no formato .../embed/...</p>
          <input
            value={embedUrl}
            onChange={(e) => setEmbedUrl(e.target.value)}
            placeholder="https://www.youtube.com/embed/…"
            className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay"
          />
        </div>
      )}

      {items && !livre && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">
            {slide.type === 'cover' || slide.type === 'profile' ? 'Textos (aparecem juntos, assim que o slide abre)' : 'Textos (aparecem um a um ao clicar)'}
          </label>
          {items.map((it, i) => (
            <div key={i} className="flex gap-1.5 items-start mb-2">
              <textarea
                value={it} rows={2}
                onChange={(e) => { const next = [...items]; next[i] = e.target.value; setItems(next) }}
                className="w-full text-sm p-2 rounded-lg border border-line outline-none focus:border-clay"
              />
              <div className="flex flex-col gap-1 shrink-0">
                <button disabled={i === 0} onClick={() => { const next = [...items];[next[i - 1], next[i]] = [next[i], next[i - 1]]; setItems(next) }} className="w-6 h-6 text-xs rounded border border-line disabled:opacity-30 hover:bg-sand" title="Mover para cima">↑</button>
                <button disabled={i === items.length - 1} onClick={() => { const next = [...items];[next[i + 1], next[i]] = [next[i], next[i + 1]]; setItems(next) }} className="w-6 h-6 text-xs rounded border border-line disabled:opacity-30 hover:bg-sand" title="Mover para baixo">↓</button>
              </div>
            </div>
          ))}
          <div className="flex gap-3">
            <button onClick={() => setItems([...items, ''])} className="text-xs text-clay">+ adicionar texto</button>
            {items.length > 0 && <button onClick={() => setItems(items.slice(0, -1))} className="text-xs text-red-600">remover último</button>}
          </div>
          <p className="text-[11px] text-muted mt-2">Enter quebra a linha dentro do mesmo texto; "+ adicionar texto" cria outro.</p>
          {slide.fieldCode && <p className="text-[11px] text-muted mt-2">Estes textos são os mesmos de "Dados do projeto": editar aqui atualiza lá, só nesta proposta.</p>}
        </div>
      )}

      {isReasons && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Motivos</label>
          {reasonsList.map((r, i) => (
            <div key={i} className="border border-line rounded-lg p-3 mb-2">
              <div className="flex items-center gap-2 mb-1.5">
                <textarea
                  value={r.title || ''} rows={2}
                  onChange={(e) => setReasonsList((prev) => prev.map((p, k) => k === i ? { ...p, title: e.target.value } : p))}
                  className="flex-1 text-sm font-medium p-1.5 rounded border border-line outline-none focus:border-clay"
                  placeholder="Título do motivo"
                />
                <button onClick={() => setReasonsList((prev) => prev.filter((_, k) => k !== i))} className="text-xs text-red-600 shrink-0">remover</button>
              </div>
              <textarea
                value={r.body || ''} rows={2}
                onChange={(e) => setReasonsList((prev) => prev.map((p, k) => k === i ? { ...p, body: e.target.value } : p))}
                className="w-full text-xs p-2 rounded border border-line outline-none focus:border-clay"
              />
            </div>
          ))}
          <button onClick={() => setReasonsList((prev) => [...prev, { title: '', body: '' }])} className="text-xs text-clay">+ adicionar motivo</button>
        </div>
      )}

      {isStages && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Apresentações</label>
          {stages.map((s, i) => (
            <div key={i} className="border border-line rounded-lg p-3 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <textarea
                  value={s.title} rows={2}
                  onChange={(e) => setStages((prev) => prev.map((p, k) => k === i ? { ...p, title: e.target.value } : p))}
                  className="flex-1 text-sm font-medium p-1.5 rounded border border-line outline-none focus:border-clay"
                  placeholder="Título da apresentação"
                />
                <button onClick={() => setStages((prev) => prev.filter((_, k) => k !== i))} className="text-xs text-red-600 shrink-0">remover</button>
              </div>
              {(s.items || []).map((it, k) => (
                <div key={k} className="flex gap-1 mb-1.5">
                  {/* caixa que cresce com o texto: Enter quebra a linha dentro do mesmo item */}
                  <textarea
                    value={it} rows={Math.max(1, String(it || '').split('\n').length)}
                    onChange={(e) => setStages((prev) => prev.map((p, pi) => pi === i ? { ...p, items: p.items.map((x, xi) => xi === k ? e.target.value : x) } : p))}
                    className="flex-1 text-xs p-1.5 rounded border border-line outline-none focus:border-clay resize-none"
                  />
                  <button onClick={() => setStages((prev) => prev.map((p, pi) => pi === i ? { ...p, items: p.items.filter((_, xi) => xi !== k) } : p))} className="text-xs text-red-600">✕</button>
                </div>
              ))}
              <button onClick={() => setStages((prev) => prev.map((p, pi) => pi === i ? { ...p, items: [...(p.items || []), ''] } : p))} className="text-[11px] text-clay">+ item</button>

              {/* prazo previsto desta apresentação, um por pacote. As datas moram em "Dados do
                  projeto" (campos "Completo - 1° apresentação" etc.), então editar aqui altera
                  o mesmo campo de lá — não cria uma segunda data solta. */}
              {(s.deadlines || []).length > 0 && (
                <div className="mt-3 border-t border-line pt-2">
                  <label className="flex items-center gap-2 text-xs mb-2 cursor-pointer">
                    <input
                      type="checkbox" checked={!s.hideDeadlines}
                      onChange={(e) => setStages((prev) => prev.map((p, pi) => pi === i ? { ...p, hideDeadlines: !e.target.checked } : p))}
                    />
                    Mostrar os prazos previstos nesta apresentação
                  </label>
                  {(s.deadlines || []).map((d) => (
                    <div key={d.id} className="flex items-center gap-2 mb-1.5">
                      <span className="text-[11px] text-muted w-20 shrink-0">{d.label}</span>
                      <input
                        value={d.date || ''}
                        onChange={(e) => {
                          const valor = e.target.value
                          setStages((prev) => prev.map((p, pi) => pi === i ? { ...p, deadlines: p.deadlines.map((x) => x.id === d.id ? { ...x, date: valor } : x) } : p))
                        }}
                        // grava só ao sair do campo: como a data mora em "Dados do projeto",
                        // salvar a cada tecla digitada seria uma ida ao banco por caractere
                        onBlur={(e) => onSaveFields?.({ [`${d.id}Apresentacao${i + 1}`]: e.target.value })}
                        placeholder="dd/mm/aaaa"
                        className="flex-1 text-xs p-1.5 rounded border border-line outline-none focus:border-clay"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-2">
                <SingleImageField
                  compact previewClass="w-full h-20"
                  value={{ url: s.image || '', posX: s.posX, posY: s.posY }}
                  onChange={(next) => setStages((prev) => prev.map((p, pi) => pi === i ? { ...p, image: next.url, posX: next.posX, posY: next.posY } : p))}
                  onPickFile={handleImageFile}
                />
              </div>
            </div>
          ))}
          <button onClick={() => setStages((prev) => [...prev, { title: 'Nova apresentação', items: [''] }])} className="text-xs text-clay mb-4">+ adicionar apresentação</button>

          <label className="text-xs font-medium text-ink/70 block mb-1">Observação (embaixo dos cards)</label>
          <textarea value={footnote} onChange={(e) => setFootnote(e.target.value)} rows={2} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-4" />
        </div>
      )}

      {isFeedbacks && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Como mostrar</label>
          <Escolha
            valor={feedbackLayout} onChange={setFeedbackLayout}
            opcoes={[['grade', 'Vários feedbacks lado a lado'], ['unico', 'Um feedback, com fotos ao lado']]}
          />
          {feedbackLayout === 'unico' && (
            <div className="border border-line rounded-lg p-3 mb-3 bg-sand">
              <p className="text-[11px] text-muted mb-2">A página fica dividida ao meio: o primeiro feedback da lista à esquerda e as fotos do projeto à direita. Use "mostrar este" para escolher qual feedback aparece.</p>
              <label className="text-xs font-medium text-ink/70 block mb-1">Fotos do projeto (lado direito, até 2)</label>
              <ListaDeFotosEditor fotos={sideImages} setFotos={setSideImages} max={2} onPickFile={handleImageFile} />
            </div>
          )}
          <label className="text-xs font-medium text-ink/70 block mb-1">Feedbacks de clientes</label>
          {feedbacks.map((fb, i) => (
            <div key={i} className={`border rounded-lg p-3 mb-3 ${feedbackLayout === 'unico' && i === 0 ? 'border-clay' : 'border-line'}`}>
              {feedbackLayout === 'unico' && (
                i === 0
                  ? <div className="text-[11px] text-clay font-medium mb-2">Este é o feedback que aparece</div>
                  : <button onClick={() => setFeedbacks((prev) => [prev[i], ...prev.filter((_, k) => k !== i)])} className="text-[11px] text-clay mb-2">mostrar este</button>
              )}
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={fb.name || ''}
                  onChange={(e) => setFeedbacks((prev) => prev.map((p, k) => k === i ? { ...p, name: e.target.value } : p))}
                  className="flex-1 text-sm font-medium p-1.5 rounded border border-line outline-none focus:border-clay"
                  placeholder="Nome do cliente (ex: @usuario)"
                />
                <button onClick={() => setFeedbacks((prev) => prev.filter((_, k) => k !== i))} className="text-xs text-red-600 shrink-0">remover</button>
              </div>
              <textarea
                value={fb.text || ''} rows={2}
                onChange={(e) => setFeedbacks((prev) => prev.map((p, k) => k === i ? { ...p, text: e.target.value } : p))}
                placeholder="Texto do feedback"
                className="w-full text-xs p-2 rounded border border-line outline-none focus:border-clay mb-2"
              />
              <div className="grid grid-cols-2 gap-3">
                <SingleImageField
                  compact label="Foto do cliente" previewClass="w-16 h-16 rounded-full"
                  value={{ url: fb.photoUrl || '', posX: fb.photoPosX, posY: fb.photoPosY }}
                  onChange={(next) => setFeedbacks((prev) => prev.map((p, k) => k === i ? { ...p, photoUrl: next.url, photoPosX: next.posX, photoPosY: next.posY } : p))}
                  onPickFile={handleImageFile}
                />
                <div>
                  <SingleImageField
                    compact label="Print (no lugar do texto)" previewClass="w-full h-20"
                    value={{ url: fb.printUrl || '', posX: fb.printPosX, posY: fb.printPosY }}
                    onChange={(next) => setFeedbacks((prev) => prev.map((p, k) => k === i ? { ...p, printUrl: next.url, printPosX: next.posX, printPosY: next.posY } : p))}
                    onPickFile={handleImageFile}
                  />
                  {fb.printUrl && (
                    <select
                      value={fb.printRatio || ''}
                      onChange={(e) => setFeedbacks((prev) => prev.map((p, k) => k === i ? { ...p, printRatio: e.target.value } : p))}
                      className="text-xs border border-line rounded px-2 py-1.5 w-full mt-2"
                    >
                      <option value="">Preencher o card</option>
                      <option value="1:1">1:1 — quadrado</option>
                      <option value="4:5">4:5 — retrato</option>
                      <option value="5:4">5:4 — paisagem</option>
                      <option value="9:16">9:16 — vertical</option>
                      <option value="16:9">16:9 — widescreen</option>
                    </select>
                  )}
                </div>
              </div>
              {/* foto do projeto embaixo do quadro do feedback — só no modo "vários": no modo
                  "um feedback", as fotos do projeto ficam no lado direito da página */}
              {feedbackLayout === 'grade' && (
                <div className="mt-3 pt-3 border-t border-line">
                  <SingleImageField
                    compact label="Foto do projeto (embaixo do feedback, formato 5:4)" previewClass="w-full h-24"
                    value={{ url: fb.projUrl || '', posX: fb.projPosX, posY: fb.projPosY }}
                    onChange={(next) => setFeedbacks((prev) => prev.map((p, k) => k === i ? { ...p, projUrl: next.url, projPosX: next.posX, projPosY: next.posY } : p))}
                    onPickFile={handleImageFile}
                  />
                </div>
              )}
            </div>
          ))}
          <button onClick={() => setFeedbacks((prev) => [...prev, { name: '', text: '' }])} className="text-xs text-clay">+ adicionar feedback</button>
        </div>
      )}

      {isBeforeAfter && (
        <div className="mb-4">
          {[['left', 'Lado esquerdo (Antes)', 'Antes'], ['right', 'Lado direito (Depois)', 'Depois']].map(([lado, rotulo, padrao]) => (
            <div key={lado} className="border border-line rounded-lg p-3 mb-3">
              <div className="text-sm font-medium mb-2">{rotulo}</div>
              <label className="text-xs font-medium text-ink/70 block mb-1">Título (no topo, à esquerda)</label>
              <input
                value={antesDepois[`${lado}Title`]}
                onChange={(e) => { const v = e.target.value; setAntesDepois((prev) => ({ ...prev, [`${lado}Title`]: v })) }}
                placeholder={padrao}
                className="w-full text-sm p-2 rounded-lg border border-line outline-none focus:border-clay mb-3"
              />
              <label className="text-xs font-medium text-ink/70 block mb-1">Texto (opcional)</label>
              <textarea
                value={antesDepois[`${lado}Text`]} rows={3}
                onChange={(e) => { const v = e.target.value; setAntesDepois((prev) => ({ ...prev, [`${lado}Text`]: v })) }}
                className="w-full text-sm p-2 rounded-lg border border-line outline-none focus:border-clay mb-3"
              />
              <label className="text-xs font-medium text-ink/70 block mb-1">Fotos (até 4)</label>
              <ListaDeFotosEditor
                fotos={antesDepois[`${lado}Images`] || []}
                setFotos={(upd) => setAntesDepois((prev) => ({ ...prev, [`${lado}Images`]: upd(prev[`${lado}Images`] || []) }))}
                max={4} onPickFile={handleImageFile}
              />
            </div>
          ))}
          <p className="text-[11px] text-muted">O lado "Depois" aparece com um clique. Enquanto a página não tiver nenhuma foto nem texto, ela não aparece para o cliente (link, modo Apresentar e PDF).</p>
        </div>
      )}

      {/* slide extra antigo (sem formato livre): um botão converte, levando os textos e fotos */}
      {isCustomSemVideo && !layoutMode && (
        <div className="mb-4 p-3 border border-line rounded-lg bg-sand">
          <p className="text-[11px] text-muted mb-2">Este slide usa o formato antigo. O formato livre deixa escolher a posição do texto, tópicos, descrição grande ou cards, e dividir a página ao meio.</p>
          <button
            onClick={() => {
              setLayoutMode('inteiro')
              setBlocos([{ formato: 'topicos', itens: (items || []).filter((t) => String(t || '').trim()), imagens: images.map((im) => ({ url: im.url, posX: im.posX, posY: im.posY, ratio: im.ratio || '' })) }, {}])
            }}
            className="text-xs px-3 py-1.5 rounded-full bg-ink text-white"
          >✨ Usar o formato livre</button>
        </div>
      )}


      {slide.type === 'journeyFlow' && items && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Imagem de cada etapa (opcional)</label>
          {items.map((it, i) => (
            <div key={i} className="border border-line rounded-lg p-2 mb-2">
              <div className="text-xs text-muted mb-1">{i + 1}. {it}</div>
              <SingleImageField
                compact previewClass="w-full h-20"
                value={stepImages[i] || {}}
                onChange={(next) => setStepImages((prev) => { const arr = [...prev]; arr[i] = next; return arr })}
                onPickFile={handleImageFile}
              />
            </div>
          ))}
        </div>
      )}

      {(slide.type === 'scopeSection' || slide.type === 'scopeSplit') && (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">Descrição (parágrafo abaixo do título — os textos abaixo continuam virando tópicos com marcador)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-4" />
        </>
      )}

      {isMultiImage ? (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Imagens deste slide</label>
          <label className="flex items-center gap-2 text-xs mb-2 cursor-pointer">
            <input
              type="checkbox" checked={images.length === 0}
              onChange={(e) => {
                if (e.target.checked) { setImagensGuardadas(images); setImages([]) }
                else setImages(imagensGuardadas)
              }}
            />
            Não usar imagem neste slide (o texto ocupa a página toda, justificado à esquerda)
          </label>

          {images.length === 0 ? (
            <p className="text-xs text-muted mb-2">Nenhuma imagem — o texto vai ocupar o espaço todo, de um jeito mais legível.</p>
          ) : (
            <>
              {images.length === 1 ? (
                <>
                  <div className="text-xs font-medium text-ink/70 block mb-1 mt-3">Posição da imagem</div>
                  <div className="flex gap-2 mb-3 flex-wrap">
                    {[['below', 'Abaixo do texto'], ['left', 'Lateral esquerda'], ['right', 'Lateral direita']].map(([id, label]) => (
                      <button
                        key={id} onClick={() => setImagePlacement(id)}
                        className={`text-xs px-3 py-1.5 rounded-full border ${imagePlacement === id ? 'bg-ink text-white border-ink' : 'border-line text-ink/70'}`}
                      >{label}</button>
                    ))}
                  </div>
                  {imagePlacement !== 'below' && (
                    <p className="text-[11px] text-muted mb-3">Na lateral, a foto ocupa metade da página e o formato escolhido abaixo não se aplica.</p>
                  )}
                </>
              ) : (
                <>
                  <div className="text-xs font-medium text-ink/70 block mb-1 mt-3">Quantas imagens por fileira?</div>
                  <div className="flex gap-2 mb-1 flex-wrap">
                    {Array.from({ length: Math.min(images.length, 6) }, (_, k) => k + 1).map((v) => (
                      <button
                        key={v} onClick={() => setImagesPerRow(v)}
                        className={`text-xs w-9 h-9 rounded-full border ${Number(imagesPerRow) === v ? 'bg-ink text-white border-ink' : 'border-line text-ink/70'}`}
                      >{v}</button>
                    ))}
                    <button
                      onClick={() => setImagesPerRow('')}
                      className={`text-xs px-3 h-9 rounded-full border ${!imagesPerRow ? 'bg-ink text-white border-ink' : 'border-line text-ink/70'}`}
                    >automático</button>
                  </div>
                  <p className="text-[11px] text-muted mb-3">
                    As que não couberem descem para a fileira de baixo, alinhadas pela esquerda com as de cima.
                    Quanto mais fileiras, menores as fotos — o formato escolhido é sempre mantido.
                  </p>
                </>
              )}
              <div className="space-y-2 mb-3">
                {images.map((img, i) => (
                  <div key={i} className="border border-line rounded-lg p-2">
                    <div className="flex items-center gap-2">
                      <img src={img.url} className="w-14 h-14 object-cover rounded" alt="" style={{ objectPosition: `${img.posX ?? 50}% ${img.posY ?? 50}%` }} />
                      <select
                        value={img.ratio || ''}
                        onChange={(e) => setImages((prev) => prev.map((p, k) => k === i ? { ...p, ratio: e.target.value } : p))}
                        className="text-xs border border-line rounded px-2 py-1.5 flex-1"
                      >
                        <option value="">Formato original</option>
                        <option value="1:1">1:1 — quadrado</option>
                        <option value="4:5">4:5 — retrato</option>
                        <option value="5:4">5:4 — paisagem</option>
                        <option value="9:16">9:16 — vertical</option>
                        <option value="16:9">16:9 — widescreen</option>
                      </select>
                      <button onClick={() => setAdjustingIdx(adjustingIdx === i ? null : i)} className="text-xs text-clay px-1 shrink-0">{adjustingIdx === i ? 'fechar' : 'ajustar'}</button>
                      <button onClick={() => setImages((prev) => prev.filter((_, k) => k !== i))} className="text-xs text-red-600 px-1 shrink-0">remover</button>
                    </div>
                    {adjustingIdx === i && (
                      <div className="mt-2">
                        <p className="text-[11px] text-muted mb-1">Arraste dentro da imagem para escolher o enquadramento</p>
                        <ImagePositionPicker image={img} onChange={(patch) => setImages((prev) => prev.map((p, k) => k === i ? { ...p, ...patch } : p))} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <label className="text-xs cursor-pointer text-clay font-medium">
            + adicionar imagem(ns)
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = '' }} />
          </label>
          {images.length > 0 && (
            <button onClick={() => setImages([])} className="block text-xs text-muted hover:text-red-600 mt-2">remover todas (sem imagem)</button>
          )}
        </div>
      ) : hasSingleImage && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Imagem deste slide</label>
          <label className="flex items-center gap-2 text-xs mb-2 cursor-pointer">
            <input type="checkbox" checked={noImage} onChange={(e) => setNoImage(e.target.checked)} />
            Não usar imagem neste slide (o texto ocupa a página toda, justificado à esquerda)
          </label>
          {!noImage && (
            <>
              <SingleImageField value={singleImage} onChange={setSingleImage} onPickFile={handleImageFile} />
              <label className="text-xs font-medium text-ink/70 block mb-1 mt-3">Posição da imagem</label>
              <div className="flex gap-2">
                <button onClick={() => setImagePosition('left')} className={`text-xs px-3 py-1.5 rounded-full border ${imagePosition === 'left' ? 'bg-ink text-white border-ink' : 'border-line text-ink/70'}`}>Esquerda</button>
                <button onClick={() => setImagePosition('right')} className={`text-xs px-3 py-1.5 rounded-full border ${imagePosition === 'right' ? 'bg-ink text-white border-ink' : 'border-line text-ink/70'}`}>Direita</button>
              </div>
            </>
          )}
        </div>
      )}

      {uploadingCount > 0 && (
        <p className="text-xs text-clay mb-2">Processando imagem(ns)… um instante.</p>
      )}
      {(slide.isCopy || slide.type === 'custom') && onDeleteSlide && (
        <button
          onClick={() => { if (confirm('Excluir este slide? Ele sai desta proposta e também do modelo, se você tiver salvado para as outras propostas.')) onDeleteSlide(slide.id) }}
          className="w-full text-sm py-2.5 rounded-lg border border-red-200 text-red-600 mt-6 hover:bg-red-50"
        >Excluir este slide</button>
      )}

      <div className="flex gap-2 mt-6">
        <button onClick={onClose} className="flex-1 text-sm py-2.5 rounded-lg border border-line text-muted">Cancelar</button>
        <button onClick={save} disabled={uploadingCount > 0} className="flex-1 text-sm py-2.5 rounded-lg bg-clay text-white font-medium disabled:opacity-50">{uploadingCount > 0 ? 'Salvando…' : 'Salvar'}</button>
      </div>

      {scopePopup && (
        <ScopePopup
          slide={slide}
          proposal={proposal}
          isVideo={isVideo}
          value={isVideo ? videoScope : scope}
          onChange={isVideo ? setVideoScope : setScope}
          onConfirm={aplicarSalvamento}
          onCancel={() => setScopePopup(false)}
        />
      )}
    </div>
  )
}

function EscalaSlider({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[11px] text-muted flex-1">{label}</span>
      <input type="range" min="60" max="180" step="5" value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-24 shrink-0" />
      <span className="text-[11px] text-ink w-9 text-right shrink-0">{value}%</span>
    </div>
  )
}

/** Pop-up que aparece a cada "Salvar": onde esta edição deve valer. */
function ScopePopup({ slide, proposal, isVideo, value, onChange, onConfirm, onCancel }) {
  const opcoes = [
    ['allTypes', 'Todas as propostas, de todos os tipos'],
    ['tipologia', `Só nas propostas do tipo ${TIPOLOGIA_LABEL[proposal?.tipologia] || proposal?.tipologia || 'atual'}`],
    ['proposal', 'Só nesta proposta'],
  ]
  return (
    <div className="no-print fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onCancel}>
      <div className="bg-white text-ink rounded-xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-medium mb-1">Onde salvar esta edição?</h3>
        <p className="text-xs text-muted mb-3">
          {isVideo ? 'Este vídeo vale para:' : 'Aplicar esta edição (textos, fotos e cores) em:'}
        </p>
        {opcoes.map(([id, label]) => (
          <label
            key={id}
            className={`flex items-center gap-2 text-sm p-2.5 mb-1.5 rounded-lg border cursor-pointer transition ${value === id ? 'border-clay bg-sand' : 'border-line'}`}
          >
            <input type="radio" checked={value === id} onChange={() => onChange(id)} />
            {label}
          </label>
        ))}
        <p className="text-[11px] text-muted mt-2">
          Nas duas primeiras opções, o que você salvar aqui já aparece sozinho nas próximas propostas que criar.
        </p>
        {!isVideo && CLIENT_FIELDS_BY_SLIDE[slide.id] && value !== 'proposal' && (
          <p className="text-[11px] text-muted mt-1.5">
            A foto e as cores desta página vão para as outras propostas; o texto com o nome e o objetivo do cliente fica só nesta.
          </p>
        )}
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} className="flex-1 text-sm py-2.5 rounded-lg border border-line text-muted">Voltar</button>
          <button onClick={() => onConfirm(value)} className="flex-1 text-sm py-2.5 rounded-lg bg-clay text-white font-medium">Salvar aqui</button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- BLOCOS DE TEXTO REVELADOS POR CLIQUE ---------------- */

function Reveal({ i, revealCount, children, className = '', style }) {
  return <div className={`reveal-item ${i < revealCount ? 'revealed' : ''} ${className}`} style={{ transitionDelay: `${i * 60}ms`, ...style }}>{children}</div>
}

/**
 * Renderiza o slide sempre no tamanho "real" (o mesmo canvas 1600×900 usado no PDF) e
 * encolhe/aumenta ele visualmente (CSS transform: scale) pra caber no espaço disponível —
 * em vez de deixar o slide "reformatar" o conteúdo pra cada largura de tela. Isso garante
 * que a experiência no celular (inclusive no link do cliente) seja pixel-a-pixel igual à do
 * computador, só em tamanho menor — e ao girar o celular pra paisagem, o espaço disponível
 * aumenta e a escala aumenta junto, sem esquisitices de layout responsivo quebrando slide.
 */
function ScaledCanvas({ children, onClick, onSwipeNext, onSwipePrev }) {
  const outerRef = useRef(null)
  const [box, setBox] = useState({ scale: 1, left: 0, top: 0 })

  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    function recompute() {
      const { width, height } = el.getBoundingClientRect()
      if (!width || !height) return
      const scale = Math.min(width / EXPORT_W, height / EXPORT_H)
      setBox({ scale, left: (width - EXPORT_W * scale) / 2, top: (height - EXPORT_H * scale) / 2 })
    }
    recompute()
    // no celular, às vezes a altura real da tela (depois da barra de endereço recolher) só
    // fica certa alguns instantes depois do primeiro desenho — sem essas novas tentativas, o
    // slide podia ficar "gigante" (sem encolher pra caber) até a pessoa girar o celular
    const raf = requestAnimationFrame(() => requestAnimationFrame(recompute))
    const timers = [100, 300, 800].map((ms) => setTimeout(recompute, ms))
    window.addEventListener('resize', recompute)
    window.addEventListener('orientationchange', recompute)
    let ro
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(recompute); ro.observe(el) }
    return () => {
      ro?.disconnect()
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', recompute)
      window.removeEventListener('orientationchange', recompute)
    }
  }, [])

  // arrastar o dedo para os lados (celular/tablet): para a esquerda avança, para a direita volta,
  // como virar página. Um toque parado continua sendo "clique" (avança), pelo onClick normal.
  const toqueRef = useRef(null)
  function inicioToque(e) {
    const t = e.touches[0]
    toqueRef.current = { x: t.clientX, y: t.clientY }
  }
  function fimToque(e) {
    const inicio = toqueRef.current
    toqueRef.current = null
    if (!inicio) return
    const t = e.changedTouches[0]
    const dx = t.clientX - inicio.x
    const dy = t.clientY - inicio.y
    // só conta como arrastar se foi claramente para o lado (e não rolagem para cima/baixo)
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    // impede que o mesmo gesto também vire um "clique" e pule mais um slide
    e.preventDefault()
    if (dx < 0) onSwipeNext?.()
    else onSwipePrev?.()
  }

  return (
    <div ref={outerRef} className="absolute inset-0 cursor-pointer overflow-hidden" onClick={onClick} onTouchStart={inicioToque} onTouchEnd={fimToque} style={{ background: INK }}>
      <div style={{ position: 'absolute', left: box.left, top: box.top, width: EXPORT_W, height: EXPORT_H, transform: `scale(${box.scale})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  )
}

/**
 * Quando não há imagem (ou enquanto ela ainda não apareceu na animação), o espaço dela fica
 * TRANSPARENTE — quem aparece atrás é a cor de fundo do próprio slide. Antes havia um bege
 * fixo aqui, que destoava sempre que o slide tinha outra cor de fundo e marcava na tela o
 * retângulo da foto antes dela surgir.
 */
function SlideImage({ src, className, style }) {
  if (!src) return <div className={className} style={{ background: 'transparent', ...style }} />
  return <div className={className} style={{ ...style, ...coverBg(src, style?.objectPosition), objectPosition: undefined }} />
}

/**
 * A foto é desenhada como FUNDO do quadradinho, e não como <img object-fit:cover>.
 *
 * Motivo: o gerador de PDF (html2canvas) não entende object-fit — ele redesenha a foto
 * esticada até preencher o quadro, e era por isso que no PDF as imagens saíam achatadas ou
 * alongadas enquanto na tela apareciam certas. background-size: cover ele entende, e o
 * resultado no PDF fica idêntico ao da apresentação.
 */
function coverBg(src, objectPosition) {
  return {
    backgroundImage: `url("${src}")`,
    backgroundSize: 'cover',
    backgroundPosition: objectPosition || 'center',
    backgroundRepeat: 'no-repeat',
  }
}

// whiteSpace: 'pre-line' faz o Enter que a pessoa digitou no painel virar quebra de linha de
// verdade no slide (antes o texto era sempre uma linha corrida, quebrada só pela largura)
const titleStyle = { fontFamily: STYLE.displayFont, fontWeight: STYLE.headingWeight, textTransform: STYLE.headingTransform, letterSpacing: STYLE.headingTracking, whiteSpace: 'pre-line' }
const SAND = '#F6F3EE'
const INK = '#28313C'

function hexToRgb(hex) {
  const c = (hex || '#000000').replace('#', '')
  return [parseInt(c.substring(0, 2), 16) || 0, parseInt(c.substring(2, 4), 16) || 0, parseInt(c.substring(4, 6), 16) || 0]
}
function rgbToHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Cor do título: sempre tenta a cor de destaque da paleta (pra nunca ficar igual ao texto
 *  do corpo). Se essa cor não tiver contraste suficiente contra o fundo, ajusta o brilho dela
 *  (mantendo o tom) até ficar legível, em vez de simplesmente cair pra mesma cor neutra do
 *  resto do texto — assim o título sempre se destaca visualmente. */
/**
 * Deixa uma cor legível sobre o fundo SEM trocar o tom dela: ajusta só o brilho, escurecendo
 * (ou clareando, se o fundo for escuro) até passar no contraste. Devolve null se nem assim
 * der. É o que permite respeitar a cor escolhida em vez de descartá-la por um cinza.
 */
function adjustForContrast(hex, bg) {
  if (!hex) return null
  if (!isLowContrast(hex, bg)) return hex
  const tryDirection = (darken) => {
    let [r, g, b] = hexToRgb(hex)
    for (let i = 0; i < 14; i++) {
      r += darken ? -20 : 20; g += darken ? -20 : 20; b += darken ? -20 : 20
      const candidate = rgbToHex(r, g, b)
      if (!isLowContrast(candidate, bg)) return candidate
    }
    return null
  }
  const primary = readableTextColor(bg) === '#1A1A1A'
  return tryDirection(primary) || tryDirection(!primary)
}

function titleColorFor(c1, bg) {
  return adjustForContrast(c1, bg) || readableTextColor(bg)
}

/** Resolve a cor de fundo e a cor de texto (contraste garantido) de um slide, considerando
 *  a personalização que a pessoa escolheu no "Editar slide" (com um fundo padrão de reserva). */
/**
 * Resolve a cor de fundo e a cor de texto de um slide a partir do que foi escolhido em
 * "Editar slide". Duas coisas importantes aqui, que antes faziam parecer que "não dá pra
 * mudar a cor do texto":
 *  - a cor escolhida com pouco contraste era DESCARTADA em silêncio; agora ela só tem o
 *    brilho ajustado, mantendo o tom que a pessoa pediu;
 *  - o TÍTULO ignorava a escolha e usava sempre a cor de destaque da paleta. Agora, se a
 *    pessoa escolheu uma cor de texto, o título segue essa cor; sem escolha, ele volta a
 *    usar o destaque da paleta (pra não ficar igual ao corpo do texto).
 */
function slideColors(slide, fallbackBg, c1) {
  const bg = slide.bgColor || fallbackBg
  const auto = readableTextColor(bg)
  const escolhida = slide.textColor ? (adjustForContrast(slide.textColor, bg) || auto) : null
  return { bg, heading: escolhida || auto, titleColor: escolhida || titleColorFor(c1, bg) }
}

/**
 * ATENÇÃO — daqui pra baixo é o DESENHO DO SLIDE, e ele nunca deve usar classe responsiva
 * do Tailwind (md:, sm:, lg:). O motivo: o slide é sempre renderizado no canvas fixo de
 * 1600x900 e só encolhido visualmente pelo ScaledCanvas. Mas as classes md:/sm: olham para a
 * largura da JANELA, não do canvas — então, no celular, o slide continuava com 1600px de
 * largura mas se remontava no formato "de celular": as colunas viravam uma embaixo da outra
 * (pacotes e resumo dos pacotes ficavam completamente diferentes do computador) e a coluna
 * da imagem, marcada como "hidden md:block", simplesmente sumia (a foto aparecia na edição
 * do slide mas não aparecia no slide). Aqui dentro use sempre o valor de computador direto.
 */
/**
 * Escala de fonte do slide. Em vez de mexer no tamanho de cada texto um por um (são dezenas
 * de lugares espalhados por ~20 tipos de slide), a escolha entra como duas variáveis de CSS
 * na raiz do slide; o index.css multiplica por elas os tamanhos de texto usados no desenho.
 * Assim vale para título, descrição, tópicos e textos de qualquer slide, de uma vez só.
 */
function escalaDeFonte(slide) {
  return {
    '--esc-titulo': (Number(slide.titleScale) || 100) / 100,
    '--esc-texto': (Number(slide.textScale) || 100) / 100,
  }
}

function SlideView(props) {
  return (
    <div className="esc-fonte w-full h-full" style={escalaDeFonte(props.slide)}>
      <SlideBody {...props} />
    </div>
  )
}

function SlideBody({ slide, c1, c2, c3, revealCount, settings, exportMode }) {
  const t2 = readableTextColor(c2)
  // se a cor de destaque (c1) não tiver contraste suficiente sobre o fundo (c2),
  // usamos automaticamente a cor de texto legível no lugar — nunca mais texto "sumindo"
  const c1OnC2 = isLowContrast(c1, c2) ? t2 : c1
  const radius = STYLE.radius

  switch (slide.type) {
    case 'cover': {
      const temFoto = !!slide.image
      // o degradê existe só para dar contraste ao texto POR CIMA da foto. Sem foto, ele
      // deixava a capa com um cinza esquisito de cima a baixo — então some junto, e a capa
      // vira uma página de cor sólida, com fundo e texto escolhidos na edição do slide.
      const { bg } = slideColors(slide, INK, c1)
      // com foto, o texto fica sobre a parte escura do degradê — então o contraste da cor
      // escolhida é conferido contra esse escuro, e não contra a cor de fundo do slide (que
      // nem aparece). Sem cor escolhida, volta ao padrão: branco no título, destaque no kicker.
      const fundoDoTexto = temFoto ? '#101418' : bg
      const escolhida = slide.textColor ? (adjustForContrast(slide.textColor, fundoDoTexto) || null) : null
      const corTitulo = escolhida || (temFoto ? '#FFFFFF' : titleColorFor(c1, bg))
      const corKicker = escolhida || (temFoto ? c1 : titleColorFor(c1, bg))
      const corCorpo = escolhida || (temFoto ? '#FFFFFF' : readableTextColor(bg))
      const marca = [settings?.professionalName, settings?.companyName].filter(Boolean)
      return (
        <div className="w-full h-full relative flex items-end" style={temFoto ? undefined : { background: bg }}>
          {temFoto && (
            <>
              <SlideImage src={slide.image} className="absolute inset-0 w-full h-full" style={{ objectPosition: `${slide.imagePosX ?? 50}% ${slide.imagePosY ?? 50}%` }} />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.8) 10%, rgba(0,0,0,0.15) 60%, rgba(0,0,0,0.4) 100%)' }} />
            </>
          )}
          {/* marca no topo: o mesmo conjunto logo + nome do profissional + nome do escritório
              que aparece no cabeçalho da lista de propostas */}
          {(settings?.logoDataUrl || marca.length > 0) && (
            <div className="absolute z-10 top-10 left-10 flex items-center gap-4">
              {settings?.logoDataUrl && <div className="h-16 w-16 rounded-full shrink-0" style={coverBg(settings.logoDataUrl)} />}
              {marca.length > 0 && (
                <div className="leading-tight">
                  {settings?.professionalName && (
                    <div className="text-2xl" style={{ ...titleStyle, color: temFoto ? '#FFFFFF' : corTitulo }}>{settings.professionalName}</div>
                  )}
                  {settings?.companyName && (
                    <div className="text-base" style={{ color: corCorpo, opacity: 0.75 }}>{settings.companyName}</div>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="relative z-10 p-20">
            {/* 'pre' = não quebra sozinho pela largura; só quebra onde a pessoa apertou Enter */}
            {slide.kicker && <div className="text-xs tracking-[0.2em] uppercase mb-4" style={{ color: corKicker, whiteSpace: 'pre' }}>{slide.kicker}</div>}
            {/* 'pre' = não quebra sozinho pela largura; quebra só onde a pessoa apertou Enter */}
            <h1 className="text-5xl mb-6" style={{ ...titleStyle, color: corTitulo, whiteSpace: 'pre' }}>{slide.title}</h1>
            {/* sem animação na capa, a pedido — o texto aparece pronto, junto com o slide */}
            {slide.items.map((it, i) => (
              <p key={i} className="text-lg mb-2 max-w-2xl whitespace-pre-line" style={{ color: corCorpo, opacity: 0.85 }}>{it}</p>
            ))}
          </div>
        </div>
      )
    }

    case 'divider': {
      const { bg, heading, titleColor } = slideColors(slide, c2, c1)
      return (
        <div className="w-full h-full flex flex-col items-center justify-center text-center px-10" style={{ background: bg }}>
          <h2 className="text-4xl max-w-3xl" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
          {slide.subtitle && <p className="mt-5 max-w-xl" style={{ color: heading, opacity: 0.75 }}>{slide.subtitle}</p>}
        </div>
      )
    }

    case 'agenda': {
      const { bg, heading, titleColor } = slideColors(slide, SAND, c1)
      return (
        <SplitLayout image={slide.image} radius={radius} noImage={slide.noImage} imagePosition={slide.imagePosition} imagePosX={slide.imagePosX} imagePosY={slide.imagePosY} bg={bg}>
          <h2 className="text-3xl mb-8" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
          <ol className="space-y-3">
            {slide.items.map((it, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="flex gap-3 text-lg" style={{ color: heading }}>
                <span style={{ color: c1 }} className="font-semibold">{i + 1}.</span>
                <span>{it}</span>
              </Reveal>
            ))}
          </ol>
        </SplitLayout>
      )
    }

    case 'profile': {
      const { bg, heading, titleColor } = slideColors(slide, SAND, c1)
      return (
        <SplitLayout image={slide.image} radius={radius} imageRight noImage={slide.noImage} imagePosition={slide.imagePosition} imagePosX={slide.imagePosX} imagePosY={slide.imagePosY} bg={bg}>
          {/* sem div extra aqui — o próprio SplitLayout já centraliza e dimensiona o bloco de
              texto; um wrapper "max-w-md mx-auto" aninhado por dentro dele competia com essa
              centralização e podia empurrar o texto pro canto errado */}
          <h2 className="auto-left-item text-3xl mb-6" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
          {/* todos os textos aparecem juntos, vindos da esquerda, sem precisar clicar */}
          {slide.items.map((it, i) => (
            <p key={i} className="auto-left-item whitespace-pre-line mb-4 leading-relaxed" style={{ color: heading, opacity: 0.85 }}>{it}</p>
          ))}
        </SplitLayout>
      )
    }

    case 'clientRequest': {
      const { bg, heading, titleColor } = slideColors(slide, SAND, c1)
      return (
        <SplitLayout image={slide.image} radius={radius} noImage={slide.noImage} imagePosition={slide.imagePosition} imagePosX={slide.imagePosX} imagePosY={slide.imagePosY} bg={bg}>
          <h2 className="text-2xl mb-8" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
          <div className="space-y-4">
            {slide.rows.map(([label, value], i) => (
              <Reveal key={i} i={i} revealCount={revealCount}>
                <div className="text-xs tracking-wide uppercase mb-0.5" style={{ color: heading, opacity: 0.55 }}>{label}</div>
                <div className="text-base" style={{ color: heading }}>{value}</div>
              </Reveal>
            ))}
            {slide.ambientes.length > 0 && (
              <Reveal i={slide.rows.length} revealCount={revealCount}>
                <div className="text-xs tracking-wide uppercase mb-1" style={{ color: heading, opacity: 0.55 }}>Ambientes {slide.quantAmbientes ? `(${slide.quantAmbientes})` : ''}</div>
                <div className="flex flex-wrap gap-2">
                  {slide.ambientes.map((a, k) => (
                    <span key={k} className="text-sm px-2.5 py-1 border" style={{ borderRadius: radius, borderColor: heading + '55', color: heading }}>{a}</span>
                  ))}
                </div>
              </Reveal>
            )}
          </div>
        </SplitLayout>
      )
    }

    case 'reasons': {
      const { bg, heading, titleColor } = slideColors(slide, SAND, c1)
      return (
        <SplitLayout image={slide.image} radius={radius} imageRight noImage={slide.noImage} imagePosition={slide.imagePosition} imagePosX={slide.imagePosX} imagePosY={slide.imagePosY} bg={bg}>
          <h2 className="text-2xl mb-6" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
          <div className="space-y-4">
            {slide.items.map((r, i) => (
              <Reveal key={i} i={i} revealCount={revealCount}>
                <div className="font-semibold" style={{ color: c1 }}>{i + 1}. {r.title}</div>
                <div className="text-base mt-1" style={{ color: heading, opacity: 0.8 }}>{r.body}</div>
              </Reveal>
            ))}
          </div>
        </SplitLayout>
      )
    }

    case 'scopeSection':
      return <TopicImageSlide slide={slide} c1={c1} revealCount={revealCount} radius={radius} />

    // seção de escopo com UMA foto fixa na lateral (hoje: Acompanhamento de obra) — o texto
    // ocupa uma metade e a foto a outra, com lado e enquadramento escolhidos na edição do slide
    case 'scopeSplit': {
      const { bg, heading, titleColor } = slideColors(slide, SAND, c1)
      return (
        <SplitLayout
          image={slide.image} radius={radius} imageRight
          noImage={slide.noImage} imagePosition={slide.imagePosition}
          imagePosX={slide.imagePosX} imagePosY={slide.imagePosY} bg={bg}
        >
          <h2 className="text-3xl mb-4" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
          {slide.description && <p className="mb-6 leading-relaxed" style={{ color: heading, opacity: 0.7 }}>{slide.description}</p>}
          <div className="space-y-2">
            {slide.items.map((it, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="flex items-start gap-2 text-lg" style={{ color: heading, opacity: 0.85 }}>
                <span style={{ color: c1 }}>●</span><span>{it}</span>
              </Reveal>
            ))}
          </div>
        </SplitLayout>
      )
    }

    case 'modeling':
      return <TopicImageSlide slide={slide} c1={c1} revealCount={revealCount} radius={radius} />

    case 'journeyFlow':
      return <JourneyFlowSlide slide={slide} c1={c1} c2={c2} t2={t2} revealCount={revealCount} radius={radius} />

    case 'stages': {
      const { bg, heading, titleColor } = slideColors(slide, SAND, c1)
      return (
        <div className="w-full h-full p-16 overflow-auto" style={{ background: bg }}>
          <h2 className="text-3xl mb-8" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
          <div className="grid grid-cols-3 gap-4">
            {slide.stages.map((s, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="bg-white border border-line p-5 flex flex-col" style={{ borderRadius: radius }}>
                <div className="font-semibold mb-3 text-lg" style={{ color: c1 }}>{i + 1}. {s.title}</div>
                <ul className="space-y-1.5 text-base text-ink/75 mb-4">{(s.items || []).map((it, k) => <li key={k}>• {it}</li>)}</ul>
                {/* prazo previsto desta apresentação, um por pacote (cada pacote tem a sua
                    própria data) — em destaque logo abaixo da descrição */}
                {!s.hideDeadlines && (s.deadlines || []).length > 0 && (
                  <div className="mb-4 px-3 py-2.5" style={{ borderRadius: radius, background: c1 + '14', borderLeft: `3px solid ${c1}` }}>
                    <div className="text-[11px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: c1 }}>
                      Prazos previstos {i + 1}ª apresentação
                    </div>
                    {s.deadlines.map((d) => (
                      <div key={d.id} className="flex justify-between gap-3 text-sm text-ink/80">
                        <span>{d.label}:</span><span className="font-medium shrink-0">{d.date}</span>
                      </div>
                    ))}
                  </div>
                )}
                {s.image && <div className="mt-auto w-full aspect-square rounded-md" style={coverBg(s.image, `${s.posX ?? 50}% ${s.posY ?? 50}%`)} />}
              </Reveal>
            ))}
          </div>
          {slide.footnote && <p className="text-sm mt-8 max-w-2xl" style={{ color: heading, opacity: 0.65 }}>{slide.footnote}</p>}
        </div>
      )
    }

    case 'feedbacks':
      return <FeedbacksSlide slide={slide} c1={c1} revealCount={revealCount} radius={radius} />

    case 'beforeAfter':
      return <AntesDepoisSlide slide={slide} c1={c1} revealCount={revealCount} radius={radius} />

    case 'pricingCalc': {
      const { bg, heading, titleColor } = slideColors(slide, SAND, c1)
      return (
        <div className="w-full h-full p-16 overflow-auto flex flex-col" style={{ background: bg }}>
          <h2 className="text-2xl mb-6" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
          {/* os tópicos aparecem juntos, sem precisar clicar */}
          <ul className="space-y-2 max-w-2xl mb-8">
            {slide.items.map((it, i) => (
              <li key={i} className="auto-left-item text-base" style={{ animationDelay: `${i * 30}ms`, color: heading, opacity: 0.85 }}>• {it}</li>
            ))}
          </ul>
          {/* os cards só aparecem depois dos tópicos, com um clique */}
          {(slide.hourValue || slide.dayValue) && (
            <Reveal i={0} revealCount={revealCount} className="flex flex-wrap gap-4">
              {slide.hourValue && <PriceTag label="Hora técnica" value={slide.hourValue} radius={radius} c1={c1} big />}
              {slide.dayValue && <PriceTag label="Diária de trabalho" value={slide.dayValue} radius={radius} c1={c1} big />}
            </Reveal>
          )}
        </div>
      )
    }

    case 'packagesSummary': {
      const { bg, heading, titleColor } = slideColors(slide, SAND, c1)
      return (
        <div className="w-full h-full p-12 overflow-auto" style={{ background: bg }}>
          <h2 className="text-3xl mb-10 text-center" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
          <div className={`grid ${slide.packages.length === 2 ? 'grid-cols-2' : 'grid-cols-3'} gap-5`}>
            {slide.packages.map((pkg, i) => {
              const extra = slide.packageExtras?.[pkg.id]
              return (
                <Reveal key={pkg.id} i={i} revealCount={revealCount} className="bg-white border border-line p-5 flex flex-col" style={{ borderRadius: radius }}>
                  <div className="text-base uppercase tracking-wide opacity-60 mb-1" style={{ color: heading }}>{pkg.label}</div>
                  <div className="text-3xl font-semibold mb-2" style={{ color: c1, fontFamily: STYLE.displayFont }}>{pkg.value}</div>
                  {pkg.schedule.length > 0 && <div className="text-sm mb-3" style={{ color: heading, opacity: 0.65 }}>{pkg.schedule.join(' · ')}</div>}
                  {/* bônus em destaque: mesma "caixa escura com ★" do cartão de crédito recomendado
                      no slide do pacote, para o olho reconhecer como algo especial. Fica logo abaixo
                      do valor e aparece mesmo com "descrições" ocultas — é argumento de venda, não
                      detalhe. Pacote sem bônus não ganha caixa nenhuma. */}
                  {pkg.bonus?.length > 0 && (
                    <div className="px-4 py-3 mb-4" style={{ borderRadius: radius, background: c2, color: t2, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                      <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: c1OnC2 }}>★ Bônus do pacote</div>
                      {pkg.bonus.map((b, k) => <div key={k} className="text-base font-semibold">{b}</div>)}
                    </div>
                  )}
                  {/* formas de pagamento e descrições podem ser ocultadas por proposta — e
                      ocultar as descrições não mexe na foto do pacote, que continua aparecendo */}
                  {!slide.hidePayments && pkg.paymentCards.length > 0 && (
                    <div className="pt-3 border-t border-line space-y-1 mb-4">
                      {pkg.paymentCards.map((p) => (
                        <div key={p.id} className="text-sm flex justify-between gap-2" style={{ color: heading, opacity: 0.7 }}>
                          <span>{p.label}</span><span className="shrink-0">{p.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!slide.hideDescriptions && pkg.benefits && pkg.benefits.length > 0 && (
                    <ul className="text-sm space-y-1 mb-3 pt-3 border-t border-line" style={{ color: heading, opacity: 0.8 }}>
                      {pkg.benefits.map((b, k) => <li key={k}>• {b}</li>)}
                    </ul>
                  )}
                  {extra?.image && <div className="w-full rounded-lg mb-3 mt-auto" style={{ height: '190px', ...coverBg(extra.image, `${extra.posX ?? 50}% ${extra.posY ?? 50}%`) }} />}
                  {!slide.hideDescriptions && extra?.description && <div className="text-base mt-auto pt-2" style={{ color: heading, opacity: 0.85 }}>{extra.description}</div>}
                </Reveal>
              )
            })}
          </div>
        </div>
      )
    }

    case 'packagePricing': {
      const { bg, heading, titleColor } = slideColors(slide, SAND, c1)
      const hasBenefits = slide.benefits && slide.benefits.length > 0
      const hasBonus = slide.bonus && slide.bonus.length > 0
      return (
        <div className="w-full h-full grid grid-cols-2">
          {/* metade esquerda: título + benefícios do pacote — aparecem juntos, sem precisar clicar */}
          <div className="p-12 flex flex-col justify-center overflow-auto" style={{ background: bg }}>
            <h2 className="text-3xl mb-6" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
            {(hasBenefits || hasBonus) && (
              <>
                <div className="text-sm font-medium uppercase tracking-wide mb-3" style={{ color: heading, opacity: 0.6 }}>Benefícios do pacote</div>
                {/* card branco do bônus, antes da lista de benefícios (desenho criado pela Elaynne).
                    Fundo branco e texto grafite FIXOS, sem seguir a cor do slide: é o que faz o bônus
                    saltar aos olhos sobre qualquer fundo, e mantém a leitura garantida.
                    self-start: o card abraça o texto em vez de esticar até a borda da coluna. */}
                {hasBonus && (
                  <div className="self-start bg-white px-5 py-4 mb-4" style={{ borderRadius: radius, color: '#28313C', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', maxWidth: '100%' }}>
                    <div className="text-base font-semibold uppercase mb-2">★ Bônus do pacote:</div>
                    {slide.bonus.map((b, i) => <div key={i} className="text-lg font-semibold">{b}</div>)}
                  </div>
                )}
                <div className="space-y-2">
                  {slide.benefits.map((b, i) => (
                    <div key={i} className="auto-left-item flex items-start gap-2" style={{ animationDelay: `${i * 40}ms`, color: heading, opacity: 0.85 }}>
                      <span style={{ color: c1 }}>●</span><span>{b}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* metade direita: valor, prazo e formas de pagamento — só aparecem depois, ao clicar */}
          <div className="p-12 overflow-auto bg-white flex flex-col justify-center">
            <Reveal i={0} revealCount={revealCount} className="grid grid-cols-2 gap-4 mb-5">
              <div className="p-5 border border-line" style={{ borderRadius: radius }}>
                <div className="text-xs uppercase tracking-wide opacity-60 mb-1" style={{ color: '#28313C' }}>Valor do pacote</div>
                <div className="text-2xl font-semibold" style={{ color: c1, fontFamily: STYLE.displayFont }}>{slide.value}</div>
              </div>
              {slide.schedule.length > 0 && (
                <div className="p-5 border border-line" style={{ borderRadius: radius }}>
                  <div className="text-xs uppercase tracking-wide opacity-60 mb-1" style={{ color: '#28313C' }}>Prazo do projeto</div>
                  <div className="text-sm" style={{ color: '#28313C', opacity: 0.8 }}>{slide.schedule.join(' · ')}</div>
                </div>
              )}
            </Reveal>
            <div className="grid grid-cols-2 gap-4">
              {slide.paymentCards.map((p, i) => (
                <Reveal
                  key={p.id} i={i + 1} revealCount={revealCount}
                  className="p-5 text-left"
                  style={{
                    borderRadius: radius,
                    background: p.highlight ? c2 : 'white',
                    color: p.highlight ? t2 : '#28313C',
                    border: p.highlight ? 'none' : '1px solid #E4DFD6',
                    boxShadow: p.highlight ? '0 8px 24px rgba(0,0,0,0.12)' : 'none',
                  }}
                >
                  <div className="text-xs uppercase tracking-wide opacity-70 mb-1">{p.label}{p.highlight ? ' ★' : ''}</div>
                  <div className="text-xl font-semibold mb-1" style={{ color: p.highlight ? c1OnC2 : c1, fontFamily: STYLE.displayFont }}>{p.value}</div>
                  {p.detail && <div className="text-xs opacity-70">{p.detail}</div>}
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      )
    }

    case 'video':
      return (
        <div className="w-full h-full bg-ink flex items-center justify-center p-10 relative">
          {slide.title && (
            <div className="absolute top-8 left-10 right-10 text-white text-2xl font-bold tracking-wide z-10" style={{ fontFamily: STYLE.displayFont }}>{slide.title}</div>
          )}
          <div className="w-full h-full flex items-center justify-center pt-20">
          {slide.videoUrl ? (
            <video src={slide.videoUrl} controls className="max-w-full max-h-full" style={{ borderRadius: STYLE.radius }} />
          ) : slide.embedUrl ? (
            exportMode ? (
              <div className="text-white/60 text-center px-10">
                <div className="text-4xl mb-3">▶</div>
                <div>Assista ao vídeo na apresentação online (este PDF não reproduz vídeos).</div>
              </div>
            ) : (
              <iframe src={slide.embedUrl} className="w-full h-full" style={{ borderRadius: STYLE.radius }} allowFullScreen allow="autoplay; encrypted-media; picture-in-picture" title="video" />
            )
          ) : (
            <div className="text-white/50 text-center">
              <div className="text-4xl mb-3">▶</div>
              <div>Nenhum vídeo adicionado ainda.</div>
              <div className="text-sm mt-1">Clique em "✎ Editar slide" para enviar um vídeo.</div>
            </div>
          )}
          </div>
        </div>
      )

    case 'custom': {
      // slide livre: a pessoa escolhe página inteira ou dividida, o formato do texto e a posição.
      // Slides extras criados antes disso (sem layoutMode) seguem com o desenho antigo, abaixo.
      if (slide.layoutMode && !slide.embedUrl && !slide.videoUrl) {
        return <SlideLivre slide={slide} c1={c1} radius={radius} revealCount={revealCount} />
      }
      // sem vídeo, o slide extra passa a se comportar exatamente como as seções de escopo:
      // título, tópicos e uma faixa de fotos (nenhuma, uma ou várias). É isso que faz o
      // "não usar imagem" funcionar de verdade aqui — antes sobrava sempre a metade direita
      // reservada pra foto, mesmo sem foto nenhuma.
      if (!slide.embedUrl && !slide.videoUrl) {
        return <TopicImageSlide slide={slide} c1={c1} revealCount={revealCount} radius={radius} />
      }
      const { bg, heading, titleColor } = slideColors(slide, SAND, c1)
      return (
        <div className="w-full h-full grid grid-cols-2" style={{ background: bg }}>
          <div className="p-16 flex flex-col justify-center order-1">
            <h2 className="text-3xl mb-6" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
            {(slide.items || [slide.body]).filter(Boolean).map((it, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="mb-3 whitespace-pre-line" style={{ color: heading, opacity: 0.85 }}>{it}</Reveal>
            ))}
          </div>
          <div className="order-2 relative">
            {slide.embedUrl ? (
              exportMode ? (
                <div className="w-full h-full flex items-center justify-center bg-ink text-white/60 text-center px-6 text-sm">Assista ao vídeo na apresentação online</div>
              ) : (
                <iframe src={slide.embedUrl} className="w-full h-full" allowFullScreen allow="autoplay; encrypted-media; picture-in-picture" title="video" />
              )
            ) : slide.videoUrl ? (
              <video src={slide.videoUrl} controls className="w-full h-full object-cover" />
            ) : (
              <SlideImage src={slide.image} className="w-full h-full" />
            )}
          </div>
        </div>
      )
    }

    case 'closing': {
      const { bg, heading, titleColor } = slideColors(slide, c2, c1)
      const quoteColor = slide.textColor ? (adjustForContrast(slide.textColor, bg) || c1OnC2) : c1OnC2
      return (
        <div className="w-full h-full flex flex-col items-center justify-center text-center px-10" style={{ background: bg }}>
          <h2 className="text-2xl mb-6" style={{ ...titleStyle, color: titleColor, opacity: 0.9 }}>{slide.headline}</h2>
          <p className="text-2xl italic max-w-2xl" style={{ color: quoteColor, fontFamily: STYLE.displayFont }}>&ldquo;{slide.quote}&rdquo;</p>
          {slide.author && <p className="text-sm mt-4 tracking-wide" style={{ color: heading, opacity: 0.6 }}>{slide.author}</p>}
        </div>
      )
    }

    default:
      return <div className="w-full h-full flex items-center justify-center text-white/50">Slide</div>
  }
}

function JourneyFlowSlide({ slide, c1, c2, t2, revealCount, radius }) {
  // aceita tanto o formato antigo (só a URL) quanto o novo ({ url, posX, posY }), pra
  // propostas salvas antes do ajuste de enquadramento continuarem funcionando
  const stepImages = (slide.stepImages || []).map((v) => (typeof v === 'string' ? { url: v } : (v || {})))
  const { bg, heading, titleColor } = slideColors(slide, SAND, c1)
  return (
    <div className="w-full h-full p-14 overflow-auto" style={{ background: bg }}>
      <h2 className="text-4xl mb-2" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
      <p className="text-sm mb-8" style={{ color: heading, opacity: 0.6 }}>{slide.subtitle}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-4">
        {slide.items.map((it, i) => (
          <Reveal key={i} i={i} revealCount={revealCount} className="flex items-center gap-3">
            <div
              className="flex flex-col items-start justify-center px-4 py-3 min-w-[180px] max-w-[220px] overflow-hidden"
              style={{ borderRadius: radius, background: i % 2 === 0 ? c2 : 'white', color: i % 2 === 0 ? t2 : '#28313C', border: i % 2 === 0 ? 'none' : '1px solid #E4DFD6', boxShadow: '0 4px 14px rgba(0,0,0,0.06)' }}
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold leading-none mb-2 shrink-0" style={{ background: c1, color: readableTextColor(c1) }}><span className="translate-y-px">{i + 1}</span></div>
              <div className="text-base leading-snug mb-2">{it}</div>
              {stepImages[i]?.url && <div className="w-full h-20 rounded-md" style={coverBg(stepImages[i].url, `${stepImages[i].posX ?? 50}% ${stepImages[i].posY ?? 50}%`)} />}
            </div>
            {i < slide.items.length - 1 && <div className="block text-2xl" style={{ color: c1 }}>→</div>}
          </Reveal>
        ))}
      </div>
    </div>
  )
}

function iconGlyph(key) {
  const map = { blueprint: '📐', plan: '🗺️', layers: '🗂️', eye: '👁️', detail: '🔍', sofa: '🛋️', more: '➕', tools: '🛠️' }
  return map[key] || '📄'
}

function PriceTag({ label, value, radius, c1, big }) {
  return (
    <div className={`bg-white border border-line ${big ? 'p-6' : 'p-4'}`} style={{ borderRadius: radius }}>
      <div className={`uppercase tracking-wide text-muted mb-1 ${big ? 'text-sm' : 'text-xs'}`}>{label}</div>
      <div className={`font-semibold ${big ? 'text-2xl' : 'text-lg'}`} style={{ color: c1, fontFamily: STYLE.displayFont }}>{value}</div>
    </div>
  )
}

/**
 * Layout de duas colunas usado em vários slides. Se noImage, o texto ocupa a página toda,
 * justificado à esquerda, em duas colunas (mais fácil de ler do que uma coluna estreita).
 * imagePosition escolhe se a imagem fica à esquerda ou à direita. O slide é sempre desenhado no
 * canvas fixo 1600x900 (ver ScaledCanvas), então NÃO se usa classe responsiva (md:, sm:...) aqui
 * dentro: o celular mostra exatamente o mesmo desenho do computador, só reduzido.
 */
function SplitLayout({ image, radius, imageRight = false, imagePosition, imagePosX, imagePosY, noImage, bg, children }) {
  if (noImage) {
    // sem imagem: o bloco de texto fica na lateral esquerda da página (não centralizado),
    // verticalmente centralizado para não colar no topo em slides com pouco conteúdo
    return (
      <div className="w-full h-full overflow-auto flex items-center" style={{ background: bg || SAND }}>
        <div className="p-16 max-w-2xl">{children}</div>
      </div>
    )
  }
  const onRight = imagePosition ? imagePosition === 'right' : imageRight
  // o bloco de texto fica centralizado (na horizontal e na vertical) dentro da sua metade da
  // página — mas o texto continua justificado à esquerda dentro do bloco (parágrafos com
  // início alinhado, não centro-a-centro linha a linha). max-w-lg (em vez de md) dá mais
  // espaço de largura pro texto — bios/textos longos (como em "Sobre mim") quebram em menos
  // linhas e ficam mais baixos, evitando cortar o final do texto no PDF (altura fixa).
  const text = (
    <div className="p-14 flex flex-col justify-center items-center overflow-auto" style={{ background: bg || SAND }}>
      <div className="max-w-lg w-full text-left">{children}</div>
    </div>
  )
  const img = <SlideImage src={image} className="w-full h-full" style={{ objectPosition: `${imagePosX ?? 50}% ${imagePosY ?? 50}%` }} />
  return (
    <div className="w-full h-full grid grid-cols-2">
      {onRight ? (<>{text}<div className="block" style={{ background: bg || SAND }}>{img}</div></>) : (<><div className="block" style={{ background: bg || SAND }}>{img}</div>{text}</>)}
    </div>
  )
}

/**
 * Layout usado nas seções de escopo e na modelagem 3D. Usa CSS Grid (em vez de flexbox
 * com altura em %) porque flex-basis em porcentagem dentro de colunas aninhadas é frágil
 * e foi a causa da foto de "Plantas Principais" aparecer gigante, por cima do título —
 * o Grid reserva a altura de cada linha antes de desenhar o conteúdo, então a área das
 * imagens nunca "estoura" por cima do título/tópicos.
 *
 * Com imagem: título centralizado no topo, tópicos empilhados à esquerda logo abaixo,
 * e as imagens numa faixa reservada mais abaixo, com um espaço bom entre elas e os tópicos.
 * Sem imagem nenhuma: título e tópicos ficam justificados à esquerda (não centralizados).
 */
function TopicImageSlide({ slide, c1, revealCount, radius }) {
  const imgs = effectiveImages(slide)
  const layout = slide.imageLayout || 'row'
  const hasImages = imgs.length > 0
  const { bg, heading, titleColor } = slideColors(slide, SAND, c1)

  const textoSolto = (
    <>
      <h2 className="text-3xl mb-4" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
      {slide.description && <p className="mb-6 leading-relaxed" style={{ color: heading, opacity: 0.7 }}>{slide.description}</p>}
      <div className="space-y-2">
        {(slide.items || []).filter(Boolean).map((it, i) => (
          <div key={i} className="auto-left-item flex items-start gap-2 text-lg" style={{ animationDelay: `${i * 40}ms`, color: heading, opacity: 0.85 }}>
            <span style={{ color: c1 }}>●</span><span>{it}</span>
          </div>
        ))}
      </div>
    </>
  )

  // sem nenhuma foto, o slide fica igual ao "Acompanhamento de obra" sem imagem: um bloco de
  // texto à esquerda, centralizado na vertical. Antes o título ficava colado no topo e os
  // tópicos caíam soltos no meio da página, porque a grade esticava as linhas vazias.
  if (!hasImages) {
    return <SplitLayout noImage bg={bg} radius={radius}>{textoSolto}</SplitLayout>
  }

  // uma foto só, posicionada na lateral: usa o mesmo desenho de duas colunas dos slides de
  // foto fixa (quem escolhe é a opção "Posição da imagem" na edição)
  const lateral = slide.imagePlacement === 'left' || slide.imagePlacement === 'right'
  if (imgs.length === 1 && lateral) {
    return (
      <SplitLayout
        image={imgs[0].url} radius={radius} bg={bg}
        imagePosition={slide.imagePlacement}
        imagePosX={imgs[0].posX} imagePosY={imgs[0].posY}
      >
        {textoSolto}
      </SplitLayout>
    )
  }

  return (
    <div
      className="w-full h-full p-14 overflow-hidden"
      style={{
        background: bg,
        display: 'grid',
        gridTemplateRows: hasImages ? 'auto auto minmax(0, 1fr)' : 'auto auto',
        rowGap: hasImages ? '2.5rem' : '1.5rem',
      }}
    >
      <div>
        <h2
          className={`text-3xl ${hasImages ? 'text-center' : 'text-left'}`}
          style={{ ...titleStyle, color: titleColor }}
        >
          {slide.title}
        </h2>
        {slide.description && (
          <p
            className={`mt-3 ${hasImages ? 'text-center max-w-2xl mx-auto' : 'text-left max-w-2xl'}`}
            style={{ color: heading, opacity: 0.7 }}
          >
            {slide.description}
          </p>
        )}
      </div>

      {/* tópicos sempre empilhados, um abaixo do outro, e sempre justificados à esquerda */}
      <div className={`space-y-2 ${hasImages ? 'max-w-xl' : 'max-w-2xl'}`}>
        {(slide.items || []).filter(Boolean).map((it, i) => (
          <div key={i} className="auto-left-item flex items-start gap-2 text-left" style={{ animationDelay: `${i * 40}ms`, color: heading, opacity: 0.85 }}>
            <span style={{ color: c1 }}>●</span><span>{it}</span>
          </div>
        ))}
      </div>

      {/* faixa das imagens: a altura dessa linha do grid já vem definida (o que resta da
          tela), então as fotos nunca crescem além dela nem ficam por cima do resto.
          Cada foto respeita o formato escolhido (1:1, 4:5, 16:9...) e nunca ultrapassa
          o espaço da sua célula — com muitas fotos, quebra em grade (3 em cima, 3 embaixo). */}
      {hasImages && <ImageStrip imgs={imgs} layout={layout} perRow={slide.imagesPerRow} revealCount={revealCount} radius={radius} />}
    </div>
  )
}

/**
 * Faixa de fotos das seções de escopo, da modelagem 3D e dos slides extras.
 *
 * O tamanho de cada foto é CALCULADO aqui, em vez de deixado para o CSS. Motivo: antes a
 * largura vinha da coluna do grid (100%) e a altura saía do formato escolhido — mas a faixa
 * tem altura limitada, então a altura era cortada e o formato deixava de valer com mais de
 * uma foto (1:1 não virava quadrado). Agora medimos o espaço disponível, dividimos em células
 * e encaixamos cada foto dentro da sua célula respeitando o formato: a foto cresce até bater
 * na largura OU na altura da célula, o que vier primeiro. As fotos ficam encostadas à
 * esquerda, alinhadas com o título e os tópicos acima delas.
 */
/**
 * Mede o espaço disponível de um elemento.
 *
 * offsetWidth/Height e NÃO getBoundingClientRect: o slide inteiro é desenhado em 1600x900 e
 * depois encolhido (ou ampliado) por um transform: scale para caber na tela. O
 * getBoundingClientRect devolve o tamanho JÁ escalado — e esse número, aplicado de volta
 * dentro do canvas, seria multiplicado pela escala outra vez.
 */
function useTamanhoDaCaixa(ref) {
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => {
      if (el.offsetWidth && el.offsetHeight) setBox({ w: el.offsetWidth, h: el.offsetHeight })
    }
    medir()
    let ro
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(medir); ro.observe(el) }
    return () => ro?.disconnect()
  }, [ref])
  return box
}

/**
 * Grade dos feedbacks. O formato escolhido para o print precisa ser calculado, não deixado
 * para o CSS: com aspect-ratio + altura cheia, a largura pedida passava da coluna e era
 * cortada por um maxWidth — e o card acabava exatamente igual ao de antes, como se a escolha
 * não tivesse sido salva. Aqui o card cresce até bater na largura OU na altura da célula, o
 * que vier primeiro, e o formato vale de verdade.
 */
function GradeDeFeedbacks({ itens, revealCount, radius, corDoCard, conteudo }) {
  const ref = useRef(null)
  const box = useTamanhoDaCaixa(ref)
  // mais espaço entre os quadros (antes eram 16px): com a foto do projeto embaixo de cada
  // feedback, os quadros colados uns nos outros viravam um bloco só, difícil de ler
  const GAP = 44
  const ROW_GAP = 28
  const ESPACO_FOTO = 16
  const colunas = Math.min(itens.length || 1, 3)
  const linhas = Math.max(1, Math.ceil((itens.length || 1) / colunas))
  const cellW = box.w ? (box.w - GAP * (colunas - 1)) / colunas : 0
  const cellH = box.h ? (box.h - ROW_GAP * (linhas - 1)) / linhas : 0
  // foto do projeto embaixo do feedback, sempre 5:4 (paisagem). Basta UM feedback ter foto para
  // todos reservarem o espaço dela — assim os quadros ficam alinhados no topo, do mesmo tamanho,
  // em vez de cada um numa altura. A foto fica com até 45% da altura; o quadro diminui para caber.
  const temFotoProjeto = itens.some((fb) => fb.projUrl)
  const fotoH = temFotoProjeto && cellW && cellH ? Math.min(cellW / 1.25, cellH * 0.45) : 0
  const cardH = cellH ? cellH - (fotoH ? fotoH + ESPACO_FOTO : 0) : 0
  // com foto, o quadro do feedback fica com a mesma largura da foto: os dois formam uma coluna
  // só, alinhada, em vez de um quadro largo com uma foto mais estreita embaixo
  const larguraMax = fotoH ? fotoH * 1.25 : cellW

  function estiloDoCard(fb) {
    const r = fb.printUrl ? RATIO_NUM[fb.printRatio] : null
    const base = { borderRadius: radius, background: corDoCard }
    if (!cellW || !cardH) return { ...base, width: '100%', height: '100%' }
    if (!r) return { ...base, width: larguraMax, maxWidth: '100%', height: cardH }
    const largura = Math.min(larguraMax, cardH * r)
    return { ...base, width: largura, height: largura / r }
  }

  return (
    <div ref={ref} className="flex-1 min-h-0 w-full">
      <div
        className="grid h-full"
        style={{ columnGap: GAP, rowGap: ROW_GAP, gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${linhas}, minmax(0, 1fr))` }}
      >
        {itens.map((fb, i) => (
          <Reveal
            key={i} i={i} revealCount={revealCount} className="flex flex-col min-h-0"
            style={{ justifyContent: temFotoProjeto ? 'flex-start' : 'center', gap: ESPACO_FOTO }}
          >
            <div className="overflow-hidden shrink-0" style={estiloDoCard(fb)}>{conteudo(fb)}</div>
            {fb.projUrl && (
              <div
                className="shrink-0"
                style={{ width: fotoH * 1.25, height: fotoH, maxWidth: '100%', borderRadius: radius, ...coverBg(fb.projUrl, `${fb.projPosX ?? 50}% ${fb.projPosY ?? 50}%`) }}
              />
            )}
          </Reveal>
        ))}
      </div>
    </div>
  )
}

/**
 * Slide de feedbacks em dois formatos:
 *  - grade (padrão): até 3 por fileira, cada um com a foto do projeto (opcional) embaixo;
 *  - "unico": a página dividida ao meio — o primeiro feedback da lista à esquerda e até 2 fotos
 *    do projeto à direita, com formato e enquadramento escolhidos.
 * Os cards precisam de altura definida: o print é desenhado como FUNDO do card (é assim que ele
 * sai certo no PDF), e fundo não tem altura própria como uma <img>.
 */
function FeedbacksSlide({ slide, c1, revealCount, radius }) {
  const { bg, heading, titleColor } = slideColors(slide, INK, c1)
  const corDoCard = heading === '#FFFFFF' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'
  const itens = slide.items || []

  const conteudo = (fb, grande) => (fb.printUrl ? (
    <div className="w-full h-full" style={{ ...coverBg(fb.printUrl, `${fb.printPosX ?? 50}% ${fb.printPosY ?? 50}%`) }} />
  ) : (
    <div className={grande ? 'p-8' : 'p-5'}>
      <div className="flex items-center gap-3 mb-3">
        {fb.photoUrl && <div className={`${grande ? 'w-14 h-14' : 'w-9 h-9'} rounded-full shrink-0`} style={coverBg(fb.photoUrl, `${fb.photoPosX ?? 50}% ${fb.photoPosY ?? 50}%`)} />}
        <div className={`${grande ? 'text-xl' : 'text-base'} font-semibold`} style={{ color: c1 }}>{fb.name}</div>
      </div>
      <div className={grande ? 'text-xl leading-relaxed' : 'text-base'} style={{ color: heading, opacity: 0.85 }}>{fb.text}</div>
    </div>
  ))

  if (slide.feedbackLayout === 'unico') {
    const fb = itens[0]
    const fotos = (slide.sideImages || []).slice(0, 2)
    return (
      <div className="w-full h-full grid grid-cols-2" style={{ background: bg }}>
        <div className="p-16 pr-8 flex flex-col min-h-0">
          <h2 className="text-4xl mb-8 shrink-0" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
          {fb && <FeedbackUnico fb={fb} radius={radius} corDoCard={corDoCard}>{conteudo(fb, true)}</FeedbackUnico>}
        </div>
        <div className="p-16 pl-8 flex flex-col min-h-0">
          {fotos.length > 0 && (
            <div className="flex-1 min-h-0">
              <ImageStrip imgs={fotos} layout="row" perRow={fotos.length} revealCount={999} radius={radius} />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full p-16 flex flex-col" style={{ background: bg }}>
      <h2 className="text-4xl mb-8 shrink-0" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
      <GradeDeFeedbacks itens={itens} revealCount={revealCount} radius={radius} corDoCard={corDoCard} conteudo={(fb) => conteudo(fb, false)} />
    </div>
  )
}

/** O card do feedback sozinho: com print em formato escolhido, o tamanho é calculado (mesma
 *  regra da grade); sem print, o card ocupa a largura da metade e a altura do próprio texto. */
function FeedbackUnico({ fb, radius, corDoCard, children }) {
  const ref = useRef(null)
  const box = useTamanhoDaCaixa(ref)
  let estilo = { borderRadius: radius, background: corDoCard, width: '100%' }
  if (fb.printUrl) {
    const r = RATIO_NUM[fb.printRatio]
    if (r && box.w && box.h) {
      const w = Math.min(box.w, box.h * r)
      estilo = { ...estilo, width: w, height: w / r }
    } else {
      estilo = { ...estilo, height: '100%' }
    }
  }
  return (
    <div ref={ref} className="flex-1 min-h-0 w-full flex items-center">
      <div className="overflow-hidden" style={estilo}>{children}</div>
    </div>
  )
}

/**
 * "Antes e depois": página dividida ao meio, cada lado com o seu título no topo à esquerda,
 * um texto opcional e até 4 fotos (formato e enquadramento escolhidos foto a foto). O lado
 * "Depois" tem cor de fundo e de texto próprias (bgColor2/textColor2) e entra com um clique.
 */
function AntesDepoisSlide({ slide, c1, revealCount, radius }) {
  const esquerda = slideColors(slide, SAND, c1)
  const direita = slideColors({ bgColor: slide.bgColor2, textColor: slide.textColor2 }, '#FFFFFF', c1)
  // slide inteiro vazio só aparece na tela de edição (o cliente nunca o vê — ver slideVazio);
  // ali vale mostrar onde as fotos vão entrar
  const vazio = slideVazio(slide)
  const temDepois = (slide.rightImages?.length || 0) > 0 || String(slide.rightText || '').trim()

  const lado = (titulo, texto, fotos, cores, aviso) => (
    <div className="h-full min-h-0 p-14 flex flex-col" style={{ background: cores.bg }}>
      <h2 className="text-4xl mb-4 shrink-0 text-left" style={{ ...titleStyle, color: cores.titleColor }}>{titulo}</h2>
      {String(texto || '').trim() && (
        <p className="text-lg mb-6 shrink-0 whitespace-pre-line max-w-xl text-left" style={{ color: cores.heading, opacity: 0.8 }}>{texto}</p>
      )}
      <div className="flex-1 min-h-0">
        {fotos.length > 0 ? (
          // até 2 fotos lado a lado; com 3 ou 4, duas por fileira (2 em cima, 2 embaixo)
          <ImageStrip imgs={fotos} layout="grid" perRow={fotos.length <= 2 ? fotos.length : 2} revealCount={999} radius={radius} />
        ) : vazio ? (
          <div className="w-full h-full border-2 border-dashed flex items-center justify-center text-base text-center px-6" style={{ borderColor: cores.heading, color: cores.heading, opacity: 0.35, borderRadius: radius }}>
            {aviso}
          </div>
        ) : null}
      </div>
    </div>
  )

  const ladoDepois = lado(slide.rightTitle ?? 'Depois', slide.rightText, slide.rightImages || [], direita, 'Fotos do depois: clique em ✎ Editar slide')
  return (
    <div className="w-full h-full grid grid-cols-2">
      {lado(slide.leftTitle ?? 'Antes', slide.leftText, slide.leftImages || [], esquerda, 'Fotos do antes: clique em ✎ Editar slide')}
      {temDepois ? <Reveal i={0} revealCount={revealCount} className="h-full min-h-0">{ladoDepois}</Reveal> : ladoDepois}
    </div>
  )
}

/**
 * Slide livre (o "Novo slide"): página inteira ou dividida ao meio. Cada parte é um "bloco"
 * com título, texto num dos formatos (tópicos, descrição grande ou cards), fotos opcionais e a
 * posição escolhida (esquerda/centro/direita × topo/meio/embaixo). O título da página inteira —
 * ou do lado esquerdo — é o próprio título do slide (o que aparece na lista lateral).
 */
/**
 * O que um bloco do slide livre realmente mostra (sem tópicos/cards vazios) e em quantos cliques.
 * Fica num lugar só porque o desenho (BlocoLivre) e a contagem de cliques (getItemsLength)
 * precisam concordar: se contassem diferente, sobraria clique "no vazio" ou faltaria clique e
 * algum item nunca apareceria.
 */
function conteudoDoBloco(bloco) {
  const formato = bloco.formato || 'topicos'
  const topicos = (bloco.itens || []).filter((t) => String(t || '').trim())
  const cards = (bloco.cards || []).filter((c) => String(c.titulo || '').trim() || String(c.texto || '').trim())
  const descricao = String(bloco.texto || '').trim()
  const fotos = bloco.imagens || []
  const passosTexto = formato === 'topicos' ? topicos.length : formato === 'cards' ? cards.length : formato === 'descricao' && descricao ? 1 : 0
  return { formato, topicos, cards, descricao, fotos, passosTexto, passos: passosTexto + fotos.length }
}

/** Blocos que aparecem no slide livre: um na página inteira, dois na dividida. */
function blocosDoSlideLivre(slide) {
  const blocos = slide.blocos || []
  return slide.layoutMode === 'dividido' ? [blocos[0] || {}, blocos[1] || {}] : [blocos[0] || {}]
}

function SlideLivre({ slide, c1, radius, revealCount }) {
  const blocos = blocosDoSlideLivre(slide)
  const blocoA = { ...blocos[0], titulo: slide.title }
  if (slide.layoutMode === 'dividido') {
    const coresA = slideColors(slide, SAND, c1)
    const coresB = slideColors({ bgColor: slide.bgColor2, textColor: slide.textColor2 }, '#FFFFFF', c1)
    // os cliques seguem a leitura: primeiro tudo do lado esquerdo, depois o direito
    const inicioB = conteudoDoBloco(blocos[0]).passos
    return (
      <div className="w-full h-full grid grid-cols-2">
        <BlocoLivre bloco={blocoA} cores={coresA} c1={c1} radius={radius} metade revealCount={revealCount} inicio={0} />
        <BlocoLivre bloco={blocos[1]} cores={coresB} c1={c1} radius={radius} metade revealCount={revealCount} inicio={inicioB} />
      </div>
    )
  }
  return <BlocoLivre bloco={blocoA} cores={slideColors(slide, SAND, c1)} c1={c1} radius={radius} revealCount={revealCount} inicio={0} />
}

const ALINHAR_H = { left: 'flex-start', center: 'center', right: 'flex-end' }
const ALINHAR_V = { top: 'flex-start', center: 'center', bottom: 'flex-end' }

/** Um bloco do slide livre. O título aparece já ao abrir; cada tópico, card (ou a descrição) e
 *  cada foto entra com um clique, contando a partir de "inicio". */
function BlocoLivre({ bloco, cores, c1, radius, metade = false, revealCount = 999, inicio = 0 }) {
  const h = bloco.alinhH || 'left'
  const v = bloco.alinhV || 'center'
  const { formato, topicos, cards, descricao, fotos, passosTexto } = conteudoDoBloco(bloco)
  const temTexto = passosTexto > 0
  const colunasCards = Number(bloco.cardsPorLinha) > 0 ? Number(bloco.cardsPorLinha) : Math.min(cards.length, metade ? 2 : 3)
  const corDoCard = cores.heading === '#FFFFFF' ? 'rgba(255,255,255,0.1)' : '#FFFFFF'
  // sem foto, o texto pode ocupar a página toda (antes ficava preso numa coluna estreita);
  // a largura máxima só existe para a linha não ficar comprida demais de ler
  const larguraTexto = metade ? '100%' : '80%'

  return (
    <div
      className="w-full h-full min-h-0 p-16 flex flex-col overflow-hidden"
      style={{ background: cores.bg, justifyContent: fotos.length ? 'flex-start' : ALINHAR_V[v], alignItems: ALINHAR_H[h], textAlign: h }}
    >
      {String(bloco.titulo || '').trim() && (
        <h2 className="text-4xl mb-6 shrink-0" style={{ ...titleStyle, color: cores.titleColor }}>{bloco.titulo}</h2>
      )}

      {formato === 'topicos' && topicos.length > 0 && (
        <div className="space-y-3 shrink-0" style={{ maxWidth: larguraTexto }}>
          {topicos.map((t, i) => (
            // Reveal por fora e a opacidade do texto por dentro: a animação controla a opacidade
            // do Reveal, e uma opacidade escrita nele mesmo impediria o tópico de ficar escondido
            <Reveal key={i} i={inicio + i} revealCount={revealCount}>
              <div className="flex items-start gap-3 text-xl" style={{ justifyContent: ALINHAR_H[h], color: cores.heading, opacity: 0.85 }}>
                <span style={{ color: c1 }}>●</span><span>{t}</span>
              </div>
            </Reveal>
          ))}
        </div>
      )}

      {formato === 'descricao' && descricao && (
        // "descrição grande": maior que um tópico, e ainda acompanha o controle de tamanho do texto
        <Reveal i={inicio} revealCount={revealCount} className="shrink-0" style={{ maxWidth: larguraTexto }}>
          <p className="whitespace-pre-line" style={{ color: cores.heading, opacity: 0.85, fontSize: 'calc(1.6rem * var(--esc-texto))', lineHeight: 1.45 }}>{descricao}</p>
        </Reveal>
      )}

      {formato === 'cards' && cards.length > 0 && (
        <div className="grid gap-4 shrink-0 w-full" style={{ gridTemplateColumns: `repeat(${colunasCards}, minmax(0, 1fr))` }}>
          {cards.map((c, i) => (
            <Reveal key={i} i={inicio + i} revealCount={revealCount} className="p-6" style={{ borderRadius: radius, background: corDoCard, border: corDoCard === '#FFFFFF' ? '1px solid #E4DFD6' : 'none' }}>
              {String(c.titulo || '').trim() && <div className="text-lg font-semibold mb-2" style={{ color: c1 }}>{c.titulo}</div>}
              {String(c.texto || '').trim() && <div className="text-base whitespace-pre-line" style={{ color: corDoCard === '#FFFFFF' ? '#28313C' : cores.heading, opacity: 0.85 }}>{c.texto}</div>}
            </Reveal>
          ))}
        </div>
      )}

      {fotos.length > 0 && (
        <div className={`flex-1 min-h-0 w-full self-stretch ${String(bloco.titulo || '').trim() || temTexto ? 'mt-8' : ''}`}>
          <ImageStrip
            // as fotos vêm depois dos textos deste bloco: a 1ª foto é o clique seguinte ao último texto
            imgs={fotos} layout="row" revealCount={revealCount - inicio - passosTexto} radius={radius}
            perRow={fotos.length > 3 ? Math.ceil(fotos.length / 2) : fotos.length}
            alinhar={h === 'center' ? 'center' : h === 'right' ? 'end' : 'start'}
          />
        </div>
      )}
    </div>
  )
}

function ImageStrip({ imgs, layout, perRow, revealCount, radius, alinhar = 'start' }) {
  const ref = useRef(null)
  const box = useTamanhoDaCaixa(ref)

  const GAP = 16
  const n = imgs.length
  // quantas fotos por fileira: a pessoa escolhe na edição. Sem escolha, mantém o antigo
  // ("lado a lado" = todas numa fileira; "grade" = até 3 por fileira)
  const escolhido = Number(perRow) > 0 ? Number(perRow) : 0
  const cols = Math.max(1, Math.min(escolhido || (layout === 'row' ? n : Math.min(n, 3)), n))
  const rows = Math.ceil(n / cols)
  const cellW = box.w ? (box.w - GAP * (cols - 1)) / cols : 0
  const cellH = box.h ? (box.h - GAP * (rows - 1)) / rows : 0

  function tamanho(img) {
    if (!cellW || !cellH) return { width: '100%', height: '100%' }
    const r = RATIO_NUM[img.ratio]
    // sem formato escolhido a foto ocupa a célula inteira (com uma foto só, metade da
    // largura, pra não ficar um retângulo gigante atravessando a página)
    if (!r) return { width: n === 1 ? cellW / 2 : cellW, height: cellH }
    const width = Math.min(cellW, cellH * r)
    return { width, height: width / r }
  }

  // grade fixa (e não flex com quebra de linha): com 3 fotos numa fileira, bastava a soma das
  // larguras passar um décimo de pixel do espaço disponível — coisa de arredondamento — pra
  // uma delas pular pra linha de baixo. Numa grade com o número de colunas definido, isso não
  // acontece: a foto pode ficar menor, mas nunca muda de fileira.
  return (
    <div ref={ref} className="min-h-0 w-full h-full">
      <div
        className="grid"
        style={{
          gap: GAP,
          height: '100%',
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          // à esquerda por padrão (alinhada com título e tópicos); o slide livre centraliza ou
          // encosta à direita quando o texto do bloco está assim
          justifyItems: alinhar,
          alignItems: 'center',
        }}
      >
        {imgs.map((img, i) => {
          const { width, height } = tamanho(img)
          return (
            <div key={i} className="relative overflow-hidden" style={{ borderRadius: radius, width, height, maxWidth: '100%' }}>
              <Reveal i={i} revealCount={revealCount} className="absolute inset-0">
                <SlideImage src={img.url} className="w-full h-full" style={{ objectPosition: `${img.posX ?? 50}% ${img.posY ?? 50}%` }} />
              </Reveal>
            </div>
          )
        })}
      </div>
    </div>
  )
}
