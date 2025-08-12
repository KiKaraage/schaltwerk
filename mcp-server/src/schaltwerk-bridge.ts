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
  status: 'active' | 'cancelled'
  created_at: number
  updated_at: number
  last_activity?: number
  initial_prompt?: string
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
        created_at,
        updated_at,
        last_activity,
        initial_prompt,
        ready_to_merge,
        original_agent_type,
        original_skip_permissions,
        pending_name_generation,
        was_auto_generated
      FROM sessions
      WHERE status = 'active'
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
      WHERE name = ? AND status = 'active'
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

  async cancelSession(name: string): Promise<void> {
    if (!this.db) await this.connect()
    
    const session = await this.getSession(name)
    if (!session) {
      throw new Error(`Session '${name}' not found`)
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

  async getGitStats(sessionId: string): Promise<GitStats | undefined> {
    if (!this.db) await this.connect()
    
    const stats = await this.db!.get<GitStats>(`
      SELECT * FROM git_stats 
      WHERE session_id = ?
    `, sessionId)
    
    return stats
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
}