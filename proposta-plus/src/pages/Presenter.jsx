import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProposal, getSettings, getTemplateContent, saveProposal, saveTemplateContent } from '../lib/db'
import { buildSlides } from '../lib/slides'
import { DEFAULT_IMAGES, DEFAULT_SHARED_TEXT } from '../lib/content'
import { STYLE, paletteToCssVars, readableTextColor, DEFAULT_PALETTE } from '../lib/templates'

const SLIDE_ICONS = {
  cover: '🏠', agenda: '📋', profile: '👩‍🎨', divider: '—', clientRequest: '🗂️',
  reasons: '💡', scopeSection: '📐', modeling: '🧊', journeyFlow: '🧭', stages: '🎯',
  feedbacks: '💬', pricingCalc: '🧮', packagePricing: '💰', payment: '💳', video: '🎬',
  custom: '✨', closing: '❤️',
}

// slides cujo conteúdo vem de textos compartilhados (Configurações > Textos padrão) —
// só esses ganham a opção de "aplicar em todas as propostas" na edição rápida
const GLOBAL_EDITABLE_SLIDES = new Set(['agenda', 'about', 'reasons', 'stages', 'feedbacks', 'closing'])

const EXPORT_W = 1600
const EXPORT_H = 900

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

  const baseSlides = useMemo(() => {
    if (!proposal || !settings) return []
    return buildSlides({
      fields: proposal.fields || {},
      content, images, settings,
      custom: proposal.customSlides || [],
      videoUrl: proposal.videoUrl || '',
      videoEmbedUrl: proposal.videoEmbedUrl || '',
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

  const slide = slides[index]
  const palette = proposal?.palette || DEFAULT_PALETTE
  const [c1, c2, c3] = palette
  const cssVars = paletteToCssVars(palette)

  const goNext = useCallback(() => { setIndex((i) => Math.min(i + 1, slides.length - 1)); setRevealCount(1) }, [slides.length])
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

  function jumpTo(i) { setIndex(i); setRevealCount(999) }

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

  async function handleExportPdf() {
    setExporting(true)
    try {
      const { default: html2canvas } = await import('html2canvas')
      const { jsPDF } = await import('jspdf')
      let pdf = null
      for (let i = 0; i < slides.length; i++) {
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
      pdf.save(`${(proposal.name || 'proposta').replace(/[^\w\- ]/g, '')}.pdf`)
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
          <SlideSidebar slides={slides} index={index} onJump={jumpTo} onReorder={reorder} onClose={() => setSidebarOpen(false)} />
        )}

        <div className="relative flex-1 min-w-0">
          <div className="absolute inset-0 cursor-pointer" onClick={handleAdvance}>
            <SlideView slide={slide} c1={c1} c2={c2} c3={c3} revealCount={revealCount} />
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
                {exporting ? `Gerando PDF… ${exportProgress}/${slides.length}` : '⇩ Baixar PDF'}
              </button>
              <div className="text-xs bg-black/30 backdrop-blur px-3 py-1.5 rounded-full">{index + 1} / {slides.length}</div>
            </div>
          </div>

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 pointer-events-none">
            {slides.map((s, i) => (
              <div key={s.id} className="h-1.5 rounded-full transition-all" style={{ width: i === index ? 22 : 6, background: i === index ? c1 : 'rgba(255,255,255,0.35)' }} />
            ))}
          </div>

          <button onClick={(e) => { e.stopPropagation(); goPrev() }} className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur flex items-center justify-center">‹</button>
          <button onClick={(e) => { e.stopPropagation(); handleAdvance() }} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur flex items-center justify-center">›</button>

          {editing && (
            <EditPanel
              slide={slide}
              allowGlobal={GLOBAL_EDITABLE_SLIDES.has(slide.id)}
              onSave={(patch, scope) => { scope === 'global' ? saveGlobalContent(slide.id, patch) : saveOverridePerProposal(slide.id, patch) }}
              onClose={() => setEditing(false)}
            />
          )}
        </div>
      </div>

      {/* área invisível usada só para "fotografar" cada slide na hora de gerar o PDF */}
      <div style={{ position: 'fixed', left: -99999, top: 0, width: EXPORT_W, height: EXPORT_H, overflow: 'hidden' }}>
        <div ref={exportRef} style={{ width: EXPORT_W, height: EXPORT_H }}>
          {exporting && slides[exportIndex] && (
            <SlideView slide={slides[exportIndex]} c1={c1} c2={c2} c3={c3} revealCount={999} />
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
  } else if (slideId === 'stages') {
    if (patch.title !== undefined) next.stagesTitle = patch.title
  } else if (slideId === 'feedbacks') {
    if (patch.title !== undefined) next.feedbacksTitle = patch.title
  } else if (slideId === 'closing') {
    if (patch.title !== undefined) next.closingHeadline = patch.title
    if (patch.quote !== undefined) next.closingQuote = patch.quote
    if (patch.author !== undefined) next.closingAuthor = patch.author
  }
  return next
}

function getItemsLength(slide) {
  if (!slide) return 0
  if (Array.isArray(slide.items)) return slide.items.length
  if (slide.type === 'stages') return slide.stages?.length || 0
  if (slide.type === 'packagePricing') return slide.paymentCards?.length || 0
  return 0
}

/* ---------------- BARRA LATERAL DE SLIDES ---------------- */

function SlideSidebar({ slides, index, onJump, onReorder, onClose }) {
  const dragFrom = useRef(null)

  return (
    <div className="w-56 shrink-0 bg-[#1c232b] border-r border-white/10 flex flex-col">
      <div className="flex items-center justify-between px-3 py-3 border-b border-white/10">
        <span className="text-xs uppercase tracking-wide text-white/50">Slides</span>
        <button onClick={onClose} className="text-white/50 hover:text-white text-xs">ocultar ✕</button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {slides.map((s, i) => (
          <div
            key={s.id}
            draggable
            onDragStart={() => (dragFrom.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragFrom.current !== null && dragFrom.current !== i) onReorder(dragFrom.current, i); dragFrom.current = null }}
            onClick={() => onJump(i)}
            className={`mx-2 mb-1 px-2.5 py-2 rounded-lg cursor-pointer flex items-center gap-2 text-xs transition ${i === index ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5'}`}
            title="Arraste para reordenar"
          >
            <span className="text-white/30 text-[10px] w-4 text-center">{i + 1}</span>
            <span>{SLIDE_ICONS[s.type] || '•'}</span>
            <span className="truncate flex-1">{s.title || slideFallbackLabel(s)}</span>
          </div>
        ))}
      </div>
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

function EditPanel({ slide, allowGlobal, onSave, onClose }) {
  const [scope, setScope] = useState('proposal')
  const [title, setTitle] = useState(slide.title || slide.headline || '')
  const [items, setItems] = useState(Array.isArray(slide.items) && typeof slide.items[0] !== 'object' ? [...slide.items] : null)
  const [quote, setQuote] = useState(slide.quote || '')
  const [author, setAuthor] = useState(slide.author || '')

  useEffect(() => {
    setScope('proposal')
    setTitle(slide.title || slide.headline || '')
    setItems(Array.isArray(slide.items) && typeof slide.items[0] !== 'object' ? [...slide.items] : null)
    setQuote(slide.quote || '')
    setAuthor(slide.author || '')
  }, [slide.id])

  function handleImage(file) {
    const reader = new FileReader()
    reader.onload = () => onSave({ image: reader.result }, 'proposal') // imagens são sempre só desta proposta/tipologia
    reader.readAsDataURL(file)
  }

  function save() {
    const patch = slide.type === 'closing' ? { title, quote, author } : { title }
    if (items) patch.items = items
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

      {slide.type === 'closing' && (
        <>
          <label className="text-xs font-medium text-ink/70 block mb-1">Frase</label>
          <textarea value={quote} onChange={(e) => setQuote(e.target.value)} rows={2} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-4" />
          <label className="text-xs font-medium text-ink/70 block mb-1">Autor(a)</label>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay mb-4" />
        </>
      )}

      {items && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Textos (aparecem um a um ao clicar)</label>
          {items.map((it, i) => (
            <textarea
              key={i} value={it} rows={2}
              onChange={(e) => { const next = [...items]; next[i] = e.target.value; setItems(next) }}
              className="w-full text-sm p-2 rounded-lg border border-line outline-none focus:border-clay mb-2"
            />
          ))}
          <div className="flex gap-3">
            <button onClick={() => setItems([...items, ''])} className="text-xs text-clay">+ adicionar texto</button>
            {items.length > 0 && <button onClick={() => setItems(items.slice(0, -1))} className="text-xs text-red-600">remover último</button>}
          </div>
        </div>
      )}

      {'image' in slide && (
        <div className="mb-4">
          <label className="text-xs font-medium text-ink/70 block mb-1">Imagem (só desta proposta)</label>
          {slide.image && <img src={slide.image} className="w-full h-28 object-cover rounded-lg mb-2" alt="" />}
          <input type="file" accept="image/*" onChange={(e) => e.target.files[0] && handleImage(e.target.files[0])} className="text-xs" />
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

function SlideView({ slide, c1, c2, c3, revealCount }) {
  const t2 = readableTextColor(c2)
  const radius = STYLE.radius

  switch (slide.type) {
    case 'cover':
      return (
        <div className="w-full h-full relative flex items-end">
          <SlideImage src={slide.image} className="absolute inset-0 w-full h-full" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.8) 10%, rgba(0,0,0,0.15) 60%, rgba(0,0,0,0.4) 100%)' }} />
          <div className="relative z-10 p-10 md:p-20 max-w-3xl">
            <div className="text-xs tracking-[0.2em] uppercase mb-4" style={{ color: c1 }}>{slide.kicker}</div>
            <h1 className="text-3xl md:text-5xl mb-6 text-white" style={titleStyle}>{slide.title}</h1>
            {slide.items.map((it, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="text-base md:text-lg text-white/85 mb-2 max-w-xl">{it}</Reveal>
            ))}
          </div>
        </div>
      )

    case 'divider':
      return (
        <div className="w-full h-full flex flex-col items-center justify-center text-center px-10" style={{ background: c2 }}>
          <h2 className="text-2xl md:text-4xl max-w-3xl" style={{ ...titleStyle, color: t2 }}>{slide.title}</h2>
          {slide.subtitle && <p className="mt-5 max-w-xl" style={{ color: t2, opacity: 0.75 }}>{slide.subtitle}</p>}
        </div>
      )

    case 'agenda':
      return (
        <SplitLayout image={slide.image} radius={radius}>
          <h2 className="text-2xl md:text-3xl mb-8" style={titleStyle}>{slide.title}</h2>
          <ol className="space-y-3">
            {slide.items.map((it, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="flex gap-3 text-lg text-ink">
                <span style={{ color: c1 }} className="font-semibold">{i + 1}.</span>
                <span>{it}</span>
              </Reveal>
            ))}
          </ol>
        </SplitLayout>
      )

    case 'profile':
      return (
        <SplitLayout image={slide.image} radius={radius} imageRight>
          <h2 className="text-2xl md:text-3xl mb-6" style={titleStyle}>{slide.title}</h2>
          {slide.items.map((it, i) => (
            <Reveal key={i} i={i} revealCount={revealCount} className="text-ink/80 whitespace-pre-line mb-4 leading-relaxed">{it}</Reveal>
          ))}
        </SplitLayout>
      )

    case 'clientRequest':
      return (
        <SplitLayout image={slide.image} radius={radius}>
          <h2 className="text-xl md:text-2xl mb-8" style={titleStyle}>{slide.title}</h2>
          <div className="space-y-4">
            {slide.rows.map(([label, value], i) => (
              <Reveal key={i} i={i} revealCount={revealCount}>
                <div className="text-xs tracking-wide uppercase text-muted mb-0.5">{label}</div>
                <div className="text-ink text-base">{value}</div>
              </Reveal>
            ))}
            {slide.ambientes.length > 0 && (
              <Reveal i={slide.rows.length} revealCount={revealCount}>
                <div className="text-xs tracking-wide uppercase text-muted mb-1">Ambientes {slide.quantAmbientes ? `(${slide.quantAmbientes})` : ''}</div>
                <div className="flex flex-wrap gap-2">
                  {slide.ambientes.map((a, k) => (
                    <span key={k} className="text-sm px-2.5 py-1 bg-sand border border-line" style={{ borderRadius: radius }}>{a}</span>
                  ))}
                </div>
              </Reveal>
            )}
          </div>
        </SplitLayout>
      )

    case 'reasons':
      return (
        <SplitLayout image={slide.image} radius={radius} imageRight>
          <h2 className="text-xl md:text-2xl mb-6" style={titleStyle}>{slide.title}</h2>
          <div className="space-y-4">
            {slide.items.map((r, i) => (
              <Reveal key={i} i={i} revealCount={revealCount}>
                <div className="font-semibold" style={{ color: c1 }}>{i + 1}. {r.title}</div>
                <div className="text-sm text-ink/75 mt-1">{r.body}</div>
              </Reveal>
            ))}
          </div>
        </SplitLayout>
      )

    case 'scopeSection':
      return (
        <SplitLayout image={slide.image} radius={radius}>
          <div className="text-3xl mb-3">{iconGlyph(slide.icon)}</div>
          <h2 className="text-2xl md:text-3xl mb-6" style={titleStyle}>{slide.title}</h2>
          <div className="space-y-2.5">
            {slide.items.map((it, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="flex items-start gap-2 text-ink/80">
                <span style={{ color: c1 }}>●</span><span>{it}</span>
              </Reveal>
            ))}
          </div>
        </SplitLayout>
      )

    case 'modeling':
      return (
        <div className="w-full h-full grid grid-cols-1 md:grid-cols-2 bg-sand">
          <div className="p-10 md:p-16 flex flex-col justify-center">
            <h2 className="text-2xl md:text-3xl mb-6" style={titleStyle}>{slide.title}</h2>
            <ul className="space-y-2">
              {slide.items.map((it, i) => (<Reveal key={i} i={i} revealCount={revealCount} className="text-ink/80">• {it}</Reveal>))}
            </ul>
          </div>
          <div className="grid grid-rows-2 gap-1 p-1">
            <SlideImage src={slide.image} className="w-full h-full" style={{ borderRadius: radius }} />
            <SlideImage src={slide.image2} className="w-full h-full" style={{ borderRadius: radius }} />
          </div>
        </div>
      )

    case 'journeyFlow':
      return <JourneyFlowSlide slide={slide} c1={c1} c2={c2} t2={t2} revealCount={revealCount} radius={radius} />

    case 'stages':
      return (
        <div className="w-full h-full bg-sand p-10 md:p-16 overflow-auto">
          <h2 className="text-2xl md:text-3xl mb-8" style={titleStyle}>{slide.title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {slide.stages.map((s, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="bg-white border border-line p-5" style={{ borderRadius: radius }}>
                <div className="font-semibold mb-3" style={{ color: c1 }}>{i + 1}. {s.title}</div>
                <ul className="space-y-1.5 text-sm text-ink/75">{s.items.map((it, k) => <li key={k}>• {it}</li>)}</ul>
              </Reveal>
            ))}
          </div>
          {slide.footnote && <p className="text-xs text-muted mt-8 max-w-2xl">{slide.footnote}</p>}
        </div>
      )

    case 'feedbacks':
      return (
        <div className="w-full h-full bg-ink text-white p-10 md:p-16 flex flex-col justify-center">
          <h2 className="text-2xl md:text-4xl mb-10" style={titleStyle}>{slide.title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {slide.items.map((fb, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="bg-white/10 p-5" style={{ borderRadius: radius }}>
                <div className="flex items-center gap-3 mb-3">
                  {fb.photoUrl && <img src={fb.photoUrl} crossOrigin="anonymous" className="w-9 h-9 rounded-full object-cover" alt="" />}
                  <div className="text-sm font-semibold" style={{ color: c1 }}>{fb.name}</div>
                </div>
                <div className="text-sm text-white/85">{fb.text}</div>
              </Reveal>
            ))}
          </div>
        </div>
      )

    case 'pricingCalc':
      return (
        <div className="w-full h-full bg-sand p-10 md:p-16 flex flex-col md:flex-row gap-10 overflow-auto">
          <div className="flex-1">
            <h2 className="text-xl md:text-2xl mb-6" style={titleStyle}>{slide.title}</h2>
            <ul className="space-y-2">
              {slide.items.map((it, i) => (<Reveal key={i} i={i} revealCount={revealCount} className="text-ink/80 text-sm">• {it}</Reveal>))}
            </ul>
          </div>
          <div className="flex flex-col gap-3 md:w-64 shrink-0">
            {slide.hourValue && <PriceTag label="Hora técnica" value={slide.hourValue} radius={radius} c1={c1} />}
            {slide.dayValue && <PriceTag label="Diária de trabalho" value={slide.dayValue} radius={radius} c1={c1} />}
          </div>
        </div>
      )

    case 'packagePricing':
      return (
        <div className="w-full h-full bg-sand p-10 md:p-16 overflow-auto">
          <h2 className="text-2xl md:text-3xl mb-2" style={titleStyle}>{slide.title}</h2>
          <div className="text-3xl font-semibold mb-2" style={{ color: c1, fontFamily: STYLE.displayFont }}>{slide.value}</div>
          {slide.schedule.length > 0 && <div className="text-sm text-ink/60 mb-8">{slide.schedule.join(' · ')}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {slide.paymentCards.map((p, i) => (
              <Reveal
                key={p.id} i={i} revealCount={revealCount}
                className="p-5"
                style={{
                  borderRadius: radius,
                  background: p.highlight ? c2 : 'white',
                  color: p.highlight ? t2 : '#28313C',
                  border: p.highlight ? 'none' : '1px solid #E4DFD6',
                  boxShadow: p.highlight ? '0 8px 24px rgba(0,0,0,0.12)' : 'none',
                }}
              >
                <div className="text-xs uppercase tracking-wide opacity-70 mb-1">{p.label}{p.highlight ? ' ★' : ''}</div>
                <div className="text-xl font-semibold mb-1" style={{ color: c1, fontFamily: STYLE.displayFont }}>{p.value}</div>
                {p.detail && <div className="text-xs opacity-70">{p.detail}</div>}
              </Reveal>
            ))}
          </div>
        </div>
      )

    case 'video':
      return (
        <div className="w-full h-full bg-ink flex items-center justify-center p-10">
          {slide.videoUrl ? (
            <video src={slide.videoUrl} controls className="max-w-full max-h-full" style={{ borderRadius: STYLE.radius }} />
          ) : slide.embedUrl ? (
            <iframe src={slide.embedUrl} className="w-full h-full" style={{ borderRadius: STYLE.radius }} allowFullScreen title="video" />
          ) : (
            <div className="text-white/50 text-center">
              <div className="text-4xl mb-3">▶</div>
              <div>Nenhum vídeo adicionado ainda.</div>
              <div className="text-sm mt-1">Adicione no editor da proposta.</div>
            </div>
          )}
        </div>
      )

    case 'custom':
      return (
        <div className="w-full h-full bg-sand grid grid-cols-1 md:grid-cols-2">
          <div className="p-10 md:p-16 flex flex-col justify-center order-2 md:order-1">
            <h2 className="text-2xl md:text-3xl mb-6" style={titleStyle}>{slide.title}</h2>
            {(slide.items || [slide.body]).filter(Boolean).map((it, i) => (
              <Reveal key={i} i={i} revealCount={revealCount} className="text-ink/80 mb-3 whitespace-pre-line">{it}</Reveal>
            ))}
          </div>
          <div className="order-1 md:order-2 relative">
            {slide.videoUrl ? <video src={slide.videoUrl} controls className="w-full h-full object-cover" /> : <SlideImage src={slide.image} className="w-full h-full" />}
          </div>
        </div>
      )

    case 'closing':
      return (
        <div className="w-full h-full flex flex-col items-center justify-center text-center px-10" style={{ background: c2 }}>
          <h2 className="text-xl md:text-2xl mb-6" style={{ ...titleStyle, color: t2, opacity: 0.9 }}>{slide.headline}</h2>
          <p className="text-xl md:text-2xl italic max-w-2xl" style={{ color: c1, fontFamily: STYLE.displayFont }}>&ldquo;{slide.quote}&rdquo;</p>
          {slide.author && <p className="text-sm mt-4 tracking-wide" style={{ color: t2, opacity: 0.6 }}>{slide.author}</p>}
        </div>
      )

    default:
      return <div className="w-full h-full flex items-center justify-center text-white/50">Slide</div>
  }
}

function JourneyFlowSlide({ slide, c1, c2, t2, revealCount, radius }) {
  return (
    <div className="w-full h-full bg-sand p-8 md:p-14 overflow-auto">
      <h2 className="text-2xl md:text-4xl mb-2" style={titleStyle}>{slide.title}</h2>
      <p className="text-sm text-muted mb-8">Do primeiro contato até a chave na mão</p>
      <div className="flex flex-wrap gap-x-3 gap-y-4">
        {slide.items.map((it, i) => (
          <Reveal key={i} i={i} revealCount={revealCount} className="flex items-center gap-3">
            <div
              className="flex flex-col items-start justify-center px-4 py-3 min-w-[180px] max-w-[220px]"
              style={{ borderRadius: radius, background: i % 2 === 0 ? c2 : 'white', color: i % 2 === 0 ? t2 : '#28313C', border: i % 2 === 0 ? 'none' : '1px solid #E4DFD6', boxShadow: '0 4px 14px rgba(0,0,0,0.06)' }}
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mb-2" style={{ background: c1, color: readableTextColor(c1) }}>{i + 1}</div>
              <div className="text-sm leading-snug">{it}</div>
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

function PriceTag({ label, value, radius, c1 }) {
  return (
    <div className="bg-white border border-line p-4" style={{ borderRadius: radius }}>
      <div className="text-xs uppercase tracking-wide text-muted mb-1">{label}</div>
      <div className="text-lg font-semibold" style={{ color: c1 }}>{value}</div>
    </div>
  )
}

function SplitLayout({ image, radius, imageRight = false, children }) {
  const text = <div className="p-10 md:p-16 flex flex-col justify-center overflow-auto">{children}</div>
  const img = <SlideImage src={image} className="w-full h-full" />
  return (
    <div className="w-full h-full grid grid-cols-1 md:grid-cols-2 bg-sand">
      {imageRight ? (<>{text}<div className="hidden md:block">{img}</div></>) : (<><div className="hidden md:block">{img}</div>{text}</>)}
    </div>
  )
}
