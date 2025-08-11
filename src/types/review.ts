export interface ReviewComment {
  id: string
  filePath: string
  lineRange: {
    start: number
    end: number
  }
  side: 'old' | 'new'
  selectedText: string
  comment: string
  timestamp: number
}

export interface ReviewSession {
  comments: ReviewComment[]
  sessionName: string
  createdAt: number
}