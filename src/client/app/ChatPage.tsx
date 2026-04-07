import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react"
import { ArrowDown, Flower, Upload } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ChatDiffSnapshot, HydratedTranscriptMessage } from "../../shared/types"
import { ChatInput, type ChatInputHandle } from "../components/chat-ui/ChatInput"
import { ChatNavbar } from "../components/chat-ui/ChatNavbar"
import { RightSidebar } from "../components/chat-ui/RightSidebar"
import { TerminalWorkspace } from "../components/chat-ui/TerminalWorkspace"
import { DrainingIndicator } from "../components/messages/DrainingIndicator"
import { ProcessingMessage } from "../components/messages/ProcessingMessage"
import { Card, CardContent } from "../components/ui/card"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable"
import { ScrollArea } from "../components/ui/scroll-area"
import { actionMatchesEvent, getResolvedKeybindings } from "../lib/keybindings"
import { cn } from "../lib/utils"
import { deriveLatestContextWindowSnapshot, type ContextWindowSnapshot } from "../lib/contextWindow"
import {
  DEFAULT_PROJECT_RIGHT_SIDEBAR_LAYOUT,
  RIGHT_SIDEBAR_MIN_SIZE_PERCENT,
  useRightSidebarStore,
} from "../stores/rightSidebarStore"
import { useChatPreferencesStore } from "../stores/chatPreferencesStore"
import { DEFAULT_PROJECT_TERMINAL_LAYOUT, useTerminalLayoutStore } from "../stores/terminalLayoutStore"
import { useTerminalPreferencesStore } from "../stores/terminalPreferencesStore"
import { shouldCloseTerminalPane } from "./terminalLayoutResize"
import { TERMINAL_TOGGLE_ANIMATION_DURATION_MS } from "./terminalToggleAnimation"
import { useRightSidebarToggleAnimation } from "./useRightSidebarToggleAnimation"
import { useTerminalToggleAnimation } from "./useTerminalToggleAnimation"
import type { KannaState } from "./useKannaState"
import { KannaTranscript } from "./KannaTranscript"
import { useStickyChatFocus } from "./useStickyChatFocus"

const EMPTY_STATE_TEXT = "What are we building?"
const EMPTY_STATE_TYPING_INTERVAL_MS = 19
const CHAT_NAVBAR_OFFSET_PX = 72
const SCROLL_BUTTON_BOTTOM_PX = 120
const TRANSCRIPT_TOC_BREAKPOINT_PX = 1200
const DIFF_REFRESH_INTERVAL_MS = 5_000
const EMPTY_DIFF_SNAPSHOT: ChatDiffSnapshot = { status: "unknown", files: [] }

export interface TranscriptTocItem {
  id: string
  label: string
  order: number
}

export function getTranscriptTocLabel(content: string) {
  const firstLine = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return firstLine ?? "(attachment only)"
}

export function createTranscriptTocItems(messages: HydratedTranscriptMessage[]): TranscriptTocItem[] {
  let order = 0

  return messages.flatMap((message) => {
    if (message.kind !== "user_prompt" || message.hidden) {
      return []
    }

    order += 1
    return [{
      id: message.id,
      label: getTranscriptTocLabel(message.content),
      order,
    }]
  })
}

export function shouldShowTranscriptTocPanel(args: {
  enabled: boolean
  chatAreaWidth: number
  itemCount: number
}) {
  return args.enabled && args.chatAreaWidth > TRANSCRIPT_TOC_BREAKPOINT_PX && args.itemCount > 0
}

export function scrollTranscriptMessageIntoView(
  container: Pick<HTMLElement, "getBoundingClientRect" | "scrollTop" | "scrollTo">,
  target: Pick<HTMLElement, "getBoundingClientRect">
) {
  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const top = container.scrollTop + targetRect.top - containerRect.top - CHAT_NAVBAR_OFFSET_PX

  container.scrollTo({
    top: Math.max(0, top),
    behavior: "smooth",
  })
}

function sameContextWindowSnapshot(left: ContextWindowSnapshot | null, right: ContextWindowSnapshot | null) {
  if (left === right) return true
  if (!left || !right) return false
  return left.usedTokens === right.usedTokens
    && left.maxTokens === right.maxTokens
    && left.remainingTokens === right.remainingTokens
    && left.usedPercentage === right.usedPercentage
    && left.remainingPercentage === right.remainingPercentage
    && left.compactsAutomatically === right.compactsAutomatically
    && left.updatedAt === right.updatedAt
}

interface ChatTranscriptViewportProps {
  scrollRef: KannaState["scrollRef"]
  messages: KannaState["messages"]
  transcriptPaddingBottom: number
  localPath: string | null | undefined
  latestToolIds: KannaState["latestToolIds"]
  isProcessing: boolean
  runtimeStatus: string | null
  isDraining: boolean
  commandError: string | null
  onStopDraining: () => void
  onOpenLocalLink: KannaState["handleOpenLocalLink"]
  onAskUserQuestionSubmit: KannaState["handleAskUserQuestion"]
  onExitPlanModeConfirm: KannaState["handleExitPlanMode"]
  chatAreaWidth: number
  showTranscriptToc: boolean
  transcriptTocItems: TranscriptTocItem[]
  showScrollButton: boolean
  onScrollChange: () => void
  scrollToBottom: () => void
  typedEmptyStateText: string
  isEmptyStateTypingComplete: boolean
  isPageFileDragActive: boolean
}

