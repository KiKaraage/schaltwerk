import { DiffFileList } from './DiffFileList'

interface SimpleDiffPanelProps {
  onFileSelect: (filePath: string) => void
}

export function SimpleDiffPanel({ onFileSelect }: SimpleDiffPanelProps) {
  return <DiffFileList onFileSelect={onFileSelect} />
}