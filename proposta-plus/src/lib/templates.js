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
