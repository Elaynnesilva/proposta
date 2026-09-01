import React, { useRef, useState } from 'react'
import { FIXED_SWATCHES } from '../lib/templates'

function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

/** Converte hex para {h, s, l} — usado só para posicionar a marca no círculo */
function hexToHsl(hex) {
  const c = (hex || '#000000').replace('#', '')
  if (c.length !== 6) return { h: 0, s: 0, l: 50 }
  const r = parseInt(c.substring(0, 2), 16) / 255
  const g = parseInt(c.substring(2, 4), 16) / 255
  const b = parseInt(c.substring(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  const d = max - min
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case r: h = ((g - b) / d) % 6; break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: s * 100, l: l * 100 }
}

/** Reduz uma imagem a até N cores dominantes, amostrando pixels num canvas pequeno */
async function extractColorsFromImage(file, maxColors = 5) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const img = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = dataUrl
  })
  const size = 80
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)

  const buckets = new Map() // chave = cor "quantizada", valor = { count, r,g,b (soma) }
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 200) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const key = [r, g, b].map((v) => Math.round(v / 24) * 24).join(',')
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 }
    bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b
    buckets.set(key, bucket)
  }
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count)
  const toHex = (v) => Math.round(v).toString(16).padStart(2, '0')
  const colors = []
  for (const bucket of sorted) {
    const hex = `#${toHex(bucket.r / bucket.count)}${toHex(bucket.g / bucket.count)}${toHex(bucket.b / bucket.count)}`.toUpperCase()
    if (!colors.includes(hex)) colors.push(hex)
    if (colors.length >= maxColors) break
  }
  return colors
}

const SLOT_LABELS = ['Cor 1 · Destaque', 'Cor 2 · Base', 'Cor 3 · Fundo']

