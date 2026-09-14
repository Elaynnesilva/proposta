import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProposal, getSettings, getTemplateContent, saveProposal, saveTemplateContent, getPublicProposal, getPublicSettings, getPublicTemplateContent, setProposalPublic, saveImageAsMedia } from '../lib/db'
import { auth } from '../lib/firebase'
import { buildSlides } from '../lib/slides'
import { DEFAULT_IMAGES, DEFAULT_SHARED_TEXT } from '../lib/content'
import { STYLE, paletteToCssVars, readableTextColor, isLowContrast, DEFAULT_PALETTE, FIXED_SWATCHES } from '../lib/templates'
import { toEmbedUrl } from '../lib/fields'

const SLIDE_ICONS = {
  cover: '🏠', agenda: '📋', profile: '👩‍🎨', divider: '—', clientRequest: '🗂️',
  reasons: '💡', scopeSection: '📐', modeling: '🧊', journeyFlow: '🧭', stages: '🎯',
  feedbacks: '💬', pricingCalc: '🧮', packagePricing: '💰', packagesSummary: '📊', payment: '💳', video: '🎬',
  custom: '✨', closing: '❤️',
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

export default function Presenter() {
  const { id, uid: publicUid } = useParams()
  const isPublic = !!publicUid
  const navigate = useNavigate()
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
  // id do slide recém-criado pelo botão "+ Novo slide": assim que ele aparecer na lista,
  // a apresentação pula pra ele e já abre o painel de edição
  const [slideNovoId, setSlideNovoId] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
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

  useEffect(() => {
    function onFsChange() {
      if (!document.fullscreenElement) setIsFullscreen(false)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  useEffect(() => {
    if (isPublic) {
      getPublicProposal(publicUid, id).then(setProposal)
      getPublicSettings(publicUid).then(setSettings)
      getPublicTemplateContent(publicUid).then(setTemplateContent)
    } else {
      getProposal(id).then(setProposal)
      getSettings().then(setSettings)
      getTemplateContent().then(setTemplateContent)
    }
  }, [id, isPublic, publicUid])

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

  const baseSlides = useMemo(() => {
    if (!proposal || !settings) return []
    return buildSlides({
      fields: proposal.fields || {},
      content, images, settings,
      custom: customSlides,
      videoUrl: resolvedVideoUrl,
      videoEmbedUrl: resolvedEmbedUrl,
      visibility: proposal.visibility || {},
    })
  }, [proposal, settings, templateContent, customSlides])

  const slides = useMemo(() => {
    // ORDEM DE PRECEDÊNCIA das edições de slide, da mais geral para a mais específica:
    //   1. o slide "de fábrica" montado a partir dos dados da proposta (buildSlides)
    //   2. o que foi salvo para TODOS os tipos de projeto (slideDefaults.all)
    //   3. o que foi salvo só para este tipo de projeto (slideDefaults[tipologia])
    //   4. o que foi editado só nesta proposta (proposal.slideOverrides)
    // É isso que faz uma foto colocada uma vez aparecer sozinha nas próximas propostas.
    const defaultsAll = templateContent?.slideDefaults?.all || {}
    const defaultsTipologia = templateContent?.slideDefaults?.[proposal?.tipologia] || {}
    let list = baseSlides.map((s) => {
      const base = { ...s, ...(defaultsAll[s.id] || {}), ...(defaultsTipologia[s.id] || {}) }
      const ov = proposal?.slideOverrides?.[s.id]
      const merged = { ...base, ...(ov || {}) }
      // a descrição do "Acompanhamento de obra" vem sempre de "Dados do projeto" — nunca de um
      // override salvo por engano numa versão antiga, senão um texto desatualizado ficaria
      // "preso" ali pra sempre, escondendo qualquer atualização feita depois nos dados do projeto
      if (s.id === 'obra') merged.description = s.description
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
      const remaining = list.filter((s) => !order.includes(s.id))
      list = [...ordered, ...remaining]
    }
    return list
  }, [baseSlides, templateContent, proposal?.tipologia, proposal?.slideOverrides, proposal?.slideOrder])

  // páginas ocultadas pela pessoa ficam fora da apresentação e do PDF, mas continuam
  // listadas (esmaecidas) na barra lateral, prontas para serem reativadas quando quiser
  const hiddenIds = useMemo(() => new Set(proposal?.hiddenSlides || []), [proposal?.hiddenSlides])
  const visibleSlides = useMemo(() => slides.filter((s) => !hiddenIds.has(s.id)), [slides, hiddenIds])

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
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); handleAdvance() }
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'Escape') navigate(`/proposta/${id}/editar`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
    setIndex(idx)
    setRevealCount(999)
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
  async function saveSlideByScope(slideId, patch, scope, slideType) {
    if (!scope || scope === 'proposal') {
      saveOverridePerProposal(slideId, patch)
      return
    }
    const bucket = scope === 'tipologia' ? (proposal?.tipologia || 'residencial') : 'all'

    // slide extra salvo para as outras propostas: ele deixa de ser "desta proposta" e passa a
    // fazer parte do modelo (aparece sozinho nas próximas). Guardamos o slide inteiro, não só
    // o patch, porque ele não é montado a partir dos dados do projeto como os demais.
    if (slideType === 'custom') {
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

  /** Cria um slide extra já dentro da apresentação, pula pra ele e abre a edição. */
  function novoSlide() {
    const novo = {
      id: `custom-${Date.now().toString(36)}`,
      title: 'Novo slide', items: [''], images: [], imageLayout: 'row', image: '', embedUrl: '',
    }
    updateProposal((prev) => ({ ...prev, customSlides: [...(prev.customSlides || []), novo] }))
    setSlideNovoId(novo.id)
  }

  async function handleExportPdf() {
    setExporting(true)
    try {
      const { default: html2canvas } = await import('html2canvas')
      const { jsPDF } = await import('jspdf')
      let pdf = null
      for (let i = 0; i < visibleSlides.length; i++) {
        setExportIndex(i)
        setExportProgress(i + 1)
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
        const img = canvas.toDataURL('image/jpeg', 0.92)
        if (!pdf) pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [EXPORT_W, EXPORT_H] })
        else pdf.addPage([EXPORT_W, EXPORT_H], 'landscape')
        pdf.addImage(img, 'JPEG', 0, 0, EXPORT_W, EXPORT_H)
      }
      if (!pdf) throw new Error('Nenhum slide pôde ser capturado')
      pdf.save(exportFileName(proposal))
    } catch (err) {
      alert('Não consegui gerar o PDF agora. Tente de novo em alguns segundos.')
      console.error(err)
    } finally {
      setExporting(false)
    }
  }

  if (!proposal || !settings) {
    return <div className="min-h-screen flex items-center justify-center text-muted">Carregando apresentação…</div>
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
          <ScaledCanvas onClick={handleAdvance}>
            <SlideView slide={slide} c1={c1} c2={c2} c3={c3} revealCount={revealCount} settings={settings} />
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
              {!isPublic && (
                <button onClick={() => setEditing((v) => !v)} className="text-xs px-3 py-1.5 rounded-full shrink-0 transition" style={{ background: editing ? c1 : 'rgba(255,255,255,.1)' }}>✎ {editing ? 'Fechar edição' : 'Editar slide'}</button>
              )}
              {!isPublic && (
                <button onClick={handleCopyLink} className="text-xs bg-white/10 px-3 py-1.5 rounded-full shrink-0">🔗 {linkCopied ? 'Copiado ✓' : 'Link'}</button>
              )}
              {!isPublic && (
                <button onClick={novoSlide} className="text-xs bg-white/10 px-3 py-1.5 rounded-full shrink-0">✚ Novo slide</button>
              )}
              <button disabled={exporting} onClick={handleExportPdf} className="text-xs bg-white/10 px-3 py-1.5 rounded-full shrink-0 disabled:opacity-50">⇩ {exporting ? `Gerando… ${exportProgress}/${visibleSlides.length}` : 'Baixar PDF'}</button>
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
                  embedded
                  slide={slide}
                  palette={palette}
                  proposal={proposal}
                  allowGlobal={!PROPOSAL_ONLY_SLIDE_TYPES.has(slide.type)}
                  onSave={(patch, scope) => saveSlideByScope(slide.id, patch, scope, slide.type)}
                  onSaveVideoScope={(scope, patch) => saveVideoByScope(scope, patch)}
                  onSaveFields={saveFieldsPatch}
                  onSaveVisibility={saveVisibilityPatch}
                  onClose={() => setEditing(false)}
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
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* ============ DESKTOP ("sm" pra cima): layout original lado a lado ============ */}
      <div className="hidden sm:flex h-full">
        {sidebarOpen && (
          <SlideSidebar
            slides={isPublic ? visibleSlides : slides}
            currentId={slide?.id}
            hiddenIds={hiddenIds}
            onJump={jumpToId}
            onToggleHidden={isPublic ? null : toggleHidden}
            onReorder={isPublic ? null : reorder}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        <div className="relative flex-1 min-w-0 overflow-hidden">
          <ScaledCanvas onClick={handleAdvance}>
            <SlideView slide={slide} c1={c1} c2={c2} c3={c3} revealCount={revealCount} settings={settings} />
          </ScaledCanvas>

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
              {!isPublic && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); setEditing((v) => !v) }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-2.5 sm:px-3 py-1.5 rounded-full transition shrink-0">✎<span className="hidden sm:inline"> {editing ? 'Fechar edição' : 'Editar slide'}</span></button>
                  <button onClick={(e) => { e.stopPropagation(); handleCopyLink() }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-2.5 sm:px-3 py-1.5 rounded-full transition shrink-0">
                    🔗<span className="hidden sm:inline"> {linkCopied ? 'Link copiado ✓' : 'Link para o cliente'}</span>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); novoSlide() }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-2.5 sm:px-3 py-1.5 rounded-full transition shrink-0">
                    ✚<span className="hidden sm:inline"> Novo slide</span>
                  </button>
                </>
              )}
              <button disabled={exporting} onClick={(e) => { e.stopPropagation(); handleExportPdf() }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-2.5 sm:px-3 py-1.5 rounded-full transition disabled:opacity-50 shrink-0">
                ⇩<span className="hidden sm:inline"> {exporting ? `Gerando PDF… ${exportProgress}/${visibleSlides.length}` : 'Baixar PDF'}</span>
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

          {editing && slide && (
            <EditPanel
              slide={slide}
              palette={palette}
              proposal={proposal}
              allowGlobal={!PROPOSAL_ONLY_SLIDE_TYPES.has(slide.type)}
              onSave={(patch, scope) => saveSlideByScope(slide.id, patch, scope, slide.type)}
              onSaveVideoScope={(scope, patch) => saveVideoByScope(scope, patch)}
              onSaveFields={saveFieldsPatch}
              onSaveVisibility={saveVisibilityPatch}
              onClose={() => setEditing(false)}
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
          {exporting && visibleSlides[exportIndex] && (
            <SlideView slide={visibleSlides[exportIndex]} c1={c1} c2={c2} c3={c3} revealCount={999} settings={settings} exportMode />
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
  // nestes dois, o texto aparece todo de uma vez — quem controla o clique agora são as imagens
  if (slide.type === 'scopeSection' || slide.type === 'modeling') return effectiveImages(slide).length
  // slide extra sem vídeo usa o mesmo desenho das seções de escopo: o texto aparece inteiro e
  // quem avança um a um são as fotos
  if (slide.type === 'custom' && !slide.embedUrl && !slide.videoUrl) return effectiveImages(slide).length
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

/** Junta o(s) campo(s) de imagem antigos (image/image2) com o novo array "images",
 *  para as propostas mais antigas continuarem funcionando sem precisar reeditar nada. */
function effectiveImages(slide) {
  if (slide.images && slide.images.length) return slide.images
  return [slide.image, slide.image2].filter(Boolean).map((url) => ({ url }))
}

const RATIO_CSS = { '1:1': '1 / 1', '4:5': '4 / 5', '5:4': '5 / 4', '9:16': '9 / 16', '16:9': '16 / 9' }

/* ---------------- BARRA LATERAL DE SLIDES ---------------- */

function SlideSidebar({ slides, currentId, hiddenIds, onJump, onToggleHidden, onReorder, onClose, embedded = false }) {
  const dragFrom = useRef(null)
  const canManage = !!onReorder

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
              draggable={canManage}
              onDragStart={() => (dragFrom.current = i)}
              onDragOver={(e) => canManage && e.preventDefault()}
              onDrop={() => { if (canManage && dragFrom.current !== null && dragFrom.current !== i) onReorder(dragFrom.current, i); dragFrom.current = null }}
              className={`mx-2 mb-1 px-2.5 py-2 rounded-lg flex items-center gap-2 text-xs transition ${s.id === currentId ? 'bg-white/15 text-white' : hidden ? 'text-white/30' : 'text-white/60 hover:bg-white/5'}`}
              title={canManage ? 'Arraste para reordenar' : undefined}
            >
              <span className="text-white/30 text-[10px] w-4 text-center shrink-0">{i + 1}</span>
              <span
                onClick={() => !hidden && onJump(s.id)}
                className={`flex-1 flex items-center gap-2 min-w-0 ${hidden ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <span>{SLIDE_ICONS[s.type] || '•'}</span>
                <span className="truncate">{s.title || slideFallbackLabel(s)}</span>
              </span>
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

const COLOR_CUSTOMIZABLE_TYPES = new Set(['cover', 'divider', 'agenda', 'profile', 'clientRequest', 'reasons', 'scopeSection', 'scopeSplit', 'modeling', 'journeyFlow', 'stages', 'feedbacks', 'pricingCalc', 'packagePricing', 'packagesSummary', 'custom', 'closing'])

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

function EditPanel({ slide, allowGlobal, onSave, onClose, palette = DEFAULT_PALETTE, proposal, onSaveVideoScope, onSaveFields, onSaveVisibility, embedded = false }) {
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
  // o slide extra sem vídeo usa o mesmo desenho das seções de escopo, então também ganha a
  // lista de várias fotos (e o "não usar imagem" de verdade)
  const isCustomSemVideo = slide.type === 'custom' && !slide.embedUrl && !slide.videoUrl
  const isMultiImage = slide.type === 'scopeSection' || slide.type === 'modeling' || isCustomSemVideo
  // guarda as fotos removidas pelo "não usar imagem" pra poder devolvê-las se desmarcar
  const [imagensGuardadas, setImagensGuardadas] = useState([])
  const [images, setImages] = useState(() => effectiveImages(slide))
  const [imageLayout, setImageLayout] = useState(slide.imageLayout || 'row')
  const [adjustingIdx, setAdjustingIdx] = useState(null)
  const hasSingleImage = 'image' in slide && !isMultiImage && slide.type !== 'cover'
  const isCover = slide.type === 'cover'
  // a foto única agora carrega o enquadramento junto ({ url, posX, posY }) — é o mesmo
  // objeto usado pelo SingleImageField em todos os outros lugares do painel
  const [coverImage, setCoverImage] = useState({ url: slide.image || '', posX: slide.imagePosX, posY: slide.imagePosY })
  const [singleImage, setSingleImage] = useState({ url: slide.image || '', posX: slide.imagePosX, posY: slide.imagePosY })
  const [noImage, setNoImage] = useState(!!slide.noImage)
  const [imagePosition, setImagePosition] = useState(slide.imagePosition || 'left')
  const isClientRequest = slide.type === 'clientRequest'
  const [objetivoProjeto, setObjetivoProjeto] = useState(slide.objetivoProjeto || '')
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
    acc[pkg.id] = (pkg.benefits || []).join('\n')
    return acc
  }, {}))
  const isVideo = slide.type === 'video'
  const [embedUrl, setEmbedUrl] = useState(slide.embedUrl || '')
  const [uploadingCount, setUploadingCount] = useState(0)

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

  useEffect(() => {
    setScope(allowGlobal ? lerEscopoSalvo(SCOPE_KEY, 'allTypes') : 'proposal')
    setTitle(slide.title || slide.headline || '')
    setItems(Array.isArray(slide.items) && typeof slide.items[0] !== 'object' ? [...slide.items] : null)
    setQuote(slide.quote || '')
    setAuthor(slide.author || '')
    setSubtitle(slide.subtitle || '')
    setDescription(slide.description || '')
    setBgColor(slide.bgColor || '')
    setTextColor(slide.textColor || '')
    setStepImages(normalizeStepImages(slide.stepImages))
    setImages(effectiveImages(slide))
    setImageLayout(slide.imageLayout || 'row')
    setEmbedUrl(slide.embedUrl || '')
    setAdjustingIdx(null)
    setSingleImage({ url: slide.image || '', posX: slide.imagePosX, posY: slide.imagePosY })
    setNoImage(!!slide.noImage)
    setImagePosition(slide.imagePosition || 'left')
    setCoverImage({ url: slide.image || '', posX: slide.imagePosX, posY: slide.imagePosY })
    setObjetivoProjeto(slide.objetivoProjeto || '')
    setHidePayments(!!slide.hidePayments)
    setHideDescriptions(!!slide.hideDescriptions)
    setPackageExtras((slide.packages || []).reduce((acc, pkg) => {
      acc[pkg.id] = { ...(slide.packageExtras?.[pkg.id] || {}) }
      return acc
    }, {}))
    setPackageBenefits((slide.packages || []).reduce((acc, pkg) => {
      acc[pkg.id] = (pkg.benefits || []).join('\n')
      return acc
    }, {}))
    setStages(slide.stages ? JSON.parse(JSON.stringify(slide.stages)) : [])
    setFootnote(slide.footnote || '')
    setReasonsList(slide.type === 'reasons' && Array.isArray(slide.items) ? JSON.parse(JSON.stringify(slide.items)) : [])
    setFeedbacks(slide.type === 'feedbacks' && Array.isArray(slide.items) ? JSON.parse(JSON.stringify(slide.items)) : [])
  }, [slide.id])

  function addImages(fileList) {
    const files = Array.from(fileList || [])
    files.forEach((file) => {
      handleImageFile(file, (url) => setImages((prev) => [...prev, { url, ratio: '' }]))
    })
  }

  function save() {
    if (isVideo) {
      guardarEscopo(VIDEO_SCOPE_KEY, videoScope)
      onSaveVideoScope?.(videoScope, { videoUrl: '', videoPath: '', embedUrl: toEmbedUrl(embedUrl) })
      onClose()
      return
    }

    const patch = slide.type === 'closing' ? { title, quote, author } : { title }
    if (items) patch.items = items
    if (slide.type === 'divider') { patch.subtitle = subtitle }
    if (slide.type === 'journeyFlow') { patch.subtitle = subtitle }
    if (isClientRequest) { onSaveFields?.({ objetivoProjeto }) }
    // a página de "Acompanhamento de obra" busca a descrição direto de "Dados do projeto"
    // (campo Descrição do acompanhamento de obra) — editar aqui atualiza esse campo, então
    // não fica um texto "preso" só nesta proposta, desalinhado do resto dos dados
    if (slide.id === 'obra') { onSaveFields?.({ acompanhamentoObraDescricao: description }) }
    if (isPackagesSummary) {
      patch.packageExtras = packageExtras
      patch.hidePayments = hidePayments
      patch.hideDescriptions = hideDescriptions
      // os tópicos editados aqui são os mesmos campos "Benefícios do pacote" usados nos
      // cards de cada pacote — salvar aqui atualiza os dois lugares de uma vez
      const beneficiosPatch = {}
      Object.entries(packageBenefits).forEach(([pkgId, text]) => {
        beneficiosPatch[`beneficios${pkgId.charAt(0).toUpperCase()}${pkgId.slice(1)}`] = text
      })
      onSaveFields?.(beneficiosPatch)
    }
    if (isStages) {
      // as datas em si moram em "Dados do projeto" e são remontadas a cada proposta — aqui só
      // vai o que é do slide (título, tópicos, foto e a escolha de mostrar ou não os prazos).
      // Sem isso, salvar "para todas as propostas" congelaria as datas deste cliente no modelo.
      patch.stages = stages.map(({ deadlines, ...resto }) => resto)
      patch.footnote = footnote
    }
    if (isReasons) { patch.items = reasonsList }
    if (isFeedbacks) { patch.items = feedbacks }

    // imagens e cores vão no MESMO patch do resto, e são salvas no escopo escolhido pela
    // pessoa (esta proposta / este tipo de projeto / todos os tipos). Antes elas eram sempre
    // forçadas para "só esta proposta", porque o conteúdo compartilhado não tinha onde
    // guardar imagem por slide — agora tem (slideDefaults, no conteúdo do modelo), então uma
    // foto colocada aqui pode valer para as próximas propostas.
    // As fotos seguem em base64 no estado local (pra aparecer na hora); quem troca por uma
    // referência curta antes de gravar é o updateProposal / saveTemplateContent.
    if (isMultiImage) {
      Object.assign(patch, { images, imageLayout, image: null, image2: null })
      // a "Acompanhamento de obra" usa a descrição vinda de "Dados do projeto" (ver acima) —
      // não duplica aqui como override, senão o texto do campo nunca mais apareceria
      if (slide.id !== 'obra') patch.description = description
    }
    if (hasSingleImage) {
      Object.assign(patch, { image: singleImage.url || '', imagePosX: singleImage.posX ?? 50, imagePosY: singleImage.posY ?? 50, noImage, imagePosition })
      if (slide.type === 'scopeSplit' && slide.id !== 'obra') patch.description = description
    }
    if (isCover) Object.assign(patch, { image: coverImage.url || '', imagePosX: coverImage.posX ?? 50, imagePosY: coverImage.posY ?? 50 })
    if (slide.type === 'journeyFlow') patch.stepImages = stepImages
    if (COLOR_CUSTOMIZABLE_TYPES.has(slide.type)) Object.assign(patch, { bgColor, textColor })

    guardarEscopo(SCOPE_KEY, scope)
    onSave(patch, scope)
    onClose()
  }

  return (
    <div className={embedded ? 'no-print w-full h-full bg-white text-ink p-4 overflow-y-auto' : 'no-print absolute top-0 right-0 h-full w-full sm:w-96 bg-white text-ink shadow-2xl p-5 overflow-y-auto z-30'} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium">Editar este slide</h3>
        <button onClick={onClose} className="text-muted text-sm">✕</button>
      </div>

      {allowGlobal && !isVideo ? (
        <div className="mb-5 border border-line rounded-lg p-3 bg-sand">
          <div className="text-xs font-medium text-ink mb-2">Aplicar esta edição (textos, fotos e cores) em:</div>
          <label className="flex items-center gap-2 text-sm mb-1.5 cursor-pointer">
            <input type="radio" checked={scope === 'allTypes'} onChange={() => setScope('allTypes')} />
            Todas as propostas, de todos os tipos
          </label>
          <label className="flex items-center gap-2 text-sm mb-1.5 cursor-pointer">
            <input type="radio" checked={scope === 'tipologia'} onChange={() => setScope('tipologia')} />
            Só nas propostas do tipo {TIPOLOGIA_LABEL[proposal?.tipologia] || proposal?.tipologia || 'atual'}
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" checked={scope === 'proposal'} onChange={() => setScope('proposal')} />
            Só nesta proposta
          </label>
          <p className="text-[11px] text-muted mt-2">
            Nas duas primeiras opções, o que você salvar aqui já aparece sozinho nas próximas propostas que criar.
          </p>
          {CLIENT_FIELDS_BY_SLIDE[slide.id] && scope !== 'proposal' && (
            <p className="text-[11px] text-muted mt-1.5">
              A foto e as cores desta página vão para as outras propostas; o texto com o nome e o objetivo do cliente fica só nesta.
            </p>
          )}
        </div>
      ) : isVideo ? null : (
        <p className="text-xs text-muted mb-4">Este é um slide extra que você criou dentro desta proposta, então a edição vale só para ela.</p>
      )}

      <label className="text-xs font-medium text-ink/70 block mb-1">Título</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-4" />

      {isCover && (
        <div className="mb-4">
          <SingleImageField
            label="Imagem de fundo da capa"
            value={coverImage} onChange={setCoverImage} onPickFile={handleImageFile}
          />
        </div>
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
                <p className="text-[11px] text-muted mb-2">Isso atualiza os mesmos tópicos do card "{pkg.label}" nos pacotes.</p>
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

      {COLOR_CUSTOMIZABLE_TYPES.has(slide.type) && (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">Cor do fundo</label>
          <ColorSwatchRow palette={palette} value={bgColor} onChange={setBgColor} />

          <label className="text-xs font-medium text-ink/70 block mb-1 mt-3">Cor do texto</label>
          <ColorSwatchRow palette={palette} value={textColor} onChange={setTextColor} />
          <p className="text-[11px] text-muted mt-1">A cor escolhida vale também para o título. Se ficar difícil de ler sobre o fundo, o sistema clareia ou escurece o mesmo tom até dar contraste.</p>
          {isCover && <p className="text-[11px] text-muted mt-1">Na capa, estas cores aparecem quando ela está sem foto de fundo.</p>}
          <div className="mb-4" />
        </>
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
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-4" />
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
          <div className="mb-3 border border-line rounded-lg p-3 bg-sand">
            <div className="text-xs font-medium text-ink mb-2">Este vídeo vale para:</div>
            <label className="flex items-center gap-2 text-sm mb-1.5 cursor-pointer">
              <input type="radio" checked={videoScope === 'proposal'} onChange={() => setVideoScope('proposal')} />
              Só esta proposta
            </label>
            <label className="flex items-center gap-2 text-sm mb-1.5 cursor-pointer">
              <input type="radio" checked={videoScope === 'tipologia'} onChange={() => setVideoScope('tipologia')} />
              Este tipo de projeto ({proposal?.tipologia}), em todos os clientes
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" checked={videoScope === 'allTypes'} onChange={() => setVideoScope('allTypes')} />
              Todos os tipos de projeto
            </label>
          </div>

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

      {items && (
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
        </div>
      )}

      {isReasons && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Motivos</label>
          {reasonsList.map((r, i) => (
            <div key={i} className="border border-line rounded-lg p-3 mb-2">
              <div className="flex items-center gap-2 mb-1.5">
                <input
                  value={r.title || ''}
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
                <input
                  value={s.title}
                  onChange={(e) => setStages((prev) => prev.map((p, k) => k === i ? { ...p, title: e.target.value } : p))}
                  className="flex-1 text-sm font-medium p-1.5 rounded border border-line outline-none focus:border-clay"
                  placeholder="Título da apresentação"
                />
                <button onClick={() => setStages((prev) => prev.filter((_, k) => k !== i))} className="text-xs text-red-600 shrink-0">remover</button>
              </div>
              {(s.items || []).map((it, k) => (
                <div key={k} className="flex gap-1 mb-1.5">
                  <input
                    value={it}
                    onChange={(e) => setStages((prev) => prev.map((p, pi) => pi === i ? { ...p, items: p.items.map((x, xi) => xi === k ? e.target.value : x) } : p))}
                    className="flex-1 text-xs p-1.5 rounded border border-line outline-none focus:border-clay"
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
          <label className="text-xs font-medium text-ink/70 block mb-1">Feedbacks de clientes</label>
          {feedbacks.map((fb, i) => (
            <div key={i} className="border border-line rounded-lg p-3 mb-3">
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
                <SingleImageField
                  compact label="Print (no lugar do texto)" previewClass="w-full h-20"
                  value={{ url: fb.printUrl || '', posX: fb.printPosX, posY: fb.printPosY }}
                  onChange={(next) => setFeedbacks((prev) => prev.map((p, k) => k === i ? { ...p, printUrl: next.url, printPosX: next.posX, printPosY: next.posY } : p))}
                  onPickFile={handleImageFile}
                />
              </div>
            </div>
          ))}
          <button onClick={() => setFeedbacks((prev) => [...prev, { name: '', text: '' }])} className="text-xs text-clay">+ adicionar feedback</button>
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
              <div className="text-xs font-medium text-ink/70 block mb-1 mt-3">Organização das imagens</div>
              <div className="flex gap-2 mb-3">
                <button onClick={() => setImageLayout('row')} className={`text-xs px-3 py-1.5 rounded-full border ${imageLayout === 'row' ? 'bg-ink text-white border-ink' : 'border-line text-ink/70'}`}>Lado a lado</button>
                <button onClick={() => setImageLayout('grid')} className={`text-xs px-3 py-1.5 rounded-full border ${imageLayout === 'grid' ? 'bg-ink text-white border-ink' : 'border-line text-ink/70'}`}>Grade</button>
              </div>
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
      <div className="flex gap-2 mt-6">
        <button onClick={onClose} className="flex-1 text-sm py-2.5 rounded-lg border border-line text-muted">Cancelar</button>
        <button onClick={save} disabled={uploadingCount > 0} className="flex-1 text-sm py-2.5 rounded-lg bg-clay text-white font-medium disabled:opacity-50">{uploadingCount > 0 ? 'Salvando…' : 'Salvar'}</button>
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
function ScaledCanvas({ children, onClick }) {
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

  return (
    <div ref={outerRef} className="absolute inset-0 cursor-pointer overflow-hidden" onClick={onClick} style={{ background: INK }}>
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
  return <img src={src} alt="" crossOrigin="anonymous" className={`object-cover ${className}`} style={style} />
}

const titleStyle = { fontFamily: STYLE.displayFont, fontWeight: STYLE.headingWeight, textTransform: STYLE.headingTransform, letterSpacing: STYLE.headingTracking }
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
function SlideView({ slide, c1, c2, c3, revealCount, settings, exportMode }) {
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
      const { bg, heading, titleColor } = slideColors(slide, INK, c1)
      return (
        <div className="w-full h-full relative flex items-end" style={temFoto ? undefined : { background: bg }}>
          {temFoto && (
            <>
              <SlideImage src={slide.image} className="absolute inset-0 w-full h-full" style={{ objectPosition: `${slide.imagePosX ?? 50}% ${slide.imagePosY ?? 50}%` }} />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.8) 10%, rgba(0,0,0,0.15) 60%, rgba(0,0,0,0.4) 100%)' }} />
            </>
          )}
          {settings?.logoDataUrl && (
            <img src={settings.logoDataUrl} alt="logo" className="absolute z-10 top-10 left-10 h-16 object-contain" />
          )}
          <div className="relative z-10 p-20 max-w-3xl">
            <div className="text-xs tracking-[0.2em] uppercase mb-4" style={{ color: temFoto ? c1 : titleColor }}>{slide.kicker}</div>
            <h1 className="text-5xl mb-6" style={{ ...titleStyle, color: temFoto ? '#FFFFFF' : titleColor }}>{slide.title}</h1>
            {/* sem animação na capa, a pedido — o texto aparece pronto, junto com o slide */}
            {slide.items.map((it, i) => (
              <p key={i} className="text-lg mb-2 max-w-xl" style={{ color: temFoto ? 'rgba(255,255,255,0.85)' : heading, opacity: temFoto ? 1 : 0.85 }}>{it}</p>
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
                {s.image && <img src={s.image} alt="" crossOrigin="anonymous" className="mt-auto w-full aspect-square object-cover rounded-md" style={{ objectPosition: `${s.posX ?? 50}% ${s.posY ?? 50}%` }} />}
              </Reveal>
            ))}
          </div>
          {slide.footnote && <p className="text-sm mt-8 max-w-2xl" style={{ color: heading, opacity: 0.65 }}>{slide.footnote}</p>}
        </div>
      )
    }

    case 'feedbacks': {
      const { bg, heading, titleColor } = slideColors(slide, INK, c1)
      return (
        <div className="w-full h-full p-16 flex flex-col justify-center" style={{ background: bg }}>
          <h2 className="text-4xl mb-10" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
          <div className="grid grid-cols-3 gap-4">
            {slide.items.map((fb, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="overflow-hidden" style={{ borderRadius: radius, background: heading === '#FFFFFF' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }}>
                {fb.printUrl ? (
                  <img src={fb.printUrl} alt="" crossOrigin="anonymous" className="w-full h-full object-cover" style={{ objectPosition: `${fb.printPosX ?? 50}% ${fb.printPosY ?? 50}%` }} />
                ) : (
                  <div className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      {fb.photoUrl && <img src={fb.photoUrl} crossOrigin="anonymous" className="w-9 h-9 rounded-full object-cover" alt="" style={{ objectPosition: `${fb.photoPosX ?? 50}% ${fb.photoPosY ?? 50}%` }} />}
                      <div className="text-base font-semibold" style={{ color: c1 }}>{fb.name}</div>
                    </div>
                    <div className="text-base" style={{ color: heading, opacity: 0.85 }}>{fb.text}</div>
                  </div>
                )}
              </Reveal>
            ))}
          </div>
        </div>
      )
    }

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
                  {extra?.image && <img src={extra.image} alt="" className="w-full object-cover rounded-lg mb-3 mt-auto" style={{ height: '190px', objectPosition: `${extra.posX ?? 50}% ${extra.posY ?? 50}%` }} />}
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
      return (
        <div className="w-full h-full grid grid-cols-2">
          {/* metade esquerda: título + benefícios do pacote — aparecem juntos, sem precisar clicar */}
          <div className="p-12 flex flex-col justify-center overflow-auto" style={{ background: bg }}>
            <h2 className="text-3xl mb-6" style={{ ...titleStyle, color: titleColor }}>{slide.title}</h2>
            {hasBenefits && (
              <>
                <div className="text-sm font-medium uppercase tracking-wide mb-3" style={{ color: heading, opacity: 0.6 }}>Benefícios do pacote</div>
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
              {stepImages[i]?.url && <img src={stepImages[i].url} alt="" crossOrigin="anonymous" className="w-full h-20 object-cover rounded-md" style={{ objectPosition: `${stepImages[i].posX ?? 50}% ${stepImages[i].posY ?? 50}%` }} />}
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
      {hasImages && (
        // com UMA foto só o comportamento é outro: ela não estica pra largura inteira da
        // página (era isso que fazia o formato escolhido não mudar nada e a foto sair sempre
        // enorme). A altura passa a ser a da faixa disponível e a LARGURA vem do formato —
        // e a foto fica encostada à esquerda, alinhada com o texto acima dela.
        <div className={`min-h-0 flex items-center ${imgs.length === 1 ? 'justify-start' : 'justify-center'}`}>
          {imgs.length === 1 ? (
            <div
              className="relative overflow-hidden h-full"
              style={{
                borderRadius: radius,
                ...(imgs[0].ratio
                  ? { aspectRatio: RATIO_CSS[imgs[0].ratio], width: 'auto' }
                  : { width: '50%' }),
              }}
            >
              <Reveal i={0} revealCount={revealCount} className="absolute inset-0">
                <SlideImage src={imgs[0].url} className="w-full h-full" style={{ objectPosition: `${imgs[0].posX ?? 50}% ${imgs[0].posY ?? 50}%` }} />
              </Reveal>
            </div>
          ) : (
            <div
              className="grid gap-4 w-full h-full"
              style={(() => {
                const n = imgs.length
                // "lado a lado" é sempre uma única fileira; "grade" nunca passa de 3 fotos por
                // fileira (3 em cima, 3 embaixo, etc.), como pedido — assim nunca fica apertado
                const cols = layout === 'row' ? n : Math.min(n, 3)
                const rows = Math.ceil(n / cols)
                return { gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`, alignItems: 'center' }
              })()}
            >
              {imgs.map((img, i) => (
                <div
                  key={i}
                  className="relative overflow-hidden w-full"
                  // largura 100% da coluna do grid (valor definido) + aspect-ratio calcula a
                  // altura A PARTIR dela — assim o formato (1:1, 4:5, 16:9...) é respeitado de
                  // verdade. Antes a altura vinha primeiro e a largura ficava sobrando ou
                  // faltando espaço, distorcendo o formato escolhido (ex: 16:9 saía quase quadrado).
                  style={{ borderRadius: radius, aspectRatio: RATIO_CSS[img.ratio] || '1 / 1', maxHeight: '100%' }}
                >
                  <Reveal i={i} revealCount={revealCount} className="absolute inset-0">
                    <SlideImage src={img.url} className="w-full h-full" style={{ objectPosition: `${img.posX ?? 50}% ${img.posY ?? 50}%` }} />
                  </Reveal>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
