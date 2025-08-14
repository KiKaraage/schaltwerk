import sqlite3 from 'sqlite3'
import { open, Database } from 'sqlite'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { execSync } from 'child_process'
import fetch from 'node-fetch'

export interface Session {
  id: string
  name: string
  display_name?: string
  repository_path: string
  repository_name: string
  branch: string
  parent_branch: string
  worktree_path: string
  status: 'active' | 'cancelled' | 'paused' | 'draft'
  session_state?: 'Draft' | 'Running' | 'Reviewed'
  created_at: number
  updated_at: number
  last_activity?: number
  initial_prompt?: string
  draft_content?: string
  ready_to_merge: boolean
  original_agent_type?: string
  original_skip_permissions?: boolean
  pending_name_generation: boolean
  was_auto_generated: boolean
}

export interface GitStats {
  session_id: string
  files_changed: number
  lines_added: number
  lines_removed: number
  has_uncommitted: boolean
  calculated_at: number
}

interface GitStatusResult {
  hasUncommittedChanges: boolean
  modifiedFiles: number
  untrackedFiles: number
  stagedFiles: number
  changedFiles: string[]
}

export class SchaltwerkBridge {
  private dbPath: string
  private db?: Database<sqlite3.Database, sqlite3.Statement>
  private webhookUrl: string = 'http://127.0.0.1:8547'

  constructor() {
    // Find the database path - Schaltwerk uses project-specific databases
    const dataDir = process.platform === 'darwin' 
      ? path.join(os.homedir(), 'Library', 'Application Support', 'schaltwerk')
      : process.platform === 'win32'
      ? path.join(process.env.APPDATA || '', 'schaltwerk')
      : path.join(os.homedir(), '.local', 'share', 'schaltwerk')
    
    // Find the project-specific database by looking for para-ui projects
    const projectsDir = path.join(dataDir, 'projects')
    if (fs.existsSync(projectsDir)) {
      const projectDirs = fs.readdirSync(projectsDir)
      const paraUiProject = projectDirs.find(dir => dir.startsWith('para-ui_'))
      if (paraUiProject) {
        this.dbPath = path.join(projectsDir, paraUiProject, 'sessions.db')
      } else {
        throw new Error('Could not find para-ui project database')
      }
    } else {
      throw new Error('Schaltwerk projects directory not found')
    }
  }

