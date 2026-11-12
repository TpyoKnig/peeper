// nod's structured replies ("presentations": nod/src/shared/presentation.ts) for the glasses.
// Text follows nod's own presentationText(), trimmed for a glance: no URLs, coordinates or
// "not provided" filler. Charts are also drawn as a 4-bit image for the card view.

interface Common {
  version: 1
  title: string
  caption?: string
  asOf?: string
  sources: { label: string; url: string }[]
}
interface Endpoint {
  airport: string
  date?: string
  time: string
  terminal?: string
}
interface Segment {
  airline: string
  flightNumber?: string
  cabin?: string
  duration?: string
  departure: Endpoint
  arrival: Endpoint
  connectionAfter?: { duration?: string; airportChange: string; selfTransfer: string }
}
interface Venue {
  name: string
  status: string
  facts: { label: string; value: string }[]
  notes?: string[]
  rating?: { value: number; scale: number; count?: number; sourceLabel: string }
}
export type Presentation = Common &
  (
    | { type: 'image'; artifactId: string; alt: string }
    | { type: 'map'; places: { name: string; description?: string }[] }
    | { type: 'apps'; services: string[] }
    | {
        type: 'flights'
        options: {
          label?: string
          status?: string
          bookingReference?: string
          price?: string
          baggage?: string
          recommended?: boolean
          journeys: { label: string; duration?: string; segments: Segment[] }[]
        }[]
      }
    | {
        type: 'seats'
        aircraft?: string
        flight?: string
        sections: { id: string; name: string; rows: { label: string; groups: ({ label: string; status: string; price?: string } | null)[][] }[] }[]
        recommended?: { sectionId: string; seatLabel: string }
      }
    | (Venue & { type: 'booking'; alternatives?: Venue[] })
    | {
        type: 'chart'
        chart: 'bar' | 'line' | 'pie' | 'donut'
        xLabel?: string
        yLabel?: string
        unit?: string
        series: { label: string; points: { label: string; value: number }[] }[]
      }
    | { type: 'diagram'; nodes: { id: string; label: string; detail?: string }[]; edges: { from: string; to: string; label?: string }[] }
  )

const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ')

/** A glanceable text version of any presentation. */
export function cardText(p: Presentation): string {
  const lines: string[] = [`▶ ${p.title}`]
  if (p.caption) lines.push(p.caption)
  if (p.asOf) lines.push(p.asOf)
  switch (p.type) {
    case 'image':
      lines.push(p.alt, '(menu > Show card for the picture)')
      break
    case 'apps':
      lines.push(`Connect in nod's Apps: ${p.services.join(', ')}`)
      break
    case 'map':
      for (const place of p.places) lines.push(join(`● ${place.name}`, place.description))
      break
    case 'flights':
      for (const option of p.options) {
        lines.push('', join(option.label ?? 'Option', option.status === 'booked' && 'Booked', option.bookingReference && `Ref ${option.bookingReference}`, option.price, option.recommended && option.status !== 'booked' && '★ Recommended'))
        for (const journey of option.journeys) {
          const stops = journey.segments.length - 1
          lines.push(join(journey.label, journey.duration, stops ? `${stops} stop${stops > 1 ? 's' : ''}` : 'Nonstop'))
          for (const s of journey.segments) {
            const at = (e: Endpoint) => join(e.airport, e.date, e.time, e.terminal && `T${e.terminal}`)
            lines.push(`  ${join([s.airline, s.flightNumber].filter(Boolean).join(' '), s.cabin)}: ${at(s.departure)} to ${at(s.arrival)}`)
            if (s.connectionAfter) lines.push(`  Connection ${join(s.connectionAfter.duration, s.connectionAfter.airportChange === 'yes' && 'change airport', s.connectionAfter.selfTransfer === 'yes' && 'self-transfer')}`)
          }
        }
        if (option.baggage) lines.push(option.baggage)
      }
      break
    case 'seats': {
      lines.push(join(p.flight, p.aircraft))
      for (const section of p.sections) {
        // Glance version: the free seats per section, not the whole cabin map.
        const free = section.rows.flatMap((row) => row.groups.flat().filter((seat) => seat?.status === 'available').map((seat) => seat!.label))
        lines.push(`${section.name}: ${free.length ? `free ${free.slice(0, 24).join(' ')}${free.length > 24 ? ' …' : ''}` : 'no free seats'}`)
        if (p.recommended?.sectionId === section.id) lines.push(`★ Recommended: ${p.recommended.seatLabel}`)
      }
      break
    }
    case 'booking':
      for (const venue of [p, ...(p.alternatives ?? [])]) {
        lines.push('', join(`● ${venue.name}`, venue.status))
        for (const fact of venue.facts) lines.push(`${fact.label}: ${fact.value}`)
        if (venue.rating) lines.push(join(`Rated ${venue.rating.value}/${venue.rating.scale}`, venue.rating.count !== undefined && `${venue.rating.count} reviews`, venue.rating.sourceLabel))
        for (const note of venue.notes ?? []) lines.push(note)
      }
      break
    case 'chart':
      if (p.yLabel || p.xLabel) lines.push(join(p.yLabel, p.xLabel && `by ${p.xLabel}`))
      for (const series of p.series) lines.push(`${series.label}: ${series.points.map((pt) => `${pt.label} ${pt.value}${p.unit ? ` ${p.unit}` : ''}`).join(', ')}`)
      lines.push('(menu > Show card for the chart)')
      break
    case 'diagram': {
      const label = new Map(p.nodes.map((n) => [n.id, n.label]))
      for (const node of p.nodes) lines.push(join(`● ${node.label}`, node.detail))
      for (const edge of p.edges) lines.push(join(`${label.get(edge.from)} > ${label.get(edge.to)}`, edge.label))
      break
    }
  }
  if (p.sources.length) lines.push('', `Sources: ${p.sources.map((s) => s.label).join(', ')}`)
  return lines.join('\n')
}