export default function ColorWheelPicker({
  palette, onChange,
  savedSwatches = [], onAddSwatch,
  savedPalettes = [], onSavePalette, onApplyPalette, onDeletePalette,
}) {
  const wheelRef = useRef(null)
  const fileRef = useRef(null)
  const [activeSlot, setActiveSlot] = useState(0)
  const [lightness, setLightness] = useState(50)
  const [extracted, setExtracted] = useState([])
  const [extracting, setExtracting] = useState(false)
  const [eyedropperSupported] = useState(typeof window !== 'undefined' && 'EyeDropper' in window)

  const activeHex = palette[activeSlot] || '#000000'
  const activeHsl = hexToHsl(activeHex)

  function setColor(i, hex) {
    const next = [...palette]
    next[i] = hex.toUpperCase()
    onChange(next)
  }

  function handleWheelClick(e) {
    const rect = wheelRef.current.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const x = e.clientX - rect.left - cx
    const y = e.clientY - rect.top - cy
    const dist = Math.min(Math.sqrt(x * x + y * y), cx)
    const sat = Math.round((dist / cx) * 100)
    let angle = (Math.atan2(y, x) * 180) / Math.PI
    if (angle < 0) angle += 360
    const hex = hslToHex(angle, sat, lightness)
    setColor(activeSlot, hex)
  }

  async function handleEyedropper() {
    if (!eyedropperSupported) {
      alert('O conta-gotas nativo não é suportado neste navegador. Ele funciona no Chrome e Edge no computador.')
      return
    }
    try {
      const eyeDropper = new window.EyeDropper()
      const result = await eyeDropper.open()
      setColor(activeSlot, result.sRGBHex)
    } catch {
      // pessoa cancelou o conta-gotas — não faz nada
    }
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setExtracting(true)
    try {
      const colors = await extractColorsFromImage(file, 5)
      setExtracted(colors)
    } catch {
      alert('Não consegui extrair as cores dessa imagem. Tente outra imagem.')
    } finally {
      setExtracting(false)
      e.target.value = ''
    }
  }

  function saveCurrentPalette() {
    const name = window.prompt('Dar um nome para esta paleta:', 'Minha paleta')
    if (!name) return
    onSavePalette?.(name, palette)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-6 items-start">
        <div className="flex flex-col items-center gap-3 shrink-0">
          <div className="relative">
            <div
              ref={wheelRef}
              onClick={handleWheelClick}
              className="w-40 h-40 rounded-full cursor-crosshair border border-line"
              style={{
                background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
                filter: `saturate(1) brightness(${0.4 + lightness / 100 * 0.9})`,
              }}
              title="Clique para escolher a cor"
            />
            {/* marca mostrando onde a cor ativa está no círculo, para você se localizar melhor */}
            <div
              className="absolute w-4 h-4 rounded-full border-2 border-white shadow pointer-events-none"
              style={{
                background: activeHex,
                left: `calc(50% + ${Math.cos((activeHsl.h * Math.PI) / 180) * (activeHsl.s / 100) * 72}px - 8px)`,
                top: `calc(50% + ${Math.sin((activeHsl.h * Math.PI) / 180) * (activeHsl.s / 100) * 72}px - 8px)`,
              }}
            />
          </div>
          <input
            type="range" min="10" max="90" value={lightness}
            onChange={(e) => setLightness(Number(e.target.value))}
            className="w-40 accent-clay"
          />
          <div className="text-xs text-muted text-center">
            Claridade — <span className="font-mono">{activeHex}</span>
          </div>
          <button
            onClick={handleEyedropper}
            className="text-xs px-3 py-1.5 rounded-full border border-line hover:bg-sand transition flex items-center gap-1.5"
          >💧 Conta-gotas</button>
        </div>

        <div className="flex-1 space-y-3 w-full">
          {palette.map((hex, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition ${activeSlot === i ? 'border-clay bg-clay/5' : 'border-line'}`}
              onClick={() => setActiveSlot(i)}
            >
              <div className="w-9 h-9 rounded-full border border-line shrink-0" style={{ background: hex }} />
              <div className="flex-1">
                <div className="text-xs text-muted">{SLOT_LABELS[i]}</div>
                <input
                  value={hex}
                  onChange={(e) => setColor(i, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm font-mono bg-transparent outline-none w-24"
                  maxLength={7}
                />
              </div>
              {onAddSwatch && (
                <button
                  onClick={(e) => { e.stopPropagation(); onAddSwatch(hex) }}
                  className="text-[11px] text-muted hover:text-clay"
                  title="Salvar esta cor nos quadradinhos"
                >salvar cor</button>
              )}
              {activeSlot === i && <span className="text-[10px] text-clay uppercase tracking-wide">editando</span>}
            </div>
          ))}
        </div>
      </div>

      {/* cores neutras fixas — sempre disponíveis, mesmo fora da paleta escolhida */}
      <div>
        <div className="text-xs font-medium text-ink/70 mb-2">Cores neutras (sempre disponíveis)</div>
        <div className="flex gap-2 flex-wrap">
          {FIXED_SWATCHES.map((s) => (
            <button
              key={s.hex}
              onClick={() => setColor(activeSlot, s.hex)}
              title={s.label}
              className="w-8 h-8 rounded-md border border-line shrink-0"
              style={{ background: s.hex }}
            />
          ))}
        </div>
      </div>

      {/* quadradinhos de cores já usadas/salvas */}
      {(savedSwatches.length > 0 || onAddSwatch) && (
        <div>
          <div className="text-xs font-medium text-ink/70 mb-2">Cores salvas</div>
          {savedSwatches.length === 0 ? (
            <p className="text-xs text-muted">Nenhuma cor salva ainda — clique em "salvar cor" ao lado de qualquer cor da paleta.</p>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {savedSwatches.map((hex) => (
                <button
                  key={hex}
                  onClick={() => setColor(activeSlot, hex)}
                  title={hex}
                  className="w-7 h-7 rounded-md border border-line shrink-0"
                  style={{ background: hex }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* extrair cores de uma imagem */}
      <div>
        <div className="text-xs font-medium text-ink/70 mb-2">Extrair cores de uma imagem</div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={extracting}
          className="text-xs px-3 py-1.5 rounded-full border border-line hover:bg-sand transition disabled:opacity-50"
        >{extracting ? 'Analisando imagem…' : 'Enviar imagem e extrair até 5 cores'}</button>
        {extracted.length > 0 && (
          <div className="flex gap-2 flex-wrap mt-3">
            {extracted.map((hex) => (
              <button
                key={hex}
                onClick={() => { setColor(activeSlot, hex); onAddSwatch?.(hex) }}
                title={`Usar ${hex}`}
                className="w-9 h-9 rounded-md border border-line shrink-0"
                style={{ background: hex }}
              />
            ))}
          </div>
        )}
      </div>

      {/* paletas salvas (modelos reutilizáveis) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium text-ink/70">Paletas salvas</div>
          {onSavePalette && (
            <button onClick={saveCurrentPalette} className="text-[11px] text-clay hover:underline">+ salvar paleta atual</button>
          )}
        </div>
        {savedPalettes.length === 0 ? (
          <p className="text-xs text-muted">Nenhuma paleta salva ainda.</p>
        ) : (
          <div className="space-y-2">
            {savedPalettes.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg border border-line">
                <div className="flex gap-1 shrink-0">
                  {p.palette.map((hex, i) => (
                    <div key={i} className="w-5 h-5 rounded-full border border-line" style={{ background: hex }} />
                  ))}
                </div>
                <div className="flex-1 text-sm text-ink/80 truncate">{p.name}</div>
                <button onClick={() => onApplyPalette?.(p.palette)} className="text-[11px] text-clay hover:underline shrink-0">usar</button>
                {onDeletePalette && (
                  <button onClick={() => onDeletePalette(p.id)} className="text-[11px] text-muted hover:text-red-500 shrink-0">excluir</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
