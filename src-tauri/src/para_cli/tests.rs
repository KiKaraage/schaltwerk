#[cfg(test)]
mod tests {
    use super::super::types::*;
    use serde_json;

    #[test]
    fn test_parse_session_with_monitor_data() {
        let json = r#"{
            "session_id": "quick_pulsar",
            "branch": "para/quick_pulsar",
            "worktree_path": "/Users/test/.para/worktrees/quick_pulsar",
            "base_branch": "main",
            "merge_mode": "squash",
            "status": "dirty",
            "last_modified": "2025-08-09T12:32:14.852988Z",
            "has_uncommitted_changes": true,
            "is_current": false,
            "session_type": "worktree",
            "container_status": null,
            "session_state": "active",
            "current_task": "Adding worktree logs",
            "test_status": "passed",
            "todo_percentage": 10,
            "is_blocked": false,
            "diff_stats": {
                "files_changed": 1,
                "additions": 3,
                "deletions": 0,
                "insertions": 3
            }
        }"#;

        let session: SessionInfo = serde_json::from_str(json).unwrap();
        
        assert_eq!(session.session_id, "quick_pulsar");
        assert_eq!(session.branch, "para/quick_pulsar");
        assert_eq!(session.session_state, Some("active".to_string()));
        assert_eq!(session.current_task, Some("Adding worktree logs".to_string()));
        assert_eq!(session.test_status, Some("passed".to_string()));
        assert_eq!(session.todo_percentage, Some(10));
        assert_eq!(session.is_blocked, Some(false));
        
