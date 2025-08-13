# MCP Safety Improvements Test Plan

## ✅ Changes Made

1. **Enhanced schaltwerk_cancel with safety checks**:
   - Added `force` parameter (optional, defaults to false)
   - Checks for uncommitted changes before proceeding
   - Provides detailed error message with safety options
   - Updated command description with clear warnings

2. **Added schaltwerk_pause as safe alternative**:
   - New command that preserves all work
   - Marks session as 'paused' instead of 'cancelled'
   - Keeps worktree and branch intact
   - Clear description of non-destructive nature

3. **Improved safety infrastructure**:
   - `checkGitStatus()` method for detecting uncommitted changes
   - Support for 'paused' status in Session interface
   - Updated database queries to include paused sessions
   - Better error messages with actionable suggestions

## 🧪 Testing Scenarios

### Scenario 1: Cancel with uncommitted changes (should fail)
```typescript
schaltwerk_cancel(session_name: "test-session")
// Expected: Error with safety check failure, suggesting alternatives
```

### Scenario 2: Cancel with force parameter (should succeed)
```typescript
schaltwerk_cancel(session_name: "test-session", force: true)
// Expected: Success, removes session despite uncommitted changes
```

### Scenario 3: Cancel clean session (should succeed)
```typescript
schaltwerk_cancel(session_name: "clean-session")
// Expected: Success, no uncommitted changes detected
```

### Scenario 4: Pause session (always safe)
```typescript
schaltwerk_pause(session_name: "test-session")
// Expected: Success, session marked as paused, work preserved
```

## 🔒 Safety Features

1. **Pre-cancellation checks**: Git status verification before destructive operations
2. **Force parameter requirement**: Explicit confirmation needed for dangerous operations
3. **Clear error messages**: Detailed guidance on alternatives when safety checks fail
4. **Safer alternatives**: schaltwerk_pause preserves work without deletion
5. **Better documentation**: Updated command descriptions warn about destructive nature

## 📊 Impact

- **Prevents accidental data loss**: Default behavior now protects uncommitted work
- **Better user guidance**: Clear error messages explain options and consequences
- **Reversible operations**: Pause provides safe way to stop work without losing progress
- **Explicit control**: Force parameter gives users clear control over destructive actions