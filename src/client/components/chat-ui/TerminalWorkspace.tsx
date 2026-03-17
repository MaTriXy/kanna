import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "../ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable"
import type { ProjectTerminalLayout } from "../../stores/terminalLayoutStore"

const MIN_TERMINAL_WIDTH = 250

interface Props {
  projectId: string
  layout: ProjectTerminalLayout
  onAddTerminal: (projectId: string, afterTerminalId?: string) => void
  onRemoveTerminal: (projectId: string, terminalId: string) => void
  onTerminalLayout: (projectId: string, sizes: number[]) => void
}

export function TerminalWorkspace({
  projectId,
  layout,
  onAddTerminal,
  onRemoveTerminal,
  onTerminalLayout,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateWidth = () => {
      setViewportWidth(element.getBoundingClientRect().width)
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    updateWidth()

    return () => observer.disconnect()
  }, [])

  const paneCount = layout.terminals.length
  const requiredWidth = paneCount * MIN_TERMINAL_WIDTH
  const innerWidth = Math.max(viewportWidth, requiredWidth)
  const minSize = innerWidth > 0 ? (MIN_TERMINAL_WIDTH / innerWidth) * 100 : 100
  const panelGroupKey = useMemo(
    () => layout.terminals.map((terminal) => terminal.id).join(":"),
    [layout.terminals]
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div ref={containerRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="h-full min-h-0" style={{ width: innerWidth || "100%" }}>
          <ResizablePanelGroup
            key={panelGroupKey}
            orientation="horizontal"
            className="h-full min-h-0"
            onLayoutChanged={(nextLayout) => onTerminalLayout(
              projectId,
              layout.terminals.map((terminal) => nextLayout[terminal.id] ?? terminal.size)
            )}
          >
            {layout.terminals.map((terminalPane, index) => (
              <Fragment key={terminalPane.id}>
                <ResizablePanel id={terminalPane.id} defaultSize={terminalPane.size} minSize={minSize} className="min-h-0">
                  <div className="flex h-full min-h-0 flex-col border-r border-border bg-background last:border-r-0">
                    <div className="flex items-center gap-2 border-b px-3 pr-2 py-2">
                      <div className="min-w-0 flex-1 truncate text-left text-sm font-medium">{terminalPane.title}</div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Add terminal to the right of ${terminalPane.title}`}
                          onClick={() => onAddTerminal(projectId, terminalPane.id)}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Archive ${terminalPane.title}`}
                          onClick={() => onRemoveTerminal(projectId, terminalPane.id)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col justify-between gap-4 overflow-auto p-4 font-mono text-sm">
                      <div className="text-foreground">{terminalPane.title}</div>
                      <div className="text-muted-foreground">
                        Placeholder terminal process surface for {terminalPane.title}.
                      </div>
                    </div>
                  </div>
                </ResizablePanel>
                {index < layout.terminals.length - 1 ? <ResizableHandle withHandle orientation="horizontal" /> : null}
              </Fragment>
            ))}
          </ResizablePanelGroup>
        </div>
      </div>
    </div>
  )
}
