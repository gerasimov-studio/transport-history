import type { Locale } from './i18n'
import { canonicalGauge, type NodeKind, type TrackForm, type TrackGrade, type TransportMode, type TransportWay } from './types'

const labels = {
  en: {
    mode: { metro: 'Metro', tram: 'Tram', trolleybus: 'Trolleybus', bus: 'Bus' },
    way: { rail: 'Rail', road: 'Road' },
    grade: { surface: 'Surface', tunnel: 'Tunnel' },
    trackRail: { double: 'Double track', single_oneway: 'Single track, one way', single_both: 'Single track, both ways' },
    trackRoad: { double: 'Two-way street', single_oneway: 'One-way street', single_both: 'Both directions' },
    node: { junction: 'Junction / passing loop', terminus: 'Terminus', portal: 'Tunnel portal', loop: 'Turning loop', wye: 'Wye', crossover: 'Crossover' },
    gauge: { 1520: '1520 mm · broad gauge', 1435: '1435 mm · standard gauge', 1000: '1000 mm · metre gauge' },
    ground: 'ground', level: 'level', from: 'from', present: 'present',
  },
  sr: {
    mode: { metro: 'Metro', tram: 'Tramvaj', trolleybus: 'Trolejbus', bus: 'Autobus' },
    way: { rail: 'Šinski', road: 'Drumski' },
    grade: { surface: 'Na površini', tunnel: 'Tunel' },
    trackRail: { double: 'Dvokolosečna', single_oneway: 'Jednokolosečna, jednosmerna', single_both: 'Jednokolosečna, dvosmerna' },
    trackRoad: { double: 'Dvosmerna ulica', single_oneway: 'Jednosmerna ulica', single_both: 'Oba smera' },
    node: { junction: 'Čvor / mimoilaznica', terminus: 'Okretnica', portal: 'Portal tunela', loop: 'Okretna petlja', wye: 'Okretni trougao', crossover: 'Skretnica' },
    gauge: { 1520: '1520 mm · široki kolosek', 1435: '1435 mm · standardni kolosek', 1000: '1000 mm · metarski kolosek' },
    ground: 'površina', level: 'nivo', from: 'od', present: 'danas',
  },
  ru: {
    mode: { metro: 'Метро', tram: 'Трамвай', trolleybus: 'Троллейбус', bus: 'Автобус' },
    way: { rail: 'Рельсовый', road: 'Дорожный' },
    grade: { surface: 'На земле', tunnel: 'Тоннель' },
    trackRail: { double: 'Двухпутная', single_oneway: 'Однопутная, в одну сторону', single_both: 'Однопутная, в обе стороны' },
    trackRoad: { double: 'Двусторонняя улица', single_oneway: 'Односторонняя улица', single_both: 'Оба направления' },
    node: { junction: 'Узел / разъезд', terminus: 'Конечная', portal: 'Выход на поверхность', loop: 'Оборотное кольцо', wye: 'Треугольник', crossover: 'Съезд' },
    gauge: { 1520: '1520 мм · русская', 1435: '1435 мм · европейская', 1000: '1000 мм · метровая' },
    ground: 'земля', level: 'ярус', from: 'с', present: 'н.в.',
  },
} as const

export const domain = {
  mode: (locale: Locale, value: TransportMode) => labels[locale].mode[value],
  way: (locale: Locale, value: TransportWay) => labels[locale].way[value],
  grade: (locale: Locale, value: TrackGrade) => labels[locale].grade[value],
  level: (locale: Locale, value: number) => value === 0 ? labels[locale].ground : `${labels[locale].level} ${value}`,
  gauge: (locale: Locale, value: number) => labels[locale].gauge[canonicalGauge(value) as keyof typeof labels.en.gauge] ?? `${canonicalGauge(value)} mm`,
  trackForm: (locale: Locale, value: TrackForm, way: TransportWay = 'rail') => (way === 'road' ? labels[locale].trackRoad : labels[locale].trackRail)[value],
  node: (locale: Locale, value: NodeKind) => labels[locale].node[value],
  validity: (locale: Locale, since?: string, until?: string) => {
    if (!since) return ''
    const from = since.slice(0, 4)
    if (!until) return `${labels[locale].from} ${from} — ${labels[locale].present}`
    const to = until.slice(0, 4)
    return from === to ? from : `${from}–${to}`
  },
}
