import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application render failed', error, info.componentStack)
  }
  render() {
    if (this.state.failed)
      return (
        <main role="alert">
          <h1>Something went wrong</h1>
          <p>Reload the app to start a fresh session.</p>
          <button onClick={() => window.location.reload()}>Reload app</button>
        </main>
      )
    return this.props.children
  }
}
