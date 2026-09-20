import React, { useEffect, useRef, useState } from 'react'

const TAMANHO_EDITOR = 260 // px do círculo mostrado na tela
const TAMANHO_SAIDA = 480  // px da imagem final salva — nítido o bastante pra um logo pequeno, sem pesar o documento

/**
 * Modal de recorte circular pra logo. Existe porque a logo aparece em círculo em vários
 * lugares (apresentação, painel de propostas), e sem isso o navegador só centralizava a
 * imagem enviada sozinho: numa foto onde o centro de interesse não estava bem no meio
 * (por exemplo uma logo retangular, ou um rosto fora do centro), o corte automático saía
 * errado e a única forma de corrigir era editar a imagem fora do sistema antes de enviar.
 *
 * A imagem é salva já recortada (não guardamos a original + a posição) — mais simples, e
 * como ela é pequena (um logo, não uma foto de proposta), o peso extra não é um problema.
 */
export default function RecorteLogo({ file, onCancelar, onConfirmar }) {
  const [img, setImg] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const arrastoRef = useRef(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const el = new Image()
    el.onload = () => setImg(el)
    el.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  if (!img) return null

  // escala mínima pra imagem sempre cobrir o círculo inteiro (igual ao "cover" do CSS);
  // o zoom (1 a 3) multiplica essa escala pra permitir aproximar
  const baseScale = Math.max(TAMANHO_EDITOR / img.width, TAMANHO_EDITOR / img.height)
  const escala = baseScale * zoom
  const largura = img.width * escala
  const altura = img.height * escala
  const maxX = Math.max(0, (largura - TAMANHO_EDITOR) / 2)
  const maxY = Math.max(0, (altura - TAMANHO_EDITOR) / 2)

  // trava o arrasto pra imagem nunca "descolar" e deixar um vazio dentro do círculo
  function limitar(o, mx, my) {
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) }
  }

  function aoMudarZoom(novoZoom) {
    setZoom(novoZoom)
    const novaEscala = baseScale * novoZoom
    const nmx = Math.max(0, (img.width * novaEscala - TAMANHO_EDITOR) / 2)
    const nmy = Math.max(0, (img.height * novaEscala - TAMANHO_EDITOR) / 2)
    setOffset((o) => limitar(o, nmx, nmy))
  }

  function aoIniciarArrasto(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    arrastoRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, offsetX: offset.x, offsetY: offset.y }
  }

  function aoMoverArrasto(e) {
    const a = arrastoRef.current
    if (!a || a.pointerId !== e.pointerId) return
    const novo = { x: a.offsetX + (e.clientX - a.startX), y: a.offsetY + (e.clientY - a.startY) }
    setOffset(limitar(novo, maxX, maxY))
  }

  function aoSoltarArrasto() {
    arrastoRef.current = null
  }

  /** Redesenha, na resolução final, exatamente o que aparecia dentro do círculo do editor */
  function confirmar() {
    const canvas = document.createElement('canvas')
    canvas.width = TAMANHO_SAIDA
    canvas.height = TAMANHO_SAIDA
    const ctx = canvas.getContext('2d')
    const razao = TAMANHO_SAIDA / TAMANHO_EDITOR
    const escalaSaida = escala * razao
    const larguraSaida = img.width * escalaSaida
    const alturaSaida = img.height * escalaSaida
    const dx = TAMANHO_SAIDA / 2 + offset.x * razao - larguraSaida / 2
    const dy = TAMANHO_SAIDA / 2 + offset.y * razao - alturaSaida / 2
    ctx.drawImage(img, dx, dy, larguraSaida, alturaSaida)
    // PNG preserva transparência — comum em logos/ícones sobre fundo colorido
    onConfirmar(canvas.toDataURL('image/png'))
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
        <h3 className="font-display text-lg text-ink mb-1">Ajustar logo</h3>
        <p className="text-xs text-muted mb-4">
          Arraste a imagem para posicionar e use o controle para dar zoom. O círculo mostra
          exatamente como a logo vai aparecer no sistema.
        </p>

        <div
          className="mx-auto rounded-full overflow-hidden bg-sand select-none cursor-grab active:cursor-grabbing"
          style={{ width: TAMANHO_EDITOR, height: TAMANHO_EDITOR, touchAction: 'none' }}
          onPointerDown={aoIniciarArrasto}
          onPointerMove={aoMoverArrasto}
          onPointerUp={aoSoltarArrasto}
          onPointerCancel={aoSoltarArrasto}
        >
          <img
            src={img.src} alt="" draggable={false}
            className="block max-w-none"
            style={{
              width: largura,
              height: altura,
              transform: `translate(${TAMANHO_EDITOR / 2 - largura / 2 + offset.x}px, ${TAMANHO_EDITOR / 2 - altura / 2 + offset.y}px)`,
            }}
          />
        </div>

        <input
          type="range" min={1} max={3} step={0.01} value={zoom}
          onChange={(e) => aoMudarZoom(Number(e.target.value))}
          className="w-full mt-5 accent-clay"
        />

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancelar} className="text-sm px-4 py-2 rounded-full border border-line text-ink/70">Cancelar</button>
          <button onClick={confirmar} className="text-sm px-4 py-2 rounded-full bg-clay text-white font-medium">Usar esta imagem</button>
        </div>
      </div>
    </div>
  )
}
