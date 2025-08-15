#!/usr/bin/env node

// Simple test to verify if draft sessions can be retrieved via getSession
// This test should FAIL if the bug exists

import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

async function testDraftRetrieval() {
  console.log('Testing Draft Session Retrieval Bug...\n')
  
  // Create a temporary database
  const testDir = path.join(os.tmpdir(), `test-schaltwerk-${Date.now()}`)
  fs.mkdirSync(testDir, { recursive: true })
  const dbPath = path.join(testDir, 'test.db')
  
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  })
  
  // Create the sessions table
  await db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT,
      repository_path TEXT NOT NULL,
      repository_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      parent_branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      status TEXT NOT NULL,
      session_state TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_activity INTEGER,
      initial_prompt TEXT,
      draft_content TEXT,
      ready_to_merge INTEGER DEFAULT 0,
      original_agent_type TEXT,
      original_skip_permissions INTEGER DEFAULT 0,
      pending_name_generation INTEGER DEFAULT 0,
      was_auto_generated INTEGER DEFAULT 0
    )
  `)
  
  // Insert a draft session
  const draftName = 'test-draft'
  const now = Date.now()
  await db.run(`
    INSERT INTO sessions (
      id, name, display_name, repository_path, repository_name,
      branch, parent_branch, worktree_path,
      status, session_state, created_at, updated_at, last_activity,
      draft_content, ready_to_merge,
      original_agent_type, original_skip_permissions,
      pending_name_generation, was_auto_generated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    `${now}-${draftName}`,
    draftName,
    null,
    '/test/repo',
    'test-repo',
    `schaltwerk/${draftName}`,
    'main',
    `/test/repo/.schaltwerk/worktrees/${draftName}`,
    'draft', // Status is draft
    'Draft', // Session state is Draft
    now,
    now,
    now,
    '# Test Draft Content',
    0,
    'claude',
    0,
    0,
    0
  ])
  
  console.log('✅ Created draft session with status="draft"')
  
  // Insert an active session for comparison
  const activeName = 'test-active'
  await db.run(`
    INSERT INTO sessions (
      id, name, display_name, repository_path, repository_name,
      branch, parent_branch, worktree_path,
      status, session_state, created_at, updated_at, last_activity,
      initial_prompt, ready_to_merge,
      original_agent_type, original_skip_permissions,
      pending_name_generation, was_auto_generated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    `${now}-${activeName}`,
    activeName,
    null,
    '/test/repo',
    'test-repo',
    `schaltwerk/${activeName}`,
    'main',
    `/test/repo/.schaltwerk/worktrees/${activeName}`,
    'active', // Status is active
    'Running', // Session state is Running
    now,
    now,
    now,
    'Test active prompt',
    0,
    'claude',
    0,
    0,
    0
  ])
  
  console.log('✅ Created active session with status="active"\n')
  
  // Now test the getSession query used in SchaltwerkBridge
  console.log('Testing FIXED getSession query (filters by status IN ("active", "paused", "draft"))...')
  
  const getSessionQuery = `
    SELECT * FROM sessions 
    WHERE name = ? AND status IN ('active', 'paused', 'draft')
  `
  
  // Try to get the draft session (THIS SHOULD FAIL)
  const draftResult = await db.get(getSessionQuery, draftName)
  console.log(`Draft session retrieval: ${draftResult ? '✅ FOUND' : '❌ NOT FOUND (BUG!)'}`)
  
  // Try to get the active session (THIS SHOULD WORK)
  const activeResult = await db.get(getSessionQuery, activeName)
  console.log(`Active session retrieval: ${activeResult ? '✅ FOUND' : '❌ NOT FOUND'}\n`)
  
  // Test the correct query that should include drafts
  console.log('Testing corrected query (includes all statuses)...')
  
  const correctQuery = `
    SELECT * FROM sessions 
    WHERE name = ?
  `
  
  const draftResultCorrect = await db.get(correctQuery, draftName)
  console.log(`Draft session retrieval: ${draftResultCorrect ? '✅ FOUND' : '❌ NOT FOUND'}`)
  
  const activeResultCorrect = await db.get(correctQuery, activeName)
  console.log(`Active session retrieval: ${activeResultCorrect ? '✅ FOUND' : '❌ NOT FOUND'}\n`)
  
  // Test what happens with updateDraftContent scenario
  console.log('Testing updateDraftContent scenario...')
  console.log('1. Check if we can find the draft to update it:')
  
  const sessionToUpdate = await db.get(getSessionQuery, draftName)
  if (!sessionToUpdate) {
    console.log('   ❌ Cannot find draft session - updateDraftContent would fail!')
    console.log('   Error would be: "Session \'test-draft\' not found"')
  } else {
    console.log('   ✅ Found draft session - updateDraftContent would work')
  }
  
  await db.close()
  fs.rmSync(testDir, { recursive: true })
  
  console.log('\n=== CONCLUSION ===')
  if (!draftResult) {
    console.log('❌ BUG CONFIRMED: Draft sessions cannot be retrieved by getSession()')
    console.log('   This breaks updateDraftContent() and other draft operations')
    console.log('   Fix: Remove the status filter from getSession() or create getDraftSession()')
    return false
  } else {
    console.log('✅ No bug found - drafts can be retrieved')
    return true
  }
}

testDraftRetrieval().then(success => {
  process.exit(success ? 0 : 1)
}).catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})