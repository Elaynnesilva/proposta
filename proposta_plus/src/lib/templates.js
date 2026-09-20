/**
 * Estilo único da apresentação (baseado no modelo real em PDF da Elaynne):
 * tipografia em caixa alta, sans-serif, títulos em negrito, terracota como
 * cor de destaque, navy escuro para texto, fundo em bege claro.
 */
export const STYLE = {
  displayFont: "'Inter', system-ui, sans-serif",
  bodyFont: "'Inter', system-ui, sans-serif",
  headingWeight: 700,
  headingTransform: 'uppercase',
  headingTracking: '0.01em',
  radius: '10px',
}

export const DEFAULT_PALETTE = ['#B85C3E', '#28313C', '#F6F3EE']

/** Cores neutras sempre disponíveis na paleta, mesmo que a pessoa não as tenha escolhido */
export const FIXED_SWATCHES = [
  { hex: '#FFFFFF', label: 'Branco' },
  { hex: '#1A1A1A', label: 'Preto' },
  { hex: '#F6F3EE', label: 'Bege claro' },
  { hex: '#8A8F94', label: 'Cinza' },
]

export function paletteToCssVars(palette = DEFAULT_PALETTE) {
  return {
    '--c1': palette[0] || DEFAULT_PALETTE[0],
    '--c2': palette[1] || DEFAULT_PALETTE[1],
    '--c3': palette[2] || DEFAULT_PALETTE[2],
  }
}

/** Decide se o texto sobre uma cor deve ser branco ou escuro, para nunca ficar ilegível */
export function readableTextColor(hex) {
  if (!hex) return '#1A1A1A'
  const c = hex.replace('#', '')
  if (c.length !== 6) return '#1A1A1A'
  const r = parseInt(c.substring(0, 2), 16)
  const g = parseInt(c.substring(2, 4), 16)
  const b = parseInt(c.substring(4, 6), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? '#1A1A1A' : '#FFFFFF'
}

/** Razão de contraste (WCAG) entre duas cores hex — usada para avisar quando um par fica ilegível */
export function contrastRatio(hexA, hexB) {
  const lum = (hex) => {
    const c = (hex || '#000000').replace('#', '')
    if (c.length !== 6) return 0
    const chan = [0, 2, 4].map((i) => {
      let v = parseInt(c.substring(i, i + 2), 16) / 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2]
  }
  const l1 = lum(hexA) + 0.05
  const l2 = lum(hexB) + 0.05
  return l1 > l2 ? l1 / l2 : l2 / l1
}

/** true quando o contraste entre texto e fundo está abaixo do mínimo legível (WCAG AA ~ 4.5) */
export function isLowContrast(textHex, bgHex) {
  return contrastRatio(textHex, bgHex) < 4.5
}

/** mesma ideia, mas com o limite mais permissivo do WCAG pra texto grande/negrito (~3.0) —
 *  usada só pra decidir a cor de destaque dos títulos (sempre grandes e em negrito), pra ela
 *  não cair no fallback (mesma cor do texto do corpo) só por passar raspando do limite normal */
export function isLowContrastLarge(textHex, bgHex) {
  return contrastRatio(textHex, bgHex) < 3
}
