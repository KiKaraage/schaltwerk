// Test to verify that the fix works correctly

#[cfg(test)]
mod draft_fixed_tests {
    use crate::para_core::types::{SessionStatus, SessionState};
    use crate::para_core::database::Database;
    use crate::para_core::session::SessionManager;
    use tempfile::TempDir;
    use std::fs;
    use std::process::Command;

    fn setup_test_env() -> (TempDir, SessionManager) {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        
        // Initialize git repo
        Command::new("git")
            .args(&["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        Command::new("git")
            .args(&["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
            
        Command::new("git")
            .args(&["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create initial commit
        fs::write(repo_path.join("README.md"), "test").unwrap();
        Command::new("git")
            .args(&["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(&["commit", "-m", "Initial commit"])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        
        // Create database in temp directory
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(Some(db_path)).unwrap();
        let manager = SessionManager::new(db, repo_path);
        
        (temp_dir, manager)
    }

    #[test]
    fn test_draft_sessions_have_draft_status() {
        let (_temp_dir, manager) = setup_test_env();
        
        // Create a draft session
        let draft_session = manager.create_draft_session("test-draft", "Draft content").unwrap();
        
        // FIX VERIFIED: Draft sessions now have SessionStatus::Draft
        assert_eq!(
            draft_session.status, 
            SessionStatus::Draft,
            "Draft sessions should have SessionStatus::Draft"
        );
        
        // Also verify session_state is Draft
        assert_eq!(
            draft_session.session_state,
            SessionState::Draft,
            "Draft sessions should have SessionState::Draft"
        );
    }

    #[test]
    fn test_draft_sessions_separate_from_active() {
        let (_temp_dir, manager) = setup_test_env();
        
        // Create a draft session
        let draft = manager.create_draft_session("test-draft", "Draft content").unwrap();
        
        // Create an active session
        let active = manager.create_session("test-active", Some("Active prompt"), None).unwrap();
        
        // List all sessions
        let all_sessions = manager.list_sessions().unwrap();
        
        // FIX VERIFIED: Can now distinguish by SessionStatus
        let draft_count = all_sessions.iter()
            .filter(|s| s.status == SessionStatus::Draft)
            .count();
        let active_count = all_sessions.iter()
            .filter(|s| s.status == SessionStatus::Active)
            .count();
        
        assert_eq!(draft_count, 1, "Should have exactly 1 draft session");
        assert_eq!(active_count, 1, "Should have exactly 1 active session");
        
        // Verify the specific sessions have correct status
        assert_eq!(draft.status, SessionStatus::Draft);
        assert_eq!(active.status, SessionStatus::Active);
    }

    #[test]
    fn test_ui_can_filter_drafts_properly() {
        let (_temp_dir, manager) = setup_test_env();
        
        // Create sessions
        manager.create_draft_session("ui-draft", "UI Draft").unwrap();
        manager.create_session("ui-active", Some("UI Active"), None).unwrap();
        
        let all_sessions = manager.list_sessions().unwrap();
        
        // FIX VERIFIED: UI can now properly filter by SessionStatus
        let drafts: Vec<_> = all_sessions.iter()
            .filter(|s| s.status == SessionStatus::Draft)
            .collect();
        
        let actives: Vec<_> = all_sessions.iter()
            .filter(|s| s.status == SessionStatus::Active)
            .collect();
        
        assert_eq!(drafts.len(), 1, "UI can filter exactly 1 draft");
        assert_eq!(actives.len(), 1, "UI can filter exactly 1 active");
        
        // Draft should NOT appear in active sessions
        assert!(
            !actives.iter().any(|s| s.name == "ui-draft"),
            "Draft session should not appear in active sessions list"
        );
        
        // Draft should appear in draft sessions
        assert!(
            drafts.iter().any(|s| s.name == "ui-draft"),
            "Draft session should appear in draft sessions list"
        );
    }

    #[test]
    fn test_draft_transitions_to_active_when_started() {
        let (_temp_dir, manager) = setup_test_env();
        
        // Create a draft
        let draft = manager.create_draft_session("transition-draft", "Draft to start").unwrap();
        assert_eq!(draft.status, SessionStatus::Draft);
        assert_eq!(draft.session_state, SessionState::Draft);
        
        // Start the draft session
        manager.start_draft_session("transition-draft", None).unwrap();
        
        // Get the updated session - retrieve via list_sessions
        let sessions = manager.list_sessions().unwrap();
        let started = sessions.into_iter()
            .find(|s| s.name == "transition-draft")
            .expect("Should find the started draft session");
        
        // FIX VERIFIED: After starting, status changes to Active
        assert_eq!(
            started.status,
            SessionStatus::Active,
            "Started draft should have Active status"
        );
        assert_eq!(
            started.session_state,
            SessionState::Running,
            "Started draft should have Running state"
        );
    }
}