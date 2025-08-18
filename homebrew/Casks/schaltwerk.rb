cask "schaltwerk" do
  version "0.1.0"
  sha256 :no_check

  url "file:///Users/marius.wichtner/Documents/git/para-ui/.schaltwerk/worktrees/thirsty_mcnulty/src-tauri/target/release/bundle/macos/Schaltwerk-#{version}-universal.dmg"
  name "Schaltwerk"
  desc "Visual interface for managing Para sessions"
  homepage "https://github.com/2mawi2/para-ui"

  app "Schaltwerk.app"

  zap trash: [
    "~/Library/Application Support/schaltwerk",
    "~/Library/Logs/schaltwerk",
    "~/Library/Preferences/com.mariuswichtner.schaltwerk.plist",
    "~/Library/Saved Application State/com.mariuswichtner.schaltwerk.savedState",
  ]
end