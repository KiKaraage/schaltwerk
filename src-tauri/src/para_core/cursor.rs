use std::path::Path;
use std::fs;

pub fn find_cursor_session(path: &Path) -> Option<String> {
    // For cursor-agent, we need a different approach than Claude
    // Cursor sessions are not directly tied to project paths like Claude sessions
    // 
    // For now, we'll check if there's a .cursor-session file in the worktree
    // that stores the session ID for this specific worktree
    let session_file = path.join(".cursor-session");
    
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
        // Don't try to find global cursor sessions
        // Each Para session should have its own cursor session
        None
    }
}

pub fn build_cursor_command(
    worktree_path: &Path,
    session_id: Option<&str>,
    initial_prompt: Option<&str>,
    force_flag: bool,
) -> String {
    let mut cmd = format!("cd {} && cursor-agent", worktree_path.display());
    
    if let Some(id) = session_id {
        // Resuming an existing session
        cmd.push_str(&format!(r#" --resume "{id}""#));
    } else {
        // Starting a new session
        if force_flag {
            cmd.push_str(" -f");
        }
        
        if let Some(prompt) = initial_prompt {
            let escaped = prompt.replace('"', r#"\""#);
            cmd.push_str(&format!(r#" "{escaped}""#));
        }
    }
    
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let cmd = build_cursor_command(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && cursor-agent -f "implement feature X""#);
    }

    #[test]
    fn test_resume_with_session_id() {
        let cmd = build_cursor_command(
            Path::new("/path/to/worktree"),
            Some("eed07399-7097-4087-b7dc-bb3a26ca2948"),
            None,
            false,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && cursor-agent --resume "eed07399-7097-4087-b7dc-bb3a26ca2948""#);
    }

    #[test]
    fn test_new_session_no_prompt_no_force() {
        let cmd = build_cursor_command(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
        );
        assert_eq!(cmd, "cd /path/to/worktree && cursor-agent");
    }

    #[test]
    fn test_resume_with_force() {
        let cmd = build_cursor_command(
            Path::new("/path/to/worktree"),
            Some("session-123"),
            Some("ignored prompt"),
            true,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && cursor-agent --resume "session-123""#);
    }

    #[test]
    fn test_prompt_with_quotes() {
        let cmd = build_cursor_command(
            Path::new("/path/to/worktree"),
            None,
            Some(r#"implement "feature" with quotes"#),
            false,
        );
        assert_eq!(cmd, r#"cd /path/to/worktree && cursor-agent "implement \"feature\" with quotes""#);
    }
}