import { useState } from 'react'
import './observatory.css'

export const starsPerConstellation = 5

export const constellations = [
  {
    name: 'Lantern',
    stars: [
      [98, 145],
      [127, 74],
      [182, 58],
      [224, 111],
      [192, 161],
    ],
  },
  {
    name: 'Bridge',
    stars: [
      [72, 151],
      [108, 107],
      [160, 87],
      [209, 105],
      [248, 148],
    ],
  },
  {
    name: 'Compass',
    stars: [
      [160, 44],
      [212, 116],
      [160, 186],
      [109, 118],
      [160, 109],
    ],
  },
  {
    name: 'Crown',
    stars: [
      [87, 144],
      [104, 79],
      [158, 116],
      [210, 75],
      [234, 143],
    ],
  },
]

export function ObservatoryScene({
  entered,
  group,
  revealed,
  lit,
  total,
}: {
  entered: boolean
  group: number
  revealed: number
  lit: ReadonlySet<number>
  total: number
}) {
  const [entrance, setEntrance] = useState(0)
  const constellation = constellations[group]
  const complete = group < revealed

  return (
    <div className="observatory-scene" data-entered={entered}>
      <div className="observatory-art" key={entrance} aria-hidden="true">
        <div className="observatory-exterior" />
        <div className="observatory-interior" />
      </div>
      <div className="observatory-caption">
        <p className="nb-label">
          {entered ? 'Telescope room' : 'Mountain trail'}
        </p>
        <p>
          {lit.size} / {total} stars lit
        </p>
      </div>
      <div className="observatory-sky" aria-hidden="true">
        <svg
          key={`${group}:${complete}`}
          className="observatory-chart"
          data-revealed={complete}
          viewBox="0 0 320 236"
          fill="none"
        >
          <g className="observatory-chart-grid">
            <circle cx="160" cy="118" r="104" />
            <circle cx="160" cy="118" r="87" />
            <circle cx="160" cy="118" r="60" />
            <ellipse cx="160" cy="118" rx="104" ry="37" />
            <path d="M32 118h256M160 5v226M83 41l154 154M237 41L83 195" />
          </g>
          <polyline
            points={constellation.stars
              .map((point) => point.join(','))
              .join(' ')}
          />
          {constellation.stars.map(([x, y], i) => (
            <circle
              key={i}
              className="observatory-star"
              cx={x}
              cy={y}
              r="5"
              data-lit={lit.has(group * starsPerConstellation + i)}
            />
          ))}
        </svg>
      </div>
      <div className="observatory-plate">
        <p className="nb-label">
          {revealed} of {constellations.length} constellations revealed
        </p>
        <h3>{entered ? `The ${constellation.name}` : 'Chart the night sky'}</h3>
        <ol className="observatory-sectors" aria-label="Constellations">
          {constellations.map(({ name }, i) => (
            <li
              key={name}
              data-revealed={i < revealed}
              aria-current={entered && i === group ? 'step' : undefined}
            >
              {name}
            </li>
          ))}
        </ol>
        {entered && (
          <button
            className="btn observatory-replay"
            onClick={() => setEntrance((value) => value + 1)}
          >
            Replay entrance
          </button>
        )}
      </div>
    </div>
  )
}
