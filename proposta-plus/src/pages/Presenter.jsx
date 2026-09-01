import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProposal, getSettings, getTemplateContent, saveProposal, saveTemplateContent } from '../lib/db'
import { buildSlides } from '../lib/slides'
import { DEFAULT_IMAGES, DEFAULT_SHARED_TEXT } from '../lib/content'
import { STYLE, paletteToCssVars, readableTextColor, isLowContrast, DEFAULT_PALETTE, FIXED_SWATCHES } from '../lib/templates'
import { toEmbedUrl } from '../lib/fields'

const SLIDE_ICONS = {
  cover: '🏠', agenda: '📋', profile: '👩‍🎨', divider: '—', clientRequest: '🗂️',
  reasons: '💡', scopeSection: '📐', modeling: '🧊', journeyFlow: '🧭', stages: '🎯',
  feedbacks: '💬', pricingCalc: '🧮', packagePricing: '💰', payment: '💳', video: '🎬',
  custom: '✨', closing: '❤️',
}

// slides cujo conteúdo vem de textos compartilhados (Configurações > Textos padrão) —
// só esses ganham a opção de "aplicar em todas as propostas" na edição rápida
const GLOBAL_EDITABLE_SLIDES = new Set(['agenda', 'about', 'reasons', 'stages', 'feedbacks', 'closing', 'journey'])

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

