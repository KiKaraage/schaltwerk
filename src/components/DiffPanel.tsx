import DiffViewer from 'react-diff-viewer-continued'
import { useSelection } from '../contexts/SelectionContext'

const oldCode = `
pub fn create_session(name: String) -> Result<SessionState> {
    // TODO: implement
}
`

const newCode = `
pub fn create_session(name: String) -> Result<SessionState> {
    let state = SessionState::new(name.clone(), name_to_branch(&name), default_path());
    save_state(&state)?;
    Ok(state)
}
`

export function DiffPanel() {
    const { selection } = useSelection()

    const header = selection.kind === 'orchestrator'
        ? 'Git Diff — orchestrator (main)'
        : `Git Diff — ${selection.payload ?? ''}`

    const mockOld = selection.kind === 'orchestrator' ? oldCode : `// ${selection.payload} old\n` + oldCode
    const mockNew = selection.kind === 'orchestrator' ? newCode : `// ${selection.payload} new\n` + newCode

    const viewerStyles = {
        variables: {
            dark: {
                diffViewerBackground: 'transparent',
                gutterBackground: 'transparent',
                gutterBackgroundDark: 'transparent',
                codeFoldBackground: 'transparent',
            },
        },
    } as const

    return (
        <div className="h-full flex flex-col">
            <div className="rounded border border-slate-800 overflow-hidden h-full m-2">
                <div className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800">{header}</div>
                <div className="h-full overflow-auto diff-wrapper">
                    <DiffViewer
                        oldValue={mockOld}
                        newValue={mockNew}
                        splitView={true}
                        useDarkTheme
                        styles={viewerStyles as any}
                    />
                </div>
            </div>
        </div>
    )
}