        let diff_stats = session.diff_stats.unwrap();
        assert_eq!(diff_stats.files_changed, 1);
        assert_eq!(diff_stats.additions, 3);
        assert_eq!(diff_stats.insertions, 3);
        assert_eq!(diff_stats.deletions, 0);
        assert_eq!(diff_stats.get_insertions(), 3);
        assert_eq!(diff_stats.get_additions(), 3);
    }

    #[test]
    fn test_parse_session_without_monitor_data() {
        let json = r#"{
            "session_id": "eager_cosmos",
            "branch": "para/eager_cosmos",
            "worktree_path": "/Users/test/.para/worktrees/eager_cosmos",
            "base_branch": "main",
            "merge_mode": "squash",
            "status": "active",
            "last_modified": "2025-07-31T23:03:24.301463Z",
            "has_uncommitted_changes": false,
            "is_current": false,
            "session_type": "worktree",
            "container_status": null,
            "session_state": "stale",
            "diff_stats": {
                "files_changed": 0,
                "additions": 0,
                "deletions": 0,
                "insertions": 0
            }
        }"#;

        let session: SessionInfo = serde_json::from_str(json).unwrap();
        
        assert_eq!(session.session_id, "eager_cosmos");
        assert_eq!(session.session_state, Some("stale".to_string()));
        assert_eq!(session.current_task, None);
        assert_eq!(session.test_status, None);
        assert_eq!(session.todo_percentage, None);
        assert_eq!(session.is_blocked, None);
        
        let diff_stats = session.diff_stats.unwrap();
        assert_eq!(diff_stats.files_changed, 0);
        assert_eq!(diff_stats.get_insertions(), 0);
    }

    #[test]
    fn test_parse_multiple_sessions() {
        let json = r#"[
            {
                "session_id": "session1",
                "branch": "para/session1",
                "worktree_path": "/test/session1",
                "base_branch": "main",
                "merge_mode": "squash",
                "status": "active",
                "last_modified": null,
                "has_uncommitted_changes": false,
                "is_current": true,
                "session_type": "worktree",
                "container_status": null,
                "session_state": "active",
                "current_task": "Task 1",
                "test_status": "failed",
                "todo_percentage": 75,
                "is_blocked": true,
                "diff_stats": {
                    "files_changed": 5,
                    "additions": 100,
                    "deletions": 50,
                    "insertions": 100
                }
            },
            {
                "session_id": "session2",
                "branch": "para/session2",
                "worktree_path": "/test/session2",
                "base_branch": "develop",
                "merge_mode": "rebase",
                "status": "missing",
                "last_modified": "2025-08-09T10:00:00Z",
                "has_uncommitted_changes": true,
                "is_current": false,
                "session_type": "container",
                "container_status": "running"
            }
        ]"#;

        let sessions: Vec<SessionInfo> = serde_json::from_str(json).unwrap();
        
        assert_eq!(sessions.len(), 2);
        
        // First session with full monitor data
        assert_eq!(sessions[0].session_id, "session1");
        assert_eq!(sessions[0].is_current, true);
        assert_eq!(sessions[0].session_state, Some("active".to_string()));
        assert_eq!(sessions[0].test_status, Some("failed".to_string()));
        assert_eq!(sessions[0].todo_percentage, Some(75));
        assert_eq!(sessions[0].is_blocked, Some(true));
        
        // Second session without monitor data
        assert_eq!(sessions[1].session_id, "session2");
        assert_eq!(sessions[1].session_type, SessionType::Container);
        assert_eq!(sessions[1].container_status, Some("running".to_string()));
        assert_eq!(sessions[1].session_state, None);
        assert_eq!(sessions[1].current_task, None);
    }

    #[test]
    fn test_diff_stats_compatibility() {
        // Test with "additions" field
        let json_additions = r#"{
            "files_changed": 3,
            "additions": 50,
            "deletions": 20
        }"#;
        
        let stats: DiffStats = serde_json::from_str(json_additions).unwrap();
        assert_eq!(stats.files_changed, 3);
        assert_eq!(stats.additions, 50);
        assert_eq!(stats.insertions, 0); // Not present in JSON, defaults to 0
        assert_eq!(stats.deletions, 20);
        assert_eq!(stats.get_additions(), 50);
        assert_eq!(stats.get_insertions(), 50); // Falls back to additions
        
        // Test with "insertions" field
        let json_insertions = r#"{
            "files_changed": 2,
            "insertions": 30,
            "deletions": 10
        }"#;
        
        let stats: DiffStats = serde_json::from_str(json_insertions).unwrap();
        assert_eq!(stats.files_changed, 2);
        assert_eq!(stats.additions, 0); // Not present in JSON, defaults to 0
        assert_eq!(stats.insertions, 30);
        assert_eq!(stats.deletions, 10);
        assert_eq!(stats.get_additions(), 30); // Falls back to insertions
        assert_eq!(stats.get_insertions(), 30);
        
        // Test with both fields (new para format)
        let json_both = r#"{
            "files_changed": 4,
            "additions": 60,
            "deletions": 15,
            "insertions": 60
        }"#;
        
        let stats: DiffStats = serde_json::from_str(json_both).unwrap();
        assert_eq!(stats.files_changed, 4);
        assert_eq!(stats.additions, 60);
        assert_eq!(stats.insertions, 60);
        assert_eq!(stats.deletions, 15);
        assert_eq!(stats.get_additions(), 60);
        assert_eq!(stats.get_insertions(), 60);
    }

    #[test]
    fn test_session_state_values() {
        // Test all possible session states
        let states = vec!["active", "idle", "review", "ready", "stale"];
        
        for state in states {
            let json = format!(r#"{{
                "session_id": "test",
                "branch": "test",
                "worktree_path": "/test",
                "base_branch": "main",
                "merge_mode": "squash",
                "status": "active",
                "last_modified": null,
                "has_uncommitted_changes": false,
                "is_current": false,
                "session_type": "worktree",
                "container_status": null,
                "session_state": "{}"
            }}"#, state);
            
            let session: SessionInfo = serde_json::from_str(&json).unwrap();
            assert_eq!(session.session_state, Some(state.to_string()));
        }
    }

    #[test]
    fn test_test_status_values() {
        // Test all possible test status values
        let statuses = vec!["passed", "failed", "unknown"];
        
        for status in statuses {
            let json = format!(r#"{{
                "session_id": "test",
                "branch": "test",
                "worktree_path": "/test",
                "base_branch": "main",
                "merge_mode": "squash",
                "status": "active",
                "last_modified": null,
                "has_uncommitted_changes": false,
                "is_current": false,
                "session_type": "worktree",
                "container_status": null,
                "test_status": "{}"
            }}"#, status);
            
            let session: SessionInfo = serde_json::from_str(&json).unwrap();
            assert_eq!(session.test_status, Some(status.to_string()));
        }
    }
}