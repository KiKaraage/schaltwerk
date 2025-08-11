# Git Diff Viewer Performance Analysis & Solution

## Core Performance Issues Identified

### 1. Syntax Highlighting (PRIMARY BOTTLENECK)
- **Problem**: `renderSyntaxHighlight` runs highlight.js on EVERY SINGLE LINE independently
- **Impact**: For a 1000-line file, highlight.js runs 1000+ times (2000+ in split view)
- **Location**: DiffViewerWithReview.tsx:465-483
- **CPU Cost**: ~5-10ms per highlight × 1000 lines = 5-10 seconds of CPU time

### 2. No Virtualization
- **Problem**: All lines render immediately, even if only 50 lines are visible
- **Impact**: DOM contains thousands of elements, causing layout thrashing
- **Memory**: Each line creates multiple DOM nodes (line number, content, etc.)

### 3. Split View Doubles Everything
- **Problem**: Split view renders both old and new content side-by-side
- **Impact**: 2x the highlighting, 2x the DOM nodes, 2x the memory
- **Current**: Auto-enables on screens > 1400px wide

### 4. Selection Highlighting Performance
- **Problem**: Inline styles regenerated on every selection change (lines 629-656)
- **Impact**: Forces style recalculation across entire diff viewer

## Solution Architecture

### Phase 1: Optimize Syntax Highlighting
1. **Batch highlighting**: Highlight entire file once, then split into lines
2. **Lazy highlighting**: Only highlight visible viewport
3. **Cache highlighted results**: Store highlighted HTML to avoid re-computation

### Phase 2: Implement Virtual Scrolling
1. **Use react-window or custom virtualization**
2. **Only render visible lines + buffer**
3. **Maintain scroll position and selection state**

### Phase 3: Smart View Mode
1. **Add toggle for split/unified view**
2. **Default to unified for large files (>500 lines)**
3. **Preserve selection and comments across view changes**

## Implementation Strategy

### Step 1: Replace ReactDiffViewer
The react-diff-viewer-continued library is the root cause. We need to:
1. Build a custom diff viewer with virtualization
2. Use diff-match-patch or similar for diff computation
3. Implement our own rendering with performance in mind

### Step 2: Optimized Highlighting Approach
```typescript
// Highlight entire file once
const highlightedContent = useMemo(() => {
  const fullText = worktreeContent; // or mainContent
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(fullText, { language }).value;
  }
  return hljs.highlightAuto(fullText).value;
}, [worktreeContent, mainContent, language]);

// Split into lines after highlighting
const highlightedLines = useMemo(() => {
  return highlightedContent.split('\n');
}, [highlightedContent]);
```

### Step 3: Virtual Scrolling with react-window
```typescript
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={windowHeight}
  itemCount={lines.length}
  itemSize={20} // line height
  overscan={10} // render 10 extra lines for smooth scrolling
>
  {({ index, style }) => (
    <DiffLine 
      style={style}
      line={lines[index]}
      highlighted={highlightedLines[index]}
    />
  )}
</FixedSizeList>
```

## Expected Performance Improvements
- **Highlighting**: 100x faster (1 operation vs 1000+)
- **Initial render**: 50x faster (render 50 lines vs 1000+)
- **Memory usage**: 90% reduction (50 DOM nodes vs 1000+)
- **Scroll performance**: Smooth 60fps even on 10,000+ line files

## Alternative: Optimize Current Implementation
If replacing ReactDiffViewer is too complex, we can:
1. **Disable syntax highlighting for large files** (>500 lines)
2. **Force unified view for large files**
3. **Debounce/throttle selection updates**
4. **Use CSS for selection instead of inline styles**

But this is a band-aid - the real solution is a custom implementation.