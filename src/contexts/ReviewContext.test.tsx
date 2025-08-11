import { renderHook, act } from '@testing-library/react'
import { ReviewProvider, useReview } from './ReviewContext'

function wrapper({ children }: { children: React.ReactNode }) {
  return <ReviewProvider>{children}</ReviewProvider>
}

describe('ReviewContext', () => {
  it('starts a review and manages comments (add/update/remove/filter/clear)', () => {
    const { result } = renderHook(() => useReview(), { wrapper })

    // start review
    act(() => {
      result.current.startReview('sess')
    })
    expect(result.current.currentReview?.sessionName).toBe('sess')
    expect(result.current.currentReview?.comments.length).toBe(0)

    // add a comment
    let commentId: string | undefined
    act(() => {
      result.current.addComment({
        filePath: 'a/b/file.ts',
        lineRange: { start: 2, end: 3 },
        side: 'new',
        selectedText: 'line2\nline3',
        comment: 'Looks good'
      })
    })
    expect(result.current.currentReview?.comments.length).toBe(1)
    commentId = result.current.currentReview?.comments[0]?.id
    expect(commentId).toBeTruthy()

    // get comments for file
    const forFile = result.current.getCommentsForFile('a/b/file.ts')
    expect(forFile.length).toBe(1)
    expect(forFile[0].comment).toBe('Looks good')

    // update comment
    act(() => {
      result.current.updateComment(commentId!, 'Please rename variable')
    })
    expect(result.current.currentReview?.comments[0].comment).toBe('Please rename variable')

    // remove comment
    act(() => {
      result.current.removeComment(commentId!)
    })
    expect(result.current.currentReview?.comments.length).toBe(0)

    // clear review
    act(() => {
      result.current.clearReview()
    })
    expect(result.current.currentReview).toBeNull()
  })
})
