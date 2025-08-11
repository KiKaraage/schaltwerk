import { createContext, useContext, useState, ReactNode } from 'react'
import { ReviewComment, ReviewSession } from '../types/review'

interface ReviewContextType {
  currentReview: ReviewSession | null
  addComment: (comment: Omit<ReviewComment, 'id' | 'timestamp'>) => void
  removeComment: (id: string) => void
  updateComment: (id: string, text: string) => void
  clearReview: () => void
  startReview: (sessionName: string) => void
  getCommentsForFile: (filePath: string) => ReviewComment[]
}

const ReviewContext = createContext<ReviewContextType | undefined>(undefined)

export function ReviewProvider({ children }: { children: ReactNode }) {
  const [currentReview, setCurrentReview] = useState<ReviewSession | null>(null)

  const startReview = (sessionName: string) => {
    setCurrentReview({
      comments: [],
      sessionName,
      createdAt: Date.now()
    })
  }

  const addComment = (comment: Omit<ReviewComment, 'id' | 'timestamp'>) => {
    if (!currentReview) return

    const newComment: ReviewComment = {
      ...comment,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    }

    setCurrentReview({
      ...currentReview,
      comments: [...currentReview.comments, newComment]
    })
  }

  const removeComment = (id: string) => {
    if (!currentReview) return

    setCurrentReview({
      ...currentReview,
      comments: currentReview.comments.filter(c => c.id !== id)
    })
  }

  const updateComment = (id: string, text: string) => {
    if (!currentReview) return

    setCurrentReview({
      ...currentReview,
      comments: currentReview.comments.map(c => 
        c.id === id ? { ...c, comment: text } : c
      )
    })
  }

  const clearReview = () => {
    setCurrentReview(null)
  }

  const getCommentsForFile = (filePath: string) => {
    if (!currentReview) return []
    return currentReview.comments.filter(c => c.filePath === filePath)
  }

  return (
    <ReviewContext.Provider value={{
      currentReview,
      addComment,
      removeComment,
      updateComment,
      clearReview,
      startReview,
      getCommentsForFile
    }}>
      {children}
    </ReviewContext.Provider>
  )
}

export function useReview() {
  const context = useContext(ReviewContext)
  if (!context) {
    throw new Error('useReview must be used within a ReviewProvider')
  }
  return context
}