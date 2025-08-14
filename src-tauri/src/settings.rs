use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AgentEnvVars {
    pub claude: HashMap<String, String>,
    pub cursor: HashMap<String, String>,
    pub opencode: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Settings {
    pub agent_env_vars: AgentEnvVars,
}

pub struct SettingsManager {
    settings_path: PathBuf,
    settings: Settings,
}

impl SettingsManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let config_dir = app_handle
            .path()
            .app_config_dir()
            .map_err(|e| format!("Failed to get config directory: {e}"))?;
        
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir)
                .map_err(|e| format!("Failed to create config directory: {e}"))?;
        }
        
        let settings_path = config_dir.join("settings.json");
        
        let settings = if settings_path.exists() {
            let contents = fs::read_to_string(&settings_path)
                .map_err(|e| format!("Failed to read settings file: {e}"))?;
            serde_json::from_str(&contents)
                .unwrap_or_else(|_| Settings::default())
        } else {
            Settings::default()
        };
        
        Ok(Self {
            settings_path,
            settings,
        })
    }
    
    pub fn save(&self) -> Result<(), String> {
        let contents = serde_json::to_string_pretty(&self.settings)
            .map_err(|e| format!("Failed to serialize settings: {e}"))?;
        
        fs::write(&self.settings_path, contents)
            .map_err(|e| format!("Failed to write settings file: {e}"))?;
        
        Ok(())
    }
    
    pub fn get_agent_env_vars(&self, agent_type: &str) -> HashMap<String, String> {
        match agent_type {
            "claude" => self.settings.agent_env_vars.claude.clone(),
            "cursor" => self.settings.agent_env_vars.cursor.clone(),
            "opencode" => self.settings.agent_env_vars.opencode.clone(),
            _ => HashMap::new(),
        }
    }
    
    pub fn set_agent_env_vars(&mut self, agent_type: &str, env_vars: HashMap<String, String>) -> Result<(), String> {
        match agent_type {
            "claude" => self.settings.agent_env_vars.claude = env_vars,
            "cursor" => self.settings.agent_env_vars.cursor = env_vars,
            "opencode" => self.settings.agent_env_vars.opencode = env_vars,
            _ => return Err(format!("Unknown agent type: {agent_type}")),
        }
        
        self.save()
    }
}