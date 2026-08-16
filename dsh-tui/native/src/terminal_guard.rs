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
        if let Err(enter_error) = crossterm::execute!(stdout, EnterAlternateScreen) {
            let disable_result = terminal::disable_raw_mode();
            return match disable_result {
                Ok(()) => Err(enter_error.into()),
                Err(disable_error) => Err(anyhow::anyhow!(
                    "alternate screen failed: {}; raw-mode restore failed: {}",
                    enter_error,
                    disable_error
                )),
            };
        }
        Ok(Self {
            stdout,
            armed: true,
        })
    }

    pub fn restore(&mut self) -> anyhow::Result<()> {
        if !self.armed {
            return Ok(());
        }
        self.armed = false;
        let alternate = crossterm::execute!(self.stdout, LeaveAlternateScreen);
        let raw = terminal::disable_raw_mode();
        match (alternate, raw) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error.into()),
            (Err(alternate_error), Err(raw_error)) => Err(anyhow::anyhow!(
                "alternate-screen restore failed: {}; raw-mode restore failed: {}",
                alternate_error,
                raw_error
            )),
        }
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        if let Err(error) = self.restore() {
            eprintln!("dsh-tui: terminal restore failed during drop: {}", error);
        }
    }
}
