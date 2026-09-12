import type { ReactNode } from 'react'

type SettingsViewProps = {
  children: ReactNode
  hidden: boolean
}

function SettingsViewSection({
  children,
  description,
  hidden,
  id,
  title,
}: SettingsViewProps & {
  description: string
  id: string
  title: string
}) {
  const headingId = `${id}-heading`

  return (
    <section className="settings-section" id={id} hidden={hidden} aria-labelledby={headingId}>
      <div className="settings-section-heading">
        <h2 id={headingId}>{title}</h2>
        <p className="settings-section-desc">{description}</p>
      </div>
      {children}
    </section>
  )
}

export function ProvidersSettingsView(props: SettingsViewProps) {
  return (
    <SettingsViewSection
      {...props}
      id="providers"
      title="Providers"
      description="Connect API keys or OAuth accounts, then discover and enable models."
    />
  )
}

export function ConnectorsSettingsView(props: SettingsViewProps) {
  return (
    <SettingsViewSection
      {...props}
      id="connectors"
      title="Connectors"
      description="Model Context Protocol servers extend the agent with external tools."
    />
  )
}

export function AgentSettingsView(props: SettingsViewProps) {
  return (
    <SettingsViewSection
      {...props}
      id="agent"
      title="Agent"
      description="Context compaction controls how the agent summarises long conversations to stay within the model's context window."
    />
  )
}

export function PermissionsSettingsView(props: SettingsViewProps) {
  return (
    <section
      className="settings-section"
      id="permissions"
      hidden={props.hidden}
      aria-labelledby="permissions-heading"
    >
      {props.children}
    </section>
  )
}

export function DeveloperSettingsView({ hidden }: { hidden: boolean }) {
  return (
    <SettingsViewSection
      hidden={hidden}
      id="developer"
      title="Developer"
      description="Advanced settings appear here as they become available."
    >
      <p className="settings-hint">
        Developer controls are kept separate from everyday provider and connector setup.
      </p>
    </SettingsViewSection>
  )
}
