//! App loop: poll terminal events, drain the host projection stream, decode
//! child actions, and dispatch UI updates to the renderer.

use std::io::{Read, Write};
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::CrosstermBackend;
use ratatui::prelude::Stylize;
use ratatui::Terminal;
use unicode_width::UnicodeWidthStr;

use crate::model::RenderModel;
use crate::protocol::{
    ChildAction, ChildControl, FrameReader, HostControl, HostProjection, write_frame, PROTOCOL_VERSION,
};
use crate::terminal_guard::TerminalGuard;

pub struct App {
    pub session_id: String,
    pub composer: String,
    pub model: RenderModel,
}

impl App {
    pub fn new(session_id: String) -> Self {
        Self { session_id, composer: String::new(), model: RenderModel::default() }
    }

    pub fn run(
        &mut self,
        projection_in: &mut dyn Read,
        action_out: &mut dyn Write,
        host_control_in: &mut dyn Read,
        child_control_out: &mut dyn Write,
        _guard: TerminalGuard,
    ) -> anyhow::Result<()> {
        write_frame(
            child_control_out,
            &ChildControl::Ready {
                protocolVersion: PROTOCOL_VERSION,
                childVersion: format!("dsh-tui/{}", env!("CARGO_PKG_VERSION")),
                selectedProtocolVersion: PROTOCOL_VERSION,
                target: self.session_id.clone(),
            },
        )?;

        let mut projection_reader = FrameReader::new(projection_in);
        let mut host_control_reader = FrameReader::new(host_control_in);

        let stdout = std::io::stdout();
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;
        terminal.clear()?;

        loop {
            terminal.draw(|frame| {
                let area = frame.area();
                let chunks = ratatui::layout::Layout::default()
                    .direction(ratatui::layout::Direction::Vertical)
                    .margin(1)
                    .constraints([
                        ratatui::layout::Constraint::Length(1),
                        ratatui::layout::Constraint::Min(3),
                        ratatui::layout::Constraint::Length(3),
                    ])
                    .split(area);
                let provider = self.model
                    .views
                    .iter()
                    .find(|v| v.id == "agent_status")
                    .and_then(|v| v.payload.get("provider"))
                    .and_then(|p| p.as_str())
                    .unwrap_or("unknown");
                let title = format!("dsh-tui | session {} | provider {}", self.session_id, provider);
                frame.render_widget(
                    ratatui::widgets::Paragraph::new(title).style(ratatui::style::Style::default().bold()),
                    chunks[0],
                );
                let body: Vec<ratatui::text::Line> = self
                    .model
                    .cells
                    .iter()
                    .flat_map(|cell| {
                        cell.lines.iter().map(move |line| {
                            let mut span = ratatui::text::Span::raw(line.text.clone());
                            if let Some(style) = &line.style {
                                let s = match style.as_str() {
                                    "dim" => ratatui::style::Style::default().dim(),
                                    "bold" => ratatui::style::Style::default().bold(),
                                    "accent" => ratatui::style::Style::default().fg(ratatui::style::Color::Cyan),
                                    "error" => ratatui::style::Style::default().fg(ratatui::style::Color::Red),
                                    "code" => ratatui::style::Style::default().bg(ratatui::style::Color::DarkGray),
                                    _ => ratatui::style::Style::default(),
                                };
                                span = span.style(s);
                            }
                            ratatui::text::Line::from(vec![
                                ratatui::text::Span::raw(format!("[{}] ", cell.kind)),
                                span,
                            ])
                        })
                    })
                    .collect();
                let body_height = usize::from(chunks[1].height);
                let body_width = usize::from(chunks[1].width).max(1);
                let wrapped_lines = body.iter().map(|line| {
                    let text = line
                        .spans
                        .iter()
                        .map(|span| span.content.as_ref())
                        .collect::<String>();
                    wrapped_line_count(&text, body_width)
                }).sum::<usize>();
                let scroll_offset = wrapped_lines.saturating_sub(body_height) as u16;
                frame.render_widget(
                    ratatui::widgets::Paragraph::new(body)
                        .scroll((scroll_offset, 0))
                        .wrap(ratatui::widgets::Wrap { trim: true }),
                    chunks[1],
                );
                let composer = format!("> {}", self.composer);
                frame.render_widget(
                    ratatui::widgets::Paragraph::new(composer)
                        .style(ratatui::style::Style::default().fg(ratatui::style::Color::Yellow)),
                    chunks[2],
                );
            })?;

            if event::poll(Duration::from_millis(100))? {
                let evt = event::read()?;
                match evt {
                    Event::Key(KeyEvent { code, modifiers, .. }) => match code {
                        KeyCode::Char('c') if modifiers.contains(KeyModifiers::CONTROL) => {
                            self.send_cancel(action_out)?;
                        }
                        KeyCode::Char('q') if modifiers.contains(KeyModifiers::CONTROL) => {
                            write_frame(child_control_out, &ChildControl::Shutdown {
                                protocolVersion: PROTOCOL_VERSION,
                                reason: "user".into(),
                            })?;
                            break;
                        }
                        KeyCode::Enter | KeyCode::Char('\r' | '\n') => {
                            self.submit(action_out)?;
                        }
                        KeyCode::Char('j') if modifiers.contains(KeyModifiers::CONTROL) => {
                            self.submit(action_out)?;
                        }
                        KeyCode::Backspace => {
                            self.composer.pop();
                        }
                        KeyCode::Char(ch) => {
                            self.composer.push(ch);
                        }
                        _ => {}
                    },
                    _ => {}
                }
            }

            while let Some(frame) = projection_reader.next_available()? {
                let record: HostProjection = serde_json::from_slice(&frame)?;
                match record {
                    HostProjection::Window { publicationRevision, cells, views, .. } => {
                        self.model.apply_window(publicationRevision, cells, views);
                    }
                    HostProjection::Commit { .. } => {}
                }
            }

            while let Some(frame) = host_control_reader.next_available()? {
                let record: HostControl = serde_json::from_slice(&frame)?;
                match record {
                    HostControl::Shutdown { .. } => return Ok(()),
                    HostControl::Fatal { message, .. } => {
                        anyhow::bail!("host fatal: {}", message);
                    }
                    _ => {}
                }
            }
        }

        Ok(())
    }