const ChatTranscriptViewport = memo(function ChatTranscriptViewport({
  scrollRef,
  messages,
  transcriptPaddingBottom,
  localPath,
  latestToolIds,
  isProcessing,
  runtimeStatus,
  isDraining,
  commandError,
  onStopDraining,
  onOpenLocalLink,
  onAskUserQuestionSubmit,
  onExitPlanModeConfirm,
  chatAreaWidth,
  showTranscriptToc,
  transcriptTocItems,
  showScrollButton,
  onScrollChange,
  scrollToBottom,
  typedEmptyStateText,
  isEmptyStateTypingComplete,
  isPageFileDragActive,
}: ChatTranscriptViewportProps) {
  const shouldShowTranscriptToc = shouldShowTranscriptTocPanel({
    enabled: showTranscriptToc,
    chatAreaWidth,
    itemCount: transcriptTocItems.length,
  })

  return (
    <>
        <ScrollArea
          ref={scrollRef}
          onScroll={onScrollChange}
          className="flex-1 min-h-0 px-3 scroll-pt-[72px]"
        >
          {messages.length === 0 ? <div style={{ height: transcriptPaddingBottom }} aria-hidden="true" /> : null}
          {messages.length > 0 ? (
            <>
              <div className="animate-fade-in space-y-5 pt-[72px] max-w-[800px] mx-auto">
                <KannaTranscript
                  messages={messages}
                  isLoading={isProcessing}
                  localPath={localPath ?? undefined}
                  latestToolIds={latestToolIds}
                  onOpenLocalLink={onOpenLocalLink}
                  onAskUserQuestionSubmit={onAskUserQuestionSubmit}
                  onExitPlanModeConfirm={onExitPlanModeConfirm}
                />
                {isProcessing ? <ProcessingMessage status={runtimeStatus ?? undefined} /> : null}
                {!isProcessing && isDraining ? (
                  <DrainingIndicator onStop={() => void onStopDraining()} />
                ) : null}
                {commandError ? (
                  <div className="text-sm text-destructive border border-destructive/20 bg-destructive/5 rounded-xl px-4 py-3">
                    {commandError}
                  </div>
                ) : null}
              </div>
              <div style={{ height: 250 }} aria-hidden="true" />
            </>
          ) : null}
        </ScrollArea>

        {shouldShowTranscriptToc ? (
          <div
            className="absolute -mt-1 right-3 border border-border/0 border-[1px] z-20 bottom-0 overflow-y-auto pb-[110px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ top: CHAT_NAVBAR_OFFSET_PX }}
          >
            <div className=" pl-1 backdrop-blur-md" data-testid="transcript-toc">
              <div className="flex flex-col items-end gap-[1px]">
                {transcriptTocItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex max-w-[170px] items-center justify-end gap-1 rounded-xl px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => {
                      const container = scrollRef.current
                      const target = document.getElementById(`msg-${item.id}`)
                      if (!container || !target) {
                        return
                      }

                      scrollTranscriptMessageIntoView(container, target)
                    }}
                    title={item.label}
                  >
                    <span className="min-w-0 truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {messages.length === 0 ? (
          <div
            className="pointer-events-none absolute inset-x-4 animate-fade-in"
            style={{
              top: CHAT_NAVBAR_OFFSET_PX,
              bottom: transcriptPaddingBottom,
            }}
          >
            <div className="mx-auto flex h-full max-w-[800px] items-center justify-center">
              <div className="flex flex-col items-center justify-center text-muted-foreground gap-4 opacity-70">
                <Flower strokeWidth={1.5} className="size-8 text-muted-foreground kanna-empty-state-flower" />
                <div
                  className="text-base font-normal text-muted-foreground text-center max-w-xs flex items-center kanna-empty-state-text"
                  aria-label={EMPTY_STATE_TEXT}
                >
                  <span className="relative inline-grid place-items-start">
                    <span className="invisible col-start-1 row-start-1 whitespace-pre flex items-center">
                      <span>{EMPTY_STATE_TEXT}</span>
                      <span className="kanna-typewriter-cursor-slot" aria-hidden="true" />
                    </span>
                    <span className="col-start-1 row-start-1 whitespace-pre flex items-center">
                      <span>{typedEmptyStateText}</span>
                      <span className="kanna-typewriter-cursor-slot" aria-hidden="true">
                        <span
                          className="kanna-typewriter-cursor"
                          data-typing-complete={isEmptyStateTypingComplete ? "true" : "false"}
                        />
                      </span>
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isPageFileDragActive ? (
          <div className="absolute inset-0 z-30 pointer-events-none">
            <div className="absolute inset-0 backdrop-blur-sm" />
            <div className="absolute inset-6 ">
              <div className="flex h-full items-center justify-center">
                <div className="text-center flex flex-col items-center justify-center gap-3">
                  <Upload className="mx-auto size-14 text-foreground" strokeWidth={1.75} />
                  <div className="text-xl font-medium text-foreground">Drop up to 10 files</div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div
          style={{ bottom: SCROLL_BUTTON_BOTTOM_PX }}
          className={cn(
            "absolute left-1/2 -translate-x-1/2 z-10 transition-all",
            showScrollButton
              ? "scale-100 duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
              : "scale-60 duration-300 ease-out pointer-events-none blur-sm opacity-0"
          )}
        >
          <button
            onClick={scrollToBottom}
            className="flex items-center transition-colors gap-1.5 px-2 bg-white hover:bg-muted border border-border rounded-full aspect-square cursor-pointer text-sm text-primary hover:text-foreground dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100 dark:border-slate-600"
          >
            <ArrowDown className="h-5 w-5" />
          </button>
        </div>
    </>
  )
})

interface ChatInputDockProps {
  inputRef: RefObject<HTMLDivElement | null>
  chatInputRef: RefObject<ChatInputHandle | null>
  chatInputElementRef: RefObject<HTMLTextAreaElement | null>
  activeChatId: string | null
  hasSelectedProject: boolean
  runtimeStatus: string | null
  canCancel: boolean
  projectId: string | null
  activeProvider: "claude" | "codex" | null
  availableProviders: KannaState["availableProviders"]
  contextWindowSnapshot: ContextWindowSnapshot | null
  onSubmit: KannaState["handleSend"]
  onCancel: () => void
}

const ChatInputDock = memo(function ChatInputDock({
  inputRef,
  chatInputRef,
  chatInputElementRef,
  activeChatId,
  hasSelectedProject,
  runtimeStatus,
  canCancel,
  projectId,
  activeProvider,
  availableProviders,
  contextWindowSnapshot,
  onSubmit,
  onCancel,
}: ChatInputDockProps) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
      <div className="bg-gradient-to-t from-background via-background pointer-events-auto" ref={inputRef}>
        <ChatInput
          ref={chatInputRef}
          inputElementRef={chatInputElementRef}
          key={activeChatId ?? "new-chat"}
          onSubmit={onSubmit}
          onCancel={onCancel}
          disabled={!hasSelectedProject || runtimeStatus === "waiting_for_user"}
          canCancel={canCancel}
          chatId={activeChatId}
          projectId={projectId}
          activeProvider={activeProvider}
          availableProviders={availableProviders}
          contextWindowSnapshot={contextWindowSnapshot}
        />
      </div>
    </div>
  )
})

interface TerminalWorkspaceShellProps {
  projectId: string
  fixedTerminalHeight: number
  terminalLayout: ReturnType<typeof useTerminalLayoutStore.getState>["projects"][string]
  addTerminal: ReturnType<typeof useTerminalLayoutStore.getState>["addTerminal"]
  socket: KannaState["socket"]
  connectionStatus: KannaState["connectionStatus"]
  scrollback: number
  minColumnWidth: number
  splitTerminalShortcut?: string[]
  focusRequestVersion: number
  onTerminalCommandSent?: () => void
  onRemoveTerminal: (projectId: string, terminalId: string) => void
  onTerminalLayout: ReturnType<typeof useTerminalLayoutStore.getState>["setTerminalSizes"]
}

const TerminalWorkspaceShell = memo(function TerminalWorkspaceShell({
  projectId,
  fixedTerminalHeight,
  terminalLayout,
  addTerminal,
  socket,
  connectionStatus,
  scrollback,
  minColumnWidth,
  splitTerminalShortcut,
  focusRequestVersion,
  onTerminalCommandSent,
  onRemoveTerminal,
  onTerminalLayout,
}: TerminalWorkspaceShellProps) {
  return (
    <div style={fixedTerminalHeight > 0 ? { height: `${fixedTerminalHeight}px` } : undefined}>
      <TerminalWorkspace
        projectId={projectId}
        layout={terminalLayout}
        onAddTerminal={addTerminal}
        socket={socket}
        connectionStatus={connectionStatus}
        scrollback={scrollback}
        minColumnWidth={minColumnWidth}
        splitTerminalShortcut={splitTerminalShortcut}
        focusRequestVersion={focusRequestVersion}
        onTerminalCommandSent={onTerminalCommandSent}
        onRemoveTerminal={onRemoveTerminal}
        onTerminalLayout={onTerminalLayout}
      />
    </div>
  )
})

export function hasFileDragTypes(types: Iterable<string>) {
  return Array.from(types).includes("Files")
}

function isAbsoluteLocalPath(value: string) {
  return value.startsWith("/")
    || value === "~"
    || value.startsWith("~/")
    || /^[A-Za-z]:[\\/]/u.test(value)
}

function joinProjectRelativePath(projectPath: string, filePath: string) {
  const separator = projectPath.includes("\\") && !projectPath.includes("/") ? "\\" : "/"
  const normalizedProjectPath = projectPath.replace(/[\\/]+$/u, "")
  const normalizedFilePath = filePath.replace(/^[\\/]+/u, "")
  return `${normalizedProjectPath}${separator}${normalizedFilePath}`
}

export function ChatPage() {
  const state = useOutletContext<KannaState>()
  const layoutRootRef = useRef<HTMLDivElement>(null)
  const chatCardRef = useRef<HTMLDivElement>(null)
  const chatInputElementRef = useRef<HTMLTextAreaElement>(null)
  const chatInputRef = useRef<ChatInputHandle | null>(null)
  const [typedEmptyStateText, setTypedEmptyStateText] = useState("")
  const [isEmptyStateTypingComplete, setIsEmptyStateTypingComplete] = useState(false)
  const [fixedTerminalHeight, setFixedTerminalHeight] = useState(0)
  const [isPageFileDragActive, setIsPageFileDragActive] = useState(false)
  const [chatAreaWidth, setChatAreaWidth] = useState(0)
  const [diffRenderMode, setDiffRenderMode] = useState<"unified" | "split">("unified")
  const [wrapDiffLines, setWrapDiffLines] = useState(false)
  const pageFileDragDepthRef = useRef(0)
  const terminalDiffRefreshTimeoutRef = useRef<number | null>(null)
  const wasProcessingRef = useRef(false)
  const activeChatIdRef = useRef<string | null>(state.activeChatId)
  const projectPathRef = useRef<string | null>(state.runtime?.localPath ?? state.navbarLocalPath ?? null)
  const projectId = state.activeProjectId
  const projectTerminalLayout = useTerminalLayoutStore((store) => (projectId ? store.projects[projectId] : undefined))
  const terminalLayout = projectTerminalLayout ?? DEFAULT_PROJECT_TERMINAL_LAYOUT
  const projectRightSidebarLayout = useRightSidebarStore((store) => (projectId ? store.projects[projectId] : undefined))
  const rightSidebarLayout = projectRightSidebarLayout ?? DEFAULT_PROJECT_RIGHT_SIDEBAR_LAYOUT
  const addTerminal = useTerminalLayoutStore((store) => store.addTerminal)
  const removeTerminal = useTerminalLayoutStore((store) => store.removeTerminal)
  const toggleVisibility = useTerminalLayoutStore((store) => store.toggleVisibility)
  const resetMainSizes = useTerminalLayoutStore((store) => store.resetMainSizes)
  const setMainSizes = useTerminalLayoutStore((store) => store.setMainSizes)
  const setTerminalSizes = useTerminalLayoutStore((store) => store.setTerminalSizes)
  const toggleRightSidebar = useRightSidebarStore((store) => store.toggleVisibility)
  const setRightSidebarSize = useRightSidebarStore((store) => store.setSize)
  const scrollback = useTerminalPreferencesStore((store) => store.scrollbackLines)
  const minColumnWidth = useTerminalPreferencesStore((store) => store.minColumnWidth)
  const showTranscriptToc = useChatPreferencesStore((store) => store.showTranscriptToc)
  const keybindings = state.keybindings
  const resolvedKeybindings = useMemo(() => getResolvedKeybindings(keybindings), [keybindings])
  const transcriptTocItems = useMemo(() => createTranscriptTocItems(state.messages), [state.messages])
  const baseContextWindowSnapshotRef = useRef<ContextWindowSnapshot | null>(null)
  const contextWindowSnapshot = useMemo(() => {
    const derivedSnapshot = deriveLatestContextWindowSnapshot(state.chatSnapshot?.messages ?? [])
    const previousSnapshot = baseContextWindowSnapshotRef.current
    if (sameContextWindowSnapshot(previousSnapshot, derivedSnapshot)) {
      return previousSnapshot
    }
    baseContextWindowSnapshotRef.current = derivedSnapshot
    return derivedSnapshot
  }, [state.chatSnapshot?.messages])

  const hasTerminals = terminalLayout.terminals.length > 0
  const showTerminalPane = Boolean(projectId && terminalLayout.isVisible && hasTerminals)
  const shouldRenderTerminalLayout = Boolean(projectId && hasTerminals)
  const showRightSidebar = Boolean(projectId && rightSidebarLayout.isVisible)
  const shouldRenderRightSidebarLayout = Boolean(projectId)

  const {
    isAnimating: isTerminalAnimating,
    mainPanelGroupRef,
    terminalFocusRequestVersion,
    terminalPanelRef,
    terminalVisualRef,
  } = useTerminalToggleAnimation({
    showTerminalPane,
    shouldRenderTerminalLayout,
    projectId,
    terminalLayout,
    chatInputRef: chatInputElementRef,
  })
  const {
    isAnimating: isRightSidebarAnimating,
    panelGroupRef: rightSidebarPanelGroupRef,
    sidebarPanelRef,
    sidebarVisualRef,
  } = useRightSidebarToggleAnimation({
    projectId,
    shouldRenderRightSidebarLayout,
    showRightSidebar,
    rightSidebarSize: rightSidebarLayout.size,
  })

  useStickyChatFocus({
    rootRef: chatCardRef,
    fallbackRef: chatInputElementRef,
    enabled: state.hasSelectedProject && state.runtime?.status !== "waiting_for_user",
    canCancel: state.canCancel,
  })

  useEffect(() => {
    activeChatIdRef.current = state.activeChatId
  }, [state.activeChatId])

  useEffect(() => {
    projectPathRef.current = state.runtime?.localPath ?? state.navbarLocalPath ?? null
  }, [state.navbarLocalPath, state.runtime?.localPath])

  const refreshDiffs = useCallback(() => {
    const chatId = activeChatIdRef.current
    if (!chatId || !showRightSidebar) {
      return
    }
    void state.socket.command({ type: "chat.refreshDiffs", chatId }).catch(() => {})
  }, [showRightSidebar, state.socket])

  const scheduleTerminalDiffRefresh = useCallback(() => {
    if (!activeChatIdRef.current || !showRightSidebar) {
      return
    }
    if (terminalDiffRefreshTimeoutRef.current !== null) {
      window.clearTimeout(terminalDiffRefreshTimeoutRef.current)
    }
    terminalDiffRefreshTimeoutRef.current = window.setTimeout(() => {
      terminalDiffRefreshTimeoutRef.current = null
      refreshDiffs()
    }, 1_000)
  }, [refreshDiffs, showRightSidebar])

  const handleOpenDiffFile = useCallback((filePath: string) => {
    const projectPath = projectPathRef.current
    const resolvedPath = !projectPath || isAbsoluteLocalPath(filePath)
      ? filePath
      : joinProjectRelativePath(projectPath, filePath)
    void state.handleOpenLocalLink({ path: resolvedPath })
  }, [state.handleOpenLocalLink])

  const handleCommitDiffs = useCallback(async (args: { paths: string[]; summary: string; description: string }) => {
    const chatId = activeChatIdRef.current
    if (!chatId) {
      return
    }
    await state.socket.command({
      type: "chat.commitDiffs",
      chatId,
      paths: args.paths,
      summary: args.summary,
      description: args.description,
    })
    refreshDiffs()
  }, [refreshDiffs, state.socket])

  const handleGenerateCommitMessage = useCallback(async (args: { paths: string[] }) => {
    const chatId = activeChatIdRef.current
    if (!chatId) {
      return { subject: "", body: "" }
    }

    const result = await state.socket.command<{ subject: string; body: string }>({
      type: "chat.generateCommitMessage",
      chatId,
      paths: args.paths,
    })

    return {
      subject: result.subject,
      body: result.body,
    }
  }, [state.socket])

  const handleCloseRightSidebar = useCallback(() => {
    if (!projectId) return
    toggleRightSidebar(projectId)
  }, [projectId, toggleRightSidebar])
  const handleToggleRightSidebar = useCallback(() => {
    if (!projectId) return
    toggleRightSidebar(projectId)
  }, [projectId, toggleRightSidebar])
  const handleCancel = useCallback(() => {
    void state.handleCancel()
  }, [state.handleCancel])
  const handleOpenExternal = useCallback((action: "open_finder" | "open_editor" | "open_terminal") => {
    void state.handleOpenExternal(action)
  }, [state.handleOpenExternal])
  const handleRemoveTerminal = useCallback((currentProjectId: string, terminalId: string) => {
    void state.socket.command({ type: "terminal.close", terminalId }).catch(() => {})
    removeTerminal(currentProjectId, terminalId)
  }, [removeTerminal, state.socket])

  function hasDraggedFiles(event: React.DragEvent) {
    return hasFileDragTypes(event.dataTransfer?.types ?? [])
  }

  function enqueueDroppedFiles(files: File[]) {
    if (!state.hasSelectedProject || files.length === 0) {
      return
    }
    chatInputRef.current?.enqueueFiles(files)
  }

  const handleToggleEmbeddedTerminal = () => {
    if (!projectId) return
    if (hasTerminals) {
      toggleVisibility(projectId)
      return
    }

    addTerminal(projectId)
  }

  const handleTerminalResize = (layout: Record<string, number>) => {
    if (!projectId || !showTerminalPane || isTerminalAnimating.current) {
      return
    }

    const chatSize = layout.chat
    const terminalSize = layout.terminal
    if (!Number.isFinite(chatSize) || !Number.isFinite(terminalSize)) {
      return
    }

    const containerHeight = layoutRootRef.current?.getBoundingClientRect().height ?? 0
    if (shouldCloseTerminalPane(containerHeight, terminalSize)) {
      resetMainSizes(projectId)
      toggleVisibility(projectId)
      return
    }

    setMainSizes(projectId, [chatSize, terminalSize])
  }

  useEffect(() => {
    if (state.messages.length !== 0) return

    setTypedEmptyStateText("")
    setIsEmptyStateTypingComplete(false)

    let characterIndex = 0
    const interval = window.setInterval(() => {
      characterIndex += 1
      setTypedEmptyStateText(EMPTY_STATE_TEXT.slice(0, characterIndex))

      if (characterIndex >= EMPTY_STATE_TEXT.length) {
        window.clearInterval(interval)
        setIsEmptyStateTypingComplete(true)
      }
    }, EMPTY_STATE_TYPING_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [state.activeChatId, state.messages.length])

  useEffect(() => {
    function handleGlobalKeydown(event: KeyboardEvent) {
      if (!projectId) return
      if (actionMatchesEvent(resolvedKeybindings, "toggleEmbeddedTerminal", event)) {
        event.preventDefault()
        handleToggleEmbeddedTerminal()
        return
      }

      if (actionMatchesEvent(resolvedKeybindings, "toggleRightSidebar", event)) {
        event.preventDefault()
        toggleRightSidebar(projectId)
        return
      }

      if (actionMatchesEvent(resolvedKeybindings, "openInFinder", event)) {
        event.preventDefault()
        void state.handleOpenExternal("open_finder")
        return
      }

      if (actionMatchesEvent(resolvedKeybindings, "openInEditor", event)) {
        event.preventDefault()
        void state.handleOpenExternal("open_editor")
        return
      }

      if (actionMatchesEvent(resolvedKeybindings, "addSplitTerminal", event)) {
        event.preventDefault()
        addTerminal(projectId)
      }
    }

    window.addEventListener("keydown", handleGlobalKeydown)
    return () => window.removeEventListener("keydown", handleGlobalKeydown)
  }, [addTerminal, handleToggleEmbeddedTerminal, projectId, resolvedKeybindings, toggleRightSidebar, toggleVisibility])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      state.updateScrollState()
    })
    const timeoutId = window.setTimeout(() => {
      state.updateScrollState()
    }, TERMINAL_TOGGLE_ANIMATION_DURATION_MS)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [shouldRenderTerminalLayout, showTerminalPane, state.updateScrollState])

  useEffect(() => {
    function handleResize() {
      state.updateScrollState()
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [state.updateScrollState])

  useEffect(() => {
    if (!projectId || !showRightSidebar) {
      return
    }

    const intervalId = window.setInterval(() => {
      refreshDiffs()
    }, DIFF_REFRESH_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [projectId, refreshDiffs, showRightSidebar])

  useEffect(() => {
    if (!projectId || !showRightSidebar) {
      return
    }

    refreshDiffs()
  }, [projectId, refreshDiffs, showRightSidebar])

  useEffect(() => {
    if (!projectId || !showRightSidebar) {
      return
    }

    function handleDiffRefresh() {
      if (document.visibilityState !== "visible") return
      refreshDiffs()
    }

    window.addEventListener("focus", handleDiffRefresh)
    document.addEventListener("visibilitychange", handleDiffRefresh)

    return () => {
      window.removeEventListener("focus", handleDiffRefresh)
      document.removeEventListener("visibilitychange", handleDiffRefresh)
    }
  }, [projectId, refreshDiffs, showRightSidebar])

  useEffect(() => {
    if (showRightSidebar && wasProcessingRef.current && !state.isProcessing) {
      refreshDiffs()
    }
    wasProcessingRef.current = state.isProcessing
  }, [projectId, refreshDiffs, showRightSidebar, state.isProcessing])

  useEffect(() => {
    return () => {
      if (terminalDiffRefreshTimeoutRef.current !== null) {
        window.clearTimeout(terminalDiffRefreshTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (showRightSidebar) {
      return
    }
    if (terminalDiffRefreshTimeoutRef.current !== null) {
      window.clearTimeout(terminalDiffRefreshTimeoutRef.current)
      terminalDiffRefreshTimeoutRef.current = null
    }
  }, [projectId, showRightSidebar])

  useEffect(() => {
    const element = layoutRootRef.current
    if (!element) return

    const updateHeight = () => {
      const containerHeight = element.getBoundingClientRect().height

      if (!shouldRenderTerminalLayout) {
        return
      }

      if (containerHeight <= 0) return
      const nextHeight = containerHeight * (terminalLayout.mainSizes[1] / 100)
      if (nextHeight <= 0) return
      setFixedTerminalHeight((current) => (Math.abs(current - nextHeight) < 1 ? current : nextHeight))
    }

    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)
    updateHeight()

    return () => observer.disconnect()
  }, [projectId, shouldRenderTerminalLayout, terminalLayout.mainSizes])

  useEffect(() => {
    const element = chatCardRef.current
    if (!element) return

    const updateWidth = () => {
      const nextWidth = element.getBoundingClientRect().width
      setChatAreaWidth((current) => (Math.abs(current - nextWidth) < 1 ? current : nextWidth))
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    updateWidth()

    return () => observer.disconnect()
  }, [projectId, showRightSidebar, showTerminalPane, shouldRenderTerminalLayout, shouldRenderRightSidebarLayout])

  const clampRightSidebarSize = (size: number) => {
    if (!Number.isFinite(size)) {
      return rightSidebarLayout.size
    }

    return Math.max(RIGHT_SIDEBAR_MIN_SIZE_PERCENT, size)
  }

  const handleTranscriptDragEnter = useCallback((event: React.DragEvent) => {
    if (!hasDraggedFiles(event) || !state.hasSelectedProject) return
    event.preventDefault()
    pageFileDragDepthRef.current += 1
    setIsPageFileDragActive(true)
  }, [state.hasSelectedProject])

  const handleTranscriptDragOver = useCallback((event: React.DragEvent) => {
    if (!hasDraggedFiles(event) || !state.hasSelectedProject) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    if (!isPageFileDragActive) {
      setIsPageFileDragActive(true)
    }
  }, [isPageFileDragActive, state.hasSelectedProject])

  const handleTranscriptDragLeave = useCallback((event: React.DragEvent) => {
    if (!hasDraggedFiles(event) || !state.hasSelectedProject) return
    event.preventDefault()
    pageFileDragDepthRef.current = Math.max(0, pageFileDragDepthRef.current - 1)
    if (pageFileDragDepthRef.current === 0) {
      setIsPageFileDragActive(false)
    }
  }, [state.hasSelectedProject])

  const handleTranscriptDrop = useCallback((event: React.DragEvent) => {
    if (!hasDraggedFiles(event) || !state.hasSelectedProject) return
    event.preventDefault()
    pageFileDragDepthRef.current = 0
    setIsPageFileDragActive(false)
    enqueueDroppedFiles([...event.dataTransfer.files])
  }, [state.hasSelectedProject])

  const chatCard = (
    <Card
      ref={chatCardRef}
      className="bg-background h-full flex flex-col overflow-hidden border-0 rounded-none relative"
      onDragEnter={handleTranscriptDragEnter}
      onDragOver={handleTranscriptDragOver}
      onDragLeave={handleTranscriptDragLeave}
      onDrop={handleTranscriptDrop}
    >
      <CardContent className="flex flex-1 min-h-0 flex-col p-0 overflow-hidden relative">
        <ChatNavbar
          sidebarCollapsed={state.sidebarCollapsed}
          onOpenSidebar={state.openSidebar}
          onExpandSidebar={state.expandSidebar}
          onNewChat={state.handleCompose}
          localPath={state.navbarLocalPath}
          embeddedTerminalVisible={showTerminalPane}
          onToggleEmbeddedTerminal={projectId ? handleToggleEmbeddedTerminal : undefined}
          rightSidebarVisible={showRightSidebar}
          onToggleRightSidebar={projectId ? handleToggleRightSidebar : undefined}
          onOpenExternal={handleOpenExternal}
          editorLabel={state.editorLabel}
          finderShortcut={resolvedKeybindings.bindings.openInFinder}
          editorShortcut={resolvedKeybindings.bindings.openInEditor}
          terminalShortcut={resolvedKeybindings.bindings.toggleEmbeddedTerminal}
          rightSidebarShortcut={resolvedKeybindings.bindings.toggleRightSidebar}
        />
        <ChatTranscriptViewport
          scrollRef={state.scrollRef}
          messages={state.messages}
          transcriptPaddingBottom={state.transcriptPaddingBottom}
          localPath={state.runtime?.localPath}
          latestToolIds={state.latestToolIds}
          isProcessing={state.isProcessing}
          runtimeStatus={state.runtime?.status ?? null}
          isDraining={state.isDraining}
          commandError={state.commandError}
          onStopDraining={state.handleStopDraining}
          onOpenLocalLink={state.handleOpenLocalLink}
          onAskUserQuestionSubmit={state.handleAskUserQuestion}
          onExitPlanModeConfirm={state.handleExitPlanMode}
          chatAreaWidth={chatAreaWidth}
          showTranscriptToc={showTranscriptToc}
          transcriptTocItems={transcriptTocItems}
          showScrollButton={state.showScrollButton}
          onScrollChange={state.updateScrollState}
          scrollToBottom={state.scrollToBottom}
          typedEmptyStateText={typedEmptyStateText}
          isEmptyStateTypingComplete={isEmptyStateTypingComplete}
          isPageFileDragActive={isPageFileDragActive}
        />
      </CardContent>

      <ChatInputDock
        inputRef={state.inputRef}
        chatInputRef={chatInputRef}
        chatInputElementRef={chatInputElementRef}
        activeChatId={state.activeChatId}
        hasSelectedProject={state.hasSelectedProject}
        runtimeStatus={state.runtime?.status ?? null}
        canCancel={state.canCancel}
        projectId={projectId}
        activeProvider={state.runtime?.provider ?? null}
        availableProviders={state.availableProviders}
        contextWindowSnapshot={contextWindowSnapshot}
        onSubmit={state.handleSend}
        onCancel={handleCancel}
      />
    </Card>
  )

  return (
    <div ref={layoutRootRef} className="flex-1 flex flex-col min-w-0 relative">
      {shouldRenderRightSidebarLayout && projectId ? (
        <ResizablePanelGroup
          key={`${projectId}-right-sidebar`}
          groupRef={rightSidebarPanelGroupRef}
          orientation="horizontal"
          className="flex-1 min-h-0"
          onLayoutChange={(layout) => {
            if (!showRightSidebar || isRightSidebarAnimating.current) {
              return
            }

            const clampedRightSidebarSize = clampRightSidebarSize(layout.rightSidebar)
            if (Math.abs(clampedRightSidebarSize - layout.rightSidebar) < 0.1) {
              return
            }

            rightSidebarPanelGroupRef.current?.setLayout({
              workspace: 100 - clampedRightSidebarSize,
              rightSidebar: clampedRightSidebarSize,
            })
          }}
          onLayoutChanged={(layout) => {
            if (!showRightSidebar || isRightSidebarAnimating.current) {
              return
            }

            setRightSidebarSize(projectId, clampRightSidebarSize(layout.rightSidebar))
          }}
        >
          <ResizablePanel
            id="workspace"
            defaultSize={`${100 - rightSidebarLayout.size}%`}
            minSize="20%"
            className="min-h-0 min-w-0"
          >
            {shouldRenderTerminalLayout ? (
              <ResizablePanelGroup
                key={projectId}
                groupRef={mainPanelGroupRef}
                orientation="vertical"
                className="flex-1 min-h-0"
                onLayoutChanged={handleTerminalResize}
              >
                <ResizablePanel id="chat" defaultSize={`${terminalLayout.mainSizes[0]}%`} minSize="25%" className="min-h-0">
                  {chatCard}
                </ResizablePanel>
                <ResizableHandle
                  withHandle
                  orientation="vertical"
                  disabled={!showTerminalPane}
                  className={cn(!showTerminalPane && "pointer-events-none opacity-0")}
                />
                <ResizablePanel
                  id="terminal"
                  defaultSize={`${terminalLayout.mainSizes[1]}%`}
                  minSize="0%"
                  className="min-h-0"
                  elementRef={terminalPanelRef}
                >
                  <div
                    ref={terminalVisualRef}
                    className="h-full min-h-0 overflow-hidden relative"
                    data-terminal-open={showTerminalPane ? "true" : "false"}
                    data-terminal-animated="false"
                    data-terminal-visual
                    style={{
                      "--terminal-toggle-duration": `${TERMINAL_TOGGLE_ANIMATION_DURATION_MS}ms`,
                    } as CSSProperties}
                  >
                    <div style={fixedTerminalHeight > 0 ? { height: `${fixedTerminalHeight}px` } : undefined}>
                      <TerminalWorkspaceShell
                        projectId={projectId}
                        fixedTerminalHeight={fixedTerminalHeight}
                        terminalLayout={terminalLayout}
                        addTerminal={addTerminal}
                        socket={state.socket}
                        connectionStatus={state.connectionStatus}
                        scrollback={scrollback}
                        minColumnWidth={minColumnWidth}
                        splitTerminalShortcut={resolvedKeybindings.bindings.addSplitTerminal}
                        focusRequestVersion={terminalFocusRequestVersion}
                        onTerminalCommandSent={scheduleTerminalDiffRefresh}
                        onRemoveTerminal={handleRemoveTerminal}
                        onTerminalLayout={setTerminalSizes}
                      />
                    </div>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              chatCard
            )}
          </ResizablePanel>
          <ResizableHandle
            withHandle={false}
            orientation="horizontal"
            disabled={!showRightSidebar}
            className={cn(!showRightSidebar && "pointer-events-none opacity-0")}
          />
          <ResizablePanel
            id="rightSidebar"
            defaultSize={`${rightSidebarLayout.size}%`}
            className="min-h-0 min-w-0"
            elementRef={sidebarPanelRef}
          >
            <div
              ref={sidebarVisualRef}
              className="h-full min-h-0 overflow-hidden"
              data-right-sidebar-open={showRightSidebar ? "true" : "false"}
              data-right-sidebar-animated="false"
              data-right-sidebar-visual
              style={{
                "--terminal-toggle-duration": `${TERMINAL_TOGGLE_ANIMATION_DURATION_MS}ms`,
              } as CSSProperties}
            >
              <RightSidebar
                projectId={projectId}
                diffs={state.chatDiffSnapshot ?? EMPTY_DIFF_SNAPSHOT}
                diffRenderMode={diffRenderMode}
                wrapLines={wrapDiffLines}
                onOpenFile={handleOpenDiffFile}
                onGenerateCommitMessage={handleGenerateCommitMessage}
                onCommit={handleCommitDiffs}
                onDiffRenderModeChange={setDiffRenderMode}
                onWrapLinesChange={setWrapDiffLines}
                onClose={handleCloseRightSidebar}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : shouldRenderTerminalLayout && projectId ? (
        <ResizablePanelGroup
          key={projectId}
          groupRef={mainPanelGroupRef}
          orientation="vertical"
          className="flex-1 min-h-0"
          onLayoutChanged={handleTerminalResize}
        >
          <ResizablePanel id="chat" defaultSize={`${terminalLayout.mainSizes[0]}%`} minSize="25%" className="min-h-0">
            {chatCard}
          </ResizablePanel>
          <ResizableHandle
            withHandle
            orientation="vertical"
            disabled={!showTerminalPane}
            className={cn(!showTerminalPane && "pointer-events-none opacity-0")}
          />
          <ResizablePanel
            id="terminal"
            defaultSize={`${terminalLayout.mainSizes[1]}%`}
            minSize="0%"
            className="min-h-0"
            elementRef={terminalPanelRef}
          >
            <div
              ref={terminalVisualRef}
              className="h-full min-h-0 overflow-hidden relative"
              data-terminal-open={showTerminalPane ? "true" : "false"}
              data-terminal-animated="false"
              data-terminal-visual
              style={{
                "--terminal-toggle-duration": `${TERMINAL_TOGGLE_ANIMATION_DURATION_MS}ms`,
              } as CSSProperties}
            >
              <TerminalWorkspaceShell
                projectId={projectId}
                fixedTerminalHeight={fixedTerminalHeight}
                terminalLayout={terminalLayout}
                addTerminal={addTerminal}
                socket={state.socket}
                connectionStatus={state.connectionStatus}
                scrollback={scrollback}
                minColumnWidth={minColumnWidth}
                splitTerminalShortcut={resolvedKeybindings.bindings.addSplitTerminal}
                focusRequestVersion={terminalFocusRequestVersion}
                onTerminalCommandSent={scheduleTerminalDiffRefresh}
                onRemoveTerminal={handleRemoveTerminal}
                onTerminalLayout={setTerminalSizes}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        chatCard
      )}

    </div>
  )
}
