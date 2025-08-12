pub mod names {
    pub const SESSIONS_REFRESHED: &str = "schaltwerk:sessions-refreshed";
    pub const SESSION_ACTIVITY: &str = "schaltwerk:session-activity";
    pub const SESSION_GIT_STATS: &str = "schaltwerk:session-git-stats";
    pub const SESSION_ADDED: &str = "schaltwerk:session-added";
    pub const SESSION_REMOVED: &str = "schaltwerk:session-removed";
    pub const TERMINAL_STUCK: &str = "schaltwerk:terminal-stuck";
    pub const TERMINAL_UNSTUCK: &str = "schaltwerk:terminal-unstuck";
    pub const TERMINAL_CLOSED: &str = "schaltwerk:terminal-closed";
}

pub fn terminal_output_event(id: &str) -> String {
    format!("terminal-output-{id}")
}