export default function Presenter() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [proposal, setProposal] = useState(null)
  const [settings, setSettings] = useState(null)
  const [templateContent, setTemplateContent] = useState(null)
  const [index, setIndex] = useState(0)
  const [revealCount, setRevealCount] = useState(1)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportIndex, setExportIndex] = useState(0)
  const exportRef = useRef(null)

  useEffect(() => {
    getProposal(id).then(setProposal)
    getSettings().then(setSettings)
    getTemplateContent().then(setTemplateContent)
  }, [id])

  const content = { ...DEFAULT_SHARED_TEXT, ...(templateContent?.shared || {}) }
  const images = proposal
    ? { ...DEFAULT_IMAGES[proposal.tipologia], ...(templateContent?.images?.[proposal.tipologia] || {}) }
    : null

  // resolve o vídeo principal em cascata: só esta proposta -> este tipo de projeto -> todos os tipos
  const tipologiaVideo = templateContent?.images?.[proposal?.tipologia] || {}
  const sharedVideo = templateContent?.sharedVideo || {}
  const resolvedVideoUrl = proposal?.videoUrl || tipologiaVideo.videoUrl || sharedVideo.videoUrl || ''
  const resolvedEmbedUrl = proposal?.videoEmbedUrl || tipologiaVideo.videoEmbedUrl || sharedVideo.videoEmbedUrl || ''

  const baseSlides = useMemo(() => {
    if (!proposal || !settings) return []
    return buildSlides({
      fields: proposal.fields || {},
      content, images, settings,
      custom: proposal.customSlides || [],
      videoUrl: resolvedVideoUrl,
      videoEmbedUrl: resolvedEmbedUrl,
      visibility: proposal.visibility || {},
    })
  }, [proposal, settings, templateContent])

  const slides = useMemo(() => {
    let list = baseSlides.map((s) => {
      const ov = proposal?.slideOverrides?.[s.id]
      return ov ? { ...s, ...ov } : s
    })
    const order = proposal?.slideOrder
    if (order && order.length) {
      const byId = Object.fromEntries(list.map((s) => [s.id, s]))
      const ordered = order.map((sid) => byId[sid]).filter(Boolean)
      const remaining = list.filter((s) => !order.includes(s.id))
      list = [...ordered, ...remaining]
    }
    return list
  }, [baseSlides, proposal?.slideOverrides, proposal?.slideOrder])

  // páginas ocultadas pela pessoa ficam fora da apresentação e do PDF, mas continuam
  // listadas (esmaecidas) na barra lateral, prontas para serem reativadas quando quiser
  const hiddenIds = useMemo(() => new Set(proposal?.hiddenSlides || []), [proposal?.hiddenSlides])
  const visibleSlides = useMemo(() => slides.filter((s) => !hiddenIds.has(s.id)), [slides, hiddenIds])

  const slide = visibleSlides[index]
  const palette = proposal?.palette || DEFAULT_PALETTE
  const [c1, c2, c3] = palette
  const cssVars = paletteToCssVars(palette)

  const goNext = useCallback(() => { setIndex((i) => Math.min(i + 1, visibleSlides.length - 1)); setRevealCount(1) }, [visibleSlides.length])
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

  function jumpToId(slideId) {
    const idx = visibleSlides.findIndex((s) => s.id === slideId)
    if (idx < 0) return
    setIndex(idx)
    setRevealCount(999)
  }

  function reorder(fromIdx, toIdx) {
    const ids = slides.map((s) => s.id)
    const [moved] = ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, moved)
    const next = { ...proposal, slideOrder: ids }
    setProposal(next)
    saveProposal(next)
  }

  function saveOverridePerProposal(slideId, patch) {
    const overrides = { ...(proposal.slideOverrides || {}), [slideId]: { ...(proposal.slideOverrides?.[slideId] || {}), ...patch } }
    const next = { ...proposal, slideOverrides: overrides }
    setProposal(next)
    saveProposal(next)
  }

  async function saveGlobalContent(slideId, patch) {
    const shared = mapPatchToSharedContent(slideId, patch, content)
    const nextContent = { ...(templateContent || {}), shared }
    setTemplateContent(nextContent)
    await saveTemplateContent(nextContent)
  }

  /** Salva o vídeo principal no nível certo: só esta proposta, este tipo de projeto, ou todos os tipos. */
  /** Atualiza campos de "Dados do projeto" direto pelo slide (ex: Descrição do projeto),
   *  garantindo que fique sincronizado com a aba "Dados do projeto" do editor. */
  async function saveFieldsPatch(patch) {
    const next = { ...proposal, fields: { ...(proposal.fields || {}), ...patch } }
    setProposal(next)
    await saveProposal(next)
  }

  async function saveVideoByScope(scope, patch) {
    if (scope === 'proposal') {
      saveOverridePerProposal('video', patch)
      return
    }
    if (scope === 'tipologia') {
      const nextImages = { ...(templateContent?.images || {}), [proposal.tipologia]: { ...(templateContent?.images?.[proposal.tipologia] || {}), ...patch } }
      const nextContent = { ...(templateContent || {}), images: nextImages }
      setTemplateContent(nextContent)
      await saveTemplateContent(nextContent)
      return
    }
    // 'allTypes'
    const nextContent = { ...(templateContent || {}), sharedVideo: { ...(templateContent?.sharedVideo || {}), ...patch } }
    setTemplateContent(nextContent)
    await saveTemplateContent(nextContent)
  }

  function toggleHidden(slideId) {
    const hidden = new Set(proposal.hiddenSlides || [])
    hidden.has(slideId) ? hidden.delete(slideId) : hidden.add(slideId)
    const next = { ...proposal, hiddenSlides: [...hidden] }
    setProposal(next)
    saveProposal(next)
    // se a página atual acabou de ser ocultada, evita ficar preso numa posição inexistente
    if (hidden.has(slideId)) setIndex((i) => Math.max(0, Math.min(i, visibleSlides.length - 2)))
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
        await new Promise((resolve) => setTimeout(resolve, 350))
        const node = exportRef.current
        const canvas = await html2canvas(node, { width: EXPORT_W, height: EXPORT_H, scale: 2, useCORS: true, backgroundColor: '#28313C' })
        const img = canvas.toDataURL('image/jpeg', 0.92)
        if (!pdf) pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [EXPORT_W, EXPORT_H] })
        else pdf.addPage([EXPORT_W, EXPORT_H], 'landscape')
        pdf.addImage(img, 'JPEG', 0, 0, EXPORT_W, EXPORT_H)
      }
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
    <div className="fixed inset-0 bg-ink text-white select-none" style={{ ...cssVars, fontFamily: STYLE.bodyFont }}>
      <div className="flex h-full">
        {sidebarOpen && (
          <SlideSidebar
            slides={slides}
            currentId={slide?.id}
            hiddenIds={hiddenIds}
            onJump={jumpToId}
            onToggleHidden={toggleHidden}
            onReorder={reorder}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        <div className="relative flex-1 min-w-0">
          <div className="absolute inset-0 cursor-pointer" onClick={handleAdvance}>
            <SlideView slide={slide} c1={c1} c2={c2} c3={c3} revealCount={revealCount} settings={settings} />
          </div>

          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 pointer-events-none gap-2">
            <div className="flex items-center gap-2 pointer-events-auto">
              {!sidebarOpen && (
                <button onClick={(e) => { e.stopPropagation(); setSidebarOpen(true) }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-3 py-1.5 rounded-full transition">☰ Slides</button>
              )}
              <button onClick={(e) => { e.stopPropagation(); navigate(`/proposta/${id}/editar`) }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-3 py-1.5 rounded-full transition">← Sair</button>
            </div>
            <div className="flex items-center gap-2 pointer-events-auto">
              <button onClick={(e) => { e.stopPropagation(); setEditing((v) => !v) }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-3 py-1.5 rounded-full transition">{editing ? 'Fechar edição' : '✎ Editar slide'}</button>
              <button disabled={exporting} onClick={(e) => { e.stopPropagation(); handleExportPdf() }} className="text-xs bg-black/30 hover:bg-black/50 backdrop-blur px-3 py-1.5 rounded-full transition disabled:opacity-50">
                {exporting ? `Gerando PDF… ${exportProgress}/${visibleSlides.length}` : '⇩ Baixar PDF'}
              </button>
              <div className="text-xs bg-black/30 backdrop-blur px-3 py-1.5 rounded-full">{index + 1} / {visibleSlides.length}</div>
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
              allowGlobal={GLOBAL_EDITABLE_SLIDES.has(slide.id)}
              onSave={(patch, scope) => { scope === 'global' ? saveGlobalContent(slide.id, patch) : saveOverridePerProposal(slide.id, patch) }}
              onSaveVideoScope={(scope, patch) => saveVideoByScope(scope, patch)}
              onSaveFields={saveFieldsPatch}
              onClose={() => setEditing(false)}
            />
          )}
        </div>
      </div>

      {/* área invisível usada só para "fotografar" cada slide na hora de gerar o PDF */}
      <div style={{ position: 'fixed', left: -99999, top: 0, width: EXPORT_W, height: EXPORT_H, overflow: 'hidden' }}>
        <div ref={exportRef} style={{ width: EXPORT_W, height: EXPORT_H }}>
          {exporting && visibleSlides[exportIndex] && (
            <SlideView slide={visibleSlides[exportIndex]} c1={c1} c2={c2} c3={c3} revealCount={999} settings={settings} />
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
  // aqui os textos continuam clicáveis normalmente, mas os cards de valor entram como um passo extra, no final
  if (slide.type === 'pricingCalc') return (slide.items?.length || 0) + ((slide.hourValue || slide.dayValue) ? 1 : 0)
  // o valor + prazo do pacote é o 1º passo; os cards de pagamento vêm depois, um a um
  if (slide.type === 'packagePricing') return (slide.paymentCards?.length || 0) + 1
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

function SlideSidebar({ slides, currentId, hiddenIds, onJump, onToggleHidden, onReorder, onClose }) {
  const dragFrom = useRef(null)

  return (
    <div className="w-56 shrink-0 bg-[#1c232b] border-r border-white/10 flex flex-col">
      <div className="flex items-center justify-between px-3 py-3 border-b border-white/10">
        <span className="text-xs uppercase tracking-wide text-white/50">Slides</span>
        <button onClick={onClose} className="text-white/50 hover:text-white text-xs">ocultar ✕</button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {slides.map((s, i) => {
          const hidden = hiddenIds.has(s.id)
          return (
            <div
              key={s.id}
              draggable
              onDragStart={() => (dragFrom.current = i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragFrom.current !== null && dragFrom.current !== i) onReorder(dragFrom.current, i); dragFrom.current = null }}
              className={`mx-2 mb-1 px-2.5 py-2 rounded-lg flex items-center gap-2 text-xs transition ${s.id === currentId ? 'bg-white/15 text-white' : hidden ? 'text-white/30' : 'text-white/60 hover:bg-white/5'}`}
              title="Arraste para reordenar"
            >
              <span className="text-white/30 text-[10px] w-4 text-center shrink-0">{i + 1}</span>
              <span
                onClick={() => !hidden && onJump(s.id)}
                className={`flex-1 flex items-center gap-2 min-w-0 ${hidden ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <span>{SLIDE_ICONS[s.type] || '•'}</span>
                <span className="truncate">{s.title || slideFallbackLabel(s)}</span>
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleHidden(s.id) }}
                className="shrink-0 text-white/40 hover:text-white text-xs"
                title={hidden ? 'Mostrar esta página' : 'Ocultar esta página'}
              >{hidden ? '🚫' : '👁'}</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ColorSwatchRow({ palette, value, onChange }) {
  const options = [...palette, ...FIXED_SWATCHES.map((s) => s.hex)]
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

const COLOR_CUSTOMIZABLE_TYPES = new Set(['divider', 'agenda', 'profile', 'clientRequest', 'reasons', 'scopeSection', 'modeling', 'journeyFlow', 'stages', 'feedbacks', 'pricingCalc', 'packagePricing', 'custom', 'closing'])

function EditPanel({ slide, allowGlobal, onSave, onClose, palette = DEFAULT_PALETTE, proposal, onSaveVideoScope, onSaveFields }) {
  // padrão é "todas as propostas" apenas quando essa opção existe pro tipo de slide (allowGlobal);
  // do contrário, o escopo é sempre "só esta proposta" — bug crítico corrigido aqui: antes disso,
  // slides sem a opção de escopo (título, imagens, vídeo…) tentavam salvar como "global" por engano
  // e a edição se perdia silenciosamente, pois não existe conteúdo compartilhado pra esses tipos.
  const [scope, setScope] = useState(allowGlobal ? 'global' : 'proposal')
  const [title, setTitle] = useState(slide.title || slide.headline || '')
  const [items, setItems] = useState(Array.isArray(slide.items) && typeof slide.items[0] !== 'object' ? [...slide.items] : null)
  const [quote, setQuote] = useState(slide.quote || '')
  const [author, setAuthor] = useState(slide.author || '')
  const [subtitle, setSubtitle] = useState(slide.subtitle || '')
  const [description, setDescription] = useState(slide.description || '')
  const [bgColor, setBgColor] = useState(slide.bgColor || '')
  const [textColor, setTextColor] = useState(slide.textColor || '')
  const [stepImages, setStepImages] = useState(slide.stepImages || [])
  const isStages = slide.type === 'stages'
  const [stages, setStages] = useState(() => (slide.stages ? JSON.parse(JSON.stringify(slide.stages)) : []))
  const [footnote, setFootnote] = useState(slide.footnote || '')
  const isReasons = slide.type === 'reasons'
  const [reasonsList, setReasonsList] = useState(() => (isReasons && Array.isArray(slide.items) ? JSON.parse(JSON.stringify(slide.items)) : []))
  const isFeedbacks = slide.type === 'feedbacks'
  const [feedbacks, setFeedbacks] = useState(() => (isFeedbacks && Array.isArray(slide.items) ? JSON.parse(JSON.stringify(slide.items)) : []))
  const isMultiImage = slide.type === 'scopeSection' || slide.type === 'modeling'
  const [images, setImages] = useState(() => effectiveImages(slide))
  const [imageLayout, setImageLayout] = useState(slide.imageLayout || 'row')
  const [adjustingIdx, setAdjustingIdx] = useState(null)
  const hasSingleImage = 'image' in slide && !isMultiImage && slide.type !== 'cover'
  const [singleImage, setSingleImage] = useState(slide.image || '')
  const [noImage, setNoImage] = useState(!!slide.noImage)
  const [imagePosition, setImagePosition] = useState(slide.imagePosition || 'left')
  const isClientRequest = slide.type === 'clientRequest'
  const [descricaoProjeto, setDescricaoProjeto] = useState(slide.descricaoProjeto || '')
  const isVideo = slide.type === 'video'
  const [embedUrl, setEmbedUrl] = useState(slide.embedUrl || '')
  const [videoScope, setVideoScope] = useState('proposal')

  useEffect(() => {
    setScope(allowGlobal ? 'global' : 'proposal')
    setTitle(slide.title || slide.headline || '')
    setItems(Array.isArray(slide.items) && typeof slide.items[0] !== 'object' ? [...slide.items] : null)
    setQuote(slide.quote || '')
    setAuthor(slide.author || '')
    setSubtitle(slide.subtitle || '')
    setDescription(slide.description || '')
    setBgColor(slide.bgColor || '')
    setTextColor(slide.textColor || '')
    setStepImages(slide.stepImages || [])
    setImages(effectiveImages(slide))
    setImageLayout(slide.imageLayout || 'row')
    setEmbedUrl(slide.embedUrl || '')
    setAdjustingIdx(null)
    setSingleImage(slide.image || '')
    setNoImage(!!slide.noImage)
    setImagePosition(slide.imagePosition || 'left')
    setDescricaoProjeto(slide.descricaoProjeto || '')
    setStages(slide.stages ? JSON.parse(JSON.stringify(slide.stages)) : [])
    setFootnote(slide.footnote || '')
    setReasonsList(slide.type === 'reasons' && Array.isArray(slide.items) ? JSON.parse(JSON.stringify(slide.items)) : [])
    setFeedbacks(slide.type === 'feedbacks' && Array.isArray(slide.items) ? JSON.parse(JSON.stringify(slide.items)) : [])
  }, [slide.id])

  function addImages(fileList) {
    const files = Array.from(fileList || [])
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => setImages((prev) => [...prev, { url: reader.result, ratio: '' }])
      reader.readAsDataURL(file)
    })
  }

  function save() {
    const patch = slide.type === 'closing' ? { title, quote, author } : { title }
    if (items) patch.items = items
    if (slide.type === 'divider') { patch.subtitle = subtitle; patch.bgColor = bgColor; patch.textColor = textColor }
    if (slide.type === 'journeyFlow') { patch.subtitle = subtitle; patch.stepImages = stepImages }
    if (COLOR_CUSTOMIZABLE_TYPES.has(slide.type)) { patch.bgColor = bgColor; patch.textColor = textColor }
    if (isMultiImage) { patch.images = images; patch.imageLayout = imageLayout; patch.image = null; patch.image2 = null; patch.description = description }
    if (hasSingleImage) { patch.image = singleImage; patch.noImage = noImage; patch.imagePosition = imagePosition }
    if (isClientRequest) { onSaveFields?.({ descricaoProjeto }) }
    if (isStages) { patch.stages = stages; patch.footnote = footnote }
    if (isReasons) { patch.items = reasonsList }
    if (isFeedbacks) { patch.items = feedbacks }
    if (isVideo) {
      onSaveVideoScope?.(videoScope, { videoUrl: '', videoPath: '', embedUrl: toEmbedUrl(embedUrl) })
      onClose()
      return
    }
    onSave(patch, scope)
    onClose()
  }

  return (
    <div className="no-print absolute top-0 right-0 h-full w-full sm:w-96 bg-white text-ink shadow-2xl p-5 overflow-y-auto z-30" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium">Editar este slide</h3>
        <button onClick={onClose} className="text-muted text-sm">✕</button>
      </div>

      {allowGlobal ? (
        <div className="mb-5 border border-line rounded-lg p-3 bg-sand">
          <div className="text-xs font-medium text-ink mb-2">Aplicar esta edição em:</div>
          <label className="flex items-center gap-2 text-sm mb-1.5 cursor-pointer">
            <input type="radio" checked={scope === 'proposal'} onChange={() => setScope('proposal')} />
            Só nesta proposta
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" checked={scope === 'global'} onChange={() => setScope('global')} />
            Todas as propostas (residencial, comercial e corporativo)
          </label>
        </div>
      ) : (
        <p className="text-xs text-muted mb-4">Esse slide é específico desta proposta, então a edição vale só para ela.</p>
      )}

      <label className="text-xs font-medium text-ink/70 block mb-1">Título</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-4" />

      {isClientRequest && (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">Descrição do projeto</label>
          <textarea value={descricaoProjeto} onChange={(e) => setDescricaoProjeto(e.target.value)} rows={3} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-1" placeholder="Ex: Reforma completa de interiores…" />
          <p className="text-[11px] text-muted mb-4">Isso atualiza também o campo "Descrição do projeto" em Dados do projeto.</p>
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
          <p className="text-[11px] text-muted mb-4 mt-1">Se a combinação escolhida ficar difícil de ler, o sistema ajusta automaticamente para garantir contraste.</p>
        </>
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

              <div className="mt-2 flex items-center gap-2">
                {s.image && <img src={s.image} className="w-10 h-10 object-cover rounded" alt="" />}
                <label className="text-[11px] cursor-pointer text-clay">
                  {s.image ? 'Trocar imagem' : '+ adicionar imagem'}
                  <input type="file" accept="image/*" hidden onChange={(e) => {
                    const file = e.target.files[0]; if (!file) return
                    const reader = new FileReader()
                    reader.onload = () => setStages((prev) => prev.map((p, pi) => pi === i ? { ...p, image: reader.result } : p))
                    reader.readAsDataURL(file)
                  }} />
                </label>
                {s.image && (
                  <button onClick={() => setStages((prev) => prev.map((p, pi) => pi === i ? { ...p, image: '' } : p))} className="text-[11px] text-red-600">remover</button>
                )}
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
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  {fb.photoUrl && <img src={fb.photoUrl} className="w-8 h-8 object-cover rounded-full" alt="" />}
                  <label className="text-[11px] cursor-pointer text-clay">
                    foto do cliente
                    <input type="file" accept="image/*" hidden onChange={(e) => {
                      const file = e.target.files[0]; if (!file) return
                      const reader = new FileReader()
                      reader.onload = () => setFeedbacks((prev) => prev.map((p, k) => k === i ? { ...p, photoUrl: reader.result } : p))
                      reader.readAsDataURL(file)
                    }} />
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  {fb.printUrl && <img src={fb.printUrl} className="w-8 h-8 object-cover rounded" alt="" />}
                  <label className="text-[11px] cursor-pointer text-clay">
                    {fb.printUrl ? 'trocar print' : 'usar print em vez do texto'}
                    <input type="file" accept="image/*" hidden onChange={(e) => {
                      const file = e.target.files[0]; if (!file) return
                      const reader = new FileReader()
                      reader.onload = () => setFeedbacks((prev) => prev.map((p, k) => k === i ? { ...p, printUrl: reader.result } : p))
                      reader.readAsDataURL(file)
                    }} />
                  </label>
                  {fb.printUrl && <button onClick={() => setFeedbacks((prev) => prev.map((p, k) => k === i ? { ...p, printUrl: '' } : p))} className="text-[11px] text-red-600">remover print</button>}
                </div>
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
            <div key={i} className="flex items-center gap-2 border border-line rounded-lg p-2 mb-2">
              <span className="text-xs text-muted w-5 text-center shrink-0">{i + 1}</span>
              {stepImages[i] && <img src={stepImages[i]} className="w-10 h-10 object-cover rounded" alt="" />}
              <label className="text-xs cursor-pointer text-clay flex-1">
                {stepImages[i] ? 'Trocar imagem' : '+ adicionar imagem'}
                <input
                  type="file" accept="image/*" hidden
                  onChange={(e) => {
                    const file = e.target.files[0]; if (!file) return
                    const reader = new FileReader()
                    reader.onload = () => setStepImages((prev) => { const next = [...prev]; next[i] = reader.result; return next })
                    reader.readAsDataURL(file)
                  }}
                />
              </label>
              {stepImages[i] && <button onClick={() => setStepImages((prev) => { const next = [...prev]; next[i] = ''; return next })} className="text-xs text-red-600">remover</button>}
            </div>
          ))}
        </div>
      )}

      {slide.type === 'scopeSection' && (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">Descrição (parágrafo abaixo do título — os textos abaixo continuam virando tópicos com marcador)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-4" />
        </>
      )}

      {isMultiImage ? (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Imagens (só desta proposta)</label>

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
          <label className="text-xs font-medium text-ink/70 block mb-1">Imagem (só desta proposta)</label>
          <label className="flex items-center gap-2 text-xs mb-2 cursor-pointer">
            <input type="checkbox" checked={noImage} onChange={(e) => setNoImage(e.target.checked)} />
            Não usar imagem neste slide (o texto ocupa a página toda, justificado à esquerda)
          </label>
          {!noImage && (
            <>
              {singleImage && (
                <div className="mb-2">
                  <img src={singleImage} className="w-full h-28 object-cover rounded-lg mb-1" alt="" />
                  <button onClick={() => setSingleImage('')} className="text-xs text-red-600">remover imagem</button>
                </div>
              )}
              <label className="text-xs cursor-pointer text-clay font-medium block mb-3">
                {singleImage ? 'Trocar imagem' : '+ adicionar imagem'}
                <input type="file" accept="image/*" hidden onChange={(e) => {
                  const file = e.target.files[0]; if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => setSingleImage(reader.result)
                  reader.readAsDataURL(file)
                }} />
              </label>
              <label className="text-xs font-medium text-ink/70 block mb-1">Posição da imagem</label>
              <div className="flex gap-2">
                <button onClick={() => setImagePosition('left')} className={`text-xs px-3 py-1.5 rounded-full border ${imagePosition === 'left' ? 'bg-ink text-white border-ink' : 'border-line text-ink/70'}`}>Esquerda</button>
                <button onClick={() => setImagePosition('right')} className={`text-xs px-3 py-1.5 rounded-full border ${imagePosition === 'right' ? 'bg-ink text-white border-ink' : 'border-line text-ink/70'}`}>Direita</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-6">
        <button onClick={onClose} className="flex-1 text-sm py-2.5 rounded-lg border border-line text-muted">Cancelar</button>
        <button onClick={save} className="flex-1 text-sm py-2.5 rounded-lg bg-clay text-white font-medium">Salvar</button>
      </div>
    </div>
  )
}

/* ---------------- BLOCOS DE TEXTO REVELADOS POR CLIQUE ---------------- */

function Reveal({ i, revealCount, children, className = '', style }) {
  return <div className={`reveal-item ${i < revealCount ? 'revealed' : ''} ${className}`} style={{ transitionDelay: `${i * 60}ms`, ...style }}>{children}</div>
}

function SlideImage({ src, className, style }) {
  if (!src) return <div className={className} style={{ background: '#DDD6C8', ...style }} />
  return <img src={src} alt="" crossOrigin="anonymous" className={`object-cover ${className}`} style={style} />
}

const titleStyle = { fontFamily: STYLE.displayFont, fontWeight: STYLE.headingWeight, textTransform: STYLE.headingTransform, letterSpacing: STYLE.headingTracking }
const SAND = '#F6F3EE'
const INK = '#28313C'

/** Resolve a cor de fundo e a cor de texto (contraste garantido) de um slide, considerando
 *  a personalização que a pessoa escolheu no "Editar slide" (com um fundo padrão de reserva). */
function slideColors(slide, fallbackBg) {
  const bg = slide.bgColor || fallbackBg
  const auto = readableTextColor(bg)
  const heading = slide.textColor && !isLowContrast(slide.textColor, bg) ? slide.textColor : auto
  return { bg, heading }
}

function SlideView({ slide, c1, c2, c3, revealCount, settings }) {
  const t2 = readableTextColor(c2)
  // se a cor de destaque (c1) não tiver contraste suficiente sobre o fundo (c2),
  // usamos automaticamente a cor de texto legível no lugar — nunca mais texto "sumindo"
  const c1OnC2 = isLowContrast(c1, c2) ? t2 : c1
  const radius = STYLE.radius

  switch (slide.type) {
    case 'cover':
      return (
        <div className="w-full h-full relative flex items-end">
          <SlideImage src={slide.image} className="absolute inset-0 w-full h-full" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.8) 10%, rgba(0,0,0,0.15) 60%, rgba(0,0,0,0.4) 100%)' }} />
          {settings?.logoDataUrl && (
            <img src={settings.logoDataUrl} alt="logo" className="absolute z-10 top-6 left-6 md:top-10 md:left-10 h-12 md:h-16 object-contain" />
          )}
          <div className="relative z-10 p-10 md:p-20 max-w-3xl">
            <div className="text-xs tracking-[0.2em] uppercase mb-4" style={{ color: c1 }}>{slide.kicker}</div>
            <h1 className="text-3xl md:text-5xl mb-6 text-white" style={titleStyle}>{slide.title}</h1>
            {/* sem animação na capa, a pedido — o texto aparece pronto, junto com o slide */}
            {slide.items.map((it, i) => (
              <p key={i} className="text-base md:text-lg text-white/85 mb-2 max-w-xl">{it}</p>
            ))}
          </div>
        </div>
      )

    case 'divider': {
      const { bg, heading } = slideColors(slide, c2)
      return (
        <div className="w-full h-full flex flex-col items-center justify-center text-center px-10" style={{ background: bg }}>
          <h2 className="text-2xl md:text-4xl max-w-3xl" style={{ ...titleStyle, color: heading }}>{slide.title}</h2>
          {slide.subtitle && <p className="mt-5 max-w-xl" style={{ color: heading, opacity: 0.75 }}>{slide.subtitle}</p>}
        </div>
      )
    }

    case 'agenda': {
      const { bg, heading } = slideColors(slide, SAND)
      return (
        <SplitLayout image={slide.image} radius={radius} noImage={slide.noImage} imagePosition={slide.imagePosition} bg={bg}>
          <h2 className="text-2xl md:text-3xl mb-8" style={{ ...titleStyle, color: heading }}>{slide.title}</h2>
          <ol className={slide.noImage ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-3' : 'space-y-3'}>
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
      const { bg, heading } = slideColors(slide, SAND)
      return (
        <SplitLayout image={slide.image} radius={radius} imageRight noImage={slide.noImage} imagePosition={slide.imagePosition} bg={bg}>
          <div className="max-w-md">
            <h2 className="auto-left-item text-2xl md:text-3xl mb-6" style={{ ...titleStyle, color: heading }}>{slide.title}</h2>
            {/* todos os textos aparecem juntos, vindos da esquerda, sem precisar clicar */}
            {slide.items.map((it, i) => (
              <p key={i} className="auto-left-item whitespace-pre-line mb-4 leading-relaxed" style={{ color: heading, opacity: 0.85 }}>{it}</p>
            ))}
          </div>
        </SplitLayout>
      )
    }

    case 'clientRequest': {
      const { bg, heading } = slideColors(slide, SAND)
      return (
        <SplitLayout image={slide.image} radius={radius} noImage={slide.noImage} imagePosition={slide.imagePosition} bg={bg}>
          <h2 className="text-xl md:text-2xl mb-8" style={{ ...titleStyle, color: heading }}>{slide.title}</h2>
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
      const { bg, heading } = slideColors(slide, SAND)
      return (
        <SplitLayout image={slide.image} radius={radius} imageRight noImage={slide.noImage} imagePosition={slide.imagePosition} bg={bg}>
          <h2 className="text-xl md:text-2xl mb-6" style={{ ...titleStyle, color: heading }}>{slide.title}</h2>
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

    case 'modeling':
      return <TopicImageSlide slide={slide} c1={c1} revealCount={revealCount} radius={radius} />

    case 'journeyFlow':
      return <JourneyFlowSlide slide={slide} c1={c1} c2={c2} t2={t2} revealCount={revealCount} radius={radius} />

    case 'stages': {
      const { bg, heading } = slideColors(slide, SAND)
      return (
        <div className="w-full h-full p-10 md:p-16 overflow-auto" style={{ background: bg }}>
          <h2 className="text-2xl md:text-3xl mb-8" style={{ ...titleStyle, color: heading }}>{slide.title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {slide.stages.map((s, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="bg-white border border-line p-5 flex flex-col" style={{ borderRadius: radius }}>
                <div className="font-semibold mb-3 text-lg" style={{ color: c1 }}>{i + 1}. {s.title}</div>
                <ul className="space-y-1.5 text-base text-ink/75 mb-3">{s.items.map((it, k) => <li key={k}>• {it}</li>)}</ul>
                {s.image && <img src={s.image} alt="" className="mt-auto w-full h-28 object-cover rounded-md" />}
              </Reveal>
            ))}
          </div>
          {slide.footnote && <p className="text-sm mt-8 max-w-2xl" style={{ color: heading, opacity: 0.65 }}>{slide.footnote}</p>}
        </div>
      )
    }

    case 'feedbacks': {
      const { bg, heading } = slideColors(slide, INK)
      return (
        <div className="w-full h-full p-10 md:p-16 flex flex-col justify-center" style={{ background: bg }}>
          <h2 className="text-2xl md:text-4xl mb-10" style={{ ...titleStyle, color: heading }}>{slide.title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {slide.items.map((fb, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="overflow-hidden" style={{ borderRadius: radius, background: heading === '#FFFFFF' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }}>
                {fb.printUrl ? (
                  <img src={fb.printUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      {fb.photoUrl && <img src={fb.photoUrl} crossOrigin="anonymous" className="w-9 h-9 rounded-full object-cover" alt="" />}
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
      const { bg, heading } = slideColors(slide, SAND)
      const lastTextStep = slide.items.length
      return (
        <div className="w-full h-full p-10 md:p-16 overflow-auto flex flex-col md:flex-row md:items-center gap-10" style={{ background: bg }}>
          <div className="flex-1">
            <h2 className="text-xl md:text-2xl mb-6" style={{ ...titleStyle, color: heading }}>{slide.title}</h2>
            <ul className="space-y-2 max-w-xl">
              {slide.items.map((it, i) => (<Reveal key={i} i={i} revealCount={revealCount} className="text-base" style={{ color: heading, opacity: 0.85 }}>• {it}</Reveal>))}
            </ul>
          </div>
          {(slide.hourValue || slide.dayValue) && (
            <Reveal i={lastTextStep} revealCount={revealCount} className="flex flex-col gap-3 md:w-72 shrink-0">
              {slide.hourValue && <PriceTag label="Hora técnica" value={slide.hourValue} radius={radius} c1={c1} big />}
              {slide.dayValue && <PriceTag label="Diária de trabalho" value={slide.dayValue} radius={radius} c1={c1} big />}
            </Reveal>
          )}
        </div>
      )
    }

    case 'packagePricing': {
      const { bg, heading } = slideColors(slide, SAND)
      return (
        <div className="w-full h-full p-10 md:p-16 overflow-auto" style={{ background: bg }}>
          <h2 className="text-2xl md:text-3xl mb-8" style={{ ...titleStyle, color: heading }}>{slide.title}</h2>
          <Reveal i={0} revealCount={revealCount} className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 max-w-3xl">
            <div className="p-6 bg-white border border-line" style={{ borderRadius: radius }}>
              <div className="text-xs uppercase tracking-wide opacity-60 mb-1" style={{ color: heading }}>Valor do pacote</div>
              <div className="text-2xl font-semibold" style={{ color: c1, fontFamily: STYLE.displayFont }}>{slide.value}</div>
            </div>
            {slide.schedule.length > 0 && (
              <div className="p-6 bg-white border border-line" style={{ borderRadius: radius }}>
                <div className="text-xs uppercase tracking-wide opacity-60 mb-1" style={{ color: heading }}>Prazo do projeto</div>
                <div className="text-sm" style={{ color: heading, opacity: 0.8 }}>{slide.schedule.join(' · ')}</div>
              </div>
            )}
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
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
      )
    }

    case 'video':
      return (
        <div className="w-full h-full bg-ink flex items-center justify-center p-10 relative">
          {slide.title && (
            <div className="absolute top-5 left-6 md:top-7 md:left-8 text-white/85 text-sm md:text-base font-medium tracking-wide z-10">{slide.title}</div>
          )}
          {slide.videoUrl ? (
            <video src={slide.videoUrl} controls className="max-w-full max-h-full" style={{ borderRadius: STYLE.radius }} />
          ) : slide.embedUrl ? (
            <iframe src={slide.embedUrl} className="w-full h-full" style={{ borderRadius: STYLE.radius }} allowFullScreen allow="autoplay; encrypted-media; picture-in-picture" title="video" />
          ) : (
            <div className="text-white/50 text-center">
              <div className="text-4xl mb-3">▶</div>
              <div>Nenhum vídeo adicionado ainda.</div>
              <div className="text-sm mt-1">Clique em "✎ Editar slide" para enviar um vídeo.</div>
            </div>
          )}
        </div>
      )

    case 'custom': {
      const { bg, heading } = slideColors(slide, SAND)
      return (
        <div className="w-full h-full grid grid-cols-1 md:grid-cols-2" style={{ background: bg }}>
          <div className="p-10 md:p-16 flex flex-col justify-center order-2 md:order-1">
            <h2 className="text-2xl md:text-3xl mb-6" style={{ ...titleStyle, color: heading }}>{slide.title}</h2>
            {(slide.items || [slide.body]).filter(Boolean).map((it, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="mb-3 whitespace-pre-line" style={{ color: heading, opacity: 0.85 }}>{it}</Reveal>
            ))}
          </div>
          <div className="order-1 md:order-2 relative">
            {slide.embedUrl ? (
              <iframe src={slide.embedUrl} className="w-full h-full" allowFullScreen allow="autoplay; encrypted-media; picture-in-picture" title="video" />
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
      const { bg, heading } = slideColors(slide, c2)
      const quoteColor = slide.textColor && !isLowContrast(slide.textColor, bg) ? slide.textColor : c1OnC2
      return (
        <div className="w-full h-full flex flex-col items-center justify-center text-center px-10" style={{ background: bg }}>
          <h2 className="text-xl md:text-2xl mb-6" style={{ ...titleStyle, color: heading, opacity: 0.9 }}>{slide.headline}</h2>
          <p className="text-xl md:text-2xl italic max-w-2xl" style={{ color: quoteColor, fontFamily: STYLE.displayFont }}>&ldquo;{slide.quote}&rdquo;</p>
          {slide.author && <p className="text-sm mt-4 tracking-wide" style={{ color: heading, opacity: 0.6 }}>{slide.author}</p>}
        </div>
      )
    }

    default:
      return <div className="w-full h-full flex items-center justify-center text-white/50">Slide</div>
  }
}

function JourneyFlowSlide({ slide, c1, c2, t2, revealCount, radius }) {
  const stepImages = slide.stepImages || []
  const { bg, heading } = slideColors(slide, SAND)
  return (
    <div className="w-full h-full p-8 md:p-14 overflow-auto" style={{ background: bg }}>
      <h2 className="text-2xl md:text-4xl mb-2" style={{ ...titleStyle, color: heading }}>{slide.title}</h2>
      <p className="text-sm mb-8" style={{ color: heading, opacity: 0.6 }}>{slide.subtitle}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-4">
        {slide.items.map((it, i) => (
          <Reveal key={i} i={i} revealCount={revealCount} className="flex items-center gap-3">
            <div
              className="flex flex-col items-start justify-center px-4 py-3 min-w-[180px] max-w-[220px] overflow-hidden"
              style={{ borderRadius: radius, background: i % 2 === 0 ? c2 : 'white', color: i % 2 === 0 ? t2 : '#28313C', border: i % 2 === 0 ? 'none' : '1px solid #E4DFD6', boxShadow: '0 4px 14px rgba(0,0,0,0.06)' }}
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mb-2" style={{ background: c1, color: readableTextColor(c1) }}>{i + 1}</div>
              <div className="text-base leading-snug mb-2">{it}</div>
              {stepImages[i] && <img src={stepImages[i]} alt="" className="w-full h-20 object-cover rounded-md" />}
            </div>
            {i < slide.items.length - 1 && <div className="hidden md:block text-2xl" style={{ color: c1 }}>→</div>}
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
 * imagePosition escolhe se a imagem fica à esquerda ou à direita (some no celular de qualquer forma).
 */
function SplitLayout({ image, radius, imageRight = false, imagePosition, noImage, bg, children }) {
  if (noImage) {
    return (
      <div className="w-full h-full overflow-auto" style={{ background: bg || SAND }}>
        <div className="p-10 md:p-16 max-w-4xl mx-auto">{children}</div>
      </div>
    )
  }
  const onRight = imagePosition ? imagePosition === 'right' : imageRight
  const text = <div className="p-10 md:p-16 flex flex-col justify-center overflow-auto" style={{ background: bg || SAND }}>{children}</div>
  const img = <SlideImage src={image} className="w-full h-full" />
  return (
    <div className="w-full h-full grid grid-cols-1 md:grid-cols-2">
      {onRight ? (<>{text}<div className="hidden md:block">{img}</div></>) : (<><div className="hidden md:block">{img}</div>{text}</>)}
    </div>
  )
}

/**
 * Layout usado nas seções de escopo e na modelagem 3D: título centralizado no topo,
 * tópicos à esquerda logo abaixo (aparecem juntos, sem clique), e as imagens embaixo,
 * lado a lado ou em grade — cada uma aparecendo a um clique, na ordem em que foram
 * adicionadas. Sem imagem nenhuma, o texto ocupa o espaço todo de um jeito mais legível.
 */
function TopicImageSlide({ slide, c1, revealCount, radius }) {
  const imgs = effectiveImages(slide)
  const layout = slide.imageLayout || 'row'
  const hasImages = imgs.length > 0
  const { bg, heading } = slideColors(slide, SAND)

  return (
    <div className="w-full h-full p-8 md:p-14 overflow-hidden flex flex-col" style={{ background: bg }}>
      <h2 className="text-center text-2xl md:text-3xl mb-2 shrink-0" style={{ ...titleStyle, color: heading }}>{slide.title}</h2>
      {slide.description && (
        <p className="text-center max-w-2xl mx-auto mb-4 shrink-0" style={{ color: heading, opacity: 0.7 }}>{slide.description}</p>
      )}

      {/* tópicos sempre empilhados, um abaixo do outro — nunca lado a lado */}
      <div className={`shrink-0 space-y-2 mb-4 ${hasImages ? 'max-w-xl' : 'max-w-3xl mx-auto w-full text-center'}`}>
        {slide.items.map((it, i) => (
          <div key={i} className="auto-left-item flex items-start gap-2" style={{ animationDelay: `${i * 40}ms`, color: heading, opacity: 0.85, justifyContent: hasImages ? 'flex-start' : 'center' }}>
            <span style={{ color: c1 }}>●</span><span>{it}</span>
          </div>
        ))}
      </div>

      {/* área reservada para as imagens: tamanho fixo, então o slide nunca cresce além da tela,
          não importa o tamanho ou a quantidade de fotos enviadas */}
      {hasImages && (
        <div className="flex-1 min-h-0">
          {layout === 'grid' ? (
            <div className="grid grid-cols-2 gap-3 h-full">
              {imgs.map((img, i) => (
                <div key={i} className="relative overflow-hidden bg-[#DDD6C8]" style={{ borderRadius: radius }}>
                  <Reveal i={i} revealCount={revealCount} className="absolute inset-0">
                    <SlideImage src={img.url} className="w-full h-full" style={{ objectPosition: `${img.posX ?? 50}% ${img.posY ?? 50}%` }} />
                  </Reveal>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-3 h-full">
              {imgs.map((img, i) => (
                <div key={i} className="flex-1 min-w-0 relative overflow-hidden bg-[#DDD6C8]" style={{ borderRadius: radius }}>
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
