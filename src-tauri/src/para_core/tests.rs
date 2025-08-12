#[cfg(test)]
use crate::para_core::{Database, SessionManager, git};
#[cfg(test)]
use crate::para_core::types::SessionStatus;
#[cfg(test)]
use tempfile::TempDir;
#[cfg(test)]
use std::path::PathBuf;
#[cfg(test)]
use std::process::Command;
#[cfg(test)]
use anyhow::Result;

#[cfg(test)]
struct TestEnvironment {
        _repo_dir: TempDir,  // Keep alive to prevent cleanup
        repo_path: PathBuf,
        db_path: PathBuf,
    }
    
    impl TestEnvironment {
        fn new() -> Result<Self> {
            let repo_dir = TempDir::new()?;
            let repo_path = repo_dir.path().to_path_buf();
            let db_path = repo_path.join("test.db");
            
            // Initialize a git repository in the temp directory
            Command::new("git")
                .args(["init"])
                .current_dir(&repo_path)
                .output()?;
            
            // Configure git user for commits
            Command::new("git")
                .args(["config", "user.email", "test@example.com"])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["config", "user.name", "Test User"])
                .current_dir(&repo_path)
                .output()?;
            
            // Create initial commit
            std::fs::write(repo_path.join("README.md"), "# Test Repository")?;
            Command::new("git")
                .args(["add", "."])
                .current_dir(&repo_path)
                .output()?;
            
            Command::new("git")
                .args(["commit", "-m", "Initial commit"])
                .current_dir(&repo_path)
                .output()?;
            
            Ok(Self {
                _repo_dir: repo_dir,
                repo_path,
                db_path,
            })
        }
        
        fn get_database(&self) -> Result<Database> {
            Database::new(Some(self.db_path.clone()))
        }
        
        fn get_session_manager(&self) -> Result<SessionManager> {
            let db = self.get_database()?;
            Ok(SessionManager::new(db, self.repo_path.clone()))
        }
    }
    
    #[test]
    fn test_database_initialization() {
        let env = TestEnvironment::new().unwrap();
        let db = env.get_database().unwrap();
        
        // Database should be created and initialized
        assert!(env.db_path.exists());
        
        // Should be able to list sessions (empty)
        let sessions = db.list_sessions(&env.repo_path).unwrap();
        assert_eq!(sessions.len(), 0);
    }
    
    #[test]
    fn test_create_session() {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Create a session
        let session = manager.create_session("test-feature", Some("Test prompt"), None).unwrap();
        
        // Verify session properties
        assert_eq!(session.name, "test-feature");
        assert_eq!(session.branch, "schaltwerk/test-feature");
        assert_eq!(session.initial_prompt, Some("Test prompt".to_string()));
        assert_eq!(session.status, SessionStatus::Active);
        
        // Verify worktree path
        let expected_worktree = env.repo_path.join(".schaltwerk").join("worktrees").join("test-feature");
        assert_eq!(session.worktree_path, expected_worktree);
        
        // Verify worktree exists on filesystem
        assert!(session.worktree_path.exists());
        assert!(session.worktree_path.join(".git").exists());
        
        // Verify branch exists
        let branches_output = Command::new("git")
            .args(["branch", "--list", "schaltwerk/test-feature"])
            .current_dir(&env.repo_path)
            .output()
            .unwrap();
        
        let branches = String::from_utf8_lossy(&branches_output.stdout);
        assert!(branches.contains("schaltwerk/test-feature"));
        
        // Verify session is in database
        let sessions = manager.list_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].name, "test-feature");
    }
    
    #[test]
    fn test_create_multiple_sessions() {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Create multiple sessions
        let session1 = manager.create_session("feature-1", None, None).unwrap();
        let session2 = manager.create_session("feature-2", Some("Second feature"), None).unwrap();
        let session3 = manager.create_session("bugfix-1", None, None).unwrap();
        
        // Verify all sessions exist
        let sessions = manager.list_sessions().unwrap();
        assert_eq!(sessions.len(), 3);
        
        // Verify each has unique worktree
        assert!(session1.worktree_path.exists());
        assert!(session2.worktree_path.exists());
        assert!(session3.worktree_path.exists());
        assert_ne!(session1.worktree_path, session2.worktree_path);
        assert_ne!(session2.worktree_path, session3.worktree_path);
        
        // Verify all branches exist
        let branches_output = Command::new("git")
            .args(["branch", "--list", "schaltwerk/*"])
            .current_dir(&env.repo_path)
            .output()
            .unwrap();
        
        let branches = String::from_utf8_lossy(&branches_output.stdout);
        assert!(branches.contains("schaltwerk/feature-1"));
        assert!(branches.contains("schaltwerk/feature-2"));
        assert!(branches.contains("schaltwerk/bugfix-1"));
    }
    
    #[test]
    fn test_duplicate_session_name_fails() {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Create first session
        manager.create_session("duplicate", None, None).unwrap();
        
        // Try to create session with same name
        let result = manager.create_session("duplicate", None, None);
        assert!(result.is_err());
        
        // Verify only one session exists
        let sessions = manager.list_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
    }
    
    #[test]
    fn test_invalid_session_names() {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Test various invalid names
        let invalid_names = vec![
            "",                  // Empty
            "test feature",      // Space
            "test/feature",      // Slash
            "test\\feature",     // Backslash
            "test..feature",     // Double dot
            "test@feature",      // Special char
            "test#feature",      // Special char
            "test$feature",      // Special char
        ];
        
        for name in invalid_names {
            let result = manager.create_session(name, None, None);
            assert!(result.is_err(), "Should reject invalid name: {name}");
        }
        
        // Verify no sessions were created
        let sessions = manager.list_sessions().unwrap();
        assert_eq!(sessions.len(), 0);
    }
    
    #[test]
    fn test_valid_session_names() {
        // Test various valid names with separate environment for each to avoid conflicts
        let valid_names = vec![
            "feature",
            "feature-123",
            "feature_123",
            "FEATURE",
            "feature-with-long-name",
            "123-numeric-start",
            "a",  // Single char
        ];
        
        for name in &valid_names {
            let env = TestEnvironment::new().unwrap();
            let manager = env.get_session_manager().unwrap();
            
            let result = manager.create_session(name, None, None);
            if let Err(ref e) = result {
                println!("Error for {name}: {e}");
            }
            assert!(result.is_ok(), "Should accept valid name: {name} - Error: {result:?}");
        }
    }
    
    #[test]
    fn test_cancel_session() {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Create and then cancel a session
        let session = manager.create_session("to-cancel", None, None).unwrap();
        let worktree_path = session.worktree_path.clone();
        
        // Verify worktree exists before cancel
        assert!(worktree_path.exists());
        
        // Cancel the session
        manager.cancel_session("to-cancel").unwrap();
        
        // Verify worktree is removed
        assert!(!worktree_path.exists());
        
        // Verify branch is deleted
        let branches_output = Command::new("git")
            .args(["branch", "--list", "para/to-cancel"])
            .current_dir(&env.repo_path)
            .output()
            .unwrap();
        
        let branches = String::from_utf8_lossy(&branches_output.stdout);
        assert!(!branches.contains("para/to-cancel"));
        
        // Verify session status is updated
        let db_session = manager.get_session("to-cancel").unwrap();
        assert_eq!(db_session.status, SessionStatus::Cancelled);
    }
    
    
    #[test]
    fn test_list_enriched_sessions() {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Create some sessions
        manager.create_session("session-1", Some("First session"), None).unwrap();
        manager.create_session("session-2", None, None).unwrap();
        
        // Get enriched sessions
        let enriched = manager.list_enriched_sessions().unwrap();
        assert_eq!(enriched.len(), 2);
        
        // Verify enriched data
        let session1 = enriched.iter().find(|s| s.info.session_id == "session-1").unwrap();
        assert_eq!(session1.info.branch, "schaltwerk/session-1");
        assert_eq!(session1.info.current_task, Some("First session".to_string()));
        assert_eq!(session1.terminals.len(), 3);
        assert!(session1.terminals.contains(&"session-session-1-top".to_string()));
        assert!(session1.terminals.contains(&"session-session-1-bottom".to_string()));
        assert!(session1.terminals.contains(&"session-session-1-right".to_string()));
    }
    
    #[test]
    fn test_git_stats_calculation() {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Create a session
        let session = manager.create_session("with-changes", None, None).unwrap();
        
        // Make some changes
        std::fs::write(session.worktree_path.join("file1.txt"), "Line 1\nLine 2\nLine 3").unwrap();
        std::fs::write(session.worktree_path.join("file2.txt"), "Content").unwrap();
        
        // Stage and commit changes
        Command::new("git")
            .args(["add", "."])
            .current_dir(&session.worktree_path)
            .output()
            .unwrap();
        
        Command::new("git")
            .args(["commit", "-m", "Add files"])
            .current_dir(&session.worktree_path)
            .output()
            .unwrap();
        
        // Calculate stats
        let stats = git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch).unwrap();
        
        assert_eq!(stats.files_changed, 2);
        assert!(stats.lines_added > 0);
        assert!(!stats.has_uncommitted);
        
        // Make uncommitted changes
        std::fs::write(session.worktree_path.join("file3.txt"), "Uncommitted").unwrap();
        
        let stats = git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch).unwrap();
        assert!(stats.has_uncommitted);
    }
    
    #[test]
    fn test_cleanup_orphaned_worktrees() {
        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();
        
        // Create a session properly
        let session1 = manager.create_session("proper-session", None, None).unwrap();
        
        // Create an orphaned worktree manually (not through session manager)
        let orphan_path = env.repo_path.join(".schaltwerk").join("worktrees").join("orphan");
        std::fs::create_dir_all(orphan_path.parent().unwrap()).unwrap();
        
        Command::new("git")
            .args(["worktree", "add", orphan_path.to_str().unwrap(), "-b", "schaltwerk/orphan"])
            .current_dir(&env.repo_path)
            .output()
            .unwrap();
        
        assert!(orphan_path.exists());
        
        // Debug: Check what worktrees exist before cleanup
        let worktrees = git::list_worktrees(&env.repo_path).unwrap();
        println!("Worktrees before cleanup: {worktrees:?}");
        
        let sessions = manager.list_sessions().unwrap();
        println!("Sessions: {:?}", sessions.iter().map(|s| &s.worktree_path).collect::<Vec<_>>());
        
        // Run cleanup
        manager.cleanup_orphaned_worktrees().unwrap();
        
        // Debug: Check what worktrees exist after cleanup
        let worktrees = git::list_worktrees(&env.repo_path).unwrap();
        println!("Worktrees after cleanup: {worktrees:?}");
        
        // Verify orphan is removed but proper session remains
        assert!(!orphan_path.exists(), "Orphan path should be removed");
        assert!(session1.worktree_path.exists(), "Proper session worktree should remain");
    }
    
    #[test]
    fn test_concurrent_session_creation() {
        use std::sync::Arc;
        use std::thread;
        
        let env = TestEnvironment::new().unwrap();
        let db = Arc::new(env.get_database().unwrap());
        let repo_path = env.repo_path.clone();
        
        // Try to create sessions concurrently
        let handles: Vec<_> = (0..5)
            .map(|i| {
                let db = db.clone();
                let repo_path = repo_path.clone();
                thread::spawn(move || {
                    let manager = SessionManager::new((*db).clone(), repo_path);
                    manager.create_session(&format!("concurrent-{i}"), None, None)
                })
            })
            .collect();
        
        // Collect results
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        
        // All should succeed
        for result in &results {
            assert!(result.is_ok());
        }
        
        // Verify all sessions exist
        let manager = SessionManager::new((*db).clone(), repo_path);
        let sessions = manager.list_sessions().unwrap();
        assert_eq!(sessions.len(), 5);
    }

    #[test]
    fn test_list_enriched_sessions_performance_caching() {
        use std::time::Instant;

        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();

        // Create multiple sessions to amplify the effect
        let session_count = 8usize;
        for i in 0..session_count {
            let name = format!("perf-{i}");
            manager.create_session(&name, None, None).unwrap();
        }

        // First call: cold (computes git stats for each session)
        let start_cold = Instant::now();
        let enriched_cold = manager.list_enriched_sessions().unwrap();
        let dur_cold = start_cold.elapsed();
        assert_eq!(enriched_cold.len(), session_count);

        // Second call: warm (should mostly use cached stats)
        let start_warm = Instant::now();
        let enriched_warm = manager.list_enriched_sessions().unwrap();
        let dur_warm = start_warm.elapsed();
        assert_eq!(enriched_warm.len(), session_count);

        // Expect warm run to be no slower than cold (with some tolerance)
        // Using 10% tolerance to avoid flakiness on fast CI machines.
        assert!(
            dur_warm <= dur_cold + dur_cold / 10,
            "Expected warm ( {dur_warm:?} ) to be <= 1.1x cold ( {dur_cold:?} )"
        );
    }

    #[test]
    fn test_list_enriched_sessions_caches_to_db_and_refreshes_when_stale() {
        use chrono::{Duration as ChronoDuration, Utc};

        let env = TestEnvironment::new().unwrap();
        let manager = env.get_session_manager().unwrap();

        // Create some sessions
        let s1 = manager.create_session("cache-a", None, None).unwrap();
        let s2 = manager.create_session("cache-b", None, None).unwrap();

        // Trigger caching by listing
        let _ = manager.list_enriched_sessions().unwrap();

        // Verify stats exist in DB
        let stats1 = manager.db_ref().get_git_stats(&s1.id).unwrap();
        let stats2 = manager.db_ref().get_git_stats(&s2.id).unwrap();
        assert!(stats1.is_some());
        assert!(stats2.is_some());

        // Force stats to be stale by overwriting with an older timestamp
        let mut stale1 = stats1.unwrap();
        stale1.calculated_at = Utc::now() - ChronoDuration::seconds(61);
        manager.db_ref().save_git_stats(&stale1).unwrap();

        // Call listing again to trigger refresh for stale session
        let _ = manager.list_enriched_sessions().unwrap();

        // New timestamp should be fresher than the stale timestamp
        let refreshed1 = manager.db_ref().get_git_stats(&s1.id).unwrap().unwrap();
        assert!(refreshed1.calculated_at > stale1.calculated_at);
    }