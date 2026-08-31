import React, { useRef, useState } from 'react'

function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

const SLOT_LABELS = ['Cor 1 · Destaque', 'Cor 2 · Base', 'Cor 3 · Fundo']

export default function ColorWheelPicker({ palette, onChange }) {
  const wheelRef = useRef(null)
  const [activeSlot, setActiveSlot] = useState(0)
  const [lightness, setLightness] = useState(50)

  function setColor(i, hex) {
    const next = [...palette]
    next[i] = hex
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

  return (
    <div className="flex flex-col sm:flex-row gap-6 items-start">
      <div className="flex flex-col items-center gap-3">
        <div
          ref={wheelRef}
          onClick={handleWheelClick}
          className="w-40 h-40 rounded-full cursor-crosshair border border-line shrink-0"
          style={{
            background:
              'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
            filter: `saturate(1) brightness(${0.4 + lightness / 100 * 0.9})`,
          }}
          title="Clique para escolher a cor"
        />
        <input
          type="range" min="10" max="90" value={lightness}
          onChange={(e) => setLightness(Number(e.target.value))}
          className="w-40 accent-clay"
        />
        <span className="text-xs text-muted">Claridade</span>
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
            {activeSlot === i && <span className="text-[10px] text-clay uppercase tracking-wide">editando</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
