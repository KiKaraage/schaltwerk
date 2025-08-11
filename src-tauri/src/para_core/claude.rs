use std::path::{Path, PathBuf};
use std::fs;

pub fn find_claude_session(path: &Path) -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let claude_dir = PathBuf::from(home).join(".claude");
    let projects_dir = claude_dir.join("projects");
    
    let sanitized = sanitize_path_for_claude(path);
    let project_dir = projects_dir.join(&sanitized);
    
    if !project_dir.exists() {
        return None;
    }
    
    let mut sessions: Vec<_> = fs::read_dir(&project_dir).ok()?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().map(|ext| ext == "jsonl").unwrap_or(false)
                && e.metadata().map(|m| m.len() > 1000).unwrap_or(false)
        })
        .collect();
    
    sessions.sort_by_key(|e| {
        e.metadata()
            .and_then(|m| m.modified())
            .ok()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    
    sessions.last()?
        .path()
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

fn sanitize_path_for_claude(path: &Path) -> String {
    path.to_string_lossy()
        .replace(['/', '.'], "-")
}

pub fn build_claude_command(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    skip_permissions: bool,
) -> String {
    let mut cmd = format!("cd {} && claude", worktree_path.display());
    
    if skip_permissions {
        cmd.push_str(" --dangerously-skip-permissions");
    }
    
    if let Some(id) = session_id {
        cmd.push_str(&format!(r#" -r "{id}""#));
    } else if let Some(prompt) = initial_prompt {
        let escaped = prompt.replace('"', r#"\""#);
        cmd.push_str(&format!(r#" "{escaped}""#));
    }
    
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude --dangerously-skip-permissions "implement feature X""#);
    }

    #[test]
    fn test_resume_with_session_id() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            Some("12345678-1234-1234-1234-123456789012"),
            None,
            false,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude -r "12345678-1234-1234-1234-123456789012""#);
    }

    #[test]
    fn test_sanitize_path_for_claude() {
        let path = Path::new("/Users/john.doe/my-project");
        let sanitized = sanitize_path_for_claude(path);
        assert_eq!(sanitized, "-Users-john-doe-my-project");
    }

    #[test]
    fn test_new_session_no_prompt_no_permissions() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
        );
        assert_eq!(cmd, "cd /path/to/worktree && claude");
    }

    #[test]
    fn test_resume_with_permissions() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            Some("session-123"),
            Some("ignored prompt"),
            true,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude --dangerously-skip-permissions -r "session-123""#);
    }

    #[test]
    fn test_prompt_with_quotes() {
        let cmd = build_claude_command(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && claude "implement \"feature\" with quotes""#);
    }
}