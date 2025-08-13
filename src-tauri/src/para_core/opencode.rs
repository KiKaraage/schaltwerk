use std::path::Path;
use std::fs;

pub fn find_opencode_session(path: &Path) -> Option<String> {
    // OpenCode uses --continue flag for last session or --session for specific IDs
    // We'll store a session marker in the worktree similar to Cursor
    let session_file = path.join(".opencode-session");
    
    if session_file.exists() {
        fs::read_to_string(&session_file)
            .ok()
            .and_then(|content| {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    Some(trimmed.to_string())
                } else {
                    None
                }
            })
    } else {
        // No stored session, OpenCode will create a new one
        None
    }
}

pub fn build_opencode_command(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    _skip_permissions: bool,
) -> String {
    let mut cmd = format!("cd {} && /Users/marius.wichtner/.opencode/bin/opencode", worktree_path.display());
    
    if let Some(_id) = session_id {
        // For OpenCode, we use --continue to resume the last session
        // since it doesn't support explicit session IDs like Claude
        cmd.push_str(" --continue");
    }
    
    if let Some(prompt) = initial_prompt {
        // Add initial prompt using the --prompt flag for interactive mode
        let escaped = prompt.replace('"', r#"\""#);
        cmd.push_str(&format!(r#" --prompt "{escaped}""#));
    }
    
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let cmd = build_opencode_command(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && /Users/marius.wichtner/.opencode/bin/opencode --prompt "implement feature X""#);
    }

    #[test]
    fn test_continue_with_session_id() {
        let cmd = build_opencode_command(
            Path::new("/path/to/worktree"),
            Some("my-session"),
            None,
            false,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && /Users/marius.wichtner/.opencode/bin/opencode --continue"#);
    }

    #[test]
    fn test_new_session_no_prompt() {
        let cmd = build_opencode_command(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
        );
        assert_eq!(cmd, "cd /path/to/worktree && /Users/marius.wichtner/.opencode/bin/opencode");
    }

    #[test]
    fn test_continue_session_with_new_prompt() {
        let cmd = build_opencode_command(
            Path::new("/path/to/worktree"),
            Some("session-123"),
            Some("new task"),
            true,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && /Users/marius.wichtner/.opencode/bin/opencode --continue --prompt "new task""#);
    }

    #[test]
    fn test_prompt_with_quotes() {
        let cmd = build_opencode_command(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && /Users/marius.wichtner/.opencode/bin/opencode --prompt "implement \"feature\" with quotes""#);
    }
}