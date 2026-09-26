export function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 30 30" aria-hidden="true">
      <circle className="brand__mark-field" cx="15" cy="15" r="13.75" />
      <path className="brand__mark-route" d="M6.5 8.5h10c3 0 4.5 1.5 4.5 4.5v10" />
      <path className="brand__mark-route brand__mark-route--secondary" d="M7 22.5l5-5c1.7-1.7 3.2-2.5 5.5-2.5h6" />
      <g className="brand__mark-stations">
        <circle cx="6.5" cy="8.5" r="1.3" />
        <circle cx="14" cy="8.5" r="1.3" />
        <circle cx="21" cy="15" r="1.55" />
        <circle cx="21" cy="23" r="1.3" />
        <circle cx="7" cy="22.5" r="1.3" />
        <circle cx="13" cy="16.7" r="1.3" />
        <circle cx="23.5" cy="15" r="1.3" />
      </g>
    </svg>
  )
}
