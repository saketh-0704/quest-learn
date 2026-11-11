export function Explorer() {
  // Original code-native pixel sprite; scenery is a separate generated asset.
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 32"
      shapeRendering="crispEdges"
      className="explorer-sprite"
    >
      <path fill="#a85636" d="M8 14H3v3H1v9h5v-3h4V14Z" />
      <path fill="#39233a" d="M9 3h10v2h3v8h-3v3h-9v-3H7V6h2Z" />
      <path fill="#f3c69c" d="M10 8h10v6h-2v3h-7v-4H9V9h1Z" />
      <path fill="#39233a" d="M8 5h13v4h-5V7h-3v3H9ZM17 10h2v2h-2Z" />
      <path fill="#f6dfaf" d="M11 14h7v3h-7Z" />
      <path fill="#4d8761" d="M10 17h9v7H9v-5h1Z" />
      <path fill="#a97443" d="M9 21h11v3H9Z" />
      <path fill="#f3c69c" d="M19 17h3v6h-3ZM7 18h3v5H7Z" />
      <g className="explorer-leg-left">
        <path fill="#39304a" d="M10 24h4v5h-2v2H7v-3h3Z" />
        <path fill="#bb8b53" d="M8 28h4v2H8Z" />
      </g>
      <g className="explorer-leg-right">
        <path fill="#39304a" d="M16 24h4v4h3v3h-6v-3h-1Z" />
        <path fill="#bb8b53" d="M18 28h4v2h-4Z" />
      </g>
    </svg>
  )
}
