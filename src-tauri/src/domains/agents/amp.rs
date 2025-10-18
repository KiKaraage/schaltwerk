use super::format_binary_invocation;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct AmpConfig {
    pub binary_path: Option<String>,
}

// Simple function to return binary name for external callers
pub fn resolve_amp_binary() -> String {
    "amp".to_string()
}

pub fn find_amp_session(_path: &Path) -> Option<String> {
    // Amp doesn't support session resumption in the same way as other agents
    // It uses threads which are managed differently
    None
}

pub fn build_amp_command_with_config(
    worktree_path: &Path,
    _session_id: Option<&str>,
    _initial_prompt: Option<&str>,
    skip_permissions: bool,
    config: Option<&AmpConfig>,
) -> String {
    // Use simple binary name and let system PATH handle resolution
    let binary_name = if let Some(cfg) = config {
        if let Some(ref path) = cfg.binary_path {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                trimmed
            } else {
                "amp"
            }
        } else {
            "amp"
        }
    } else {
        "amp"
    };
    let binary_invocation = format_binary_invocation(binary_name);
    let cwd_quoted = format_binary_invocation(&worktree_path.display().to_string());
    let mut cmd = format!("cd {cwd_quoted} && {binary_invocation}");

    if skip_permissions {
        cmd.push_str(" --dangerously-allow-all");
    }

    cmd.push_str(" && ");

    // Amp supports stdin input, so we can pipe the prompt if provided
    if let Some(prompt) = _initial_prompt {
        if !prompt.trim().is_empty() {
            let escaped = super::escape_prompt_for_shell(prompt);
            cmd.push_str("echo \"");
            cmd.push_str(&escaped);
            cmd.push_str("\" | ");
        }
    }

    cmd.push_str(&binary_invocation);

    if skip_permissions {
        cmd.push_str(" --dangerously-allow-all");
    }

    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_new_session_with_prompt() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
            mcp_servers: HashMap::new(),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            Some("implement feature X"),
            true,
            Some(&config),
        );
        assert_eq!(
            cmd,
            "cd /path/to/worktree && echo \"implement feature X\" | amp --dangerously-allow-all"
        );
    }

    #[test]
    fn test_command_with_spaces_in_cwd() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
            mcp_servers: HashMap::new(),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/with spaces"),
            None,
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd \"/path/with spaces\" && amp");
    }

    #[test]
    fn test_resume_with_session_id() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
            mcp_servers: HashMap::new(),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            Some("12345678-1234-1234-1234-123456789012"),
            None,
            false,
            Some(&config),
        );
        // Amp doesn't support session resumption like other agents
        assert_eq!(cmd, "cd /path/to/worktree && amp");
    }

    #[test]
    fn test_new_session_no_prompt_no_permissions() {
        let config = AmpConfig {
            binary_path: Some("amp".to_string()),
            mcp_servers: HashMap::new(),
        };
        let cmd = build_amp_command_with_config(
            Path::new("/path/to/worktree"),
            None,
            None,
            false,
            Some(&config),
        );
        assert_eq!(cmd, "cd /path/to/worktree && amp");
    }

    #[test]
    fn test_prompt_with_quotes() {
    let config = AmpConfig {
    binary_path: Some("amp".to_string()),
        mcp_servers: HashMap::new(),
        };
    let cmd = build_amp_command_with_config(
    Path::new("/path/to/worktree"),
    None,
    Some(r#"implement "feature" with quotes"#),
    false,
    Some(&config),
    );
    assert!(cmd.contains("implement"));
    assert!(cmd.contains("feature"));
    assert!(cmd.contains("quotes"));
    assert!(cmd.contains("echo"));
    assert!(cmd.contains("| amp"));
    }
}