// The glasses have one font and no bold: drop markdown markers instead of showing them.
export const plain = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/^(\s*)\*\s+/gm, '$1- ') // "* item" bullets
    .replace(/\*\*|__|`/g, '') // bold, code (also an unclosed ** mid-stream)
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s.,!?;:)]|$)/g, '$1$2') // *italic*
    .replace(/\s?\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}\p{Emoji_Modifier}]*/gu, '') // emoji: not in the glasses font

/** Whether "Show card" has a picture for this presentation. */
export const hasVisual = (p: Presentation) => p.type === 'chart' || p.type === 'image'

/** Draw a chart into a canvas (white on black; the G2 shows it as 4-bit green). */
export function drawChart(p: Extract<Presentation, { type: 'chart' }>, canvas: HTMLCanvasElement) {
  const { width: w, height: h } = canvas
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = ctx.fillStyle = '#fff'
  ctx.font = '11px sans-serif'
  const series = p.series[0]
  const points = series.points
  if (p.chart === 'pie' || p.chart === 'donut') {
    // Slices in alternating brightness, labels listed at the right.
    const total = points.reduce((sum, pt) => sum + Math.max(0, pt.value), 0) || 1
    const r = h / 2 - 6
    let angle = -Math.PI / 2
    points.forEach((pt, i) => {
      const sweep = (Math.max(0, pt.value) / total) * Math.PI * 2
      const level = [255, 150, 90, 200, 120][i % 5]
      ctx.fillStyle = `rgb(${level},${level},${level})`
      ctx.beginPath()
      ctx.moveTo(h / 2, h / 2)
      ctx.arc(h / 2, h / 2, r, angle, angle + sweep)
      ctx.fill()
      angle += sweep
      ctx.fillText(`${pt.label} ${Math.round((pt.value / total) * 100)}%`, h + 4, 14 + i * 13)
    })
    if (p.chart === 'donut') {
      ctx.fillStyle = '#000'
      ctx.beginPath()
      ctx.arc(h / 2, h / 2, r * 0.5, 0, Math.PI * 2)
      ctx.fill()
    }
    return
  }
  const pad = { left: 6, right: 6, top: 6, bottom: 16 }
  const values = p.series.flatMap((s) => s.points.map((pt) => pt.value))
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const y = (v: number) => pad.top + ((max - v) / span) * (h - pad.top - pad.bottom)
  const step = (w - pad.left - pad.right) / points.length
  ctx.fillRect(pad.left, y(0), w - pad.left - pad.right, 1) // zero line
  if (p.chart === 'bar') {
    points.forEach((pt, i) => {
      const top = Math.min(y(pt.value), y(0))
      ctx.fillRect(pad.left + i * step + step * 0.15, top, step * 0.7, Math.max(1, Math.abs(y(pt.value) - y(0))))
    })
  } else {
    p.series.forEach((s, k) => {
      ctx.lineWidth = 2
      ctx.setLineDash(k ? [4, 3] : [])
      ctx.beginPath()
      s.points.forEach((pt, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, pad.left + (i + 0.5) * step, y(pt.value)))
      ctx.stroke()
    })
    ctx.setLineDash([])
  }
  // First and last x labels only: anything denser is unreadable at this size.
  ctx.fillText(points[0].label, pad.left, h - 3)
  const last = points[points.length - 1].label
  ctx.fillText(last, w - pad.right - ctx.measureText(last).width, h - 3)
}
