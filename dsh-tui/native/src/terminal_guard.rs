//! Restore raw mode and alternate screen on every exit path.

use crossterm::terminal::{self, EnterAlternateScreen, LeaveAlternateScreen};
use std::io::{stdout, Stdout};

pub struct TerminalGuard {
    stdout: Stdout,
    armed: bool,
}

impl TerminalGuard {
    pub fn enter() -> anyhow::Result<Self> {
        let mut stdout = stdout();
        terminal::enable_raw_mode()?;
        crossterm::execute!(stdout, EnterAlternateScreen)?;
        Ok(Self { stdout, armed: true })
    }

    pub fn restore(&mut self) -> anyhow::Result<()> {
        if !self.armed {
            return Ok(());
        }
        self.armed = false;
        crossterm::execute!(self.stdout, LeaveAlternateScreen)?;
        terminal::disable_raw_mode()?;
        Ok(())
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = self.restore();
    }
}
