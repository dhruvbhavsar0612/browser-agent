import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

/** Isolate a single chat row so a render exception cannot freeze the whole panel. */
export class MessageErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    console.warn('[browser-agent] chat message render error', error)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="chat-error" role="alert">
          Could not render this message: {this.state.error.message}
        </div>
      )
    }
    return this.props.children
  }
}