  async connect(): Promise<void> {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
    })
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.close()
    }
  }

  async listSessions(): Promise<Session[]> {
    if (!this.db) await this.connect()
    
    const sessions = await this.db!.all<Session[]>(`
      SELECT 
        id,
        name,
        display_name,
        repository_path,
        repository_name,
        branch,
        parent_branch,
        worktree_path,
        status,
        session_state,
        created_at,
        updated_at,
        last_activity,
        initial_prompt,
        draft_content,
        ready_to_merge,
        original_agent_type,
        original_skip_permissions,
        pending_name_generation,
        was_auto_generated
      FROM sessions
      WHERE status IN ('active', 'paused', 'draft')
      ORDER BY 
        CASE WHEN ready_to_merge = 0 THEN 0 ELSE 1 END,
        last_activity DESC
    `)
    
    return sessions
  }

  async getSession(name: string): Promise<Session | undefined> {
    if (!this.db) await this.connect()
    
    const session = await this.db!.get<Session>(`
      SELECT * FROM sessions 
      WHERE name = ? AND status IN ('active', 'paused')
    `, name)
    
    return session
  }

  async createSession(name: string, prompt?: string, baseBranch?: string, agentType?: string, skipPermissions?: boolean): Promise<Session> {
    if (!this.db) await this.connect()
    
    // Get the repository path from app config or current directory
    const repoPath = await this.getRepositoryPath()
    const repoName = path.basename(repoPath)
    
    // Generate unique session ID
    const sessionId = `${Date.now()}-${name}`
    
    // Get parent branch (default to main/master)
    const parentBranch = baseBranch || await this.getDefaultBranch(repoPath)
    
    // Create branch name
    const branchName = `schaltwerk/${name}`
    
    // Create worktree
    const worktreePath = await this.createWorktree(repoPath, name, branchName, parentBranch)
    
    // Create session in database
    const now = Date.now()
    const session: Session = {
      id: sessionId,
      name,
      display_name: undefined,
      repository_path: repoPath,
      repository_name: repoName,
      branch: branchName,
      parent_branch: parentBranch,
      worktree_path: worktreePath,
      status: 'active',
      created_at: now,
      updated_at: now,
      last_activity: now,
      initial_prompt: prompt || undefined,
      ready_to_merge: false,
      original_agent_type: agentType || 'claude',
      original_skip_permissions: skipPermissions || false,
      pending_name_generation: false,
      was_auto_generated: false
    }
    
    await this.db!.run(`
      INSERT INTO sessions (
        id, name, display_name, repository_path, repository_name,
        branch, parent_branch, worktree_path,
        status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
        original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      session.id,
      session.name,
      session.display_name,
      session.repository_path,
      session.repository_name,
      session.branch,
      session.parent_branch,
      session.worktree_path,
      session.status,
      session.created_at,
      session.updated_at,
      session.last_activity,
      session.initial_prompt,
      session.ready_to_merge ? 1 : 0,
      session.original_agent_type,
      session.original_skip_permissions ? 1 : 0,
      session.pending_name_generation ? 1 : 0,
      session.was_auto_generated ? 1 : 0
    ])
    
    // Also update app config if agent type or skip permissions were specified
    if (agentType || skipPermissions !== undefined) {
      await this.updateAppConfig(agentType, skipPermissions)
    }
    
    // Notify Schaltwerk UI about the new session
    await this.notifySessionAdded(session)
    
    return session
  }

  async sendFollowUpMessage(sessionName: string, message: string, messageType: 'user' | 'system' = 'user'): Promise<void> {
    if (!this.db) await this.connect()
    
    const session = await this.getSession(sessionName)
    if (!session) {
      throw new Error(`Session '${sessionName}' not found`)
    }
    
    // Notify Schaltwerk UI about the follow-up message
    await this.notifyFollowUpMessage(sessionName, message, messageType)
  }

  async cancelSession(name: string, force: boolean = false): Promise<void> {
    if (!this.db) await this.connect()
    
    const session = await this.getSession(name)
    if (!session) {
      throw new Error(`Session '${name}' not found`)
    }
    
    // Check for uncommitted changes unless force is true
    if (!force) {
      const gitStatus = await this.checkGitStatus(session.worktree_path)
      if (gitStatus.hasUncommittedChanges) {
        const changesSummary = gitStatus.changedFiles.length > 0 
          ? `\n\nFiles with changes:\n${gitStatus.changedFiles.map(f => `  - ${f}`).join('\n')}`
          : ''
        
        throw new Error(`⚠️ SAFETY CHECK FAILED: Session '${name}' has uncommitted changes that would be PERMANENTLY LOST.

📊 UNCOMMITTED WORK DETECTED:
- Modified files: ${gitStatus.modifiedFiles}
- New files: ${gitStatus.untrackedFiles}
- Staged changes: ${gitStatus.stagedFiles}${changesSummary}

🛡️ SAFETY OPTIONS:
1. RECOMMENDED: Commit your work first:
   - cd "${session.worktree_path}"
   - git add .
   - git commit -m "Save progress before cancellation"
   - Then retry cancellation

2. SAFER ALTERNATIVE: Use schaltwerk_pause instead
   - Preserves all work without deletion
   - Can resume later exactly where you left off

3. FORCE DELETION (DANGEROUS): Add force: true parameter
   - schaltwerk_cancel(session_name: "${name}", force: true)
   - ⚠️ THIS WILL PERMANENTLY DELETE ALL UNCOMMITTED WORK

💡 Your work is valuable - consider saving it before cancellation!`)
      }
    }
    
    // Remove worktree
    try {
      execSync(`cd "${session.repository_path}" && git worktree remove "${session.worktree_path}" --force`, {
        stdio: 'pipe'
      })
    } catch (error) {
      console.error(`Failed to remove worktree: ${error}`)
    }
    
    // Delete branch if it exists
    try {
      execSync(`cd "${session.repository_path}" && git branch -D "${session.branch}"`, {
        stdio: 'pipe'
      })
    } catch (error) {
      console.error(`Failed to delete branch: ${error}`)
    }
    
    // Mark session as cancelled in database
    await this.db!.run(`
      UPDATE sessions 
      SET status = 'cancelled', updated_at = ?
      WHERE name = ?
    `, Date.now(), name)
    
    // Notify Schaltwerk UI about the removed session
    await this.notifySessionRemoved(name)
  }

  async pauseSession(name: string): Promise<void> {
    if (!this.db) await this.connect()
    
    const session = await this.getSession(name)
    if (!session) {
      throw new Error(`Session '${name}' not found`)
    }
    
    // Mark session as paused in database (we'll add a 'paused' status)
    await this.db!.run(`
      UPDATE sessions 
      SET status = 'paused', updated_at = ?
      WHERE name = ?
    `, Date.now(), name)
    
    // Note: We intentionally do NOT remove the worktree or branch
    // This preserves all work and allows resuming later
  }

  async getGitStats(sessionId: string): Promise<GitStats | undefined> {
    if (!this.db) await this.connect()
    
    const stats = await this.db!.get<GitStats>(`
      SELECT * FROM git_stats 
      WHERE session_id = ?
    `, sessionId)
    
    return stats
  }

  private async checkGitStatus(worktreePath: string): Promise<GitStatusResult> {
    try {
      // Get git status --porcelain for machine-readable output
      const statusOutput = execSync('git status --porcelain', {
        cwd: worktreePath,
        stdio: 'pipe',
        encoding: 'utf8'
      }).toString()

      const lines = statusOutput.trim().split('\n').filter(line => line.length > 0)
      
      let modifiedFiles = 0
      let untrackedFiles = 0
      let stagedFiles = 0
      const changedFiles: string[] = []

      for (const line of lines) {
        const status = line.substring(0, 2)
        const filename = line.substring(3)
        changedFiles.push(filename)

        // Check staged changes (first character)
        if (status[0] !== ' ' && status[0] !== '?') {
          stagedFiles++
        }

        // Check unstaged changes (second character)
        if (status[1] === 'M') {
          modifiedFiles++
        }

        // Check untracked files
        if (status[0] === '?' && status[1] === '?') {
          untrackedFiles++
        }
      }

      return {
        hasUncommittedChanges: lines.length > 0,
        modifiedFiles,
        untrackedFiles,
        stagedFiles,
        changedFiles
      }
    } catch (error) {
      // If git status fails, assume no changes for safety
      console.warn(`Failed to check git status for ${worktreePath}: ${error}`)
      return {
        hasUncommittedChanges: false,
        modifiedFiles: 0,
        untrackedFiles: 0,
        stagedFiles: 0,
        changedFiles: []
      }
    }
  }

  private async getRepositoryPath(): Promise<string> {
    // Try to get from current directory
    const cwd = process.cwd()
    
    // Check if current directory is a git repository
    try {
      execSync('git rev-parse --show-toplevel', { cwd, stdio: 'pipe' })
      return cwd
    } catch {
      // If not, try to find the para-ui repository
      const possiblePaths = [
        path.join(os.homedir(), 'Documents', 'git', 'para-ui'),
        path.join(os.homedir(), 'Projects', 'para-ui'),
        path.join(os.homedir(), 'Code', 'para-ui'),
        path.join(os.homedir(), 'para-ui'),
      ]
      
      for (const p of possiblePaths) {
        if (fs.existsSync(path.join(p, '.git'))) {
          return p
        }
      }
      
      throw new Error('Could not find para-ui repository')
    }
  }

  private async getDefaultBranch(repoPath: string): Promise<string> {
    try {
      const result = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
        cwd: repoPath,
        stdio: 'pipe'
      }).toString().trim()
      
      return result.replace('refs/remotes/origin/', '')
    } catch {
      // Fallback to common defaults
      try {
        execSync('git rev-parse --verify main', { cwd: repoPath, stdio: 'pipe' })
        return 'main'
      } catch {
        return 'master'
      }
    }
  }

  private async createWorktree(repoPath: string, sessionName: string, branchName: string, parentBranch: string): Promise<string> {
    const worktreePath = path.join(repoPath, '.schaltwerk', 'worktrees', sessionName)
    
    // Create worktree with new branch
    execSync(`git worktree add -b "${branchName}" "${worktreePath}" "${parentBranch}"`, {
      cwd: repoPath,
      stdio: 'pipe'
    })
    
    return worktreePath
  }

  private async updateAppConfig(agentType?: string, skipPermissions?: boolean): Promise<void> {
    if (!this.db) await this.connect()
    
    const updates: string[] = []
    const values: any[] = []
    
    if (agentType) {
      updates.push('agent_type = ?')
      values.push(agentType)
    }
    
    if (skipPermissions !== undefined) {
      updates.push('skip_permissions = ?')
      values.push(skipPermissions ? 1 : 0)
    }
    
    if (updates.length > 0) {
      values.push(1) // id = 1
      await this.db!.run(`
        UPDATE app_config 
        SET ${updates.join(', ')}
        WHERE id = ?
      `, values)
    }
  }

  private async notifySessionAdded(session: Session): Promise<void> {
    try {
      const payload = {
        session_name: session.name,
        branch: session.branch,
        worktree_path: session.worktree_path,
        parent_branch: session.parent_branch
      }
      
      await fetch(`${this.webhookUrl}/webhook/session-added`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      console.warn('Failed to notify session added:', error)
    }
  }

  private async notifyDraftCreated(session: Session): Promise<void> {
    try {
      const payload = {
        session_name: session.name,
        draft_content: session.draft_content,
        parent_branch: session.parent_branch,
        status: 'draft'
      }
      
      await fetch(`${this.webhookUrl}/webhook/draft-created`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      console.warn('Failed to notify draft created:', error)
    }
  }

  private async notifySessionRemoved(sessionName: string): Promise<void> {
    try {
      const payload = {
        session_name: sessionName
      }
      
      await fetch(`${this.webhookUrl}/webhook/session-removed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      console.warn('Failed to notify session removed:', error)
    }
  }

  private async notifyFollowUpMessage(sessionName: string, message: string, messageType: 'user' | 'system'): Promise<void> {
    try {
      const payload = {
        session_name: sessionName,
        message: message,
        message_type: messageType,
        timestamp: Date.now()
      }
      
      await fetch(`${this.webhookUrl}/webhook/follow-up-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      console.warn('Failed to notify follow-up message:', error)
    }
  }

  async createDraftSession(name: string, content?: string, baseBranch?: string): Promise<Session> {
    if (!this.db) await this.connect()
    
    const repoPath = await this.getRepositoryPath()
    const repoName = path.basename(repoPath)
    const sessionId = `${Date.now()}-${name}`
    const parentBranch = baseBranch || await this.getDefaultBranch(repoPath)
    const branchName = `schaltwerk/${name}`
    const worktreePath = path.join(repoPath, '.schaltwerk', 'worktrees', name)
    
    const now = Date.now()
    const session: Session = {
      id: sessionId,
      name,
      display_name: undefined,
      repository_path: repoPath,
      repository_name: repoName,
      branch: branchName,
      parent_branch: parentBranch,
      worktree_path: worktreePath,
      status: 'draft',
      session_state: 'Draft',
      created_at: now,
      updated_at: now,
      last_activity: now,
      initial_prompt: undefined,
      draft_content: content || '',
      ready_to_merge: false,
      original_agent_type: 'claude',
      original_skip_permissions: false,
      pending_name_generation: false,
      was_auto_generated: false
    }
    
    await this.db!.run(`
      INSERT INTO sessions (
        id, name, display_name, repository_path, repository_name,
        branch, parent_branch, worktree_path,
        status, session_state, created_at, updated_at, last_activity, draft_content, ready_to_merge,
        original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      session.id,
      session.name,
      session.display_name,
      session.repository_path,
      session.repository_name,
      session.branch,
      session.parent_branch,
      session.worktree_path,
      session.status,
      session.session_state,
      session.created_at,
      session.updated_at,
      session.last_activity,
      session.draft_content,
      session.ready_to_merge ? 1 : 0,
      session.original_agent_type,
      session.original_skip_permissions ? 1 : 0,
      session.pending_name_generation ? 1 : 0,
      session.was_auto_generated ? 1 : 0
    ])
    
    await this.notifyDraftCreated(session)
    
    return session
  }

  async updateDraftContent(sessionName: string, content: string, append: boolean = false): Promise<void> {
    if (!this.db) await this.connect()
    
    const session = await this.getSession(sessionName)
    if (!session) {
      throw new Error(`Session '${sessionName}' not found`)
    }
    
    if (session.status !== 'draft') {
      throw new Error(`Session '${sessionName}' is not a draft`)
    }
    
    const newContent = append && session.draft_content 
      ? session.draft_content + '\n' + content 
      : content
    
    await this.db!.run(`
      UPDATE sessions 
      SET draft_content = ?, updated_at = ?, last_activity = ?
      WHERE name = ?
    `, newContent, Date.now(), Date.now(), sessionName)
  }

  async startDraftSession(sessionName: string, agentType?: string, skipPermissions?: boolean, baseBranch?: string): Promise<void> {
    if (!this.db) await this.connect()
    
    const session = await this.getSession(sessionName)
    if (!session) {
      throw new Error(`Session '${sessionName}' not found`)
    }
    
    if (session.status !== 'draft') {
      throw new Error(`Session '${sessionName}' is not a draft`)
    }
    
    const parentBranch = baseBranch || session.parent_branch
    
    await this.createWorktree(session.repository_path, sessionName, session.branch, parentBranch)
    
    const now = Date.now()
    await this.db!.run(`
      UPDATE sessions 
      SET status = 'active', 
          session_state = 'Running',
          updated_at = ?, 
          last_activity = ?,
          initial_prompt = draft_content,
          original_agent_type = ?,
          original_skip_permissions = ?
      WHERE name = ?
    `, now, now, agentType || session.original_agent_type, skipPermissions ? 1 : 0, sessionName)
    
    if (agentType || skipPermissions !== undefined) {
      await this.updateAppConfig(agentType, skipPermissions)
    }
    
    const updatedSession = await this.getSession(sessionName)
    if (updatedSession) {
      await this.notifySessionAdded(updatedSession)
    }
  }

  async deleteDraftSession(sessionName: string): Promise<void> {
    if (!this.db) await this.connect()
    
    const session = await this.getSession(sessionName)
    if (!session) {
      throw new Error(`Session '${sessionName}' not found`)
    }
    
    if (session.status !== 'draft') {
      throw new Error(`Session '${sessionName}' is not a draft`)
    }
    
    await this.db!.run(`
      UPDATE sessions 
      SET status = 'cancelled', updated_at = ?
      WHERE name = ?
    `, Date.now(), sessionName)
    
    await this.notifySessionRemoved(sessionName)
  }

  async listDraftSessions(): Promise<Session[]> {
    if (!this.db) await this.connect()
    
    const sessions = await this.db!.all<Session[]>(`
      SELECT 
        id,
        name,
        display_name,
        repository_path,
        repository_name,
        branch,
        parent_branch,
        worktree_path,
        status,
        session_state,
        created_at,
        updated_at,
        last_activity,
        initial_prompt,
        draft_content,
        ready_to_merge,
        original_agent_type,
        original_skip_permissions,
        pending_name_generation,
        was_auto_generated
      FROM sessions
      WHERE status = 'draft'
      ORDER BY updated_at DESC
    `)
    
    return sessions
  }

  async listSessionsByState(filter?: 'all' | 'active' | 'draft' | 'reviewed'): Promise<Session[]> {
    if (!this.db) await this.connect()
    
    let whereClause = "WHERE status IN ('active', 'paused', 'draft')"
    
    switch (filter) {
      case 'active':
        whereClause = "WHERE status = 'active'"
        break
      case 'draft':
        whereClause = "WHERE status = 'draft'"
        break
      case 'reviewed':
        whereClause = "WHERE ready_to_merge = 1"
        break
      case 'all':
      default:
        break
    }
    
    const sessions = await this.db!.all<Session[]>(`
      SELECT 
        id,
        name,
        display_name,
        repository_path,
        repository_name,
        branch,
        parent_branch,
        worktree_path,
        status,
        session_state,
        created_at,
        updated_at,
        last_activity,
        initial_prompt,
        draft_content,
        ready_to_merge,
        original_agent_type,
        original_skip_permissions,
        pending_name_generation,
        was_auto_generated
      FROM sessions
      ${whereClause}
      ORDER BY 
        CASE WHEN ready_to_merge = 0 THEN 0 ELSE 1 END,
        last_activity DESC
    `)
    
    return sessions
  }
}