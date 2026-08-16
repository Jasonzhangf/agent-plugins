//! Terminal loop and strict four-pipe bridge consumer.

use std::io::{Read, Write};
use std::thread;
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::CrosstermBackend;
use ratatui::prelude::Stylize;
use ratatui::Terminal;
use unicode_width::UnicodeWidthStr;

use crate::model::{ProjectionError, RenderModel};
use crate::protocol::{
    write_frame, Channel, ChildAction, ChildControl, DeliveryPair, FrameReader, HostControl,
    HostProjection, PairOutcome, MAX_SAFE_SEQUENCE, PROTOCOL_VERSION,
};
use crate::terminal_guard::TerminalGuard;

pub struct App {
    session_id: String,
    composer: String,
    model: RenderModel,
    action_sequence: u64,
}

impl App {
    pub fn new(session_id: String) -> Self {
        Self {
            session_id,
            composer: String::new(),
            model: RenderModel::default(),
            action_sequence: 1,
        }
    }

    pub fn run(
        &mut self,
        projection_in: &mut dyn Read,
        action_out: &mut dyn Write,
        host_control_in: &mut dyn Read,
        child_control_out: &mut dyn Write,
    ) -> anyhow::Result<()> {
        let mut projection_reader = FrameReader::new(projection_in, Channel::Projection);
        let mut host_control_reader = FrameReader::new(host_control_in, Channel::HostControl);
        self.accept_hello(&mut host_control_reader)?;
        write_frame(
            child_control_out,
            &ChildControl::Ready {
                protocolVersion: PROTOCOL_VERSION,
                childVersion: format!("dsh-tui/{}", env!("CARGO_PKG_VERSION")),
                selectedProtocolVersion: PROTOCOL_VERSION,
                target: self.session_id.clone(),
            },
        )?;

        let mut guard = TerminalGuard::enter()?;
        let result = self.run_terminal(
            &mut projection_reader,
            action_out,
            &mut host_control_reader,
            child_control_out,
        );
        let restore = guard.restore();
        match (result, restore) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(error), Ok(())) => Err(error),
            (Ok(()), Err(error)) => Err(error),
            (Err(error), Err(restore_error)) => {
                Err(error.context(format!("terminal restore failed: {}", restore_error)))
            }
        }
    }

    fn run_terminal(
        &mut self,
        projection_reader: &mut FrameReader,
        action_out: &mut dyn Write,
        host_control_reader: &mut FrameReader,
        child_control_out: &mut dyn Write,
    ) -> anyhow::Result<()> {
        let backend = CrosstermBackend::new(std::io::stdout());
        let mut terminal = Terminal::new(backend)?;
        terminal.clear()?;
        let mut projection_pairs = DeliveryPair::new();
        let mut shutdown = false;

        while !shutdown {
            self.draw(&mut terminal)?;
            if event::poll(Duration::from_millis(50))? {
                match event::read()? {
                    Event::Key(KeyEvent {
                        code, modifiers, ..
                    }) => match code {
                        KeyCode::Char('c') if modifiers.contains(KeyModifiers::CONTROL) => {
                            self.send_cancel(action_out, child_control_out)?;
                        }
                        KeyCode::Char('q') if modifiers.contains(KeyModifiers::CONTROL) => {
                            write_frame(
                                child_control_out,
                                &ChildControl::Shutdown {
                                    protocolVersion: PROTOCOL_VERSION,
                                    reason: "user".into(),
                                },
                            )?;
                            shutdown = true;
                        }
                        KeyCode::Enter | KeyCode::Char('\r' | '\n') => {
                            self.submit(action_out, child_control_out)?;
                        }
                        KeyCode::Char('j') if modifiers.contains(KeyModifiers::CONTROL) => {
                            self.submit(action_out, child_control_out)?;
                        }
                        KeyCode::Backspace => {
                            self.composer.pop();
                        }
                        KeyCode::Char(ch) => self.composer.push(ch),
                        _ => {}
                    },
                    Event::Resize(_, _) => {}
                    _ => {}
                }
            }

            while let Some(body) = projection_reader.read_one()? {
                projection_pairs.push_record(body)?;
            }
            while let Some(body) = host_control_reader.read_one()? {
                match strict_decode::<HostControl>(&body)? {
                    ledger @ HostControl::Ledger {
                        protocolVersion, ..
                    } => {
                        require_version(protocolVersion)?;
                        if !matches!(&ledger, HostControl::Ledger { channel, .. } if channel == "projection")
                        {
                            anyhow::bail!("host delivery ledger has wrong channel");
                        }
                        projection_pairs.push_ledger(ledger)?;
                    }
                    HostControl::Shutdown {
                        protocolVersion,
                        reason,
                    } => {
                        require_version(protocolVersion)?;
                        if !matches!(reason.as_str(), "user" | "host" | "signal") {
                            anyhow::bail!("invalid host shutdown reason: {}", reason);
                        }
                        shutdown = true;
                    }
                    HostControl::Fatal {
                        protocolVersion,
                        code,
                        message,
                    } => {
                        require_version(protocolVersion)?;
                        anyhow::bail!("host fatal {}: {}", code, message);
                    }
                    HostControl::Ack {
                        protocolVersion,
                        channel,
                        ..
                    }
                    | HostControl::Capacity {
                        protocolVersion,
                        channel,
                        ..
                    } => {
                        require_version(protocolVersion)?;
                        if channel != "action" {
                            anyhow::bail!("host action control has wrong channel: {}", channel);
                        }
                    }
                    HostControl::Hello { .. } => anyhow::bail!("duplicate host hello"),
                }
            }

            loop {
                match projection_pairs.accept()? {
                    PairOutcome::Pending => break,
                    PairOutcome::ForwardGap { expected, observed } => {
                        self.model.discard_staged();
                        write_frame(
                            child_control_out,
                            &ChildControl::Resync {
                                protocolVersion: PROTOCOL_VERSION,
                                expectedSequence: expected,
                                observedSequence: observed,
                                observedProjectionRevision: self.model.publication_revision,
                                reason: "sequence_gap".into(),
                            },
                        )?;
                        break;
                    }
                    PairOutcome::Accepted { body, sequence } => {
                        if self.apply_projection(&body, sequence, child_control_out)? {
                            projection_pairs.discard_pending();
                            break;
                        }
                    }
                }
            }

            if projection_reader.is_eof() || host_control_reader.is_eof() {
                projection_pairs.finish()?;
                anyhow::bail!("host bridge closed before shutdown");
            }
        }

        projection_pairs.finish()?;
        Ok(())
    }

    fn accept_hello(&mut self, reader: &mut FrameReader) -> anyhow::Result<()> {
        loop {
            if let Some(body) = reader.read_one()? {
                match strict_decode::<HostControl>(&body)? {
                    HostControl::Hello {
                        protocolVersion,
                        minProtocolVersion,
                        maxProtocolVersion,
                        maxRecordBytes,
                        maxQueuedBytes,
                        ..
                    } => {
                        require_version(protocolVersion)?;
                        if minProtocolVersion > PROTOCOL_VERSION
                            || maxProtocolVersion < PROTOCOL_VERSION
                        {
                            anyhow::bail!(
                                "host protocol range {}-{} excludes {}",
                                minProtocolVersion,
                                maxProtocolVersion,
                                PROTOCOL_VERSION
                            );
                        }
                        if maxRecordBytes != 8 * 1024 * 1024 || maxQueuedBytes != 16 * 1024 * 1024 {
                            anyhow::bail!("host protocol limits do not match child limits");
                        }
                        return Ok(());
                    }
                    HostControl::Fatal { code, message, .. } => {
                        anyhow::bail!("host fatal before ready {}: {}", code, message)
                    }
                    _ => anyhow::bail!("host control sent non-hello before ready"),
                }
            }
            if reader.is_eof() {
                anyhow::bail!("host control EOF before hello");
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn apply_projection(
        &mut self,
        body: &[u8],
        sequence: u64,
        child_control_out: &mut dyn Write,
    ) -> anyhow::Result<bool> {
        match strict_decode::<HostProjection>(body)? {
            HostProjection::Window {
                protocolVersion,
                publicationRevision,
                index,
                cells,
                views,
            } => {
                require_version(protocolVersion)?;
                let staged =
                    self.model
                        .stage_window(publicationRevision, index, cells, views, body.len());
                self.handle_projection_result(
                    staged,
                    sequence,
                    publicationRevision,
                    child_control_out,
                )
            }
            HostProjection::Commit {
                protocolVersion,
                publicationRevision,
                totalWindows,
            } => {
                require_version(protocolVersion)?;
                let committed = self.model.commit(publicationRevision, totalWindows);
                let resync = self.handle_projection_result(
                    committed,
                    sequence,
                    publicationRevision,
                    child_control_out,
                )?;
                if !resync {
                    write_frame(
                        child_control_out,
                        &ChildControl::Ack {
                            protocolVersion: PROTOCOL_VERSION,
                            channel: "projection".into(),
                            sequence,
                            projectionRevision: publicationRevision,
                        },
                    )?;
                }
                Ok(resync)
            }
        }
    }

    fn handle_projection_result(
        &mut self,
        result: Result<(), ProjectionError>,
        sequence: u64,
        revision: u64,
        child_control_out: &mut dyn Write,
    ) -> anyhow::Result<bool> {
        match result {
            Ok(()) => Ok(false),
            Err(ProjectionError::Resync(_message)) => {
                self.model.discard_staged();
                write_frame(
                    child_control_out,
                    &ChildControl::Resync {
                        protocolVersion: PROTOCOL_VERSION,
                        expectedSequence: sequence
                            .checked_add(1)
                            .ok_or_else(|| anyhow::anyhow!("projection sequence exhausted"))?,
                        observedSequence: sequence,
                        observedProjectionRevision: revision,
                        reason: "revision_mismatch".into(),
                    },
                )?;
                Ok(true)
            }
            Err(ProjectionError::Fatal(message)) => {
                anyhow::bail!("projection protocol fatal: {}", message)
            }
        }
    }

    fn send_cancel(
        &mut self,
        action_out: &mut dyn Write,
        child_control_out: &mut dyn Write,
    ) -> anyhow::Result<()> {
        let action = ChildAction::Cancel {
            protocolVersion: PROTOCOL_VERSION,
            actionId: format!("cancel-{}-{}", std::process::id(), self.action_sequence),
            sessionId: self.session_id.clone(),
        };
        self.send_action(action_out, child_control_out, &action)
    }

    fn submit(
        &mut self,
        action_out: &mut dyn Write,
        child_control_out: &mut dyn Write,
    ) -> anyhow::Result<()> {
        let text = std::mem::take(&mut self.composer);
        if text.is_empty() {
            return Ok(());
        }
        let action = ChildAction::Submit {
            protocolVersion: PROTOCOL_VERSION,
            actionId: format!("submit-{}-{}", std::process::id(), self.action_sequence),
            sessionId: self.session_id.clone(),
            text,
            attachments: Vec::new(),
            mode: "queue".into(),
        };
        self.send_action(action_out, child_control_out, &action)
    }

    fn send_action(
        &mut self,
        action_out: &mut dyn Write,
        child_control_out: &mut dyn Write,
        action: &ChildAction,
    ) -> anyhow::Result<()> {
        let encoded = crate::protocol::encode(action)?;
        action_out.write_all(&encoded)?;
        action_out.flush()?;
        write_frame(
            child_control_out,
            &ChildControl::Ledger {
                protocolVersion: PROTOCOL_VERSION,
                channel: "action".into(),
                sequence: self.action_sequence,
                recordBytes: u32::try_from(encoded.len() - 4)?,
            },
        )?;
        if self.action_sequence == MAX_SAFE_SEQUENCE {
            anyhow::bail!("action sequence exhausted");
        }
        self.action_sequence += 1;
        Ok(())
    }

    fn draw(
        &mut self,
        terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    ) -> anyhow::Result<()> {
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
            let provider = self
                .model
                .views
                .iter()
                .find(|view| view.id == "agent_status")
                .and_then(|view| view.payload.get("provider"))
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            let title = format!(
                "dsh-tui | session {} | provider {}",
                self.session_id, provider
            );
            frame.render_widget(
                ratatui::widgets::Paragraph::new(title)
                    .style(ratatui::style::Style::default().bold()),
                chunks[0],
            );
            let body: Vec<ratatui::text::Line> =
                self.model
                    .cells
                    .iter()
                    .flat_map(|cell| {
                        cell.lines.iter().map(move |line| {
                            let mut span = ratatui::text::Span::raw(line.text.clone());
                            if let Some(style) = &line.style {
                                let style = match style.as_str() {
                                    "dim" => ratatui::style::Style::default().dim(),
                                    "bold" => ratatui::style::Style::default().bold(),
                                    "accent" => ratatui::style::Style::default()
                                        .fg(ratatui::style::Color::Cyan),
                                    "error" => ratatui::style::Style::default()
                                        .fg(ratatui::style::Color::Red),
                                    "code" => ratatui::style::Style::default()
                                        .bg(ratatui::style::Color::DarkGray),
                                    _ => ratatui::style::Style::default(),
                                };
                                span = span.style(style);
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
            let wrapped_lines = body
                .iter()
                .map(|line| {
                    let text = line
                        .spans
                        .iter()
                        .map(|span| span.content.as_ref())
                        .collect::<String>();
                    wrapped_line_count(&text, body_width)
                })
                .sum::<usize>();
            let scroll_offset = wrapped_lines.saturating_sub(body_height) as u16;
            frame.render_widget(
                ratatui::widgets::Paragraph::new(body)
                    .scroll((scroll_offset, 0))
                    .wrap(ratatui::widgets::Wrap { trim: true }),
                chunks[1],
            );
            frame.render_widget(
                ratatui::widgets::Paragraph::new(format!("> {}", self.composer))
                    .style(ratatui::style::Style::default().fg(ratatui::style::Color::Yellow)),
                chunks[2],
            );
        })?;
        Ok(())
    }
}

fn require_version(version: u32) -> anyhow::Result<()> {
    if version != PROTOCOL_VERSION {
        anyhow::bail!("incompatible protocol version: {}", version);
    }
    Ok(())
}

fn strict_decode<T: serde::de::DeserializeOwned>(body: &[u8]) -> anyhow::Result<T> {
    let mut deserializer = serde_json::Deserializer::from_slice(body);
    let value = T::deserialize(&mut deserializer)?;
    deserializer.end()?;
    Ok(value)
}

fn wrapped_line_count(text: &str, width: usize) -> usize {
    if width == 0 {
        return 0;
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