    fn send_cancel(&mut self, out: &mut dyn Write) -> anyhow::Result<()> {
        write_frame(
            out,
            &ChildAction::Cancel {
                protocolVersion: PROTOCOL_VERSION,
                actionId: format!("cancel-{}", std::process::id()),
                sessionId: self.session_id.clone(),
            },
        )
    }

    fn submit(&mut self, out: &mut dyn Write) -> anyhow::Result<()> {
        let text = std::mem::take(&mut self.composer);
        if !text.is_empty() {
            write_frame(
                out,
                &ChildAction::Submit {
                    protocolVersion: PROTOCOL_VERSION,
                    actionId: format!("submit-{}", std::process::id()),
                    sessionId: self.session_id.clone(),
                    text,
                    mode: "queue".into(),
                },
            )?;
        }
        Ok(())
    }
}

fn wrapped_line_count(text: &str, width: usize) -> usize {
    if width == 0 {
        return 0
    }
    let mut lines = 0usize;
    let mut current = 0usize;
    for word in text.split_whitespace() {
        let word_width = word.width();
        if word_width > width {
            if current > 0 {
                lines += 1;
                current = 0;
            }
            lines += word_width.div_ceil(width);
            continue;
        }
        if current > 0 && current + 1 + word_width > width {
            lines += 1;
            current = word_width;
        } else if current > 0 {
            current += 1 + word_width;
        } else {
            current = word_width;
        }
    }
    if current > 0 || text.trim().is_empty() {
        lines += 1;
    }
    lines.max(1)
}
